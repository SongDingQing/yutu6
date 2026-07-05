---
name: simulaid-code-refactor-navigation
description: Use when refactoring /Users/yutu/Simulaid to make future Codex searches, code edits, module discovery, or feature additions faster. Covers targeted rg patterns, partial-class split boundaries, CODE_INDEX upkeep, Unity compile checks, and version bump discipline.
---

# Simulaid Code Refactor Navigation

## Goal

Refactor Simulaid so future Codex sessions locate and modify the right code faster with less broad scanning.

## First Reads

1. Read `/Users/yutu/Simulaid/CODE_INDEX.md`.
2. Use `rg` with explicit paths. Avoid broad searches over `Library`, `Temp`, `Obj`, `Build`, and package caches.
3. Prefer these entry files:
   - `Assets/Scripts/Simulaid/Runtime/SimulaidVersionInfo.cs`: single code-side source for display version, bundle version, Android version code, and versioned APK filename.
   - `Assets/Scripts/Simulaid/SimulaidGameUI.cs`: constants, state fields, lifecycle, main shell.
   - `Assets/Scripts/Simulaid/Features/SimulaidGameUI.Definitions.cs`: crops, cards, enemies, gacha pools, talents, professions, difficulties, items, achievements, and definition indexes.
   - `Assets/Scripts/Simulaid/Features/SimulaidGameUI.UiKit.cs`: shared panels, buttons, text, rarity frames, modal helpers.
   - `Assets/Scripts/Simulaid/Features/SimulaidGameUI.FarmWorld.cs`: main-world farm, rest/day-night/weather.
   - `Assets/Scripts/Simulaid/Features/SimulaidGameUI.SimulationWorld.cs`: simulation run, enemies, hand, rewards, settlement.
   - `Assets/Scripts/Simulaid/Features/SimulaidGameUI.CollectionTalent.cs`: bag, archives, card/item detail, favorites, talents.
   - `Assets/Scripts/Simulaid/Features/SimulaidGameUI.Gacha.cs`: supply pages and draw popup.
   - `Assets/Scripts/Simulaid/Features/SimulaidGameUI.DataPersistence.cs`: save/load.

## Refactor Rules

- Split one bounded domain per turn. Keep behavior stable and compile after the move.
- Prefer extracting cohesive partial files over inventing abstractions.
- Good split targets: definitions, archive/detail rendering, simulation reward logic, simulation combat math, weather/rest summaries, gacha reveal effects.
- Do not move gameplay data and gameplay logic together unless the caller explicitly asks for a larger refactor.
- After moving code, update `CODE_INDEX.md` immediately with the new home and grep hints.
- If a new file is added under `Assets/Scripts/Simulaid/Features/`, keep the partial class name `SimulaidGameUI`.

## Version And Docs

Every file-changing Simulaid refactor must bump the project version. Use the Simulaid maintenance rule:
- patch for narrow cleanup,
- minor for structural/module-level cleanup,
- major for broad architecture rewrites or save-breaking work.

Sync `SimulaidVersionInfo`, the `GameVersion` alias, `VersionHistoryEntries`, `ProjectSettings.asset`, `README.md`, and changelog.

## Validation

Run the Unity/Tuanjie C# compile check when possible. Existing Tuanjie source generator analyzer warnings are acceptable if the compiler exits with code 0 and no CS errors.
