# Private Agent Ecosystem Roadmap

Updated: 2026-04-29

This document captures the user's long-term architecture intent for a private multi-agent ecosystem. It is a durable planning source for Codex, Hermes/Yutu, and future agents.

## Core Background

The user is not a full-time professional developer. The user's strengths are architecture imagination, logic, product direction, and creative inspiration. The system should not require the user to read code line by line, repeat manual instructions, watch fast model output, or remember every idea from long conversations.

The long-term goal is a private multi-agent ecosystem for:

- game development
- UI and interaction iteration
- game numeric tuning
- game mechanism design
- scene and prop generation
- model rendering and image asset generation
- function and formula configuration
- project analysis, planning, implementation, build, and delivery

The user wants AI/agents to absorb large amounts of code analysis, cyclic reasoning, task decomposition, scheduling, and reporting. The user should mainly provide inspiration, make decisions, and approve important results.

## Current Known Environment

Local front door:

- Hermes / 玉兔
- Feishu messages and confirmation cards
- local voice wake and speech reply
- Mac mini is the always-on local machine where both Codex Desktop/CLI access and Hermes Agent are installed

Current Hermes/Yutu capabilities:

- can send messages
- can send confirmation requests/cards
- can send images
- cannot reliably send large files yet
- local voice interaction currently depends on headset microphone because a dedicated microphone is not yet installed

Available compute and network:

- good local network bandwidth
- two computers
- one high-performance main workstation: RTX 5090, Ryzen 9950X3D, 64 GB memory
- network servers with acceptable bandwidth and latency

Implication:

- Mac mini can remain the always-on router/front-door/automation node.
- Codex can inspect and modify Hermes on the same Mac mini, but Hermes changes must use a careful validation path because Hermes owns the Feishu and voice front door.
- Codex is currently designated by the user as the team's strongest reasoning brain: the chief architecture, planning, risk-evaluation, decomposition, and retrospective-review agent.
- High-performance workstation can be used later for heavy GPU tasks: rendering, local models, asset generation, batch builds, simulation, and large code analysis.
- Network servers can become worker nodes, file relays, queues, model endpoints, or monitoring/reporting nodes.

## Persistent Pain Points

### Human Workflow Pain

- Ideas appear during voice/text conversations and are easy to lose.
- Human memory keeps only part of the conversation; hidden requirements and good architecture ideas vanish.
- Model output is often faster than the user can read.
- The user does not want to watch screens continuously.
- Repeated manual prompting is draining and inefficient.

### Hermes/Yutu Pain

- Hermes can be interrupted by new messages and lacks a true serial queue.
- Modifying Hermes is risky because Feishu official interface connectivity must not be broken.
- Hermes is MIT-licensed and modifiable, but modifications must be treated conservatively.
- Local ASR latency is high, around many seconds in some cases.
- ASR needs hotwords, corrections, and semantic repair to preserve creative flow.
- Voice currently depends on headset microphone until a dedicated microphone is installed.

### Multi-Agent Pain

- Sessions can hang when one agent waits for another agent's report.
- Agents should not create circular reporting dependencies.
- Existing coding tools do not provide enough automatic cyclic analysis.
- Long-running work needs progress reporting, summaries, and interruption controls.
- Codex sub-agents are not durable worker agents. A parent Codex session and a spawned sub-agent do not create a persistent bound relationship; after the sub-agent finishes, it is closed and its live id is not a reliable long-term routing target.

### Delivery Pain

- Feishu can send messages/cards/images, but large file delivery is limited.
- Game development produces large artifacts: APKs, resource packs, videos, generated images, model files, and logs.
- A stronger file transport layer is needed.

## Non-Negotiable Design Principles

### User As Global Approval Sink

All results converge to the user. Agents may pass tasks to each other, but they must not build mutual reporting loops.

Rules:

- Agents report final results, blockers, and approval requests to the user-facing surface.
- Agent-to-agent messages should be task payloads, not status chatter.
- High-impact actions require user confirmation.
- The user can approve, cancel, interrupt, or reroute work.

### Codex As Chief Reasoning Architect

The user currently treats Codex as the strongest brain in the team.

Codex should own or review:

- cross-agent architecture design
- task decomposition and prioritization
- hidden requirement extraction
- risk assessment and safety boundaries
- Hermes modification plans
- game-development workflow templates
- long-running analysis synthesis
- final technical reports before they are shown to the user

Codex should not become a bottleneck for every small execution step. Routine work should still be delegated to stable workers, Hermes tools, sidecar jobs, CLI jobs, GPU workers, or server workers when appropriate. Codex's durable role is to think, design, arbitrate, verify, and integrate.

### One-Way Workflow Over Mutual Waiting

Use one-way work pipelines instead of strong synchronous dependencies.

Preferred pattern:

- producer emits placeholder or contract output
- downstream work continues
- specialist later replaces placeholder with final artifact
- aggregator reports status to user

Avoid:

- agent A waits for agent B
- agent B waits for agent C
- no callback exists
- whole session hangs

### Placeholder First, Specialist Replacement Later

For game development:

- generator agent can create white-screen placeholder, rough icon, mock asset, or stub data immediately
- feature development continues using placeholder contracts
- specialist agent later produces polished asset/model/render
- integration layer swaps final asset in without blocking earlier work

### Operations Agent Can Interrupt Safely

Introduce an operations/control agent role that can:

- list active tasks by id
- pause or cancel tasks
- kill runaway processes
- mark workflow as failed or blocked
- keep running tasks safe when possible
- avoid destructive cleanup without user confirmation

### Durable Agents Over Session Sub-Agents

Codex sub-agents can be useful as short-lived parallel helpers inside one interactive session, but they do not satisfy the user's long-term architecture requirements.

Rules:

- Do not model Codex sub-agents as durable ecosystem agents.
- Do not rely on parent-child binding, because the binding is session-scoped and disappears after completion.
- Do not assign long-running queues, scheduled tasks, persistent identity, or cross-session callbacks to Codex sub-agents.
- Use persistent workers instead: sidecar-managed processes, Hermes plugins, Codex CLI jobs, network services, SSH workers, or registered machine workers.
- If a sub-agent is used, persist its output as files, manifests, prompts, reports, and artifacts, not as a live agent id.

### Persistent Idea Capture

Every substantial conversation should be capturable as:

- raw inspiration
- clarified requirement
- hidden assumptions
- task candidates
- risks
- dependencies
- decisions
- follow-up questions

This should be persisted in module docs, project docs, or a future self-hosted knowledge base.

### Low-Frequency User Assistance Protocol

For the current sidecar/control-center workstream, the user named the session `玉兔改装`.

Codex should keep working when the next action is safe, reversible, and locally verifiable. Codex should not ask the user for routine implementation details, smoke tests, or documentation choices.

If user help is truly required, Codex must:

1. write the remaining work, current state, blocker, and exact question to a Markdown handoff file
2. send a short Feishu reminder through 玉兔/Hermes asking the user to return to the current Codex session
3. stop active work after the reminder is sent

The current sidecar project keeps the detailed rule at:

`/Users/yutu/agent-control-center/ASSISTANCE_PROTOCOL.md`

### Active Codex Session Contact Anti-Footgun

The user currently does not plan to close the Codex session. This makes active-session workflows worth testing, but it does not prove that Hermes/Yutu can precisely contact the exact currently open Codex Desktop session.

Record this as a P0/P1 validation item:

- verify whether Hermes/Yutu can address the currently open Codex session
- verify whether Hermes/Yutu has enough routing ability to distribute tasks safely
- require task id, acknowledgement, timeout, and fallback before calling the route reliable
- keep sidecar queue/handoff files as the fallback if active-session contact fails

## Target Architecture

### Layer 1: User Interaction Surfaces

Initial surfaces:

- Feishu text messages
- Feishu confirmation cards
- local voice wake and speech reply
- images

Future self-built surface:

- custom chat client
- task dashboard
- workflow cards
- voice call-like interaction
- file/video/audio transfer
- interrupt and reroute buttons
- progress and report views

### Layer 2: Agent Gateway

Current gateway:

- Hermes/Yutu

Future gateway responsibilities:

- receive messages and voice
- normalize input
- perform ASR correction and hotword enrichment
- identify user intent
- ask concise clarification questions
- generate confirmation cards
- submit tasks to queue
- send summaries and final reports

Important:

- Hermes should remain stable until Feishu connectivity risk is understood.
- New queue/orchestration can initially be built outside Hermes as a sidecar service, then integrated cautiously.

### Layer 3: Orchestration And Queue

Required capabilities:

- serial queue for Hermes/user requests
- priority lanes
- delayed jobs
- recurring jobs
- task id for every job
- task state machine
- timeout
- retry
- cancellation
- progress events
- result artifact registry
- no agent-to-agent mutual waiting

Recommended task states:

- `created`
- `needs_user_confirmation`
- `queued`
- `running`
- `waiting_external`
- `placeholder_ready`
- `artifact_ready`
- `blocked`
- `failed`
- `cancelled`
- `completed`

### Layer 4: Agent Registry And Router

The registry should define:

- agent id
- capability tags
- transport method
- input contract
- output contract
- cost/risk profile
- interruption method
- file/artifact permissions
- whether user confirmation is required

The existing module registry is the seed:

- `/Users/yutu/.codex/modules/INDEX.md`
- `/Users/yutu/.codex/modules/multi-agent-collaboration-contract/`
- `/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/`

Future route examples:

- `yutu-frontdoor`: conversation and confirmation
- `codex-chief-architect`: strongest reasoning brain for planning, decomposition, risk assessment, review, and integration
- `codex-engineer`: local code edits and verification
- `ops-controller`: pause/cancel/kill/retry
- `game-designer`: mechanics/numerics/specs
- `ui-agent`: UI decomposition and implementation
- `asset-agent`: image/model/scene generation
- `render-agent`: GPU rendering on 5090 workstation
- `file-agent`: SFTP/artifact transfer
- `report-agent`: periodic summaries and Feishu reports

Do not treat Codex spawned sub-agents as entries in this durable registry unless they are backed by a real persistent service. They are temporary execution helpers, not stable infrastructure.

### Layer 5: Artifact And File Transport

Feishu remains good for:

- messages
- summaries
- confirmation cards
- small images

Need a separate artifact channel for:

- APKs
- large documents
- Unity projects
- generated art packs
- videos
- model files
- logs

Candidate direction:

- self-hosted SFTP
- artifact registry database
- signed download links
- local LAN transfer between Mac mini and main workstation
- optional server relay for remote access

Every artifact should have:

- artifact id
- task id
- type
- path or remote URL
- size
- checksum when useful
- retention policy
- human-readable summary

### Layer 6: Reporting And Review

The user should not have to watch long output.

Required reports:

- short Feishu conclusion
- detailed Markdown report
- risk table
- changed file list
- validation result
- open questions
- next recommended actions

For long analysis:

- run multiple rounds automatically
- each round produces a small summary
- final aggregator merges findings
- contradictions are marked instead of hidden

## Major Workstreams

### Workstream A: Hermes Risk Analysis And Safe Modification

Goal:

- Understand Hermes deeply before modifying queue behavior.

Tasks:

- read Hermes source in bounded passes
- identify Feishu gateway files
- identify plugin system boundaries
- identify certificate/auth/env dependencies without exposing secrets
- identify modules that should not be modified
- analyze message dispatch and interruption behavior
- build baseline tests for current Feishu connectivity
- document what changes are safe as sidecar vs inside Hermes
- only modify Hermes internals when risk is acceptable

Current local modification reality:

- Hermes Agent is installed on the same Mac mini where Codex can read and edit files.
- Codex can modify Hermes plugins, voice wake code, configuration, and local docs.
- Codex should not directly edit `.env`, auth material, private keys, tokens, or Feishu websocket/session details.
- Any Hermes code change should be followed by syntax/config validation, LaunchAgent restart, and log inspection.
- For invasive gateway or Feishu-connection changes, prefer a sidecar or plugin-level change first.

Safety threshold:

- Feishu connection and existing behavior should have at least 98 percent confidence of being preserved before invasive refactor.

Important:

- This percentage is a decision threshold, not a mathematically guaranteed fact.
- Confidence should be based on test coverage, code ownership, rollback path, and observed behavior.

### Workstream B: Queue And Workflow Sidecar

Goal:

- Avoid risky Hermes invasive changes at first.

Design:

- Hermes receives input.
- Hermes forwards task requests to a sidecar queue.
- Sidecar enforces serial execution, priority, cancellation, timeout, and status.
- Sidecar calls Codex/Hermes/tools/workers.
- Feishu receives card updates and final summaries.

Why sidecar first:

- lower risk to Feishu connectivity
- easier to test independently
- easier to rollback
- can later replace or absorb Hermes internals

### Workstream C: Multi-Agent No-Deadlock Template

Standard template:

1. User request enters front door.
2. Router creates task id.
3. Planner decomposes into independent or one-way subtasks.
4. Blocking dependencies are converted to placeholders whenever possible.
5. Specialist agents work asynchronously.
6. Aggregator monitors status by task id.
7. User receives summary and approval points.

Forbidden:

- agent A waits in chat for agent B's natural-language reply
- agent B must report to agent A before user sees progress
- no timeout
- no task id
- no artifact contract

### Workstream D: Self-Built Agent Control Server

Core modules:

- message service
- user identity and permission model
- task queue
- card/control UI
- SFTP/artifact service
- voice pipeline
- ASR correction and hotword store
- agent registry
- scheduler
- reporting service
- audit log
- process controller

Suggested implementation phases:

1. Minimal control server and queue.
2. Feishu bridge adapter.
3. Codex local worker adapter.
4. Artifact store and SFTP.
5. Report generator.
6. Voice/ASR upgrade.
7. Multi-machine worker pool.
8. Custom UI client.

### Workstream E: Voice And ASR Upgrade

Near-term:

- keep headset microphone support flexible
- do not hardcode temporary device names
- keep hotwords and corrections persistent
- fast local replies for time/status/simple commands
- reduce perceived latency with short acknowledgement audio

Mid-term:

- add dedicated microphone
- tune silence detection
- stream audio chunks instead of record-then-transcribe when possible
- keep domain hotword profiles per project
- add semantic correction after ASR

Fallback:

- if local ASR cannot meet realtime needs, evaluate online realtime ASR providers with latency, cost, privacy, and hotword support.

### Workstream F: Game Development Standard Workflow

Every game task should become a structured spec:

- original user idea
- normalized requirement
- affected layer: UI, data, mechanics, function logic, assets, scene, build, delivery
- priority
- dependency
- placeholder strategy
- responsible agent
- expected files
- validation
- rollback plan
- report format

For Simulaid:

- read `/Users/yutu/Simulaid/MODULE_INDEX.md`
- read `/Users/yutu/Simulaid/CODE_INDEX.md`
- read `/Users/yutu/Simulaid/DESIGN.md`
- use `/Users/yutu/.codex/skills/simulaid-pixel-art-assets/SKILL.md` for art assets

## Immediate Task Backlog

### P0: Stabilize Current System

- Confirm Hermes gateway and voicewake health checks.
- Add clear runbook for microphone loss and restart.
- Confirm Gmail connector behavior after account switch.
- Confirm Codex CLI login and handoff smoke test.
- Confirm Feishu card approve/cancel update behavior.
- Probe whether Hermes/Yutu can precisely contact the currently open Codex session.
- Probe whether Hermes/Yutu can safely distribute tasks or only forward specific known handoff types.

### P1: Preserve Ideas And Context

- Create a permanent idea-capture workflow.
- Add a Feishu command/card for "save inspiration".
- Convert long conversations into structured Markdown reports.
- Store decisions and open questions under module/project docs.

### P1: Sidecar Queue Design

- Design task schema.
- Design state machine.
- Design queue persistence.
- Design timeout/retry/cancel.
- Design Feishu summary and card updates.
- Decide whether the first version uses SQLite, file JSON, Redis, or another store.
- Add a future active-session contact adapter only after acknowledgement and timeout behavior is proven.

### P1: Multi-Agent Deadlock Prevention

- Write reusable no-deadlock template.
- Define placeholder artifact contracts.
- Define async replacement workflow.
- Add rule: agents pass task payloads, not report loops.

### P2: Hermes Source Analysis

- Plan 10 independent source-analysis rounds.
- Each round must have scope and summary.
- Produce risk map before code changes.
- Avoid broad invasive refactor until baseline tests exist.

### P2: Artifact Transfer

- Prototype local artifact registry.
- Add SFTP or download-link path.
- Define file size limits for Feishu vs artifact server.
- Add large file reporting cards.

### P2: Voice Upgrade

- Improve local ASR latency.
- Add hotword profiles.
- Add semantic correction.
- Evaluate online realtime ASR only if local cannot satisfy user flow.

### P3: Multi-Machine Worker Pool

- Register high-performance workstation as GPU/render worker.
- Register network servers as remote workers.
- Define SSH/SFTP job execution protocol.
- Add worker health checks and capacity tags.

## Hidden Requirements Inferred From User Intent

- The system needs a product-level control plane, not only scripts.
- Every long-running task needs a visible task id.
- Every high-impact action needs an approval boundary.
- Every generated artifact needs a stable registry entry.
- Every agent must have a timeout and cancellation path.
- Every workflow should degrade gracefully with placeholders.
- Reports should be written for decision-making, not raw log dumping.
- The architecture should support future commercial or semi-commercial use without relying on fragile hidden state.
- Large-file delivery should not depend on Feishu alone.
- The Mac mini should be treated as an always-on orchestrator, not necessarily the heavy compute node.

## Open Design Questions

- What should be the first persistence backend for the sidecar queue: JSON, SQLite, Redis, or Postgres?
- Should the control server be LAN-only at first or internet-accessible through a secure tunnel?
- Which machine should host the artifact store?
- How should the 5090 workstation be woken, authenticated, and monitored?
- Which tasks are allowed to run automatically after schedule approval?
- What is the maximum acceptable ASR round-trip latency for creative voice sessions?
- Which assets must be reviewed by the user before entering Unity?

## Current Recommendation

Do not start by heavily modifying Hermes internals.

Build a sidecar orchestration server first:

- lower risk
- easier rollback
- easier testing
- can preserve Feishu compatibility
- can become the future self-built agent control software

Hermes remains the current front door, while the sidecar gradually takes responsibility for queueing, routing, task state, artifacts, reports, and process control.
