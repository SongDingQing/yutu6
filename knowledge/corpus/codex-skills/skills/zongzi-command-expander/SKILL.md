---
name: zongzi-command-expander
description: Use before modifying, fixing, optimizing, reviewing, deploying, or planning 粽子助手, 粽子 Codex, 粽子管理控制台, 粽子 AI 平台, 41218 控制台, 80/443 用户架构页, or the Zongzi Web control plane. Expands the user's terse request into a complete actionable command with inferred intent, missing details, stability expectations, validation, and handoff requirements before implementation.
---

# Zongzi Command Expander

Use this as the first step for Zongzi work. Its job is to turn the user's short or screenshot-backed instruction into the richer command Codex should actually execute.

If `instruction-expansion-router` also triggers, this skill is the authoritative visible expander for Zongzi work. Produce only `粽子指令补齐稿`; do not also produce a generic `全局指令补齐稿`.

## Output Contract

Before code edits or remote deployment, produce one concise Chinese block titled `粽子指令补齐稿`. Treat that block as the real working command for the rest of the turn.

Shape:

```text
粽子指令补齐稿：
请在粽子...（完整目标、推测意图、约束、验证方式、交接更新）
```

Do not stop after the block unless the user explicitly asked only for planning. Continue implementation using the expanded command.

## Expansion Workflow

1. Read the user's latest message and any screenshot carefully.
2. Extract concrete facts: target page/port, visible error, affected workflow, desired UI/behavior, accounts or roles, and any stated constraints.
3. Infer the user's likely intent from established Zongzi rules:
   - The Web control plane must preserve real Codex CLI problem-solving ability, not only mimic UI.
   - Multi-turn conversations must use true `codex exec resume` session continuity when possible.
   - Stability beats decoration: fix root cause, add regression tests, deploy, and verify live services.
   - UI should follow 玉兔 Codex style only where useful; do not copy unsupported Desktop-only features blindly.
   - 80/443 and 41218 remain port-isolated; account type is user metadata, not an org-tree folder.
   - User-visible files/skills/knowledge stay separate from operational records such as usage, conversations, sessions, and audit.
4. Add missing implementation details:
   - Check current server state, logs, CLI help, service health, and existing tests before broad rewrites.
   - Prefer existing Codex CLI, Node, systemd, journalctl, rg, curl, and project modules over duplicated Web logic.
   - If a CLI interface is involved, verify the exact subcommand's `--help`; do not assume sibling subcommands accept the same flags.
   - Update `/home/ubuntu/zongzi-control-plane-handbook/docs/zongzi-codex-web-design-guide.md` when the change creates a durable rule.
   - Add or update regression tests for the failure mode.
   - Deploy to the real scripts and restart only the needed services.
   - Verify local tests, remote tests, service active state, and public/local route health.
5. State safety boundaries:
   - Do not print, persist, or include passwords, SMTP auth codes, API keys, cookies, SSH keys, OpenAI auth, Feishu tokens, or one-time codes in the expanded command.
   - Redact sensitive values from screenshots or user text as `[已隐藏凭据]`.
   - Do not run destructive commands unless the user explicitly requested them.
6. If critical information is missing and cannot be safely inferred, ask one short question. Otherwise make a conservative assumption and proceed.

## Quality Bar

The expanded command should be specific enough that another Codex session can execute it without reading the original chat. It should mention:

- the target symptom or desired behavior;
- the likely root-cause area to inspect;
- the user-facing acceptance criteria;
- stability and regression-test expectations;
- deployment and verification requirements;
- any handoff/design-guide update needed.

Keep it compact. The block is a working command, not a long essay.
