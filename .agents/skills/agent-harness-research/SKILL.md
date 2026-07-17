---
name: agent-harness-research
description: "Use when 玉兔6 asks the 洞察员 to research agent harnesses, coding agents, multi-agent coordination, ReAct/Reflexion/SWE-bench, open-source teardown, source audit, or to produce a broad evidence-backed optimization backlog for owner approval."
---

# Agent Harness Research

This is a project skill for `/Users/yutu6/玉兔6工作区`. It governs research and proposals only. It does not authorize changing the runtime, hooks, routing, or agent prompts beyond an explicitly approved task.

## Trigger Boundary

Use this skill for agent-harness research, coding-agent teardown, ReAct/Reflexion/SWE-bench evaluation, multi-agent coordination studies, hook/skill governance research, and broad optimization backlogs.

Do not use it for a routine bug fix, a single known-file implementation, general web lookup unrelated to agents, or as permission to install an upstream framework. Those tasks use their normal project/repair flow.

## Ownership And Lifecycle

- Owner: `insight-scout` maintains the evidence ledger; it does not approve runtime adoption.
- Required reviewers: `quality-ops` and `governance`, each with a separate review record.
- Evidence baseline: `board/insights/agent-harness-deep-research-20260714.md` and the source commits recorded there.
- Review cadence: when a referenced repository changes materially, when an agent incident contradicts the guidance, or after 90 days before reuse in a high-impact decision.
- Invalidation: source access cannot be reproduced, a repository/license changes, local architecture removes the cited gap, or a canary shows no improvement.

## Read First

1. `shared/agents/insight-scout/prompt.md`
2. `shared/agents/quality-ops/prompt.md`
3. `shared/agents/governance/prompt.md`
4. `board/insights/seen-repos.json`
5. `board/insights/borrowed-libs.md`
6. `board/insights/references/archive-index.md` only when history lookup is needed
7. `board/learning-cases/agent-harness-research-cases.md`
8. `templates/research-brief.md` and `templates/source-manifest.md`
9. `templates/open-source-teardown.md` and `templates/source-audit.md`
10. `templates/recommendation-ledger.md`, `templates/hook-skill-quality-review.md`, and `templates/eval-canary.md`

Do not load whole historical archives into context. Locate a repository, URL, title, or slot with `rg`, then read only the matching section.

## Research Modes

### Light scan

Use for the scheduled insight scan. Review 2-3 primary sources, produce at most 3 actionable candidates, and keep the hot-zone summary concise.

### Deep research

Use when the owner asks for agent harness research, a comprehensive audit, or many optimization ideas. Review 8-15 anchor sources and produce 15-50 evidence-backed candidates. Fifty is a ceiling, not a quota: never pad weak or duplicate advice.

Deep research must follow the full quality and governance review below. Group the accepted candidates into 6-10 bulletin cards so the owner can approve coherent change packages instead of handling dozens of tiny cards.

Use `## 候选账本` as the report heading, or prefix it with the actual count. The count must describe the evidence-backed result; never make the heading itself a quota.

## Required Source Set

Start with the sources relevant to the question:

- Research method: `How to be good at research` by Vivek. Prefer the primary X article; if login blocks it, mark access as limited and do not present mirror-only claims as primary evidence.
- Agent design: Anthropic `Building effective agents`; OpenAI `A practical guide to building agents`.
- Multi-agent design: Anthropic `How we built our multi-agent research system`; OpenAI Agents SDK orchestration; Microsoft AI agent orchestration patterns.
- Papers: ReAct, Reflexion, and SWE-bench from their original papers/project sites.
- Source repositories: `openai/codex`, `earendil-works/pi`, and `SWE-agent/mini-swe-agent`.

Use primary sources for technical claims: official documentation, original papers, and official repositories. Record repository commit, license, inspected files, and access date.

## Open-Source Teardown

For every repository selected for detailed study:

1. Freeze identity: URL, commit, license, language, and supported runtime.
2. Map the smallest relevant architecture slice, not the entire repository.
3. Trace one real path end to end: input -> model turn -> tool execution -> observation -> stop/persist.
4. Read the implementation and tests behind important README claims.
5. Separate reusable principles from code that should not be copied.
6. Note security, permission, portability, maintenance, and license boundaries.

## Source Audit

Build a claim-to-evidence matrix. Every recommendation needs:

- a local problem or measurable opportunity;
- a primary source or inspected source-code reference;
- expected gain and how it will be measured;
- implementation scope and owner;
- risk, rollback, and regression test;
- decision class: `recommend`, `experiment`, `defer`, or `reject`.

Record contradictory evidence and failed hypotheses. An absence of evidence must not become a recommendation.

## Three-Role Review

1. `insight-scout` gathers and maps evidence. It does not approve implementation.
2. `quality-ops` checks source quality, duplication, testability, expected gain, token cost, and rollback completeness. It rejects vague advice.
3. `governance` checks role boundaries, security, shared-state contention, infinite-loop risk, systemic blast radius, and whether owner approval is required.

No role may claim another role reviewed the work unless a separate review record exists. If the three roles cannot actually run independently, label the review as pending rather than simulating consensus.

## Recommendation Ledger

Use stable IDs such as `AHR-01`. Each item must contain:

`area | problem | evidence | proposal | expected_gain | effort | risk | validation | rollback | decision`

Do not copy long source passages. Store concise findings and references. For multi-agent research, prefer artifact paths and evidence IDs over repeating full subagent transcripts.

## Owner Gate

- Clearly beneficial research-process documentation may be updated locally.
- Runtime hooks, routing, concurrency, permissions, automatic memory promotion, model selection, and global quality gates always go to the bulletin as `todo` unless the owner explicitly approved implementation.
- Bulletin cards must state the recommendation ID range and report path.
- Do not enable a card automatically. The owner approves by enabling or explicitly instructing execution.

## Validation

Run:

```bash
node .agents/skills/agent-harness-research/scripts/validate-report.js board/insights/agent-harness-deep-research-20260714.md
node projects/控制台/tools/insight-workload-audit.js --report board/insights/agent-harness-deep-research-20260714.md
node tests/insight-scout-agent-harness-policy.test.js
node tests/insight-scout-repos.test.js
```

The validator and workload audit own mechanical checks such as count, IDs, package coverage, duplicate cards, queue state, and elapsed time. Quality and governance reviewers should consume those artifacts and spend model review only on evidence quality, architecture risk, permissions, and owner-gate decisions.

Before reporting completion, verify the report exists, every advertised recommendation ID is present exactly once, grouped bulletin cards remain `todo`, and no secret-bearing file was read or changed.
