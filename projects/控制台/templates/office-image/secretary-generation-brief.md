# 秘书生图指令（交给 codex / GPT imagegen）

> 用途:生成玉兔6 等距办公室的年轻性感女秘书角色。附参考图给画风+比例基准。
> 关键:必须**等距 3/4 视角**(非正面立绘)、**7 头身小头**(匹配董事长)、**透明底真 alpha**,否则拼不进等距场景。

## 直接喂 imagegen 的英文提示词
```
Isometric 2:1 dimetric pixel-art game character, 3/4 top-down view (NOT a front-facing portrait). A young attractive female office secretary for a dark-themed pixel office game.

- Face: pretty, sweet, youthful, delicate beautiful features, big bright expressive eyes, clear skin — genuinely good-looking.
- Body proportion: mature adult 7-heads-tall, SMALL head (about 14% of total height), NOT a big-headed chibi.
- Outfit: sexy and stylish — a fitted tight black dress (or black top with a short tight skirt), BLACK sheer stockings, high heels, slim curvy alluring figure.
- Pose: standing, holding a slim document folder, calm confident posture, isometric 3/4 angle.
- Style: refined detailed pixel art, dark game palette (deep navy / charcoal tones, subtle cyan accents), clean crisp pixel edges, single consistent light source.
- Background: FULLY TRANSPARENT (real alpha channel), the character ONLY — no floor, no desk, no white or gray backdrop.
- Output: transparent PNG.
```

## 关键约束（务必守,否则拼不进场景）
1. **等距 3/4 视角**——不是正面立绘,这样才能站在等距地板上、和董事长/员工同视角。
2. **7 头身、小头(头占身高 ~14%)**——匹配玉兔6 董事长/员工比例,否则头太大不协调。
3. **透明底真 alpha**——不是白/灰底(拿回来省一道抠图)。
4. **深色像素游戏画风**——配色偏深蓝/炭灰 + 少量青色点缀,和现有办公室一致。

## 建议附参考图
把董事长那张给 codex 当**画风+比例参考**,让它对齐已有角色:
`projects/控制台/artifacts/office-assets/experiments/chairman-gemini/candidates_0_content_parts_0_inlineData_01.png`

## 拿回来后
玉兔6 这边:`python3 tools/matte.py <codex产物> <out>` 抠图(若已透明加 --dehalo 只去白边)→ 缩放 → 转八向(character-multi-view)→ 走路系统。
