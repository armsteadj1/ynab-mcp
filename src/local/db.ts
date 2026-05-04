import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';

export type Database = DatabaseSync;

export function defaultDbPath(): string {
  const override = process.env.YNAB_LOCAL_DB_PATH;
  if (override && override.trim().length > 0) return override;
  return join(homedir(), '.ynab-mcp', 'ynab.db');
}

export interface OpenDbOptions {
  path?: string;
}

export function openDb(opts: OpenDbOptions = {}): Database {
  const path = opts.path ?? defaultDbPath();
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  return db;
}

function initSchema(db: Database): void {
  db.exec(SCHEMA_SQL);
  const row = db
    .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'")
    .get() as { value?: string } | undefined;
  if (!row) {
    db.prepare(
      "INSERT INTO schema_meta(key, value) VALUES ('schema_version', ?)"
    ).run(String(SCHEMA_VERSION));
  }
}

export function resetBudgetData(db: Database, budgetId: string): void {
  const tables = [
    'subtransactions',
    'transactions',
    'categories',
    'category_groups',
    'payees',
    'accounts',
    'sync_state',
  ];
  const tx = db.prepare('BEGIN');
  const commit = db.prepare('COMMIT');
  const rollback = db.prepare('ROLLBACK');
  tx.run();
  try {
    db.prepare(
      'DELETE FROM subtransactions WHERE transaction_id IN (SELECT id FROM transactions WHERE budget_id = ?)'
    ).run(budgetId);
    for (const table of tables) {
      if (table === 'subtransactions') continue;
      db.prepare(`DELETE FROM ${table} WHERE budget_id = ?`).run(budgetId);
    }
    db.prepare('DELETE FROM budgets WHERE id = ?').run(budgetId);
    commit.run();
  } catch (err) {
    rollback.run();
    throw err;
  }
}
