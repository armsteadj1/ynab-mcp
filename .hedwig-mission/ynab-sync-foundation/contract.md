# Contract — Phase 1

## In scope

- Add a SQLite-backed local store for YNAB mirror data.
- Add an incremental sync job/tool that can fetch and upsert:
  - budgets
  - accounts
  - categories/category groups
  - payees
  - transactions, including deleted/updated transaction handling
  - month summaries if practical with current client support
- Persist YNAB `server_knowledge` per budget/resource so future syncs are incremental.
- Support a full resync/reset path without requiring manual database deletion.
- Add local read/analysis helpers that use SQLite first:
  - transactions needing categorization/review
  - weekly review summary
  - monthly review summary
  - important finance signals/alerts
- Add MCP tools for sync/status/review in the existing server style.
- Add tests/mocks for sync upsert + update/delete behavior and summary logic.
- Keep secrets out of repo. Use `YNAB_API_TOKEN` only at runtime.
- Preserve existing MCP tools and baseline build.

## Safety rules

- Default to read-only. No new mutation/categorization-apply tools in this phase.
- If any write-style tool is introduced, it must default to dry-run and require explicit opt-in.
- No raw YNAB API escape hatch.
- Do not log/store the YNAB API token.
- Database path must be configurable and default under the user's home directory, not inside the repo.
- Avoid deleting local data unless caller explicitly asks for reset/full resync.

## Correctness checks

- `npm run build` passes.
- New tests pass via whatever test script is added.
- A fake sync scenario proves:
  - first sync inserts rows
  - second sync updates an existing transaction
  - deleted transactions are represented/filtered correctly
  - server knowledge advances
  - weekly/monthly review works from local DB without API calls

## Out of scope for phase 1

- Live API verification using James's token.
- Automatic categorization writes to YNAB.
- Plaid/Monarch/brokerage account aggregation for net worth.
- Receipt-agent integration beyond documenting the intended seam.
