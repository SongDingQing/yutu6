# Cross-Project Skill Routes

This directory is the route layer for user-facing cross-project wrapper skills such as `玉猿`, `玉豚`, `玉凤`, `玉鼠`, `玉衡`, `玉虎`, `玉鸡`/`金鸡`, `玉龙`, `玉灵`, `玉玲珑`, `玉凰`, and `黄龙`.

The wrapper skill should stay global. Project-specific paths, build commands, art rules, story canon, upload destinations, and exclusive resources belong in a project route file here or in the project/module docs referenced by that route.

## Route Selection Order

1. Explicit project name or absolute path in the user request wins.
2. Otherwise use the current working directory.
3. Otherwise use changed/mentioned file paths.
4. If two projects match or none match, ask one short clarifying question before editing, generating art, building, uploading, or changing project docs.

Known route files:

- `Simulaid.md` for `/Users/yutu/Simulaid` / 模拟纪元 / Simulaid.

## Wrapper Support Matrix

A project route must explicitly say whether each wrapper is supported:

- `玉猿`: project-specific command expansion before execution; converts terse/mixed instructions into a complete working command and then routes to the right specialist wrapper.
- `玉豚`: image generation, repair, replacement, image debt.
- `玉凤`: story/lore/content consistency review.
- `玉鼠`: content-definition design/standardization for cards, roles, enemies, items, achievements, events, and player-facing rules copy; coordinates 玉凤/玉豚/玉衡 as needed.
- `玉衡`: test case refresh, regression coverage, automated/manual test gate.
- `玉虎`: bug root-cause audit and repair guard; requires evidence, scoped fix, validation, and rollback notes before a bug is called fixed.
- `玉鸡` / `金鸡`: gift-code operations for existing-code lookup, new-code publication, registry/runtime consistency, platform Excel exports, and reward-code image deliverables.
- `玉龙`: Android/package delivery lane.
- `玉灵`: iOS/TestFlight/App Store Connect lane.
- `玉玲珑`: combined multi-platform orchestrator.
- `玉凰`: community/store/player-facing copywriting lane.
- `黄龙`: combined Android delivery plus player-facing update-log lane.

If the route marks a wrapper as unsupported or not yet defined, stop and report the missing route instead of guessing commands from another game.

## Concurrent Agent Safety

Reading the same skill from two agents is safe: skills and route docs are static read-only instructions. Deadlocks usually come from one of these instead:

- two agents wait for each other's status/report;
- two agents write the same source/doc/asset files;
- two agents use the same external UI account/window, such as Quark, Xcode Organizer, or Unity/Tuanjie;
- one wrapper invokes another wrapper that also tries to send its own final report/voice;
- a parent agent waits synchronously for a child agent that is also waiting for parent feedback.

Rules:

1. **No mutual waiting**: agent-to-agent communication is task payloads and artifact paths, not progress chatter. Final reports converge to the user/Feishu, not to each other.
2. **Single owner per final user-facing action**: the orchestrator sends the final Feishu/voice. Child phases return status only.
3. **Use artifacts over live ids**: persist generated prompts, manifests, logs, build paths, and review notes as files; do not rely on a temporary sub-agent id as memory.
4. **Lock exclusive resources** before using Unity/Tuanjie, Xcode upload, Quark upload, shared generated asset folders, route docs, or skill architecture docs.
5. **Never wait forever**: if a lock is active and the owner is unclear or too old, report a blocker to the user instead of spinning.

### Lightweight Lock Protocol

Use this when multiple long-running agents may operate on the same Mac/project. It is intentionally file-system based so any shell-capable agent can follow it.


Helper script:

`/Users/yutu/.codex/skills/project-routes/route_lock.py`

Examples:

```sh
/Users/yutu/.codex/skills/project-routes/route_lock.py acquire simulaid.quark-upload --task "upload apk"
/Users/yutu/.codex/skills/project-routes/route_lock.py status simulaid.quark-upload
/Users/yutu/.codex/skills/project-routes/route_lock.py release simulaid.quark-upload
```

Lock root:

`/tmp/codex-skill-locks`

Acquire by creating a directory atomically:

```sh
mkdir -p /tmp/codex-skill-locks
lock=/tmp/codex-skill-locks/<project>.<resource>.lock
if mkdir "$lock" 2>/dev/null; then
  printf 'owner=%s\ntask=%s\nstarted_at=%s\nttl_seconds=%s\n' \
    "${CODEX_AGENT_LABEL:-unknown}" "<short task>" "$(date -u +%FT%TZ)" "7200" > "$lock/owner.txt"
else
  cat "$lock/owner.txt" 2>/dev/null || true
  echo "LOCKED: report blocker or wait briefly; do not run the same exclusive step in parallel."
fi
```

Release after the protected step:

```sh
rm -rf "$lock"
```

If a lock is stale, confirm that no matching process/UI operation is still running before removing it. For destructive cleanup or external upload ambiguity, ask the user.

Common resource names:

- `<project>.unity-editor`
- `<project>.android-build`
- `<project>.ios-archive`
- `<project>.quark-upload`
- `<project>.appstore-upload`
- `<project>.image-assets`
- `<project>.story-docs`
- `<project>.git-write`
- `global.skill-architecture`

## Route File Requirements

Each project route should include:

- project root and identifiers;
- canonical project/module docs to read before broad searches;
- wrapper support matrix;
- project-specific locks/resources;
- delivery destinations and account boundaries;
- story/art/style docs for 玉豚/玉凤;
- validation commands or explicit `not configured` status.
