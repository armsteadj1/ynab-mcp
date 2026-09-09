import { getYnabClient, resolveBudgetId } from '../ynab-client.js';
import { dollarsToMilliunits, milliunitsToDollars, formatCurrency } from '../utils/milliunits.js';
import type { SaveTransactionWithOptionalFields, TransactionClearedStatus } from 'ynab';

export interface Subtransaction {
  category_id: string;
  amount: number; // in dollars
  memo?: string;
}

export interface TransactionInput {
  date: string;
  amount: number; // in dollars - for split transactions, this should equal the sum of all subtransactions
  payee_name: string;
  category_id?: string; // cannot be used with subtransactions
  memo?: string;
  cleared?: boolean;
  subtransactions?: Subtransaction[]; // mutually exclusive with category_id - used to split a transaction across multiple categories
}

export interface SubtransactionResult {
  id: string;
  category_id: string | null;
  category_name: string | null;
  amount: number;
  amount_formatted: string;
  memo: string | null;
}

export interface TransactionResult {
  id: string;
  date: string;
  amount: number;
  amount_formatted: string;
  payee_name: string | null;
  category_name: string | null;
  memo: string | null;
  cleared: string;
  approved: boolean;
  subtransactions?: SubtransactionResult[];
}

export interface UnclearedTransaction {
  id: string;
  date: string;
  amount: number;
  amount_formatted: string;
  payee_name: string | null;
  category_name: string | null;
  memo: string | null;
}

export async function createTransaction(
  accountId: string,
  transaction: TransactionInput,
  budgetId?: string
): Promise<TransactionResult> {
  const client = getYnabClient();
  const resolvedBudgetId = resolveBudgetId(budgetId);

  // Validate that category_id and subtransactions are mutually exclusive
  if (transaction.category_id && transaction.subtransactions) {
    throw new Error('Cannot specify both category_id and subtransactions. Use subtransactions to split a transaction across multiple categories.');
  }

  const clearedStatus: TransactionClearedStatus = transaction.cleared !== false ? 'cleared' : 'uncleared';

  const saveTransaction: SaveTransactionWithOptionalFields = {
    account_id: accountId,
    date: transaction.date,
    amount: dollarsToMilliunits(transaction.amount),
    payee_name: transaction.payee_name,
    category_id: transaction.category_id || undefined,
    memo: transaction.memo || undefined,
    cleared: clearedStatus,
    approved: false,
  };

  // Add subtransactions if provided
  if (transaction.subtransactions && transaction.subtransactions.length > 0) {
    saveTransaction.subtransactions = transaction.subtransactions.map(subtx => ({
      amount: dollarsToMilliunits(subtx.amount),
      category_id: subtx.category_id,
      memo: subtx.memo || undefined,
    }));
    // For split transactions, don't set category_id on the parent
    delete saveTransaction.category_id;
  }

  const response = await client.transactions.createTransaction(resolvedBudgetId, {
    transaction: saveTransaction,
  });

  const created = response.data.transaction;
  if (!created) {
    throw new Error('Transaction was not created');
  }

  const result: TransactionResult = {
    id: created.id,
    date: created.date,
    amount: milliunitsToDollars(created.amount),
    amount_formatted: formatCurrency(created.amount),
    payee_name: created.payee_name || null,
    category_name: created.category_name || null,
    memo: created.memo || null,
    cleared: created.cleared,
    approved: created.approved,
  };

  // Add subtransactions to result if present
  if (created.subtransactions && created.subtransactions.length > 0) {
    result.subtransactions = created.subtransactions.map(sub => ({
      id: sub.id,
      category_id: sub.category_id || null,
      category_name: sub.category_name || null,
      amount: milliunitsToDollars(sub.amount),
      amount_formatted: formatCurrency(sub.amount),
      memo: sub.memo || null,
    }));
  }

  return result;
}

export async function createTransactionsBatch(
  accountId: string,
  transactions: TransactionInput[],
  budgetId?: string
): Promise<{ created: TransactionResult[]; duplicate_import_ids: string[] }> {
  const client = getYnabClient();
  const resolvedBudgetId = resolveBudgetId(budgetId);

  const saveTransactions: SaveTransactionWithOptionalFields[] = transactions.map(tx => {
    // Validate that category_id and subtransactions are mutually exclusive
    if (tx.category_id && tx.subtransactions) {
      throw new Error('Cannot specify both category_id and subtransactions. Use subtransactions to split a transaction across multiple categories.');
    }

    const clearedStatus: TransactionClearedStatus = tx.cleared !== false ? 'cleared' : 'uncleared';
    const saveTransaction: SaveTransactionWithOptionalFields = {
      account_id: accountId,
      date: tx.date,
      amount: dollarsToMilliunits(tx.amount),
      payee_name: tx.payee_name,
      category_id: tx.category_id || undefined,
      memo: tx.memo || undefined,
      cleared: clearedStatus,
      approved: false,
    };

    // Add subtransactions if provided
    if (tx.subtransactions && tx.subtransactions.length > 0) {
      saveTransaction.subtransactions = tx.subtransactions.map(subtx => ({
        amount: dollarsToMilliunits(subtx.amount),
        category_id: subtx.category_id,
        memo: subtx.memo || undefined,
      }));
      // For split transactions, don't set category_id on the parent
      delete saveTransaction.category_id;
    }

    return saveTransaction;
  });

  const response = await client.transactions.createTransactions(resolvedBudgetId, {
    transactions: saveTransactions,
  });

  const created = (response.data.transactions || []).map(tx => {
    const result: TransactionResult = {
      id: tx.id,
      date: tx.date,
      amount: milliunitsToDollars(tx.amount),
      amount_formatted: formatCurrency(tx.amount),
      payee_name: tx.payee_name || null,
      category_name: tx.category_name || null,
      memo: tx.memo || null,
      cleared: tx.cleared,
      approved: tx.approved,
    };

    // Add subtransactions to result if present
    if (tx.subtransactions && tx.subtransactions.length > 0) {
      result.subtransactions = tx.subtransactions.map(sub => ({
        id: sub.id,
        category_id: sub.category_id || null,
        category_name: sub.category_name || null,
        amount: milliunitsToDollars(sub.amount),
        amount_formatted: formatCurrency(sub.amount),
        memo: sub.memo || null,
      }));
    }

    return result;
  });

  return {
    created,
    duplicate_import_ids: response.data.duplicate_import_ids || [],
  };
}

export async function getUnclearedTransactions(
  accountId: string,
  budgetId?: string
): Promise<UnclearedTransaction[]> {
  const client = getYnabClient();
  const resolvedBudgetId = resolveBudgetId(budgetId);

  const response = await client.transactions.getTransactionsByAccount(
    resolvedBudgetId,
    accountId
  );

  return response.data.transactions
    .filter(tx => tx.cleared === 'uncleared')
    .map(tx => ({
      id: tx.id,
      date: tx.date,
      amount: milliunitsToDollars(tx.amount),
      amount_formatted: formatCurrency(tx.amount),
      payee_name: tx.payee_name || null,
      category_name: tx.category_name || null,
      memo: tx.memo || null,
    }));
}

export interface PendingTransaction {
  id: string;
  date: string;
  amount: number;
  amount_formatted: string;
  payee_name: string | null;
  category_name: string | null;
  memo: string | null;
  account_id: string;
  account_name: string;
}

export async function getPendingTransactions(
  accountId: string,
  budgetId?: string,
  sinceDate?: string
): Promise<PendingTransaction[]> {
  const client = getYnabClient();
  const resolvedBudgetId = resolveBudgetId(budgetId);

  const response = await client.transactions.getTransactionsByAccount(
    resolvedBudgetId,
    accountId,
    sinceDate
  );

  return response.data.transactions
    .filter(tx => tx.cleared === 'uncleared')
    .map(tx => ({
      id: tx.id,
      date: tx.date,
      amount: milliunitsToDollars(tx.amount),
      amount_formatted: formatCurrency(tx.amount),
      payee_name: tx.payee_name || null,
      category_name: tx.category_name || null,
      memo: tx.memo || null,
      account_id: tx.account_id,
      account_name: tx.account_name,
    }));
}

export interface ClearedTransaction {
  id: string;
  date: string;
  amount: number;
  amount_formatted: string;
  payee_name: string | null;
  category_name: string | null;
  memo: string | null;
}

export async function getClearedTransactions(
  accountId: string,
  budgetId?: string,
  sinceDate?: string
): Promise<ClearedTransaction[]> {
  const client = getYnabClient();
  const resolvedBudgetId = resolveBudgetId(budgetId);

  const response = await client.transactions.getTransactionsByAccount(
    resolvedBudgetId,
    accountId,
    sinceDate
  );

  return response.data.transactions
    .filter(tx => tx.cleared === 'cleared' || tx.cleared === 'reconciled')
    .map(tx => ({
      id: tx.id,
      date: tx.date,
      amount: milliunitsToDollars(tx.amount),
      amount_formatted: formatCurrency(tx.amount),
      payee_name: tx.payee_name || null,
      category_name: tx.category_name || null,
      memo: tx.memo || null,
    }));
}

export async function clearTransaction(
  transactionId: string,
  budgetId?: string
): Promise<TransactionResult> {
  const client = getYnabClient();
  const resolvedBudgetId = resolveBudgetId(budgetId);

  const response = await client.transactions.updateTransaction(
    resolvedBudgetId,
    transactionId,
    {
      transaction: {
        cleared: 'cleared' as TransactionClearedStatus,
      },
    }
  );

  const updated = response.data.transaction;

  return {
    id: updated.id,
    date: updated.date,
    amount: milliunitsToDollars(updated.amount),
    amount_formatted: formatCurrency(updated.amount),
    payee_name: updated.payee_name || null,
    category_name: updated.category_name || null,
    memo: updated.memo || null,
    cleared: updated.cleared,
    approved: updated.approved,
  };
}

export interface TransactionUpdate {
  amount?: number; // in dollars
  date?: string;
  payee_name?: string;
  category_id?: string; // cannot be used with subtransactions
  memo?: string;
  cleared?: boolean;
  subtransactions?: Subtransaction[]; // mutually exclusive with category_id - used to split a transaction across multiple categories
}

export async function updateTransaction(
  transactionId: string,
  updates: TransactionUpdate,
  budgetId?: string
): Promise<TransactionResult> {
  const client = getYnabClient();
  const resolvedBudgetId = resolveBudgetId(budgetId);

  const transactionUpdate: Record<string, unknown> = {};

  if (updates.amount !== undefined) {
    transactionUpdate.amount = dollarsToMilliunits(updates.amount);
  }
  if (updates.date !== undefined) {
    transactionUpdate.date = updates.date;
  }
  if (updates.payee_name !== undefined) {
    transactionUpdate.payee_name = updates.payee_name;
  }
  if (updates.category_id !== undefined) {
    transactionUpdate.category_id = updates.category_id;
  }
  if (updates.memo !== undefined) {
    transactionUpdate.memo = updates.memo;
  }
  if (updates.cleared !== undefined) {
    transactionUpdate.cleared = updates.cleared ? 'cleared' : 'uncleared';
  }

  // Handle subtransactions
  if (updates.subtransactions && updates.subtransactions.length > 0) {
    transactionUpdate.subtransactions = updates.subtransactions.map(subtx => ({
      amount: dollarsToMilliunits(subtx.amount),
      category_id: subtx.category_id,
      memo: subtx.memo || undefined,
    }));
    // For split transactions, don't set category_id on the parent
    delete transactionUpdate.category_id;
  }

  const response = await client.transactions.updateTransaction(
    resolvedBudgetId,
    transactionId,
    {
      transaction: transactionUpdate,
    }
  );

  const updated = response.data.transaction;

  const result: TransactionResult = {
    id: updated.id,
    date: updated.date,
    amount: milliunitsToDollars(updated.amount),
    amount_formatted: formatCurrency(updated.amount),
    payee_name: updated.payee_name || null,
    category_name: updated.category_name || null,
    memo: updated.memo || null,
    cleared: updated.cleared,
    approved: updated.approved,
  };

  // Include subtransactions in the result if they exist
  if (updated.subtransactions && updated.subtransactions.length > 0) {
    result.subtransactions = updated.subtransactions.map(sub => ({
      id: sub.id,
      category_id: sub.category_id || null,
      category_name: sub.category_name || null,
      amount: milliunitsToDollars(sub.amount),
      amount_formatted: formatCurrency(sub.amount),
      memo: sub.memo || null,
    }));
  }

  return result;
}
