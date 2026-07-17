# Office Asset Curated Index

整理日期:2026-06-25

本目录只做素材分拣和复制,不移动/删除原素材。原始生成目录仍保留在 `public/office-demo-assets/` 与 `artifacts/office-assets/`。

## 分区规则

- `current-usable/`: 当前还可以继续用于拼接、试验或页面运行的素材。
- `old-reference/`: 旧风格、旧比例、旧动画、raw meowa 输出或早期参考素材。只用于回看和对照,不要作为新办公室默认素材入口。

## Current Usable

### `current-usable/v3-split-tiles/`

优先级最高。这里是 V3 拆分后的可拼接素材,符合“不要整张图,要独立 tile set”的方向。

- `alpha/office-v3-floor-carpet-1x1.png`: 1x1 地毯 tile,128x96。
- `alpha/office-v3-workstation-empty-2x2.png`: 2x2 普通工位,256x192。
- `alpha/office-v3-chairman-desk-2x3.png`: 2x3 董事长主桌,当前文件是 256x256,继续使用前需再次核对 2x3 网格比例。
- `alpha/office-v3-plant-1x1.png`: 1x1 绿植,128x96。
- `alpha/*-alpha-large.png`: 大图版,保留用于重采样/二次处理。
- `source/*-chromakey.png`: 抠透明前的源图。
- `reference/v3-style-reference.png`: V3 风格基准图。
- `validation/*`: 拼接冒烟图和验证报告。

使用建议:新素材/动画生成优先以 `reference/v3-style-reference.png` + `alpha/` 下同类素材作为参考,不要直接拿旧 meowa raw 图当基准。

### `current-usable/current-runtime/workspace/`

当前 `workspace.html` 仍在引用的运行素材。它们能让页面显示,但不等于最终审美通过。尤其人物坐姿/打字动画已经被指出粗糙,后续替换时不要把这里当最终风格标准。

### `current-usable/current-runtime/office-experiment/`

当前 `office-experiment.html` 使用的试验素材:

- `thick-solid-carpet-isometric-v3.png`: 当前实验页地毯 tile。
- `kdrama-chairman-ceo-v1.png`: 董事长韩剧霸总方向试验图。
- `executive-desk-v1.png`: 董事长桌试验图。
- `secretary-arrival-v1.webp`: 秘书动效试验图。

这些属于“当前可看/可试”的素材,但仍需要按 V3 网格规格继续重做和收敛。

## Old Reference

### `old-reference/floor-legacy/`

旧地板/地毯版本,包括 120x64 早期地块、solid-carpet v2、meowa raw 地毯。只用于比较质感和拼接问题。

### `old-reference/character-candidates/`

旧坐姿人物、v2 候选、秘书打字候选和 clean 版。用户已指出主要问题:粗糙、手部打字不自然、部分方向反、头身比例需调整。不要作为新角色默认模板。

### `old-reference/chairman-legacy/`

早期董事长/办公室/道具包。保留用于角色气质和办公室道具参考,但很多不是按整数 tile 网格生成,不能直接作为最终拼接素材。

### `old-reference/meowa-raw-previews/`

meowa raw preview,只用于追溯生成效果和提示词方向。

### `old-reference/vector-and-gen/`

早期 SVG/canvas/gen demo 参考,不作为最终像素办公室素材基准。

## 当前计数

- `current-usable`: 38 个文件。
- `old-reference`: 90 个文件。

## 后续默认入口

后续办公室素材任务优先从这里开始:

```text
/Users/yutu6/玉兔6工作区/projects/控制台/public/office-demo-assets/curated/current-usable/v3-split-tiles/
```

旧参考入口:

```text
/Users/yutu6/玉兔6工作区/projects/控制台/public/office-demo-assets/curated/old-reference/
```
