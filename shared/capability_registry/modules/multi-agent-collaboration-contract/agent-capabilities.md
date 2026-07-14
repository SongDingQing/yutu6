# Agent Capabilities

## Hermes / Yutu

Primary role:

- Conversational front door through Feishu and voice.
- Lightweight routing, confirmation, reminders, and tool orchestration.

Can do:

- Receive Feishu messages.
- Receive voice commands after wake phrase.
- Reply by voice.
- Mirror voice replies to Feishu.
- Send Feishu text messages and interactive confirmation cards.
- Use Brave Search for live web information.
- Maintain ASR hotwords and corrections.
- Ask the user for missing task details.
- Trigger confirmed local coding handoff to Codex through the configured handoff plugin.
- Create confirmed delayed or recurring Codex schedules through Hermes cron.

Not yet proven:

- Precisely target the currently open interactive Codex session.
- Act as a stable general-purpose task distributor across agents and workers.

Should not do directly:

- Modify local project code when Codex should own the work.
- Send emails if the task should be handled by Codex/Gmail connector and user confirmation is missing.
- Guess local project paths, email recipients, or user intent for high-impact actions.

## Codex

Primary role:

- Team's current strongest reasoning brain, chief architecture/planning agent, local engineering agent, and high-accuracy tool operator.

Can do:

- Own complex architecture design, cross-agent workflow planning, risk assessment, task decomposition, and retrospective synthesis.
- Serve as the default reviewer for major Hermes, sidecar, game-development, and multi-agent workflow changes before user-facing recommendations are finalized.
- Read and edit local files.
- Inspect repositories.
- Implement features.
- Run tests, builds, linters, and command-line checks.
- Work with Unity projects when local Unity tooling is available.
- Build or locate APK artifacts when the project supports it.
- Follow only the current project's installed capability pack when generating or integrating project assets.
- Use Codex sub-agents only as short-lived helpers inside the current session; do not treat them as durable, bound, callback-capable agents.
- Keep an interactive session open for a long time when the user chooses to leave Codex running, but this is not the same as a guaranteed externally addressable session endpoint.
- Modify local Hermes/Yutu files on the same Mac mini when requested, using the Hermes module file map and validation workflow.
- Generate or update document artifacts and let Hermes return them through Feishu when the handoff requested file delivery.
- Run as a scheduled local task when Hermes cron triggers a confirmed Codex schedule.
- Use configured app connectors such as Gmail when available.
- Update module directories, skills, and persistent integration docs.

Should not do without confirmation:

- Send outbound email or files unless the user explicitly requested or confirmed it.
- Change unrelated user work.
- Expose secrets from `.env`, tokens, auth files, or logs.

Not yet proven:

- Receive a task from Hermes/Yutu into this exact currently open Codex Desktop session without relying on the user manually returning to the session.
- Provide a durable current-session callback id that Hermes can target safely.

## IT Engineer

Primary role:

- Durable queue agent for Yutu6 workspace version management, configured Git remote synchronization, release commits, and safe rollback.

Can do:

- Read and update `VERSION.json`.
- Run `node projects/控制台/tools/version-manager.js status`.
- Run versioned releases with `release --part <manual|major|minor|fix> --message "..." --path <file> --push`.
- Receive release requests through `node projects/控制台/secretary-tools.js it-release-request`.
- Receive repair rollback requests through `node projects/控制台/secretary-tools.js it-rollback-request`.
- Dry-run rollback impact before any actual revert.
- After explicit owner confirmation, create a new revert-based four-part version commit and push to the configured `origin`.

Should not do directly:

- Fix business code or UI bugs.
- Read, print, store, or distribute secrets.
- Use `git reset --hard`, force-push, delete remote branches, or rewrite history without a separate explicit owner confirmation.
- Handle project-specific business work outside an installed project department.

## Durable Worker Requirement

For the user's private agent ecosystem, durable agents should be implemented as persistent services, CLI jobs, queue workers, SSH workers, or registered machine workers. They need stable ids, task state, callbacks, timeout/cancel behavior, and artifact contracts. Codex sub-agents do not satisfy this requirement by themselves.

## Current Anti-Footgun Items

- Do not assume Hermes can precisely contact the current Codex Desktop session until a real probe confirms it.
- Do not assume Hermes can distribute tasks among agents/workers until its routing and callback behavior is tested.
- If active-session contact is attempted later, require a task id, session heartbeat, acknowledgement, timeout, and fallback path to queue/handoff files.

## User

Primary role:

- Gives task intent and approves cross-agent actions.

Confirmation required for:

- Starting Codex on a local project from a Feishu/voice request.
- Sending emails.
- Sending files/APKs.
- Any action where recipient, project path, or destructive impact is unclear.

## Future Agents

Future agents should be added here and in `agent-manifest.json`.

Each new agent entry needs:

- stable id
- human name
- strengths
- callable interfaces
- required confirmation rules
- paths to relevant skills or service files
