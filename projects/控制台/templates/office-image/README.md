# 玉兔6办公室 V3 可拼接素材模板

用途: 把办公室美术从整图改成可复用 tile set。所有后续生图必须先引用本目录的规格和 `artifacts/office-assets/v3-tileset/reference/v3-style-reference.png`, 再逐个生成独立透明素材。

## 核心规则

- 不再生成整张办公室图作为最终素材; 整图只允许作为 style reference / preview。
- 每个最终资产必须是独立 PNG/WebP, 透明背景, 四周留足 padding, 不裁边。
- 每个资产必须声明 footprint, sourceCanvas, anchor, zIndexBand。
- 普通工位 = 2x2 footprint; 桌椅电脑必须成套, 不分离漂浮。
- 董事长办公室 = 5x5 logical area, 由 floor/walls/props/desk 等组件拼装; 单个源图尽量 <= 256x256。
- 董事长主桌 = 2x3 footprint, 独立组件。
- 人物作为独立 overlay sprite, 不烘焙进桌子; working 动作只做手指细动。
- 所有元素遵守同一等距角度: tile diamond ratio 2:1, x/y pitch 固定。

## 文件

- `grid-spec.json`: 统一网格、源图尺寸、锚点和 z-order 约定。
- `asset-catalog.md`: 当前 V3 素材清单和生成顺序。
- `prompts.md`: 独立素材提示词模板。
- `validation.md`: 逐张验收和拼接验收门槛。

## 当前认可参考

- 风格基准: `projects/控制台/artifacts/office-assets/v3-tileset/reference/v3-style-reference.png`
- 画风: 精致高像素密度等距像素风, 深色控制台调色, 干净边缘, 同一光源。
