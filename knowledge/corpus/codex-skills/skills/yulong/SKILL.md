---
name: 玉龙
description: "Use when the user says 玉龙, 玉龙一条龙, or asks for an Android/package delivery lane. Treat 玉龙 as a cross-project wrapper: first route through /Users/yutu/.codex/skills/project-routes/INDEX.md and the matching project route. The Simulaid route is currently fully implemented for Android optimize/build/Quark delivery; unsupported project routes must stop instead of borrowing Simulaid commands."
---

# 玉龙

This is the user's short-name entry point for the Simulaid Android one-stop workflow.

Current workflow generation: `玉龙 19 号（交付前风险审视 + 安卓发布安全门禁 + 交付后自动 Git 上传）`.

Own update log: `/Users/yutu/.codex/skills/yulong/YULONG_UPDATE_LOG.md`.

When changing 玉龙 itself, update that log in the same turn. This is developer-side workflow memory and does not bump the Simulaid game version by itself.


## Cross-Project Route Guard

This is a global wrapper name, not a Simulaid-only concept. Before applying the route below, read:

1. `/Users/yutu/.codex/skills/SKILL_ARCHITECTURE.md`
2. `/Users/yutu/.codex/skills/project-routes/INDEX.md`
3. The matching project route, for example `project-routes/Simulaid.md` or `project-routes/Starlaid.md`.

If the selected project route does not explicitly support this wrapper, stop and report that the delivery route is not configured. Do not reuse Simulaid build, Quark, Xcode, signing, App Store Connect, or versioning rules for another game by analogy.

Concurrent-agent safety: reading this skill is safe; delivery/build/upload steps require the project route locks for Unity/Tuanjie, Android build, iOS archive, Quark upload, App Store upload, Git writes, and final Feishu/voice ownership. Child phases return status only; the orchestrator sends final user-facing reports.

The remaining instructions are the current Simulaid route implementation unless the project route says otherwise.

## Scope

When the user says `玉龙`, treat it as the same Android workflow as `优化打包一条龙`:

1. Invoke `/Users/yutu/.codex/skills/simulaid-optimize-build-deliver/SKILL.md`.
2. Follow its full Simulaid pre-optimization UI regression review, Unity/Tuanjie local asset size/performance acceptance, three-pass performance optimization, three-pass future-agent-oriented refactor, version/docs sync when game/runtime files changed, compile, Android APK build, Downloads cleanup, Quark Netdisk upload attempt for the APK, and Yutu/Feishu reminder workflow.
   - Before optimization, read the Simulaid bug ledger and common UI checklist through `/Users/yutu/.codex/skills/simulaid-ui-regression-review/SKILL.md`.
   - Fix feasible changed-area UI regressions before performance/refactor work; record deferred UI risks in `/Users/yutu/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md`.
   - Optimization pass 1 must receive a self-review before pass 2.
   - Optimization pass 2 must receive a self-review before pass 3.
   - Refactor pass 1 must receive a self-review before pass 2.
   - Refactor pass 2 must receive a self-review before pass 3.
   - Before build, check every newly added or changed image, animation, audio, AssetBundle, or `Resources` asset against the Unity/Tuanjie local resource acceptance standard in `simulaid-optimize-build-deliver`.
   - Before build, read and update `/Users/yutu/Simulaid/SIMULAID_DELIVERY_RISK_REVIEW.md`: review changes since the last relevant delivery baseline, list high-risk gameplay/save/UI/resource/build/process changes, confirm each has a test/save fallback/manual guard, and stop delivery if a major risk is unguarded. Include a concise `交付风险审视` result in Feishu/final output.
   - The Feishu reminder must include concise UI review/fix, resource acceptance, optimization pass 1-3, refactor pass 1-3, and separate estimated benefit percentages.
   - The Feishu reminder must not include the local APK path.
   - Android 发布安全门禁是上传前必做项：保持 IL2CPP + ARM64-only，确认非 Development Build、关闭调试/Profiler/调试符号、开启 Release minify/R8/ProGuard，运行 `Tools/simulaid_android_release_security_audit.py --project-root /Users/yutu/Simulaid --apk <latest-apk> --strict`，未通过时停止上传并汇报 blocker。
3. Build Android only. Do not export an iOS Xcode project, do not run Xcode Archive, and do not upload to App Store Connect/TestFlight from 玉龙.
4. If the user asks for iOS in the same request, treat that as a separate `玉灵` workflow. Do not silently fold iOS into 玉龙; either run 玉龙's Android path and then explicitly switch to 玉灵 if requested, or stop and clarify when the requested order is ambiguous.
5. Do not send through QQ unless the user explicitly asks for QQ in the same turn and confirms after the account-risk warning required by the underlying workflow.
6. Quark upload is part of the normal 玉龙 delivery attempt. Use **夸克浏览器 / Quark Browser** for this upload step, not Safari, Chrome, the default browser, QQ, Finder sharing, or a generic web fallback. Upload the latest versioned APK itself, for example `/Users/yutu/Documents/codexProjects/Simulaid/Builds/Simulaid-0.32.40.apk`, directly into the exact Quark Netdisk folder `首页 > 文件 / Simulaid / Simulaid-apk/`.
   - Upload should be attempted through direct **Computer Use** operation of Quark Browser whenever the UI is available. Before opening a new Quark Netdisk page or tab, first inspect the current Quark Browser windows/tabs with Computer Use/app state. If an existing page is already on Quark Netdisk (`pan.quark.cn`, `夸克网盘`, or a Quark file-list view), reuse that page and navigate from it to `首页 > 文件 / Simulaid / Simulaid-apk/`. If no usable Netdisk page is open, prefer clicking Quark Browser's top-right Netdisk entry button beside the user avatar to open 夸克网盘; manually typing a URL/path is a fallback only when that button is unavailable or blocked. Open a new Quark Netdisk page only when neither reuse nor the avatar-side Netdisk button works.
   - This folder path is strict. Before opening the local file picker, confirm the Quark breadcrumb/current directory shows `/ Simulaid / Simulaid-apk` or a UI-equivalent that proves the current folder is the Android APK child folder. The cloud `Simulaid` folder is only the parent folder; `Simulaid-PC` is a sibling child folder reserved for Windows PC packages and must not receive Android APKs.
   - Do not upload Android APKs from Quark search results, `全部文件`, the cloud `Simulaid` parent folder, `Simulaid / Simulaid-PC`, any cloud `Builds`/`builds` subfolder, or any upper directory. Searching is allowed only to find/open the target folder; if the browser remains on a search-results page or an upper directory, stop and navigate into `Simulaid / Simulaid-apk` before uploading.
   - Do not rename it to `Simulaid.apk`.
   - Do not create a stable-name staging copy for upload.
   - Do not create or use a cloud `Builds`/`builds` subfolder under `Simulaid / Simulaid-apk`; upload each new versioned APK directly into `Simulaid / Simulaid-apk`.
   - Do not rename or delete cloud files after upload.
   - If Quark shows a generic compliance notice or even an account-status/banner text that *looks* like a restriction, do not treat that text alone as an upload blocker. Continue to click the upload controls and select the APK when the UI remains operable. Report a Quark blocker only after a real operation fails: upload button/file picker is disabled, login/captcha/permission interrupts the flow, transfer fails, or the versioned APK cannot be confirmed in the target folder.
   - If Quark Browser is not installed, not logged in, blocked by captcha, or cannot access the upload target, stop the upload attempt and report the blocker in Feishu/final output. Do not silently switch browsers.
7. After every successful Android APK build, append a concise delivery record to `/Users/yutu/.codex/modules/simulaid-marketing-planning-bridge/release-version-ledger.md` under `Android Delivery History`. Include date/time, display version, Android version code if known, build result, Android release security audit result, Quark upload result, and whether this was standalone `玉龙` or a `玉玲珑` Android subphase. This record is used by `玉凰` to produce update logs that cover the full gap since the last generated/published player-facing version text instead of only the newest tiny patch. Do not put local APK paths, secrets, or hidden-content spoilers in this ledger.
8. After a standalone 玉龙 run has passed the validation/build gates and the Android APK build has succeeded, automatically upload the Simulaid repo changes to Git before the final voice/chat report:
   - Acquire the `simulaid.git-write` lock from `/Users/yutu/.codex/skills/project-routes/Simulaid.md` before staging, committing, tagging, pushing, or changing branches. Release it at the end, even when Git fails.
   - Work only in `/Users/yutu/Simulaid`. Run `git status --short` first and preserve all existing user/agent changes; do not revert, reset, delete, rebase, force-push, or silently drop untracked files.
   - If the source/test/build gate failed because of code, do **not** push the failing game state unless the user explicitly overrides after seeing the blocker. If only a platform/account/upload side effect is blocked while source validation and the Android build passed, the Git upload may still proceed and must mention that platform blocker separately.
   - Stage the intended Simulaid repo changes with `git add -A` after checking that ignored build artifacts, local logs, credentials, caches, and generated APK files are not being staged. Run `git diff --cached --check` before committing.
   - If there are no staged changes, record `Git: no-op` in Feishu/final output. Otherwise commit with a concise versioned message such as `chore(simulaid): deliver v1.8.8 via yulong`, then push the current branch to `origin` without force. If the push is rejected or authentication/network fails, report `Git blocker` with the short reason and leave the local commit intact.
   - Include the commit short hash and push result in Feishu/final output. Do not include large diffs, secrets, local cookies, or long Git logs.
   - If 玉龙 is running as an Android subphase inside `玉玲珑`, do **not** commit or push independently; return the Android status to 玉玲珑, which owns the single combined Git upload.
9. After the APK build succeeds, Quark upload has been attempted, Git upload has been attempted for standalone 玉龙, and the Yutu/Feishu reminder has been attempted, trigger a local Yutu voice announcement that starts with `主人，前情提要：...`:

`主人，前情提要：Simulaid 构建和提醒已经完成。玉龙 {displayVersion}：模拟纪元已发送。`

If 玉龙 is being run as an Android delivery subphase inside `/Users/yutu/.codex/skills/yulinglong/SKILL.md` (`玉玲珑`), do **not** trigger this standalone voice announcement and do **not** send a separate 玉龙 Feishu completion report. Return Android build/upload status to the 玉玲珑 orchestrator; 玉玲珑 owns the single combined Feishu report and single local voice announcement.

Use `SimulaidVersionInfo.DisplayVersion` when available, for example `玉龙 v0.32.40：模拟纪元已发送。`. If only the numeric `SimulaidVersionInfo.Version` is available, prefix it with `v`. If the user provides a different release label or version in the same request, substitute that label for `{displayVersion}`.

## Voice Helper

Use the active Hermes/Yutu voice profile. Do not print secrets from `.env` or config files.

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

Replace `{displayVersion}` before running the helper.

If the voice helper fails, do not retry endlessly and do not mark the build as failed solely because speech failed. Report the APK result and the voice blocker separately.

When speaking in a normal standalone 玉龙 run immediately after sending Feishu, use a copied config with `feishu_send_voice_notice_enabled = False` for the Feishu send if the same helper script will also call `mod.speak(...)`. This prevents Hermes' automatic Feishu-send notice from overlapping the explicit 玉龙 success voice. Do not globally disable Hermes Feishu send notices unless the user explicitly asks.

If the build fails or the package was not prepared, do not speak the success phrase. Instead report the blocker in the final response and in the Yutu/Feishu reminder when possible. If only Quark upload is blocked, the build can still be reported as successful, but the reminder/final response must clearly say the versioned APK upload to `首页 > 文件 / Simulaid / Simulaid-apk/` was blocked or needs user action.

## iOS Boundary

- iOS export, Archive, TestFlight, App Store Connect upload, Apple signing/profile checks, and Xcode Organizer operations belong to `/Users/yutu/.codex/skills/yuling/SKILL.md` (`玉灵`).
- 玉龙 must not change Bundle ID, Apple Team, provisioning profiles, Xcode signing, or iOS build folders.
- If a future session needs both Android and iOS delivery, run 玉龙 and 玉灵 as two explicit phases and report them separately.

## Versioning

Creating or updating this skill is a developer-side workflow change. Do not bump the Simulaid game version or add in-game version-history text for this skill alone.

## One-Shot Completed Tasks

- **Superseded on 2026-05-15**: The old one-shot screenshot task for suspected Quark account restrictions is closed and must not be revived automatically. Do not watch for, screenshot, or specially report Quark account-ban-looking text as a standalone task. Generic compliance banners such as `严禁传播暴力恐怖、色情违法及侵犯他人合法权益的违法信息` are platform slogans, not account bans. During upload, judge Quark status by whether upload controls work, whether login/captcha/permission blocks the operation, and whether the versioned APK is confirmed in `首页 > 文件 / Simulaid / Simulaid-apk/`. If a genuinely different Quark blocker prevents upload, report it as an upload blocker in Feishu/final output; do not create a special screenshot task unless the user asks again.
