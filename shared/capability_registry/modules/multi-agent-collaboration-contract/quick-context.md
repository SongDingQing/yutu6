# Quick Context

This module turns the local module directory into a persistent collaboration layer.

玉兔6 current authority:

- Workspace root: current Git worktree root.
- Capability registry: `shared/capability_registry/registry.json`.
- Module root: `shared/capability_registry/modules/`.
- Runtime secrets and provider settings: `${YUTU6_CONFIG_DIR:-~/.config/yutu6}` only.

Hermes/Yutu should use it before deciding whether to:

- answer directly
- use a tool
- send a Feishu confirmation card
- hand a local coding task to Codex
- ask one concise follow-up

Codex should use it before modifying Hermes/Codex integration, adding modules, or debugging cross-agent flows.

Current agents:

- `hermes-yutu`: voice, Feishu conversation, confirmation cards, Brave Search, task routing, user-facing assistant behavior.
- `codex`: local code editing, tests, builds, repo review, Unity/project changes, Gmail sending through Codex app connector when available.
- `it-engineer`: Yutu6 workspace four-part versioning, current Git origin commit/push, and safe revert-based rollback coordination.
- `user`: final authority for confirmation, permissions, recipients, and local project intent.

Key linked module:

- `hermes-yutu-voice-bridge` for voice wake, Feishu records, task cards, ASR hotwords/corrections, Brave Search, Codex handoff.
