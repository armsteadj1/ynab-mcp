import { formatCurrency, milliunitsToDollars } from '../utils/milliunits.js';
import type {
  CoachCategory,
  CoachCategoryGroup,
  CoachTransaction,
  YnabCoachReader,
} from './reader.js';

export interface QueueTransaction {
  id: string;
  date: string;
  amount_dollars: number;
  amount_formatted: string;
  account_id: string;
  account_name: string | null;
  payee_id: string | null;
  payee_name: string | null;
  import_payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  memo: string | null;
  cleared: string;
  approved: boolean;
  reasons: string[];
}

export interface QueueGroup {
  group_key: string;
  payee_name: string | null;
  transaction_count: number;
  total_amount_dollars: number;
  total_amount_formatted: string;
  example_transaction_ids: string[];
}

export interface CategorizationQueueResult {
  budget_id: string;
  since_date: string;
  total_count: number;
  uncategorized_count: number;
  unapproved_count: number;
  flagged_count: number;
  transactions: QueueTransaction[];
  duplicate_groups: QueueGroup[];
  notes: string[];
}

export interface SuggestionEvidenceExample {
  transaction_id: string;
  date: string;
  amount_dollars: number;
  amount_formatted: string;
  category_id: string | null;
  category_name: string | null;
}

export interface SuggestionEvidence {
  payee_match: string | null;
  prior_examples: SuggestionEvidenceExample[];
  payee_default_category_id: string | null;
  payee_default_category_name: string | null;
  notes: string[];
}

export interface SuggestedCategory {
  category_id: string | null;
  category_name: string | null;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
}

export interface TransactionSuggestion {
  transaction_id: string;
  date: string;
  amount_dollars: number;
  amount_formatted: string;
  payee_id: string | null;
  payee_name: string | null;
  current_category_id: string | null;
  current_category_name: string | null;
  suggestion: SuggestedCategory;
  alternatives: SuggestedCategory[];
  evidence: SuggestionEvidence;
}

export interface CategorizationSuggestionsResult {
  budget_id: string;
  since_date: string;
  considered: number;
  with_high_confidence: number;
  with_medium_confidence: number;
  with_low_confidence: number;
  suggestions: TransactionSuggestion[];
  notes: string[];
}

export interface CategorizationQueueOptions {
  budgetId: string;
  sinceDate?: string;
  limit?: number;
}

export interface SuggestCategoriesOptions {
  budgetId: string;
  sinceDate?: string;
  transactionIds?: string[];
  limit?: number;
}

const DEFAULT_LOOKBACK_DAYS = 60;
const DEFAULT_QUEUE_LIMIT = 100;
const DEFAULT_SUGGEST_LIMIT = 50;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultSince(days = DEFAULT_LOOKBACK_DAYS): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function isCategorizable(tx: CoachTransaction): boolean {
  if (tx.deleted) return false;
  if (tx.transfer_account_id) return false;
  return true;
}

function reasonsForReview(tx: CoachTransaction): string[] {
  const reasons: string[] = [];
  if (!tx.category_id) reasons.push('uncategorized');
  if (!tx.approved) reasons.push('unapproved');
  if (tx.flag_color) reasons.push(`flag:${tx.flag_color}`);
  return reasons;
}

function payeeKey(tx: CoachTransaction): string {
  return (
    tx.payee_id ??
    `name:${(tx.payee_name ?? tx.import_payee_name ?? 'unknown').toLowerCase()}`
  );
}

function buildQueueTransaction(tx: CoachTransaction): QueueTransaction {
  return {
    id: tx.id,
    date: tx.date,
    amount_dollars: milliunitsToDollars(tx.amount),
    amount_formatted: formatCurrency(tx.amount),
    account_id: tx.account_id,
    account_name: tx.account_name ?? null,
    payee_id: tx.payee_id,
    payee_name: tx.payee_name,
    import_payee_name: tx.import_payee_name,
    category_id: tx.category_id,
    category_name: tx.category_name,
    memo: tx.memo,
    cleared: tx.cleared,
    approved: tx.approved,
    reasons: reasonsForReview(tx),
  };
}

export async function getCategorizationQueue(
  reader: YnabCoachReader,
  opts: CategorizationQueueOptions
): Promise<CategorizationQueueResult> {
  const since = opts.sinceDate ?? defaultSince();
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_QUEUE_LIMIT, 500));
  const transactions = await reader.getTransactions(opts.budgetId, since);
  const eligible = transactions.filter(isCategorizable);

  const needs = eligible.filter((t) => reasonsForReview(t).length > 0);
  const sorted = needs.slice().sort((a, b) => b.date.localeCompare(a.date));

  const uncategorized = needs.filter((t) => !t.category_id).length;
  const unapproved = needs.filter((t) => !t.approved).length;
  const flagged = needs.filter((t) => !!t.flag_color).length;

  const groupsMap = new Map<string, QueueGroup>();
  for (const tx of needs) {
    const key = payeeKey(tx);
    const existing = groupsMap.get(key);
    if (existing) {
      existing.transaction_count += 1;
      existing.total_amount_dollars += milliunitsToDollars(tx.amount);
      if (existing.example_transaction_ids.length < 3) {
        existing.example_transaction_ids.push(tx.id);
      }
    } else {
      groupsMap.set(key, {
        group_key: key,
        payee_name: tx.payee_name ?? tx.import_payee_name ?? null,
        transaction_count: 1,
        total_amount_dollars: milliunitsToDollars(tx.amount),
        total_amount_formatted: '',
        example_transaction_ids: [tx.id],
      });
    }
  }
  const duplicateGroups = [...groupsMap.values()]
    .filter((g) => g.transaction_count >= 2)
    .map((g) => ({
      ...g,
      total_amount_dollars: Math.round(g.total_amount_dollars * 100) / 100,
      total_amount_formatted: formatCurrency(
        Math.round(g.total_amount_dollars * 1000)
      ),
    }))
    .sort((a, b) => b.transaction_count - a.transaction_count);

  const notes: string[] = [
    'Read-only queue — no categories are applied. Approval required before any future write.',
  ];
  const stale = needs.filter((t) => isStale(t.date)).length;
  if (stale > 0) {
    notes.push(
      `${stale} transaction${stale === 1 ? '' : 's'} older than 7 days still need attention.`
    );
  }

  return {
    budget_id: opts.budgetId,
    since_date: since,
    total_count: needs.length,
    uncategorized_count: uncategorized,
    unapproved_count: unapproved,
    flagged_count: flagged,
    transactions: sorted.slice(0, limit).map(buildQueueTransaction),
    duplicate_groups: duplicateGroups,
    notes,
  };
}

function isStale(dateIso: string): boolean {
  const today = todayIso();
  const d = new Date(`${dateIso}T00:00:00Z`);
  const t = new Date(`${today}T00:00:00Z`);
  const ms = t.getTime() - d.getTime();
  return ms > 7 * 24 * 60 * 60 * 1000;
}

interface PayeeHistoryEntry {
  category_id: string;
  category_name: string | null;
  occurrences: number;
  last_seen_date: string;
  examples: SuggestionEvidenceExample[];
}

interface PayeeHistory {
  by_payee_id: Map<string, Map<string, PayeeHistoryEntry>>;
  by_payee_name: Map<string, Map<string, PayeeHistoryEntry>>;
}

function buildPayeeHistory(transactions: CoachTransaction[]): PayeeHistory {
  const byId = new Map<string, Map<string, PayeeHistoryEntry>>();
  const byName = new Map<string, Map<string, PayeeHistoryEntry>>();

  function bumpEntry(
    map: Map<string, Map<string, PayeeHistoryEntry>>,
    key: string,
    tx: CoachTransaction
  ): void {
    if (!tx.category_id) return;
    let inner = map.get(key);
    if (!inner) {
      inner = new Map();
      map.set(key, inner);
    }
    const catKey = tx.category_id;
    const existing = inner.get(catKey);
    if (existing) {
      existing.occurrences += 1;
      if (tx.date > existing.last_seen_date) existing.last_seen_date = tx.date;
      if (existing.examples.length < 3) {
        existing.examples.push(toExample(tx));
      }
    } else {
      inner.set(catKey, {
        category_id: catKey,
        category_name: tx.category_name,
        occurrences: 1,
        last_seen_date: tx.date,
        examples: [toExample(tx)],
      });
    }
  }

  for (const tx of transactions) {
    if (tx.deleted) continue;
    if (tx.transfer_account_id) continue;
    if (!tx.category_id) continue;
    if (!tx.approved) continue;
    if (tx.payee_id) bumpEntry(byId, tx.payee_id, tx);
    const nameKey = (tx.payee_name ?? tx.import_payee_name ?? '').toLowerCase().trim();
    if (nameKey) bumpEntry(byName, nameKey, tx);
  }

  return { by_payee_id: byId, by_payee_name: byName };
}

function toExample(tx: CoachTransaction): SuggestionEvidenceExample {
  return {
    transaction_id: tx.id,
    date: tx.date,
    amount_dollars: milliunitsToDollars(tx.amount),
    amount_formatted: formatCurrency(tx.amount),
    category_id: tx.category_id,
    category_name: tx.category_name,
  };
}

interface CategoryNameIndex {
  byId: Map<string, { category: CoachCategory; group: CoachCategoryGroup }>;
  byNormalizedName: Map<string, CoachCategory[]>;
}

function buildCategoryIndex(groups: CoachCategoryGroup[]): CategoryNameIndex {
  const byId = new Map<string, { category: CoachCategory; group: CoachCategoryGroup }>();
  const byName = new Map<string, CoachCategory[]>();
  for (const g of groups) {
    if (g.deleted || g.hidden) continue;
    for (const c of g.categories) {
      if (c.deleted || c.hidden) continue;
      byId.set(c.id, { category: c, group: g });
      const key = c.name.toLowerCase();
      const arr = byName.get(key) ?? [];
      arr.push(c);
      byName.set(key, arr);
    }
  }
  return { byId, byNormalizedName: byName };
}

const KEYWORD_TO_CATEGORY_HINTS: Array<{ patterns: string[]; categoryHints: string[] }> = [
  { patterns: ['kroger', 'safeway', 'whole foods', 'trader joe', 'aldi', 'publix', 'costco', 'walmart neighborhood'], categoryHints: ['groceries', 'grocery'] },
  { patterns: ['shell', 'chevron', 'bp ', 'exxon', 'mobil', 'arco', '76 ', 'gas station'], categoryHints: ['gas', 'fuel', 'transportation'] },
  { patterns: ['starbucks', 'coffee'], categoryHints: ['coffee', 'fun', 'eating out'] },
  { patterns: ['uber', 'lyft'], categoryHints: ['transportation', 'rideshare'] },
  { patterns: ['netflix', 'spotify', 'hulu', 'disney+', 'apple.com/bill', 'subscription'], categoryHints: ['subscription', 'subscriptions'] },
  { patterns: ['amazon', 'amzn'], categoryHints: ['amazon', 'household', 'shopping'] },
  { patterns: ['daycare', 'preschool', 'childcare'], categoryHints: ['daycare', 'childcare'] },
  { patterns: ['mortgage'], categoryHints: ['mortgage'] },
  { patterns: ['rent payment'], categoryHints: ['rent'] },
  { patterns: ['electric', 'pge', 'ppl', 'duke energy'], categoryHints: ['electric', 'utilities'] },
  { patterns: ['water'], categoryHints: ['water', 'utilities'] },
  { patterns: ['internet', 'comcast', 'xfinity', 'verizon fios', 'spectrum'], categoryHints: ['internet', 'utilities'] },
  { patterns: ['t-mobile', 'att wireless', 'verizon wireless'], categoryHints: ['phone', 'cell'] },
];

function findKeywordCategory(
  payeeName: string | null,
  importPayeeName: string | null,
  memo: string | null,
  index: CategoryNameIndex
): CoachCategory | null {
  const haystack = [payeeName, importPayeeName, memo]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!haystack) return null;
  for (const rule of KEYWORD_TO_CATEGORY_HINTS) {
    if (rule.patterns.some((p) => haystack.includes(p))) {
      for (const hint of rule.categoryHints) {
        for (const [name, cats] of index.byNormalizedName.entries()) {
          if (name.includes(hint) && cats.length > 0) {
            return cats[0];
          }
        }
      }
    }
  }
  return null;
}

export async function suggestTransactionCategories(
  reader: YnabCoachReader,
  opts: SuggestCategoriesOptions
): Promise<CategorizationSuggestionsResult> {
  const since = opts.sinceDate ?? defaultSince();
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_SUGGEST_LIMIT, 200));
  const [transactions, groups] = await Promise.all([
    reader.getTransactions(opts.budgetId, since),
    reader.getCategories(opts.budgetId),
  ]);

  const eligible = transactions.filter(isCategorizable);
  const idIndex = buildCategoryIndex(groups);

  // History uses the full slice we have available.
  const history = buildPayeeHistory(eligible);

  const targetIds = new Set(opts.transactionIds ?? []);
  const candidates = eligible
    .filter((t) => {
      if (targetIds.size > 0) return targetIds.has(t.id);
      return !t.category_id || !t.approved;
    })
    .filter((t) => t.amount !== 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);

  const suggestions: TransactionSuggestion[] = candidates.map((tx) => {
    const hist =
      (tx.payee_id ? history.by_payee_id.get(tx.payee_id) : undefined) ??
      history.by_payee_name.get(
        (tx.payee_name ?? tx.import_payee_name ?? '').toLowerCase().trim()
      ) ??
      null;

    const ranked = hist
      ? [...hist.values()].sort(
          (a, b) =>
            b.occurrences - a.occurrences ||
            b.last_seen_date.localeCompare(a.last_seen_date)
        )
      : [];

    const top = ranked[0];
    const totalSeen = ranked.reduce((s, e) => s + e.occurrences, 0);

    let suggestion: SuggestedCategory;
    let evidenceNotes: string[] = [];
    let payeeMatch: string | null = null;
    let payeeDefaultCatId: string | null = null;
    let payeeDefaultCatName: string | null = null;
    let priorExamples: SuggestionEvidenceExample[] = [];

    if (top && top.occurrences >= 2 && top.occurrences / Math.max(1, totalSeen) >= 0.6) {
      suggestion = {
        category_id: top.category_id,
        category_name: top.category_name,
        confidence: 'high',
        rationale: `Repeated payee/category pattern: ${top.occurrences}/${totalSeen} prior approved transactions used this category.`,
      };
      payeeMatch = tx.payee_id ? `payee_id:${tx.payee_id}` : `payee_name:${tx.payee_name ?? tx.import_payee_name}`;
      payeeDefaultCatId = top.category_id;
      payeeDefaultCatName = top.category_name;
      priorExamples = top.examples;
    } else if (top) {
      suggestion = {
        category_id: top.category_id,
        category_name: top.category_name,
        confidence: 'medium',
        rationale: `Most-recent prior categorization for this payee, but pattern is not yet repeated; verify before applying.`,
      };
      payeeMatch = tx.payee_id ? `payee_id:${tx.payee_id}` : `payee_name:${tx.payee_name ?? tx.import_payee_name}`;
      payeeDefaultCatId = top.category_id;
      payeeDefaultCatName = top.category_name;
      priorExamples = top.examples;
    } else {
      const keywordHit = findKeywordCategory(
        tx.payee_name,
        tx.import_payee_name,
        tx.memo,
        idIndex
      );
      if (keywordHit) {
        suggestion = {
          category_id: keywordHit.id,
          category_name: keywordHit.name,
          confidence: 'medium',
          rationale: `No prior history; matched payee/import name to a known category by keyword.`,
        };
      } else {
        suggestion = {
          category_id: null,
          category_name: null,
          confidence: 'low',
          rationale: `No prior history and no keyword match. Needs human judgment — possible travel/family/business overlap.`,
        };
        evidenceNotes.push('Ambiguous merchant; consider receipt evidence.');
      }
    }

    const alternatives: SuggestedCategory[] = ranked
      .slice(1, 4)
      .map((entry) => ({
        category_id: entry.category_id,
        category_name: entry.category_name,
        confidence:
          entry.occurrences >= 2 ? 'medium' : ('low' as 'medium' | 'low'),
        rationale: `Seen ${entry.occurrences} time${entry.occurrences === 1 ? '' : 's'} for this payee (last on ${entry.last_seen_date}).`,
      }));

    return {
      transaction_id: tx.id,
      date: tx.date,
      amount_dollars: milliunitsToDollars(tx.amount),
      amount_formatted: formatCurrency(tx.amount),
      payee_id: tx.payee_id,
      payee_name: tx.payee_name,
      current_category_id: tx.category_id,
      current_category_name: tx.category_name,
      suggestion,
      alternatives,
      evidence: {
        payee_match: payeeMatch,
        prior_examples: priorExamples,
        payee_default_category_id: payeeDefaultCatId,
        payee_default_category_name: payeeDefaultCatName,
        notes: evidenceNotes,
      },
    };
  });

  const high = suggestions.filter((s) => s.suggestion.confidence === 'high').length;
  const medium = suggestions.filter((s) => s.suggestion.confidence === 'medium').length;
  const low = suggestions.filter((s) => s.suggestion.confidence === 'low').length;

  const notes: string[] = [
    'Suggestions only — categories are not applied. Approval required before any future write.',
  ];

  return {
    budget_id: opts.budgetId,
    since_date: since,
    considered: suggestions.length,
    with_high_confidence: high,
    with_medium_confidence: medium,
    with_low_confidence: low,
    suggestions,
    notes,
  };
}
