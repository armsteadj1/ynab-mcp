import { getYnabClient, resolveBudgetId } from '../ynab-client.js';
import { formatCurrency, milliunitsToDollars } from '../utils/milliunits.js';
import type { CoachTransaction, CoachTransactionSub } from './reader.js';

export interface ApplySubtransactionInput {
  category_id: string;
  amount_milliunits: number;
  memo?: string;
}

export interface ApplyChangeInput {
  transaction_id: string;
  category_id?: string;
  subtransactions?: ApplySubtransactionInput[];
  memo?: string;
  memo_reason?: string;
}

export interface ApplyCategorizationOptions {
  budgetId: string;
  dryRun?: boolean;
  changes: ApplyChangeInput[];
}

export interface CategorizationApplyPayload {
  category_id?: string;
  subtransactions?: Array<{ category_id: string; amount: number; memo?: string }>;
  memo?: string;
}

export interface YnabCategorizationWriter {
  getTransaction(budgetId: string, transactionId: string): Promise<CoachTransaction>;
  updateTransaction(
    budgetId: string,
    transactionId: string,
    payload: CategorizationApplyPayload
  ): Promise<CoachTransaction>;
}

export interface SubtransactionPreview {
  category_id: string;
  amount_milliunits: number;
  amount_dollars: number;
  amount_formatted: string;
  memo: string | null;
}

export interface TransactionPreview {
  category_id: string | null;
  category_name: string | null;
  memo: string | null;
  is_split: boolean;
  subtransactions: SubtransactionPreview[];
}

export interface AppliedItem {
  transaction_id: string;
  changed_fields: string[];
  before: TransactionPreview;
  after: TransactionPreview;
  memo_action: 'set' | 'preserved_existing' | 'no_change';
  memo_skipped_reason?: string;
  approved_after_apply: boolean | null;
  warnings: string[];
}

export interface SkippedItem {
  transaction_id: string;
  reason: string;
}

export interface ErrorItem {
  transaction_id: string;
  error: string;
}

export interface ApplyCategorizationResult {
  budget_id: string;
  dry_run: boolean;
  total_requested: number;
  applied: AppliedItem[];
  skipped: SkippedItem[];
  errors: ErrorItem[];
  notes: string[];
}

const FORBIDDEN_KEYS = new Set([
  'approved',
  'cleared',
  'date',
  'amount',
  'payee_id',
  'payee_name',
  'account_id',
  'import_id',
]);

function ensureNoForbiddenKeys(change: ApplyChangeInput): string[] {
  const violations: string[] = [];
  for (const key of Object.keys(change)) {
    if (FORBIDDEN_KEYS.has(key)) violations.push(key);
  }
  return violations;
}

function memoIsBlank(memo: string | null | undefined): boolean {
  return memo === null || memo === undefined || memo.trim() === '';
}

function buildPreviewFromTransaction(tx: CoachTransaction): TransactionPreview {
  const subs: SubtransactionPreview[] = (tx.subtransactions ?? []).map((s) => ({
    category_id: s.category_id ?? '',
    amount_milliunits: s.amount,
    amount_dollars: milliunitsToDollars(s.amount),
    amount_formatted: formatCurrency(s.amount),
    memo: s.memo,
  }));
  return {
    category_id: tx.category_id ?? null,
    category_name: tx.category_name ?? null,
    memo: tx.memo ?? null,
    is_split: subs.length > 0,
    subtransactions: subs,
  };
}

function buildAfterPreview(
  before: CoachTransaction,
  payload: CategorizationApplyPayload,
  memoAction: 'set' | 'preserved_existing' | 'no_change'
): TransactionPreview {
  const memo =
    memoAction === 'set' && payload.memo !== undefined
      ? payload.memo
      : (before.memo ?? null);

  if (payload.subtransactions && payload.subtransactions.length > 0) {
    return {
      category_id: null,
      category_name: null,
      memo,
      is_split: true,
      subtransactions: payload.subtransactions.map((s) => ({
        category_id: s.category_id,
        amount_milliunits: s.amount,
        amount_dollars: milliunitsToDollars(s.amount),
        amount_formatted: formatCurrency(s.amount),
        memo: s.memo ?? null,
      })),
    };
  }

  return {
    category_id: payload.category_id ?? before.category_id ?? null,
    category_name:
      payload.category_id && payload.category_id !== before.category_id
        ? null
        : (before.category_name ?? null),
    memo,
    is_split: false,
    subtransactions: [],
  };
}

interface PreparedChange {
  payload: CategorizationApplyPayload;
  changedFields: string[];
  memoAction: 'set' | 'preserved_existing' | 'no_change';
  memoSkippedReason?: string;
  warnings: string[];
}

function prepareChange(
  change: ApplyChangeInput,
  current: CoachTransaction
): PreparedChange {
  const warnings: string[] = [];
  const changedFields: string[] = [];
  const payload: CategorizationApplyPayload = {};

  const hasCategory = !!change.category_id;
  const hasSubs = !!(change.subtransactions && change.subtransactions.length > 0);

  if (hasCategory && hasSubs) {
    throw new Error(
      'Change must specify either category_id or subtransactions, not both.'
    );
  }
  if (!hasCategory && !hasSubs) {
    throw new Error(
      'Change must specify either category_id or a non-empty subtransactions array.'
    );
  }

  if (hasSubs && change.subtransactions) {
    const subs = change.subtransactions;
    let sum = 0;
    for (const [i, s] of subs.entries()) {
      if (!s.category_id) {
        throw new Error(`Subtransaction ${i} is missing category_id.`);
      }
      if (!Number.isInteger(s.amount_milliunits)) {
        throw new Error(
          `Subtransaction ${i} amount_milliunits must be an integer (got ${s.amount_milliunits}).`
        );
      }
      sum += s.amount_milliunits;
    }
    if (sum !== current.amount) {
      throw new Error(
        `Subtransactions sum to ${sum} milliunits but transaction amount is ${current.amount} milliunits.`
      );
    }

    const subsAreSameAsExisting = subtransactionsMatchExisting(
      subs,
      current.subtransactions ?? []
    );
    if (!subsAreSameAsExisting) {
      payload.subtransactions = subs.map((s) => ({
        category_id: s.category_id,
        amount: s.amount_milliunits,
        memo: s.memo,
      }));
      changedFields.push('subtransactions');
    }
  } else if (hasCategory && change.category_id) {
    if (current.category_id !== change.category_id) {
      payload.category_id = change.category_id;
      changedFields.push('category_id');
    }
  }

  let memoAction: 'set' | 'preserved_existing' | 'no_change' = 'no_change';
  let memoSkippedReason: string | undefined;

  const proposedMemo =
    (change.memo && change.memo.trim() !== '' ? change.memo : undefined) ??
    (change.memo_reason && change.memo_reason.trim() !== ''
      ? change.memo_reason
      : undefined);

  if (proposedMemo !== undefined) {
    if (memoIsBlank(current.memo)) {
      if (current.memo !== proposedMemo) {
        payload.memo = proposedMemo;
        changedFields.push('memo');
        memoAction = 'set';
      }
    } else {
      memoAction = 'preserved_existing';
      memoSkippedReason =
        'Existing memo is non-empty; preserved by default. Pass an explicit override (future task) to replace it.';
    }
  }

  return { payload, changedFields, memoAction, memoSkippedReason, warnings };
}

function subtransactionsMatchExisting(
  proposed: ApplySubtransactionInput[],
  existing: CoachTransactionSub[]
): boolean {
  if (proposed.length !== existing.length) return false;
  const sortedProposed = [...proposed].sort((a, b) =>
    a.category_id.localeCompare(b.category_id)
  );
  const sortedExisting = [...existing].sort((a, b) =>
    (a.category_id ?? '').localeCompare(b.category_id ?? '')
  );
  for (let i = 0; i < sortedProposed.length; i += 1) {
    const p = sortedProposed[i];
    const e = sortedExisting[i];
    if (e.category_id !== p.category_id) return false;
    if (e.amount !== p.amount_milliunits) return false;
    const eMemo = e.memo ?? '';
    const pMemo = p.memo ?? '';
    if (eMemo !== pMemo) return false;
  }
  return true;
}

export async function applyCategorization(
  writer: YnabCategorizationWriter,
  opts: ApplyCategorizationOptions
): Promise<ApplyCategorizationResult> {
  const dryRun = opts.dryRun ?? true;
  const applied: AppliedItem[] = [];
  const skipped: SkippedItem[] = [];
  const errors: ErrorItem[] = [];

  for (const change of opts.changes) {
    const violations = ensureNoForbiddenKeys(change);
    if (violations.length > 0) {
      errors.push({
        transaction_id: change.transaction_id,
        error: `Forbidden fields rejected: ${violations.join(', ')}. This tool may only set category, subtransactions, or memo.`,
      });
      continue;
    }

    if (!change.transaction_id) {
      errors.push({
        transaction_id: change.transaction_id ?? '',
        error: 'transaction_id is required.',
      });
      continue;
    }

    let current: CoachTransaction;
    try {
      current = await writer.getTransaction(opts.budgetId, change.transaction_id);
    } catch (e) {
      errors.push({
        transaction_id: change.transaction_id,
        error: `Could not fetch transaction: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    if (current.deleted) {
      skipped.push({
        transaction_id: change.transaction_id,
        reason: 'Transaction is deleted; refusing to update.',
      });
      continue;
    }
    if (current.transfer_account_id) {
      skipped.push({
        transaction_id: change.transaction_id,
        reason: 'Transaction is a transfer; categorization is not allowed.',
      });
      continue;
    }

    let prepared: PreparedChange;
    try {
      prepared = prepareChange(change, current);
    } catch (e) {
      errors.push({
        transaction_id: change.transaction_id,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    if (prepared.changedFields.length === 0) {
      skipped.push({
        transaction_id: change.transaction_id,
        reason:
          prepared.memoAction === 'preserved_existing'
            ? 'No category change required and existing memo preserved.'
            : 'Proposed change matches the current transaction; nothing to update.',
      });
      continue;
    }

    const before = buildPreviewFromTransaction(current);

    if (dryRun) {
      applied.push({
        transaction_id: change.transaction_id,
        changed_fields: prepared.changedFields,
        before,
        after: buildAfterPreview(current, prepared.payload, prepared.memoAction),
        memo_action: prepared.memoAction,
        memo_skipped_reason: prepared.memoSkippedReason,
        approved_after_apply: null,
        warnings: prepared.warnings,
      });
      continue;
    }

    try {
      const updated = await writer.updateTransaction(
        opts.budgetId,
        change.transaction_id,
        prepared.payload
      );
      const after = buildPreviewFromTransaction(updated);
      const warnings = [...prepared.warnings];
      if (updated.approved && !current.approved) {
        warnings.push(
          'YNAB returned approved=true after update — this tool never sets approved. Verify the transaction state in YNAB.'
        );
      }
      applied.push({
        transaction_id: change.transaction_id,
        changed_fields: prepared.changedFields,
        before,
        after,
        memo_action: prepared.memoAction,
        memo_skipped_reason: prepared.memoSkippedReason,
        approved_after_apply: updated.approved,
        warnings,
      });
    } catch (e) {
      errors.push({
        transaction_id: change.transaction_id,
        error: `Update failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const notes: string[] = [
    dryRun
      ? 'Dry run — no YNAB writes were performed. Re-run with dry_run: false to apply these exact changes.'
      : 'Apply mode — only category, subtransactions, and memo were sent. approved/cleared/date/amount/payee/account were never modified by this tool.',
    'Transactions remain unapproved by design; human review still required in the YNAB inbox.',
  ];

  return {
    budget_id: opts.budgetId,
    dry_run: dryRun,
    total_requested: opts.changes.length,
    applied,
    skipped,
    errors,
    notes,
  };
}

function mapYnabTransaction(t: {
  id: string;
  date: string;
  amount: number;
  memo?: string | null;
  cleared: string;
  approved: boolean;
  flag_color?: string | null;
  account_id: string;
  account_name?: string;
  payee_id?: string | null;
  payee_name?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  transfer_account_id?: string | null;
  transfer_transaction_id?: string | null;
  matched_transaction_id?: string | null;
  import_id?: string | null;
  import_payee_name?: string | null;
  import_payee_name_original?: string | null;
  deleted: boolean;
  subtransactions?: Array<{
    id: string;
    amount: number;
    category_id?: string | null;
    category_name?: string | null;
    payee_id?: string | null;
    payee_name?: string | null;
    memo?: string | null;
    transfer_account_id?: string | null;
    deleted: boolean;
  }>;
}): CoachTransaction {
  return {
    id: t.id,
    date: t.date,
    amount: t.amount,
    memo: t.memo ?? null,
    cleared: t.cleared,
    approved: t.approved,
    flag_color: t.flag_color ?? null,
    account_id: t.account_id,
    account_name: t.account_name,
    payee_id: t.payee_id ?? null,
    payee_name: t.payee_name ?? null,
    category_id: t.category_id ?? null,
    category_name: t.category_name ?? null,
    transfer_account_id: t.transfer_account_id ?? null,
    transfer_transaction_id: t.transfer_transaction_id ?? null,
    matched_transaction_id: t.matched_transaction_id ?? null,
    import_id: t.import_id ?? null,
    import_payee_name: t.import_payee_name ?? null,
    import_payee_name_original: t.import_payee_name_original ?? null,
    deleted: t.deleted,
    subtransactions: (t.subtransactions ?? []).map((s) => ({
      id: s.id,
      amount: s.amount,
      category_id: s.category_id ?? null,
      category_name: s.category_name ?? null,
      payee_id: s.payee_id ?? null,
      payee_name: s.payee_name ?? null,
      memo: s.memo ?? null,
      transfer_account_id: s.transfer_account_id ?? null,
      deleted: s.deleted,
    })),
  };
}

export function createLiveCategorizationWriter(): YnabCategorizationWriter {
  const client = getYnabClient();
  return {
    async getTransaction(budgetId, transactionId) {
      const resolved = resolveBudgetId(budgetId);
      const response = await client.transactions.getTransactionById(
        resolved,
        transactionId
      );
      return mapYnabTransaction(response.data.transaction);
    },
    async updateTransaction(budgetId, transactionId, payload) {
      const resolved = resolveBudgetId(budgetId);
      const transaction: Record<string, unknown> = {};
      if (payload.subtransactions && payload.subtransactions.length > 0) {
        transaction.subtransactions = payload.subtransactions.map((s) => ({
          category_id: s.category_id,
          amount: s.amount,
          memo: s.memo,
        }));
      } else if (payload.category_id !== undefined) {
        transaction.category_id = payload.category_id;
      }
      if (payload.memo !== undefined) {
        transaction.memo = payload.memo;
      }
      const response = await client.transactions.updateTransaction(
        resolved,
        transactionId,
        // Cast: SaveTransactionWithOptionalFields accepts these fields and the rest are
        // intentionally omitted so YNAB leaves them untouched.
        { transaction: transaction as never }
      );
      return mapYnabTransaction(response.data.transaction);
    },
  };
}

let cachedWriter: YnabCategorizationWriter | null = null;

export function getCategorizationWriter(): YnabCategorizationWriter {
  if (!cachedWriter) {
    cachedWriter = createLiveCategorizationWriter();
  }
  return cachedWriter;
}

export function setCategorizationWriter(
  writer: YnabCategorizationWriter | null
): void {
  cachedWriter = writer;
}
