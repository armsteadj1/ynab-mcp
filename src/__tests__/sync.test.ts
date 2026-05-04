import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../local/db.js';
import { getSyncStatus, syncBudget } from '../local/sync.js';
import { createFakeYnabClient } from './fakeYnabClient.js';
import { BUDGET_ID, makeBaseData } from './fixtures.js';

function inMemoryDb() {
  return openDb({ path: ':memory:' });
}

test('first sync inserts budget, accounts, categories, payees, and transactions', async () => {
  const db = inMemoryDb();
  const client = createFakeYnabClient(makeBaseData());
  client.setServerKnowledge({
    accounts: 100,
    categories: 100,
    payees: 100,
    transactions: 100,
  });

  const result = await syncBudget({ budgetId: BUDGET_ID, client, db });

  assert.equal(result.budget_id, BUDGET_ID);
  assert.equal(result.budget_name, 'Family Budget');
  assert.equal(result.resources.length, 4);
  for (const r of result.resources) {
    assert.equal(r.previous_server_knowledge, null, `expected no prior knowledge for ${r.resource}`);
  }

  const status = getSyncStatus(db, BUDGET_ID);
  assert.equal(status.counts.accounts, 2);
  assert.equal(status.counts.payees, 2);
  assert.equal(status.counts.categories, 3);
  assert.equal(status.counts.category_groups, 1);
  assert.equal(status.counts.transactions, 4);

  const knownTransactions = client
    .callLog()
    .filter((c) => c.startsWith('getTransactions'));
  assert.deepEqual(knownTransactions, ['getTransactions:none']);

  for (const resource of status.resources) {
    assert.equal(resource.server_knowledge, 100, `wrong sk for ${resource.resource}`);
  }
});

test('second sync updates an existing transaction without duplicating it', async () => {
  const db = inMemoryDb();
  const data = makeBaseData();
  const client = createFakeYnabClient(data);
  client.setServerKnowledge({
    accounts: 100,
    categories: 100,
    payees: 100,
    transactions: 100,
  });
  await syncBudget({ budgetId: BUDGET_ID, client, db });

  // Update an existing transaction's memo and amount; advance server_knowledge.
  const updated = data.transactions.map((t) =>
    t.id === 'tx-grocery-uncategorized'
      ? { ...t, memo: 'Categorized as groceries', amount: -33_000, category_id: 'cat-groceries', category_name: 'Groceries', approved: true }
      : t
  );
  client.setData({ ...data, transactions: updated });
  client.setServerKnowledge({ transactions: 200 });
  client.reset();

  const result = await syncBudget({ budgetId: BUDGET_ID, client, db });
  const txResource = result.resources.find((r) => r.resource === 'transactions');
  assert.ok(txResource);
  assert.equal(txResource.previous_server_knowledge, 100);
  assert.equal(txResource.server_knowledge, 200);

  // Second call should pass last knowledge
  const txCalls = client.callLog().filter((c) => c.startsWith('getTransactions'));
  assert.deepEqual(txCalls, ['getTransactions:100']);

  // Should still be 4 transactions (one was updated, not added).
  const status = getSyncStatus(db, BUDGET_ID);
  assert.equal(status.counts.transactions, 4);

  const row = db
    .prepare('SELECT memo, amount, category_id, approved FROM transactions WHERE id = ?')
    .get('tx-grocery-uncategorized') as {
    memo: string;
    amount: number;
    category_id: string;
    approved: number;
  };
  assert.equal(row.memo, 'Categorized as groceries');
  assert.equal(row.amount, -33_000);
  assert.equal(row.category_id, 'cat-groceries');
  assert.equal(row.approved, 1);
});

test('deleted transactions are stored as deleted=1 and filtered from active counts', async () => {
  const db = inMemoryDb();
  const data = makeBaseData();
  const client = createFakeYnabClient(data);
  client.setServerKnowledge({
    accounts: 100,
    categories: 100,
    payees: 100,
    transactions: 100,
  });
  await syncBudget({ budgetId: BUDGET_ID, client, db });
  assert.equal(getSyncStatus(db, BUDGET_ID).counts.transactions, 4);

  const withDeletion = data.transactions.map((t) =>
    t.id === 'tx-grocery-1' ? { ...t, deleted: true } : t
  );
  client.setData({ ...data, transactions: withDeletion });
  client.setServerKnowledge({ transactions: 250 });
  await syncBudget({ budgetId: BUDGET_ID, client, db });

  const status = getSyncStatus(db, BUDGET_ID);
  assert.equal(status.counts.transactions, 3, 'deleted transactions excluded from active counts');

  const deletedRow = db
    .prepare('SELECT deleted FROM transactions WHERE id = ?')
    .get('tx-grocery-1') as { deleted: number };
  assert.equal(deletedRow.deleted, 1, 'deleted transaction still present and marked');
});

test('full_resync clears server_knowledge and refetches from scratch', async () => {
  const db = inMemoryDb();
  const data = makeBaseData();
  const client = createFakeYnabClient(data);
  client.setServerKnowledge({
    accounts: 100,
    categories: 100,
    payees: 100,
    transactions: 100,
  });
  await syncBudget({ budgetId: BUDGET_ID, client, db });
  client.reset();

  client.setServerKnowledge({
    accounts: 200,
    categories: 200,
    payees: 200,
    transactions: 200,
  });
  await syncBudget({ budgetId: BUDGET_ID, client, db, fullResync: true });

  const calls = client.callLog();
  for (const c of calls.filter((c) => c.includes(':'))) {
    assert.ok(c.endsWith(':none'), `expected reset call ${c} to omit last knowledge`);
  }

  const status = getSyncStatus(db, BUDGET_ID);
  for (const resource of status.resources) {
    assert.equal(resource.server_knowledge, 200);
  }
});

test('rejects unknown budget id from the YNAB client', async () => {
  const db = inMemoryDb();
  const client = createFakeYnabClient(makeBaseData());
  await assert.rejects(
    () => syncBudget({ budgetId: 'nope', client, db }),
    /Budget nope not found/
  );
});
