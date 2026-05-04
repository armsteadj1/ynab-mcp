import type {
  CoachAccount,
  CoachCategory,
  CoachCategoryGroup,
  CoachMonth,
  CoachPayee,
  CoachScheduledTransaction,
  CoachTransaction,
  YnabCoachReader,
} from '../budget-coach/reader.js';

export interface CoachFakeData {
  budgetId: string;
  monthsByMonth: Record<string, CoachMonth>;
  categories: CoachCategoryGroup[];
  transactions: CoachTransaction[];
  scheduled: CoachScheduledTransaction[];
  accounts: CoachAccount[];
  payees: CoachPayee[];
}

export interface CoachFakeReader extends YnabCoachReader {
  data: CoachFakeData;
  callLog: string[];
}

export function createCoachFakeReader(data: CoachFakeData): CoachFakeReader {
  const callLog: string[] = [];
  return {
    data,
    callLog,
    async getBudgetMonth(budgetId, month) {
      callLog.push(`getBudgetMonth:${budgetId}:${month}`);
      const key = month.slice(0, 7);
      const m = data.monthsByMonth[key];
      if (!m) {
        throw new Error(`No fake month for ${key}`);
      }
      return m;
    },
    async getCategories(budgetId) {
      callLog.push(`getCategories:${budgetId}`);
      return data.categories;
    },
    async getTransactions(budgetId, sinceDate) {
      callLog.push(`getTransactions:${budgetId}:${sinceDate ?? 'none'}`);
      const filtered = sinceDate
        ? data.transactions.filter((t) => t.date >= sinceDate)
        : data.transactions;
      return filtered.map((t) => ({ ...t }));
    },
    async getScheduledTransactions(budgetId) {
      callLog.push(`getScheduledTransactions:${budgetId}`);
      return data.scheduled.map((s) => ({ ...s }));
    },
    async getAccounts(budgetId) {
      callLog.push(`getAccounts:${budgetId}`);
      return data.accounts.map((a) => ({ ...a }));
    },
    async getPayees(budgetId) {
      callLog.push(`getPayees:${budgetId}`);
      return data.payees.map((p) => ({ ...p }));
    },
  };
}

export function makeCategory(
  id: string,
  groupId: string,
  name: string,
  overrides: Partial<CoachCategory> = {}
): CoachCategory {
  return {
    id,
    category_group_id: groupId,
    name,
    hidden: false,
    deleted: false,
    budgeted: 0,
    activity: 0,
    balance: 0,
    goal_type: null,
    goal_target: null,
    goal_under_funded: null,
    goal_overall_left: null,
    goal_target_month: null,
    goal_percentage_complete: null,
    note: null,
    ...overrides,
  };
}

export function makeGroup(
  id: string,
  name: string,
  categories: CoachCategory[]
): CoachCategoryGroup {
  return {
    id,
    name,
    hidden: false,
    deleted: false,
    categories,
  };
}

export function makeTransaction(
  id: string,
  overrides: Partial<CoachTransaction> = {}
): CoachTransaction {
  return {
    id,
    date: '2026-05-01',
    amount: -10_000,
    memo: null,
    cleared: 'cleared',
    approved: true,
    flag_color: null,
    account_id: 'acct-credit',
    account_name: 'Visa',
    payee_id: null,
    payee_name: null,
    category_id: null,
    category_name: null,
    transfer_account_id: null,
    transfer_transaction_id: null,
    matched_transaction_id: null,
    import_id: null,
    import_payee_name: null,
    import_payee_name_original: null,
    deleted: false,
    subtransactions: [],
    ...overrides,
  };
}

export function makeScheduled(
  id: string,
  overrides: Partial<CoachScheduledTransaction> = {}
): CoachScheduledTransaction {
  return {
    id,
    date_first: '2026-05-15',
    date_next: '2026-05-15',
    frequency: 'monthly',
    amount: -50_000,
    memo: null,
    account_id: 'acct-checking',
    account_name: 'Checking',
    payee_id: null,
    payee_name: null,
    category_id: null,
    category_name: null,
    transfer_account_id: null,
    deleted: false,
    ...overrides,
  };
}
