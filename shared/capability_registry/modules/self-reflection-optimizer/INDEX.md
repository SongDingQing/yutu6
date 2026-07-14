# Self Reflection Optimizer Module

This module registers 自省优化 as a shared multi-agent capability.

Use it when a user names a module and asks for 挑刺、反思、自省、优化, or when an优秀案例 is added and should trigger a targeted critique loop.

## Read Order

1. `quick-context.md` for the current integration.
2. `io-contracts.md` for request and output contracts.
3. `operations.md` for commands and validation.
4. `README.md` for policy and ownership.

## Safety

- Do not print secrets or inspect credential values.
- Unregistered projects are excluded.
- Only auto-execute narrow, reversible, evidence-backed, low-risk improvements.
- Owner approval is required before any change that may affect existing behavior, APIs, permissions, queue semantics, model cost, data migration, or external services.
