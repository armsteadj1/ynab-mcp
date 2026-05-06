import { getYnabClient, resolveBudgetId } from '../ynab-client.js';

export interface CoachCategory {
  id: string;
  category_group_id: string;
  category_group_name?: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
  budgeted: number;
  activity: number;
  balance: number;
  goal_type?: string | null;
  goal_target?: number | null;
  goal_target_month?: string | null;
  goal_under_funded?: number | null;
  goal_overall_left?: number | null;
  goal_percentage_complete?: number | null;
  note?: string | null;
}

export interface CoachCategoryGroup {
  id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
  categories: CoachCategory[];
}

export interface CoachMonth {
  month: string;
  income: number;
  budgeted: number;
  activity: number;
  to_be_budgeted: number;
  age_of_money?: number | null;
  categories: CoachCategory[];
}

export interface CoachTransactionSub {
  id: string;
  amount: number;
  category_id: string | null;
  category_name: string | null;
  payee_id: string | null;
  payee_name: string | null;
  memo: string | null;
  transfer_account_id: string | null;
  deleted: boolean;
}

export interface CoachTransaction {
  id: string;
  date: string;
  amount: number;
  memo: string | null;
  cleared: string;
  approved: boolean;
  flag_color: string | null;
  account_id: string;
  account_name?: string;
  payee_id: string | null;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  transfer_account_id: string | null;
  transfer_transaction_id: string | null;
  matched_transaction_id: string | null;
  import_id: string | null;
  import_payee_name: string | null;
  import_payee_name_original: string | null;
  deleted: boolean;
  subtransactions?: CoachTransactionSub[];
}

export interface CoachScheduledTransaction {
  id: string;
  date_next: string;
  date_first: string;
  frequency: string;
  amount: number;
  memo: string | null;
  account_id: string;
  account_name: string;
  payee_id: string | null;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  transfer_account_id: string | null;
  deleted: boolean;
}

export interface CoachAccount {
  id: string;
  name: string;
  type: string;
  on_budget: boolean;
  closed: boolean;
  balance: number;
  cleared_balance: number;
  uncleared_balance: number;
  deleted: boolean;
}

export interface CoachPayee {
  id: string;
  name: string;
  transfer_account_id: string | null;
  deleted: boolean;
}

export interface YnabCoachReader {
  getBudgetMonth(budgetId: string, month: string): Promise<CoachMonth>;
  getCategories(budgetId: string): Promise<CoachCategoryGroup[]>;
  getTransactions(budgetId: string, sinceDate?: string): Promise<CoachTransaction[]>;
  getScheduledTransactions(budgetId: string): Promise<CoachScheduledTransaction[]>;
  getAccounts(budgetId: string): Promise<CoachAccount[]>;
  getPayees(budgetId: string): Promise<CoachPayee[]>;
}

function mapCategory(c: {
  id: string;
  category_group_id: string;
  category_group_name?: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
  budgeted: number;
  activity: number;
  balance: number;
  goal_type?: string | null;
  goal_target?: number | null;
  goal_target_month?: string | null;
  goal_under_funded?: number | null;
  goal_overall_left?: number | null;
  goal_percentage_complete?: number | null;
  note?: string | null;
}): CoachCategory {
  return {
    id: c.id,
    category_group_id: c.category_group_id,
    category_group_name: c.category_group_name,
    name: c.name,
    hidden: c.hidden,
    deleted: c.deleted,
    budgeted: c.budgeted,
    activity: c.activity,
    balance: c.balance,
    goal_type: c.goal_type ?? null,
    goal_target: c.goal_target ?? null,
    goal_target_month: c.goal_target_month ?? null,
    goal_under_funded: c.goal_under_funded ?? null,
    goal_overall_left: c.goal_overall_left ?? null,
    goal_percentage_complete: c.goal_percentage_complete ?? null,
    note: c.note ?? null,
  };
}

export function createLiveYnabReader(): YnabCoachReader {
  const client = getYnabClient();

  return {
    async getBudgetMonth(budgetId, month) {
      const resolved = resolveBudgetId(budgetId);
      const response = await client.months.getBudgetMonth(resolved, month);
      const m = response.data.month;
      return {
        month: m.month,
        income: m.income,
        budgeted: m.budgeted,
        activity: m.activity,
        to_be_budgeted: m.to_be_budgeted,
        age_of_money: m.age_of_money ?? null,
        categories: (m.categories ?? [])
          .filter((c) => !c.deleted && !c.hidden)
          .map(mapCategory),
      };
    },
    async getCategories(budgetId) {
      const resolved = resolveBudgetId(budgetId);
      const response = await client.categories.getCategories(resolved);
      return response.data.category_groups
        .filter((g) => !g.deleted && !g.hidden)
        .map((g) => ({
          id: g.id,
          name: g.name,
          hidden: g.hidden,
          deleted: g.deleted,
          categories: g.categories
            .filter((c) => !c.deleted && !c.hidden)
            .map((c) => mapCategory({ ...c, category_group_name: g.name })),
        }));
    },
    async getTransactions(budgetId, sinceDate) {
      const resolved = resolveBudgetId(budgetId);
      const response = await client.transactions.getTransactions(resolved, sinceDate);
      return response.data.transactions
        .filter((t) => !t.deleted)
        .map((t) => ({
          id: t.id,
          date: t.date,
          amount: t.amount,
          memo: t.memo ?? null,
          cleared: t.cleared,
          approved: t.approved,
          flag_color: t.flag_color ?? null,
          account_id: t.account_id,
          account_name: t.account_name,
          payee_id: t.payee_id ?? null,
          payee_name: t.payee_name ?? null,
          category_id: t.category_id ?? null,
          category_name: t.category_name ?? null,
          transfer_account_id: t.transfer_account_id ?? null,
          transfer_transaction_id: t.transfer_transaction_id ?? null,
          matched_transaction_id: t.matched_transaction_id ?? null,
          import_id: t.import_id ?? null,
          import_payee_name: t.import_payee_name ?? null,
          import_payee_name_original: t.import_payee_name_original ?? null,
          deleted: t.deleted,
          subtransactions: (t.subtransactions ?? []).map((s) => ({
            id: s.id,
            amount: s.amount,
            category_id: s.category_id ?? null,
            category_name: s.category_name ?? null,
            payee_id: s.payee_id ?? null,
            payee_name: s.payee_name ?? null,
            memo: s.memo ?? null,
            transfer_account_id: s.transfer_account_id ?? null,
            deleted: s.deleted,
          })),
        }));
    },
    async getScheduledTransactions(budgetId) {
      const resolved = resolveBudgetId(budgetId);
      const response = await client.scheduledTransactions.getScheduledTransactions(resolved);
      return response.data.scheduled_transactions
        .filter((s) => !s.deleted)
        .map((s) => ({
          id: s.id,
          date_next: s.date_next,
          date_first: s.date_first,
          frequency: s.frequency,
          amount: s.amount,
          memo: s.memo ?? null,
          account_id: s.account_id,
          account_name: s.account_name,
          payee_id: s.payee_id ?? null,
          payee_name: s.payee_name ?? null,
          category_id: s.category_id ?? null,
          category_name: s.category_name ?? null,
          transfer_account_id: s.transfer_account_id ?? null,
          deleted: s.deleted,
        }));
    },
    async getAccounts(budgetId) {
      const resolved = resolveBudgetId(budgetId);
      const response = await client.accounts.getAccounts(resolved);
      return response.data.accounts
        .filter((a) => !a.deleted)
        .map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          on_budget: a.on_budget,
          closed: a.closed,
          balance: a.balance,
          cleared_balance: a.cleared_balance,
          uncleared_balance: a.uncleared_balance,
          deleted: a.deleted,
        }));
    },
    async getPayees(budgetId) {
      const resolved = resolveBudgetId(budgetId);
      const response = await client.payees.getPayees(resolved);
      return response.data.payees
        .filter((p) => !p.deleted)
        .map((p) => ({
          id: p.id,
          name: p.name,
          transfer_account_id: p.transfer_account_id ?? null,
          deleted: p.deleted,
        }));
    },
  };
}

let cachedReader: YnabCoachReader | null = null;

export function getCoachReader(): YnabCoachReader {
  if (!cachedReader) {
    cachedReader = createLiveYnabReader();
  }
  return cachedReader;
}

export function setCoachReader(reader: YnabCoachReader | null): void {
  cachedReader = reader;
}
