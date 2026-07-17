# V3 Tile Set 首批验证报告

时间: 2026-06-23

## 参考基准

- V3 风格参考: `projects/控制台/artifacts/office-assets/v3-tileset/reference/v3-style-reference.png`
- 网格规格: `projects/控制台/templates/office-image/grid-spec.json`
- 素材清单: `projects/控制台/templates/office-image/asset-catalog.md`

## 已生成素材

| id | 最终文件 | 尺寸 | alpha 四角 | 结论 |
|---|---|---:|---|---|
| floor-carpet-1x1 | `alpha/office-v3-floor-carpet-1x1.png` | 128x96 | 0/0/0/0 | 通过 |
| workstation-empty-2x2 | `alpha/office-v3-workstation-empty-2x2.png` | 256x192 | 0/0/0/0 | 通过 |
| chairman-desk-2x3 | `alpha/office-v3-chairman-desk-2x3.png` | 256x256 | 0/0/0/0 | 通过 |
| plant-1x1 | `alpha/office-v3-plant-1x1.png` | 128x96 | 0/0/0/0 | 通过 |

## 拼接验证

- 预览图: `projects/控制台/artifacts/office-assets/v3-tileset/assembled/v3-tileset-smoke.png`
- Peekaboo 截图: `projects/控制台/artifacts/office-assets/v3-tileset/validation/peekaboo-v3-tileset-smoke.png`
- 验证内容:
  - `floor-carpet-1x1` 可按等距网格铺成 5x5 区域。
  - `chairman-desk-2x3` 作为独立家具叠加到 5x5 区域内, 未烘焙成整间办公室。
  - `workstation-empty-2x2` 是独立工位模块, 未依赖整图。
  - `plant-1x1` 是独立装饰件, 可放到任意格子。

## 当前限制

- 本轮只生成首批结构件, 用于验证 tile set 流程和比例。墙段、沙发、角色、动画源图仍在 `asset-catalog.md` 中保持 `template` 状态。
- 董事长办公室 5x5 的完整房间还需要继续生成墙段 / 落地窗 / 书架 / 沙发等独立组件后再组装。
