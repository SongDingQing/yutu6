# Meowa 办公室生成合约

## 适用范围

适用于玉兔6控制台办公室相关素材:

- 董事长、秘书、CEO、主管、员工、外包、外围角色
- 地毯地块、墙/隔断、2x2 普通工位、5x5 董事长办公室
- 坐姿 idle / working 动画、秘书交接动画

业务项目素材不在本系统办公室合约范围内;项目专属美术应由对应项目能力包管理。

## 生成前置

每个办公室生图任务必须包含:

- `templateId`: 来自 `image-granularity-templates.json`
- `referenceManifest`: `projects/控制台/templates/office-image/reference-manifest.json`
- `referenceImage`: `reference-manifest.json` 中 `ownerApproved=true` 的参考图
- `requirement`: 明确角色/地块内容、状态、输出格式
- `outputDir`: 绝对路径或工作区相对路径

唯一例外: `office.reference.sheet.v3` 可用于创建下一张参考图草案，但输出必须是 pending，不能直接作为 active baseline。

当前 V3 状态: `reference-v3-brief.md` 只是待确认输入稿。老板确认前不要调用 imagegen 或 Meowa，不要把 V2 参考图喂给 Meowa 批量生成正式素材。

受控实验例外: 为验证 Meowa 动画质量，可用 pending 参考图跑一次 `animation-smoke` 小样，但 spec 必须包含 `notForProduction=true`，输出目录必须在 `projects/控制台/artifacts/office-assets/experiments/` 下。实验小样不得覆盖 `public/office-demo-assets/` 的正式素材。

## V3 额外硬约束

- 普通桌面工位必须是完整 2x2 source tile，不能用 1x1 桌子放大。
- 董事长办公室必须是完整 5x5 integer grid component，主桌/老板椅/董事长主区域是清晰 2x3。
- 任何可拼接地块和工位都不能缺角、断边、裁掉 footprint；四周边界必须能与相邻格子贴合。
- 程序员屏幕必须朝向员工和观察者，不能反向。
- Meowa pixel animation 输入上限按 256x256 处理；如果显示尺寸更大，先重设源图策略，不直接放大。
- 动画透明边缘必须去白边，尤其是头发、手、肩膀、椅子。
- 打字动作用 finger-only: 手掌/手腕固定在键盘上，只做手指小幅交替敲击。

## 本地校验

```bash
node projects/控制台/tools/office-image-template-check.js --spec <generation-spec.json>
```

校验失败时不得调用 Meowa。常见失败:

- 未带模板 ID
- 参考图不存在
- 参考图未获老板确认
- 模板和 assetClass 不匹配
- 任务越出系统办公室或当前已授权项目范围

## Meowa 命令选择

- 人物单帧: `pixel-gen-run`，必须带 `--reference-file <approved-reference>`
- 角色多视图: `character-multi-view-run --reference-image <role-reference>`
- 坐姿 working / idle 动画: `animate-run`，基于已验收单帧
- 1x1 / 2x2 / 5x5 等距地块: 先 `map-reference-search`，再 `isometric-gen-run` 或 `hd-isometric-gen-run`
- 地形过渡: `tileset-gen-run`

所有命令都必须使用 `shared/tools/meowa/meowart_api.py`，不要复制私有 key，不要在命令行上传 key。

## 验收

每张素材逐张验收:

1. 文件存在，路径写入素材清单。
2. 与参考图比例、画风、调色一致。
3. 地块有厚度、能拼接、角度一致。
4. 人物坐姿不遮挡工位，working 动画能看到动作。
5. Peekaboo 截图留证；有视觉模型时再做识图核验。

参考图未获老板确认前，只允许交付模板、合约和参考草案，不允许批量重生正式角色。
