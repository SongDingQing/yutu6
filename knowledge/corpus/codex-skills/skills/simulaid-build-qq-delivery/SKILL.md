---
name: simulaid-build-qq-delivery
description: Use when the user asks to close Tuanjie/Unity, build a Simulaid Android APK, 打包发送, keep the latest package as Simulaid-version.apk under Documents/codexProjects/Simulaid/Builds, retain the previous 10 packages under buildBackup, clean Simulaid build leftovers from Downloads, notify 玉兔/Feishu that the APK is ready, or upload the latest versioned Simulaid APK directly into the Quark Netdisk `Simulaid / Simulaid-apk` folder through Quark Browser. Despite the legacy skill name, QQ sending is disabled by default and must not be part of normal build workflows; iOS export/archive/upload has moved to 玉灵.
---

# Simulaid Build Package Reminder

Use this project/user workflow skill for Simulaid release packaging, local build retention, Downloads cleanup, and 玉兔/Feishu notification.

Shortcut trigger: if the user says `打包发送` in the Simulaid context, treat it as the full non-QQ workflow: close Tuanjie/Unity, build the versioned APK, clean old Downloads build leftovers, then notify 玉兔/Feishu with the APK path so the user can pick it up manually.

## Scope

- Project root: `/Users/yutu/Simulaid`
- Build directory: `/Users/yutu/Documents/codexProjects/Simulaid/Builds`
- Backup directory: `/Users/yutu/Documents/codexProjects/Simulaid/Builds/buildBackup`
- Latest APK naming: `Simulaid-{version}.apk`, for example `Simulaid-0.17.1.apk`.
- Quark upload target path: `首页 > 文件 / Simulaid / Simulaid-apk/` in Quark Netdisk opened inside Quark Browser. The cloud `Simulaid` folder contains the Android child folder `Simulaid-apk` and the sibling Windows PC child folder `Simulaid-PC`.
- Quark upload path guard: before selecting the local APK, verify the visible Quark breadcrumb/current directory is exactly `/ Simulaid / Simulaid-apk` or an equivalent folder view. Do not upload Android APKs from search results, `全部文件`, the cloud `Simulaid` parent folder, `Simulaid / Simulaid-PC`, any cloud `Builds`/`builds` subfolder, or any upper directory.
- Quark cloud-facing APK filename: keep the local versioned filename, for example `Simulaid-0.28.42.apk`. Do not rename uploaded builds to `Simulaid.apk`. Do not create or use a cloud `Builds`/`builds` subfolder under `Simulaid / Simulaid-apk`; each new Android package is uploaded directly into `Simulaid / Simulaid-apk`.
- Quark upload app: use **夸克浏览器 / Quark Browser** for uploads. Do not upload through Safari, Chrome, the system default browser, QQ, Finder sharing, or a generic browser fallback unless the user explicitly changes this rule in the same turn.
- Quark page entry rule: before opening any new Quark Netdisk page/tab, inspect current Quark Browser windows/tabs. If a Quark Netdisk page is already open (`pan.quark.cn`, `夸克网盘`, or a Quark file-list view), reuse it and navigate to `首页 > 文件 / Simulaid / Simulaid-apk/`. If no usable Netdisk page is present, prefer Quark Browser's top-right Netdisk entry button beside the user avatar to open 夸克网盘; manually typing a URL/path is a fallback only when that button is unavailable or blocked.
- Quark compliance/account-banner rule: a generic page notice, slogan, or account-status/banner text is not by itself an upload blocker. Continue to click upload and select the APK if the UI remains operable. Treat Quark as blocked only after an actual operation fails: upload button/file picker is disabled, login/captcha/permission interrupts the flow, transfer fails, or the versioned APK cannot be confirmed in the target folder.
- QQ sending is disabled by default. Do not send Simulaid build APKs to `我的手机`, `林林姐姐`, or any other QQ contact during normal build workflows.
- Do not open QQ or automate QQ with Computer Use unless the user explicitly asks for QQ sending in the same request and confirms they accept the account-risk tradeoff.
- Feishu/Yutu completion reminder target: the configured Hermes voice-wake Feishu sync chat in `/Users/yutu/.hermes/voice-wake/config.json`.
- This is a build and reminder workflow. Do not bump the game version or add game changelog entries unless game content files changed in the same task.
- Android release security gate: the command-line build enforces non-development release settings and runs `Tools/simulaid_android_release_security_audit.py --project-root /Users/yutu/Simulaid --apk <latest-apk> --strict`. If the audit fails, do not upload the APK; report the blocker.

## Required First Reads

1. Read `/Users/yutu/.codex/skills/simulaid-unity-maintenance/SKILL.md`.
2. Read `/Users/yutu/Simulaid/CODE_INDEX.md`.
3. If the task also asks to choose a non-QQ contact or resolve an ambiguous recipient for a separate notification, read `/Users/yutu/.codex/skills/personal-contacts/SKILL.md`.

## Build Workflow

1. Close the Tuanjie editor before building.
   - Check running processes with `pgrep -fl "Tuanjie.app/Contents/MacOS/Tuanjie|Unity.app/Contents/MacOS/Unity"`.
   - Gracefully quit Tuanjie/Unity editor if present. Do not close unrelated apps. Tuanjie Hub may remain open.
   - If an editor process refuses to exit and the user has requested this build workflow, terminate only the editor process, then continue.
2. Ensure the build directories exist:
   - `/Users/yutu/Documents/codexProjects/Simulaid/Builds`
   - `/Users/yutu/Documents/codexProjects/Simulaid/Builds/buildBackup`
3. Build with the command-line entry:

```sh
"/Applications/Tuanjie/Hub/Editor/2022.3.62t7/Tuanjie.app/Contents/MacOS/Tuanjie" \
  -batchmode -quit \
  -projectPath "/Users/yutu/Simulaid" \
  -executeMethod SimulaidCommandLineBuild.BuildAndroidApk \
  -logFile "/tmp/simulaid-build-$(date +%Y%m%d-%H%M%S).log"
```

The build script default output is the latest `Simulaid-{version}.apk` in the Build directory. Before creating the new latest APK, it moves previous root-level `Simulaid-*.apk` files into `buildBackup` and prunes backups to the newest 10. The build entry also patches the Android CVE scanner stub and then runs the strict Android release security audit; a failed audit blocks upload/delivery.

## iOS Boundary

iOS export, Xcode Archive, App Store Connect/TestFlight upload, Apple signing/profile checks, and Xcode Organizer operations are no longer part of this Android build skill. Use `/Users/yutu/.codex/skills/yuling/SKILL.md` (`玉灵`) for iOS packaging and upload.

If a user asks for iOS while this skill is active, do not improvise from old instructions; stop and switch to 玉灵 as a separate workflow.

## Downloads Cleanup

After a successful build, remove Simulaid build leftovers from `/Users/yutu/Downloads`:

- `Simulaid*.apk`
- `SimulaidBuild*.log`
- `SimulaidBuilds/`
- `Simulaid_BurstDebugInformation_DoNotShip/`

Do not delete unrelated files or `README_Simulaid.md`.

## Quark Netdisk Upload Policy

Use this when the user asks to upload the latest build through Quark Netdisk, 夸克网盘, or says the cloud package should notify followers about updates.

- Local build/archive packages remain versioned as `Simulaid-{version}.apk` in `/Users/yutu/Documents/codexProjects/Simulaid/Builds`.
- Open and operate Quark Netdisk through **夸克浏览器 / Quark Browser**. If using Computer Use, target the Quark Browser app/window for the upload flow.
- Before opening a new Quark Netdisk page/tab, check the existing Quark Browser state first. Reuse any already-open Quark Netdisk page (`pan.quark.cn`, `夸克网盘`, or a Quark file-list view) and navigate from that page to the target folder. If no usable Netdisk page is open, click the Quark Browser top-right Netdisk entry button beside the user avatar to open 夸克网盘; only type a URL/path or open a new page if that button is unavailable or blocked.
- Upload the latest versioned APK directly from `/Users/yutu/Documents/codexProjects/Simulaid/Builds`, for example `/Users/yutu/Documents/codexProjects/Simulaid/Builds/Simulaid-0.28.42.apk`.
- Upload it into the Quark Netdisk path `首页 > 文件 / Simulaid / Simulaid-apk/`.
- Path is strict: search may be used only to locate/open the cloud `Simulaid / Simulaid-apk` folder. If the page is still a search-results page or the breadcrumb does not prove the current folder is `/ Simulaid / Simulaid-apk`, stop and report instead of uploading to the wrong directory. Do not upload Android APKs into the cloud `Simulaid` parent folder, `Simulaid / Simulaid-PC`, `全部文件`, or any cloud `Builds`/`builds` folder.
- Do not copy or rename the package to `Simulaid.apk` for cloud upload.
- If Quark prompts about an existing same-version APK, do not overwrite, rename, or delete cloud files without fresh user confirmation; stop and report the duplicate.
- If Quark provides a description, remark, or version field during upload or file details editing, fill it with the game version and Android code, for example `v0.28.26 / Android code 2826`.
- If Quark has no visible metadata field, do not create a second metadata file just to show the version. Report the uploaded versioned filename and the local versioned archive path in the final response.
- Do not upload through QQ, Safari, Chrome, the default browser, or Finder sharing as a fallback. If Quark Browser upload is blocked by missing app, login, network, captcha, or permission, stop and report the blocker.
- Quark compliance/account banners are informational unless they actually stop upload controls, file selection, transfer, or final target-folder confirmation. Do not report banner text as an account ban by itself.

## QQ Sending Policy

QQ sending is not part of this workflow because the user wants to avoid QQ account-risk issues.

- Do not start `QQ`.
- Do not use Computer Use to attach APKs to QQ.
- Do not report that the APK was sent through QQ.
- If the user explicitly requests QQ sending in the same turn, first state that QQ sending is outside the normal workflow and risky; only proceed if the user confirms in plain language after that warning.

The normal completion path is: build locally, keep the latest APK in the Build directory, clean Downloads leftovers, and notify 玉兔/Feishu with the local APK path.

## Yutu / Feishu Completion Reminder

After the build succeeds, notify 玉兔/Feishu with a short completion reminder for the user through `/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/scripts/send_yutu_reminder.py`; the helper applies the `主人，前情提要：...` prefix. Example result text:

`Simulaid-{version}.apk 已经构建完成。包在 /Users/yutu/Documents/codexProjects/Simulaid/Builds/Simulaid-{version}.apk。`

Do not mention QQ in the Feishu/Yutu reminder. The reminder should focus on build status and the local package path. If this build is being run as part of `simulaid-optimize-build-deliver`, also include the optimization summary, estimated performance-impact percentages, and several next-improvement suggestions supplied by that workflow.

If the build succeeds but Feishu notification is blocked, still report the APK path in the final response. Do not claim the reminder was sent.

If the build fails, notify 玉兔/Feishu with the failure summary when possible and include the build log path.

Preferred local helper:

```sh
/Users/yutu/.hermes/hermes-agent/venv/bin/python \
  /Users/yutu/.codex/modules/hermes-yutu-voice-bridge/scripts/send_yutu_reminder.py \
  --context "刚刚在处理 Simulaid 构建" \
  "Simulaid-{version}.apk 已经构建完成。包在 /Users/yutu/Documents/codexProjects/Simulaid/Builds/Simulaid-{version}.apk。"
```

Do not print Feishu credentials or `.env` contents. If the reminder send fails, finish the build report and say the Yutu reminder was blocked.

## Verification

- Confirm the Tuanjie build command exits with code 0.
- Confirm the latest APK exists and has a nonzero size with `ls -lh`.
- Confirm `Tools/simulaid_android_release_security_audit.py --project-root /Users/yutu/Simulaid --apk <latest-apk> --strict` passes; if it fails, do not upload.
- Confirm `buildBackup` contains at most 10 APK files after the build.
- Confirm `/Users/yutu/Downloads` no longer contains Simulaid build APK/log/archive leftovers.
- For Quark uploads, confirm the local versioned APK exists, the upload target path is `首页 > 文件 / Simulaid / Simulaid-apk/`, the visible breadcrumb/current directory proves that exact folder, and the cloud filename remains versioned such as `Simulaid-{version}.apk`.
- For Quark uploads, confirm the upload was attempted through Quark Browser, confirm that existing Quark Netdisk pages/tabs were checked before opening any new page, and clearly report why Quark Browser could not complete the upload when blocked.
- Confirm QQ was intentionally skipped unless the user separately confirmed QQ sending after a risk warning.
- Confirm the Yutu/Feishu completion reminder returns `ok`, unless blocked by local messaging configuration.
