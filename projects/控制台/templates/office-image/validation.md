# V3 拼接素材验收

## 单张素材

- 文件名按 `office-v3-<asset-id>.<ext>`。
- 背景必须透明; 如果先出 chroma-key, 必须用本地脚本去底后再入库。
- 四角 alpha 为 0; 主体不贴边; 无裁边。
- 画布尺寸等于 `grid-spec.json` 的 source canvas。
- footprint 对齐: anchor 必须能落到等距网格坐标。
- 不允许把多个逻辑资产烘焙成不可拆整图。

## 拼接验收

- `floor-carpet-1x1` 复制铺 2x2/5x5 时边缘无缝。
- `workstation-empty-2x2` 放在 2x2 地块上不得缺角、遮挡异常或漂浮。
- `chairman-desk-2x3` 放在 5x5 董事长办公室内, 比普通工位大, 但不越界。
- 组件之间只能通过 anchor 网格定位, 不靠手动缩放修比例。
- 最终 UI 显示不得超过源图 1.15x; 超过就重设源图尺寸或拆分重做。

## 视觉验收

- Peekaboo 截图: `projects/控制台/artifacts/office-assets/v3-tileset/validation/`
- 识图核查点: 大小一致、可拼接、画风统一、无白边、屏幕方向正确、2x2/2x3/5x5 比例明确。
