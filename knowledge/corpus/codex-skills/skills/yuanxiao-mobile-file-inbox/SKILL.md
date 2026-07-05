---
name: yuanxiao-mobile-file-inbox
description: Use when the user asks about YuanXiao/元宵 phone file transfer, files sent to 玉兔 or 传奇, finding received mobile files on the Mac mini, 元宵收件箱, mobile-file storage paths, or fixing the Android-to-ChangE file inbox flow.
---

# YuanXiao Mobile File Inbox

This project skill covers the findable Mac mini inbox for files sent from the YuanXiao Android APK to 玉兔 or 传奇 through ChangE.

Read first:

`/Users/yutu/.codex/modules/chang-e-android-control-plane/INDEX.md`

Then read only the relevant module files:

- `quick-context.md` for current YuanXiao version and delivery status.
- `file-map.md` for project roots.
- `operations.md` for build/deploy/smoke commands.
- `troubleshooting.md` when the file path is missing, uploads are slow, or a transfer appears stuck.

Rules:

- New mobile files sent to `target=yutu` must be easy to find under the Mac mini YuanXiao inbox, grouped as `元宵收件箱/玉兔/YYYY-MM-DD/`.
- New mobile files sent to `target=legend` must be easy to find under `元宵收件箱/传奇/YYYY-MM-DD/`.
- The bridge should keep `玉兔-最新` and `传奇-最新` latest-folder links when the local filesystem supports symlinks.
- The bridge should append a compact `recent-files.jsonl` index for newly received files.
- Public HTTP responses must not expose private absolute Mac paths. Return a user-safe `find_hint`, such as `元宵收件箱/玉兔/2026-05-27`, plus relative inbox metadata.
- The APK should show the find hint in the success message after sending a document.
- For large files, keep the resumable session/chunk/complete protocol and compute whole-file SHA256 during chunk streaming, then let ChangE/Mac mini verify on completion.
- If this flow changes APK behavior, bump the YuanXiao version, build/signature-verify, deploy through ChangE self-update, smoke-test small-file and large-file upload, commit/push `/Users/yutu/Projects/YuanXiao`, and send the Feishu/Yutu reminder.
