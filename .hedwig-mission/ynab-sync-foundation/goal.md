# Goal — YNAB Local Sync + Budget Intelligence Foundation

James wants `armsteadj1/ynab-mcp` to become Hedwig's personal budgeting substrate:

1. Help with transaction categorization.
2. Call out important finance signals.
3. Produce weekly and monthly reviews of spending, income, and account movement.
4. Eventually pull in all accounts for net worth.

Start by adding a local SQLite mirror of YNAB data so Hedwig can analyze budget history without repeatedly hitting the YNAB API. The YNAB API key is not required for implementation; build against mocks/tests and make live sync configurable for later verification.

## Source ideas to borrow, not blindly copy

- From `plattegruber/openclaw-skills/plugins/ynab-budget-manager`:
  - read-first flow: budgets/accounts/transactions/categories/month summaries
  - review modes: uncategorized only, category catch-all, flag based
  - write tools default to dry-run
  - selected budget/state persistence
  - rate-limit awareness
  - avoid escape hatch unless explicitly enabled
- From `Maronato/ynab-mcp`:
  - explicit read-only mode
  - batch/deterministic analysis tools
  - undo concept for future write operations
  - richer weekly/monthly analytics
- From James's `agent-utils`:
  - receipt/metadata pipeline can later feed categorization context, but do not add cross-repo dependency in phase 1.
