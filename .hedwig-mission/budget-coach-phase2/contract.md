# Contract — Budget Coach Phase 2

## In scope

- Add read-only planning snapshot and months-needing-help tools.
- Add categorization queue and category suggestion tools.
- Add weekly/monthly review tools that follow `docs/budget-coach-operating-model.md`.
- Integrate receipt evidence from agent-utils as an optional seam if available, without hard dependency.
- Keep mutation out of phase 2 unless explicitly requested later.

## Safety

- No budget assignment writes.
- No transaction category writes.
- No raw API escape hatch.
- Explicit approval required before any future write tool.

## Done

- Build/tests pass.
- Tests cover planning snapshot, overspending explanation, category suggestions, and review shape.
- README documents the two modes and approval posture.
