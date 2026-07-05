---
name: yuji
description: "Use when the user says 玉鸡, 金鸡, 发布新的兑换码, 查看现有兑换码, 兑换码清单, 礼包码 Excel, 礼包码图片, 7 天登录礼包, TapTap 礼包码, or asks to create/export/audit game gift codes and reward-code assets. Treat 玉鸡/金鸡 as a cross-project gift-code operations steward: route through project-routes first, then use the matching project's registry, runtime definitions, reward images, spreadsheets, and tests."
---

# 玉鸡 / 金鸡

玉鸡 is the user's cross-project gift-code operations steward. It handles existing-code lookup, new-code publication planning, reward-code registry hygiene, TapTap/平台礼包码 Excel exports, reward preview image creation, and validation that code rewards match runtime game definitions.

Use `玉鸡` and `金鸡` as the same skill name. If the user says either, load this skill.

## Cross-Project Route Guard

Before project-specific work, read:

1. `/Users/yutu/.codex/skills/SKILL_ARCHITECTURE.md`
2. `/Users/yutu/.codex/skills/project-routes/INDEX.md`
3. The matching project route, for example `/Users/yutu/.codex/skills/project-routes/Simulaid.md`.

Route by explicit project/path first, then current working directory. If no supported route exists, stop and report the missing route instead of borrowing another game's gift-code format.

Reading this skill is safe in parallel. Writing a game registry, source file, reward images, Excel deliverables, or shared route docs should follow the project's lock rules when the route requires them. Do not wait on another agent's live report; exchange files and concise status only.

Creating/updating this skill is developer workflow memory and does **not** bump any game version by itself. Editing runtime code, project registries, assets, or player-facing docs may require the target project's normal version/test workflow.

## Simulaid Route

Supported for `/Users/yutu/Simulaid` / Simulaid / 模拟纪元.

First reads for Simulaid gift-code work:

1. `/Users/yutu/Simulaid/GIFT_CODE_REGISTRY.md`
2. `/Users/yutu/Simulaid/Assets/Scripts/Simulaid/Features/SimulaidGameUI.GiftCodes.cs`
3. `/Users/yutu/Simulaid/SIMULAID_TESTING_STRATEGY.md`
4. `/Users/yutu/.codex/skills/simulaid-unity-maintenance/SKILL.md` if changing runtime files or project docs.

Helpful optional reads:

- `/Users/yutu/Simulaid/CODE_INDEX.md` for current gift-code/save/version rules.
- `/Users/yutu/Simulaid/Assets/Resources/GeneratedPixel/` for reward image source icons.
- `/Users/yutu/Simulaid/Packages/com.joesong.simulaid.tests/Editor/SimulaidTestRunner.cs` when changing rewards, validation, or expiry logic.

## Simulaid Responsibilities

### Viewing existing codes

When asked to list current codes:

1. Read `GIFT_CODE_REGISTRY.md`; do not rely on chat memory.
2. Cross-check runtime source only if the user asks whether codes are actually implemented or if registry/runtime consistency is uncertain.
3. Keep the answer concise. If the output is for public changelogs, do **not** reveal exact hidden codes or hidden reward spoilers unless the user explicitly asks to reveal them.

### Publishing new codes

For new Simulaid codes:

1. Generate random-looking uppercase A-Z codes.
   - Current allowed runtime format: 8-16 uppercase English letters.
   - Prefer 16 letters for public batches unless the user asks for shorter memorable codes.
   - Never use reward names, pinyin, English hints, project names, dates, or easy patterns.
2. Define each code's:
   - internal display name,
   - reward contents,
   - min/max version window,
   - date window or permanent date policy,
   - once-per-device redemption behavior,
   - whether it requires current archive, role selection, or item choice.
3. Update both runtime source and `GIFT_CODE_REGISTRY.md`; keep descriptions consistent.
4. If a code gives private-item carry counts, require the player to choose an already-owned/unlocked role when current Simulaid rules require it.
5. For stage/event codes valid through “2.0 包含 2.0”, use `maxVersion = 2.0.99` and say `v2.1.0 起自动失效`.
6. Add/update tests in `SimulaidTestRunner.cs` and run `SimulaidTestRunner.RunAll` when feasible.
7. Follow Simulaid version/docs sync when runtime or project docs changed.

### Excel exports

For TapTap/platform batches:

- Use `/Users/yutu/Downloads` unless the user gives another destination.
- Default one-file-per-day naming:
  - `simulaid_signin_day01_codes_4000.xlsx`
  - `simulaid_signin_day02_codes_4000.xlsx`
  - ...
- Default sheet name: `礼包码`.
- If the platform needs one code per row with no header, write column A rows `1..4000`.
- Do not paste full spreadsheet XML/logs into chat; report file paths and row counts only.

Bundled helper:

```sh
python3 /Users/yutu/.codex/skills/yuji/scripts/simulaid_gift_code_ops.py list \
  --registry /Users/yutu/Simulaid/GIFT_CODE_REGISTRY.md

python3 /Users/yutu/.codex/skills/yuji/scripts/simulaid_gift_code_ops.py export-excels \
  --registry /Users/yutu/Simulaid/GIFT_CODE_REGISTRY.md \
  --codes CODEA CODEB CODEC \
  --rows 4000 \
  --out-dir /Users/yutu/Downloads
```

For complex spreadsheets, use the spreadsheet tool/plugin, then verify row count without dumping workbook internals.

### Reward text format

When the user asks for platform reward strings, use the platform format they specified. For the current TapTap 7-day login style:

- Different rewards separated by Chinese dunhao `、`.
- Reward and quantity separated by `*`.
- Do not manually line break.
- Examples:
  - `金币*1000、原石*1`
  - `倚天剑*1、棉花种子*1`
  - `神话道具三选一*1`

### Reward images

For platform reward images:

1. Prefer existing official in-game icons under `/Users/yutu/Simulaid/Assets/Resources/GeneratedPixel/`.
2. For multi-reward days, composite the relevant icons into one image; include small count badges when useful.
3. Put platform deliverables in `/Users/yutu/Downloads` unless the user gives another folder.
4. Do not generate or inline base64. Use file paths only.
5. If an icon is missing, route to 玉豚 / the project art pipeline instead of shipping a low-quality placeholder.

Bundled helper for simple icon composites:

```sh
python3 /Users/yutu/.codex/skills/yuji/scripts/simulaid_gift_code_ops.py make-reward-image \
  --asset-root /Users/yutu/Simulaid/Assets/Resources/GeneratedPixel \
  --asset item_weapon_yitian_sword:1 \
  --asset seed_bag_cotton:1 \
  --output /Users/yutu/Downloads/simulaid_signin_day01.png
```

## Validation Checklist

Before reporting complete:

- Registry and runtime source agree on code strings, reward contents, version/date windows, and single-use behavior.
- Public/random code strings are not guessable.
- Runtime failure messages still follow the current Simulaid policy: parse failure says update version; failed validation says code does not exist.
- Excel files exist and have the requested row count.
- Reward images exist, are readable PNGs, and use real game icons or approved generated art.
- Tests were added/updated for any runtime behavior change, or a clear reason is reported if only export artifacts changed.
- Final answer includes changed files, output paths, tests, and any hidden/public-spoiler caution.

## Hard Stops

Stop and ask/report a blocker when:

- The user asks to publish codes for an unsupported project route.
- Reward definitions reference missing item/card/reward-card/role IDs.
- A code would expose hidden story/achievement content publicly without explicit permission.
- Runtime code must change but save/version/test impact is unclear.
- A platform requires account/API/upload credentials not already available.
