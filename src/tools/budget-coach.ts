import { resolveBudgetId } from '../ynab-client.js';
import { getCoachReader } from '../budget-coach/reader.js';
import {
  getBudgetPlanningSnapshot,
  findMonthsNeedingBudgetHelp,
  explainOverspending,
  type ExplainOverspendingOptions,
  type FindMonthsNeedingHelpOptions,
  type MonthsNeedingHelp,
  type OverspendingExplanation,
  type PlanningSnapshot,
  type PlanningSnapshotOptions,
} from '../budget-coach/planning.js';
import {
  getCategorizationQueue,
  suggestTransactionCategories,
  type CategorizationQueueOptions,
  type CategorizationQueueResult,
  type CategorizationSuggestionsResult,
  type SuggestCategoriesOptions,
} from '../budget-coach/categorization.js';
import {
  createGogEmailEvidenceProvider,
  type EmailEvidenceProvider,
} from '../budget-coach/email-evidence.js';
import {
  getMonthlyBudgetReview,
  getWeeklyBudgetReview,
  type MonthlyBudgetReview,
  type MonthlyReviewOptions,
  type WeeklyBudgetReview,
  type WeeklyReviewOptions,
} from '../budget-coach/reviews.js';

function requireExplicitBudgetId(budgetId?: string): string {
  const resolved = resolveBudgetId(budgetId);
  if (resolved === 'last-used') {
    throw new Error(
      'Budget coach tools require an explicit budget_id (or YNAB_BUDGET_ID env var); the "last-used" alias is not supported here.'
    );
  }
  return resolved;
}

export async function runPlanningSnapshot(
  opts: Partial<PlanningSnapshotOptions> & { budgetId?: string }
): Promise<PlanningSnapshot> {
  const budgetId = requireExplicitBudgetId(opts.budgetId);
  return getBudgetPlanningSnapshot(getCoachReader(), {
    budgetId,
    month: opts.month,
  });
}

export async function runFindMonthsNeedingHelp(
  opts: Partial<FindMonthsNeedingHelpOptions> & { budgetId?: string }
): Promise<MonthsNeedingHelp> {
  const budgetId = requireExplicitBudgetId(opts.budgetId);
  return findMonthsNeedingBudgetHelp(getCoachReader(), {
    budgetId,
    monthsBack: opts.monthsBack,
    asOfMonth: opts.asOfMonth,
  });
}

export async function runExplainOverspending(
  opts: Partial<ExplainOverspendingOptions> & { budgetId?: string }
): Promise<OverspendingExplanation> {
  const budgetId = requireExplicitBudgetId(opts.budgetId);
  return explainOverspending(getCoachReader(), {
    budgetId,
    month: opts.month,
    categoryId: opts.categoryId,
  });
}

export async function runCategorizationQueue(
  opts: Partial<CategorizationQueueOptions> & { budgetId?: string }
): Promise<CategorizationQueueResult> {
  const budgetId = requireExplicitBudgetId(opts.budgetId);
  return getCategorizationQueue(getCoachReader(), {
    budgetId,
    sinceDate: opts.sinceDate,
    limit: opts.limit,
  });
}

export interface RunSuggestCategoriesOptions
  extends Partial<SuggestCategoriesOptions> {
  budgetId?: string;
  emailAccount?: string;
  emailWindowDays?: number;
  emailMaxResults?: number;
  emailTimeoutMs?: number;
}

export async function runSuggestCategories(
  opts: RunSuggestCategoriesOptions
): Promise<CategorizationSuggestionsResult> {
  const budgetId = requireExplicitBudgetId(opts.budgetId);

  let provider: EmailEvidenceProvider | undefined = opts.emailEvidenceProvider;
  if (opts.includeEmailEvidence && !provider) {
    provider = createGogEmailEvidenceProvider({
      account: opts.emailAccount,
      windowDays: opts.emailWindowDays,
      maxResults: opts.emailMaxResults,
      timeoutMs: opts.emailTimeoutMs,
    });
  }

  return suggestTransactionCategories(getCoachReader(), {
    budgetId,
    sinceDate: opts.sinceDate,
    transactionIds: opts.transactionIds,
    limit: opts.limit,
    includeEmailEvidence: opts.includeEmailEvidence,
    emailEvidenceProvider: provider,
    emailEvidenceLimit: opts.emailEvidenceLimit,
  });
}

export async function runWeeklyBudgetReview(
  opts: Partial<WeeklyReviewOptions> & { budgetId?: string }
): Promise<WeeklyBudgetReview> {
  const budgetId = requireExplicitBudgetId(opts.budgetId);
  return getWeeklyBudgetReview(getCoachReader(), {
    budgetId,
    endDate: opts.endDate,
    largeTxDollars: opts.largeTxDollars,
  });
}

export async function runMonthlyBudgetReview(
  opts: Partial<MonthlyReviewOptions> & { budgetId?: string }
): Promise<MonthlyBudgetReview> {
  const budgetId = requireExplicitBudgetId(opts.budgetId);
  return getMonthlyBudgetReview(getCoachReader(), {
    budgetId,
    month: opts.month,
    largeTxDollars: opts.largeTxDollars,
  });
}
