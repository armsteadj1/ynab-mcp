import { openDb, defaultDbPath, type Database } from '../local/db.js';
import { syncBudget, getSyncStatus, type SyncResult, type SyncStatus } from '../local/sync.js';
import { createYnabSyncClient } from '../local/ynab-sync-client.js';
import {
  countTransactionsNeedingReview,
  getMonthlyReview,
  getTransactionsNeedingReview,
  getWeeklyReview,
  type PeriodReview,
  type ReviewTransaction,
} from '../local/reviews.js';
import { resolveBudgetId } from '../ynab-client.js';

let cachedDb: Database | null = null;

export function getLocalDb(): Database {
  if (!cachedDb) {
    cachedDb = openDb();
  }
  return cachedDb;
}

// Test seam: allow swapping the default db handle.
export function setLocalDb(db: Database | null): void {
  cachedDb = db;
}

export function localDbPath(): string {
  return defaultDbPath();
}

export async function runSyncBudget(
  budgetId?: string,
  fullResync?: boolean
): Promise<SyncResult> {
  const resolvedBudgetId = resolveBudgetId(budgetId);
  if (resolvedBudgetId === 'last-used') {
    throw new Error(
      'sync_ynab_data requires an explicit budget_id (or YNAB_BUDGET_ID env var). The "last-used" alias is not supported for local sync.'
    );
  }
  const db = getLocalDb();
  const client = createYnabSyncClient();
  return syncBudget({ budgetId: resolvedBudgetId, client, db, fullResync });
}

export function readSyncStatus(budgetId?: string): SyncStatus & { db_path: string } {
  const resolvedBudgetId = resolveBudgetId(budgetId);
  const db = getLocalDb();
  const status = getSyncStatus(db, resolvedBudgetId);
  return { ...status, db_path: defaultDbPath() };
}

export function readTransactionsNeedingReview(
  budgetId?: string,
  limit?: number,
  sinceDate?: string
): { count: number; transactions: ReviewTransaction[] } {
  const resolvedBudgetId = resolveBudgetId(budgetId);
  const db = getLocalDb();
  const transactions = getTransactionsNeedingReview(db, {
    budgetId: resolvedBudgetId,
    limit,
    sinceDate,
  });
  const count = countTransactionsNeedingReview(db, resolvedBudgetId, sinceDate);
  return { count, transactions };
}

export function readWeeklyReview(budgetId?: string, endDate?: string): PeriodReview {
  const resolvedBudgetId = resolveBudgetId(budgetId);
  const db = getLocalDb();
  return getWeeklyReview(db, resolvedBudgetId, endDate);
}

export function readMonthlyReview(budgetId?: string, month?: string): PeriodReview {
  const resolvedBudgetId = resolveBudgetId(budgetId);
  const db = getLocalDb();
  return getMonthlyReview(db, resolvedBudgetId, month);
}
