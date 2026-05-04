import * as ynab from 'ynab';
import { getYnabClient } from '../ynab-client.js';
import type {
  BudgetMeta,
  DeltaResponse,
  RemoteAccount,
  RemoteCategory,
  RemoteCategoryGroup,
  RemotePayee,
  RemoteSubtransaction,
  RemoteTransaction,
  YnabSyncClient,
} from './types.js';

export function createYnabSyncClient(api: ynab.API = getYnabClient()): YnabSyncClient {
  return {
    async getBudgets(): Promise<BudgetMeta[]> {
      const response = await api.budgets.getBudgets();
      return response.data.budgets.map((b) => ({
        id: b.id,
        name: b.name,
        last_modified_on: b.last_modified_on ?? null,
        first_month: b.first_month ?? null,
        last_month: b.last_month ?? null,
        currency_iso_code: b.currency_format?.iso_code ?? null,
      }));
    },

    async getAccounts(budgetId, last) {
      const response = await api.accounts.getAccounts(budgetId, last);
      return {
        data: response.data.accounts.map((a): RemoteAccount => ({
          id: a.id,
          name: a.name,
          type: a.type,
          on_budget: a.on_budget,
          closed: a.closed,
          note: a.note ?? null,
          balance: a.balance,
          cleared_balance: a.cleared_balance,
          uncleared_balance: a.uncleared_balance,
          transfer_payee_id: a.transfer_payee_id ?? null,
          direct_import_linked: a.direct_import_linked ?? null,
          direct_import_in_error: a.direct_import_in_error ?? null,
          deleted: a.deleted,
        })),
        server_knowledge: response.data.server_knowledge,
      };
    },

    async getCategories(budgetId, last) {
      const response = await api.categories.getCategories(budgetId, last);
      const groups: RemoteCategoryGroup[] = response.data.category_groups.map((g) => ({
        id: g.id,
        name: g.name,
        hidden: g.hidden,
        deleted: g.deleted,
        categories: (g.categories ?? []).map(
          (c): RemoteCategory => ({
            id: c.id,
            category_group_id: c.category_group_id,
            name: c.name,
            hidden: c.hidden,
            budgeted: c.budgeted ?? null,
            activity: c.activity ?? null,
            balance: c.balance ?? null,
            goal_type: c.goal_type ?? null,
            goal_target: c.goal_target ?? null,
            deleted: c.deleted,
          })
        ),
      }));
      return { data: groups, server_knowledge: response.data.server_knowledge };
    },

    async getPayees(budgetId, last) {
      const response = await api.payees.getPayees(budgetId, last);
      return {
        data: response.data.payees.map((p): RemotePayee => ({
          id: p.id,
          name: p.name,
          transfer_account_id: p.transfer_account_id ?? null,
          deleted: p.deleted,
        })),
        server_knowledge: response.data.server_knowledge,
      };
    },

    async getTransactions(budgetId, last): Promise<DeltaResponse<RemoteTransaction[]>> {
      const response = await api.transactions.getTransactions(budgetId, undefined, undefined, last);
      const data = response.data.transactions.map((t): RemoteTransaction => ({
        id: t.id,
        date: t.date,
        amount: t.amount,
        memo: t.memo ?? null,
        cleared: t.cleared,
        approved: t.approved,
        flag_color: t.flag_color ?? null,
        account_id: t.account_id,
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
        debt_transaction_type: t.debt_transaction_type ?? null,
        deleted: t.deleted,
        subtransactions: (t.subtransactions ?? []).map((s): RemoteSubtransaction => ({
          id: s.id,
          transaction_id: s.transaction_id,
          amount: s.amount,
          memo: s.memo ?? null,
          payee_id: s.payee_id ?? null,
          payee_name: s.payee_name ?? null,
          category_id: s.category_id ?? null,
          category_name: s.category_name ?? null,
          transfer_account_id: s.transfer_account_id ?? null,
          transfer_transaction_id: s.transfer_transaction_id ?? null,
          deleted: s.deleted,
        })),
      }));
      return { data, server_knowledge: response.data.server_knowledge };
    },
  };
}
