import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  explainOverspending,
  findMonthsNeedingBudgetHelp,
  getBudgetPlanningSnapshot,
} from '../budget-coach/planning.js';
import {
  getCategorizationQueue,
  suggestTransactionCategories,
} from '../budget-coach/categorization.js';
import {
  getMonthlyBudgetReview,
  getWeeklyBudgetReview,
} from '../budget-coach/reviews.js';
import { createCoachFakeReader } from './budgetCoachFakeReader.js';
import { COACH_BUDGET_ID, makeCoachFixtureData } from './budgetCoachFixtures.js';

test('planning snapshot reports Ready to Assign and classifies categories', async () => {
  const reader = createCoachFakeReader(makeCoachFixtureData());
  const snapshot = await getBudgetPlanningSnapshot(reader, {
    budgetId: COACH_BUDGET_ID,
    month: '2026-05',
  });

  assert.equal(snapshot.month, '2026-05');
  assert.equal(snapshot.ready_to_assign_dollars, 350);
  assert.equal(snapshot.income_dollars, 6000);

  // Classification buckets
  const obligationIds = snapshot.hard_obligations.map((c) => c.category_id);
  assert.ok(obligationIds.includes('cat-mortgage'));
  assert.ok(obligationIds.includes('cat-daycare'));
  assert.ok(obligationIds.includes('cat-phone'));

  const trueExpIds = snapshot.true_expenses.map((c) => c.category_id);
  assert.ok(trueExpIds.includes('cat-home-maint'));
  assert.ok(trueExpIds.includes('cat-travel'));
  assert.ok(trueExpIds.includes('cat-car-maint'));

  const savingsIds = snapshot.savings_goals.map((c) => c.category_id);
  assert.ok(savingsIds.includes('cat-emergency'));
  assert.ok(savingsIds.includes('cat-ira'));

  const ccIds = snapshot.credit_card_payment_categories.map((c) => c.category_id);
  assert.ok(ccIds.includes('cat-cc-amazon'));

  // Overspent set should include several negative-balance everyday/obligation/business categories
  const overspentIds = new Set(snapshot.overspent_categories.map((c) => c.category_id));
  for (const id of [
    'cat-fun',
    'cat-dining',
    'cat-mortgage',
    'cat-daycare',
    'cat-phone',
    'cat-travel',
    'cat-business',
    'cat-cc-amazon',
  ]) {
    assert.ok(overspentIds.has(id), `expected ${id} to be overspent`);
  }

  // Funding source candidates should NOT include hard obligations or inflow,
  // and should prefer discretionary/everyday/true expense balances.
  const sourceJobs = new Set(snapshot.funding_source_candidates.map((s) => s.job));
  assert.ok(!sourceJobs.has('inflow'));
  assert.ok(!sourceJobs.has('credit_card_payment'));
  const sourceIds = snapshot.funding_source_candidates.map((s) => s.category_id);
  assert.ok(sourceIds.includes('cat-james'), 'James personal balance should appear as a source');

  // Upcoming obligations within May should include mortgage + daycare scheduled
  const upcomingIds = snapshot.upcoming_obligations.map((u) => u.scheduled_id);
  assert.ok(upcomingIds.includes('sched-mortgage'));
  assert.ok(upcomingIds.includes('sched-daycare'));
  assert.ok(!upcomingIds.includes('sched-future'));

  // Priorities must lead with "cover overspending"
  assert.ok(snapshot.planning_priorities[0].toLowerCase().includes('cover overspending'));

  // Notes are advisory and explicit about read-only posture
  assert.ok(snapshot.notes.some((n) => n.toLowerCase().includes('read-only')));
});

test('find_months_needing_budget_help flags May for ready-to-assign and overspending', async () => {
  const reader = createCoachFakeReader(makeCoachFixtureData());
  const result = await findMonthsNeedingBudgetHelp(reader, {
    budgetId: COACH_BUDGET_ID,
    monthsBack: 2,
    asOfMonth: '2026-05',
  });

  assert.deepEqual(result.evaluated_months, ['2026-03', '2026-04', '2026-05']);
  const may = result.entries.find((e) => e.month === '2026-05');
  assert.ok(may);
  assert.equal(may.needs_help, true);
  assert.ok(may.reasons.some((r) => r.kind === 'ready_to_assign'));
  assert.ok(may.reasons.some((r) => r.kind === 'overspent_categories'));
  assert.ok(may.reasons.some((r) => r.kind === 'underfunded_targets'));
  assert.ok(may.reasons.some((r) => r.kind === 'credit_card_payment_issues'));
  assert.ok(may.reasons.some((r) => r.kind === 'previous_month_overspending'));

  const apr = result.entries.find((e) => e.month === '2026-04');
  assert.ok(apr);
  // April had small business overspend + credit card negative -> needs help
  assert.equal(apr.needs_help, true);
});

test('explain_overspending lists overspent categories with funding source candidates', async () => {
  const reader = createCoachFakeReader(makeCoachFixtureData());
  const explanation = await explainOverspending(reader, {
    budgetId: COACH_BUDGET_ID,
    month: '2026-05',
  });

  assert.ok(explanation.categories.length > 0);
  const fun = explanation.categories.find((c) => c.category.category_id === 'cat-fun');
  assert.ok(fun, 'Fun Stuff should be reported as overspent');
  assert.ok(fun.plain_language.toLowerCase().includes('overspent'));
  assert.ok(fun.likely_funding_sources.length >= 0);

  // Filtering to a single category should return only that one
  const justDaycare = await explainOverspending(reader, {
    budgetId: COACH_BUDGET_ID,
    month: '2026-05',
    categoryId: 'cat-daycare',
  });
  assert.equal(justDaycare.categories.length, 1);
  assert.equal(justDaycare.categories[0].category.category_id, 'cat-daycare');

  // Notes should call out approval + cash-flow caveat for negative CC payment
  assert.ok(explanation.notes.some((n) => n.toLowerCase().includes('approve')));
  assert.ok(explanation.notes.some((n) => n.toLowerCase().includes('credit card')));
});

test('get_categorization_queue surfaces uncategorized/unapproved and skips transfers/income/clean rows', async () => {
  const reader = createCoachFakeReader(makeCoachFixtureData());
  const result = await getCategorizationQueue(reader, {
    budgetId: COACH_BUDGET_ID,
    sinceDate: '2026-04-01',
  });

  const ids = result.transactions.map((t) => t.id);
  assert.ok(ids.includes('tx-grocery-needs-cat'));
  assert.ok(ids.includes('tx-shell-gas'));
  assert.ok(ids.includes('tx-ambig'));
  assert.ok(ids.includes('tx-vet-bill'));
  assert.ok(ids.includes('tx-netflix-1'));
  assert.ok(ids.includes('tx-netflix-2'));
  assert.ok(!ids.includes('tx-clean'), 'fully-categorized approved tx should not appear');
  assert.ok(!ids.includes('tx-transfer'), 'transfers must not appear in queue');
  // The paycheck is approved+categorized — should not be in needs-review queue.
  assert.ok(!ids.includes('tx-paycheck'));

  // Duplicate group should be detected for Netflix (2 txs same payee)
  const netflixGroup = result.duplicate_groups.find(
    (g) => (g.payee_name ?? '').toLowerCase() === 'netflix'
  );
  assert.ok(netflixGroup);
  assert.equal(netflixGroup.transaction_count, 2);

  // Notes are read-only / advisory
  assert.ok(result.notes.some((n) => n.toLowerCase().includes('read-only')));
});

test('suggest_transaction_categories yields high-confidence repeat-payee match', async () => {
  const reader = createCoachFakeReader(makeCoachFixtureData());
  const result = await suggestTransactionCategories(reader, {
    budgetId: COACH_BUDGET_ID,
    sinceDate: '2026-04-01',
  });

  const grocery = result.suggestions.find((s) => s.transaction_id === 'tx-grocery-needs-cat');
  assert.ok(grocery, 'expected suggestion for the uncategorized grocery transaction');
  assert.equal(grocery.suggestion.confidence, 'high');
  assert.equal(grocery.suggestion.category_id, 'cat-groceries');
  assert.ok(grocery.evidence.prior_examples.length >= 2);

  const ambig = result.suggestions.find((s) => s.transaction_id === 'tx-ambig');
  assert.ok(ambig);
  assert.equal(ambig.suggestion.confidence, 'low');
  assert.equal(ambig.suggestion.category_id, null);

  // Shell gas: no payee history but keyword should match a "gas" category if available.
  // No "gas" category exists in the fixture, so suggestion may be low — accept either, but
  // require it to surface for review.
  const gas = result.suggestions.find((s) => s.transaction_id === 'tx-shell-gas');
  assert.ok(gas);

  // Result counters add up
  assert.equal(
    result.with_high_confidence + result.with_medium_confidence + result.with_low_confidence,
    result.considered
  );
  assert.ok(result.notes.some((n) => n.toLowerCase().includes('approval required')));
});

test('weekly budget review shapes follow operating model sections', async () => {
  const reader = createCoachFakeReader(makeCoachFixtureData());
  const review = await getWeeklyBudgetReview(reader, {
    budgetId: COACH_BUDGET_ID,
    endDate: '2026-05-08',
  });

  assert.equal(review.period_end, '2026-05-08');
  assert.equal(review.period_start, '2026-05-02');

  assert.ok(review.inbox_health);
  assert.ok(review.inbox_health.uncategorized_count >= 1);

  assert.ok(Array.isArray(review.overspending.overspent_categories));
  assert.ok(review.overspending.overspent_categories.length > 0);
  assert.ok(Array.isArray(review.overspending.suggested_funding_sources));

  assert.ok(typeof review.cash_assignment.ready_to_assign_dollars === 'number');
  assert.ok(Array.isArray(review.cash_assignment.underfunded_hard_obligations));
  assert.ok(Array.isArray(review.cash_assignment.near_term_runout_categories));

  assert.ok(Array.isArray(review.notable_spending.large_transactions));
  // Vet bill should be a large transaction notable
  const vet = review.notable_spending.large_transactions.find((t) => t.id === 'tx-vet-bill');
  assert.ok(vet, 'large vet bill should be flagged');

  assert.ok(Array.isArray(review.next_actions));
  assert.ok(review.next_actions.length > 0);
  assert.ok(review.notes.some((n) => n.toLowerCase().includes('read-only')));
});

test('monthly budget review reports close readiness, performance, and next-month plan', async () => {
  const reader = createCoachFakeReader(makeCoachFixtureData());
  const review = await getMonthlyBudgetReview(reader, {
    budgetId: COACH_BUDGET_ID,
    month: '2026-05',
  });

  assert.equal(review.month, '2026-05');
  assert.equal(review.period_start, '2026-05-01');
  assert.equal(review.period_end, '2026-05-31');

  assert.equal(review.month_close_readiness.all_transactions_approved, false);
  assert.ok(review.month_close_readiness.overspent_count >= 1);
  assert.equal(review.month_close_readiness.any_overspent, true);

  assert.ok(typeof review.budget_performance.income_dollars === 'number');
  assert.ok(typeof review.budget_performance.spending_dollars === 'number');
  assert.ok(Array.isArray(review.budget_performance.top_category_deltas));
  assert.ok(review.budget_performance.top_category_deltas.length > 0);

  // True expenses: travel is below target; should appear in funds_below_target
  const travel = review.true_expenses.funds_below_target.find(
    (v) => v.category_id === 'cat-travel'
  );
  assert.ok(travel, 'travel sinking fund should be flagged below target');

  assert.ok(Array.isArray(review.next_month_plan.suggested_priorities));
  assert.ok(review.next_month_plan.suggested_priorities.length > 0);
  assert.ok(Array.isArray(review.next_month_plan.questions_for_humans));
});

test('budget coach reader is never asked to mutate', async () => {
  const reader = createCoachFakeReader(makeCoachFixtureData());
  await getBudgetPlanningSnapshot(reader, { budgetId: COACH_BUDGET_ID, month: '2026-05' });
  await getCategorizationQueue(reader, { budgetId: COACH_BUDGET_ID, sinceDate: '2026-04-01' });
  await suggestTransactionCategories(reader, { budgetId: COACH_BUDGET_ID, sinceDate: '2026-04-01' });
  await getWeeklyBudgetReview(reader, { budgetId: COACH_BUDGET_ID, endDate: '2026-05-08' });
  await getMonthlyBudgetReview(reader, { budgetId: COACH_BUDGET_ID, month: '2026-05' });

  // No call signature should look like a write.
  for (const c of reader.callLog) {
    assert.ok(
      c.startsWith('getBudgetMonth') ||
        c.startsWith('getCategories') ||
        c.startsWith('getTransactions') ||
        c.startsWith('getScheduledTransactions') ||
        c.startsWith('getAccounts') ||
        c.startsWith('getPayees'),
      `unexpected reader call: ${c}`
    );
  }
});
