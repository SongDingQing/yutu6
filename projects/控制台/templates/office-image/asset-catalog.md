# V3 素材清单

状态说明:

- `template`: 规格已定, 待生图。
- `generated`: 已生成独立源图。
- `alpha`: 已转透明背景。
- `validated`: 已拼接/截图验收。

| id | 名称 | footprint | source canvas | anchor | z-band | 状态 | 说明 |
|---|---|---:|---:|---:|---|---|---|
| floor-carpet-1x1 | 纯色厚地毯 tile | 1x1 | 128x96 | bottom-center | floor | validated | 最基础铺底块, 可横纵无缝重复; 输出见 `artifacts/office-assets/v3-tileset/alpha/office-v3-floor-carpet-1x1.png` |
| floor-edge-1x1 | 厚地毯边缘 tile | 1x1 | 128x96 | bottom-center | floor | template | 用于外轮廓, 保持厚度 |
| floor-corner-1x1 | 厚地毯角 tile | 1x1 | 128x96 | bottom-center | floor | template | 四角可旋转或单独出方向 |
| workstation-empty-2x2 | 普通空工位 | 2x2 | 256x192 | bottom-center | furniture | validated | 桌椅电脑成组, 屏幕方向正确; 输出见 `artifacts/office-assets/v3-tileset/alpha/office-v3-workstation-empty-2x2.png` |
| workstation-programmer-2x2 | 程序员工位 | 2x2 | 256x192 | bottom-center | furniture | template | 可用空工位 + 程序员人物叠加替代 |
| workstation-secretary-2x2 | 秘书工位 | 2x2 | 256x192 | bottom-center | furniture | template | 可用空工位 + 秘书人物叠加替代 |
| chairman-desk-2x3 | 董事长主桌 + 高背椅 | 2x3 | 256x256 | bottom-center | furniture | validated | 董事长办公室核心组件; 输出见 `artifacts/office-assets/v3-tileset/alpha/office-v3-chairman-desk-2x3.png` |
| chairman-floor-5x5-a | 董事长办公室地面块 A | 5x5-piece | 256x256 | bottom-center | floor | template | 5x5 区域拆分组件, 不单独代表完整办公室 |
| chairman-wall-window-3x1 | 落地窗墙段 | 3x1 | 256x160 | bottom-center | walls | template | 城市夜景窗, 可复用 |
| chairman-wall-shelf-3x1 | 书架/奖杯墙段 | 3x1 | 256x160 | bottom-center | walls | template | 可复用背景墙 |
| sofa-2x1 | 皮沙发 | 2x1 | 192x128 | bottom-center | furniture | template | 董事长办公室配件 |
| plant-1x1 | 绿植 | 1x1 | 128x96 | bottom-center | furniture | validated | 跨部门复用点缀; 输出见 `artifacts/office-assets/v3-tileset/alpha/office-v3-plant-1x1.png` |
| character-chairman-idle | 董事长 idle | 1x1 overlay | <=256x256 | feet-center | characters | template | 韩剧霸总风, 头身比收小 |
| character-secretary-idle | 秘书 idle | 1x1 overlay | <=256x256 | feet-center | characters | template | 职业装 |
| character-secretary-working | 秘书 typing | 1x1 overlay | <=256x256 | feet-center | characters | template | 手掌固定, 手指轻动 |
| character-ceo-idle | CEO idle | 1x1 overlay | <=256x256 | feet-center | characters | template | 人形 Q 版, 非兔子 |
| character-supervisor-idle | 主管 idle | 1x1 overlay | <=256x256 | feet-center | characters | template | 半正装 |
| character-worker-idle | 程序员 idle | 1x1 overlay | <=256x256 | feet-center | characters | template | 休闲工牌 |
| character-outsourcer-idle | 外包员工 idle | 1x1 overlay | <=256x256 | feet-center | characters | template | 轻便服饰 |
| character-edge-idle | 外围/专员 idle | 1x1 overlay | <=256x256 | feet-center | characters | template | 工具/耳麦/维修元素 |

## 生成顺序

1. `floor-carpet-1x1`
2. `workstation-empty-2x2`
3. `chairman-desk-2x3`
4. `plant-1x1`
5. 组装小 preview 验证拼接比例
6. 再按角色逐个生成人物和动画源图

本清单优先生成可拼接结构件, 再生成人物; 避免角色画风先跑偏。
