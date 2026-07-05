---
name: 玉玲珑
description: "Use when the user says 玉玲珑, 玉玲珑上, 玉玲珑 上, or asks for a combined multi-platform delivery orchestrator. Treat 玉玲珑 as a cross-project wrapper: first route through /Users/yutu/.codex/skills/project-routes/INDEX.md and the matching project route. The Simulaid route currently merges 玉龙 and 玉灵 with one shared quality phase, one Feishu report, and one voice announcement; unsupported project routes must stop."
---

# 玉玲珑

玉玲珑 is the user's unified short-name entry point for running both Simulaid delivery siblings together:

- **玉龙**: Android APK build, Quark Browser upload, and Android delivery status. When orchestrated by 玉玲珑, suppress 玉龙's standalone local voice announcement.
- **玉灵**: iOS Xcode project export, Xcode Archive, App Store Connect/TestFlight upload when signing/account state allows, and iOS delivery status. When orchestrated by 玉玲珑, suppress any standalone local voice announcement.

Current workflow generation: `玉玲珑 12 号（交付前风险审视 + Studio 优化台账 + 存档兼容审计 + 玉衡测试刷新 + SimulaidTestRunner 测试门禁；安卓上传固定 Simulaid/Simulaid-apk；PC 上传 Simulaid/Simulaid-PC；单一语音出口；交付后自动 Git 上传）`.

Creating or updating this skill is developer-side workflow memory and does not bump the Simulaid game version by itself.

## Cross-Project Route Guard

This is a global wrapper name, not a Simulaid-only concept. Before applying the route below, read:

1. `/Users/yutu/.codex/skills/SKILL_ARCHITECTURE.md`
2. `/Users/yutu/.codex/skills/project-routes/INDEX.md`
3. The matching project route, for example `project-routes/Simulaid.md` or `project-routes/Starlaid.md`.

If the selected project route does not explicitly support this wrapper, stop and report that the delivery route is not configured. Do not reuse Simulaid build, Quark, Xcode, signing, App Store Connect, or versioning rules for another game by analogy.

Concurrent-agent safety: reading this skill is safe; delivery/build/upload steps require the project route locks for Unity/Tuanjie, Android build, iOS archive, Quark upload, App Store upload, Git writes, and final Feishu/voice ownership. Child phases return status only; the orchestrator sends final user-facing reports.

The remaining instructions are the current Simulaid route implementation unless the project route says otherwise.

## Trigger Meaning

When the user says `玉玲珑` or `玉玲珑 上`, treat it as:

1. Run one shared Simulaid quality phase before delivery:
   - pre-optimization UI regression review,
   - Unity/Tuanjie local resource size/performance acceptance,
   - three performance optimization attempts with two self-reviews,
   - three future-agent-oriented refactor attempts with two self-reviews,
   - version/docs sync only if game/runtime files changed,
   - compile verification.
2. Then run the Android delivery phase using the current `/Users/yutu/.codex/skills/yulong/SKILL.md` **delivery mechanics only**: build location, backup retention, Quark Browser upload, and Android-specific blockers. Do not repeat 玉龙's optimization/refactor/UI review phase, Feishu report, or standalone voice announcement because 玉玲珑 owns the shared quality phase and final reporting.
3. Then run the iOS delivery phase using the current `/Users/yutu/.codex/skills/yuling/SKILL.md` **delivery mechanics only**: iOS export, Xcode signing, Archive, Organizer/TestFlight upload, and Apple-specific blockers. Do not repeat 玉灵's optimization/refactor/UI review phase or send a separate iOS report because 玉玲珑 owns the final report.
4. Report Android and iOS outcomes separately in one concise Feishu/Yutu message, then send at most one local voice announcement for the combined outcome.

If the user explicitly says only Android, only iOS, skip the other delivery phase and invoke `玉龙` or `玉灵` directly instead of the full combined workflow.

## Required First Reads

Before broad searches or edits:

1. `/Users/yutu/.codex/skills/simulaid-unity-maintenance/SKILL.md`
2. `/Users/yutu/.codex/skills/simulaid-ui-regression-review/SKILL.md`
3. `/Users/yutu/.codex/skills/simulaid-optimize-build-deliver/SKILL.md`
4. `/Users/yutu/.codex/skills/yuheng/SKILL.md`
5. `/Users/yutu/.codex/skills/yulong/SKILL.md`
6. `/Users/yutu/.codex/skills/yuling/SKILL.md`
7. `/Users/yutu/Simulaid/CODE_INDEX.md`
8. `/Users/yutu/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md`
9. `/Users/yutu/Simulaid/SIMULAID_UI_LAYOUT_REVIEW.md`
10. `/Users/yutu/Simulaid/SIMULAID_OPTIMIZATION_NOTES.md`
11. `/Users/yutu/Simulaid/SIMULAID_TESTING_STRATEGY.md`
12. `/Users/yutu/Simulaid/SIMULAID_DELIVERY_RISK_REVIEW.md`

## Shared Quality Phase

Do this once for the combined workflow; do not duplicate the same optimization/refactor pass once for Android and again for iOS.

0. Run the Studio optimization-ledger preflight:
   - Read `/Users/yutu/Simulaid/SIMULAID_OPTIMIZATION_NOTES.md` and search it for the changed/risky areas or performance symptoms named by the user.
   - Treat that file as the single source of truth for optimization history. Do not repeat entries marked `已验证`, `已拒绝`, `禁止重复`, or equivalent unless there is new player feedback, profiler evidence, Unity/Tuanjie version change, or an explicit user request.
   - Pick optimization/refactor pass targets from ledger entries that are `候选`, `观察中`, `延期` with a new safe window, or genuinely new findings. If there is no high-confidence target, record a deliberate `有意空操作` instead of touching stable code to satisfy the pass count.
   - Each optimization/refactor pass, including no-op passes, must update the same file with a compact record: ledger id/status, touched files, benefit basis, risk, verification result, and next step.
1. Review changed or risky UI areas against the bug ledger and common UI checklist. Fix feasible changed-area regressions before optimization; record deferred risks in `/Users/yutu/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md`.
2. Run the Unity/Tuanjie local resource acceptance pass for newly added or changed images, animations, audio, AssetBundles, and `Resources` assets.
   - Check compression/format, Max Size, MipMap, Read/Write, Sprite Atlas participation or exclusion reason, animation sample rate, redundant keyframes, first-package size impact, and runtime loading stability.
   - If no runtime resources changed, record: `资源验收：本轮无新增/变更运行时资源。`
3. Optimization pass 1, then self-review.
4. Optimization pass 2, then self-review.
5. Optimization pass 3, or record a deliberate no-op if more churn would be unsafe.
6. Refactor pass 1, then self-review.
7. Refactor pass 2, then self-review.
8. Refactor pass 3, or record a deliberate no-op if more churn would be unsafe.
   - These six passes are ledger-driven. Before implementing, cite the relevant ledger id or create a new id in `/Users/yutu/Simulaid/SIMULAID_OPTIMIZATION_NOTES.md`; after implementing or deciding no-op, update that id's status.
9. If game/runtime files changed, follow `simulaid-unity-maintenance` version discipline:
   - `SimulaidVersionInfo.cs`,
   - `README.md`,
   - `VersionHistoryEntries`,
   - `ProjectSettings.asset`,
   - update `CODE_INDEX.md` / bug/UI docs when relevant.
10. Run a save-compatibility audit before compile/delivery:
   - Inspect the current diff and explicitly classify whether this run changed persisted PlayerPrefs keys, save codecs, archive slot layout, card/item/crop/reward-card IDs, difficulty/profession IDs, enum/string constants stored in saves, market price keys, or default deck/loadout/farm initialization.
   - If persisted IDs or keys were removed, renamed, reinterpreted, or changed from stackable to unique/non-stackable, add a migration/backfill/alias in the relevant save/load path before delivery. Do not rely on “new saves only” unless the user explicitly agrees.
   - If a new persisted effect type or data channel is introduced, make old saves default safely and make unknown/legacy values harmless. Existing player inventories, decks, reward-card counts, farm cells, market data, gift-code markers, achievements, dog state, and version metadata must still load.
   - When source behavior changes save semantics, update or add a regression test in `/Users/yutu/Simulaid/Packages/com.joesong.simulaid.tests` or document a manual save-load regression point if automation is genuinely too brittle.
   - If the audit finds any risk to existing player saves, fix it immediately and mention the migration/backfill in the final report. If no risk is found, report `存档兼容审计：未发现旧档破坏点。`
11. Run the delivery risk review before compile/delivery:
   - Update `/Users/yutu/Simulaid/SIMULAID_DELIVERY_RISK_REVIEW.md` for changes since the last relevant delivery baseline.
   - Classify high-risk save/runtime/UI/resource/platform-delivery changes, especially areas touched after the previous 黄龙/玉龙 run.
   - Do not continue to Android/iOS delivery if a major risk lacks a test, save fallback, manual guard, or explicit user acceptance.
   - Include `交付风险审视` result and remaining watch items in the final single Feishu/local report.
12. Run the 玉衡 test-refresh gate before compile/delivery:
   - Read `/Users/yutu/.codex/skills/yuheng/SKILL.md` and `/Users/yutu/Simulaid/SIMULAID_TESTING_STRATEGY.md`.
   - Inspect the current user request, `git diff --name-only`, and the current version/change themes. For each gameplay/UI/save/economy/data/combat/gift-code/progression behavior changed in this batch, explicitly decide whether an automated regression test should be added/updated or whether a manual regression point is more honest.
   - Add or update focused tests in `/Users/yutu/Simulaid/Packages/com.joesong.simulaid.tests/Editor/SimulaidTestRunner.cs` and update the testing strategy/bug ledger when the invariant is durable. Do not continue to delivery with an unhandled test obligation.
   - Execute `/Applications/Tuanjie/Hub/Editor/2022.3.62t7/Tuanjie.app/Contents/MacOS/Tuanjie -batchmode -quit -projectPath /Users/yutu/Simulaid -executeMethod SimulaidTestRunner.RunAll -logFile /tmp/simulaid-tests.log`.
   - If it fails, read `/Users/yutu/Simulaid/Logs/simulaid-test-results.txt` and the concise failed log lines, then fix either the source code or the relevant test/update matrix. Do not continue to Android/iOS delivery with failing tests unless the user explicitly overrides after seeing the blocker.
   - When original gameplay/data/save/economy/combat/gift-code/progression code changed, confirm that the corresponding test group was updated or that the manual regression point was recorded.
13. Compile/validate before delivery. Old SourceGenerator/toolset warnings are acceptable only when exit code is 0 and there are no real C# errors.

## Android Delivery Phase

Follow `玉龙` for Android delivery mechanics after the shared quality phase, including:

- Android APK build only;
- latest versioned APK under `/Users/yutu/Documents/codexProjects/Simulaid/Builds` with backup retention handled by the underlying build skill;
- Quark upload through **Quark Browser / 夸克浏览器** to the exact cloud folder `首页 > 文件 / Simulaid / Simulaid-apk/`.
  - Before opening a new Quark Netdisk page/tab, inspect current Quark Browser windows/tabs. If a usable Quark Netdisk page is already open (`pan.quark.cn`, `夸克网盘`, or a Quark file-list view), reuse it and navigate from there to the target folder. If no usable Netdisk page exists, prefer the Quark Browser top-right Netdisk entry button beside the user avatar to open 夸克网盘; manual URL/path entry is only a fallback when that button is unavailable or blocked. Open a new page only when reuse and the avatar-side Netdisk entry are both blocked.
  - Before selecting the local APK, verify the visible Quark breadcrumb/current directory is exactly `/ Simulaid / Simulaid-apk` or an equivalent folder view. The sibling child folder `Simulaid-PC` is reserved for Windows PC packages and must not receive Android APKs.
  - Do **not** upload Android APKs from a search-results page, `全部文件`, the cloud `Simulaid` parent folder, `Simulaid / Simulaid-PC`, a cloud `Builds`/`builds` subfolder, or any upper directory. Search may be used only to locate/open the real target folder. Upload each new versioned APK directly into `Simulaid / Simulaid-apk`.
- no QQ sending unless the user explicitly asks in the same turn and confirms after account-risk warning;
- Feishu/Yutu reminder without local APK path.

Do not let the Android phase modify iOS signing, Bundle ID, Apple Team, provisioning profiles, or Xcode settings.

## iOS Delivery Phase

Follow `玉灵` for iOS delivery mechanics after the shared quality phase, including:

- iOS Xcode export root: `/Users/yutu/SimulaidBuilds/iOS/Simulaid-{version}`;
- archive root: `/Users/yutu/SimulaidBuilds/iOSArchives`;
- Bundle Identifier must remain `com.yutu.simulaid`;
- Team remains Chengzuo Song / `HA6WZWUG6Q` when signing is configured;
- use the known `Simulaid App Store` profile and Apple Distribution identity only when available;
- Archive with Release / generic iOS destination;
- upload to App Store Connect/TestFlight only when signing/account prompts allow.

Stop and report if Apple ID login, verification code, keychain access, agreements, account-security prompts, certificate/profile errors, privacy prompts, Bundle ID conflicts, or upload validation errors appear. Do not create Apple accounts, change Bundle ID, delete certificates, or invent new signing identities.

Do not let the iOS phase build Android, upload Quark, use QQ, or speak the old Android-only 玉龙 success phrase by itself.

## Git Auto Upload Phase

玉玲珑 owns exactly one Git upload for the combined delivery. Child 玉龙/玉灵 phases must not make their own commits or pushes during a 玉玲珑 run.

After the shared quality phase and the Android/iOS delivery phases have reached their final status, automatically upload the Simulaid repo changes to Git before the combined Feishu report and final local voice:

1. Acquire the `simulaid.git-write` lock from `/Users/yutu/.codex/skills/project-routes/Simulaid.md`; release it at the end even if Git fails.
2. Work only in `/Users/yutu/Simulaid`. Run `git status --short` first. Preserve all existing user/agent changes; do not revert, reset, delete, rebase, force-push, or silently discard untracked files.
3. If source validation, compile, or a code-caused build gate failed, do **not** push the failing game state unless the user explicitly overrides after seeing the blocker. If Android/iOS is blocked only by platform/account/signing/upload prompts while source validation is clean and at least one delivery artifact was produced, Git upload may still proceed and the blocker must be reported separately.
4. Stage intended Simulaid repo changes with `git add -A` after checking that ignored build artifacts, local logs, credentials, caches, archives, and generated package files are not being staged. Run `git diff --cached --check` before committing.
5. If there are no staged changes, record `Git: no-op`. Otherwise commit with a concise combined-delivery message such as `chore(simulaid): deliver v1.8.8 via yulinglong`, then push the current branch to `origin` without force. If push is rejected or authentication/network fails, report `Git blocker` with the short reason and leave the local commit intact.
6. Include the commit short hash and push result in the single combined Feishu/final report. Do not include large diffs, secrets, local cookies, or long Git logs.

## Reporting

The Feishu/Yutu report should be sent through `/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/scripts/send_yutu_reminder.py`, which applies the `主人，前情提要：...` prefix; keep the report concise.

Include:

- version/build number,
- **本次改动清单 / player-impact changelog** before platform delivery statuses:
  - Summarize the current delivery's verified changes in 3-8 concise bullets so the user can check whether anything is missing now that real players are active.
  - Split bullets when useful into `玩家可见改动`, `稳定性/兼容性`, `资源/美术/音频`, `测试与存档风险`, and `交付流程改动`; omit empty categories.
  - Build the list from the current turn's implemented fixes, top `README.md` changelog entry, `VersionHistoryEntries`, changed-file themes from `git diff --name-only`, and any test/save-audit findings. Do not rely only on “build succeeded”.
  - If the workflow only changed delivery/skill/process docs, explicitly say `本次为交付流程改动，无游戏内玩法改动。`
  - If a changed area cannot be confidently classified, include it as `待人工确认` rather than silently omitting it.
  - Keep the change list player-safe: do not reveal exact gift-code strings, hidden achievement names, hidden unlock conditions, hidden rewards, unrevealed story twists, local file paths, internal skill names, or test implementation details unless the user explicitly asks for them publicly.
- UI review/fix summary,
- resource acceptance result,
- optimization-ledger ids/statuses touched or intentionally skipped,
- automated test gate result, for example `SimulaidTestRunner N/N 通过` or the failed test group names,
- save-compatibility audit result, including any migration/backfill performed or `未发现旧档破坏点`,
- delivery risk review result and remaining watch items,
- optimization pass 1-3 summaries and estimated benefits,
- refactor pass 1-3 summaries and estimated future-agent/debug benefits,
- compile result,
- Android build and Quark upload result,
- **TapTap version log** immediately after the Android delivery result whenever the Android APK is built/uploaded successfully. This is a concise player-facing changelog the user can paste into TapTap's update notes. Build it from `README.md` current version history, `VersionHistoryEntries`, the current turn's verified fixes, and `/Users/yutu/.codex/modules/simulaid-marketing-planning-bridge/release-version-ledger.md`. Prefer the same range discipline as `玉凰`: summarize the gap since the last generated/published player-facing changelog or previous recorded Android delivery, not just the newest tiny patch. Keep it 5-8 bullets when multiple versions are included, avoid internal file paths/tests/log jargon, and mention Android-relevant stability or compatibility fixes when applicable. If Android delivery fails, omit the TapTap-ready log and instead report the Android blocker.
- iOS export path, archive result, and TestFlight/App Store Connect upload result or blocker,
- 3-5 next-improvement suggestions.

Do not include local APK paths in Feishu unless the user explicitly asks for paths. The TapTap version log should also avoid local paths, internal skill names, and implementation-only details.

## Single Voice Announcement Rule

玉玲珑 must have exactly one local voice owner: the 玉玲珑 orchestrator. Do not allow child 玉龙/玉灵 phases, Android-only helpers, iOS-only helpers, or Feishu-send notice hooks to speak independently during a 玉玲珑 run.

The final local voice announcement must always mention **both** delivery phases in one sentence: Android/安卓 and iOS. This applies whether both phases succeed, one phase succeeds and the other is blocked, or both phases fail. Do not use a shortened iOS-only or Android-only voice line when the trigger was `玉玲珑`; otherwise the user may miss that the combined workflow covered both sides.

Important implementation detail: Feishu sends can trigger Hermes' `play_feishu_send_notice_background(...)`, which may speak a short "主人，飞书来消息了" style notice while the final 玉玲珑 voice is also speaking. When a 玉玲珑 workflow sends Feishu and then speaks locally in the same turn, suppress that Feishu send-notice voice for the Feishu call by using a copy of the config and the fixed Codex/Yutu reminder helper:

```python
cfg = mod.load_voice_config()
feishu_cfg = dict(cfg)
feishu_cfg["feishu_send_voice_notice_enabled"] = False
ok = mod.send_codex_yutu_reminder(message, feishu_cfg, context="Simulaid 玉玲珑已处理安卓和 iOS")
mod.speak(voice, cfg)
```

Do not globally disable Feishu send notices in Hermes config unless the user explicitly asks. The suppression above is per 玉玲珑 delivery report only.

If both Android and iOS delivery succeed, the single local Yutu voice announcement should use:

`主人，前情提要：Simulaid 安卓和 iOS 交付已经处理完成。玉玲珑 {displayVersion}：模拟纪元已发送。`

If one delivery phase fails or is blocked, do not speak an unconditional success phrase, but the voice must still mention both phases, for example:

`主人，前情提要：Simulaid 玉玲珑已处理安卓和 iOS。安卓{androidStatus}；iOS{iosStatus}。玉玲珑 {displayVersion}：请查看飞书详情。`

Keep `{androidStatus}` and `{iosStatus}` short, such as `构建完成但夸克上传受阻` / `已上传 TestFlight` / `Archive 被签名阻塞` / `构建失败`. The Feishu report carries the full details.

## Boundaries

- 玉玲珑 is an orchestrator skill. Keep detailed Android mechanics in `玉龙` and detailed iOS mechanics in `玉灵`; do not duplicate long signing/build instructions here.
- The shared quality phase must run once per 玉玲珑 invocation. Do not recursively invoke full 玉龙 or full 玉灵 in a way that repeats the same UI review, resource acceptance, optimization, or refactor passes.
- The final Feishu report and local voice announcement must be emitted once by 玉玲珑. Child phases may return status text, logs, and blockers, but must not trigger their own local voice announcements inside a 玉玲珑 run.
- Developer workflow changes to this skill do not belong in player-facing Simulaid version history.
- If the workflow changes game files, all Simulaid version surfaces must still be synchronized by `simulaid-unity-maintenance`.
