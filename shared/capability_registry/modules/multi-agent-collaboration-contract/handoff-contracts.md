# Handoff Contracts

## Routing Principle

Hermes/Yutu is the front door. Codex is the local engineering and high-accuracy execution agent.

Use the module registry as the durable source of truth before broad code search or ad hoc guessing.

Codex sub-agents are not durable routing targets. They may be used as temporary helpers inside one interactive Codex session, but long-term routes must target stable agents, services, CLI jobs, queue workers, or machine workers.

Codex is the user's current strongest reasoning brain. Route complex planning, architecture, risk assessment, task decomposition, retrospective synthesis, and final technical arbitration to Codex before delegating execution to other stable workers.

## Precise Active Codex Session Contact

Current status:

- The user is likely to keep the Codex session open.
- Hermes/Yutu is not yet proven to be able to target this exact open Codex Desktop session.
- Hermes/Yutu is not yet proven to be a stable general-purpose task distributor.

Anti-footgun rule:

- Do not describe a Hermes-to-Codex route as precise current-session contact until it has a tested probe.
- Do not rely on invisible delivery. Every routed task needs a task id and an acknowledgement.

Minimum requirement for a future precise-contact route:

- active session label, currently `玉兔改装`
- task id
- delivery timestamp
- Codex acknowledgement event
- timeout if no acknowledgement arrives
- fallback to sidecar queue or Markdown handoff file
- Feishu-visible status so the user can see whether the task was accepted, completed, blocked, or cancelled

## Hermes To Codex: Local Coding

Use when the user asks for:

- local code changes
- Unity game features
- tests, builds, refactors, debugging
- APK build or return
- repo review
- delayed, scheduled, recurring, or repeat-limited local Codex work

Required fields:

- `project_path`: absolute path on the Mac mini
- `task`: concrete task
- `source_text`: original user request or relevant voice/Feishu record
- `verification`: optional checks to run
- `deliver_apk`: true when the user wants an APK/file back
- For scheduled work: `schedule`
- For scheduled work: optional `repeat`

User confirmation:

- Required.
- Hermes sends a Feishu `Command Required: Codex Handoff` card.
- Immediate Codex handoff starts only after approval, then enters the Hermes `codex-handoff` serial queue.
- If the task starts immediately, the user receives one combined Feishu message with the queue id and Codex run id.
- If other tasks are ahead, the user first receives a queued acknowledgement with a queue id and number of tasks ahead, then receives a start notice when the task is picked up.
- Queue/start notices should be brief. If tasks ahead are ever displayed by name, each task summary must be capped at 10 characters.
- Only one immediate Codex handoff task runs at a time; later approved tasks wait in order.
- For scheduled work, Hermes sends `Command Required: Codex Scheduled Handoff`; approval creates a Hermes cron job. Future due runs may start Codex automatically because the user confirmed the schedule.

If `project_path` is missing:

- Hermes asks one concise question for the absolute path.
- Hermes must not invent a path.

## Hermes To Codex: Email Or External Action

Use when the user asks by voice or Feishu to:

- send email
- send a report to an email address
- collect information and email it
- send to saved contacts

Known contacts:

- `主人`, `我`, `发给我`, `我的邮箱`: `songchengzuo@hotmail.com`
- `姐姐`, `我姐姐`: `scc12251988@hotmail.com`

User confirmation:

- Required for voice-originated tasks.
- Hermes sends a Feishu `Command Required: Voice Task` card first.
- After approval, the confirmed request may be handled by Codex/Gmail or an equivalent configured mail tool.

Missing information:

- If recipient is known but subject/body/search scope is missing, ask only for missing information.
- Do not ask for saved email addresses again.

## Codex To Hermes

Use when Codex needs Hermes to:

- send a Feishu confirmation card
- post progress or a result into Feishu
- use Hermes-specific Feishu gateway behavior
- update ASR hotwords or voice preferences through Hermes tools
- modify Hermes/Yutu behavior on the same Mac mini after the user asks for it

Preferred route:

- update the relevant Hermes plugin/module files
- restart the relevant LaunchAgent
- document the contract in this module

Do not bypass Hermes for Feishu card workflows unless the user explicitly asks.

## Codex Or Repair To IT Engineer: Version Release And Rollback

Use when a Yutu6 workspace change needs:

- four-part version commit
- Gitee push
- release audit
- revert-based rollback after a page is completely unrecoverable

Release entry:

- `node projects/控制台/secretary-tools.js it-release-request --part <manual|major|minor|fix> --message "..." --path <file>`
- The IT Engineer owns the actual `version-manager.js release ... --push` execution.
- The path list must be explicit. Do not use broad staging for unknown runtime artifacts or secret-bearing files.

Rollback entry:

- Repair may request rollback only when the page is completely unrecoverable.
- Repair runs `node projects/控制台/secretary-tools.js it-rollback-request --target <version-or-commit> --reason "..."`
- IT Engineer must run `version-manager.js rollback --target <version-or-commit> --dry-run` first.
- Actual rollback requires explicit owner confirmation and must use `git revert --no-commit` through the script, followed by a new four-part version commit and Gitee push.

Do not:

- rewrite Git history
- force-push
- print secrets or credentials
- route Starlaid work through this lane

Hermes modification rules:

- Prefer plugin/config/sidecar changes over invasive gateway rewrites.
- Use `/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/file-map.md` before editing.
- Never print or store `.env`, tokens, keys, session data, Feishu websocket URL, access key, or ticket values.
- Validate Python, JSON, and YAML after edits.
- Restart only the relevant LaunchAgent and inspect logs.

## Voice Task Flow

1. User speaks after wake phrase.
2. Hermes transcribes and routes.
3. If it is task-like, Hermes sends a Feishu confirmation card.
4. User approves or cancels.
5. Approved tasks are replayed as confirmed requests.
6. Hermes either handles with tools or hands off to Codex.
7. Result is sent back through the original channel when possible.

## Escalation Rules

Ask the user one concise question when:

- project path is missing
- recipient cannot be resolved
- the requested action has high impact
- multiple agents could act and the safer owner is unclear

Prefer Codex when:

- complex reasoning, architecture, or cross-agent planning is required
- local files must be changed
- exact technical verification matters
- the task involves Unity/build/test/code review
- the user wants a generated/updated document or file returned from local project work

Prefer Hermes when:

- the task is conversational
- the task is Feishu/voice state management
- the task is a simple reminder, search, or response with no local edits
