export interface BudgetMeta {
  id: string;
  name: string;
  last_modified_on?: string | null;
  first_month?: string | null;
  last_month?: string | null;
  currency_iso_code?: string | null;
}

export interface RemoteAccount {
  id: string;
  name: string;
  type: string;
  on_budget: boolean;
  closed: boolean;
  note?: string | null;
  balance: number;
  cleared_balance: number;
  uncleared_balance: number;
  transfer_payee_id?: string | null;
  direct_import_linked?: boolean | null;
  direct_import_in_error?: boolean | null;
  deleted: boolean;
}

export interface RemoteCategoryGroup {
  id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
  categories: RemoteCategory[];
}

export interface RemoteCategory {
  id: string;
  category_group_id: string;
  name: string;
  hidden: boolean;
  budgeted?: number | null;
  activity?: number | null;
  balance?: number | null;
  goal_type?: string | null;
  goal_target?: number | null;
  deleted: boolean;
}

export interface RemotePayee {
  id: string;
  name: string;
  transfer_account_id?: string | null;
  deleted: boolean;
}

export interface RemoteSubtransaction {
  id: string;
  transaction_id: string;
  amount: number;
  memo?: string | null;
  payee_id?: string | null;
  payee_name?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  transfer_account_id?: string | null;
  transfer_transaction_id?: string | null;
  deleted: boolean;
}

export interface RemoteTransaction {
  id: string;
  date: string;
  amount: number;
  memo?: string | null;
  cleared: string;
  approved: boolean;
  flag_color?: string | null;
  account_id: string;
  payee_id?: string | null;
  payee_name?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  transfer_account_id?: string | null;
  transfer_transaction_id?: string | null;
  matched_transaction_id?: string | null;
  import_id?: string | null;
  import_payee_name?: string | null;
  import_payee_name_original?: string | null;
  debt_transaction_type?: string | null;
  deleted: boolean;
  subtransactions?: RemoteSubtransaction[];
}

export interface DeltaResponse<T> {
  data: T;
  server_knowledge: number;
}

export interface YnabSyncClient {
  getBudgets(): Promise<BudgetMeta[]>;
  getAccounts(
    budgetId: string,
    lastKnowledgeOfServer?: number
  ): Promise<DeltaResponse<RemoteAccount[]>>;
  getCategories(
    budgetId: string,
    lastKnowledgeOfServer?: number
  ): Promise<DeltaResponse<RemoteCategoryGroup[]>>;
  getPayees(
    budgetId: string,
    lastKnowledgeOfServer?: number
  ): Promise<DeltaResponse<RemotePayee[]>>;
  getTransactions(
    budgetId: string,
    lastKnowledgeOfServer?: number
  ): Promise<DeltaResponse<RemoteTransaction[]>>;
}

export type SyncResource = 'accounts' | 'categories' | 'payees' | 'transactions';

export interface ResourceSyncResult {
  resource: SyncResource;
  fetched: number;
  upserted: number;
  deleted: number;
  server_knowledge: number;
  previous_server_knowledge: number | null;
}

export interface SyncResult {
  budget_id: string;
  budget_name: string;
  started_at: string;
  finished_at: string;
  resources: ResourceSyncResult[];
}
