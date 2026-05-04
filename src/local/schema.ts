export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  last_modified_on TEXT,
  first_month TEXT,
  last_month TEXT,
  currency_iso_code TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  on_budget INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  balance INTEGER NOT NULL DEFAULT 0,
  cleared_balance INTEGER NOT NULL DEFAULT 0,
  uncleared_balance INTEGER NOT NULL DEFAULT 0,
  transfer_payee_id TEXT,
  direct_import_linked INTEGER,
  direct_import_in_error INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_budget ON accounts(budget_id);

CREATE TABLE IF NOT EXISTS category_groups (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  name TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_category_groups_budget ON category_groups(budget_id);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  category_group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  budgeted INTEGER,
  activity INTEGER,
  balance INTEGER,
  goal_type TEXT,
  goal_target INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_categories_budget ON categories(budget_id);
CREATE INDEX IF NOT EXISTS idx_categories_group ON categories(category_group_id);

CREATE TABLE IF NOT EXISTS payees (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  name TEXT NOT NULL,
  transfer_account_id TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payees_budget ON payees(budget_id);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  memo TEXT,
  cleared TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  flag_color TEXT,
  payee_id TEXT,
  payee_name TEXT,
  category_id TEXT,
  category_name TEXT,
  transfer_account_id TEXT,
  transfer_transaction_id TEXT,
  matched_transaction_id TEXT,
  import_id TEXT,
  import_payee_name TEXT,
  import_payee_name_original TEXT,
  debt_transaction_type TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transactions_budget_date ON transactions(budget_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_deleted ON transactions(deleted);

CREATE TABLE IF NOT EXISTS subtransactions (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  memo TEXT,
  payee_id TEXT,
  payee_name TEXT,
  category_id TEXT,
  category_name TEXT,
  transfer_account_id TEXT,
  transfer_transaction_id TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subtransactions_tx ON subtransactions(transaction_id);

CREATE TABLE IF NOT EXISTS sync_state (
  budget_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  server_knowledge INTEGER NOT NULL,
  last_synced_at TEXT NOT NULL,
  PRIMARY KEY (budget_id, resource)
);
`;
