---
name: simulaid-taptap-release-gate
description: Use when the user says TapTap 上架, taptap 上架, TapTap 交付, TapTap 审核, 上传 TapTap, TapTap 安装包, TapTap 报错, or asks for a Simulaid Android APK intended for TapTap review. Checks Simulaid's known TapTap blockers: CVE-2025-59489, 64-bit APK, parsed app name, package id, Android install compatibility, new-device startup crash risk, graphics API fallback, signing, zipalign, and version metadata.
---

# Simulaid TapTap Release Gate

## Start Here

Project root: `/Users/yutu/Simulaid`.

Read:

1. `/Users/yutu/.codex/modules/simulaid-taptap-release-gate/INDEX.md`
2. Relevant module reference files from its read order.
3. `/Users/yutu/Simulaid/CODE_INDEX.md` before broad project searches.
4. `/Users/yutu/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md` when TapTap reports a repeated issue.

## Required Gate

Before saying a TapTap package is ready, run the APK gate script on the built APK:

```bash
/Users/yutu/.codex/skills/simulaid-taptap-release-gate/scripts/check_taptap_apk_gate.py /Users/yutu/Documents/codexProjects/Simulaid/Builds/Simulaid-{version}.apk
```

If the expected version/code are known, pass them:

```bash
--expected-version 1.0.6 --expected-code 10006
```

## What Must Be Checked

- package id `com.JoeSong.Simulaid`
- app label `模拟纪元Simulaid`
- versionName/versionCode match current Simulaid version surfaces
- ARM64-only native libraries
- targetSdk 35 / minSdk 22 unless project policy changes
- OpenGLES3 is present; Vulkan feature is absent or at least never required
- `resources.arsc` is stored/uncompressed
- zipalign passes
- apksigner verify passes
- CVE-2025-59489 patch marker is applied
- live Tuanjie/IL2CPP native libraries were not broadly version-string rewritten

## Build / Upload Boundary

- For building/uploading to Quark, use existing 玉龙 workflow when requested.
- Do not upload to TapTap unless the user explicitly asks.
- Do not add third-party SDKs, ads, payments, login, encryption, or analytics for TapTap unless the user explicitly requests and approves.
- If TapTap reports crash/cannot enter without logs after this gate passes, request reviewer `logcat/tombstone` lines around `UnityPlayerActivity`, `libtuanjie.so`, `libil2cpp.so`, `EGL`, `vulkan`, and Java fatal exceptions.
