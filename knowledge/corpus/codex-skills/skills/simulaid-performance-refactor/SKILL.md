---
name: simulaid-performance-refactor
description: Use when optimizing or refactoring /Users/yutu/Simulaid for runtime performance, smoother animation rendering, faster card/item archive scrolling, smoother talent horizontal dragging, or future-agent code navigation. Triggers include Simulaid 性能优化, 代码优化, 图鉴拖拽卡顿, 天赋拖拽卡顿, 动画渲染卡顿, and 智能体后续潜能向重构.
---

# Simulaid Performance Refactor

Use this project skill for focused Simulaid performance/refactor work. It complements `simulaid-unity-maintenance` and `simulaid-code-refactor-navigation`; read those first for versioning, compile, and CODE_INDEX rules.

## First Reads

1. `/Users/yutu/.codex/skills/simulaid-unity-maintenance/SKILL.md`
2. `/Users/yutu/.codex/skills/simulaid-code-refactor-navigation/SKILL.md`
3. `/Users/yutu/Simulaid/CODE_INDEX.md`

Avoid broad scans over `Library`, `Temp`, `Obj`, build folders, or package caches. Use `rg` against `Assets/Scripts/Simulaid`.

## Hot Paths

- Animation rendering: `Assets/Scripts/Simulaid/SimulaidGameUI.cs`
  - `SpriteSheetAnimator`
  - `RarityFlowEffect`
  - `RarityPerimeterMoteEffect`
  - `EpicStarEffect`
  - `MythicIndependentSparkEffect`
  - gacha and main-menu effects when the user names those pages
- Archive scrolling: `Assets/Scripts/Simulaid/Features/SimulaidGameUI.CollectionArchive.cs` and shared helpers in `SimulaidGameUI.UiKit.cs`
  - `FreezeStaticVerticalScrollContent`
  - `StaticVerticalScrollCuller`
  - `DisableNonInteractiveGraphicRaycasts`
- Talent dragging: `Assets/Scripts/Simulaid/Features/SimulaidGameUI.CollectionTalent.cs` plus `LoopingHorizontalScroll` and `StaticHorizontalScrollCuller`
- Companion animation: `Assets/Scripts/Simulaid/Features/SimulaidGameUI.Companion.cs`, but the sprite-sheet player lives in `SimulaidGameUI.cs`.

## Optimization Rules

- Keep behaviour stable. Prefer narrow helper refactors over feature rewrites.
- Reduce per-frame work first: cache derived sprites/data, skip unchanged transforms, throttle purely decorative effects, and keep offscreen rows disabled through static cullers.
- Do not throttle gameplay state, HP easing, typewriter text, button press feedback, or combat timing unless the user explicitly asks.
- Do not regenerate art for a code-only performance task unless an existing asset is invalid or missing.
- Static archive/talent lists should freeze layout after all children exist:
  - vertical lists: `FreezeStaticVerticalScrollContent(content)`
  - horizontal/talent rings: `FreezeStaticHorizontalScrollContent(content)`
- If adding new static long lists, disable non-interactive raycasts and attach the relevant culler before declaring drag performance improved.
- If adding new sprite-sheet animation, reuse `SpriteSheetAnimator`; keep frame count/grid explicit and avoid creating one sprite object per frame per UI rebuild.

## Documentation And Versioning

Every file-changing optimization must:

- bump the Simulaid version through `SimulaidVersionInfo`, `VersionHistoryEntries`, `ProjectSettings.asset`, and `README.md`;
- update `CODE_INDEX.md` when a helper, hot path, or future search hint changes;
- keep docs outside `Assets`.

Write version history in player-facing language only. Do not mention internal labels such as `一条龙`, skill updates, Codex/agent work, Feishu/Yutu reminders, compile/build status, or refactor process in `VersionHistoryEntries`. If an optimization is only developer tooling with no runtime/player-visible effect, do not bump the game version just to record it.

Use a patch bump for narrow performance tuning, minor bump for multi-module structural cleanup, and major bump only for broad architecture or save-breaking changes.

## Validation

Run the Tuanjie compile check from `simulaid-unity-maintenance`. Exit code 0 is pass even if the known Unity/Tuanjie SourceGenerator `CS8032` warnings appear.

When feasible, inspect the Game view with Computer Use for visible UI changes. Do not rely on Computer Use clicks/drags inside the embedded game for gameplay verification; use code reasoning, compile, and user-operated testing for interactions.
