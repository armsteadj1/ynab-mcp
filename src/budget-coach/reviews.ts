import { formatCurrency, milliunitsToDollars } from '../utils/milliunits.js';
import {
  buildGroupIndex,
  classifyCategory,
  type CategoryJob,
} from './category-jobs.js';
import {
  getBudgetPlanningSnapshot,
  type PlanningCategoryView,
} from './planning.js';
import type {
  CoachTransaction,
  YnabCoachReader,
} from './reader.js';

export interface InboxHealth {
  uncategorized_count: number;
  unapproved_count: number;
  flagged_count: number;
  stale_over_7_days_count: number;
}

export interface NotableTransaction {
  id: string;
  date: string;
  amount_dollars: number;
  amount_formatted: string;
  payee_name: string | null;
  category_name: string | null;
  reason: string;
}

export interface NewRecurringObservation {
  payee_name: string | null;
  occurrences: number;
  total_amount_dollars: number;
  total_amount_formatted: string;
  last_date: string;
  example_transaction_ids: string[];
}

export interface NextAction {
  kind:
    | 'approve_categorization_batch'
    | 'decide_assignment_plan'
    | 'reconcile_account'
    | 'review_categorization_low_confidence'
    | 'fund_underfunded_targets'
    | 'cover_overspending';
  detail: string;
  count?: number;
  amount_dollars?: number;
}

export interface WeeklyBudgetReview {
  budget_id: string;
  period_start: string;
  period_end: string;
  inbox_health: InboxHealth;
  overspending: {
    overspent_categories: PlanningCategoryView[];
    suggested_funding_sources: PlanningCategoryView[];
  };
  cash_assignment: {
    ready_to_assign_dollars: number;
    ready_to_assign_formatted: string;
    underfunded_hard_obligations: PlanningCategoryView[];
    near_term_runout_categories: PlanningCategoryView[];
  };
  notable_spending: {
    large_transactions: NotableTransaction[];
    unusual_payees: NotableTransaction[];
    new_recurring: NewRecurringObservation[];
  };
  next_actions: NextAction[];
  notes: string[];
}

export interface MonthCloseReadiness {
  all_transactions_approved: boolean;
  unapproved_count: number;
  uncategorized_count: number;
  any_overspent: boolean;
  overspent_count: number;
}

export interface BudgetPerformance {
  income_dollars: number;
  income_formatted: string;
  spending_dollars: number;
  spending_formatted: string;
  net_dollars: number;
  net_formatted: string;
  top_category_deltas: Array<{
    category_id: string;
    category_name: string;
    budgeted_dollars: number;
    activity_dollars: number;
    delta_dollars: number;
    delta_formatted: string;
  }>;
}

export interface TrueExpenseBreakdown {
  funds_below_target: PlanningCategoryView[];
  recently_used_sinking_funds: Array<{
    category_id: string;
    category_name: string;
    activity_dollars: number;
    activity_formatted: string;
  }>;
}

export interface NextMonthPlan {
  suggested_priorities: string[];
  questions_for_humans: string[];
}

export interface MonthlyBudgetReview {
  budget_id: string;
  month: string;
  period_start: string;
  period_end: string;
  month_close_readiness: MonthCloseReadiness;
  budget_performance: BudgetPerformance;
  true_expenses: TrueExpenseBreakdown;
  family_narrative_inputs: Array<{
    title: string;
    detail: string;
    transactions: NotableTransaction[];
  }>;
  next_month_plan: NextMonthPlan;
  notes: string[];
}

const LARGE_TX_DOLLARS_DEFAULT = 250;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0));
  return last.toISOString().slice(0, 10);
}

function firstDayOfMonth(monthKey: string): string {
  return `${monthKey}-01`;
}

function todayMonthKey(): string {
  return todayIso().slice(0, 7);
}

function isCategorizable(tx: CoachTransaction): boolean {
  if (tx.deleted) return false;
  if (tx.transfer_account_id) return false;
  return true;
}

function inboxHealth(transactions: CoachTransaction[], asOf: string): InboxHealth {
  let uncategorized = 0;
  let unapproved = 0;
  let flagged = 0;
  let stale = 0;
  const todayMs = new Date(`${asOf}T00:00:00Z`).getTime();

  for (const tx of transactions) {
    if (!isCategorizable(tx)) continue;
    if (!tx.category_id) uncategorized += 1;
    if (!tx.approved) unapproved += 1;
    if (tx.flag_color) flagged += 1;
    if (!tx.category_id || !tx.approved) {
      const ms = new Date(`${tx.date}T00:00:00Z`).getTime();
      if (todayMs - ms > 7 * 24 * 60 * 60 * 1000) stale += 1;
    }
  }
  return {
    uncategorized_count: uncategorized,
    unapproved_count: unapproved,
    flagged_count: flagged,
    stale_over_7_days_count: stale,
  };
}

function transactionsInRange(
  transactions: CoachTransaction[],
  start: string,
  end: string
): CoachTransaction[] {
  return transactions.filter(
    (t) => isCategorizable(t) && t.date >= start && t.date <= end
  );
}

function notableLargeTransactions(
  transactions: CoachTransaction[],
  thresholdDollars: number
): NotableTransaction[] {
  const threshold = thresholdDollars * 1000;
  return transactions
    .filter((t) => t.amount < 0 && Math.abs(t.amount) >= threshold)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 10)
    .map((t) => ({
      id: t.id,
      date: t.date,
      amount_dollars: milliunitsToDollars(t.amount),
      amount_formatted: formatCurrency(t.amount),
      payee_name: t.payee_name,
      category_name: t.category_name,
      reason: `Large transaction (>= ${formatCurrency(threshold)})`,
    }));
}

function unusualPayees(
  recent: CoachTransaction[],
  baseline: CoachTransaction[]
): NotableTransaction[] {
  const baselinePayees = new Set<string>();
  for (const t of baseline) {
    const key = (t.payee_id ?? `name:${(t.payee_name ?? '').toLowerCase()}`).trim();
    if (key) baselinePayees.add(key);
  }
  return recent
    .filter((t) => t.amount < 0)
    .filter((t) => {
      const key = (t.payee_id ?? `name:${(t.payee_name ?? '').toLowerCase()}`).trim();
      return key && !baselinePayees.has(key);
    })
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 5)
    .map((t) => ({
      id: t.id,
      date: t.date,
      amount_dollars: milliunitsToDollars(t.amount),
      amount_formatted: formatCurrency(t.amount),
      payee_name: t.payee_name,
      category_name: t.category_name,
      reason: 'Payee not seen in prior 60 days',
    }));
}

function newRecurringObservations(
  recent: CoachTransaction[]
): NewRecurringObservation[] {
  const buckets = new Map<string, CoachTransaction[]>();
  for (const t of recent) {
    if (t.amount >= 0) continue;
    const key = (t.payee_id ?? `name:${(t.payee_name ?? '').toLowerCase()}`).trim();
    if (!key) continue;
    const arr = buckets.get(key) ?? [];
    arr.push(t);
    buckets.set(key, arr);
  }
  const observations: NewRecurringObservation[] = [];
  for (const [, txs] of buckets) {
    if (txs.length < 2) continue;
    const sameAmount = txs.every((t) => Math.abs(t.amount - txs[0].amount) <= 100);
    if (!sameAmount) continue;
    txs.sort((a, b) => b.date.localeCompare(a.date));
    const total = txs.reduce((s, t) => s + t.amount, 0);
    observations.push({
      payee_name: txs[0].payee_name ?? null,
      occurrences: txs.length,
      total_amount_dollars: milliunitsToDollars(total),
      total_amount_formatted: formatCurrency(total),
      last_date: txs[0].date,
      example_transaction_ids: txs.slice(0, 3).map((t) => t.id),
    });
  }
  return observations.sort((a, b) => b.occurrences - a.occurrences).slice(0, 5);
}

function nearTermRunoutCategories(
  views: PlanningCategoryView[]
): PlanningCategoryView[] {
  return views
    .filter(
      (v) =>
        (v.job === 'everyday' || v.job === 'hard_obligation') &&
        v.balance_dollars > 0 &&
        v.activity_dollars < 0 &&
        Math.abs(v.activity_dollars) > 0 &&
        v.balance_dollars < Math.abs(v.activity_dollars) * 0.25
    )
    .sort((a, b) => a.balance_dollars - b.balance_dollars)
    .slice(0, 8);
}

export interface WeeklyReviewOptions {
  budgetId: string;
  endDate?: string;
  largeTxDollars?: number;
}

export async function getWeeklyBudgetReview(
  reader: YnabCoachReader,
  opts: WeeklyReviewOptions
): Promise<WeeklyBudgetReview> {
  const end = opts.endDate ?? todayIso();
  const start = addDays(end, -6);
  const baselineStart = addDays(end, -67);
  const threshold = opts.largeTxDollars ?? LARGE_TX_DOLLARS_DEFAULT;

  const [snapshot, transactions] = await Promise.all([
    getBudgetPlanningSnapshot(reader, {
      budgetId: opts.budgetId,
      month: end.slice(0, 7),
    }),
    reader.getTransactions(opts.budgetId, baselineStart),
  ]);

  const recent = transactionsInRange(transactions, start, end);
  const baseline = transactions.filter(
    (t) => isCategorizable(t) && t.date >= baselineStart && t.date < start
  );

  const inbox = inboxHealth(transactions, end);
  const large = notableLargeTransactions(recent, threshold);
  const unusual = unusualPayees(recent, baseline);
  const recurring = newRecurringObservations(recent);

  const overspent = snapshot.overspent_categories;
  const fundingSources = snapshot.funding_source_candidates
    .slice(0, 5)
    .map((c) => {
      const view: PlanningCategoryView | undefined = [
        ...snapshot.everyday_categories,
        ...snapshot.true_expenses,
        ...snapshot.savings_goals,
        ...snapshot.discretionary_categories,
        ...snapshot.hard_obligations,
        ...snapshot.credit_card_payment_categories,
      ].find((v) => v.category_id === c.category_id);
      return view;
    })
    .filter((v): v is PlanningCategoryView => !!v);

  const underfundedHard = snapshot.hard_obligations.filter((v) => v.is_underfunded);
  const nearRunout = nearTermRunoutCategories([
    ...snapshot.everyday_categories,
    ...snapshot.hard_obligations,
  ]);

  const nextActions: NextAction[] = [];
  if (inbox.uncategorized_count + inbox.unapproved_count > 0) {
    nextActions.push({
      kind: 'approve_categorization_batch',
      detail: `${inbox.uncategorized_count} uncategorized and ${inbox.unapproved_count} unapproved transactions need attention.`,
      count: inbox.uncategorized_count + inbox.unapproved_count,
    });
  }
  if (overspent.length > 0) {
    const total = overspent.reduce((s, v) => s + Math.min(0, v.balance_dollars), 0);
    nextActions.push({
      kind: 'cover_overspending',
      detail: `Cover overspending in ${overspent.length} categor${overspent.length === 1 ? 'y' : 'ies'} (${formatCurrency(Math.round(total * 1000))}).`,
      count: overspent.length,
      amount_dollars: total,
    });
  }
  if (snapshot.ready_to_assign_dollars !== 0) {
    nextActions.push({
      kind: 'decide_assignment_plan',
      detail: `Ready to Assign is ${snapshot.ready_to_assign_formatted}; decide a job for the remainder before month-end.`,
      amount_dollars: snapshot.ready_to_assign_dollars,
    });
  }
  if (underfundedHard.length > 0) {
    nextActions.push({
      kind: 'fund_underfunded_targets',
      detail: `${underfundedHard.length} hard obligation${underfundedHard.length === 1 ? '' : 's'} are underfunded against target.`,
      count: underfundedHard.length,
    });
  }

  const notes: string[] = [
    'Read-only weekly review. Categorizations and assignments still require explicit approval.',
  ];
  if (snapshot.credit_card_payment_categories.some((v) => v.is_overspent)) {
    notes.push(
      'A credit card payment category is negative; treat as cash-flow timing first, real overspend second.'
    );
  }

  return {
    budget_id: opts.budgetId,
    period_start: start,
    period_end: end,
    inbox_health: inbox,
    overspending: {
      overspent_categories: overspent,
      suggested_funding_sources: fundingSources,
    },
    cash_assignment: {
      ready_to_assign_dollars: snapshot.ready_to_assign_dollars,
      ready_to_assign_formatted: snapshot.ready_to_assign_formatted,
      underfunded_hard_obligations: underfundedHard,
      near_term_runout_categories: nearRunout,
    },
    notable_spending: {
      large_transactions: large,
      unusual_payees: unusual,
      new_recurring: recurring,
    },
    next_actions: nextActions,
    notes,
  };
}

export interface MonthlyReviewOptions {
  budgetId: string;
  month?: string;
  largeTxDollars?: number;
}

export async function getMonthlyBudgetReview(
  reader: YnabCoachReader,
  opts: MonthlyReviewOptions
): Promise<MonthlyBudgetReview> {
  const monthKey = opts.month ?? todayMonthKey();
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error(`Invalid month "${monthKey}"; expected YYYY-MM`);
  }
  const start = firstDayOfMonth(monthKey);
  const end = lastDayOfMonth(monthKey);
  const threshold = opts.largeTxDollars ?? LARGE_TX_DOLLARS_DEFAULT;

  const [snapshot, monthDetail, groups, transactions] = await Promise.all([
    getBudgetPlanningSnapshot(reader, { budgetId: opts.budgetId, month: monthKey }),
    reader.getBudgetMonth(opts.budgetId, start),
    reader.getCategories(opts.budgetId),
    reader.getTransactions(opts.budgetId, start),
  ]);

  const inMonth = transactions.filter(
    (t) => isCategorizable(t) && t.date >= start && t.date <= end
  );

  const inbox = inboxHealth(inMonth, end);
  const incomeMu = inMonth.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const spendingMu = inMonth.filter((t) => t.amount < 0).reduce((s, t) => s + -t.amount, 0);

  const groupIdx = buildGroupIndex(groups);
  const categoryDeltas = (monthDetail.categories ?? [])
    .filter((c) => !c.deleted && !c.hidden)
    .map((c) => {
      const job = classifyCategory(c, groupIdx.get(c.category_group_id) ?? null);
      return { c, job };
    })
    .filter(({ job }) => job !== 'inflow')
    .map(({ c }) => ({
      category_id: c.id,
      category_name: c.name,
      budgeted_dollars: milliunitsToDollars(c.budgeted ?? 0),
      activity_dollars: milliunitsToDollars(c.activity ?? 0),
      delta_dollars:
        Math.round((milliunitsToDollars((c.budgeted ?? 0) + (c.activity ?? 0))) * 100) / 100,
      delta_formatted: formatCurrency((c.budgeted ?? 0) + (c.activity ?? 0)),
    }))
    .sort((a, b) => Math.abs(b.delta_dollars) - Math.abs(a.delta_dollars))
    .slice(0, 10);

  const trueExp = snapshot.true_expenses;
  const trueExpFundsBelow = trueExp.filter((v) => v.is_underfunded);
  const trueExpRecentlyUsed = trueExp
    .filter((v) => v.activity_dollars < 0)
    .sort((a, b) => a.activity_dollars - b.activity_dollars)
    .slice(0, 5)
    .map((v) => ({
      category_id: v.category_id,
      category_name: v.category_name,
      activity_dollars: v.activity_dollars,
      activity_formatted: v.activity_formatted,
    }));

  const overspentCount = snapshot.overspent_categories.length;
  const closeReadiness: MonthCloseReadiness = {
    all_transactions_approved: inbox.unapproved_count === 0 && inbox.uncategorized_count === 0,
    unapproved_count: inbox.unapproved_count,
    uncategorized_count: inbox.uncategorized_count,
    any_overspent: overspentCount > 0,
    overspent_count: overspentCount,
  };

  const large = notableLargeTransactions(inMonth, threshold);
  const familyNarrativeInputs = [
    {
      title: 'Largest transactions',
      detail: 'Use these to anchor the month\'s narrative.',
      transactions: large.slice(0, 5),
    },
  ];

  const nextMonthPlan: NextMonthPlan = buildNextMonthPlan(
    snapshot,
    categoryDeltas,
    trueExpFundsBelow
  );

  const notes: string[] = [
    'Read-only monthly review. No moves are made.',
  ];
  if (inbox.uncategorized_count > 0 || inbox.unapproved_count > 0) {
    notes.push(
      'Month is not fully closed: some transactions remain uncategorized or unapproved.'
    );
  }

  return {
    budget_id: opts.budgetId,
    month: monthKey,
    period_start: start,
    period_end: end,
    month_close_readiness: closeReadiness,
    budget_performance: {
      income_dollars: milliunitsToDollars(incomeMu),
      income_formatted: formatCurrency(incomeMu),
      spending_dollars: milliunitsToDollars(spendingMu),
      spending_formatted: formatCurrency(spendingMu),
      net_dollars: milliunitsToDollars(incomeMu - spendingMu),
      net_formatted: formatCurrency(incomeMu - spendingMu),
      top_category_deltas: categoryDeltas,
    },
    true_expenses: {
      funds_below_target: trueExpFundsBelow,
      recently_used_sinking_funds: trueExpRecentlyUsed,
    },
    family_narrative_inputs: familyNarrativeInputs,
    next_month_plan: nextMonthPlan,
    notes,
  };
}

function buildNextMonthPlan(
  snapshot: Awaited<ReturnType<typeof getBudgetPlanningSnapshot>>,
  deltas: BudgetPerformance['top_category_deltas'],
  trueExpFundsBelow: PlanningCategoryView[]
): NextMonthPlan {
  const priorities: string[] = [];
  if (snapshot.overspent_categories.length > 0) {
    priorities.push(
      `Cover ${snapshot.overspent_categories.length} overspent categor${
        snapshot.overspent_categories.length === 1 ? 'y' : 'ies'
      } before adding new spending plans.`
    );
  }
  const repeatedOverspends = deltas.filter((d) => d.activity_dollars < 0 && Math.abs(d.activity_dollars) > Math.abs(d.budgeted_dollars));
  if (repeatedOverspends.length > 0) {
    priorities.push(
      `Consider raising targets for ${repeatedOverspends
        .slice(0, 3)
        .map((d) => d.category_name)
        .join(', ')} — activity exceeded budgeted.`
    );
  }
  if (trueExpFundsBelow.length > 0) {
    priorities.push(
      `Fund ${trueExpFundsBelow.length} sinking fund${
        trueExpFundsBelow.length === 1 ? '' : 's'
      } below target before they become emergencies.`
    );
  }
  if (snapshot.ready_to_assign_dollars > 0) {
    priorities.push(
      `Decide a job for ${snapshot.ready_to_assign_formatted} of Ready to Assign.`
    );
  }

  const questions: string[] = [];
  if (snapshot.overspent_categories.length > 0) {
    questions.push('Which overspent categories were timing vs. real spending?');
  }
  if (snapshot.savings_goals.some((v) => v.is_underfunded)) {
    questions.push('Are savings goals still on the right pace, or do targets need adjustment?');
  }
  if (snapshot.upcoming_obligations.length > 0) {
    questions.push('Are upcoming scheduled obligations still accurate (amount, payee, frequency)?');
  }

  return {
    suggested_priorities: priorities,
    questions_for_humans: questions,
  };
}

export { type CategoryJob };
