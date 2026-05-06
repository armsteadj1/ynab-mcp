# Contract — Categorization Apply, No Approval

## Allowed mutations

- Set a transaction category.
- Replace/create split subtransactions when explicitly proposed.
- Add a memo only if the transaction memo is blank, explaining why the category/split was chosen.

## Forbidden mutations

- Never set `approved: true`.
- Never change cleared status.
- Never change amount, date, payee, account, or import id.
- Never move assigned budget dollars.
- No raw YNAB API escape hatch.

## Tool behavior

- Must support dry-run mode.
- Apply mode must accept exact proposed changes, not re-infer silently.
- Must return before/after preview and a list of skipped items.
- If a transaction already has a memo, preserve it unless caller explicitly provides an append strategy in a future task.
- For split transactions, subtransaction amounts must sum exactly to transaction amount in milliunits.
- After apply, transaction should remain unapproved.

## Tests

- Dry run performs no YNAB writes.
- Apply updates category and blank memo while preserving `approved: false`.
- Apply skips existing memo by default.
- Split amount mismatch is rejected.
- Forbidden fields cannot be passed through.
