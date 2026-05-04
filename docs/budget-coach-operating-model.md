# Budget Coach Operating Model

This project has two distinct jobs. Keep them separate in tools, prompts, permissions, and review UX.

## 1. Planning + Assigning Budget

Purpose: help James and Angie decide what money should do.

This is advisory-only unless James explicitly approves a concrete change. The system may read live YNAB data, explain tradeoffs, and draft assignment plans, but it must not assign money, move money, cover overspending, or change targets without approval.

### Inputs

- Current month `Ready to Assign`
- Current and prior month category balances/activity
- YNAB targets and due dates
- Overspent categories
- Upcoming scheduled/recurring obligations
- Recent income cadence
- Family goals/profile answers
- Known upcoming calendar/life events when available

### Planning workflow

1. Identify months needing help:
   - current month has `Ready to Assign` > 0
   - any category is overspent
   - high-priority targets are underfunded
   - credit card payment categories are negative or inconsistent
   - previous month has unresolved overspending
2. Classify categories by job:
   - hard obligations: mortgage, daycare, utilities, car payments, phone, subscriptions
   - everyday spending: groceries, gas, fun/food, personal care
   - true expenses / sinking funds: home, car maintenance, gifts, pet, travel
   - savings/goals: emergency fund, HSA, IRA, taxable, vacation/travel
   - discretionary/person-specific: James, Angie, Sloan/family, business expenses
3. Create an assignment proposal:
   - cover overspending first
   - fund current hard obligations
   - fund near-term everyday categories
   - fund true expenses/sinking funds
   - fund savings goals
   - leave or create an explicit buffer if appropriate
4. Explain tradeoffs:
   - “to cover X, likely pull from Y/Z”
   - distinguish cash-flow timing vs. real overspend
   - call out whether using emergency/savings is justified
5. Ask for approval before any mutation:
   - show exact category moves / assignments
   - require explicit yes before applying

### Good-practice defaults

- Zero-based framing: every available dollar needs a job, but do not force precision when life is chaotic.
- Roll with the punches: overspending is not moral failure; it is a reprioritization problem.
- Family budget tone: collaborative, non-judgmental, “we” language.
- True expenses matter: irregular costs need sinking funds so they stop becoming emergencies.
- Use the month as the unit of planning, but check weekly so problems are small.

## 2. Transaction Categorization

Purpose: help transactions become accurate and approved.

This can be more operational than planning, but should still start with recommendations. Applying categories should be a separate, explicit approval flow unless James later opts into automation for high-confidence rules.

### Inputs

- Transaction payee/import payee/original import payee
- Amount, account, date, memo, merchant history
- Existing YNAB payee/category patterns
- Similar historical transactions
- Receipt evidence from `agent-utils` when available
- Category target/balance context when useful, but category fit beats budget availability

### Categorization workflow

1. Pull uncategorized/unapproved transactions.
2. Group obvious duplicates/same merchant.
3. Generate a recommendation with confidence:
   - high: repeated payee/category pattern or receipt match
   - medium: merchant/category common sense + category history
   - low: ambiguous merchant, travel/family/business overlap, transfer-like wording
4. Provide evidence:
   - prior examples
   - receipt summary, if linked
   - payee/import name clues
5. Apply only after approval:
   - single transaction approval
   - batch approval for high-confidence groups
   - dry-run preview by default

### Agent-utils seam

`agent-utils` is currently a receipt intake, storage, summarization, and HSA classifier system. It exposes receipt search/download/status tools and stores AI summaries like merchant, amount, and items. It does not currently contain a YNAB category skill.

Use it as evidence, not as source of truth:

- match receipts to YNAB transactions by amount/date/merchant
- use receipt summary items to distinguish categories
- mark receipt as processed only after the transaction decision is resolved
- future improvement: add receipt metadata fields for `ynab_transaction_id`, `ynab_category_id`, `ynab_category_confidence`, and `ynab_processed_at`

## Weekly Review Guess

A weekly review should be short and operational. Goal: keep the budget from drifting.

Suggested sections:

1. Inbox health
   - uncategorized count
   - unapproved count
   - stale transactions older than 7 days
2. Overspending
   - categories currently negative
   - recommended funding source candidates, but no action
3. Cash assignment
   - Ready to Assign
   - hard obligations still underfunded
   - near-term categories likely to run out before next income
4. Notable spending
   - large transactions
   - unusual merchants/categories compared with recent history
   - subscriptions/new recurring charges
5. Next actions
   - approve categorization batch
   - decide assignment plan
   - reconcile specific account if needed

## Monthly Review Guess

A monthly review should be reflective and planning-oriented. Goal: learn from the month and set up the next one.

Suggested sections:

1. Month close readiness
   - all transactions approved/categorized
   - no overspent categories
   - account reconciliation status if available
2. Budget performance
   - income vs spending
   - top category deltas vs targets
   - categories repeatedly overspent
3. True expenses
   - sinking funds used
   - funds below target
   - upcoming irregular expenses over next 30/60/90 days
4. Family narrative
   - what happened this month that explains the money
   - which spending aligned with goals and which did not
5. Next-month plan
   - suggested target changes
   - assignment priorities
   - questions for James/Angie

## Live Budget Observations on 2026-05-04

Budget: `Budget 🚀`.

Current month observations from live YNAB reads:

- May has money available to assign.
- May also has several categories with negative balances, including mortgage, travel, an Amazon card payment category, daycare, uncategorized, phone/tech, fun stuff, and business expenses.
- May categorization queue is small but real: 5 uncategorized transactions and 13 unapproved transactions at the time of inspection.
- The first planning assistant should therefore focus on: cover overspending, fund hard obligations/targets, and then propose what to do with remaining Ready to Assign.

## Phase 2 Build Direction

### Tools to add

Planning/read-only tools:

- `get_budget_planning_snapshot`
- `find_months_needing_budget_help`
- `draft_assignment_plan`
- `explain_overspending`

Categorization tools:

- `get_categorization_queue`
- `suggest_transaction_categories`
- `match_receipts_to_transactions`
- future: `apply_transaction_categories` with dry-run + explicit approval

Review tools:

- `get_weekly_budget_review`
- `get_monthly_budget_review`

### Guardrails

- Planning tools never mutate YNAB.
- Categorization apply tools must default to dry-run.
- Any money movement/assignment requires exact proposed changes and explicit approval.
- Never infer family goals as facts; ask and store answers separately.
- Do not shame spending. Explain tradeoffs and options.
