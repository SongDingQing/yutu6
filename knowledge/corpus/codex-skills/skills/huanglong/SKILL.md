---
name: 黄龙
description: "Use when the user says 黄龙, 黄龙上, 黄龙 上, or asks for the combined Simulaid Android delivery plus player-facing update-log workflow. Treat 黄龙 as a cross-project wrapper: first route through /Users/yutu/.codex/skills/project-routes/INDEX.md and the matching project route. The Simulaid route currently runs 玉龙 first, then 玉凰 using the just-recorded Android delivery as the target version baseline."
---

# 黄龙

黄龙 is the user's combined delivery-and-copy shortcut: **玉龙 + 玉凰**.

Creating or updating this skill is developer-side workflow memory. It does not bump the Simulaid game version by itself.

## Cross-Project Route Guard

This is a global wrapper name, not a Simulaid-only concept. Before applying a project-specific route, read:

1. `/Users/yutu/.codex/skills/SKILL_ARCHITECTURE.md`
2. `/Users/yutu/.codex/skills/project-routes/INDEX.md`
3. The matching project route, for example `/Users/yutu/.codex/skills/project-routes/Simulaid.md`

If the selected project route does not explicitly support `黄龙`, stop and report that the combo route is not configured. Do not borrow Simulaid delivery, Quark, or marketing rules for another game by analogy.

## Simulaid Route

For `/Users/yutu/Simulaid`, 黄龙 means:

1. Run `玉龙` as the Android/package delivery lane.
   - Follow `/Users/yutu/.codex/skills/yulong/SKILL.md`.
   - Build Android only.
   - Attempt Quark Browser upload to `Simulaid / Simulaid-apk`.
   - Append the Android delivery record to `/Users/yutu/.codex/modules/simulaid-marketing-planning-bridge/release-version-ledger.md`.
   - Inherit 玉龙 18 号 Git auto-upload behavior: after a successful standalone Android validation/build delivery, stage/commit/push the Simulaid repo changes under the `simulaid.git-write` lock, unless the source/build gate failed. Do not force-push or revert user/agent changes.
   - Inherit 玉龙 17 号 Android 发布安全门禁；如果 APK 安全扫描/Release hardening gate fails, stop before 玉凰 and report the blocker instead of drafting a shipped-version update log.
   - Inherit 玉龙 19 号 `交付风险审视`：before build/update-log, read and update `/Users/yutu/Simulaid/SIMULAID_DELIVERY_RISK_REVIEW.md`, covering changes since the last relevant delivery baseline and blocking 黄龙 if a major gameplay/save/UI/resource/build risk lacks a guard.
2. After the Android build step has either succeeded or clearly failed:
   - If build failed, do not draft a player-facing update log as if the version shipped; report the blocker.
   - If build succeeded, run `玉凰` for the target version that 玉龙 just built.
   - Follow `/Users/yutu/.codex/skills/yuhuang/SKILL.md`.
   - Read the release ledger so 玉凰 summarizes the full range since the last generated/published player-facing version log, not just the newest tiny patch.
   - Append a `draft/generated` 玉凰 record to the release ledger.
   - After 玉凰 finishes, run a final `/Users/yutu/Simulaid` Git status check. If 玉凰 or any late delivery step produced additional Simulaid repo changes that were not included in the 玉龙 commit, acquire `simulaid.git-write`, commit/push those remaining changes with a concise message such as `docs(simulaid): update v1.8.8 release notes`, and report the result. If there are no repo changes, report `Git: already pushed/no-op`.
3. Final reporting:
   - It is acceptable for 玉龙 to send its build/Quark/optimization Feishu reminder and local voice announcement.
   - 黄龙's final chat report must include the same player-facing update-log draft in the chat response, even if it was already sent to Feishu. Do not only say "已飞书发送"; the user expects to read and copy the version log directly from the final answer.
   - Put the update log near the end of the final answer under a clear heading such as `版本日志（可复制）`, preserving the polished player-facing wording from 玉凰 and hiding spoilers/internal workflow details per 玉凰 rules.
   - 黄龙's final chat report should include:
     - Android build result and APK filename/path for manual pickup,
     - Quark upload result,
     - Git commit/push result or Git blocker,
     - Android release security audit result,
     - 交付风险审视 result and any remaining watch items,
     - 玉凰 target version and baseline/range,
     - the full player-facing update-log draft in the final answer itself,
     - any blockers or residual risks.

## Boundaries

- 黄龙 does **not** run iOS/TestFlight/App Store Connect. Use `玉灵` or `玉玲珑` for iOS.
- 黄龙 does **not** send through QQ.
- 黄龙 does **not** generate runtime art/assets unless the underlying user request explicitly asks for asset work.
- 黄龙 should not duplicate the detailed 玉龙 and 玉凰 manuals; route to those skills and the Simulaid project route instead.
