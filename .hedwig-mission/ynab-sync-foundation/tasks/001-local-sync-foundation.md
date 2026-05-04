# Task 001 — Build SQLite sync foundation

Implement the phase-1 contract in a focused way.

Recommended architecture:

- `src/local/db.ts` — open/init SQLite DB, schema migrations, configurable path.
- `src/local/schema.ts` or SQL migrations — tables for budgets, accounts, category_groups, categories, payees, transactions, sync_state.
- `src/local/sync.ts` — sync orchestration using existing `ynab-client`, honoring server knowledge.
- `src/local/reviews.ts` — weekly/monthly summary + important signals from local DB.
- `src/tools/sync.ts` and/or additions to `src/index.ts` — MCP tools:
  - `sync_ynab_data`
  - `get_sync_status`
  - `get_transactions_needing_review`
  - `get_weekly_finance_review`
  - `get_monthly_finance_review`

Implementation notes:

- Prefer a maintained SQLite dependency that works on macOS and CI. If native install is painful, choose a simple library and document it.
- Existing project has no test runner. Add the smallest useful one (Vitest is fine) and wire `npm test`.
- Use dependency injection/mocks for YNAB calls so tests do not need an API key.
- Keep MCP responses JSON-ish and agent-readable, matching existing repo style.
- Do not change existing mutation tools except if needed to mark them clearly as existing writes in README.

Deliverables:

- Code committed on branch `hedwig/ynab-sync-foundation`.
- README updated with local sync config/env vars and new tools.
- Build/tests passing.
- If possible, push branch and open PR against `main`.
