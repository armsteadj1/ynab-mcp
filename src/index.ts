#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { formatCurrency } from './utils/milliunits.js';

function formatError(error: unknown): string {
  // YNAB ResponseError has an 'error' property that contains the actual error details
  const ynabError = error as { error?: { detail?: string; name?: string; id?: string } };
  if (ynabError?.error?.detail) {
    return ynabError.error.detail;
  }
  if (ynabError?.error?.name) {
    return ynabError.error.name;
  }
  if (error instanceof Error) {
    // Check if message is an object (YNAB sometimes does this)
    if (typeof error.message === 'object') {
      return JSON.stringify(error.message);
    }
    return error.message;
  }
  if (typeof error === 'object' && error !== null) {
    return JSON.stringify(error);
  }
  return String(error);
}

import { listBudgets } from './tools/budgets.js';
import { listAccounts, getAccountBalance } from './tools/accounts.js';
import { listCategories } from './tools/categories.js';
import { listPayees, searchPayees } from './tools/payees.js';
import {
  createTransaction,
  createTransactionsBatch,
  getUnclearedTransactions,
  getClearedTransactions,
  getPendingTransactions,
  clearTransaction,
  updateTransaction,
} from './tools/transactions.js';
import { reconciliationCheck } from './tools/reconciliation.js';
import {
  getTransactionsByDateRange,
  getSpendingByCategory,
  getIncomeSummary,
} from './tools/analytics.js';
import {
  runSyncBudget,
  readSyncStatus,
  readTransactionsNeedingReview,
  readWeeklyReview,
  readMonthlyReview,
} from './tools/local-sync.js';
import {
  runPlanningSnapshot,
  runFindMonthsNeedingHelp,
  runExplainOverspending,
  runCategorizationQueue,
  runSuggestCategories,
  runWeeklyBudgetReview,
  runMonthlyBudgetReview,
} from './tools/budget-coach.js';

const server = new McpServer({
  name: 'ynab-mcp',
  version: '1.0.0',
});

// Tool: list_budgets
server.tool(
  'list_budgets',
  'List all budgets for the authenticated YNAB user. Use this to find budget IDs for other operations.',
  async () => {
    try {
      const budgets = await listBudgets();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(budgets, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing budgets: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: list_accounts
server.tool(
  'list_accounts',
  'List all accounts with their balances. Returns credit cards and checking accounts first. Balances are shown in dollars.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
  },
  async ({ budget_id }) => {
    try {
      const accounts = await listAccounts(budget_id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(accounts, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing accounts: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_account_balance
server.tool(
  'get_account_balance',
  'Get detailed balance information for a specific account including cleared, uncleared, and total balances in dollars.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
    account_id: z.string().describe('The account ID to get balance for'),
  },
  async ({ budget_id, account_id }) => {
    try {
      const balance = await getAccountBalance(account_id, budget_id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(balance, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting account balance: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: list_categories
server.tool(
  'list_categories',
  'List all category groups and their categories. Useful for categorizing new transactions.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
  },
  async ({ budget_id }) => {
    try {
      const categories = await listCategories(budget_id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(categories, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing categories: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: list_payees
server.tool(
  'list_payees',
  'List all payees in the budget.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
  },
  async ({ budget_id }) => {
    try {
      const payees = await listPayees(budget_id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payees, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing payees: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: search_payees
server.tool(
  'search_payees',
  'Fuzzy search for payees by name. Returns up to 10 best matches with relevance scores.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
    query: z.string().describe('Search query to match against payee names'),
  },
  async ({ budget_id, query }) => {
    try {
      const results = await searchPayees(query, budget_id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error searching payees: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: create_transaction
server.tool(
  'create_transaction',
  'Create a single transaction. Amounts are in dollars (negative for charges, positive for credits). Defaults to cleared status for reconciliation workflow. Supports SPLIT TRANSACTIONS: use "subtransactions" to divide a single transaction across multiple categories (e.g., splitting a Costco purchase between Groceries, Household Items, and Gas).',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
    account_id: z.string().describe('The account ID to create the transaction in'),
    date: z.string().describe('Transaction date in ISO format (YYYY-MM-DD)'),
    amount: z
      .number()
      .describe(
        'Amount in dollars (negative for charges like -25.99, positive for credits). For split transactions, this should equal the sum of all subtransactions.'
      ),
    payee_name: z.string().describe('Name of the payee'),
    category_id: z.string().optional().describe('Category ID for the transaction (cannot be used with subtransactions)'),
    memo: z.string().optional().describe('Optional memo/note'),
    cleared: z
      .boolean()
      .optional()
      .describe('Whether transaction is cleared (defaults to true for reconciliation)'),
    subtransactions: z
      .array(
        z.object({
          category_id: z.string().describe('Category ID for this subtransaction'),
          amount: z.number().describe('Amount in dollars for this subtransaction (e.g., -50.00 for groceries, -25.00 for gas)'),
          memo: z.string().optional().describe('Optional memo for this subtransaction'),
        })
      )
      .optional()
      .describe('To SPLIT a transaction across multiple categories, provide subtransactions array. Each subtransaction has its own category_id and amount. The sum of all subtransaction amounts must equal the main transaction amount. Mutually exclusive with category_id.'),
  },
  async ({ budget_id, account_id, date, amount, payee_name, category_id, memo, cleared, subtransactions }) => {
    try {
      const result = await createTransaction(
        account_id,
        { date, amount, payee_name, category_id, memo, cleared, subtransactions },
        budget_id
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating transaction: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: create_transactions_batch
server.tool(
  'create_transactions_batch',
  'Create multiple transactions at once. All transactions go to the same account. Amounts are in dollars. Ideal for bulk reconciliation from credit card statements. Supports SPLIT TRANSACTIONS: use "subtransactions" on individual transactions to divide them across multiple categories.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
    account_id: z.string().describe('The account ID to create transactions in'),
    transactions: z
      .array(
        z.object({
          date: z.string().describe('Transaction date in ISO format (YYYY-MM-DD)'),
          amount: z.number().describe('Amount in dollars (negative for charges). For split transactions, this should equal the sum of all subtransactions.'),
          payee_name: z.string().describe('Name of the payee'),
          category_id: z.string().optional().describe('Category ID (cannot be used with subtransactions)'),
          memo: z.string().optional().describe('Optional memo/note'),
          cleared: z.boolean().optional().describe('Whether cleared (defaults to true)'),
          subtransactions: z
            .array(
              z.object({
                category_id: z.string().describe('Category ID for this subtransaction'),
                amount: z.number().describe('Amount in dollars for this subtransaction'),
                memo: z.string().optional().describe('Optional memo for this subtransaction'),
              })
            )
            .optional()
            .describe('To SPLIT a transaction across multiple categories, provide subtransactions array. Each subtransaction has its own category_id and amount. The sum must equal the main transaction amount. Mutually exclusive with category_id.'),
        })
      )
      .describe('Array of transactions to create'),
  },
  async ({ budget_id, account_id, transactions }) => {
    try {
      const result = await createTransactionsBatch(account_id, transactions, budget_id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                created_count: result.created.length,
                transactions: result.created,
                duplicate_import_ids: result.duplicate_import_ids,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error creating transactions: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_uncleared_transactions
server.tool(
  'get_uncleared_transactions',
  'Get all uncleared transactions for an account. Useful for seeing what might need to be cleared during reconciliation.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
    account_id: z.string().describe('The account ID to get uncleared transactions for'),
  },
  async ({ budget_id, account_id }) => {
    try {
      const transactions = await getUnclearedTransactions(account_id, budget_id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: transactions.length,
                transactions,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting uncleared transactions: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_cleared_transactions
server.tool(
  'get_cleared_transactions',
  'Get all cleared transactions for an account. Useful for reconciliation to compare against statement.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
    account_id: z.string().describe('The account ID to get cleared transactions for'),
    since_date: z
      .string()
      .optional()
      .describe('Only return transactions on or after this date (YYYY-MM-DD)'),
  },
  async ({ budget_id, account_id, since_date }) => {
    try {
      const transactions = await getClearedTransactions(account_id, budget_id, since_date);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: transactions.length,
                transactions,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting cleared transactions: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_pending_transactions
server.tool(
  'get_pending_transactions',
  'Get all pending (uncleared) transactions for an account. These are transactions that have not yet posted to the account.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
    account_id: z.string().describe('The account ID to get pending transactions for'),
    since_date: z
      .string()
      .optional()
      .describe('Only return transactions on or after this date (YYYY-MM-DD)'),
  },
  async ({ budget_id, account_id, since_date }) => {
    try {
      const transactions = await getPendingTransactions(account_id, budget_id, since_date);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: transactions.length,
                transactions,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting pending transactions: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: clear_transaction
server.tool(
  'clear_transaction',
  'Mark a transaction as cleared.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
    transaction_id: z.string().describe('The transaction ID to mark as cleared'),
  },
  async ({ budget_id, transaction_id }) => {
    try {
      const result = await clearTransaction(transaction_id, budget_id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error clearing transaction: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: update_transaction
server.tool(
  'update_transaction',
  'Update an existing transaction. Can modify amount, date, payee, category, memo, or cleared status. Supports converting a simple transaction to a SPLIT TRANSACTION by providing subtransactions to divide it across multiple categories.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
    transaction_id: z.string().describe('The transaction ID to update'),
    amount: z
      .number()
      .optional()
      .describe('New amount in dollars (negative for charges, positive for credits)'),
    date: z.string().optional().describe('New date in ISO format (YYYY-MM-DD)'),
    payee_name: z.string().optional().describe('New payee name'),
    category_id: z.string().optional().describe('New category ID (cannot be used with subtransactions)'),
    memo: z.string().optional().describe('New memo/note'),
    cleared: z.boolean().optional().describe('Whether transaction is cleared'),
    subtransactions: z
      .array(
        z.object({
          category_id: z.string().describe('Category ID for this subtransaction'),
          amount: z.number().describe('Amount in dollars for this subtransaction'),
          memo: z.string().optional().describe('Optional memo for this subtransaction'),
        })
      )
      .optional()
      .describe('Convert to SPLIT TRANSACTION by providing subtransactions array. Each subtransaction divides the total amount across different categories. Sum of subtransactions must equal the main transaction amount. Mutually exclusive with category_id.'),
  },
  async ({ budget_id, transaction_id, amount, date, payee_name, category_id, memo, cleared, subtransactions }) => {
    try {
      const result = await updateTransaction(
        transaction_id,
        { amount, date, payee_name, category_id, memo, cleared, subtransactions },
        budget_id
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error updating transaction: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: reconciliation_check
server.tool(
  'reconciliation_check',
  'Compare YNAB cleared balance to actual balance from your bank/card statement. Reports if they match or shows the discrepancy.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
    account_id: z.string().describe('The account ID to check'),
    actual_balance: z
      .number()
      .describe(
        'The actual balance from your bank/card in dollars (e.g., -1234.56 for credit card debt)'
      ),
  },
  async ({ budget_id, account_id, actual_balance }) => {
    try {
      const result = await reconciliationCheck(account_id, actual_balance, budget_id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error checking reconciliation: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_transactions_by_date_range
server.tool(
  'get_transactions_by_date_range',
  'Get all transactions across all accounts within a date range. Returns transaction details including amount, payee, category, and account. Useful for year-end analysis, monthly reviews, and financial reporting.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
    start_date: z
      .string()
      .describe('Start date in ISO format (YYYY-MM-DD). Transactions on or after this date will be included.'),
    end_date: z
      .string()
      .optional()
      .describe('End date in ISO format (YYYY-MM-DD). If not provided, returns all transactions from start_date to present.'),
  },
  async ({ budget_id, start_date, end_date }) => {
    try {
      const transactions = await getTransactionsByDateRange(start_date, end_date, budget_id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                count: transactions.length,
                start_date,
                end_date: end_date || 'present',
                transactions,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting transactions by date range: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_spending_by_category
server.tool(
  'get_spending_by_category',
  'Analyze spending aggregated by category for a date range. Returns total spent, transaction count, and average transaction size per category. Excludes income and transfers, focusing only on spending. Categories are sorted by total spent (highest first).',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
    start_date: z
      .string()
      .describe('Start date in ISO format (YYYY-MM-DD)'),
    end_date: z
      .string()
      .optional()
      .describe('End date in ISO format (YYYY-MM-DD). If not provided, analyzes from start_date to present.'),
  },
  async ({ budget_id, start_date, end_date }) => {
    try {
      const categorySpending = await getSpendingByCategory(start_date, end_date, budget_id);
      const totalSpent = categorySpending.reduce((sum, cat) => sum + cat.total_spent, 0);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                period: {
                  start_date,
                  end_date: end_date || 'present',
                },
                summary: {
                  total_spent: totalSpent,
                  total_spent_formatted: formatCurrency(totalSpent * 1000),
                  category_count: categorySpending.length,
                  total_transactions: categorySpending.reduce((sum, cat) => sum + cat.transaction_count, 0),
                },
                categories: categorySpending,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting spending by category: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_income_summary
server.tool(
  'get_income_summary',
  'Get income summary for a date range. Returns total income, transaction count, and breakdown by income source (payee). Only includes positive transactions (income, refunds, reimbursements). Sources are sorted by total income (highest first).',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses default or last-used if not provided)'),
    start_date: z
      .string()
      .describe('Start date in ISO format (YYYY-MM-DD)'),
    end_date: z
      .string()
      .optional()
      .describe('End date in ISO format (YYYY-MM-DD). If not provided, analyzes from start_date to present.'),
  },
  async ({ budget_id, start_date, end_date }) => {
    try {
      const incomeSummary = await getIncomeSummary(start_date, end_date, budget_id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                period: {
                  start_date,
                  end_date: end_date || 'present',
                },
                income: incomeSummary,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error getting income summary: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: sync_ynab_data
server.tool(
  'sync_ynab_data',
  'Incrementally sync the local YNAB mirror (SQLite) for a budget. Uses YNAB server_knowledge so subsequent runs only fetch deltas. Read-only against YNAB; populates the local DB used by review/analysis tools. Pass full_resync=true to discard local server_knowledge and re-pull from scratch (local rows are still upserted, not deleted unless YNAB reports them deleted).',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID to sync (uses YNAB_BUDGET_ID env var if not provided). The "last-used" alias is not supported here — pass an explicit budget id.'),
    full_resync: z
      .boolean()
      .optional()
      .describe('Discard local server_knowledge and refetch all entities from YNAB. Defaults to false (incremental).'),
  },
  async ({ budget_id, full_resync }) => {
    try {
      const result = await runSyncBudget(budget_id, full_resync);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error syncing YNAB data: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_sync_status
server.tool(
  'get_sync_status',
  'Report local sync state for a budget: per-resource server_knowledge, last_synced_at, and counts of mirrored entities. Reads only the local SQLite DB; no YNAB API calls.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses YNAB_BUDGET_ID env var if not provided).'),
  },
  async ({ budget_id }) => {
    try {
      const status = readSyncStatus(budget_id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error reading sync status: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_transactions_needing_review
server.tool(
  'get_transactions_needing_review',
  'List transactions in the local mirror that look like they need attention: uncategorized, unapproved, or flagged. Reads from local SQLite — run sync_ynab_data first.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses YNAB_BUDGET_ID env var if not provided).'),
    limit: z
      .number()
      .int()
      .positive()
      .max(500)
      .optional()
      .describe('Max transactions to return (default 50).'),
    since_date: z
      .string()
      .optional()
      .describe('Only consider transactions on or after this date (YYYY-MM-DD). Defaults to last 60 days.'),
  },
  async ({ budget_id, limit, since_date }) => {
    try {
      const result = readTransactionsNeedingReview(budget_id, limit, since_date);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error reading transactions needing review: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_weekly_finance_review
server.tool(
  'get_weekly_finance_review',
  'Generate a 7-day rolling finance review from the local mirror: spending, income, top categories/payees, account flow, and signals (large transactions, review backlog, overspent categories). Reads only from local SQLite.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses YNAB_BUDGET_ID env var if not provided).'),
    end_date: z
      .string()
      .optional()
      .describe('End of the 7-day window (YYYY-MM-DD). Defaults to today. Period is end_date and the 6 preceding days, inclusive.'),
  },
  async ({ budget_id, end_date }) => {
    try {
      const review = readWeeklyReview(budget_id, end_date);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(review, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error generating weekly review: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_monthly_finance_review
server.tool(
  'get_monthly_finance_review',
  'Generate a calendar-month finance review from the local mirror: spending, income, top categories/payees, account flow, and signals. Reads only from local SQLite.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses YNAB_BUDGET_ID env var if not provided).'),
    month: z
      .string()
      .optional()
      .describe('Month to review in YYYY-MM format. Defaults to the current calendar month.'),
  },
  async ({ budget_id, month }) => {
    try {
      const review = readMonthlyReview(budget_id, month);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(review, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error generating monthly review: ${formatError(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_budget_planning_snapshot
server.tool(
  'get_budget_planning_snapshot',
  'Read-only planning snapshot for a budget month: Ready to Assign, overspent categories, underfunded targets, hard obligations, everyday/true-expense/savings classifications, funding-source candidates, and upcoming scheduled obligations. Live YNAB read; no mutations. Approval required for any future assignment.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses YNAB_BUDGET_ID env var if not provided). The "last-used" alias is not accepted.'),
    month: z
      .string()
      .optional()
      .describe('Month in YYYY-MM format. Defaults to the current calendar month.'),
  },
  async ({ budget_id, month }) => {
    try {
      const result = await runPlanningSnapshot({ budgetId: budget_id, month });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Error building planning snapshot: ${formatError(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// Tool: find_months_needing_budget_help
server.tool(
  'find_months_needing_budget_help',
  'Inspect the current and recent months to identify which need budget attention. Reasons include: ready_to_assign, overspent_categories, underfunded_targets, previous_month_overspending, credit_card_payment_issues. Live YNAB read; no mutations.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses YNAB_BUDGET_ID env var if not provided). The "last-used" alias is not accepted.'),
    months_back: z
      .number()
      .int()
      .min(0)
      .max(11)
      .optional()
      .describe('How many prior months to inspect in addition to the current month (default 2).'),
    as_of_month: z
      .string()
      .optional()
      .describe('Anchor month in YYYY-MM. Defaults to the current month.'),
  },
  async ({ budget_id, months_back, as_of_month }) => {
    try {
      const result = await runFindMonthsNeedingHelp({
        budgetId: budget_id,
        monthsBack: months_back,
        asOfMonth: as_of_month,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Error finding months needing help: ${formatError(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// Tool: explain_overspending
server.tool(
  'explain_overspending',
  'Explain overspending for a budget month in plain language: which categories are negative, by how much, and likely funding source candidates. Advisory only — no money is moved. Approval required for any future assignment.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses YNAB_BUDGET_ID env var if not provided). The "last-used" alias is not accepted.'),
    month: z
      .string()
      .optional()
      .describe('Month in YYYY-MM format. Defaults to the current calendar month.'),
    category_id: z
      .string()
      .optional()
      .describe('Optional category ID to focus the explanation on a single overspent category.'),
  },
  async ({ budget_id, month, category_id }) => {
    try {
      const result = await runExplainOverspending({
        budgetId: budget_id,
        month,
        categoryId: category_id,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Error explaining overspending: ${formatError(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_categorization_queue
server.tool(
  'get_categorization_queue',
  'List transactions needing categorization or approval, with duplicate-payee groups for batch handling. Live YNAB read; transfers excluded. No categories are applied.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses YNAB_BUDGET_ID env var if not provided). The "last-used" alias is not accepted.'),
    since_date: z
      .string()
      .optional()
      .describe('Only consider transactions on or after this date (YYYY-MM-DD). Defaults to the last 60 days.'),
    limit: z
      .number()
      .int()
      .positive()
      .max(500)
      .optional()
      .describe('Max queue rows to return (default 100).'),
  },
  async ({ budget_id, since_date, limit }) => {
    try {
      const result = await runCategorizationQueue({
        budgetId: budget_id,
        sinceDate: since_date,
        limit,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Error building categorization queue: ${formatError(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// Tool: suggest_transaction_categories
server.tool(
  'suggest_transaction_categories',
  'Suggest categories for uncategorized/unapproved transactions using payee history, prior approved categorizations, and merchant keywords. Each suggestion includes confidence (high/medium/low), rationale, and evidence. Read-only; no categories are applied.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses YNAB_BUDGET_ID env var if not provided). The "last-used" alias is not accepted.'),
    since_date: z
      .string()
      .optional()
      .describe('Only consider transactions on or after this date (YYYY-MM-DD). Defaults to the last 60 days.'),
    transaction_ids: z
      .array(z.string())
      .optional()
      .describe('Optional explicit list of transaction IDs to suggest categories for. Without this, all uncategorized/unapproved transactions in the window are considered.'),
    limit: z
      .number()
      .int()
      .positive()
      .max(200)
      .optional()
      .describe('Max suggestions to return (default 50).'),
  },
  async ({ budget_id, since_date, transaction_ids, limit }) => {
    try {
      const result = await runSuggestCategories({
        budgetId: budget_id,
        sinceDate: since_date,
        transactionIds: transaction_ids,
        limit,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Error suggesting categories: ${formatError(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_weekly_budget_review
server.tool(
  'get_weekly_budget_review',
  'Operating-model weekly review built from live YNAB reads: inbox health, overspending with funding source candidates, cash assignment status (Ready to Assign, underfunded hard obligations, near-term run-out), notable spending (large transactions, unusual payees, new recurring charges), and concrete next actions. Read-only — no mutations.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses YNAB_BUDGET_ID env var if not provided). The "last-used" alias is not accepted.'),
    end_date: z
      .string()
      .optional()
      .describe('End of the 7-day review window (YYYY-MM-DD). Defaults to today.'),
    large_tx_dollars: z
      .number()
      .positive()
      .optional()
      .describe('Threshold for "large transaction" notable spending signal (default 250).'),
  },
  async ({ budget_id, end_date, large_tx_dollars }) => {
    try {
      const result = await runWeeklyBudgetReview({
        budgetId: budget_id,
        endDate: end_date,
        largeTxDollars: large_tx_dollars,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Error generating weekly budget review: ${formatError(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// Tool: get_monthly_budget_review
server.tool(
  'get_monthly_budget_review',
  'Operating-model monthly review built from live YNAB reads: month close readiness, budget performance with category deltas, true-expense/sinking-fund status, family-narrative anchors, and a next-month plan. Read-only — no mutations.',
  {
    budget_id: z
      .string()
      .optional()
      .describe('Budget ID (uses YNAB_BUDGET_ID env var if not provided). The "last-used" alias is not accepted.'),
    month: z
      .string()
      .optional()
      .describe('Month to review in YYYY-MM format. Defaults to the current calendar month.'),
    large_tx_dollars: z
      .number()
      .positive()
      .optional()
      .describe('Threshold for "large transaction" highlights (default 250).'),
  },
  async ({ budget_id, month, large_tx_dollars }) => {
    try {
      const result = await runMonthlyBudgetReview({
        budgetId: budget_id,
        month,
        largeTxDollars: large_tx_dollars,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          { type: 'text', text: `Error generating monthly budget review: ${formatError(error)}` },
        ],
        isError: true,
      };
    }
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('YNAB MCP Server started');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
