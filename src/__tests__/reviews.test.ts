import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../local/db.js';
import { syncBudget } from '../local/sync.js';
import {
  countTransactionsNeedingReview,
  getMonthlyReview,
  getTransactionsNeedingReview,
  getWeeklyReview,
} from '../local/reviews.js';
import { createFakeYnabClient } from './fakeYnabClient.js';
import { BUDGET_ID, makeBaseData } from './fixtures.js';
import type { RemoteTransaction } from '../local/types.js';

async function seed() {
  const db = openDb({ path: ':memory:' });
  const data = makeBaseData();
  const client = createFakeYnabClient(data);
  client.setServerKnowledge({
    accounts: 100,
    categories: 100,
    payees: 100,
    transactions: 100,
  });
  await syncBudget({ budgetId: BUDGET_ID, client, db });
  return { db, data, client };
}

test('get_transactions_needing_review surfaces uncategorized/unapproved/flagged but skips transfers', async () => {
  const { db } = await seed();
  const result = getTransactionsNeedingReview(db, {
    budgetId: BUDGET_ID,
    sinceDate: '2026-01-01',
  });
  const ids = result.map((t) => t.id);
  assert.ok(ids.includes('tx-grocery-uncategorized'));
  assert.ok(!ids.includes('tx-transfer'), 'transfers must not appear in review queue');
  assert.ok(!ids.includes('tx-grocery-1'), 'fully-categorized approved tx should not need review');

  const uncategorized = result.find((t) => t.id === 'tx-grocery-uncategorized');
  assert.ok(uncategorized);
  assert.deepEqual(uncategorized.reasons.sort(), ['unapproved', 'uncategorized']);

  const total = countTransactionsNeedingReview(db, BUDGET_ID, '2026-01-01');
  assert.equal(total, result.length);
});

test('weekly review sums spending and income from local DB only', async () => {
  const { db } = await seed();
  const review = getWeeklyReview(db, BUDGET_ID, '2026-05-04');
  assert.equal(review.period_start, '2026-04-28');
  assert.equal(review.period_end, '2026-05-04');

  // Spending = 45 + 32.50 = 77.50; income = 2500; transfer excluded.
  assert.equal(review.totals.spending_dollars, 77.5);
  assert.equal(review.totals.income_dollars, 2500);
  assert.equal(review.totals.net_dollars, 2500 - 77.5);
  assert.equal(review.totals.transaction_count, 3, 'transfer is excluded from review counts');
  assert.equal(review.totals.transactions_needing_review, 1);

  const groceriesRollup = review.top_spending_categories.find(
    (c) => c.category_id === 'cat-groceries'
  );
  assert.ok(groceriesRollup);
  assert.equal(groceriesRollup.total_dollars, 45);

  // Uncategorized transaction shows up in the rollup with category_id = null.
  const uncatRollup = review.top_spending_categories.find((c) => c.category_id == null);
  assert.ok(uncatRollup);
  assert.equal(uncatRollup.total_dollars, 32.5);

  const overspent = review.signals.find(
    (s) => s.kind === 'overspent_category' && (s.detail?.category_id as string | undefined) === 'cat-overspent'
  );
  assert.ok(overspent, 'overspent category signal should fire');

  const reviewBacklog = review.signals.find((s) => s.kind === 'review_backlog');
  assert.ok(reviewBacklog);
});

test('monthly review aggregates by calendar month', async () => {
  const { db } = await seed();
  const review = getMonthlyReview(db, BUDGET_ID, '2026-04');
  assert.equal(review.period_start, '2026-04-01');
  assert.equal(review.period_end, '2026-04-30');

  // April-only: tx-grocery-1 (45), tx-paycheck (2500). The uncategorized one is May 1.
  assert.equal(review.totals.spending_dollars, 45);
  assert.equal(review.totals.income_dollars, 2500);
  assert.equal(review.totals.transaction_count, 2);
});

test('large transaction signal fires above default threshold', async () => {
  const db = openDb({ path: ':memory:' });
  const data = makeBaseData();
  const big: RemoteTransaction = {
    ...data.transactions[0],
    id: 'tx-big-spend',
    date: '2026-05-02',
    amount: -425_000, // $425
    payee_id: 'payee-grocer',
    payee_name: 'Local Grocer',
    category_id: 'cat-groceries',
    category_name: 'Groceries',
    approved: true,
  };
  const dataWithBig = { ...data, transactions: [...data.transactions, big] };
  const client = createFakeYnabClient(dataWithBig);
  client.setServerKnowledge({
    accounts: 1,
    categories: 1,
    payees: 1,
    transactions: 1,
  });
  await syncBudget({ budgetId: BUDGET_ID, client, db });

  const review = getWeeklyReview(db, BUDGET_ID, '2026-05-04');
  const largeSig = review.signals.find(
    (s) => s.kind === 'large_transaction' && s.detail?.transaction_id === 'tx-big-spend'
  );
  assert.ok(largeSig, 'large transaction signal should be present');
});
