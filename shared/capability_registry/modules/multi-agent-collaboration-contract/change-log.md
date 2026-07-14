# Change Log

## 2026-04-26

Created shared multi-agent collaboration contract module.

Initial scope:

- persistent agent capability map
- Hermes-to-Codex handoff contracts
- email task recipient mapping
- confirmation boundaries
- module discovery flow for Codex, Hermes, and future agents

## 2026-04-27

Extended handoff contract for document/file return requests.

Changes:

- Codex handoff can now mark `deliver_document` when the user asks for a document/file/report to be sent back.
- Hermes should use `$HOME/.hermes/codex-handoff/latest-status.json` as the durable latest Codex completion status.
- Document artifacts supported for return: `.md`, `.txt`, `.pdf`, `.docx`, `.xlsx`, `.pptx`.

Added scheduled Codex handoff contract.

Changes:

- Hermes can create delayed, timed, recurring, or repeat-limited Codex schedules after Feishu confirmation.
- Scheduled Codex work uses Hermes cron plus generated runner scripts.
- Each approved schedule can run future Codex tasks automatically because the user approved the schedule boundary.

## 2026-04-28

Migration hardening for new Codex accounts.

Changes:

- Added support for project-pack asset skills in the Codex capability manifest.
- Clarified that project-specific art pipelines are loaded only when that project pack is installed.
- Handoff file now distinguishes Codex CLI handoff from interactive Codex Desktop connector abilities.
- Clarified that auto-returned artifacts should be generated inside the project path so Hermes can find and attach them.

Added an optional project image-worker delegation contract.

Changes:

- Documented session-limited image helpers without making them durable system roles.
- Documented that live sub-agent IDs are not durable across accounts; prompts, style rules, filenames, and output paths are the persistent contract.
- Project packs may delegate substantial image generation while their supervisor keeps integration and verification.

## 2026-04-29

Added private agent ecosystem roadmap.

Changes:

- Captured the user's full long-term intent for private multi-agent orchestration, game development, idea persistence, queueing, ASR, file transfer, and operational control.
- Added `private-agent-ecosystem-roadmap.md` to the module read order.
- Recorded the current hardware/network assumptions: Mac mini front door, high-performance 5090/9950X3D workstation, and additional network servers.
- Recommended building a sidecar orchestration server before invasive Hermes internals changes.

Updated durable-agent assumptions.

Changes:

- Clarified that Codex sub-agents are ephemeral session helpers, not durable bound agents.
- Added the requirement that long-term agents be persistent services, CLI jobs, queue workers, SSH workers, or registered machine workers.
- Clarified that Codex can modify the local Hermes Agent on the same Mac mini when requested, but Hermes changes must follow the module file map, validation, restart, and log-check workflow.

Recorded Codex chief-brain role.

Changes:

- Captured the user's statement that Codex is currently the team's strongest reasoning brain.
- Updated routing guidance so complex architecture, risk assessment, task decomposition, and final technical synthesis default to Codex before execution is delegated.

Added low-frequency user assistance protocol for the sidecar/control-center workstream.

Changes:

- Recorded the session name `玉兔改装`.
- Codex should continue autonomously for safe and locally verifiable steps.
- If user help is required, Codex must write a handoff file, send a Feishu reminder through 玉兔/Hermes, then stop.

Added precise-current-session contact and task-distribution probes to the anti-footgun list.

Changes:

- Recorded that the user likely will keep the Codex session open, but Hermes/Yutu is not yet proven to target this exact session.
- Added a planned, unverified `hermes_to_active_codex_session_probe` route.
- Added a requirement that any future precise-contact route needs a task id, acknowledgement, timeout, fallback, and Feishu-visible status.
- Recorded that Hermes/Yutu task distribution ability is unknown until tested.

Added first reliability upgrade for Hermes-to-Codex task handoff.

Changes:

- Immediate approved Codex handoff tasks now use the Hermes `codex-handoff` serial queue.
- Direct `/codex` requests also enter the same queue.
- Queue acknowledgements include a queue id and how many tasks are ahead.
- This is deliberately scoped to Codex/local coding tasks; ordinary Hermes chat is not yet globally serialized.

Reduced duplicate Feishu queue/start messages.

Changes:

- Immediate first-in-queue Codex handoff now combines queue acknowledgement and start notice into one Feishu message.
- Waiting tasks still receive an early queued acknowledgement and a later start notice.
- Recorded remaining reliability gaps: no automatic queue replay after gateway restart, no queued-task cancellation button yet, and no global ordinary-chat serialization.

Shortened queue messages and capped future task summaries.

Changes:

- Queue/start Feishu notices now use compact short-id wording.
- Future task-ahead summaries are capped at 10 characters through `task_summary`.
