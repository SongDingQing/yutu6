---
name: simulaid-optimize-build-deliver
description: Use when the user says 优化打包一条龙, 玉龙, or asks for a combined Simulaid Android workflow that does pre-optimization UI regression review against the bug ledger/common UI checklist, Studio optimization-ledger preflight, Unity/Tuanjie local asset size/performance acceptance, three performance optimization attempts, three future-agent-oriented refactor attempts, version/docs sync, Android APK build/upload directly into the Quark Netdisk `Simulaid / Simulaid-apk` folder through Quark Browser, 玉兔/Feishu completion reminder, and the 玉龙 local Yutu voice announcement. This workflow must not send APKs through QQ and must not export/archive/upload iOS; use 玉灵 for iOS/TestFlight/App Store Connect delivery.
---

# Simulaid Optimize Build Deliver

This is the one-stop Simulaid workflow for `优化打包一条龙`. The user-facing shortcut `玉龙` is an alias for this workflow with an extra local Yutu voice announcement after completion.

It intentionally combines three focused workflows:

1. `simulaid-ui-regression-review` for bug-ledger and common UI checklist review before optimization.
2. Unity/Tuanjie local asset size/performance acceptance for newly added or changed images, animations, audio, AssetBundles, and `Resources` assets.
3. `simulaid-performance-refactor` for performance and future-agent-oriented code cleanup.
4. A build-and-reminder pass for closing Tuanjie, building the Android APK, retaining local build backups, cleaning Downloads leftovers, uploading the versioned APK directly into the Quark Netdisk `Simulaid / Simulaid-apk` folder through Quark Browser, and notifying 玉兔/Feishu.

QQ sending is deliberately excluded. Do not open QQ, do not use Computer Use for QQ, and do not attach the APK to any QQ chat as part of this workflow; the user is avoiding QQ-send risk.

## Required Order

1. Read `/Users/yutu/.codex/skills/simulaid-unity-maintenance/SKILL.md`.
2. Read `/Users/yutu/.codex/skills/simulaid-performance-refactor/SKILL.md`.
3. Read `/Users/yutu/.codex/skills/simulaid-code-refactor-navigation/SKILL.md`.
4. Read `/Users/yutu/.codex/skills/simulaid-ui-regression-review/SKILL.md`.
5. Read `/Users/yutu/Simulaid/CODE_INDEX.md`.
6. Read `/Users/yutu/Simulaid/SIMULAID_OPTIMIZATION_NOTES.md` as the canonical Studio optimization ledger before choosing any optimization/refactor pass.
   - Search the ledger by the current symptom/page/system. Do not repeat entries marked `已验证`, `已拒绝`, or `禁止重复` unless there is new player feedback, profiler evidence, Unity/Tuanjie version change, or an explicit user request.
   - Choose pass targets from `候选`, `观察中`, `延期` with a new safe window, or genuinely new findings.
   - If a pass would only repeat a previously stable micro-optimization, record `有意空操作` in the ledger with `0%~0%` benefit instead of changing code for churn.
   - Every optimization/refactor pass, including no-op passes, must update this same file with ledger id/status, touched files, benefit basis, risk, verification result, and next step.
7. Before optimization, review the changed or recently risky UI areas against `/Users/yutu/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md` and `/Users/yutu/Simulaid/SIMULAID_UI_LAYOUT_REVIEW.md`.
   - Focus on changed areas first: tutorial anchors, popups, long-press details, image ratios, bottom actions, combat HUD layers, farm/talent rings, archives, new-game/title menu, and any page named by the user.
   - Fix feasible UI regressions before performance work.
   - If a UI issue is found but unsafe to fix in this workflow, record it in the bug ledger as `deferred` and include the risk in the Feishu reminder.
   - Developer-only bug/UI docs do not bump the game version. Runtime UI fixes do.
   - If the current delivery includes save/load, PlayerPrefs, old-save migration, version-gated runtime behavior, or any gameplay change that could reinterpret existing saved values, also read `/Users/yutu/Simulaid/SIMULAID_SAVE_COMPATIBILITY_INDEX.md` before building. Confirm the current highest version line has indexed rows through `SimulaidVersionInfo.Version`, then run or require the relevant `SaveCompatibility_*` tests plus `Version_MetadataConsistency`; unresolved old-save risks block delivery.
8. Before the build, run the Unity/Tuanjie local resource size/performance acceptance pass for every newly added or changed resource since the current turn's start or since the previous built version when that is easy to identify.
   - Scope: images/sprites/textures, sprite sheets, animation clips/controllers, audio clips, AssetBundle-related files, and anything under `Assets/Resources/`, especially `Assets/Resources/GeneratedPixel/` and `Assets/Resources/GeneratedAudio/`.
   - For images/sprites/textures, inspect the PNG dimensions and `.meta` `TextureImporter` settings: compression/texture format, platform overrides, `maxTextureSize`, MipMap disabled for UI sprites unless intentionally needed, Read/Write disabled unless code requires CPU pixel access, alpha transparency enabled only when needed, filter/wrap settings suitable for pixel/UI art, and valid Unity-style import metadata.
   - For large or repeated sprites, check whether they should participate in a Sprite Atlas or document why they must stay loose, such as dynamic `Resources.Load` access, one-off full-screen scene art, or current project atlas limitations.
   - For animations, inspect clip/frame specs: sample rate, sprite-sheet frame count, redundant keyframes, looping settings, per-frame registration risk, and whether UI animation can use fewer frames or event-driven updates without visible loss.
   - For audio, inspect clip duration, channels, sample rate, import compression/load type where `.meta` exists, and whether short UI/voice effects should be compressed/decompressed appropriately for latency and package size.
   - For AssetBundle or `Resources` additions, verify stable runtime load names, avoid unnecessary `Resources` residency, check exact filename-to-code references, and make sure missing-sprite/audio caches will not show raw resource names or silence in builds.
   - Estimate first-APK-size impact by comparing new/changed asset byte size against previous nearby assets or the latest APK/buildBackup size when available. Flag any single new runtime asset over roughly 1 MB, any sprite sheet over roughly 4 MB, any audio file over roughly 500 KB, or any batch that adds more than roughly 5 MB before compression unless justified.
   - Runtime loading stability checks must include: resource path without extension, `.meta` validity, `SimulaidPixelAssets` / audio loader cache behavior, case-sensitive filename match, and whether editor loose-file fallback might hide a build-time import problem.
   - Record the acceptance result even when no new runtime resources were touched: `资源验收：本轮无新增/变更运行时资源。`
   - Fix obviously unsafe importer/resource settings when the correction is low-risk. If a setting needs Unity reimport or design confirmation, record it as a deferred risk in the Feishu reminder and final report.
   - If the current turn touched or claimed to replace player-facing art, cross-check `/Users/yutu/Simulaid/IMAGE_PLACEHOLDER_BACKLOG.md`. Any matching entry with `pending`, `interim`, `interim-upgraded`, or notes that true AI art is still blocked must be reported as unpaid art debt in Feishu/final output. Do not describe that asset work as final, regenerated, complete, or paid off, and do not make a player-facing release note that implies the visual debt is fully resolved unless the actual image-generation backend was used and the backlog entry is closed.
9. Do three narrow, measurable optimization attempts before the build. Keep them scoped to runtime performance and avoid gameplay redesign unless the user explicitly requested it.
   - animation rendering,
   - card/item archive dragging,
   - talent horizontal dragging,
   - active combat UI rebuild/drag responsiveness,
   - startup or large-list refresh cost.
   Required sequence:
   - Optimization pass 1: make one safe, measurable performance-oriented change.
   - Self-review after optimization pass 1: name the touched module, expected bottleneck, verification signal, residual risk, and estimated benefit percentage range before attempting pass 2.
   - Optimization pass 2: based on that self-review, attempt one additional safe performance-oriented change in either the same bottleneck or another high-impact bottleneck.
   - Self-review after optimization pass 2 with the same fields before attempting pass 3.
   - Optimization pass 3: based on the second self-review, make the final safe performance-oriented change or record a deliberate no-op if more change would be unsafe.
   If optimization pass 2 or 3 would be unsafe or meaningless, record that pass as an attempted no-op with `0%~0%` benefit and explain why in the Feishu reminder and final report.
10. Do three future-agent-oriented refactor attempts after the optimization attempts and before the build. Keep them scoped to code navigation, duplicate helper consolidation, clearer state boundaries, or easier debugging.
   Required sequence:
   - Refactor pass 1: make one safe cleanup that improves future code search/debug speed without changing gameplay behavior.
   - Self-review after refactor pass 1: name the touched module, what became easier to find/change, compile or behavior risk, and estimated future-agent time-saving percentage range before attempting pass 2.
   - Refactor pass 2: based on that self-review, attempt one additional safe cleanup.
   - Self-review after refactor pass 2 with the same fields before attempting pass 3.
   - Refactor pass 3: based on the second self-review, make the final safe cleanup or record a deliberate no-op if more churn would be risky.
   If refactor pass 2 or 3 would be unsafe or churn-heavy, record that pass as an attempted no-op with `0%~0%` benefit and explain why in the Feishu reminder and final report.
11. Bump version and sync README, VersionHistoryEntries, CODE_INDEX, and ProjectSettings according to `simulaid-unity-maintenance` only when the workflow made a real game/runtime change. If the workflow only changed skills, build scripts, Feishu wording, package retention, bug/UI review docs, optimization-ledger docs, or other developer-side automation, do not bump the Simulaid game version.
   - `VersionHistoryEntries` must stay player-facing. Never mention `一条龙`, skill updates, Feishu/Yutu reminders, QQ policy, compile/build status, backups, Downloads cleanup, Codex/agent work, or internal refactor process there.
   - When a runtime optimization needs a game version entry, describe only the player-visible result, for example `长篇事件文字滚动更顺滑`.
12. Compile with the Tuanjie C# check. Known SourceGenerator `CS8032` warnings are acceptable only when exit code is 0 and no real CS errors appear.
13. Before Android upload, enforce and verify the Android release security gate: IL2CPP + ARM64-only, non-Development Build, debugger/Profiler/debug symbols off, Release minify/R8/ProGuard on, `android:debuggable=false`, no obvious keys/secrets/raw unpublished gift codes in project/APK. The command-line build should run `Tools/simulaid_android_release_security_audit.py --project-root /Users/yutu/Simulaid --apk <latest-apk> --strict`; if it fails, stop upload and report the blocker.
14. Read `/Users/yutu/.codex/skills/simulaid-build-qq-delivery/SKILL.md` only for the Android build directory, backup, Downloads cleanup, build command, Quark upload, and Feishu reminder conventions. iOS export/archive/upload has been split into `/Users/yutu/.codex/skills/yuling/SKILL.md` (`玉灵`) and must not run inside 玉龙.
15. Run the build-and-reminder workflow, explicitly skipping every external chat-file delivery step:
   - close Tuanjie/Unity editor,
   - build `/Users/yutu/Documents/codexProjects/Simulaid/Builds/Simulaid-{version}.apk`,
   - do not export iOS, do not open Xcode, do not Archive, and do not upload to App Store Connect/TestFlight in this workflow; if the user asks for iOS, use the separate `玉灵` skill as a distinct phase,
   - keep previous 10 packages in `buildBackup`,
   - clean Simulaid build leftovers from Downloads,
   - upload the built versioned APK itself, for example `/Users/yutu/Documents/codexProjects/Simulaid/Builds/Simulaid-0.28.42.apk`, directly into the Quark Netdisk folder opened through `首页 > 文件 / Simulaid / Simulaid-apk/`,
   - before opening a new Quark Netdisk page/tab, inspect current Quark Browser windows/tabs. If a Quark Netdisk page is already open (`pan.quark.cn`, `夸克网盘`, or a Quark file-list view), reuse it and navigate from there to `首页 > 文件 / Simulaid / Simulaid-apk/`; if no usable Netdisk page exists, prefer the Quark Browser top-right Netdisk entry button beside the user avatar to open 夸克网盘; type a URL/path or open a new page only when reuse and the avatar-side Netdisk entry are both blocked,
   - the Quark upload path is strict: before opening the local file picker, verify the visible breadcrumb/current directory is exactly `/ Simulaid / Simulaid-apk` or an equivalent folder view. The cloud `Simulaid` folder contains the Android child folder `Simulaid-apk` and the sibling Windows PC child folder `Simulaid-PC`. Do not upload from a search-results page, `全部文件`, the cloud `Simulaid` parent folder, `Simulaid / Simulaid-PC`, a cloud `Builds`/`builds` subfolder, or any upper directory. Search is allowed only to find/open the target folder; if the exact folder cannot be reached, stop and report the blocker,
   - perform the Quark upload in **夸克浏览器 / Quark Browser** only; do not use Safari, Chrome, the system default browser, QQ, Finder sharing, or a generic browser fallback,
   - if Quark shows a generic compliance notice or account-status/banner text, do not treat that text alone as an account ban or upload blocker; continue clicking upload and selecting the APK when the UI remains operable, and only report a blocker after upload button/file picker/transfer/final target-folder confirmation actually fails,
   - if Quark Browser is missing, logged out, blocked by captcha/network/permission, or cannot reach the target folder, stop the upload attempt and report the blocker in Feishu and the final response instead of silently switching browsers,
   - do not rename the upload to `Simulaid.apk`, do not use a stable cloud filename, do not create/use a cloud `Builds`/`builds` subfolder under `Simulaid`, and do not rename or delete cloud files as part of this workflow; if Quark reports a duplicate for the same versioned filename, stop and report the blocker,
   - notify 玉兔/Feishu with build status, Quark upload result, concise UI review/fix summary, local asset acceptance result, three optimization summaries, three refactor summaries, each pass's separate estimated benefit percentage, and several next-improvement suggestions. Do not include the local APK path in the Feishu text.
16. After every successful Android APK build, append a short record to `/Users/yutu/.codex/modules/simulaid-marketing-planning-bridge/release-version-ledger.md` under `Android Delivery History`. Include date/time, display version, Android version code if known, source (`玉龙` or `玉玲珑 Android phase`), build status, and Quark upload status. This gives `玉凰` a stable baseline for player-facing version logs that may need to cover multiple small versions between actual uploads.
17. If the user invoked the shortcut as `玉龙` or asked for the one-stop workflow's Yutu voice announcement, trigger the local Hermes/Yutu voice after Quark upload has been attempted and the Feishu reminder has been attempted:
    - Success phrase: `主人，前情提要：Simulaid 构建和提醒已经完成。玉龙 {displayVersion}：模拟纪元已发送。`
    - Use `SimulaidVersionInfo.DisplayVersion` or prefix the built APK version with `v`, for example `玉龙 v0.28.26：模拟纪元已发送。`
    - If speech fails, report the voice blocker but do not mark the APK build itself as failed.

## iOS Rule

iOS export, Xcode Archive, App Store Connect/TestFlight upload, Apple signing/profile checks, and Xcode Organizer operations are not part of `优化打包一条龙` / 玉龙. Use `/Users/yutu/.codex/skills/yuling/SKILL.md` (`玉灵`) for those tasks. If a user requests both Android 玉龙 and iOS 玉灵 in one turn, treat them as two explicit phases and report them separately.

## QQ Rule

QQ APK delivery is not part of `优化打包一条龙`.

- Do not send to `我的手机`.
- Do not send to `林林姐姐`.
- Do not open QQ or automate QQ with Computer Use.
- If the user explicitly asks for QQ in the same request, stop and clarify that this workflow intentionally does not include QQ sending; offer the APK path after build instead.

Do not mention QQ in the 玉兔/Feishu notification text. Keep QQ risk/status out of the remote reminder; it is an internal workflow boundary only.

## Feishu Reminder Content

The 玉兔/Feishu completion reminder must be useful on its own and must not mention QQ. Include:

- version and build status, but not the local APK path,
- whether compile, APK build, and Android release security audit succeeded,
- whether the Android release security audit passed before upload,
- whether the versioned APK upload to Quark Netdisk path `首页 > 文件 / Simulaid / Simulaid-apk/` succeeded or was blocked,
- a compact UI regression review/fix summary, including deferred UI risks if any,
- a compact Unity/Tuanjie local resource acceptance block for new/changed images, animations, audio, AssetBundle, and `Resources` assets, including compression/Max Size/MipMap/Read-Write/Sprite Atlas/animation sample rate/redundant keyframes/first-APK-size/runtime-load checks,
- optimization-ledger ids/statuses from `/Users/yutu/Simulaid/SIMULAID_OPTIMIZATION_NOTES.md`, including intentionally skipped already-verified work,
- a compact optimization/refactor summary,
- separate estimated benefit percentage ranges for optimization passes 1-3 and refactor passes 1-3, clearly labeled as estimates unless measured directly,
- a compact self-review note for each pass: touched module, benefit basis, and residual risk,
- 3-5 concrete suggestions for currently incomplete or worth-improving areas.

This Feishu reminder is allowed to contain developer-side workflow details. The in-game `VersionHistoryEntries` is not.

Suggested format:

```text
主人，前情提要：刚刚在处理 Simulaid 优化构建。Simulaid {version} 优化构建完成。
构建：通过；夸克上传：首页 > 文件 / Simulaid / Simulaid-apk/Simulaid-{version}.apk / ……
UI审查：……
资源验收：图片/动画/音频/Resources/AssetBundle ……；压缩/Max Size/MipMap/ReadWrite/图集/采样率/冗余关键帧/首包体积/加载稳定性 ……
优化1：模块/改动/收益预估 X%~Y%/风险……
优化2：模块/改动/收益预估 X%~Y%/风险……
优化3：模块/改动/收益预估 X%~Y%/风险……
重构1：模块/改动/定位收益预估 X%~Y%/风险……
重构2：模块/改动/定位收益预估 X%~Y%/风险……
重构3：模块/改动/定位收益预估 X%~Y%/风险……
总体预估：动画渲染 CPU 开销 -X%~-Y%；图鉴滚动卡顿 -A%~-B%；天赋拖拽抖动 -C%~-D%；未来代码定位时间 -E%~-F%。
后续建议：1. …… 2. …… 3. ……
```

## 玉龙 Voice Announcement

When the trigger is `玉龙`, speak locally through the active Hermes/Yutu voice profile after the APK build succeeds, Quark upload has been attempted, and the Feishu reminder has been attempted.

Helper:

```sh
/Users/yutu/.hermes/hermes-agent/venv/bin/python - <<'PY'
import importlib.util
from pathlib import Path

message = "主人，前情提要：Simulaid 构建和提醒已经完成。玉龙 {displayVersion}：模拟纪元已发送。"
path = Path("/Users/yutu/.hermes/voice-wake/hermes_voice_wake.py")
spec = importlib.util.spec_from_file_location("hermes_voice_wake", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
cfg = mod.load_voice_config()
mod.speak(message, cfg)
print("ok")
PY
```

Replace `{displayVersion}` before running. Do not print Hermes credentials or `.env` contents. Do not speak the success phrase when build or package preparation failed. If the APK built but Quark upload was blocked, speak only after the Feishu reminder has recorded that caveat.

## Scope Guardrails

- Do not perform large gameplay redesigns inside this workflow unless the user also specifies the gameplay change.
- Do not generate or replace images unless the optimization task reveals an invalid/missing asset or the user requests asset work.
- Do not skip the build/reminder pass after optimization unless the build fails or Feishu is blocked; report the blocker clearly.
- Do not leave Tuanjie build processes running at the end.

## Final Report

Report:

- optimization/refactor summary,
- version and APK filename,
- compile/build status,
- APK path for manual pickup,
- Quark upload result and versioned cloud filename status,
- confirmation that iOS was skipped and belongs to 玉灵,
- confirmation that no external chat-file delivery was attempted,
- whether 玉兔/Feishu reminder returned `ok`,
- whether the 玉龙/Yutu local voice announcement returned `ok` when requested,
- the Unity/Tuanjie local resource acceptance result for new/changed images, animations, audio, AssetBundle, and `Resources` assets,
- the three optimization pass summaries, three refactor pass summaries, and the separate estimated benefit percentages that were included in the reminder,
- any blocker or residual risk.
