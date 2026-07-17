---
name: quality-ops-chain-audit
description: "Use when 玉兔6 quality_ops audits agent prompts, handoffs, observable processing records, repeated reasoning, dormant routes, skill/hook/script candidates, or generates the weekly quality-operations report."
---

# Quality Operations Chain Audit

This is a project skill for `/Users/yutu6/玉兔6工作区`. It lets the `quality_ops` role reconstruct and critique complete agent interaction chains without loading unrelated raw history or exposing secrets.

## Boundary

- Audit observable records only: explicit prompt, sender/receiver role, runner, handoff metadata, result, tool/process-log references, evidence and terminal state.
- Never request, infer, save or report a model's hidden chain of thought. Use concise `chain_summary`, evidence-backed findings and decision rationale instead.
- Read `*.redacted.*` trace files. Do not open raw secret/config files. If a redacted trace is insufficient, mark the review `warning` and cite the missing evidence.
- Quality operations may create `todo` bulletin proposals for owner approval. It may not enable them or directly change production code.

## Read First

1. `/Users/yutu6/玉兔6工作区/shared/agents/quality-ops/prompt.md`
2. The batch file supplied by `projects/控制台/tools/quality-ops-audit.js`
3. `projects/控制台/artifacts/quality-ops/policy.json`
4. `projects/控制台/artifacts/quality-ops/review-ledger.json`
5. Only the batch's `trace_refs`; use `root_task_id` with `engine-events.jsonl` and handoff `meta.json` when a link is missing

Do not scan all `engine-runs` blindly. The index is the entry point and the batch is the attention budget.

## Reconstruct One Chain

For every planned `chain_id`:

1. Start from `root_task_id` and order trace spans by timestamp.
2. Record who sent the instruction, which prompt/acceptance was passed, which role and runner received it, and whether a tool harness introduced a planner/executor pair.
3. Compare expected output with the observable result and evidence references.
4. Follow downstream queue/root IDs and event-log handoffs until the chain reaches a terminal state.
5. Check for requirement loss, duplicated context/reasoning, unverified self-report, role boundary violations, idle or rarely used routes, needless model calls, repeated manual steps and missing reusable knowledge.
6. Give `pass`, `warning` or `fail`; every verdict needs file/event evidence.

## Sampling Policy

- For seven days from `policy.activated_at`, the noon job covers every unreviewed new/changed chain, split into bounded batches.
- From day eight, use weighted random sampling. Cold/rarely used routes are selected first, then weighted sampling fills the remaining quota.
- `review-ledger.json` keys reviews by `chain_id + content_hash`; unchanged chains are not sampled repeatedly. A changed content hash makes a chain eligible again.
- Reservations expire after the policy TTL, so a failed audit can be retried without permanently losing coverage.

## Turn Findings Into Owner Decisions

Classify each evidence-backed optimization as one of:

- `script`: deterministic repeated commands or transformations.
- `skill`: reusable judgment with stable inputs/outputs.
- `hook`: a small automatic check at a known lifecycle point.
- `process` or `prompt`: handoff, context or role-contract improvement.
- `role_boundary`: ownership or dormant-route correction.
- `test` or `knowledge`: durable regression/evidence material.

Use `projects/控制台/tools/quality-ops-audit.js ingest`. It deduplicates by proposal fingerprint and persists only `source=质量运营,status=todo` cards. Do not edit `cards.json` directly.

## Required Findings Contract

Write `yutu6-quality-ops-findings@1` JSON containing:

- `audit_id`, `batch_id`
- one `chain_reviews` row for every planned chain
- each row: `chain_id`, `chain_summary`, `verdict`, non-empty `evidence_refs`, `findings`
- optional `proposals`, each with `title`, `desc`, allowed `category`, `benefit`, `risk`, `project`, non-empty `evidence_refs`

Ingest rejects missing chain reviews, evidence-free verdicts, unplanned chain IDs and unsupported proposal categories.

## Weekly Report

Every Saturday at 21:00, run:

```bash
node projects/控制台/tools/quality-ops-audit.js weekly
```

The PDF is written to `/Users/yutu6/Documents/玉兔质量运营报告/`. Verify the file exists, starts with `%PDF`, and includes chain coverage, findings, cold-route attention, proposal counts and pending reservations.

## Validation

```bash
node tests/interaction-trace.test.js
node tests/quality-ops-audit.test.js
node tests/quality-ops-weekly-report.test.js
node tests/run.js
```

If trace capture fails, task execution must continue; report the observability gap rather than breaking the business workflow.
