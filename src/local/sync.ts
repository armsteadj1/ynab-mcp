import type { Database } from './db.js';
import type {
  BudgetMeta,
  RemoteAccount,
  RemoteCategory,
  RemoteCategoryGroup,
  RemotePayee,
  RemoteSubtransaction,
  RemoteTransaction,
  ResourceSyncResult,
  SyncResource,
  SyncResult,
  YnabSyncClient,
} from './types.js';

export type { SyncResult, SyncResource, ResourceSyncResult } from './types.js';

export interface SyncOptions {
  budgetId: string;
  client: YnabSyncClient;
  db: Database;
  fullResync?: boolean;
  now?: () => Date;
}

const RESOURCES: SyncResource[] = [
  'accounts',
  'categories',
  'payees',
  'transactions',
];

export async function syncBudget(opts: SyncOptions): Promise<SyncResult> {
  const { budgetId, client, db } = opts;
  const now = opts.now ?? (() => new Date());
  const startedAt = now().toISOString();

  if (opts.fullResync) {
    clearSyncState(db, budgetId);
  }

  const budgets = await client.getBudgets();
  const budget = budgets.find((b) => b.id === budgetId);
  if (!budget) {
    throw new Error(`Budget ${budgetId} not found in YNAB account`);
  }
  upsertBudget(db, budget, now().toISOString());

  const results: ResourceSyncResult[] = [];
  for (const resource of RESOURCES) {
    const previous = getServerKnowledge(db, budgetId, resource);
    const lastKnowledge = opts.fullResync ? undefined : previous ?? undefined;
    const result = await syncResource(db, client, budgetId, resource, lastKnowledge, now);
    setServerKnowledge(db, budgetId, resource, result.server_knowledge, now().toISOString());
    results.push({ ...result, previous_server_knowledge: previous });
  }

  return {
    budget_id: budgetId,
    budget_name: budget.name,
    started_at: startedAt,
    finished_at: now().toISOString(),
    resources: results,
  };
}

async function syncResource(
  db: Database,
  client: YnabSyncClient,
  budgetId: string,
  resource: SyncResource,
  lastKnowledge: number | undefined,
  now: () => Date
): Promise<Omit<ResourceSyncResult, 'previous_server_knowledge'>> {
  const updatedAt = now().toISOString();
  switch (resource) {
    case 'accounts': {
      const r = await client.getAccounts(budgetId, lastKnowledge);
      const { upserted, deleted } = upsertAccounts(db, budgetId, r.data, updatedAt);
      return { resource, fetched: r.data.length, upserted, deleted, server_knowledge: r.server_knowledge };
    }
    case 'categories': {
      const r = await client.getCategories(budgetId, lastKnowledge);
      const { upserted, deleted } = upsertCategories(db, budgetId, r.data, updatedAt);
      return { resource, fetched: countCategories(r.data), upserted, deleted, server_knowledge: r.server_knowledge };
    }
    case 'payees': {
      const r = await client.getPayees(budgetId, lastKnowledge);
      const { upserted, deleted } = upsertPayees(db, budgetId, r.data, updatedAt);
      return { resource, fetched: r.data.length, upserted, deleted, server_knowledge: r.server_knowledge };
    }
    case 'transactions': {
      const r = await client.getTransactions(budgetId, lastKnowledge);
      const { upserted, deleted } = upsertTransactions(db, budgetId, r.data, updatedAt);
      return { resource, fetched: r.data.length, upserted, deleted, server_knowledge: r.server_knowledge };
    }
  }
}

function countCategories(groups: RemoteCategoryGroup[]): number {
  let n = 0;
  for (const g of groups) n += 1 + g.categories.length;
  return n;
}

function upsertBudget(db: Database, b: BudgetMeta, updatedAt: string): void {
  db.prepare(
    `INSERT INTO budgets (id, name, last_modified_on, first_month, last_month, currency_iso_code, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       last_modified_on = excluded.last_modified_on,
       first_month = excluded.first_month,
       last_month = excluded.last_month,
       currency_iso_code = excluded.currency_iso_code,
       updated_at = excluded.updated_at`
  ).run(
    b.id,
    b.name,
    b.last_modified_on ?? null,
    b.first_month ?? null,
    b.last_month ?? null,
    b.currency_iso_code ?? null,
    updatedAt
  );
}

function upsertAccounts(
  db: Database,
  budgetId: string,
  accounts: RemoteAccount[],
  updatedAt: string
): { upserted: number; deleted: number } {
  const stmt = db.prepare(
    `INSERT INTO accounts (
       id, budget_id, name, type, on_budget, closed, note,
       balance, cleared_balance, uncleared_balance,
       transfer_payee_id, direct_import_linked, direct_import_in_error,
       deleted, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       budget_id = excluded.budget_id,
       name = excluded.name,
       type = excluded.type,
       on_budget = excluded.on_budget,
       closed = excluded.closed,
       note = excluded.note,
       balance = excluded.balance,
       cleared_balance = excluded.cleared_balance,
       uncleared_balance = excluded.uncleared_balance,
       transfer_payee_id = excluded.transfer_payee_id,
       direct_import_linked = excluded.direct_import_linked,
       direct_import_in_error = excluded.direct_import_in_error,
       deleted = excluded.deleted,
       updated_at = excluded.updated_at`
  );

  let upserted = 0;
  let deleted = 0;
  withTransaction(db, () => {
    for (const a of accounts) {
      stmt.run(
        a.id,
        budgetId,
        a.name,
        a.type,
        a.on_budget ? 1 : 0,
        a.closed ? 1 : 0,
        a.note ?? null,
        a.balance,
        a.cleared_balance,
        a.uncleared_balance,
        a.transfer_payee_id ?? null,
        a.direct_import_linked == null ? null : a.direct_import_linked ? 1 : 0,
        a.direct_import_in_error == null ? null : a.direct_import_in_error ? 1 : 0,
        a.deleted ? 1 : 0,
        updatedAt
      );
      if (a.deleted) deleted++;
      else upserted++;
    }
  });
  return { upserted, deleted };
}

function upsertCategories(
  db: Database,
  budgetId: string,
  groups: RemoteCategoryGroup[],
  updatedAt: string
): { upserted: number; deleted: number } {
  const groupStmt = db.prepare(
    `INSERT INTO category_groups (id, budget_id, name, hidden, deleted, updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       budget_id = excluded.budget_id,
       name = excluded.name,
       hidden = excluded.hidden,
       deleted = excluded.deleted,
       updated_at = excluded.updated_at`
  );
  const catStmt = db.prepare(
    `INSERT INTO categories (
       id, budget_id, category_group_id, name, hidden,
       budgeted, activity, balance, goal_type, goal_target,
       deleted, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       budget_id = excluded.budget_id,
       category_group_id = excluded.category_group_id,
       name = excluded.name,
       hidden = excluded.hidden,
       budgeted = excluded.budgeted,
       activity = excluded.activity,
       balance = excluded.balance,
       goal_type = excluded.goal_type,
       goal_target = excluded.goal_target,
       deleted = excluded.deleted,
       updated_at = excluded.updated_at`
  );

  let upserted = 0;
  let deleted = 0;
  withTransaction(db, () => {
    for (const g of groups) {
      groupStmt.run(g.id, budgetId, g.name, g.hidden ? 1 : 0, g.deleted ? 1 : 0, updatedAt);
      if (g.deleted) deleted++;
      else upserted++;
      for (const c of g.categories) {
        upsertCategory(catStmt, budgetId, g.id, c, updatedAt);
        if (c.deleted) deleted++;
        else upserted++;
      }
    }
  });
  return { upserted, deleted };
}

function upsertCategory(
  stmt: ReturnType<Database['prepare']>,
  budgetId: string,
  groupId: string,
  c: RemoteCategory,
  updatedAt: string
): void {
  stmt.run(
    c.id,
    budgetId,
    c.category_group_id || groupId,
    c.name,
    c.hidden ? 1 : 0,
    c.budgeted ?? null,
    c.activity ?? null,
    c.balance ?? null,
    c.goal_type ?? null,
    c.goal_target ?? null,
    c.deleted ? 1 : 0,
    updatedAt
  );
}

function upsertPayees(
  db: Database,
  budgetId: string,
  payees: RemotePayee[],
  updatedAt: string
): { upserted: number; deleted: number } {
  const stmt = db.prepare(
    `INSERT INTO payees (id, budget_id, name, transfer_account_id, deleted, updated_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       budget_id = excluded.budget_id,
       name = excluded.name,
       transfer_account_id = excluded.transfer_account_id,
       deleted = excluded.deleted,
       updated_at = excluded.updated_at`
  );

  let upserted = 0;
  let deleted = 0;
  withTransaction(db, () => {
    for (const p of payees) {
      stmt.run(p.id, budgetId, p.name, p.transfer_account_id ?? null, p.deleted ? 1 : 0, updatedAt);
      if (p.deleted) deleted++;
      else upserted++;
    }
  });
  return { upserted, deleted };
}

function upsertTransactions(
  db: Database,
  budgetId: string,
  transactions: RemoteTransaction[],
  updatedAt: string
): { upserted: number; deleted: number } {
  const txStmt = db.prepare(
    `INSERT INTO transactions (
       id, budget_id, account_id, date, amount, memo, cleared, approved, flag_color,
       payee_id, payee_name, category_id, category_name,
       transfer_account_id, transfer_transaction_id, matched_transaction_id,
       import_id, import_payee_name, import_payee_name_original,
       debt_transaction_type, deleted, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       budget_id = excluded.budget_id,
       account_id = excluded.account_id,
       date = excluded.date,
       amount = excluded.amount,
       memo = excluded.memo,
       cleared = excluded.cleared,
       approved = excluded.approved,
       flag_color = excluded.flag_color,
       payee_id = excluded.payee_id,
       payee_name = excluded.payee_name,
       category_id = excluded.category_id,
       category_name = excluded.category_name,
       transfer_account_id = excluded.transfer_account_id,
       transfer_transaction_id = excluded.transfer_transaction_id,
       matched_transaction_id = excluded.matched_transaction_id,
       import_id = excluded.import_id,
       import_payee_name = excluded.import_payee_name,
       import_payee_name_original = excluded.import_payee_name_original,
       debt_transaction_type = excluded.debt_transaction_type,
       deleted = excluded.deleted,
       updated_at = excluded.updated_at`
  );

  const subStmt = db.prepare(
    `INSERT INTO subtransactions (
       id, transaction_id, amount, memo,
       payee_id, payee_name, category_id, category_name,
       transfer_account_id, transfer_transaction_id, deleted, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       transaction_id = excluded.transaction_id,
       amount = excluded.amount,
       memo = excluded.memo,
       payee_id = excluded.payee_id,
       payee_name = excluded.payee_name,
       category_id = excluded.category_id,
       category_name = excluded.category_name,
       transfer_account_id = excluded.transfer_account_id,
       transfer_transaction_id = excluded.transfer_transaction_id,
       deleted = excluded.deleted,
       updated_at = excluded.updated_at`
  );

  let upserted = 0;
  let deleted = 0;
  withTransaction(db, () => {
    for (const t of transactions) {
      txStmt.run(
        t.id,
        budgetId,
        t.account_id,
        t.date,
        t.amount,
        t.memo ?? null,
        t.cleared,
        t.approved ? 1 : 0,
        t.flag_color ?? null,
        t.payee_id ?? null,
        t.payee_name ?? null,
        t.category_id ?? null,
        t.category_name ?? null,
        t.transfer_account_id ?? null,
        t.transfer_transaction_id ?? null,
        t.matched_transaction_id ?? null,
        t.import_id ?? null,
        t.import_payee_name ?? null,
        t.import_payee_name_original ?? null,
        t.debt_transaction_type ?? null,
        t.deleted ? 1 : 0,
        updatedAt
      );
      if (t.deleted) deleted++;
      else upserted++;
      for (const s of t.subtransactions ?? []) {
        upsertSubtransaction(subStmt, t.id, s, updatedAt);
      }
    }
  });
  return { upserted, deleted };
}

function upsertSubtransaction(
  stmt: ReturnType<Database['prepare']>,
  parentId: string,
  s: RemoteSubtransaction,
  updatedAt: string
): void {
  stmt.run(
    s.id,
    s.transaction_id || parentId,
    s.amount,
    s.memo ?? null,
    s.payee_id ?? null,
    s.payee_name ?? null,
    s.category_id ?? null,
    s.category_name ?? null,
    s.transfer_account_id ?? null,
    s.transfer_transaction_id ?? null,
    s.deleted ? 1 : 0,
    updatedAt
  );
}

function getServerKnowledge(
  db: Database,
  budgetId: string,
  resource: SyncResource
): number | null {
  const row = db
    .prepare('SELECT server_knowledge FROM sync_state WHERE budget_id = ? AND resource = ?')
    .get(budgetId, resource) as { server_knowledge?: number } | undefined;
  return row?.server_knowledge ?? null;
}

function setServerKnowledge(
  db: Database,
  budgetId: string,
  resource: SyncResource,
  serverKnowledge: number,
  syncedAt: string
): void {
  db.prepare(
    `INSERT INTO sync_state (budget_id, resource, server_knowledge, last_synced_at)
     VALUES (?,?,?,?)
     ON CONFLICT(budget_id, resource) DO UPDATE SET
       server_knowledge = excluded.server_knowledge,
       last_synced_at = excluded.last_synced_at`
  ).run(budgetId, resource, serverKnowledge, syncedAt);
}

function clearSyncState(db: Database, budgetId: string): void {
  db.prepare('DELETE FROM sync_state WHERE budget_id = ?').run(budgetId);
}

function withTransaction(db: Database, fn: () => void): void {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export interface SyncStatus {
  budget_id: string;
  budget_name: string | null;
  resources: Array<{
    resource: SyncResource;
    server_knowledge: number;
    last_synced_at: string;
  }>;
  counts: {
    accounts: number;
    category_groups: number;
    categories: number;
    payees: number;
    transactions: number;
  };
}

export function getSyncStatus(db: Database, budgetId: string): SyncStatus {
  const budget = db
    .prepare('SELECT name FROM budgets WHERE id = ?')
    .get(budgetId) as { name?: string } | undefined;

  const resources = db
    .prepare(
      'SELECT resource, server_knowledge, last_synced_at FROM sync_state WHERE budget_id = ? ORDER BY resource'
    )
    .all(budgetId) as unknown as Array<{
    resource: SyncResource;
    server_knowledge: number;
    last_synced_at: string;
  }>;

  const accountCount = (db
    .prepare('SELECT COUNT(*) AS n FROM accounts WHERE budget_id = ? AND deleted = 0')
    .get(budgetId) as { n: number }).n;
  const groupCount = (db
    .prepare('SELECT COUNT(*) AS n FROM category_groups WHERE budget_id = ? AND deleted = 0')
    .get(budgetId) as { n: number }).n;
  const catCount = (db
    .prepare('SELECT COUNT(*) AS n FROM categories WHERE budget_id = ? AND deleted = 0')
    .get(budgetId) as { n: number }).n;
  const payeeCount = (db
    .prepare('SELECT COUNT(*) AS n FROM payees WHERE budget_id = ? AND deleted = 0')
    .get(budgetId) as { n: number }).n;
  const txCount = (db
    .prepare('SELECT COUNT(*) AS n FROM transactions WHERE budget_id = ? AND deleted = 0')
    .get(budgetId) as { n: number }).n;

  return {
    budget_id: budgetId,
    budget_name: budget?.name ?? null,
    resources,
    counts: {
      accounts: accountCount,
      category_groups: groupCount,
      categories: catCount,
      payees: payeeCount,
      transactions: txCount,
    },
  };
}
