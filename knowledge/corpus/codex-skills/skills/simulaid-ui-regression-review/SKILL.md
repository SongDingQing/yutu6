---
name: simulaid-ui-regression-review
description: Use when reviewing or editing Simulaid UI/layout, when 玉龙 or 优化打包一条龙 needs a pre-optimization UI regression pass, or when repeated UI bugs should be checked against the Simulaid bug ledger and common UI layout rules. Focuses on changed areas, interactive hit targets/raycast chains, tutorial anchors, popups, image ratios, safe-area/short-screen/wide-screen layout, button/card chrome semantics, long-press popups, and combat/farm/talent/archive UI risks.
---

# Simulaid UI Regression Review

This skill is the durable UI review layer for `/Users/yutu/Simulaid`. Use it before broad optimization/build workflows and whenever a UI change touches layout, tutorial focus boxes, popups, images, long-press details, combat HUD, farm seed rings, talent rings, archives, title/new-game flow, or main-world headers.

## First Reads

Read only what is relevant, but start here:

1. `/Users/yutu/Simulaid/CODE_INDEX.md`
2. `/Users/yutu/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md`
3. `/Users/yutu/Simulaid/SIMULAID_UI_LAYOUT_REVIEW.md`
4. `/Users/yutu/.codex/skills/simulaid-unity-maintenance/SKILL.md`

If a layout, first-run flow, bottom tab, page entry, or tutorial-highlighted control moved, also read:

- `/Users/yutu/Simulaid/Assets/Scripts/Simulaid/Features/SimulaidGameUI.Tutorial.cs`

## Review Scope

Prefer a focused review of the changed area instead of a whole-game sweep.

1. Identify changed files and likely affected pages from the user request, `git diff --stat`, `git diff --name-only`, and `CODE_INDEX.md`.
2. Map each changed page to the common checklist in `SIMULAID_UI_LAYOUT_REVIEW.md`.
3. Check the bug ledger for repeated issue classes before inspecting code.
4. For every newly added or materially changed interactive UI control, require an interaction guard before delivery: either an automated `SimulaidTestRunner` assertion or an explicit manual/UI ledger item. The guard must cover Unity hit-test invariants, not only business callbacks: `Button.targetGraphic` exists and can receive raycasts, decorative images/text near it do not intercept, parent card/scroll surfaces do not sit above it, adjacent labels reserve non-overlapping `RectTransform` bounds, and the control remains reachable after page rebuilds. Direct `onClick.Invoke()` alone is not sufficient for new UI.
5. Fix feasible issues before the optimization passes when this skill is invoked by `玉龙`.
6. If a UI issue is real but too risky to fix during the current workflow, add or update an entry in `SIMULAID_BUG_REGRESSION_LOG.md` with status `deferred` and include it in the Yutu/Feishu reminder.

## Static Checks

Run targeted `rg`/diff checks instead of broad scans:

- Popups: new modal-style overlays should use `AddModalBackdrop()` and `AddModalPanel()` or call `ApplyPopupPanelChrome()` for special fixed surfaces.
- Button chrome: command controls use shared button helpers; card faces, status blocks, enemy/player cards, and item-like panels must not inherit command-button glow. Use `ApplyCardSurfaceButtonChrome()` for interactive card-like hit targets.
- Interaction hit tests: when a new or changed UI element is clickable/tappable/draggable, assert the real hit surface. Check `Selectable.targetGraphic`, `Graphic.raycastTarget`, sibling order, overlapping `RectTransform` bounds, `CanvasGroup.blocksRaycasts`, scroll/content cullers such as `DisableNonInteractiveGraphicRaycasts()`, and whether decorative child graphics should be raycast-disabled. Prefer code-level helper assertions over brittle screen coordinates, but do not count `Button.onClick.Invoke()` as proof of clickability.
- Tutorial anchors: if a highlighted UI moved, update actual RectTransform captures in `SimulaidGameUI.Tutorial.cs`; avoid fixed coordinates unless there is no runtime rect.
- Long-press details: popups must be opaque, top-layer, screen-clamped, finger-avoiding, and large enough to read on mobile.
- Images: frames must match asset aspect ratio when full art should be visible. Avoid black bars, side gaps, accidental stretching, or wrong-ratio long-press previews.
- Combat HUD: local refresh helpers may rebuild only safe subtrees; fall back to `ShowSimWorldRunPage()` during tutorials, reward pages, blocking popups, equipment-library changes, and victory/defeat transitions.
- Drag/hover conflict: dragging cards suppresses enemy long-press/hover detail and uses cursor/arrow hit logic instead of hidden finger position.
- Short/wide screens: check bottom action rows, new-game action buttons, status header, farm layout, and fixed-height popups against the 1080x2400 reference canvas and short/wide foldable constraints.
- Text: button labels should fit their controls, archive/detail rows should not overlap, and player-facing copy should avoid raw resource names or HTML/rich-text leakage.

## Bug Ledger Maintenance

Use `/Users/yutu/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md` as the canonical bug document from now on.

Update it when:

- a repeated UI/layout issue is found,
- a regression class receives a guardrail,
- a user-reported UI bug is fixed,
- a known issue is intentionally deferred.

Each entry should include:

- status: `watch`, `fixed`, `guarded`, or `deferred`
- affected area
- symptom
- likely cause
- guardrail or fix
- code/doc references
- verification performed or still needed

## 玉龙 Integration

When invoked as part of `玉龙` / `优化打包一条龙`:

1. Run this UI review before the three optimization attempts.
2. Focus first on areas changed since the last build or mentioned by the user.
3. Fix feasible UI regressions before optimization/refactor passes.
4. If this delivery added or changed any interactive UI, mention the interaction guard in the Yutu/Feishu reminder: what proves the tap/click target is reachable, which neighboring text/panel cannot collide, and whether the guard is automated or manual.
5. Include a concise UI review/fix line in the Yutu/Feishu reminder before the optimization/refactor summary.
6. Do not put APK local paths in the Feishu reminder.
7. Keep optimization/refactor descriptions brief; reserve detailed notes for local docs.

## Versioning

This skill and the project-side bug/UI review docs are developer-facing. Editing them alone does not bump the Simulaid game version and must not add player-facing `VersionHistoryEntries`.

If this review leads to real game/runtime file changes, follow `simulaid-unity-maintenance`: bump version, sync README, VersionHistoryEntries, ProjectSettings, and CODE_INDEX as appropriate, then compile.
