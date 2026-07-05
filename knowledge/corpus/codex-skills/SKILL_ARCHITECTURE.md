# Codex Local Skills Architecture

Last updated: 2026-06-11

This is the durable architecture map for `/Users/yutu/.codex/skills`. It helps future Codex sessions choose the right skill entry point, avoid duplicate workflow memory, and keep project skills aligned with local modules.

## 1. Architecture Principle

Use skills as **thin, triggerable operating manuals** and modules/project docs as **durable knowledge stores**.

- A skill should answer: when to load, what to read first, what workflow to follow, what not to do.
- A module/doc should hold deeper architecture, file maps, contracts, history, ledgers, and long reference material.
- Wrapper skills should route to lower-level engine skills instead of duplicating all commands.
- Project-specific skills should always name the absolute project root and canonical index/docs.

## 2. Current Skill Layers

### Meta / local-memory layer

- `module-registry`: first stop for persistent local modules, Hermes/Yutu, Feishu, multi-agent contracts, Simulaid delivery modules, Starlaid, and other durable local systems.
- `instruction-expansion-router`: global first-pass command expansion router. Use before non-trivial terse/spoken/screenshot-backed/project/agent tasks; it routes to project-specific expanders such as Simulaid, YuanXiao/Yutu/Hermes, Zongzi, or Starlaid instead of duplicating their rules.
- `skill-standard-reviewer`: quality gate for creating/updating any skill. It must read this architecture map before broad skill refactors.
- `user-clipboard-response`: user workflow preference for "一句话"/"一段话"/copy-ready handoff text. It should copy the final wording directly into the macOS clipboard before replying.
- `multi-agent-collaboration-contract`: Hermes/Codex/future-agent capability and handoff contract.
- `personal-contacts`: email/contact lookup only; keep secrets and one-off message content out of skill files.
- `hermes-yutu-voice-bridge`: Feishu/Yutu/voice bridge entry; detailed behavior lives under `/Users/yutu/.codex/modules/hermes-yutu-voice-bridge`.


### Cross-project wrapper route layer

- `project-routes/INDEX.md`: canonical route-selection and concurrent-agent safety rules for cross-project wrappers. Read it when touching `玉猿`, `玉豚`, `玉凤`, `玉鼠`, `玉衡`, `玉虎`, `玉鸡`/`金鸡`, `玉龙`, `玉灵`, `玉玲珑`, `玉凰`, or `黄龙`, or when a user asks whether these wrappers can work across games.
- `project-routes/Simulaid.md`: Simulaid-specific paths, docs, supported wrappers, delivery destinations, and lock names.
- `project-routes/Starlaid.md`: Starlaid-specific paths, docs, supported wrappers, and currently unsupported delivery lanes.

Design rule: the `玉*` wrapper skills are global user-facing names; project routes decide what each wrapper means for a given game. If a route does not explicitly support a wrapper, stop and report the missing route instead of borrowing commands from another game.

### Simulaid central layer

- `simulaid-command-expander` / `玉猿`: preflight instruction expansion for Simulaid. Use before Simulaid development, bug fixes, balance, UI, story/content, assets, tests, builds, releases, architecture reviews, regression work, or named Simulaid wrapper tasks so terse user requests become complete executable commands with inferred intent, scope, validation, version/build requirements, risks, rollback, and downstream skill routing. It must not replace the specialist skills; it runs first, then `simulaid-unity-maintenance`, `玉鼠`, `玉虎`, `玉衡`, `玉龙`, `黄龙`, etc. execute the work.
- `simulaid-unity-maintenance`: mandatory base for Simulaid runtime/code/build/doc/version work. First read `/Users/yutu/Simulaid/CODE_INDEX.md`.
- `simulaid-studio-operating-model`: production-hub / small studio lens for major Simulaid feature, bug, balance, QA, content, or release planning.
- `simulaid-architecture-guardian`: repeated-bug forensics, architecture audit, CODE_INDEX/testing/bug-ledger drift checks, and future-agent reliability hardening for Simulaid. Use when the user asks why older bugs were misjudged, whether the codebase is too bloated, or how to make future Simulaid work safer.
- `玉鼠`: cross-project content-definition steward. For Simulaid, use it before adding/changing cards, roles, story events, enemies, items, equipment, achievements, or player-facing rules copy; it coordinates 玉凤 for canon, 玉豚 for final art/no-placeholder gates, and 玉衡 for matching tests.
- `玉衡`: cross-project test-refresh wrapper. For Simulaid, it audits the current diff/user request, adds or updates matching tests in `Packages/com.joesong.simulaid.tests`, updates testing/bug ledgers when needed, and runs the Simulaid test gate before delivery. For Starlaid, it routes to `starlaid-test-maintenance`.
- `玉虎`: cross-project bug root-cause guardian. Use it before fixing bugs, regressions, or player-reported issues; for Simulaid it requires root-cause evidence, narrow fixes, regression tests/manual guards, bug-ledger updates, and rollback notes before claiming a bug is fixed.
- `玉鸡` / `金鸡`: cross-project gift-code operations wrapper. For Simulaid, use it for existing-code lookup, new-code publication, `GIFT_CODE_REGISTRY.md` hygiene, `SimulaidGameUI.GiftCodes.cs` consistency, TapTap/platform Excel exports, and reward-code image deliverables.
- `simulaid-code-refactor-navigation`: navigation/refactor map for splitting large files and improving future code search.
- `simulaid-performance-refactor`: performance and future-agent-oriented refactor workflow.
- `simulaid-ui-regression-review`: repeated UI/layout bug review gate and bug ledger workflow.

### Simulaid delivery layer

- `玉龙`: user-facing Android optimize/build/Quark-delivery shortcut. Thin wrapper over `simulaid-optimize-build-deliver`.
- `玉灵`: user-facing iOS export/archive/TestFlight lane. Must stay separate from Android signing and Quark work.
- `玉玲珑`: combined Android+iOS orchestrator. It owns the single combined Feishu/Yutu report and local voice announcement.
- `黄龙`: combined Android delivery plus 玉凰 update-log shortcut. It runs 玉龙 first, then uses the delivery ledger for 玉凰's player-facing version log.
- `simulaid-optimize-build-deliver`: Android delivery engine plus optimization/resource/refactor phases.
- `simulaid-build-qq-delivery`: legacy-named Android build/reminder/Quark skill; QQ sending is disabled by default.
- `simulaid-taptap-release-gate`: TapTap-specific Android gate for package name, 64-bit, CVE patch, signing, install/startup compatibility, and review blockers.

### Simulaid marketing / community layer

- `玉凰`: user-facing TapTap/community/store copywriting shortcut. It routes through project-routes and the Simulaid marketing bridge, and locks the user's preferred sincere developer voice for player-facing text.
- `玉鸡` / `金鸡`: user-facing gift-code release/export shortcut. It routes through project-routes and the target game's registry/source files, then produces concise code lists, Excel batches, and reward image assets without leaking hidden codes into public logs unless explicitly requested.
- `simulaid-marketing-planning-bridge`: planning/copy/launch/community handoff anchor for Simulaid marketing work.
- Simulaid update-log range state lives in `/Users/yutu/.codex/modules/simulaid-marketing-planning-bridge/release-version-ledger.md`; `玉龙`/`玉玲珑` append Android delivery versions there and `玉凰` reads it before drafting player-facing changelogs.

### Simulaid content / asset layer

- `玉豚`: user-facing Simulaid image-generation entry. Main Codex session owns generation by default.
- `玉凤`: Simulaid story/lore/content consistency reviewer; use before story-sensitive 生图、剧情、事件、角色、道具、卡牌、成就、漫画 work.
- `玉鼠`: Simulaid content-definition and copy-standardization entry; use before newly designing or revising cards, roles, story, enemies, items, equipment, achievements, and rule descriptions.
- `simulaid-pixel-art-assets`: Simulaid still-image asset pipeline and quality rules.
- `simulaid-animation-assets`: sprite sheets, loops, VFX, dog/creature/UI animation assets.
- `doubao-seedance-animation`: external Seedance/Volcengine keyframe animation workflow; keep secrets out of skills and repo.
- Audio is currently module-led rather than skill-led: use `/Users/yutu/.codex/modules/yudi-simulaid-audio-tools` when the user says 玉笛 or asks for Simulaid SFX/music tooling.

### Starlaid layer

- `starlaid-unity-maintenance`: Starlaid project anchor and GitHub/repo/build entry.
- `starlaid-game-development`: main Starlaid design/implementation/QA operating skill.
- `starlaid-test-maintenance`: Starlaid automated test ownership and validation.
- `starlaid-image-generation`: Starlaid art generation/integration gate.

### Other project/workflow layer

- `嫦娥改装计划`: YuanXiao/Huawei-installable Android control plane and ChangE self-update/GitHub delivery workflow, with Quark as fallback/manual backup only.
- `yuanxiao-command-expander`: preflight instruction expansion for YuanXiao/元宵/汤圆, ChangE/嫦娥, Yutu/玉兔, Hermes, Legend/传奇, Android APK, self-update, agent/session queues, files, notifications, control-room work, and the related `.codex` skills/modules/helper scripts/workflow memory that govern those flows. Use it before implementation so terse requests become complete executable commands with inferred intent, module/memory lookup, validation, release, and handoff requirements.
- `zongzi-command-expander`: preflight instruction expansion for 粽子助手 / 粽子 Codex / 粽子管理控制台 work. Use it before editing, fixing, optimizing, reviewing, deploying, or planning Zongzi so terse user requests become complete executable commands with inferred intent, stability checks, tests, deployment, and handoff requirements.
- `yuanxiao-mobile-file-inbox`: focused YuanXiao mobile-file inbox skill for files sent from the APK to 玉兔/传奇, findable Mac mini storage, and mobile upload smoke validation.
- `玉华`: business/technical material formatting guard for PPTX, poster/table images, and OpenClaw/Hermes solution decks. It locks the user's red `#C00000` palette, all-`微软雅黑` typography, editable PPTX requirement, table sizing, no-overflow visual QA, and lower-AI-flavor writing rules. It is not a project route and does not edit game/runtime files by itself.
- Plugin/system skills live outside this custom architecture map unless a user task explicitly invokes them.

## 3. Canonical Simulaid Docs To Prefer Over Chat Memory

Read these before changing the corresponding area:

- `/Users/yutu/Simulaid/CODE_INDEX.md`: code navigation and current mechanics.
- `/Users/yutu/Simulaid/SIMULAID_OPTIMIZATION_NOTES.md`: optimization/refactor ledger; do not repeat verified/rejected/forbidden attempts without new evidence.
- `/Users/yutu/Simulaid/SIMULAID_TESTING_STRATEGY.md`: automated test strategy and 玉玲珑 test gate.
- `/Users/yutu/Simulaid/GameAgentBenchmark.md`: lightweight gameplay/UI/battle/save/performance benchmark contract; use it for repeated player reports, mobile-only validation, Unity semantic-tool experiments, screenshot/recording evidence, manual review, and rollback planning.
- `/Users/yutu/Simulaid/SIMULAID_STORY_BIBLE.md`: story/lore/玉凤 canon.
- `/Users/yutu/Simulaid/SIMULAID_IMAGE_GENERATION_REQUIREMENTS.md`: asset-family and prompt gate.
- `/Users/yutu/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md`: repeated bug ledger.
- `/Users/yutu/Simulaid/SIMULAID_UI_LAYOUT_REVIEW.md`: UI regression checklist.
- `/Users/yutu/.codex/modules/simulaid-opening-comic-style/INDEX.md`: Tail/opening/completion comic style lock.

## 4. Routing Rules

1. If the user names a skill, load that skill.
2. For non-trivial terse, spoken, screenshot-backed, ambiguous, project, coding, debugging, deployment, release, game-development, or agent-control-plane requests, load `instruction-expansion-router` first. It must produce at most one visible expansion block by routing to the correct project-specific expander or using the generic template. Priority is: explicitly named skill/agent, project-specific command expander, cross-project route, then global fallback.
3. If the named skill is one of `玉猿`, `玉豚`, `玉凤`, `玉鼠`, `玉衡`, `玉虎`, `玉鸡`, `金鸡`, `玉龙`, `玉灵`, `玉玲珑`, `玉凰`, or `黄龙`, read `project-routes/INDEX.md` and then the matching project route before applying project-specific rules.
4. If the request is about persistent local setup, Hermes/Yutu, Feishu, or prior module memory, load `module-registry` before broad searches.
5. If the request changes or reviews a skill, load `skill-standard-reviewer` and this file.
6. If the request modifies, plans, deploys, releases, debugs, or asks to `煮` YuanXiao/ChangE, or changes supporting Yutu/Hermes/Legend bridge behavior, reminders, queues, sessions, files, notifications, `.codex` skills/modules, helper scripts, or workflow memory for that control plane, load `yuanxiao-command-expander` first, produce `元宵指令补齐稿`, then continue with `嫦娥改装计划`, `hermes-yutu-voice-bridge`, or a more focused YuanXiao skill.
7. If the request changes, plans, debugs, reviews, builds, releases, or otherwise operates on Simulaid runtime/code/assets/docs, load `simulaid-command-expander` first, produce `Simulaid 指令补齐稿`, then continue with `simulaid-unity-maintenance` plus the most specific Simulaid skill.
8. If the request is broad Simulaid planning or recurring quality improvement, add `simulaid-studio-operating-model`.
9. If the request is story/image/content, route through the project route; use `玉凤` before `玉豚`/asset generation when story consistency matters.
10. If the request is delivery, use the user-facing wrappers only when the project route explicitly supports them: `玉龙` for Android/package delivery, `玉灵` for iOS delivery, `玉玲珑` for combined supported lanes.
11. Do not spawn subagents unless the user explicitly asks for subagents/delegation/parallel agents.

## 5. Duplication Rules

- Put long file maps, changelogs, and contracts in modules or project docs, not every skill.
- `instruction-expansion-router` is the only global command-expansion router; project expanders own their own details. Avoid creating another global expander unless this router is being intentionally replaced.
- If a project/agent already has its own command expander and visible `指令补齐稿` contract, the global router must suppress its generic block and let that expander own the output.
- Keep user-facing wrapper skills short; they should route to engine skills and name boundaries.
- Keep engine skills focused on their lane; do not let one skill become the entire studio.
- When two skills duplicate a rule, choose one canonical home and make the other point to it.
- Developer-only skill/doc/module edits do not require Simulaid game version bumps. Runtime/game/assets/build metadata changes still follow `simulaid-unity-maintenance`.


## 6. Cross-Project / Concurrent-Agent Rules

- Skills are read-only manuals; two agents reading the same `SKILL.md` should not deadlock by itself.
- Deadlocks and corruption happen around shared mutable resources: project files, generated assets, Unity/Tuanjie, Xcode/App Store Connect, Quark Browser, Git, final Feishu/voice ownership, or agents waiting for each other's progress reports.
- Cross-project wrappers must use `project-routes/INDEX.md` for route selection and lightweight file locks before exclusive operations.
- Prefer one-way pipelines: agent A writes artifacts/manifests, agent B consumes them; both report blockers/results to the user-facing channel. Do not build circular report requests.
- Orchestrators such as `玉玲珑` own the final report/voice; child phases must not speak or send competing final reports.
- If an exclusive lock is present, wait briefly only when safe and bounded; otherwise send a concise blocker instead of spinning.

## 7. Known Cross-Skill Traps

- Cross-project wrapper skills (`玉猿`, `玉豚`, `玉凤`, `玉鼠`, `玉衡`, `玉虎`, `玉鸡`/`金鸡`, `玉龙`, `玉灵`, `玉玲珑`, `玉凰`, `黄龙`) must not infer commands for an unsupported project; missing route support is a blocker, not an invitation to reuse Simulaid mechanics.
- Multiple agents may read the same skill safely, but only one owner may hold each route lock for Unity/Tuanjie, Xcode/App Store upload, Quark upload, image asset writes, Git writes, or skill architecture edits.
- `simulaid-build-qq-delivery` has a legacy name; normal delivery must not use QQ.
- Android and iOS delivery must stay separated unless `玉玲珑` is orchestrating both.
- `玉玲珑` has exactly one combined report/voice owner; child phases must not speak independently.
- Quark uploads go to `Simulaid / Simulaid-apk` for Android and should reuse existing Quark Netdisk tabs before opening new pages.
- TapTap requires ARM64-only APKs, matching display name/package metadata, CVE patching while relevant, and install/startup compatibility checks.
- Image-generation skills must verify a real callable generation backend; a local instruction skill named like a backend is not enough.
- Simulaid image work should not use subagents by default; the main Codex session owns prompt, generation, post-processing, Unity placement, docs, and validation.
- Story-sensitive art must pass 玉凤/`SIMULAID_STORY_BIBLE.md` before prompt writing.
- This chat has a history of context bloat; do not emit base64, huge logs, full JSON dumps, or inline image data.

## 8. Improvement Pattern For Future Skill Refactors

When optimizing the skill architecture again:

1. Inventory `SKILL.md` frontmatter, line counts, required reads, and cross references with a script instead of manually reading every file in full.
2. Classify skills by layer and project.
3. Identify duplicate commands/rules and stale trigger language.
4. Move durable long-form knowledge to module/project docs.
5. Patch only the smallest set of skills needed to improve routing.
6. Re-run a whitespace/frontmatter check and report changed files.
