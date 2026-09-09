import { formatCurrency, milliunitsToDollars } from '../utils/milliunits.js';
import {
  buildGroupIndex,
  classifyCategory,
  type CategoryJob,
} from './category-jobs.js';
import type {
  CoachCategory,
  CoachCategoryGroup,
  CoachMonth,
  CoachScheduledTransaction,
  YnabCoachReader,
} from './reader.js';

export interface PlanningCategoryView {
  category_id: string;
  category_name: string;
  category_group_id: string;
  category_group_name: string | null;
  job: CategoryJob;
  budgeted_dollars: number;
  budgeted_formatted: string;
  activity_dollars: number;
  activity_formatted: string;
  balance_dollars: number;
  balance_formatted: string;
  goal_type: string | null;
  goal_target_dollars: number | null;
  goal_under_funded_dollars: number | null;
  goal_overall_left_dollars: number | null;
  goal_target_month: string | null;
  is_overspent: boolean;
  is_underfunded: boolean;
}

export interface FundingSourceCandidate {
  category_id: string;
  category_name: string;
  category_group_name: string | null;
  job: CategoryJob;
  available_dollars: number;
  available_formatted: string;
  reason: string;
}

export interface UpcomingObligation {
  scheduled_id: string;
  date_next: string;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  amount_dollars: number;
  amount_formatted: string;
  frequency: string;
}

export interface PlanningSnapshot {
  budget_id: string;
  month: string;
  ready_to_assign_dollars: number;
  ready_to_assign_formatted: string;
  income_dollars: number;
  income_formatted: string;
  budgeted_dollars: number;
  budgeted_formatted: string;
  activity_dollars: number;
  activity_formatted: string;
  age_of_money: number | null;
  totals_by_job: Record<CategoryJob, { count: number; balance_dollars: number }>;
  overspent_categories: PlanningCategoryView[];
  underfunded_categories: PlanningCategoryView[];
  hard_obligations: PlanningCategoryView[];
  everyday_categories: PlanningCategoryView[];
  true_expenses: PlanningCategoryView[];
  savings_goals: PlanningCategoryView[];
  discretionary_categories: PlanningCategoryView[];
  credit_card_payment_categories: PlanningCategoryView[];
  funding_source_candidates: FundingSourceCandidate[];
  upcoming_obligations: UpcomingObligation[];
  planning_priorities: string[];
  notes: string[];
}

export interface MonthHelpReason {
  kind:
    | 'ready_to_assign'
    | 'overspent_categories'
    | 'underfunded_targets'
    | 'previous_month_overspending'
    | 'credit_card_payment_issues';
  detail: string;
  count?: number;
  amount_dollars?: number;
}

export interface MonthHelpEntry {
  month: string;
  needs_help: boolean;
  ready_to_assign_dollars: number;
  ready_to_assign_formatted: string;
  overspent_count: number;
  underfunded_count: number;
  reasons: MonthHelpReason[];
}

export interface MonthsNeedingHelp {
  budget_id: string;
  evaluated_months: string[];
  entries: MonthHelpEntry[];
}

export interface OverspendingExplanation {
  budget_id: string;
  month: string;
  total_overspent_dollars: number;
  total_overspent_formatted: string;
  categories: Array<{
    category: PlanningCategoryView;
    likely_funding_sources: FundingSourceCandidate[];
    plain_language: string;
  }>;
  notes: string[];
}

export interface PlanningSnapshotOptions {
  budgetId: string;
  month?: string;
}

export interface FindMonthsNeedingHelpOptions {
  budgetId: string;
  monthsBack?: number;
  asOfMonth?: string;
}

export interface ExplainOverspendingOptions {
  budgetId: string;
  month?: string;
  categoryId?: string;
}

const DEFAULT_MONTHS_BACK = 2;

function toMonthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

function todayMonthKey(): string {
  return toMonthKey(new Date());
}

function monthKeyToFirstOfMonth(monthKey: string): string {
  if (/^\d{4}-\d{2}$/.test(monthKey)) {
    return `${monthKey}-01`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(monthKey)) {
    return `${monthKey.slice(0, 7)}-01`;
  }
  throw new Error(`Invalid month "${monthKey}"; expected YYYY-MM or YYYY-MM-DD`);
}

function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m - 1) + delta, 1));
  return toMonthKey(date);
}

function viewCategory(
  cat: CoachCategory,
  group: CoachCategoryGroup | null
): PlanningCategoryView {
  const job = classifyCategory(cat, group);
  const balance = cat.balance ?? 0;
  const underFunded = cat.goal_under_funded ?? 0;
  return {
    category_id: cat.id,
    category_name: cat.name,
    category_group_id: cat.category_group_id,
    category_group_name: group?.name ?? cat.category_group_name ?? null,
    job,
    budgeted_dollars: milliunitsToDollars(cat.budgeted ?? 0),
    budgeted_formatted: formatCurrency(cat.budgeted ?? 0),
    activity_dollars: milliunitsToDollars(cat.activity ?? 0),
    activity_formatted: formatCurrency(cat.activity ?? 0),
    balance_dollars: milliunitsToDollars(balance),
    balance_formatted: formatCurrency(balance),
    goal_type: cat.goal_type ?? null,
    goal_target_dollars:
      cat.goal_target != null ? milliunitsToDollars(cat.goal_target) : null,
    goal_under_funded_dollars:
      cat.goal_under_funded != null ? milliunitsToDollars(cat.goal_under_funded) : null,
    goal_overall_left_dollars:
      cat.goal_overall_left != null ? milliunitsToDollars(cat.goal_overall_left) : null,
    goal_target_month: cat.goal_target_month ?? null,
    is_overspent: balance < 0,
    is_underfunded: !!cat.goal_type && underFunded > 0,
  };
}

function pickFundingCandidates(
  views: PlanningCategoryView[],
  groups: CoachCategoryGroup[]
): FundingSourceCandidate[] {
  const groupIdx = buildGroupIndex(groups);
  const result: FundingSourceCandidate[] = [];

  for (const v of views) {
    if (v.balance_dollars <= 0) continue;
    if (v.job === 'inflow' || v.job === 'credit_card_payment') continue;

    let reason: string;
    if (v.job === 'discretionary') {
      reason = 'Discretionary balance available; lowest-friction reassignment.';
    } else if (v.job === 'true_expense') {
      const isCloseGoal = v.goal_target_month
        ? v.goal_target_month.slice(0, 7) <= todayMonthKey()
        : false;
      if (isCloseGoal) continue;
      reason = 'Sinking fund balance available; pulling here delays a future expense.';
    } else if (v.job === 'savings_goal') {
      reason = 'Savings/goal balance available; only justified for real shortfalls.';
    } else if (v.job === 'everyday') {
      reason = 'Everyday balance available; expect to refund before period ends.';
    } else if (v.job === 'hard_obligation') {
      // Hard obligations should not be treated as funding sources unless they are clearly over-funded.
      const group = groupIdx.get(v.category_group_id) ?? null;
      const cat = group?.categories.find((c) => c.id === v.category_id);
      const target = cat?.goal_target ?? 0;
      const balanceMu = (cat?.balance ?? 0);
      if (target > 0 && balanceMu > target * 1.1) {
        reason = 'Hard obligation appears over-funded for the month.';
      } else {
        continue;
      }
    } else {
      reason = 'Available balance; review fit before pulling.';
    }

    result.push({
      category_id: v.category_id,
      category_name: v.category_name,
      category_group_name: v.category_group_name,
      job: v.job,
      available_dollars: v.balance_dollars,
      available_formatted: v.balance_formatted,
      reason,
    });
  }

  result.sort((a, b) => {
    const order: CategoryJob[] = [
      'discretionary',
      'everyday',
      'true_expense',
      'savings_goal',
      'hard_obligation',
      'unknown',
      'credit_card_payment',
      'inflow',
    ];
    const ai = order.indexOf(a.job);
    const bi = order.indexOf(b.job);
    if (ai !== bi) return ai - bi;
    return b.available_dollars - a.available_dollars;
  });

  return result;
}

function pickUpcomingObligations(
  scheduled: CoachScheduledTransaction[],
  asOfMonth: string
): UpcomingObligation[] {
  const start = monthKeyToFirstOfMonth(asOfMonth);
  const endMonth = shiftMonth(asOfMonth, 1);
  const end = monthKeyToFirstOfMonth(endMonth);

  return scheduled
    .filter((s) => !s.deleted && !s.transfer_account_id)
    .filter((s) => s.date_next >= start && s.date_next < end)
    .filter((s) => s.amount < 0)
    .sort((a, b) => a.date_next.localeCompare(b.date_next))
    .map((s) => ({
      scheduled_id: s.id,
      date_next: s.date_next,
      payee_name: s.payee_name,
      category_id: s.category_id,
      category_name: s.category_name,
      amount_dollars: milliunitsToDollars(s.amount),
      amount_formatted: formatCurrency(s.amount),
      frequency: s.frequency,
    }));
}

function buildJobTotals(
  views: PlanningCategoryView[]
): Record<CategoryJob, { count: number; balance_dollars: number }> {
  const result: Record<CategoryJob, { count: number; balance_dollars: number }> = {
    hard_obligation: { count: 0, balance_dollars: 0 },
    everyday: { count: 0, balance_dollars: 0 },
    true_expense: { count: 0, balance_dollars: 0 },
    savings_goal: { count: 0, balance_dollars: 0 },
    discretionary: { count: 0, balance_dollars: 0 },
    credit_card_payment: { count: 0, balance_dollars: 0 },
    inflow: { count: 0, balance_dollars: 0 },
    unknown: { count: 0, balance_dollars: 0 },
  };
  for (const v of views) {
    const slot = result[v.job];
    slot.count += 1;
    slot.balance_dollars =
      Math.round((slot.balance_dollars + v.balance_dollars) * 100) / 100;
  }
  return result;
}

function planningPriorities(
  views: PlanningCategoryView[],
  ready: number
): string[] {
  const priorities: string[] = [];
  const overspent = views.filter((v) => v.is_overspent);
  const underfundedHard = views.filter(
    (v) => v.job === 'hard_obligation' && v.is_underfunded
  );
  const underfundedTrue = views.filter(
    (v) => v.job === 'true_expense' && v.is_underfunded
  );
  const underfundedSavings = views.filter(
    (v) => v.job === 'savings_goal' && v.is_underfunded
  );

  if (overspent.length > 0) {
    priorities.push(
      `Cover overspending in ${overspent.length} categor${overspent.length === 1 ? 'y' : 'ies'} first.`
    );
  }
  if (underfundedHard.length > 0) {
    priorities.push(
      `Fund hard obligations not yet on target (${underfundedHard.length}).`
    );
  }
  if (underfundedTrue.length > 0) {
    priorities.push(
      `Fund true expenses / sinking funds (${underfundedTrue.length}).`
    );
  }
  if (underfundedSavings.length > 0) {
    priorities.push(
      `Fund savings goals (${underfundedSavings.length}).`
    );
  }
  if (ready > 0) {
    priorities.push(
      `Decide a job for the remaining ${formatCurrency(Math.round(ready * 1000))} Ready to Assign.`
    );
  } else if (ready < 0) {
    priorities.push(
      `Ready to Assign is negative (${formatCurrency(Math.round(ready * 1000))}); reduce assignments before adding new spending plans.`
    );
  }
  return priorities;
}

export async function getBudgetPlanningSnapshot(
  reader: YnabCoachReader,
  opts: PlanningSnapshotOptions
): Promise<PlanningSnapshot> {
  const month = opts.month ?? todayMonthKey();
  const monthDay = monthKeyToFirstOfMonth(month);
  const [monthDetail, groups, scheduled] = await Promise.all([
    reader.getBudgetMonth(opts.budgetId, monthDay),
    reader.getCategories(opts.budgetId),
    reader.getScheduledTransactions(opts.budgetId),
  ]);

  const groupById = buildGroupIndex(groups);
  const views: PlanningCategoryView[] = monthDetail.categories
    .filter((c) => !c.hidden && !c.deleted)
    .map((c) => viewCategory(c, groupById.get(c.category_group_id) ?? null));

  const overspent = views.filter((v) => v.is_overspent && v.job !== 'inflow');
  const underfunded = views.filter((v) => v.is_underfunded);
  const hardObs = views.filter((v) => v.job === 'hard_obligation');
  const everyday = views.filter((v) => v.job === 'everyday');
  const trueExp = views.filter((v) => v.job === 'true_expense');
  const savings = views.filter((v) => v.job === 'savings_goal');
  const discretionary = views.filter((v) => v.job === 'discretionary');
  const ccPayment = views.filter((v) => v.job === 'credit_card_payment');

  const fundingCandidates = pickFundingCandidates(views, groups);
  const upcoming = pickUpcomingObligations(scheduled, month);

  const ready = milliunitsToDollars(monthDetail.to_be_budgeted);
  const priorities = planningPriorities(views, ready);

  const notes: string[] = [
    'Read-only planning view. No assignments are made; explicit approval required for any move.',
  ];
  const ccOverspent = ccPayment.filter((v) => v.is_overspent);
  if (ccOverspent.length > 0) {
    notes.push(
      `Credit card payment categor${ccOverspent.length === 1 ? 'y is' : 'ies are'} negative; treat as cash-flow timing rather than overspend, but plan to fund.`
    );
  }
  const unknownCount = views.filter((v) => v.job === 'unknown').length;
  if (unknownCount > 0) {
    notes.push(
      `${unknownCount} categor${unknownCount === 1 ? 'y' : 'ies'} did not match a job heuristic; classification is best-effort.`
    );
  }

  return {
    budget_id: opts.budgetId,
    month,
    ready_to_assign_dollars: ready,
    ready_to_assign_formatted: formatCurrency(monthDetail.to_be_budgeted),
    income_dollars: milliunitsToDollars(monthDetail.income),
    income_formatted: formatCurrency(monthDetail.income),
    budgeted_dollars: milliunitsToDollars(monthDetail.budgeted),
    budgeted_formatted: formatCurrency(monthDetail.budgeted),
    activity_dollars: milliunitsToDollars(monthDetail.activity),
    activity_formatted: formatCurrency(monthDetail.activity),
    age_of_money: monthDetail.age_of_money ?? null,
    totals_by_job: buildJobTotals(views),
    overspent_categories: overspent,
    underfunded_categories: underfunded,
    hard_obligations: hardObs,
    everyday_categories: everyday,
    true_expenses: trueExp,
    savings_goals: savings,
    discretionary_categories: discretionary,
    credit_card_payment_categories: ccPayment,
    funding_source_candidates: fundingCandidates,
    upcoming_obligations: upcoming,
    planning_priorities: priorities,
    notes,
  };
}

export async function findMonthsNeedingBudgetHelp(
  reader: YnabCoachReader,
  opts: FindMonthsNeedingHelpOptions
): Promise<MonthsNeedingHelp> {
  const monthsBack = opts.monthsBack ?? DEFAULT_MONTHS_BACK;
  const start = opts.asOfMonth ?? todayMonthKey();
  const months: string[] = [];
  for (let i = 0; i <= monthsBack; i++) {
    months.push(shiftMonth(start, -i));
  }
  months.reverse();

  const groups = await reader.getCategories(opts.budgetId);
  const groupIdx = buildGroupIndex(groups);

  const monthDetails = await Promise.all(
    months.map((m) => reader.getBudgetMonth(opts.budgetId, monthKeyToFirstOfMonth(m)))
  );

  const entries: MonthHelpEntry[] = monthDetails.map((md, i) => {
    const monthKey = months[i];
    const views: PlanningCategoryView[] = md.categories
      .filter((c) => !c.hidden && !c.deleted)
      .map((c) => viewCategory(c, groupIdx.get(c.category_group_id) ?? null));

    const overspent = views.filter((v) => v.is_overspent && v.job !== 'inflow');
    const underfunded = views.filter((v) => v.is_underfunded);
    const ccIssues = views.filter(
      (v) => v.job === 'credit_card_payment' && v.is_overspent
    );

    const reasons: MonthHelpReason[] = [];
    const isCurrentMonth = i === monthDetails.length - 1;
    const ready = milliunitsToDollars(md.to_be_budgeted);
    if (isCurrentMonth && ready > 0) {
      reasons.push({
        kind: 'ready_to_assign',
        detail: `Ready to Assign is ${formatCurrency(md.to_be_budgeted)}; allocate every dollar before month-end.`,
        amount_dollars: ready,
      });
    }
    if (overspent.length > 0) {
      reasons.push({
        kind: 'overspent_categories',
        detail: `${overspent.length} categor${overspent.length === 1 ? 'y is' : 'ies are'} overspent.`,
        count: overspent.length,
      });
    }
    if (underfunded.length > 0 && isCurrentMonth) {
      reasons.push({
        kind: 'underfunded_targets',
        detail: `${underfunded.length} categor${underfunded.length === 1 ? 'y has' : 'ies have'} underfunded targets.`,
        count: underfunded.length,
      });
    }
    if (ccIssues.length > 0) {
      reasons.push({
        kind: 'credit_card_payment_issues',
        detail: `${ccIssues.length} credit card payment categor${ccIssues.length === 1 ? 'y is' : 'ies are'} negative; verify cash-flow timing vs. real shortfall.`,
        count: ccIssues.length,
      });
    }

    return {
      month: monthKey,
      needs_help: reasons.length > 0,
      ready_to_assign_dollars: ready,
      ready_to_assign_formatted: formatCurrency(md.to_be_budgeted),
      overspent_count: overspent.length,
      underfunded_count: underfunded.length,
      reasons,
    };
  });

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];
    if (prev.overspent_count > 0) {
      curr.reasons.push({
        kind: 'previous_month_overspending',
        detail: `Previous month (${prev.month}) had ${prev.overspent_count} overspent categor${prev.overspent_count === 1 ? 'y' : 'ies'}; carryover may still need handling.`,
        count: prev.overspent_count,
      });
      curr.needs_help = true;
    }
  }

  return {
    budget_id: opts.budgetId,
    evaluated_months: months,
    entries,
  };
}

export async function explainOverspending(
  reader: YnabCoachReader,
  opts: ExplainOverspendingOptions
): Promise<OverspendingExplanation> {
  const month = opts.month ?? todayMonthKey();
  const snapshot = await getBudgetPlanningSnapshot(reader, {
    budgetId: opts.budgetId,
    month,
  });

  let overspent = snapshot.overspent_categories;
  if (opts.categoryId) {
    overspent = overspent.filter((v) => v.category_id === opts.categoryId);
    if (overspent.length === 0) {
      return {
        budget_id: opts.budgetId,
        month,
        total_overspent_dollars: 0,
        total_overspent_formatted: formatCurrency(0),
        categories: [],
        notes: [
          `No overspending found for category ${opts.categoryId} in ${month}; nothing to explain.`,
        ],
      };
    }
  }

  const totalOverspentDollars = overspent.reduce(
    (sum, v) => sum + Math.min(0, v.balance_dollars),
    0
  );

  const categories = overspent.map((cat) => {
    const candidates = snapshot.funding_source_candidates
      .filter((c) => c.category_id !== cat.category_id)
      .filter((c) => c.available_dollars >= Math.abs(cat.balance_dollars) * 0.25)
      .slice(0, 5);

    const plain = renderPlainLanguage(cat, candidates);
    return { category: cat, likely_funding_sources: candidates, plain_language: plain };
  });

  const notes: string[] = [
    'Suggestions only — no money is moved. Approve specific transfers before any change.',
  ];
  if (snapshot.credit_card_payment_categories.some((v) => v.is_overspent)) {
    notes.push(
      'Negative credit card payment categories often reflect timing (charges posted before assignments) rather than real overspending.'
    );
  }

  return {
    budget_id: opts.budgetId,
    month,
    total_overspent_dollars: totalOverspentDollars,
    total_overspent_formatted: formatCurrency(Math.round(totalOverspentDollars * 1000)),
    categories,
    notes,
  };
}

function renderPlainLanguage(
  cat: PlanningCategoryView,
  sources: FundingSourceCandidate[]
): string {
  const shortName = cat.category_name;
  const shortfall = formatCurrency(Math.round(Math.abs(cat.balance_dollars) * 1000));
  if (sources.length === 0) {
    return `${shortName} is overspent by ${shortfall}. No clear funding source matches; consider reducing other plans or accepting the overspend until next income.`;
  }
  const top = sources.slice(0, 2).map((s) => `${s.category_name} (${s.available_formatted})`);
  return `${shortName} is overspent by ${shortfall}. To cover it, likely pull from ${top.join(' or ')}.`;
}
