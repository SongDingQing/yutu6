# Completion schema conflict incident

- Date: 2026-07-14
- Tasks: `cr-1784019435832-74298708`, `cr-1784020905877-d6be4147`
- Affected contract: direct completion verdict

## Observation

Legacy execution outputs could contain mutually inconsistent completion fields while the event stream still emitted
`task.done` followed by `queue.completed` with `ok=true`. The two recorded task chains reached those terminal events at
event sequences `253038/253040` and `255072/255074`. A declaration-only consumer could therefore accept a result whose
implementation or review payload disagreed with the terminal event.

## Safeguard

`engine.direct_completion_conflict` compares the normalized implementation, review and verification verdicts. It remains
in shadow mode until conflict-ledger evidence supports owner-approved fail-closed activation. This record is deliberately
stored outside rotating `artifacts/engine-runs` so the gate keeps a durable incident provenance in fresh clones and CI.

## Repository evidence

- `projects/控制台/brief.md` records the original task IDs and terminal-event evidence.
- `projects/控制台/config/gate-policy.json` binds this incident to the shadow gate.
- `tests/gate-policy.test.js` verifies that every active or shadow gate keeps a durable incident reference.
