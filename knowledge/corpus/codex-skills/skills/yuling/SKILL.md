---
name: 玉灵
description: "Use when the user says 玉灵, 玉灵上, iOS打包上传, iOS构建上传, TestFlight上传, or asks for an iOS/App Store Connect delivery lane. Treat 玉灵 as a cross-project wrapper: first route through /Users/yutu/.codex/skills/project-routes/INDEX.md and the matching project route. The Simulaid route is currently fully implemented; unsupported project routes must stop instead of borrowing Simulaid signing/upload commands."
---

# 玉灵

玉灵 is the iOS-only sibling of 玉龙.

Current workflow generation: `玉灵 2 号（交付前风险审视 + iOS 构建、Archive、TestFlight/App Store Connect 上传 + 玉龙同款三轮优化/重构）`.

Creating or updating this skill is developer-side workflow memory and does not bump the Simulaid game version by itself.

## Cross-Project Route Guard

This is a global wrapper name, not a Simulaid-only concept. Before applying the route below, read:

1. `/Users/yutu/.codex/skills/SKILL_ARCHITECTURE.md`
2. `/Users/yutu/.codex/skills/project-routes/INDEX.md`
3. The matching project route, for example `project-routes/Simulaid.md` or `project-routes/Starlaid.md`.

If the selected project route does not explicitly support this wrapper, stop and report that the delivery route is not configured. Do not reuse Simulaid build, Quark, Xcode, signing, App Store Connect, or versioning rules for another game by analogy.

Concurrent-agent safety: reading this skill is safe; delivery/build/upload steps require the project route locks for Unity/Tuanjie, Android build, iOS archive, Quark upload, App Store upload, Git writes, and final Feishu/voice ownership. Child phases return status only; the orchestrator sends final user-facing reports.

The remaining instructions are the current Simulaid route implementation unless the project route says otherwise.

## Scope

Use this skill when the user asks for Simulaid iOS build/package/upload work, including `玉灵`, `玉灵上`, `iOS 上传`, `TestFlight 上传`, or `iOS 打包`.

玉灵 includes the core engineering quality gates from 玉龙:

1. pre-optimization UI regression review,
2. Unity/Tuanjie local resource size/performance acceptance,
3. three performance optimization attempts with two self-reviews,
4. three future-agent-oriented refactor attempts with two self-reviews,
5. version/docs sync only when game/runtime files changed,
6. compile verification,
7. iOS Xcode project export,
8. Xcode Archive and App Store Connect/TestFlight upload when local signing/account state allows,
9. Feishu completion report.

玉灵 does **not** build Android APKs, upload to Quark Netdisk, send through QQ, or speak the 玉龙 success phrase.

If 玉灵 is being run as an iOS delivery subphase inside `/Users/yutu/.codex/skills/yulinglong/SKILL.md` (`玉玲珑`), do not send a separate 玉灵 Feishu completion report or any standalone local voice announcement. Return iOS export/archive/upload status to the 玉玲珑 orchestrator; 玉玲珑 owns the single combined Feishu report and single local voice announcement.

## Required First Reads

1. `/Users/yutu/.codex/skills/simulaid-unity-maintenance/SKILL.md`
2. `/Users/yutu/.codex/skills/simulaid-performance-refactor/SKILL.md`
3. `/Users/yutu/.codex/skills/simulaid-code-refactor-navigation/SKILL.md`
4. `/Users/yutu/.codex/skills/simulaid-ui-regression-review/SKILL.md`
5. `/Users/yutu/Simulaid/CODE_INDEX.md`
6. `/Users/yutu/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md`
7. `/Users/yutu/Simulaid/SIMULAID_UI_LAYOUT_REVIEW.md`
8. `/Users/yutu/Simulaid/SIMULAID_DELIVERY_RISK_REVIEW.md`

## Quality Gate Order

1. Review changed or risky UI areas against the bug ledger and UI checklist. Fix feasible changed-area regressions before optimization; record deferred risks in the bug ledger.
2. Run the Unity/Tuanjie local resource acceptance pass for newly added or changed images, animations, audio, AssetBundles, and `Resources` assets.
   - Check compression/format, Max Size, MipMap, Read/Write, Sprite Atlas participation or exclusion reason, animation sample rate, redundant keyframes, first-package size impact, and runtime loading stability.
   - If no runtime resources changed, record: `资源验收：本轮无新增/变更运行时资源。`
3. Run the delivery risk review: update `/Users/yutu/Simulaid/SIMULAID_DELIVERY_RISK_REVIEW.md` for changes since the last relevant delivery baseline, classify high-risk save/runtime/UI/resource/iOS signing/build changes, and stop iOS delivery if a major risk lacks a test, save fallback, manual guard, or explicit user acceptance.
4. Optimization pass 1: make one safe measurable runtime-performance improvement.
5. Self-review optimization pass 1: touched module, bottleneck, verification signal, residual risk, estimated benefit percentage.
6. Optimization pass 2, then self-review.
7. Optimization pass 3, or record a deliberate no-op when more change would be unsafe.
8. Refactor pass 1: make one safe future-agent/debug/navigation cleanup.
9. Self-review refactor pass 1: touched module, easier future change/search/debug path, compile/behavior risk, estimated future-agent time saving.
10. Refactor pass 2, then self-review.
11. Refactor pass 3, or record a deliberate no-op when more churn would be unsafe.
12. Sync Simulaid version surfaces only if the workflow made a real game/runtime change. Do not create a game version entry for skill/build/Feishu-only changes.
13. Compile through Tuanjie/Unity; accept old SourceGenerator warnings only when exit code is 0 and there are no real CS errors.

## iOS Export Target

Project root: `/Users/yutu/Simulaid`

Durable iOS export root:

`/Users/yutu/SimulaidBuilds/iOS`

Exported Xcode project folder:

`/Users/yutu/SimulaidBuilds/iOS/Simulaid-{version}`

Archive root:

`/Users/yutu/SimulaidBuilds/iOSArchives`

Expected Unity/Tuanjie settings:

- Platform: iOS.
- Scene: `Assets/Scenes/SampleScene.scene`.
- Bundle Identifier: `com.yutu.simulaid`.
- Version: README `Current Build` game version without leading `v`.
- Build Number: README Android version code if Unity/Xcode accepts it. If rejected, stop and report; do not invent a fallback without user confirmation.
- Orientation: Portrait.
- No ads, IAP, or commercialization SDKs added by this workflow.

Preferred command-line export:

```sh
"/Applications/Tuanjie/Hub/Editor/2022.3.62t7/Tuanjie.app/Contents/MacOS/Tuanjie" \
  -batchmode -quit \
  -projectPath "/Users/yutu/Simulaid" \
  -executeMethod SimulaidCommandLineBuild.BuildIOSXcodeProject \
  -outputPath "/Users/yutu/SimulaidBuilds/iOS/Simulaid-{version}" \
  -logFile "/tmp/simulaid-yuling-ios-build-$(date +%Y%m%d-%H%M%S).log"
```

After export, find `.xcworkspace` first; if absent, use `.xcodeproj`.

## Signing and Upload Rules

Do not change Bundle ID, create Apple accounts, delete certificates, or bypass signing/privacy errors.

Known local signing setup:

- Bundle Identifier: `com.yutu.simulaid`.
- Team ID: `HA6WZWUG6Q` (`Chengzuo Song`; Xcode may show `Chengzuo Song (Individual)`).
- Apple Distribution identity: `Apple Distribution: Chengzuo Song (HA6WZWUG6Q)`.
- App Store provisioning profile: `Simulaid App Store`.
- Known profile UUID from first successful upload: `eb3443cc-cdd0-425a-94b8-9c2290e62117`.
- Local profile directory: `/Users/yutu/Library/Developer/Xcode/UserData/Provisioning Profiles/`.

Preflight:

```sh
security find-identity -v -p codesigning
find "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles" -name '*.mobileprovision' -print
```

Decode the `Simulaid App Store` profile with `security cms -D -i <profile>` and confirm:

- `Name = Simulaid App Store`
- `application-identifier = HA6WZWUG6Q.com.yutu.simulaid`
- `get-task-allow = false`
- `beta-reports-active = true`

For the exported Xcode project, set **only** the main `Tuanjie-iPhone` app target's `Release` signing to manual App Store distribution:

- `ProvisioningStyle = Manual` for the `Tuanjie-iPhone` target.
- `CODE_SIGN_STYLE = Manual`
- `CODE_SIGN_IDENTITY = Apple Distribution`
- `DEVELOPMENT_TEAM = HA6WZWUG6Q`
- `PROVISIONING_PROFILE_SPECIFIER = Simulaid App Store`
- `PRODUCT_BUNDLE_IDENTIFIER = com.yutu.simulaid`

Keep Debug/development signing separate. Do not bind the App Store profile to Debug. Keep `TuanjieFramework`, `UnityFramework` if present, `GameAssembly`, and other framework/static-library targets on their existing Automatic/no-profile settings unless Xcode reports a specific conflict.

Archive command template:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project "/Users/yutu/SimulaidBuilds/iOS/Simulaid-{version}/Tuanjie-iPhone.xcodeproj" \
  -scheme Tuanjie-iPhone \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "/Users/yutu/SimulaidBuilds/iOSArchives/Simulaid-{version}-$(date +%Y%m%d-%H%M%S).xcarchive" \
  archive
```

If the export produced a workspace and xcodebuild requires it, use `-workspace <path>` instead of `-project <path>`.

After Archive succeeds, upload through Xcode Organizer / Computer Use:

1. Open the `.xcarchive` or Xcode Organizer.
2. Select the archive.
3. Choose `Distribute App` → `App Store Connect` → `Distribute` / `Upload`.
4. Wait for `Uploaded to Apple` or an App Store Connect/TestFlight processing state.

Stop and report if Apple ID login, verification code, keychain access, agreements, account-security prompts, certificate/profile errors, privacy prompts, Bundle ID conflicts, or upload validation errors appear. The user must handle account/security prompts manually.

## Feishu Completion Report

Send a concise Feishu/Yutu text report after the iOS workflow attempt through `/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/scripts/send_yutu_reminder.py`; the helper applies the `主人，前情提要：...` prefix.

Include:

- version/build number,
- UI review/fix summary,
- resource acceptance result,
- delivery risk review result and remaining watch items,
- optimization pass 1-3 summaries and estimated benefits,
- refactor pass 1-3 summaries and estimated future-agent benefits,
- compile result,
- iOS export directory,
- `.xcworkspace`/`.xcodeproj` path,
- archive path and Archive result,
- App Store Connect/TestFlight upload result or blocker,
- 3-5 next-improvement suggestions.

Preferred helper:

```sh
/Users/yutu/.hermes/hermes-agent/venv/bin/python \
  /Users/yutu/.codex/modules/hermes-yutu-voice-bridge/scripts/send_yutu_reminder.py \
  --context "刚刚在处理 Simulaid iOS 玉灵交付" \
  "版本 {version}：导出/Archive/上传状态如下……"
```

Do not print Feishu credentials or `.env` contents. If Feishu fails, still provide the final local report.

## Final Report

Report:

- whether UI review, resource acceptance, optimization 1-3, and refactor 1-3 were completed,
- compile status,
- iOS export directory and project/workspace path,
- archive path and Archive result,
- upload result and App Store Connect/TestFlight status,
- whether Feishu returned `ok`,
- any Apple/signing/account blocker,
- confirmation that Android APK, Quark upload, QQ sending, and 玉龙 voice were not attempted.
