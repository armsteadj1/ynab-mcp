# Task 001 — Apply categorization without approval

Implement a tool such as `apply_transaction_categorization` or `apply_categorization_suggestions`.

Inputs should support:

- `budget_id`
- `dry_run` default true
- `changes[]` where each change has:
  - `transaction_id`
  - either `category_id` or `subtransactions[]`
  - optional `memo` / `memo_reason`

Implementation should fetch each current transaction first, build a minimal YNAB update payload, and call the existing YNAB update endpoint only in apply mode.

The update payload must not include `approved`, `cleared`, `date`, `amount`, `payee`, or `account` changes.
