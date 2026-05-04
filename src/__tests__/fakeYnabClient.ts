import type {
  BudgetMeta,
  DeltaResponse,
  RemoteAccount,
  RemoteCategoryGroup,
  RemotePayee,
  RemoteTransaction,
  YnabSyncClient,
} from '../local/types.js';

export interface FakeBudgetData {
  budget: BudgetMeta;
  accounts: RemoteAccount[];
  categories: RemoteCategoryGroup[];
  payees: RemotePayee[];
  transactions: RemoteTransaction[];
}

export interface FakeServerKnowledge {
  accounts: number;
  categories: number;
  payees: number;
  transactions: number;
}

export interface FakeYnabClient extends YnabSyncClient {
  setData(data: FakeBudgetData): void;
  setServerKnowledge(sk: Partial<FakeServerKnowledge>): void;
  callLog(): string[];
  reset(): void;
}

export function createFakeYnabClient(initial: FakeBudgetData): FakeYnabClient {
  let current: FakeBudgetData = initial;
  let sk: FakeServerKnowledge = {
    accounts: 1,
    categories: 1,
    payees: 1,
    transactions: 1,
  };
  const calls: string[] = [];

  return {
    setData(data) {
      current = data;
    },
    setServerKnowledge(next) {
      sk = { ...sk, ...next };
    },
    callLog() {
      return [...calls];
    },
    reset() {
      calls.length = 0;
    },
    async getBudgets(): Promise<BudgetMeta[]> {
      calls.push('getBudgets');
      return [current.budget];
    },
    async getAccounts(_budgetId, last): Promise<DeltaResponse<RemoteAccount[]>> {
      calls.push(`getAccounts:${last ?? 'none'}`);
      return { data: current.accounts, server_knowledge: sk.accounts };
    },
    async getCategories(
      _budgetId,
      last
    ): Promise<DeltaResponse<RemoteCategoryGroup[]>> {
      calls.push(`getCategories:${last ?? 'none'}`);
      return { data: current.categories, server_knowledge: sk.categories };
    },
    async getPayees(_budgetId, last): Promise<DeltaResponse<RemotePayee[]>> {
      calls.push(`getPayees:${last ?? 'none'}`);
      return { data: current.payees, server_knowledge: sk.payees };
    },
    async getTransactions(
      _budgetId,
      last
    ): Promise<DeltaResponse<RemoteTransaction[]>> {
      calls.push(`getTransactions:${last ?? 'none'}`);
      return { data: current.transactions, server_knowledge: sk.transactions };
    },
  };
}
