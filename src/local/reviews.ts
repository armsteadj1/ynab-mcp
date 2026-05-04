import type { Database } from './db.js';
import { formatCurrency, milliunitsToDollars } from '../utils/milliunits.js';

const REVIEW_LOOKBACK_DAYS_DEFAULT = 60;
const SIGNAL_LARGE_TRANSACTION_DOLLARS_DEFAULT = 250;

export interface ReviewTransaction {
  id: string;
  date: string;
  amount_dollars: number;
  amount_formatted: string;
  account_id: string;
  account_name: string | null;
  payee_id: string | null;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  memo: string | null;
  cleared: string;
  approved: boolean;
  flag_color: string | null;
  reasons: string[];
}

export interface CategoryRollup {
  category_id: string | null;
  category_name: string | null;
  total_dollars: number;
  total_formatted: string;
  transaction_count: number;
}

export interface PayeeRollup {
  payee_id: string | null;
  payee_name: string | null;
  total_dollars: number;
  total_formatted: string;
  transaction_count: number;
}

export interface AccountFlow {
  account_id: string;
  account_name: string;
  account_type: string;
  net_dollars: number;
  net_formatted: string;
  transaction_count: number;
}

export interface FinanceSignal {
  kind: 'large_transaction' | 'review_backlog' | 'overspent_category' | 'no_recent_sync';
  severity: 'info' | 'warn';
  message: string;
  detail?: Record<string, unknown>;
}

export interface PeriodReview {
  budget_id: string;
  period_start: string;
  period_end: string;
  totals: {
    spending_dollars: number;
    spending_formatted: string;
    income_dollars: number;
    income_formatted: string;
    net_dollars: number;
    net_formatted: string;
    transaction_count: number;
    transactions_needing_review: number;
  };
  top_spending_categories: CategoryRollup[];
  top_payees: PayeeRollup[];
  account_flows: AccountFlow[];
  signals: FinanceSignal[];
}

interface PeriodOptions {
  budgetId: string;
  start: string;
  end: string;
  largeTxThresholdDollars?: number;
}

export interface NeedReviewOptions {
  budgetId: string;
  limit?: number;
  sinceDate?: string;
}

interface RawTxRow {
  id: string;
  date: string;
  amount: number;
  account_id: string;
  account_name: string | null;
  payee_id: string | null;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  memo: string | null;
  cleared: string;
  approved: number;
  flag_color: string | null;
  transfer_account_id: string | null;
}

const TX_NEEDS_REVIEW_BASE_WHERE = `
  t.budget_id = ?
  AND t.deleted = 0
  AND t.transfer_account_id IS NULL
  AND t.date >= ?
`;

export function getTransactionsNeedingReview(
  db: Database,
  opts: NeedReviewOptions
): ReviewTransaction[] {
  const limit = opts.limit ?? 50;
  const since = opts.sinceDate ?? defaultLookbackStart();
  const rows = db
    .prepare(
      `SELECT t.id, t.date, t.amount, t.account_id, a.name AS account_name,
              t.payee_id, t.payee_name, t.category_id, t.category_name,
              t.memo, t.cleared, t.approved, t.flag_color, t.transfer_account_id
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
       WHERE ${TX_NEEDS_REVIEW_BASE_WHERE}
         AND (
           t.category_id IS NULL
           OR t.approved = 0
           OR t.flag_color IS NOT NULL
         )
       ORDER BY t.date DESC, t.id
       LIMIT ?`
    )
    .all(opts.budgetId, since, limit) as unknown as RawTxRow[];

  return rows.map(toReviewTransaction);
}

export function countTransactionsNeedingReview(
  db: Database,
  budgetId: string,
  sinceDate?: string
): number {
  const since = sinceDate ?? defaultLookbackStart();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM transactions t
       WHERE ${TX_NEEDS_REVIEW_BASE_WHERE}
         AND (
           t.category_id IS NULL
           OR t.approved = 0
           OR t.flag_color IS NOT NULL
         )`
    )
    .get(budgetId, since) as { n: number };
  return row.n;
}

export function getWeeklyReview(
  db: Database,
  budgetId: string,
  endDate?: string
): PeriodReview {
  const end = endDate ?? today();
  const start = addDays(end, -6);
  return buildPeriodReview(db, { budgetId, start, end });
}

export function getMonthlyReview(
  db: Database,
  budgetId: string,
  month?: string
): PeriodReview {
  const targetMonth = month ?? today().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
    throw new Error(`Invalid month "${targetMonth}", expected YYYY-MM`);
  }
  const start = `${targetMonth}-01`;
  const end = lastDayOfMonth(targetMonth);
  return buildPeriodReview(db, { budgetId, start, end });
}

function buildPeriodReview(db: Database, opts: PeriodOptions): PeriodReview {
  const { budgetId, start, end } = opts;
  const threshold =
    (opts.largeTxThresholdDollars ?? SIGNAL_LARGE_TRANSACTION_DOLLARS_DEFAULT) * 1000;

  const rows = db
    .prepare(
      `SELECT t.id, t.date, t.amount, t.account_id, a.name AS account_name, a.type AS account_type,
              t.payee_id, t.payee_name, t.category_id, t.category_name,
              t.memo, t.cleared, t.approved, t.flag_color, t.transfer_account_id
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
       WHERE t.budget_id = ?
         AND t.deleted = 0
         AND t.transfer_account_id IS NULL
         AND t.date >= ?
         AND t.date <= ?
       ORDER BY t.date DESC, t.id`
    )
    .all(budgetId, start, end) as unknown as Array<RawTxRow & { account_type: string | null }>;

  const subRows = db
    .prepare(
      `SELECT s.id, s.transaction_id, s.amount, s.category_id, s.category_name,
              s.payee_id, s.payee_name, s.transfer_account_id, s.deleted
       FROM subtransactions s
       JOIN transactions t ON t.id = s.transaction_id
       WHERE t.budget_id = ?
         AND t.deleted = 0
         AND t.date >= ?
         AND t.date <= ?
         AND s.deleted = 0
         AND s.transfer_account_id IS NULL`
    )
    .all(budgetId, start, end) as unknown as Array<{
    id: string;
    transaction_id: string;
    amount: number;
    category_id: string | null;
    category_name: string | null;
    payee_id: string | null;
    payee_name: string | null;
    transfer_account_id: string | null;
    deleted: number;
  }>;

  const subParents = new Set(subRows.map((s) => s.transaction_id));

  let spendingMu = 0;
  let incomeMu = 0;
  const accountFlow = new Map<
    string,
    { name: string; type: string; net: number; count: number }
  >();
  const categoryTotals = new Map<
    string,
    { id: string | null; name: string | null; total: number; count: number }
  >();
  const payeeTotals = new Map<
    string,
    { id: string | null; name: string | null; total: number; count: number }
  >();
  const largeTransactions: ReviewTransaction[] = [];
  let needsReviewCount = 0;

  for (const r of rows) {
    if (r.amount < 0) spendingMu += -r.amount;
    else if (r.amount > 0) incomeMu += r.amount;

    const flowKey = r.account_id;
    const flow = accountFlow.get(flowKey) ?? {
      name: r.account_name ?? r.account_id,
      type: r.account_type ?? 'unknown',
      net: 0,
      count: 0,
    };
    flow.net += r.amount;
    flow.count += 1;
    accountFlow.set(flowKey, flow);

    if (!subParents.has(r.id) && r.amount < 0) {
      bumpRollup(categoryTotals, categoryKey(r), r.category_id, r.category_name, -r.amount);
      bumpRollup(payeeTotals, payeeKey(r), r.payee_id, r.payee_name, -r.amount);
    }

    const reasons = collectReviewReasons(r);
    if (reasons.length > 0) needsReviewCount += 1;

    if (Math.abs(r.amount) >= threshold) {
      largeTransactions.push(toReviewTransaction(r));
    }
  }

  for (const s of subRows) {
    if (s.amount < 0) {
      bumpRollup(
        categoryTotals,
        s.category_id ?? `__uncat_${s.id}`,
        s.category_id,
        s.category_name,
        -s.amount
      );
      bumpRollup(
        payeeTotals,
        s.payee_id ?? `__uncatpayee_${s.id}`,
        s.payee_id,
        s.payee_name,
        -s.amount
      );
    }
  }

  const top_spending_categories: CategoryRollup[] = [...categoryTotals.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map((c) => ({
      category_id: c.id,
      category_name: c.name,
      total_dollars: milliunitsToDollars(c.total),
      total_formatted: formatCurrency(c.total),
      transaction_count: c.count,
    }));

  const top_payees: PayeeRollup[] = [...payeeTotals.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map((p) => ({
      payee_id: p.id,
      payee_name: p.name,
      total_dollars: milliunitsToDollars(p.total),
      total_formatted: formatCurrency(p.total),
      transaction_count: p.count,
    }));

  const account_flows: AccountFlow[] = [...accountFlow.entries()]
    .map(([id, f]) => ({
      account_id: id,
      account_name: f.name,
      account_type: f.type,
      net_dollars: milliunitsToDollars(f.net),
      net_formatted: formatCurrency(f.net),
      transaction_count: f.count,
    }))
    .sort((a, b) => Math.abs(b.net_dollars) - Math.abs(a.net_dollars));

  const signals: FinanceSignal[] = [];
  for (const tx of largeTransactions.slice(0, 5)) {
    signals.push({
      kind: 'large_transaction',
      severity: 'info',
      message: `Large transaction: ${tx.amount_formatted} at ${tx.payee_name ?? 'Unknown payee'} on ${tx.date}`,
      detail: {
        transaction_id: tx.id,
        amount_dollars: tx.amount_dollars,
        category_name: tx.category_name,
      },
    });
  }
  if (needsReviewCount > 0) {
    signals.push({
      kind: 'review_backlog',
      severity: needsReviewCount >= 10 ? 'warn' : 'info',
      message: `${needsReviewCount} transaction${needsReviewCount === 1 ? '' : 's'} need review in this period`,
      detail: { count: needsReviewCount },
    });
  }

  const overspent = db
    .prepare(
      `SELECT id, name, balance, budgeted, activity FROM categories
       WHERE budget_id = ?
         AND deleted = 0
         AND hidden = 0
         AND balance IS NOT NULL
         AND balance < 0
       ORDER BY balance ASC
       LIMIT 5`
    )
    .all(budgetId) as unknown as Array<{
    id: string;
    name: string;
    balance: number | null;
    budgeted: number | null;
    activity: number | null;
  }>;
  for (const cat of overspent) {
    signals.push({
      kind: 'overspent_category',
      severity: 'warn',
      message: `Category "${cat.name}" is overspent (${formatCurrency(cat.balance ?? 0)})`,
      detail: {
        category_id: cat.id,
        balance_dollars: milliunitsToDollars(cat.balance ?? 0),
      },
    });
  }

  return {
    budget_id: budgetId,
    period_start: start,
    period_end: end,
    totals: {
      spending_dollars: milliunitsToDollars(spendingMu),
      spending_formatted: formatCurrency(spendingMu),
      income_dollars: milliunitsToDollars(incomeMu),
      income_formatted: formatCurrency(incomeMu),
      net_dollars: milliunitsToDollars(incomeMu - spendingMu),
      net_formatted: formatCurrency(incomeMu - spendingMu),
      transaction_count: rows.length,
      transactions_needing_review: needsReviewCount,
    },
    top_spending_categories,
    top_payees,
    account_flows,
    signals,
  };
}

function bumpRollup(
  map: Map<string, { id: string | null; name: string | null; total: number; count: number }>,
  key: string,
  id: string | null,
  name: string | null,
  delta: number
): void {
  const cur = map.get(key) ?? { id, name, total: 0, count: 0 };
  cur.total += delta;
  cur.count += 1;
  map.set(key, cur);
}

function categoryKey(r: { category_id: string | null; id: string }): string {
  return r.category_id ?? `__uncat_${r.id}`;
}

function payeeKey(r: { payee_id: string | null; id: string }): string {
  return r.payee_id ?? `__uncatpayee_${r.id}`;
}

function collectReviewReasons(r: RawTxRow): string[] {
  const reasons: string[] = [];
  if (!r.category_id) reasons.push('uncategorized');
  if (!r.approved) reasons.push('unapproved');
  if (r.flag_color) reasons.push(`flag:${r.flag_color}`);
  return reasons;
}

function toReviewTransaction(r: RawTxRow): ReviewTransaction {
  return {
    id: r.id,
    date: r.date,
    amount_dollars: milliunitsToDollars(r.amount),
    amount_formatted: formatCurrency(r.amount),
    account_id: r.account_id,
    account_name: r.account_name,
    payee_id: r.payee_id,
    payee_name: r.payee_name,
    category_id: r.category_id,
    category_name: r.category_name,
    memo: r.memo,
    cleared: r.cleared,
    approved: !!r.approved,
    flag_color: r.flag_color,
    reasons: collectReviewReasons(r),
  };
}

function defaultLookbackStart(): string {
  return addDays(today(), -REVIEW_LOOKBACK_DAYS_DEFAULT);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate: string, delta: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(yyyyMm: string): string {
  const [year, month] = yyyyMm.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0));
  return last.toISOString().slice(0, 10);
}
