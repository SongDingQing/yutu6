# 办公室地块第一步验收与拼接方案

更新时间: 2026-06-20T12:48:29+08:00

## 结论

第一步只处理「薄短绒地毯地块」,未继续生成墙体、隔断、门、工位、家具或道具。

- 最终地块: `office-floor-carpet-tile-120x64.png`
- 拼接验证图: `office-floor-carpet-tile-stitch-preview.png`
- 机器可读参数: `office-floor-carpet-tile-metrics.json`

质量确认:

- 等距比例:顶面 footprint 为 `120x60px`,即 `2:1`。
- 厚度:画布 `120x64px`,可见薄边 `4px`,不是实心立方体/盒子。
- 风格:浅灰白短绒地毯,使用方案色值 `#e7eaf0` / `#d6dbe3`,整体明亮干净。
- 背景:透明 PNG,alpha 已清理。
- 拼接:5x5 预览内部无明显缝线,只保留外圈薄边。

## Meowa 生成记录

本轮按要求先调用共享 Meowa API,但两条直接生成路径均未直接交付:

- `workflow-hd_isometric_gen-53b206f3f37547aea129364b`: `hd-isometric-gen-run` 候选明显跑偏为厚实方块/盒子,违反「薄、几乎贴地、绝不要立方体」。
- `workflow-texture_gen-3fa8f3ae9f714a75a535783d`: `texture-gen-run` 生成了可平铺纹理,但出现明显黑色块状噪点,违反「浅灰白、干净、无明显重复」。

最终采用「按已确认样板和方案色值确定性重制」作为地块清洗方案:保留 Meowa 尝试记录,但不把跑偏输出接入正式资产。后续若继续用 Meowa,建议不要再用 `hd-isometric-gen` 的厚地块模板;地块类优先走可控 SVG/PNG 程序化生成,或先改 Meowa 模板到真实薄片 footprint。

## 拼接规则

坐标以每块图片的左上角为放置点:

```js
const TILE_W = 120;
const TILE_H = 64;
const FOOTPRINT_H = 60;
const STEP_X = TILE_W / 2;       // 60
const STEP_Y = FOOTPRINT_H / 2;  // 30

function tileTopLeft(originX, originY, i, j) {
  return {
    x: originX + (i - j) * STEP_X,
    y: originY + (i + j) * STEP_Y,
  };
}
```

锚点:

- 左上锚点: `[0, 0]`
- 顶面中心锚点: `[60, 30]`
- 南角/近端锚点: `[60, 60]`

相邻偏移:

- `i + 1` 方向: `(+60, +30)`
- `j + 1` 方向: `(-60, +30)`

绘制顺序:

1. 先按 `i + j` 从小到大绘制远处地块。
2. 近处/下方地块后画,覆盖远处地块的 `4px` 薄边。
3. 顶面不画深色描边,内部拼接不会露缝;只有整片地面的外轮廓保留薄边。

后续素材在这张地块确认 OK 前暂停。
