# 控制台办公室 tile 化重做方案

更新: 2026-06-23  
任务: `cr-1782180453789-1caf3f47` / `cr-1782180632986-131647e0`  
状态: Phase A 方案记录。后续二次返工任务 `cr-1782210015770-7774ef7e` 已授权进入执行,详见 `artifacts/office-tile-solid-carpet-20260623/solid-carpet-v2-evidence.md`。

执行附注 2026-06-23:
- 本轮二次返工只落地纯色地毯 floor tile,未创建新付费动画工程师岗位。
- 新 Meowa job: `workflow-hd_isometric_gen-e627ffb253c2452dbf3405de`;原始图未过纯色阈值,作为生成证据保留。
- 入库资产: `public/office-demo-assets/office-tile-library/solid-carpet-isometric-v2.png`,主色 `#87929B`,非透明像素精确主色占比 1.0,hash 与旧失败资产不同。
- 页面: `public/office-experiment.html` 移除旧 floor/meowa-floor/meowa-partition 运行引用,移除假“自验收已归档”文案。
- 截图自验:Peekaboo 截图 + `claude-opus-4-8` 复审已在证据目录中形成首轮 Fail、回炉、最终 Pass 链路。

## 0. 结论

本方案把当前办公室从“拼贴画面”改成可复用的等距地块系统。第一阶段只交付方案和接口证据;第二阶段经老板认可后,按小批量逐块生成、逐块验收。

关键决策:

- 采用 2:1 等距 tile 坐标系,当前显示基准沿用现有 `office-demo-assets` 的 `192x96` 地块。
- 所有部门片区都从同一个 `office_tile_library` 取地块,通过 map recipe 拼装,不再为每个部门做孤立大图。
- `董事长+桌子` 是独立 `2x2` footprint 地块,包含桌、椅、董事长动画槽位和派单动作锚点,不是把人物随手叠在背景上。
- Meowa 只在老板认可后使用;先 preset 搜索,再单块生成。初始 paid job 上限 12,单块最多 2 次 paid attempt,超限熔断。
- `skills-lock.json` 本轮实测存在且锁定 `game-assets`,当前本机不是硬阻断;但它必须纳入后续交付前置检查,防止跨 runner/重启后不可复现。
- Opus-4.8 runner 已用 shell dry-run 证实能调用共享 Meowa CLI;正式动画工程师岗位仍必须走 HR + 老板审批。

## 1. 已核实资产与风险更正

| 项 | 证据 | 结论 |
|---|---|---|
| 共享 Meowa CLI | `shared/tools/meowa/meowart_api.py` | 可用,是单一事实源 |
| `game-assets` skill | `.agents/skills/game-assets/SKILL.md` | 存在,薄 loader 指向共享 CLI |
| `skills-lock.json` | 根目录 `skills-lock.json` | JSON 合法,锁定 `game-assets` hash `c5db...10c` |
| 动态 skill doc | `skill-doc-status --check` | 版本 `2026.06.19.1`,缓存 fresh |
| Opus-4.8 调用共享 CLI | `artifacts/office-tile-redesign-20260623/skill-dry-run-report.md` | 已通过 help/status/dry-run |
| 现有办公室实现 | `public/workspace.html` | 当前仍是区域 DOM + tile 图片拼接,不是可复用 tile map schema |
| 现有视觉/动作样板 | `public/office-demo.html`, `tasks/办公室场景系统设计.md`, `memory/preferences.md` | 作为风格和动画序列来源 |

风险更正:

- 董事会称 `skills-lock.json` 缺失。当前工作区实测存在,所以不再是本机硬阻断。
- 影响面仍需写进方案:如果新 runner 或未来部署环境缺此文件,`game-assets` skill 版本不可核验,但共享 CLI 仍可直接调用。后续 HR/IT 创建动画工程师前必须复跑 `json.tool skills-lock.json` 和 `skill-doc-status --check`。
- brief 中提到的 `projects/控制台/董事长动画-demo.html` 与 `projects/控制台/玉兔6-协同设计分析.md` 本轮未按精确文件名命中;实际承接样板先以 `public/office-demo.html`、办公室任务文档和 `memory/preferences.md` 为准。如后续补回原文件,并入 style references。

## 2. Tile 架构

### 2.1 坐标与投影

显示基准:

```json
{
  "tile_w": 192,
  "tile_h": 96,
  "projection": "isometric_2_to_1",
  "origin": { "x": 0, "y": 0 },
  "layers": ["floor", "wall", "furniture", "actor", "fx", "label"]
}
```

网格到屏幕:

```text
screen_x = origin_x + (col - row) * tile_w / 2
screen_y = origin_y + (col + row) * tile_h / 2
z_index  = (row + col) * 100 + layer_rank
```

锚点:

- `1x1` 地块 pivot 为菱形底部中心。
- `2x2` 地块占用 `(row,col)`, `(row+1,col)`, `(row,col+1)`, `(row+1,col+1)`;pivot 为 footprint 底部中心。
- 角色/家具不再自由绝对定位到背景图,必须挂在地块 `anchor_points` 上。

### 2.2 地块库 schema

```json
{
  "tile_id": "floor_carpet_neutral_v1",
  "asset": "public/office-demo-assets/office-floor-seamless-isometric.png",
  "footprint": { "w": 1, "h": 1 },
  "tags": ["floor", "department:any", "light:top-left", "style:control-office-v1"],
  "edges": { "nw": "open", "ne": "open", "sw": "open", "se": "open" },
  "anchor_points": {
    "desk": { "x": 0.5, "y": 0.58, "layer": "furniture" },
    "actor": { "x": 0.5, "y": 0.42, "layer": "actor" }
  },
  "visual_contract": {
    "light": "top-left",
    "shadow": "down-right",
    "alpha_edge": "clean",
    "scale": "192x96_display"
  }
}
```

建议初始地块库:

| tile_id | footprint | 来源策略 | 复用范围 |
|---|---:|---|---|
| `floor_carpet_neutral_v1` | 1x1 | 先复用现有,不足再 Meowa | 所有部门 |
| `floor_carpet_accent_v1` | 1x1 | Meowa 单块 | 主管/项目片区强调位 |
| `wall_glass_window_v1` | 1x1 | Meowa 单块 | 总裁办/外墙 |
| `partition_glass_v1` | 1x1 | Meowa 单块 | 部门分隔 |
| `door_glass_v1` | 1x1 | Meowa 单块 | 入口 |
| `desk_workstation_v1` | 1x1 | Meowa 单块,无人物 | 通用工位 |
| `desk_supervisor_v1` | 1x1 | Meowa 单块,屏幕管理面板 | 主管/CEO |
| `chairman_desk_2x2_v1` | 2x2 | Meowa 特殊地块 | 董事长办公室 |

### 2.3 部门 map recipe

部门只声明地块坐标,不声明新背景图:

```json
{
  "department_id": "console_engineering",
  "origin": { "row": 0, "col": 0 },
  "tiles": [
    { "tile": "floor_carpet_neutral_v1", "row": 0, "col": 0 },
    { "tile": "floor_carpet_neutral_v1", "row": 0, "col": 1 },
    { "tile": "partition_glass_v1", "row": -1, "col": 0 },
    { "tile": "desk_workstation_v1", "row": 1, "col": 0, "bind_role": "worker_code" },
    { "tile": "desk_workstation_v1", "row": 1, "col": 1, "bind_role": "frontend_designer" }
  ]
}
```

最小复用验收样例:

- 用同一套 `floor_carpet_neutral_v1 + partition_glass_v1 + desk_workstation_v1` 拼 `系统办公室`。
- 用同一套地块拼 `HR/支援区` 或 `公共协作区`。
- 两个片区只能换 recipe 坐标和少量 accent tile,不得各自引入整张部门背景图。

## 3. 2x2 董事长地块

`chairman_desk_2x2_v1` 是一个独立 composite tile:

```json
{
  "tile_id": "chairman_desk_2x2_v1",
  "footprint": { "w": 2, "h": 2 },
  "contains": ["executive_desk", "executive_chair", "chairman_actor_slot", "document_slot"],
  "animation_slots": {
    "idle": "chairman-idle-compatible",
    "working": "chairman-working-compatible",
    "handoff": "chairman-handoff-compatible"
  },
  "anchor_points": {
    "chairman": { "x": 0.48, "y": 0.38, "layer": "actor" },
    "desk": { "x": 0.50, "y": 0.58, "layer": "furniture" },
    "secretary_pickup": { "x": 0.72, "y": 0.64, "layer": "fx" }
  }
}
```

验收重点:

- 董事长、椅子、桌子、文件槽位一起服务于同一个 `2x2` footprint。
- 不允许后期把董事长 PNG 用 CSS 随机居中叠到地块外。
- 必须能承接动画序列:董事长放指令稿 -> 秘书拿稿 -> 回工位打字 -> 邮件飞 CEO。

## 4. Meowa prompt 策略

### 4.1 命令选择

按 `game-assets` 当前指南:

1. 地图类先跑 `map-reference-search`。本轮 `modern office + hd_isometric_gen + 1x1` 搜索返回 0,后续可扩大到 `modern`, `clean_scifi`, `office floor`, `glass partition`。
2. 没有合适 preset 时,办公室高清等距地块优先 `hd-isometric-gen-run --template modern --mode standard --similar-tiles --tile-only`。
3. 若需要像素地块而不是 HD,用 `isometric-gen-run` / `pixel-isometric-gen-run`。
4. 角色/动画继续走 `pixel-gen-run`, `character-multi-view-run`, `animate-run`。动画工程师不得把地图地块误走通用 Gemini 入口。

### 4.2 通用 prompt 模板

```text
Modern bright control-plane office isometric 2:1 game tile, single reusable tile asset,
192x96 display footprint, top-left soft daylight, shadow down-right,
light gray-white low-pile carpet, clean glass partition, dark gray and warm wood furniture,
consistent with Yutu6 control office sample, crisp edges, transparent/open edge where possible,
no text, no logo, no watermark, no people unless explicitly requested,
no full-room background, no perspective mismatch, no random decorative clutter.
```

`chairman_desk_2x2_v1` 追加:

```text
2x2 isometric executive command tile, young chairman seated behind executive desk,
desk/chair/chairman integrated into one reusable map block, animation-friendly clear silhouette,
document handoff point on desk, matches existing chairman idle/handoff style reference,
premium but clean, no readable text, no extra people.
```

### 4.3 参考图

首选参考:

- `public/office-demo-assets/office-floor-seamless-isometric.png`
- `public/office-demo-assets/office-wall-seamless-isometric.png`
- `public/office-demo-assets/chairman/chairman-office-isometric-preview.png`
- `public/office-demo-assets/chairman/chairman-idle.webp`
- `public/office-demo.html` 截图或当前办公室截图

参考原则:

- 地块参考图用于比例和材质,不能让模型生成整张房间背景。
- 董事长参考图用于人物比例和姿态,不能让模型复制旧不连贯背景。

## 5. 成本护栏

老板认可前:

- 只允许 `skill-doc`, `skill-doc-status`, `--help`, `map-reference-search`, `--dry-run`, `credits-balance`。
- 禁止 `*-run` 真实提交生图/动画任务。

老板认可后第一批:

| 阶段 | 上限 |
|---|---:|
| 初始地块清单 | 最多 8 个 tile_id |
| 单个 tile paid attempt | 最多 2 次 |
| 第一批总 paid job | 最多 12 次 |
| 并发 | 1,必须串行 |
| 额度熔断 | 记录 before/after;Meowa 总消耗超过批准预算或试用余额低于预设阈值即停 |

每块生成后必须记录:

- prompt
- command
- job id
- output path
- credits before/after
- 视觉自检结果
- 是否进入 `office_tile_library`

## 6. 视觉连贯性自检清单

每个候选地块入库前必须逐项打勾:

- 光照:主光来自左上,阴影向右下,与相邻地块一致。
- 色温:地毯、玻璃、木色、深灰家具不偏成单一紫蓝/深蓝/棕橙主题。
- 颗粒度:像素/HD 清晰度一致,无一块糊、一块锐的割裂。
- 边缘 alpha:透明边无白边/黑边/毛边,PNG 放深色背景不露脏边。
- 比例尺:1x1 工位、2x2 董事长地块、角色高度与现有办公室一致。
- 投影:等距 2:1,无俯视/侧视/透视混入。
- 拼接:四边或开放边能与同类地块连续;连续铺 3x3 不出现缝。
- 内容:无文字、logo、水印、随机大摆件;角色只出现在特殊角色地块。
- 遮挡:按 z-order 地块 -> 家具 -> 角色 -> fx -> label,不得遮住关键工位。

## 7. 角色分工

| 角色 | 做什么 | 不做什么 |
|---|---|---|
| 架构师 | tile contract、坐标、schema、成本闸、验收逻辑链 | 不直接生图、不审批付费岗 |
| 设计师 | 风格样板、prompt 文案、参考图选择、视觉自检 | 不操作 key、不决定架构 schema |
| 动画工程师 | 通过共享 Meowa CLI/game-assets 生成地块与动画,记录 job 证据 | 未经 HR/老板审批不得启用 Opus 付费岗 |
| HR | 创建动画工程师 agent,写清 runner/read/write/budget 边界 | 不替 IT 做 skill 对接 |
| IT/Skills 工程师 | 复核 `skills-lock.json`、共享 CLI、runner tool access;必要时建 Skills 创建工程师 | 不批量生图 |
| 主管/CEO | review-loop、老板认可 gate、旧任务归并 | 不把方案草案当 done |

设计师与动画工程师边界:

- 设计师产出“应该长什么样”和“为什么这样生成”。
- 动画工程师产出“用哪个 Meowa 命令生成了什么文件,是否通过自检”。

## 8. Skill 对接与兜底

当前可走直接路径:

- `skills-lock.json` 存在并锁定 `game-assets`。
- `.agents/skills/game-assets` 存在。
- `shared/capability_registry/modules/meowa-game-assets/` 已登记共享能力。
- Opus-4.8 runner 已 dry-run 成功调用共享 CLI。

因此动画工程师的推荐接入方式是:

1. read_paths 加入:
   - `.agents/skills/game-assets/SKILL.md`
   - `shared/capability_registry/modules/meowa-game-assets/INDEX.md`
   - `shared/capability_registry/modules/meowa-game-assets/io-contracts.md`
   - `shared/tools/meowa/meowart_api.md`
2. 执行时只调用 `python3 shared/tools/meowa/meowart_api.py ...`。
3. 不复制 key,不在命令行传 key,只读统一本地 secret。

兜底路径:

| 触发条件 | 处理 |
|---|---|
| Opus runner 不能调用 shell | 先由 IT 改 runner 工具白名单或改用 Codex/Claude-tools 执行素材任务 |
| `game-assets` skill 不可加载 | 用共享 CLI + capability_registry 直接执行,同时由 Skills 创建工程师修 skill loader |
| `skills-lock.json` 缺失或 hash 漂移 | 停止新 agent onboarding,重新安装/锁定 `game-assets`,复跑 JSON/skill-doc 检查 |
| Meowa API 不通或需登录 | 停止,列清单交主人手动处理,不猜 key |
| 预算超限 | 停止本批,提交已生成地块和失败原因给老板拍板 |

## 9. 旧实验版归并

本任务取代旧办公室实验版重做链路 `0ccaf7b0 / 6472925b / f6d31223`。归并策略:

保留为参考:

- `public/office-experiment.html`: 作为 legacy preview,最终 tile 方案落地前不删除。
- `office-demo-assets/chairman-handoff/*`: 动画节奏/素材参考。
- `office-demo-assets/chairman/chairman-idle.webp`, `chairman-working.webp`: 2x2 地块动作参考。
- `artifacts/office-experiment-redo-20260623/quality-gate.md`: 验收反例与质量门禁参考。

迁移进新体系:

- 可复用 floor/wall/坐姿 sprite 进入 `office_tile_library` 或 `actor_sprite_library`。
- handoff 动画槽位迁到 `chairman_desk_2x2_v1.animation_slots`。

废弃为最终页面素材:

- 整张总裁办公室背景图、lounge/workzone 大贴图、无法拆成 tile 的实验图。
- 只为单页面存在的自由绝对定位拼贴坐标。

删除规则:

- 方案认可前不删除。
- 新 tile 页面通过老板验收后,旧实验版标记 deprecated 至少保留一个版本周期。
- 删除或归档必须列资产清单,不能只挪页签就宣称归并完成。

次要页签要求:

- 后续落地时把“办公室·实验版”入口放在 `办公室` 与 `工位` 之间。
- 当前 `workspace.html` 的 `vtab` 顺序是 `办公室 -> 工位 -> 链路图`,实验版仍在顶部 nav。落地验收需 grep/截图确认新顺序。

## 10. 落地阶段拆分

### Phase A: 老板认可前

- 本文档进入 review-loop。
- `skill-dry-run-report.md` 作为接口证据。
- 不改页面、不生图、不建付费岗。

### Phase B: 方案认可后

1. 新增 `office-tile-library.json` 与 `office-map-recipes.json`。
2. 用现有 floor/wall 先拼两个部门样例,验证坐标和 z-order。
3. Meowa 串行生成缺失 tile,一块一验。
4. 生成 `chairman_desk_2x2_v1`,只在该地块内接 handoff 动画槽。
5. 移动实验版入口到 `办公室` 与 `工位` 中间。
6. Playwright/Peekaboo 截图验收桌面和移动。

### Phase C: 最终替换

- `workspace.html` 办公室视图从区域 DOM 迁到 map recipe 渲染。
- 旧实验版转 legacy/deprecated。
- 主管 review-loop 通过后再进入系统 rollup。

## 11. 验收清单

- [ ] 方案已获老板明确认可,认可记录有来源。
- [ ] `skills-lock.json` 存在、JSON 合法、含 `game-assets`。
- [ ] Opus-4.8 或兜底 runner 能调用共享 Meowa CLI。
- [ ] 同一地块库拼出至少 2 个部门片区。
- [ ] `chairman_desk_2x2_v1` 占用 2x2 footprint,董事长和桌子不游离。
- [ ] 每个新 tile 通过视觉连贯性自检。
- [ ] Meowa paid job 未超过预算,每块有 before/after 记录。
- [ ] 旧实验版资产有保留/迁移/废弃清单。
- [ ] 实验版入口已位于 `办公室` 与 `工位` 之间。
- [ ] 控制台 review-loop 和相关前端回归通过。
