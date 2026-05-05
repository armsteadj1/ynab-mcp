import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyCategorization,
  type CategorizationApplyPayload,
  type YnabCategorizationWriter,
} from '../budget-coach/apply-categorization.js';
import type { CoachTransaction } from '../budget-coach/reader.js';
import { makeTransaction } from './budgetCoachFakeReader.js';

interface FakeWriter extends YnabCategorizationWriter {
  transactions: Map<string, CoachTransaction>;
  updateCalls: Array<{
    budget_id: string;
    transaction_id: string;
    payload: CategorizationApplyPayload;
    payload_keys: string[];
  }>;
  getCalls: string[];
  failNextUpdate?: string;
}

function fakeWriter(initial: CoachTransaction[]): FakeWriter {
  const transactions = new Map<string, CoachTransaction>();
  for (const t of initial) transactions.set(t.id, { ...t });

  const writer: FakeWriter = {
    transactions,
    updateCalls: [],
    getCalls: [],
    async getTransaction(_budgetId, transactionId) {
      writer.getCalls.push(transactionId);
      const tx = transactions.get(transactionId);
      if (!tx) throw new Error(`No fake transaction ${transactionId}`);
      return { ...tx, subtransactions: tx.subtransactions?.map((s) => ({ ...s })) };
    },
    async updateTransaction(budgetId, transactionId, payload) {
      writer.updateCalls.push({
        budget_id: budgetId,
        transaction_id: transactionId,
        payload,
        payload_keys: Object.keys(payload),
      });
      if (writer.failNextUpdate === transactionId) {
        writer.failNextUpdate = undefined;
        throw new Error('simulated write failure');
      }
      const current = transactions.get(transactionId);
      if (!current) throw new Error(`No fake transaction ${transactionId}`);
      const next: CoachTransaction = {
        ...current,
        subtransactions: current.subtransactions?.map((s) => ({ ...s })) ?? [],
      };
      if (payload.subtransactions && payload.subtransactions.length > 0) {
        next.category_id = null;
        next.category_name = null;
        next.subtransactions = payload.subtransactions.map((s, i) => ({
          id: `sub-${transactionId}-${i}`,
          amount: s.amount,
          category_id: s.category_id,
          category_name: null,
          payee_id: null,
          payee_name: null,
          memo: s.memo ?? null,
          transfer_account_id: null,
          deleted: false,
        }));
      } else if (payload.category_id !== undefined) {
        next.category_id = payload.category_id;
        next.category_name = null;
        next.subtransactions = [];
      }
      if (payload.memo !== undefined) {
        next.memo = payload.memo;
      }
      // approved is never modified by the writer-under-test path
      transactions.set(transactionId, next);
      return { ...next, subtransactions: next.subtransactions?.map((s) => ({ ...s })) };
    },
  };
  return writer;
}

const BUDGET_ID = 'budget-apply-1';

test('dry run performs no writes and returns before/after preview', async () => {
  const writer = fakeWriter([
    makeTransaction('tx-1', {
      payee_id: 'payee-grocer',
      payee_name: 'Local Grocer',
      amount: -42_000,
      memo: null,
      approved: false,
    }),
  ]);

  const result = await applyCategorization(writer, {
    budgetId: BUDGET_ID,
    changes: [
      {
        transaction_id: 'tx-1',
        category_id: 'cat-groceries',
        memo_reason: 'Repeated grocer pattern',
      },
    ],
  });

  assert.equal(result.dry_run, true);
  assert.equal(writer.updateCalls.length, 0, 'no writes in dry run');
  assert.equal(writer.getCalls.length, 1, 'reads current transaction first');
  assert.equal(result.applied.length, 1);
  const item = result.applied[0];
  assert.equal(item.transaction_id, 'tx-1');
  assert.deepEqual(item.changed_fields.sort(), ['category_id', 'memo']);
  assert.equal(item.before.category_id, null);
  assert.equal(item.before.memo, null);
  assert.equal(item.after.category_id, 'cat-groceries');
  assert.equal(item.after.memo, 'Repeated grocer pattern');
  assert.equal(item.memo_action, 'set');
  assert.equal(item.approved_after_apply, null, 'dry run cannot report approved state');
  assert.ok(result.notes.some((n) => n.toLowerCase().includes('dry run')));
});

test('apply mode updates category and blank memo, approved remains false', async () => {
  const writer = fakeWriter([
    makeTransaction('tx-1', {
      payee_id: 'payee-grocer',
      payee_name: 'Local Grocer',
      amount: -42_000,
      memo: '',
      approved: false,
    }),
  ]);

  const result = await applyCategorization(writer, {
    budgetId: BUDGET_ID,
    dryRun: false,
    changes: [
      {
        transaction_id: 'tx-1',
        category_id: 'cat-groceries',
        memo: 'Hedwig: matched repeat grocer pattern',
      },
    ],
  });

  assert.equal(writer.updateCalls.length, 1);
  const call = writer.updateCalls[0];
  assert.deepEqual(call.payload_keys.sort(), ['category_id', 'memo']);
  for (const forbidden of ['approved', 'cleared', 'date', 'amount', 'payee_id', 'payee_name', 'account_id', 'import_id']) {
    assert.ok(!call.payload_keys.includes(forbidden), `payload must not include ${forbidden}`);
  }

  const stored = writer.transactions.get('tx-1');
  assert.ok(stored);
  assert.equal(stored!.category_id, 'cat-groceries');
  assert.equal(stored!.memo, 'Hedwig: matched repeat grocer pattern');
  assert.equal(stored!.approved, false, 'apply must not approve the transaction');

  const item = result.applied[0];
  assert.equal(item.approved_after_apply, false);
  assert.deepEqual(item.changed_fields.sort(), ['category_id', 'memo']);
});

test('existing non-blank memo is preserved by default', async () => {
  const writer = fakeWriter([
    makeTransaction('tx-1', {
      payee_id: 'payee-grocer',
      payee_name: 'Local Grocer',
      amount: -42_000,
      memo: 'Receipt #1234',
      approved: false,
    }),
  ]);

  const result = await applyCategorization(writer, {
    budgetId: BUDGET_ID,
    dryRun: false,
    changes: [
      {
        transaction_id: 'tx-1',
        category_id: 'cat-groceries',
        memo: 'Hedwig: would overwrite receipt note',
      },
    ],
  });

  const item = result.applied[0];
  assert.equal(item.memo_action, 'preserved_existing');
  assert.deepEqual(item.changed_fields, ['category_id']);
  assert.ok(item.memo_skipped_reason);

  const call = writer.updateCalls[0];
  assert.ok(!call.payload_keys.includes('memo'), 'memo must not be sent when existing memo is non-blank');
  assert.equal(writer.transactions.get('tx-1')!.memo, 'Receipt #1234');
});

test('split subtransactions whose milliunits sum matches the parent are accepted', async () => {
  const writer = fakeWriter([
    makeTransaction('tx-split', {
      amount: -100_000,
      payee_name: 'Costco',
      memo: null,
      approved: false,
    }),
  ]);

  const result = await applyCategorization(writer, {
    budgetId: BUDGET_ID,
    dryRun: false,
    changes: [
      {
        transaction_id: 'tx-split',
        subtransactions: [
          { category_id: 'cat-groceries', amount_milliunits: -60_000 },
          { category_id: 'cat-household', amount_milliunits: -40_000 },
        ],
        memo_reason: 'Split: groceries and household',
      },
    ],
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.applied.length, 1);
  const item = result.applied[0];
  assert.deepEqual(item.changed_fields.sort(), ['memo', 'subtransactions']);
  assert.equal(item.after.is_split, true);
  assert.equal(item.after.subtransactions.length, 2);

  const call = writer.updateCalls[0];
  assert.ok(call.payload_keys.includes('subtransactions'));
  assert.ok(!call.payload_keys.includes('category_id'));
  assert.ok(!call.payload_keys.includes('approved'));
});

test('split subtransactions with mismatched milliunits sum are rejected', async () => {
  const writer = fakeWriter([
    makeTransaction('tx-split', {
      amount: -100_000,
      memo: null,
      approved: false,
    }),
  ]);

  const result = await applyCategorization(writer, {
    budgetId: BUDGET_ID,
    dryRun: false,
    changes: [
      {
        transaction_id: 'tx-split',
        subtransactions: [
          { category_id: 'cat-groceries', amount_milliunits: -60_000 },
          { category_id: 'cat-household', amount_milliunits: -39_000 },
        ],
      },
    ],
  });

  assert.equal(writer.updateCalls.length, 0, 'mismatch must not trigger a write');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].transaction_id, 'tx-split');
  assert.match(result.errors[0].error, /sum/i);
});

test('forbidden top-level fields are rejected before any read or write', async () => {
  const writer = fakeWriter([
    makeTransaction('tx-1', { memo: null, approved: false }),
  ]);

  const result = await applyCategorization(writer, {
    budgetId: BUDGET_ID,
    dryRun: false,
    changes: [
      {
        transaction_id: 'tx-1',
        category_id: 'cat-groceries',
        // Forbidden — caller is trying to sneak in approved/amount.
        approved: true,
        amount: -10_000,
      } as never,
    ],
  });

  assert.equal(writer.updateCalls.length, 0);
  assert.equal(result.applied.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /approved/);
  assert.match(result.errors[0].error, /amount/);
});

test('change with neither category_id nor subtransactions errors', async () => {
  const writer = fakeWriter([makeTransaction('tx-1', { memo: null })]);
  const result = await applyCategorization(writer, {
    budgetId: BUDGET_ID,
    dryRun: false,
    changes: [{ transaction_id: 'tx-1' }],
  });
  assert.equal(writer.updateCalls.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /category_id|subtransactions/);
});

test('change with both category_id and subtransactions errors', async () => {
  const writer = fakeWriter([
    makeTransaction('tx-1', { amount: -100_000, memo: null }),
  ]);
  const result = await applyCategorization(writer, {
    budgetId: BUDGET_ID,
    dryRun: false,
    changes: [
      {
        transaction_id: 'tx-1',
        category_id: 'cat-groceries',
        subtransactions: [
          { category_id: 'cat-groceries', amount_milliunits: -100_000 },
        ],
      },
    ],
  });
  assert.equal(writer.updateCalls.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /both/i);
});

test('transfer transactions are skipped, not updated', async () => {
  const writer = fakeWriter([
    makeTransaction('tx-xfer', {
      transfer_account_id: 'acct-credit',
      memo: null,
    }),
  ]);

  const result = await applyCategorization(writer, {
    budgetId: BUDGET_ID,
    dryRun: false,
    changes: [{ transaction_id: 'tx-xfer', category_id: 'cat-groceries' }],
  });

  assert.equal(writer.updateCalls.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /transfer/i);
});

test('no-op category change is reported as skipped', async () => {
  const writer = fakeWriter([
    makeTransaction('tx-1', {
      category_id: 'cat-groceries',
      category_name: 'Groceries',
      memo: 'already noted',
      approved: false,
    }),
  ]);

  const result = await applyCategorization(writer, {
    budgetId: BUDGET_ID,
    dryRun: false,
    changes: [
      {
        transaction_id: 'tx-1',
        category_id: 'cat-groceries',
        memo: 'try to overwrite',
      },
    ],
  });

  assert.equal(writer.updateCalls.length, 0);
  assert.equal(result.skipped.length, 1);
});

test('apply propagates writer errors as per-transaction errors without stopping the batch', async () => {
  const writer = fakeWriter([
    makeTransaction('tx-1', { memo: null, approved: false }),
    makeTransaction('tx-2', { memo: null, approved: false }),
  ]);
  writer.failNextUpdate = 'tx-1';

  const result = await applyCategorization(writer, {
    budgetId: BUDGET_ID,
    dryRun: false,
    changes: [
      { transaction_id: 'tx-1', category_id: 'cat-a' },
      { transaction_id: 'tx-2', category_id: 'cat-b' },
    ],
  });

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].transaction_id, 'tx-1');
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].transaction_id, 'tx-2');
  assert.equal(result.applied[0].approved_after_apply, false);
});

test('writer payload never carries approved/cleared/date/amount/payee/account', async () => {
  const writer = fakeWriter([
    makeTransaction('tx-1', { memo: null, approved: false }),
    makeTransaction('tx-2', { amount: -50_000, memo: null, approved: false }),
  ]);

  await applyCategorization(writer, {
    budgetId: BUDGET_ID,
    dryRun: false,
    changes: [
      { transaction_id: 'tx-1', category_id: 'cat-a', memo: 'm' },
      {
        transaction_id: 'tx-2',
        subtransactions: [
          { category_id: 'cat-x', amount_milliunits: -30_000 },
          { category_id: 'cat-y', amount_milliunits: -20_000 },
        ],
      },
    ],
  });

  for (const call of writer.updateCalls) {
    for (const key of Object.keys(call.payload)) {
      assert.ok(
        ['category_id', 'subtransactions', 'memo'].includes(key),
        `unexpected payload key: ${key}`
      );
    }
  }
});
