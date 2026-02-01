import { getYnabClient, resolveBudgetId } from '../ynab-client.js';
import { milliunitsToDollars, formatCurrency } from '../utils/milliunits.js';

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  amount_formatted: string;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  memo: string | null;
  cleared: string;
  approved: boolean;
  account_id: string;
  account_name: string;
}

export interface CategorySpending {
  category_id: string | null;
  category_name: string;
  category_group_name: string | null;
  transaction_count: number;
  total_spent: number;
  total_spent_formatted: string;
  average_transaction: number;
  average_transaction_formatted: string;
}

export interface IncomeSource {
  payee_name: string;
  transaction_count: number;
  total_income: number;
  total_income_formatted: string;
}

export interface IncomeSummary {
  total_income: number;
  total_income_formatted: string;
  transaction_count: number;
  sources: IncomeSource[];
}

/**
 * Get all transactions for all accounts within a date range
 */
export async function getTransactionsByDateRange(
  startDate: string,
  endDate?: string,
  budgetId?: string
): Promise<Transaction[]> {
  const client = getYnabClient();
  const resolvedBudgetId = resolveBudgetId(budgetId);

  const response = await client.transactions.getTransactions(
    resolvedBudgetId,
    startDate,
    undefined // type filter
  );

  // Filter by end date if provided
  const transactions = response.data.transactions
    .filter(tx => {
      if (endDate) {
        return tx.date >= startDate && tx.date <= endDate;
      }
      return tx.date >= startDate;
    })
    .map(tx => ({
      id: tx.id,
      date: tx.date,
      amount: milliunitsToDollars(tx.amount),
      amount_formatted: formatCurrency(tx.amount),
      payee_name: tx.payee_name || null,
      category_id: tx.category_id || null,
      category_name: tx.category_name || null,
      memo: tx.memo || null,
      cleared: tx.cleared,
      approved: tx.approved,
      account_id: tx.account_id,
      account_name: tx.account_name,
    }));

  return transactions;
}

/**
 * Get spending aggregated by category for a date range
 * Excludes positive transactions (income/refunds) and focuses on spending
 */
export async function getSpendingByCategory(
  startDate: string,
  endDate?: string,
  budgetId?: string
): Promise<CategorySpending[]> {
  const transactions = await getTransactionsByDateRange(startDate, endDate, budgetId);

  // Filter to only spending (negative amounts) and exclude transfers
  const spendingTransactions = transactions.filter(
    tx => tx.amount < 0 && tx.category_name !== null
  );

  // Group by category
  const categoryMap = new Map<string, {
    category_id: string | null;
    category_name: string;
    category_group_name: string | null;
    transactions: Transaction[];
  }>();

  for (const tx of spendingTransactions) {
    const key = tx.category_id || 'uncategorized';

    if (!categoryMap.has(key)) {
      categoryMap.set(key, {
        category_id: tx.category_id,
        category_name: tx.category_name || 'Uncategorized',
        category_group_name: null, // We'd need to fetch this separately
        transactions: [],
      });
    }

    categoryMap.get(key)!.transactions.push(tx);
  }

  // Convert to summary array and sort by total spent
  const categorySummaries: CategorySpending[] = Array.from(categoryMap.values())
    .map(cat => {
      const totalSpent = Math.abs(
        cat.transactions.reduce((sum, tx) => sum + tx.amount, 0)
      );
      const avgTransaction = totalSpent / cat.transactions.length;

      return {
        category_id: cat.category_id,
        category_name: cat.category_name,
        category_group_name: cat.category_group_name,
        transaction_count: cat.transactions.length,
        total_spent: totalSpent,
        total_spent_formatted: formatCurrency(totalSpent * 1000), // Convert back to milliunits for formatting
        average_transaction: avgTransaction,
        average_transaction_formatted: formatCurrency(avgTransaction * 1000),
      };
    })
    .sort((a, b) => b.total_spent - a.total_spent);

  return categorySummaries;
}

/**
 * Get income summary for a date range
 * Includes all positive transactions (income)
 */
export async function getIncomeSummary(
  startDate: string,
  endDate?: string,
  budgetId?: string
): Promise<IncomeSummary> {
  const transactions = await getTransactionsByDateRange(startDate, endDate, budgetId);

  // Filter to only income (positive amounts)
  const incomeTransactions = transactions.filter(tx => tx.amount > 0);

  // Group by payee
  const payeeMap = new Map<string, Transaction[]>();

  for (const tx of incomeTransactions) {
    const payeeName = tx.payee_name || 'Unknown';

    if (!payeeMap.has(payeeName)) {
      payeeMap.set(payeeName, []);
    }

    payeeMap.get(payeeName)!.push(tx);
  }

  // Convert to sources array and sort by total income
  const sources: IncomeSource[] = Array.from(payeeMap.entries())
    .map(([payeeName, txs]) => {
      const totalIncome = txs.reduce((sum, tx) => sum + tx.amount, 0);

      return {
        payee_name: payeeName,
        transaction_count: txs.length,
        total_income: totalIncome,
        total_income_formatted: formatCurrency(totalIncome * 1000),
      };
    })
    .sort((a, b) => b.total_income - a.total_income);

  const totalIncome = incomeTransactions.reduce((sum, tx) => sum + tx.amount, 0);

  return {
    total_income: totalIncome,
    total_income_formatted: formatCurrency(totalIncome * 1000),
    transaction_count: incomeTransactions.length,
    sources,
  };
}
