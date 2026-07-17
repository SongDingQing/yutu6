# Hook And Skill Quality Review

## Hook Inventory

| Hook ID | Event/schema version | Owner | Blocking? | Failure mode | Timeout | Mutation | Evidence emitted | Tests | Rollback |
|---|---|---|---|---|---|---|---|---|---|
|  |  |  | `yes | no` | `open | closed | warn` |  |  |  |  |  |

## Skill Inventory

| Skill | Positive trigger | Negative trigger | Scope | Owner | Evidence source | Review cadence | Invalidation | Trigger tests |
|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |  |

## Independent Reviews

- Quality operations: source quality, duplication, measurable gain, token/latency cost, tests, rollback.
- Governance: authority boundary, secrets, shared state, infinite loop, systemic blast radius, owner gate.
- A review is pending until a separate record from that role exists; do not simulate consensus.
