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
import {
  buildGmailQueries,
  classifyEmailSignals,
  pickMerchantTerm,
  type EmailEvidenceProvider,
  type TransactionEmailEvidence,
} from '../budget-coach/email-evidence.js';
import { createCoachFakeReader } from './budgetCoachFakeReader.js';
import { COACH_BUDGET_ID, makeCoachFixtureData } from './budgetCoachFixtures.js';

interface FakeEmailHandle {
  provider: EmailEvidenceProvider;
  calls: string[];
}

function fakeEmailEvidenceProvider(
  responses: Record<string, TransactionEmailEvidence | null>
): FakeEmailHandle {
  const calls: string[] = [];
  return {
    calls,
    provider: {
      async searchForTransaction(tx) {
        calls.push(tx.id);
        if (Object.prototype.hasOwnProperty.call(responses, tx.id)) {
          return responses[tx.id];
        }
        return null;
      },
    },
  };
}

function makeFakeEvidence(
  transactionId: string,
  overrides: Partial<TransactionEmailEvidence> = {}
): TransactionEmailEvidence {
  return {
    transaction_id: transactionId,
    source: 'gmail',
    account: 'fake@example.com',
    merchant_term: 'fake',
    queries: [],
    messages: [],
    signals: [],
    has_specific_item_evidence: false,
    notes: [],
    ...overrides,
  };
}

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

test('suggest_transaction_categories: no email provider calls when disabled (default)', async () => {
  const reader = createCoachFakeReader(makeCoachFixtureData());
  const fake = fakeEmailEvidenceProvider({});
  const result = await suggestTransactionCategories(reader, {
    budgetId: COACH_BUDGET_ID,
    sinceDate: '2026-04-01',
    emailEvidenceProvider: fake.provider,
  });

  assert.equal(fake.calls.length, 0, 'provider should not be called when includeEmailEvidence is false');
  assert.equal(result.email_evidence_used, false);
  assert.equal(result.email_evidence_lookups, 0);
  for (const s of result.suggestions) {
    assert.equal(s.email_evidence, null);
  }
  assert.ok(
    result.notes.some((n) => n.toLowerCase().includes('gmail evidence disabled')),
    'notes should mention gmail evidence is off'
  );
});

test('suggest_transaction_categories: email evidence is attached when enabled', async () => {
  const reader = createCoachFakeReader(makeCoachFixtureData());
  const fake = fakeEmailEvidenceProvider({
    'tx-grocery-needs-cat': makeFakeEvidence('tx-grocery-needs-cat', {
      merchant_term: 'local',
      messages: [
        {
          id: 'm1',
          date: '2026-05-02 09:00',
          from: 'Local Grocer <receipts@localgrocer.example>',
          subject: 'Receipt for your purchase',
          labels: ['INBOX'],
        },
      ],
      signals: ['generic_receipt'],
      has_specific_item_evidence: false,
      notes: ['Gmail matched 1 message(s)'],
    }),
    'tx-shell-gas': null,
  });

  const result = await suggestTransactionCategories(reader, {
    budgetId: COACH_BUDGET_ID,
    sinceDate: '2026-04-01',
    includeEmailEvidence: true,
    emailEvidenceProvider: fake.provider,
  });

  assert.equal(result.email_evidence_used, true);
  assert.ok(result.email_evidence_lookups > 0, 'at least one transaction should have been looked up');
  assert.ok(fake.calls.includes('tx-grocery-needs-cat'));

  const grocery = result.suggestions.find((s) => s.transaction_id === 'tx-grocery-needs-cat');
  assert.ok(grocery, 'grocery suggestion present');
  assert.ok(grocery.email_evidence, 'grocery should carry email evidence');
  assert.equal(grocery.email_evidence!.signals[0], 'generic_receipt');
  assert.equal(grocery.email_evidence!.messages.length, 1);
  assert.ok(
    grocery.evidence.notes.some((n) => n.startsWith('email')),
    'evidence notes should reference email'
  );
  // Grocery is high-confidence + non-Amazon → safe to apply.
  assert.equal(grocery.suggestion.confidence, 'high');
  assert.equal(grocery.safe_to_apply, true);
  assert.equal(grocery.review_state, 'safe_to_apply');

  assert.ok(
    result.notes.some((n) => n.toLowerCase().includes('gmail evidence enabled')),
    'notes should mention gmail evidence is on'
  );
});

test('suggest_transaction_categories: item-level email evidence upgrades an ambiguous transaction', async () => {
  const reader = createCoachFakeReader(makeCoachFixtureData());
  const fake = fakeEmailEvidenceProvider({
    'tx-ambig': makeFakeEvidence('tx-ambig', {
      merchant_term: 'random',
      messages: [
        {
          id: 'mr1',
          date: '2026-05-03 19:30',
          from: 'OpenTable <receipts@opentable.com>',
          subject: 'Receipt for your dinner at Random Store',
          labels: ['INBOX'],
        },
      ],
      signals: ['restaurant', 'generic_receipt'],
      has_specific_item_evidence: true,
    }),
  });

  const result = await suggestTransactionCategories(reader, {
    budgetId: COACH_BUDGET_ID,
    sinceDate: '2026-04-01',
    includeEmailEvidence: true,
    emailEvidenceProvider: fake.provider,
  });

  const ambig = result.suggestions.find((s) => s.transaction_id === 'tx-ambig');
  assert.ok(ambig);
  assert.equal(ambig.suggestion.confidence, 'medium', 'item-level email signal should lift low → medium');
  assert.ok(ambig.email_evidence);
  assert.equal(ambig.email_evidence!.has_specific_item_evidence, true);
  // Even with the upgrade we never auto-apply on a medium suggestion.
  assert.equal(ambig.safe_to_apply, false);
  assert.equal(ambig.review_state, 'needs_human_review');
  assert.ok(
    ambig.evidence.notes.some((n) => n.toLowerCase().includes('email signals')),
    'evidence notes should list email signals'
  );
});

test('suggest_transaction_categories: Amazon stays needs_human_review without item-level evidence', async () => {
  const reader = createCoachFakeReader(makeCoachFixtureData());
  const fake = fakeEmailEvidenceProvider({
    'tx-amazon-needs-cat': makeFakeEvidence('tx-amazon-needs-cat', {
      merchant_term: 'amazon',
      messages: [
        {
          id: 'a1',
          date: '2026-05-03 09:00',
          from: 'Amazon Business <no-reply@business.amazon.com>',
          subject: 'Add a backup payment to avoid order disruptions',
          labels: ['INBOX', 'CATEGORY_UPDATES'],
        },
      ],
      signals: ['amazon_order_generic'],
      has_specific_item_evidence: false,
    }),
  });

  const result = await suggestTransactionCategories(reader, {
    budgetId: COACH_BUDGET_ID,
    sinceDate: '2026-04-01',
    includeEmailEvidence: true,
    emailEvidenceProvider: fake.provider,
  });

  const amazon = result.suggestions.find((s) => s.transaction_id === 'tx-amazon-needs-cat');
  assert.ok(amazon, 'amazon suggestion present');
  // History alone produces 'high' confidence, but Amazon-like merchants must hold for review.
  assert.equal(amazon.suggestion.confidence, 'high');
  assert.equal(amazon.safe_to_apply, false);
  assert.equal(amazon.review_state, 'needs_human_review');
  assert.ok(
    amazon.evidence.notes.some((n) => n.toLowerCase().includes('amazon-like payee')),
    'should explain the Amazon hold'
  );

  // And if we add an item-specific evidence, it can flip safe-to-apply.
  const fake2 = fakeEmailEvidenceProvider({
    'tx-amazon-needs-cat': makeFakeEvidence('tx-amazon-needs-cat', {
      merchant_term: 'amazon',
      messages: [
        {
          id: 'a2',
          date: '2026-05-03 09:00',
          from: 'auto-confirm@amazon.com',
          subject: 'Your Amazon.com order of "USB-C cable"',
          labels: ['INBOX'],
        },
      ],
      signals: ['amazon_item_specific'],
      has_specific_item_evidence: true,
    }),
  });

  const result2 = await suggestTransactionCategories(reader, {
    budgetId: COACH_BUDGET_ID,
    sinceDate: '2026-04-01',
    includeEmailEvidence: true,
    emailEvidenceProvider: fake2.provider,
  });
  const amazon2 = result2.suggestions.find((s) => s.transaction_id === 'tx-amazon-needs-cat');
  assert.ok(amazon2);
  assert.equal(amazon2.safe_to_apply, true, 'item-level evidence allows the high-confidence suggestion to be applied');
  assert.equal(amazon2.review_state, 'safe_to_apply');
});

test('email-evidence helpers sanitize merchant tokens, build bounded queries, and classify signals', () => {
  const tx = {
    id: 't',
    date: '2026-04-15',
    amount: -10,
    memo: null,
    cleared: 'cleared',
    approved: false,
    flag_color: null,
    account_id: 'a',
    payee_id: null,
    payee_name: 'AMAZON.COM*RX9YZ',
    import_payee_name: null,
    import_payee_name_original: null,
    category_id: null,
    category_name: null,
    transfer_account_id: null,
    transfer_transaction_id: null,
    matched_transaction_id: null,
    import_id: null,
    deleted: false,
    subtransactions: [] as never[],
  };

  const term = pickMerchantTerm(tx);
  assert.equal(term, 'amazon');

  const queries = buildGmailQueries(term as string, '2026-04-15', 7);
  assert.equal(queries.length, 2);
  for (const q of queries) {
    assert.match(q, /after:2026\/4\/8/);
    assert.match(q, /before:2026\/4\/23/);
    // No shell metacharacters should leak into the query.
    assert.doesNotMatch(q, /[`$;|&]/);
  }

  const { signals, itemSpecific } = classifyEmailSignals([
    {
      id: '1',
      date: '2026-04-15',
      from: 'auto-confirm@amazon.com',
      subject: 'Your Amazon.com order of "Foo bar"',
      labels: [],
    },
    {
      id: '2',
      date: '2026-04-15',
      from: 'no-reply@business.amazon.com',
      subject: 'Add a backup payment to avoid order disruptions',
      labels: [],
    },
  ]);
  assert.ok(signals.includes('amazon_item_specific'));
  assert.ok(signals.includes('amazon_order_generic'));
  assert.equal(itemSpecific, true);
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
