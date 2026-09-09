# YNAB MCP Server

An MCP (Model Context Protocol) server for YNAB (You Need A Budget) designed for reconciliation, local-first analysis, weekly/monthly finance reviews, and a read-only **budget coach** that splits budget planning advice from transaction categorization suggestions.

## Two coach modes (read-only by design)

The budget coach has two distinct jobs and they stay separate in tools, prompts, and approval posture:

1. **Planning / assigning budget** — advisory only. Tools read live YNAB data and surface Ready to Assign, overspent categories, underfunded targets, funding-source candidates, and upcoming obligations. They never assign money or change targets without explicit human approval.
2. **Transaction categorization** — evidence-backed suggestions only. Tools surface uncategorized/unapproved transactions, group obvious duplicates, and propose a category with confidence (high/medium/low), rationale, and prior-example evidence. They never write categories.

See `docs/budget-coach-operating-model.md` for the full operating model. Phase 2 ships read-only tools only; any future write tool must default to dry-run and require explicit approval.

## Features

- **List budgets and accounts** - View all your YNAB budgets and accounts with balances
- **Category and payee management** - Browse categories and search payees
- **Transaction creation** - Create single or batch transactions
- **Reconciliation support** - Compare YNAB cleared balances to actual bank balances
- **Local SQLite mirror** - Incrementally sync YNAB to a local SQLite database (`node:sqlite`) using YNAB's `server_knowledge` so subsequent runs only fetch deltas
- **Local-only finance reviews** - Generate transaction-review queues and weekly/monthly summaries from the local mirror without hitting the YNAB API
- **Live budget coach** - Read-only planning snapshot, months-needing-help triage, overspending explanation, categorization queue, category suggestions, and operating-model weekly/monthly reviews built on live YNAB reads

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
| `YNAB_EMAIL_ACCOUNT` | No | Default Gmail account used by `suggest_transaction_categories` when `include_email_evidence` is true. Can also be passed per-call. |
| `GOG_KEYRING_PASSWORD` | No | Forwarded to the local [`gog`](https://github.com/jordanmccullough/gogcli) CLI when looking up Gmail evidence. Read-only Gmail search; never used to send mail. |

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

### Budget Coach Tools (live, read-only)

These tools read the YNAB API directly and never mutate the budget. They drive the two-mode coach: planning advice and categorization suggestions.

| Tool | Mode | Description |
|------|------|-------------|
| `get_budget_planning_snapshot` | planning | Ready to Assign, overspent categories, underfunded targets, hard obligations, everyday/true-expense/savings classifications, funding-source candidates, upcoming scheduled obligations, and planning priorities for the month. |
| `find_months_needing_budget_help` | planning | Inspects current and recent months and returns reasons (`ready_to_assign`, `overspent_categories`, `underfunded_targets`, `previous_month_overspending`, `credit_card_payment_issues`). |
| `explain_overspending` | planning | Plain-language explanation of overspent categories with likely funding sources. Optional `category_id` for a focused explanation. |
| `get_categorization_queue` | categorization | Live list of uncategorized/unapproved/flagged transactions with duplicate-payee groupings. Excludes transfers. |
| `suggest_transaction_categories` | categorization | Suggests a category per transaction with confidence (high/medium/low), rationale, evidence (prior examples, payee default), ranked alternatives, and a `safe_to_apply` / `review_state` decision. Optional `include_email_evidence: true` enriches each suggestion with read-only Gmail context (subject/from/date/labels only) via the local `gog` CLI; Amazon-like merchants are held for human review unless item-level email evidence is present. |
| `get_weekly_budget_review` | review | Operating-model weekly review: inbox health, overspending + funding source candidates, cash assignment, notable spending (large/unusual/new recurring), and explicit next actions. |
| `get_monthly_budget_review` | review | Operating-model monthly review: month close readiness, budget performance, true-expense status, family-narrative anchors, next-month plan with priorities and questions for humans. |
| `apply_categorization_suggestions` | categorization (write, no-approval) | Controlled apply for categorization. Defaults to `dry_run: true`. Allowed mutations: set category, replace/create split subtransactions, and add a memo only when the existing memo is blank. Forbidden: never sets `approved`, never changes `cleared`/`date`/`amount`/`payee`/`account`/`import_id`. After apply, transactions remain unapproved by design. |

Approval posture: every read-only coach tool above is dry-run by definition. The single write tool, `apply_categorization_suggestions`, defaults to `dry_run: true`, accepts the exact proposed changes, fetches each current transaction first, and never approves or otherwise mutates anything outside category, subtransactions, or memo. Any future assignment-write tool (e.g., `apply_assignment_plan`) must follow the same posture.

#### `apply_categorization_suggestions` boundary

This is the only coach tool that mutates YNAB. James has approved a narrow, no-approval boundary:

- **Allowed after dry-run review**:
  - Set a transaction's category.
  - Replace or create split subtransactions (sum must match the original transaction amount in milliunits).
  - Add a memo only when the existing memo is blank — to record why the category/split was chosen.
- **Forbidden**:
  - Never sets `approved: true`. The transaction must stay unapproved so it lands in the YNAB inbox for human review.
  - Never changes `cleared`, `date`, `amount`, `payee`, `account`, or `import_id`.
  - Never moves assigned budget dollars.
  - No raw passthrough to the YNAB transactions update endpoint — the tool builds a minimal payload of `{category_id?, subtransactions?, memo?}` only.
- **Inputs**: `budget_id`, `dry_run` (default `true`), and `changes[]` where each change has `transaction_id` and either `category_id` or `subtransactions[]`, plus optional `memo`/`memo_reason`.
- **Output**: `applied[]` with before/after previews and `changed_fields`, plus `skipped[]` (e.g., transfers, no-op changes, existing memos preserved) and `errors[]` (e.g., subtransaction sum mismatch, both `category_id` and `subtransactions` provided, forbidden field passthrough attempts).

#### Optional Gmail evidence for categorization

`suggest_transaction_categories` can correlate each transaction with recent emails to add merchant/context signals. Posture:

- **Off by default.** Pass `include_email_evidence: true` to opt in.
- **Read-only.** Uses the local `gog gmail messages search` CLI. The MCP server never sends mail, never modifies labels, never archives or deletes anything. Only `id`, `date`, `from`, `subject`, and `labels` are read.
- **Bounded.** Each call has a per-transaction timeout, a max message count, and a `±email_window_days` date window around the transaction. Default lookup limit is 25 transactions per call (`email_evidence_limit`).
- **Account selection.** `email_account` overrides `YNAB_EMAIL_ACCOUNT`, which overrides the personal default.
- **Mixed-merchant guard.** Amazon-like payees are kept in `needs_human_review` even at high confidence unless the email evidence is item-level (e.g. `Your Amazon.com order of "..."`, `Shipped: ...`, or an explicit invoice/receipt subject).
- **Confidence lift only when warranted.** Email signals can lift an ambiguous *low* suggestion to *medium*, but never auto-promote anything to `safe_to_apply`. Auto-apply still requires `high` confidence plus item-level evidence for Amazon-like merchants.

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
  budget-coach/
    reader.ts           YnabCoachReader interface + live YNAB SDK adapter (testable seam)
    category-jobs.ts    Heuristics that bucket categories into hard obligation / everyday /
                        true expense / savings / discretionary / credit card / inflow
    planning.ts         Planning snapshot, months-needing-help, overspending explanation
    categorization.ts   Categorization queue + payee-history + keyword suggestions
    reviews.ts          Operating-model weekly/monthly budget reviews (live reads)
  tools/
    local-sync.ts       Thin wrappers exposed to index.ts as MCP tools
    budget-coach.ts     Wire-up that resolves budget id and calls the live coach reader
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


## Approval Safety

- **No auto-approval**: categorization apply never approves transactions; review remains in YNAB.
- Created/imported transactions also default to unapproved so a human can approve them in YNAB.
