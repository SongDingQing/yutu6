---
name: 玉凰
description: "Use when the user says 玉凰, TapTap 文稿, TapTap 社区帖, 首发公告, 更新日志, 活动标题, 开发者帖子, or asks for Simulaid community/store/player-facing copy in the established sincere developer voice. Treat 玉凰 as a cross-project wrapper: first route through /Users/yutu/.codex/skills/project-routes/INDEX.md and the matching project route. The Simulaid route is currently implemented for TapTap/community/store copy."
---

# 玉凰

This is the user's short-name entry point for Simulaid TapTap/community/store copywriting.

Current workflow generation: `玉凰 2 号（Simulaid TapTap 文稿口吻锁 + 玉龙区间版本日志）`.

Creating or updating this skill is developer-side workflow memory. It does not bump the Simulaid game version by itself.

## Cross-Project Route Guard

This is a global wrapper name, not a Simulaid-only concept. Before applying the route below, read:

1. `/Users/yutu/.codex/skills/SKILL_ARCHITECTURE.md`
2. `/Users/yutu/.codex/skills/project-routes/INDEX.md`
3. The matching project route, for example `project-routes/Simulaid.md` or `project-routes/Starlaid.md`

If the selected project route does not explicitly support this wrapper, stop and report that the copywriting route is not configured. Do not reuse Simulaid marketing language for another game by analogy.

## Scope

When the user says `玉凰`, treat it as the Simulaid player-facing copy lane:

1. Load `/Users/yutu/.codex/skills/simulaid-marketing-planning-bridge/SKILL.md`.
2. Produce Chinese player-facing copy for TapTap/community/store use:
   - forum/community posts
   - first-launch announcements
   - update logs, including version-specific platform changelog copy such as `给我一个 1.0.62 的版本日志`
   - event titles and short activity copy
   - developer notes
   - store short descriptions
   - FAQ snippets
   - comment-area replies
3. Keep the work on the planning/copy side. Do not edit Unity/Tuanjie files, build packages, upload builds, or generate runtime assets from 玉凰 alone.
4. If the requested copy depends on unverified game behavior, read project docs first and label uncertain content as `建议/规划` instead of marketing it as already live.

## First Reads

1. `/Users/yutu/.codex/skills/SKILL_ARCHITECTURE.md`
2. `/Users/yutu/.codex/skills/project-routes/INDEX.md`
3. The matching project route
4. `/Users/yutu/.codex/skills/simulaid-marketing-planning-bridge/SKILL.md`
5. `/Users/yutu/.codex/modules/simulaid-marketing-planning-bridge/INDEX.md`
6. `/Users/yutu/.codex/modules/simulaid-marketing-planning-bridge/quick-context.md`
7. `/Users/yutu/.codex/modules/simulaid-marketing-planning-bridge/division-of-work.md`
8. `/Users/yutu/.codex/modules/simulaid-marketing-planning-bridge/handoff-contract.md`
9. `/Users/yutu/.codex/modules/simulaid-marketing-planning-bridge/release-version-ledger.md`

Then read only the project docs needed for the current copy task:

- `/Users/yutu/Simulaid/README.md`
- `/Users/yutu/Simulaid/DESIGN.md`
- `/Users/yutu/Simulaid/CODE_INDEX.md`

## TapTap Voice Lock

This is the user's persistent tone preference for TapTap/community copy:

- Default to Chinese.
- Sound like a real developer talking to players, not a publisher, ad agency, or corporate account.
- Warm, sincere, restrained, and human. Slight softness is welcome; empty hype is not.
- Prefer calm invitation over loud promotion. Let the text feel like it wants players to look around, discover details, and talk back.
- For menu/detail/easter-egg topics, lean into `小心思`, `细节`, `慢慢翻`, `欢迎大家发现` style language when it fits naturally.
- Use short paragraphs that are easy to paste into TapTap posts.
- Use `我` or `我们` naturally based on the context. Do not force a studio voice if a personal developer voice is stronger.
- End forum/community posts with an invitation to discover, reply, or give feedback when appropriate.

## What To Avoid

- Do not sound like a hard-sell ad.
- Do not use exaggerated game-marketing phrases such as `震撼来袭`, `史诗巨制`, `不容错过`, or similar empty hype unless the user explicitly asks for that style.
- Do not use too many exclamation marks or clickbait-style titles.
- Do not overpromise future content.
- Do not describe unconfirmed features as already implemented.
- Do not mention internal tools, AI, sessions, file paths, build details, or workflow jargon in player-facing copy.

## Output Shapes

- Activity/sign-in title: usually `4-8` Chinese characters unless the user asks otherwise.
- Forum/community post title: usually `10-20` Chinese characters, human and curiosity-led.
- First-launch announcement: one title plus `2-3` short paragraphs.
- Update log: usually `5-8` concise player-facing bullets, or one short paragraph if the user asks for prose. For a specific version number, first verify that version in `/Users/yutu/Simulaid/README.md` changelog and `VersionHistoryEntries`, then write player-safe copy only; omit internal tests, file paths, skills, delivery mechanics, hidden rewards, and exact gift-code details.
- Developer note/community reply: short, warm, direct, no bureaucracy.
- Store short description: one hook sentence plus one explanatory sentence or paragraph.

## Canonical Simulaid Version Log Format

For Simulaid player-facing version logs, keep the output format stable so the user can paste it directly into TapTap or a store console:

1. In chat, introduce the pasteable block with exactly `版本日志（可复制）：`.
2. Put the full player-facing log in one fenced `text` code block. The code block should contain only the copy the user should paste; do not include build paths, test names, skill names, Git hashes, upload status, or internal workflow notes inside it.
3. Prefer this structure inside the code block:

   ```text
   《模拟纪元 Simulaid》v{targetVersion} 更新说明

   这次主要是{一句自然的人话总结}。

   【{固定类别标题}】
   - {玩家能理解的一条改动}
   - {玩家能理解的一条改动}

   【{固定类别标题}】
   - {玩家能理解的一条改动}
   ```

4. Category headings use full-width brackets and a stable order. Include only categories that actually have player-visible changes:
   - `【战斗体验】`
   - `【角色与卡牌】`
   - `【农田与资源】`
   - `【伙伴与养成】`
   - `【界面与操作】`
   - `【存档与稳定性】`
   - `【其他调整】`
5. If there is only one small change, it is acceptable to use one category block, but still keep the title, short summary sentence, full-width category heading, and bullet style.
6. If the user says `包含上一次的版本日志`, `把上一次的版本日志也包进来`, `带着上一次的范围`, or similar, this means: merge the whole previous version-log range into the new target's single pasteable log. Do **not** add a middle title such as `上一次版本日志`, `本次新增`, or a second version heading. Combine the previous range and the new changes into the same category blocks under one `v{targetVersion}` title.
7. After generating a paste-ready Simulaid version log in a local desktop environment, also copy the exact code-block contents to the macOS clipboard with `pbcopy` when available, then say `已复制到剪贴板`. If clipboard copy fails, still provide the code block and report the clipboard blocker briefly.

## Version Log Range Discipline

When generating a Simulaid player-facing update log, do **not** summarize only the newest one-line patch by default.

1. Read `/Users/yutu/.codex/modules/simulaid-marketing-planning-bridge/release-version-ledger.md`.
2. Read the latest delivery/build history written by `玉龙` / `玉玲珑` in that ledger.
3. Choose the changelog range in this order:
   - If the user gives an explicit starting version such as `从 1.0.17 后`, use that as the baseline.
   - Else use the last `玉凰` public-version-log anchor recorded in the ledger.
   - Else use the previous `玉龙`/Android-delivery generated version before the current target version.
   - If no anchor exists, summarize the current version plus the nearest several recent README changelog entries that plausibly matter to players.
4. Summarize every player-visible entry in `(baseline, target]`, not just the target version. If many tiny versions happened between builds, merge them into the canonical category blocks from `Canonical Simulaid Version Log Format` instead of listing one heading per internal version.
5. Prefer including a little more context than too little, because the user may not upload/publish after every `玉龙` run.
6. After producing a version log, append a short record to the ledger with date, target version, baseline version, and the summarized range. Mark it as `draft/generated` unless the user explicitly says it has been posted or uploaded; only then mark/update the public anchor as `published`.
7. If the ledger conflicts with `/Users/yutu/Simulaid/README.md`, trust README/VersionHistoryEntries for actual game changes and note the ledger mismatch briefly.

## Fact Discipline

- Use `/Users/yutu/Simulaid/README.md`, `/Users/yutu/Simulaid/DESIGN.md`, and `/Users/yutu/Simulaid/CODE_INDEX.md` for confirmed features.
- Anything not confirmed there should be labeled as `建议/规划`, not sold as live content.
- If the user asks for copy that implies implementation changes, return an `Implementation handoff` using the contract from `simulaid-marketing-planning-bridge`.
