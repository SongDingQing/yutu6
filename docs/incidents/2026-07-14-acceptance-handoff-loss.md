# Acceptance handoff loss incident

- Date: 2026-07-14
- Root task: `cr-1784019424367-265c0ba9`
- Downstream task: `cr-1784023254548-b9854dd7`
- Affected contract: orchestrator to supervisor acceptance handoff

## Observation

The orchestrator produced a detailed acceptance contract for the generic Yutu6 release task, but the downstream
implementation envelope could abbreviate, generalize or mix those acceptance atoms before implementation and review.
That made it possible for different nodes to claim they had evaluated the same task while actually using different
requirements.

## Safeguard

`acceptance-contract-consumers` preserves stable acceptance IDs and source hashes across the handoff. When an acceptance
contract is present, missing or mutated required rows block the handoff; ordinary tasks without that contract do not pay
the gate cost. The behavior is covered by `projects/控制台/tests/acceptance-handoff.test.js`.

## Repository evidence

- `projects/控制台/brief.md` contains the original root/downstream IDs and the recorded handoff discrepancy.
- `projects/控制台/config/gate-policy.json` binds this incident to the active hook.
- `projects/控制台/tests/acceptance-handoff.test.js` covers preservation, mutation and rejection cases.
