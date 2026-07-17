---
name: yutu6-character-style
description: 玉兔6 所有人物角色(董事长/秘书/员工/访客)的统一画风基准与复制规范。任何时候用 meowa/gemini 生成或改动人物形象、把人物拼进场景、做人物动画前,都必须先读本 skill 锚定画风,否则每次生成/animate 重绘都会画风漂移(精致度不一、脸变样、头身比乱)——这是老板 2026-07-09 明确痛点("人物画风不统一,要把好看的这版固定下来批量复制")。含画风基准参考图 + prompt 模板 + 批量复制方法。
---

# 玉兔6 人物统一画风 skill

> **核心(生成任何人物前先默念):锚定"精致像素 · 韩系清秀 · 真实成人比例 · 深色游戏调色"。参考图必带,prompt 开头锚画风词,不让 AI 自由发挥脸和精致度。**
> 老板 2026-07-09 痛点:董事长 typing 版朴素、animate 后又变样、和秘书 B 版精致度对不上 → 角色间/同角色多版画风漂移。根因=每次生成/animate 各画各的,没有画风基准。本 skill 把"好看的那版画风"固化成可复制基准。

## 画风基准参考图(权威 · 新角色一律对齐这两张)
- **董事长**:`assets/style-chairman.png` —— 韩剧霸总,五官立体清秀、蓝灰眼、有型黑发、西装有布料质感。男性角色画风锚点。
- **秘书**:`assets/style-secretary.png` —— 瓜子脸波浪长发、精致性感、黑丝、7 头身。女性角色画风锚点 & 最清晰的画风代表。

这两张定义"玉兔6 标准人物画风"。**所有新角色的精致度/长相/比例/调色/光影必须和它们看起来是同一套画的**,不能各画各的。定稿后画风更好的新角色可加入 assets 扩充基准。

## 画风特征清单(6 条 · 生成时逐条对齐)
1. **精致像素艺术**:高精度、干净抗锯齿硬边、有细腻渐变和体积感。**不是**低分辨率大色块像素、**不是**矢量/扁平卡通插画。
2. **韩系精致长相**:清秀、五官立体分明、大眼有神、鼻梁高挺、皮肤干净——真的好看。男角帅气霸总,女角瓜子脸。**忌**五官糊、脸朴素平淡。
3. **真实成人比例**:7 头身、小头(站姿头占身高 ~14%,坐姿 24-26%),非大头 Q 版 chibi。
4. **深色游戏调色板**:炭灰/深蓝为基底,西装黑、皮肤自然暖、少量青(#6ea8fe)/暖(#f4c766)点缀。**忌**褪色发灰或过饱和艳丽。
5. **光影**:单一光源(左上)、柔和体积阴影、材质质感(西装布料/发丝/布料/皮肤都有立体高光),全体角色统一线宽和阴影方向。
6. **透明底**:真 alpha,单人物无场景。

## 生成 prompt 模板(锚画风)
开头**固定锚画风**,再接角色具体:
```
refined detailed pixel-art game character, Korean-drama good-looking face (sharp defined features, bright eyes, high nose bridge, clean skin), realistic mature 7-head-tall proportion with small head, dark game palette (charcoal / deep-navy base, natural warm skin, subtle cyan accents), soft volumetric shading from a single top-left light, clean crisp anti-aliased pixel edges, material texture on fabric and hair, transparent background.
<角色具体:性别 / 服装 / 姿势 / 朝向>
```
negative_prompt(**忌项一律进这里,不塞正面**):
```
low-resolution blocky pixels, vector or flat cartoon illustration, big-head chibi, washed-out or oversaturated colors, muddy undefined facial features, flat shading, plain dull face
```

## 批量复制画风的方法(核心)
1. **必带参考图**:女角 `--reference-image assets/style-secretary.png`、男角 `assets/style-chairman.png`;prompt 加 `match the art style, rendering detail, lighting and body proportion of the reference image`。
2. **保画风、换角色**(生成不同的新人):参考图给画风,prompt 描述新人物(不同脸/发/服装),强调 `same refined pixel-art style and proportion as reference, but a different person: <描述>`。这样新角色和基准同一画风、但是新的人。
3. **保形象、只改小细节**(同一角色微调):拿**该角色自己**当参考图,prompt 只写要改的点(见 [[meowa-office-art]] 铁律⑥——改比例/大改造才不能拿自己当参考)。
4. **animate 后必检查画风一致性**:animate 会**重绘**角色(董事长 f00 就比原图变样)——变样若在"更好看且仍像同一人"范围内可接受,若明显走形/精致度掉了→重做或换更小幅度的动作 prompt。画风漂移的帧不要用。
5. **人物拼进场景前**先过本 skill 确认画风,再按 [[yutu6-office-iso-pipeline]] 的 char_place(站姿身高 170)摆放。
6. **⚠️用现成资产拼装也要核画风(2026-07-10 血泪)**:不只生成新角色时读本 skill——**抓任何现成帧/立绘/动画拼装前,先确认它是画风基准版**(董事长=新精致版,**非**旧朴素 `chairman-final-typing/reading`;秘书=`secretary-portrait`)。省事直接抓现成资产是画风漂移的最大来源,别再犯。

## 与 meowa-office-art 的分工
- **本 skill** 管"人物长什么样"——画风、脸、精致度、头身比、调色、光影。
- **[[meowa-office-art]]** 管"怎么拼进等距场景"——2:1 投影、tile 128×64、char_place 摆放(170)、生成管线、审批。
生成人物时**两个一起用**:画风锚这里,等距/尺寸/流程锚 office-art。

## 弃用资产(严禁再用,2026-07-10 老板拍板)
- **`chairman-final-typing/` 和 `chairman-final-reading/` 帧序列 = 旧朴素画风,已弃用**。任何董事长场景/动画一律用**新画风**(参考 `assets/style-chairman.png` 精致霸总版,或 `chairman-handing-yellow` 那版董事长)重新生成,禁止再抓这两个旧帧序列拼动画。
- **血泪教训(2026-07-10)**:我建了本 skill 当天,就转头抓这两个旧朴素帧做董事长打字/看书动画,被老板逮到。根因=**固化了规范却没在"拼装现成资产"时读 skill 核对画风**——我把"用现成帧"错当成不算"生成人物",绕过了触发。死规则见批量复制方法第6条。
