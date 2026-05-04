# YNAB MCP Server

An MCP (Model Context Protocol) server for YNAB (You Need A Budget) designed for reconciliation, local-first analysis, and weekly/monthly finance reviews.

## Features

- **List budgets and accounts** - View all your YNAB budgets and accounts with balances
- **Category and payee management** - Browse categories and search payees
- **Transaction creation** - Create single or batch transactions
- **Reconciliation support** - Compare YNAB cleared balances to actual bank balances
- **Local SQLite mirror** - Incrementally sync YNAB to a local SQLite database (`node:sqlite`) using YNAB's `server_knowledge` so subsequent runs only fetch deltas
- **Local-only finance reviews** - Generate transaction-review queues and weekly/monthly summaries from the local mirror without hitting the YNAB API

## Installation

```bash
git clone https://github.com/scottolsen/ynab-mcp.git
cd ynab-mcp
npm install
npm run build
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `YNAB_API_TOKEN` | Yes (for sync/write tools) | Your YNAB Personal Access Token. Never logged. Local-read tools (review/status) do not require it once data is synced. |
| `YNAB_BUDGET_ID` | No | Default budget ID. The `sync_ynab_data` tool requires an explicit budget ID — the `last-used` alias is not supported there. |
| `YNAB_LOCAL_DB_PATH` | No | Path to the local SQLite mirror. Defaults to `~/.ynab-mcp/ynab.db`. The directory is created if needed. |

The local mirror lives **outside the repo** by default and contains YNAB data only — no API tokens. Delete the file to fully reset, or call `sync_ynab_data` with `full_resync: true` to discard `server_knowledge` and refetch.

### Node version

The local sync uses Node's built-in `node:sqlite` module, which is available in Node 22.5+ (no native build step). Older Node 22 builds may require `NODE_OPTIONS=--experimental-sqlite`; Node 23+ has it unflagged.

### Getting a YNAB API Token

1. Go to https://app.ynab.com/settings/developer
2. Click "New Token"
3. Copy the generated token

### Claude Code Configuration

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "ynab": {
      "command": "node",
      "args": ["/path/to/ynab-mcp/dist/index.js"],
      "env": {
        "YNAB_API_TOKEN": "your-token-here",
        "YNAB_BUDGET_ID": "optional-default-budget-id"
      }
    }
  }
}
```

## Available Tools

### Budget & Account Tools

| Tool | Description |
|------|-------------|
| `list_budgets` | List all budgets for the authenticated user |
| `list_accounts` | List all accounts with balances (credit cards and checking first) |
| `get_account_balance` | Get detailed balance for a specific account |

### Category & Payee Tools

| Tool | Description |
|------|-------------|
| `list_categories` | List all category groups and categories |
| `list_payees` | List all payees |
| `search_payees` | Fuzzy search for payees by name |

### Transaction Tools

| Tool | Description |
|------|-------------|
| `create_transaction` | Create a single transaction |
| `create_transactions_batch` | Create multiple transactions at once |
| `get_uncleared_transactions` | Get all uncleared transactions for an account |
| `get_cleared_transactions` | Get cleared transactions for an account (with optional date filter) |
| `clear_transaction` | Mark a transaction as cleared |
| `update_transaction` | Update an existing transaction (amount, date, payee, category, memo, cleared) |

### Reconciliation Tools

| Tool | Description |
|------|-------------|
| `reconciliation_check` | Compare YNAB cleared balance to actual balance |

### Local Sync & Review Tools

These tools read/write the local SQLite mirror at `YNAB_LOCAL_DB_PATH`. They are read-only with respect to YNAB (no mutations are sent back to YNAB).

| Tool | Description |
|------|-------------|
| `sync_ynab_data` | Incremental sync of budgets, accounts, category groups, categories, payees, and transactions into the local mirror, honoring YNAB `server_knowledge`. Pass `full_resync: true` to discard server_knowledge and refetch. |
| `get_sync_status` | Per-resource `server_knowledge` and `last_synced_at` for a budget, plus active counts of mirrored entities. Local-only, no API calls. |
| `get_transactions_needing_review` | Local query for transactions that look like they need attention: uncategorized, unapproved, or flagged. Excludes transfers. |
| `get_weekly_finance_review` | 7-day rolling review (spending, income, top categories/payees, account flow, signals) computed from the local DB. |
| `get_monthly_finance_review` | Calendar-month review with the same shape as the weekly review. |

Typical local-first flow:

```
sync_ynab_data { budget_id }
get_sync_status { budget_id }
get_transactions_needing_review { budget_id }
get_weekly_finance_review { budget_id }
get_monthly_finance_review { budget_id, month: "2026-04" }
```

## Reconciliation Workflow

1. **Show accounts**: "Show me my accounts"
2. **Select account**: "I want to reconcile my Chase Sapphire card"
3. **Share screenshot**: Provide a screenshot of your credit card transactions
4. **Create transactions**: Claude extracts and creates transactions as cleared
5. **Verify balance**: "The actual balance is -$1,234.56"
6. **Check result**: Tool reports if balanced or shows discrepancy

### Claude Code Command

This repo includes a Claude Code command for guided reconciliation. Copy `.claude/commands/reconcile.md` to your project or run:

```
/reconcile
```

This command walks you through the full reconciliation workflow with category matching and Amazon order correlation.

## Amount Handling

- All amounts are in **dollars** (e.g., `-25.99` for a $25.99 charge)
- Credit card **charges are negative** (money you owe)
- Credit card **payments/credits are positive**
- The server automatically converts to/from YNAB's milliunit format

## Development

```bash
# Build the project
npm run build

# Watch mode for development
npm run dev

# Run tests (uses Node's built-in test runner; no extra deps)
npm test

# Test with MCP Inspector
npm run inspect
```

## Architecture

```
src/
  index.ts              MCP tool registration
  ynab-client.ts        YNAB API singleton (token resolution)
  local/
    db.ts               node:sqlite open + schema bootstrap
    schema.ts           DDL for budgets/accounts/categories/payees/transactions/sync_state
    sync.ts             Incremental sync orchestrator + getSyncStatus
    ynab-sync-client.ts Adapter from ynab.API to YnabSyncClient
    reviews.ts          Local-only weekly/monthly summaries and review queue
    types.ts            Resource shapes shared by sync + adapter + tests
  tools/
    local-sync.ts       Thin wrappers exposed to index.ts as MCP tools
    ...                 Existing read/write tools
  __tests__/            node:test specs (run as `npm test`)
```

Sync is dependency-injected via the `YnabSyncClient` interface so tests can run with a fake client and an in-memory SQLite DB; no API token is required to develop or test.

## Testing with MCP Inspector

```bash
YNAB_API_TOKEN=your-token npx @modelcontextprotocol/inspector node dist/index.js
```

## License

MIT
