# Simulaid Route

Project root: `/Users/yutu/Simulaid`

Identifiers: Simulaid, 模拟纪元, 模拟纪元Simulaid, Tail/泰尔, 黑莲, 奖励卡, 狗狗, 主世界, 模拟世界.

## Canonical First Reads

- `/Users/yutu/Simulaid/CODE_INDEX.md`
- `/Users/yutu/.codex/skills/simulaid-unity-maintenance/SKILL.md`
- `/Users/yutu/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md`
- `/Users/yutu/Simulaid/SIMULAID_UI_LAYOUT_REVIEW.md`
- `/Users/yutu/Simulaid/SIMULAID_OPTIMIZATION_NOTES.md`
- `/Users/yutu/Simulaid/SIMULAID_TESTING_STRATEGY.md`
- `/Users/yutu/Simulaid/SIMULAID_SAVE_COMPATIBILITY_INDEX.md`
- `/Users/yutu/Simulaid/SIMULAID_DELIVERY_RISK_REVIEW.md`
- `/Users/yutu/Simulaid/GameAgentBenchmark.md`
- Story/art work additionally reads:
  - `/Users/yutu/Simulaid/SIMULAID_STORY_BIBLE.md`
  - `/Users/yutu/Simulaid/SIMULAID_IMAGE_GENERATION_REQUIREMENTS.md`
  - `/Users/yutu/.codex/modules/simulaid-opening-comic-style/INDEX.md`

## Wrapper Support

- `玉猿`: supported. Use `simulaid-command-expander` as the first step for Simulaid development, bug, balance, UI, story/content, asset, test, build, release, architecture, regression, or delivery requests. It produces `Simulaid 指令补齐稿` and then routes to the relevant specialist skills instead of replacing them.
- `玉豚`: supported. Use `yutun`, `yufeng`, `simulaid-pixel-art-assets`, `simulaid-animation-assets`, and `imagegen` as relevant. Main Codex session owns Simulaid image generation by default unless the user explicitly requests a separate worker.
- `玉凤`: supported. Use `yufeng` and the Simulaid story bible/image requirements.
- `玉鼠`: supported. Use `yushu` for content-definition design/standardization before adding or changing cards, roles, story events, enemies, items, equipment, achievements, or player-facing rules copy. It coordinates `玉凤` for story/canon, `玉豚` for required final art/no-placeholder gates, and `玉衡` for matching tests.
- `玉衡`: supported. Use `yuheng`, `simulaid-unity-maintenance`, `SIMULAID_TESTING_STRATEGY.md`, and `Packages/com.joesong.simulaid.tests/Editor/SimulaidTestRunner.cs` to refresh tests before delivery gates.
- `玉虎`: supported. Use `yuhu` before any Simulaid bug/regression fix; require a one-sentence root cause, owning code path, matching test or manual UI guard, updates to `SIMULAID_BUG_REGRESSION_LOG.md` and related ledgers, and a rollback point before reporting the bug as fixed. Pair with `simulaid-architecture-guardian` for repeated/old bugs and `玉衡` for test refresh.
- `玉鸡` / `金鸡`: supported. Use `yuji` for Simulaid gift-code lookup/publication, `GIFT_CODE_REGISTRY.md` hygiene, `SimulaidGameUI.GiftCodes.cs` consistency, TapTap/platform Excel exports, and reward-code image deliverables in `/Users/yutu/Downloads`.
- `玉龙`: supported for Android optimize/build/Quark delivery. Use `yulong` and `simulaid-optimize-build-deliver` mechanics.
- `玉灵`: supported for iOS export/Archive/App Store Connect upload. Use `yuling` mechanics.
- `玉玲珑`: supported as the combined Android+iOS orchestrator. It owns the shared quality phase, final Feishu report, and exactly one local voice announcement.
- `玉凰`: supported for TapTap/community/store copywriting. Use `yuhuang`, `simulaid-marketing-planning-bridge`, and Simulaid project docs; keep the tone sincere, human, and discovery-friendly rather than over-marketed.
  - For player-facing update logs, also read `/Users/yutu/.codex/modules/simulaid-marketing-planning-bridge/release-version-ledger.md` and summarize the full range since the last generated/published version note or previous recorded Android delivery.
- `黄龙`: supported as the combined `玉龙` + `玉凰` lane. Run Android delivery first, append/read the release-version ledger, then generate the player-facing update log for the delivered target version.

## Exclusive Resources / Locks

Use lock names from `INDEX.md` with project key `simulaid`. `玉猿` normally does not need a lock by itself; the downstream specialist phase must acquire locks before exclusive resources are used:

- `simulaid.unity-editor`: Tuanjie/Unity editor, batchmode tests/builds, project settings writes.
- `simulaid.android-build`: APK build and build backup mutation.
- `simulaid.quark-upload`: Quark Browser upload to cloud folders.
- `simulaid.ios-archive`: Xcode project export/archive.
- `simulaid.appstore-upload`: App Store Connect/TestFlight upload.
- `simulaid.image-assets`: writes under `/Users/yutu/Simulaid/Assets/Resources/GeneratedPixel` and related generated art/audio folders.
- `simulaid.story-docs`: story bible, image requirements, route/story documents.
- `simulaid.git-write`: commits, tags, pushes, branch mutation.

When `玉玲珑` runs, it owns `simulaid.unity-editor`, `simulaid.android-build`, `simulaid.quark-upload`, `simulaid.ios-archive`, and `simulaid.appstore-upload` for the duration of delivery. Child Android/iOS phases must not send separate Feishu/voice reports.

## Delivery Destinations

Android:

- Local APKs: `/Users/yutu/Documents/codexProjects/Simulaid/Builds`
- Quark cloud target: `Simulaid / Simulaid-apk`
- Upload versioned APK directly; do not use cloud `Builds` subfolder and do not rename to `Simulaid.apk`.

## Git Delivery Policy

For Simulaid delivery wrappers `玉龙`, `玉玲珑`, and `黄龙`, successful validated deliveries should automatically upload the current `/Users/yutu/Simulaid` repo state to Git:

- Use the `simulaid.git-write` lock before `git add`, `git commit`, `git push`, tags, or branch mutation.
- Preserve existing user/agent work. Do not revert, reset, rebase, force-push, delete untracked files, or silently skip changed files.
- Do not push a code-caused failing source/build state unless the user explicitly overrides after seeing the blocker. Platform/account/upload blockers may be reported separately when source validation is clean.
- Keep Git output concise: final reports need only no-op/commit short hash/push result or a short Git blocker.

PC:

- Quark cloud target: `Simulaid / Simulaid-PC` when a PC delivery route explicitly asks for it.

 iOS:

- Export root: `/Users/yutu/SimulaidBuilds/iOS/Simulaid-{version}`
- Archive root: `/Users/yutu/SimulaidBuilds/iOSArchives`
- Bundle ID: `com.yutu.simulaid`
- Team: `HA6WZWUG6Q`
- App Store profile: `Simulaid App Store`

## Validation

Before delivery, invoke `玉衡` when source/runtime/UI/save/economy/data behavior changed, then run the Simulaid test gate:

```sh
/Applications/Tuanjie/Hub/Editor/2022.3.62t7/Tuanjie.app/Contents/MacOS/Tuanjie -batchmode -quit -projectPath /Users/yutu/Simulaid -executeMethod SimulaidTestRunner.RunAll -logFile /tmp/simulaid-tests.log
```

Use concise log tails only. Do not paste huge logs, image data, or full JSON into chat.

When source/runtime changes touch save/load, PlayerPrefs, version-gated behavior, migrations, economy state, or any existing-save semantics, the `玉猿` expanded command and delivery wrappers must also consult `/Users/yutu/Simulaid/SIMULAID_SAVE_COMPATIBILITY_INDEX.md`. The current highest version line must have indexed entries through `SimulaidVersionInfo.Version`, and unresolved old-save compatibility risks block 玉龙 / 黄龙 / 玉玲珑 unless the user explicitly accepts the risk.

Before 玉龙 / 黄龙 / 玉灵 / 玉玲珑 platform delivery, the `玉猿` expanded command should mention and the delivery phase must update `/Users/yutu/Simulaid/SIMULAID_DELIVERY_RISK_REVIEW.md` for changes since the last relevant delivery baseline. Any major save/runtime/UI/resource/platform risk without a test, manual guard, rollback note, or explicit user acceptance blocks delivery.

## Combined Delivery Reporting

When `玉玲珑` is used for Simulaid, its single final Feishu/Yutu report must include an explicit `本次改动清单` before Android/iOS delivery statuses. The list should be derived from the current version entry, README changelog, current turn's verified fixes, changed-file themes, test results, and save-compatibility audit. It exists so the user can catch omissions while real players are active. Keep it player-safe: avoid exact gift-code strings, hidden achievement names, hidden unlock conditions, hidden rewards, unrevealed story twists, local file paths, and internal skill/test jargon unless the user explicitly asks for public disclosure.
