# Operations

## Validate Trigger

```bash
node projects/控制台/tools/self-reflection-trigger.js \
  --dry-run \
  --source board/learning-cases/self-reflection-optimizer-cases.md \
  --module ui-optimizer \
  --reason test
```

## Run Policy Tests

```bash
node tests/self-reflection-optimizer.test.js
```

## Enqueue From A New Case

```bash
node projects/控制台/tools/self-reflection-trigger.js \
  --source board/learning-cases/<case-file>.md \
  --module <module-id-or-name> \
  --reason "excellent case added"
```

## Maintenance Rules

- Keep trigger state in `projects/控制台/artifacts/self-reflection-optimizer/trigger-state.json`.
- Treat idempotency as case-entry scoped: the trigger hashes the selected latest `##` case entry, not the whole case file, so old-case edits do not retrigger the same optimization.
- Keep reusable lessons in `board/learning-cases/self-reflection-optimizer-cases.md`.
- Do not bypass secretary/CEO routing for normal non-repair optimization tasks.
- Do not execute owner-decision items without explicit approval.
