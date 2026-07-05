---
name: 嫦娥改装计划
description: Use when the user says 嫦娥改装计划, 嫦娥, 元宵, 汤圆, 煮元宵, 煮汤圆, asks to build/upload a Huawei-installable Android APK for communicating with Codex or Hermes/Yutu, or asks about the mobile control surface for messages, images, videos, files, selection cards, agent/task queues, artifacts, or progress bars. Read the local module first.
---

# 嫦娥改装计划

This is a user workflow skill for the private Android control plane that connects a Huawei phone to Hermes/Yutu, Codex, and future durable workers.

Before any implementation, deployment, release, upload, incident response, planning, or `煮元宵`/`煮汤圆` pass, use `yuanxiao-command-expander` first. Produce the `元宵指令补齐稿`, treat it as the working command, then continue with this skill's module-guided workflow. This also applies when editing supporting Yutu/Hermes/Legend bridge behavior, `.codex` skills/modules/helper scripts, workflow memory, reminders, queues, sessions, files, or notifications that affect YuanXiao/ChangE.

Start here:

`/Users/yutu/.codex/modules/chang-e-android-control-plane/INDEX.md`

Then read only the module files relevant to the task:

- `quick-context.md` for the current environment and recommendation.
- `architecture-proposal.md` for topology and role boundaries.
- `implementation-plan.md` for phased work.
- `io-contracts.md` for task, progress, decision-card, agent, and artifact schemas.
- `file-map.md` before creating or editing implementation repositories.
- `incident-response.md` when the user asks why a failure happened or what process gap caused it.
- `troubleshooting.md` when YuanXiao/ChangE feels slow, stuck, timed out, or has long-running tasks.
- `operations.md` for validation and smoke-test expectations.

Rules:

- Address the user as `主人`.
- Do not assume Google Play Services, FCM, or GMS on the Huawei phone.
- Do not expose Mac mini services directly to the public internet; prefer outbound tunnel or relay.
- Treat Hermes/Yutu as the front door and confirmation layer.
- Treat Codex as the chief reasoning and engineering worker.
- Compile the Android APK on the Mac mini by Codex. Do not make the Shanghai relay server the normal APK build host.
- Treat `汤圆` as synonymous with `元宵`, and `煮汤圆` as synonymous with `煮元宵`.
- Treat `煮元宵` as the user's shorthand for first doing a YuanXiao-wide optimization pass, then building/signature-verifying YuanXiao when needed, copying it to ChangE's app-release directory, smoke-checking `/api/v1/app-release` and APK download, enqueueing a ChangE inbox release downlink so YuanXiao can show an app-side update notice, syncing and committing the source/deployment monorepo, pushing it to GitHub, and sending a Feishu/Yutu completion reminder afterward. Quark upload is now fallback/manual backup only when ChangE self-update is not verified, the installed APK is too old to self-update, compatibility risk needs a backup package, or the user explicitly asks for Quark. Use the module's `yuanxiao-optimization-checklist.md`: think through broad optimization candidates, implement safe low-risk improvements in that pass, and record any useful deferred candidates with reasons.
- Treat any user request to upload a YuanXiao package to Quark as an explicit fallback/manual backup request: run the optimization pass, verify the APK, upload it to the existing `元宵` folder, sync/commit/push the GitHub repository, update delivery records, then send the Feishu/Yutu completion reminder.
- For small YuanXiao source/server/bridge edits between delivery builds, make a focused Git commit in `/Users/yutu/Projects/YuanXiao`; future `煮元宵` passes should include the accumulated commits in the normal GitHub push.
- When the user asks why YuanXiao/ChangE work is "running too long" or seems stuck, do not guess from chat history. First read the module troubleshooting guide, then check service health, bridge/tunnel health, the local task ledger, recent server/bridge logs, and current long-running processes. Distinguish a real stuck task from normal build/deploy/smoke-test time.
- When the user reports a YuanXiao/ChangE failure and asks why it happened, do an incident response, not just a workaround: state the symptom/impact, immediate technical cause, where the Codex/Yutu handling process failed, what durable skill/module memory or regression gate is being added, and what was verified. Read `incident-response.md` and `troubleshooting.md` before broad edits.
- If the symptom includes Android DNS failures such as `Unable to resolve host "a.example.com"`, treat it as an installed-APK compatibility incident. The request did not reach ChangE, so ChangE self-update may be unreachable from that installed package. Verify the latest safe fallback package or prepare a Quark fallback, and then apply the release-candidate gate so future APKs cannot carry the dangerous placeholder host.
- If the symptom includes `Codex session 后台请求失败` / `嫦娥后台处理这次请求时没有拿到回复`, treat it as a targeted-session control-plane incident before blaming network. Check ChangE `chat_async_*` logs, Mac mini bridge request logs, current `codex_session_id`, and whether the id is a protected/live Codex Desktop owner session. Protected owner sessions must auto-queue while recently active or inside the protected idle guard, but may direct-resume after the idle window; add or update regression coverage when changing this path.
- If the symptom includes "entered queue but should be queue 1", "many blocked tasks", or queued-message elapsed time stopping, treat it as a queue hygiene/control-plane incident. Read `incident-response.md`, back up the task ledger before cleanup, archive stale queue files instead of deleting them blindly, make YuanXiao display session-scoped queue positions while preserving global positions for ops, keep queued-message timers running, and add or update regression tests for queue position/order/task sorting.
- For YuanXiao large-file work, avoid pre-reading the entire file solely to compute a digest before upload. Prefer session -> chunk upload with per-chunk checksum -> whole-file digest accumulated during chunk streaming -> final ChangE verification. Smoke-test with small multi-chunk files before attempting near-limit files.
- For files sent from YuanXiao to 玉兔 or 传奇, also use the `yuanxiao-mobile-file-inbox` skill. New files must land in a findable Mac mini `元宵收件箱/<目标>/<日期>/` folder and the APK should show a safe `find_hint`.
- The GitHub repo must stay sanitized: do not commit real relay IPs/hosts, SSH usernames, key paths, Feishu ids, email contacts, local Mac paths, `.env`, `local.properties`, APKs, logs, caches, runtime state, or private `.codex/modules` docs verbatim. Commit public `.example` templates and sanitized repo docs instead. If private infrastructure details were pushed, rewrite the new repo history and force-push the sanitized state.
- Every release APK copied to ChangE or uploaded as a fallback must pass `/Users/yutu/Projects/YuanXiao/ops/scripts/verify_release_candidate.py`: signature, Android metadata, launcher label, dangerous placeholder-host scan, and, when deployed, app-release metadata/download SHA256. Treat this as the YuanXiao equivalent of a control-room evidence gate.
- For any YuanXiao Quark fallback delivery, upload new packages into the existing home/root-level `元宵` folder only. Do not create new Quark folders and do not use or create a `夸克上传文件` path for YuanXiao APK delivery.
- Name YuanXiao delivery APKs as `yuanxiao-<version>.apk`; do not add feature/debug descriptors to the final package name.
- Prefer native Kotlin + Jetpack Compose from the start; do not default to WebView/PWA.
- Do not claim precise current Codex Desktop session routing is reliable until a probe proves acknowledgement, timeout, and fallback behavior.
- Default interaction rule: do not stop by presenting a plan and asking whether to continue. Execute supported YuanXiao/ChangE work directly. If a real owner decision is required, use a Feishu approval card rather than chat confirmation. Approval-card cases include destructive deletion, credential/secret changes, public service exposure, paid or irreversible external actions, and untrusted external sends. ChangE self-update, GitHub push for YuanXiao delivery, release downlinks, and Feishu/Yutu completion reminders are preapproved parts of `煮元宵` / `煮汤圆`. Quark upload remains automatic only when the self-update chain is not verified, the installed APK is too old to self-update, compatibility risk needs a backup package, or the user explicitly asks for Quark. Still report any Quark upload afterward.
- Do not store or print secrets from `.env`, tokens, cookies, keys, or Feishu credentials.
- Feishu/Yutu reminders sent by Codex should use `/Users/yutu/.codex/modules/hermes-yutu-voice-bridge/scripts/send_yutu_reminder.py --context "<short context>" "<result>"`; the helper automatically adds `主人，前情提要：...`. Fall back to hand-written text only if the helper is unavailable.
