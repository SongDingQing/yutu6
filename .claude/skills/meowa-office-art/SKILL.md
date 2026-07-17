---
name: meowa-office-art
description: 用 meowa 生成玉兔6【等距(isometric)游戏化】办公室美术(等距地块tile/工位/董事长办公室/员工角色/坐姿·打字·行走·汇报循环动画)的强约束规范,锚定 grid-spec V3。当要用 meowa 生成任何办公室相关美术时必须遵循本 skill,防止生成偏离(平面插画/全景/裁边/注意力稀释)。
---

# meowa 等距办公室生图 skill

> **核心锚点(每次生成前先默念,防跑偏):等距 isometric 2:1 · 完整格子 footprint · 深色游戏化 · 透明底去白边。绝不出平面插画/全景照片。**
> 这条是老板 2026-07-07 的痛点:"每次生成都偏离想法"。根因=提示词发散、用了平面命令。本 skill 把约束锚死。

## 何时用
用 meowa 生成玉兔6 办公室视图的任何美术:等距地块 tile、工位、董事长办公室、员工角色、坐姿/打字/行走/汇报循环动画。工具:`python3 shared/tools/meowa/meowart_api.py <command>`。

## ⚠️ 生成 Bash 铁律(2026-07-08 反复踩,根因已定位,必守)
**根因**:Bash 默认 cwd = `projects/控制台`(**不是**工作区根!)。不 cd 时用相对 `projects/控制台/...` 会嵌套成 `控制台/projects/控制台/...` 错误路径,产物落错、find 空、白花额度(踩过 3 次)。
**必守**:① 开头 `cd /Users/yutu6/玉兔6工作区`;② `--output-dir` 用 `OUT="$PWD/projects/控制台/artifacts/..."`(cd 根后 $PWD=根);③ 生成后 `find "$OUT" -name "*.png"` 确认落盘。渲染/office-assemble 类脚本已习惯 cd 控制台,但 **meowa 生成一律 cd 根 + 绝对路径**。
④ **animate 的 `--prompt` 控制在 ~100 字符内**:meowa 拿完整 prompt 当子目录名,过长报 `File name too long` 无产物(2026-07-08 打字动画 prompt 太长踩过)。要表达"屏幕内容活动"用短句如 `code scrolling flickering on screens, screen active`。
⑤ **meowa animate 能做"屏幕内容活动"**(实证:prompt 写 screen scrolling/game moving,屏幕纹理会动)——员工干活=屏幕代码滚动、摸鱼=屏幕游戏动,不用透视贴屏那套重工程。
⑥ **改角色比例/大改造,不能拿它自己当参考图**(2026-07-08 秘书踩过):gemini img2img 会锁死参考图的构图/比例、只微调——想改头身比就把**目标比例的角色**(如董事长)当 `--reference-image`,prompt 写"same body proportion as reference, small head 14%",而非参考要改的角色自己。反之要**保持**形象只改小细节,才拿自己当参考。

## 铁律:防注意力稀释(最重要)
1. **提示词只写内容 + 核心约束放最前,不堆无效词**：
   - 每个 prompt **开头强制** `isometric 2:1 pixel tile,` / `isometric pixel character,`;主体一句话说清;**不写模板/服务端已隐含的**(如 "transparent background"——`optimize_prompt` 会自动补,你再写就是噪声)。
   - "不要什么" 一律进 `negative_prompt`,**绝不塞进正面**。
   - ❌ 稀释反例:一长串形容词 + 场景氛围 + "front view" → 出平面全景插画。
   - ✅ 正例:`"isometric 2:1 pixel workstation tile, 2x2 footprint, charcoal desk, monitor facing viewer, thick tile edge"`。
2. **命令必须走等距入口,绝不用 gemini 出平面**：地块=`isometric-gen-run`/`tileset-gen-run`;员工单帧=`pixel-gen-run`;员工八向=`character-multi-view-run`;动画=`animate-run`。地图先 `map-reference-search` 找 preset,命中就复用不重生。
3. **生成前**:`credits-balance` 查额度 → `office-image-template-check.js --spec` 过校验(templateId + referenceImage 须 owner 批准) → `--dry-run` 看计划不花钱。V3 参考图未批前**只跑 `experiments/` 下 `notForProduction` 小样**。
4. **生成后**:走元宵审批 `notify-yuanxiao-approval.js`(**缩略图 ≤200KB** 避免 ENOBUFS,采纳/不采纳),采纳才接入正式目录。

## 权威网格(grid-spec.json V3 · tile 尺寸已裁决 = 128×64)
- 投影 isometric **2:1**;**tile pitch x=64 y=32;视觉 128×64;厚度 14px**(裁决 2026-07-07:以 grid-spec 为准,废弃 image-granularity 的 192×126)。
- footprint 源画布:1×1→128×96 anchor(64,64);2×2→256×192 anchor(128,128);2×3→256×256 anchor(128,176);5×5 分件→256×256。
- z 分层:floor 0 · rug 10 · furniture 30 · characters 45 · walls 60 · overlays 80。
- 源图 ≤256px(超则拆件),bottom-center anchor,透明底 padding 16,**不裁边**,最终 UI 放大 ≤1.15×。

## 内容规范(memory/办公室生图设计规范.md V3)
- 地块:**有厚度立体**(非平面菱形)、分层渲染(先地毯后家具)、纯色 charcoal 地毯、与等距格子角度对齐、跨部门复用。
- 工位 = 完整 **2×2**(非 1×1 放大);董事长办公室 = 完整 **5×5**(主活动区 2×3);程序员屏幕朝向观察者。
- **头身比基准(2026-07-08 老板定,所有角色统一,以董事长/员工为准)**:**坐姿**头占坐姿全高 **24-26%**;**站姿**头占身高约 **14%(约 7 头身,成熟成人比例,非大头 Q 版)**。秘书/员工/访客等所有新角色必须匹配此比例,**不能各画各的**(踩过:秘书 v1-v5 头偏大、腿偏长与董事长不一致)。生图 prompt 必带"head ~14% standing height, 7-head-tall, not big-headed chibi"。角色一律精致像素**人类**(非兔),全体同光源/线宽/阴影方向。
- **站姿人物在场景中的渲染尺寸基准(2026-07-09 老板定版,固化)**:**站立人物身高 = 170px**(相对标准 tile 顶面 128×64,≈2.65 个 tile 高)。所有站姿角色(秘书/员工/访客)**一律用 `tools/char_place.py` 的 `place(scene, char, (i,j), ox, oy)` 摆放**——它自动裁 bbox、等比缩到 `PERSON_H=170`、脚底中心对齐格 diamond 底点。**禁止每次手调缩放系数**(老板痛点:"避免每一次都要我重新调接")。要整体改大小只改 `char_place.py` 里 `PERSON_H` 一处,全局同步。生图时人物原图**分辨率要足够大**(缩到 170 是降采样才清晰;若原图本就 <200 高,放大会糊,须重生成大图)。
- **角色朝向(2026-07-08)**:办公中角色**低头看屏/看物、专注工作,不抬头正脸看观察者**(不要摆拍式对视);打字时脸朝显示器。
- 董事长:韩剧霸总/清秀青年、黑正装、非写实非动物。
- 动画:打字 **finger-only**(手腕固定仅手指敲)、源图 **≤256×256**、去白边;帧数 typing 6-8 / handoff 6-12。
- 调色板:bg`#0f1117` panel`#151922` rug`#1b1f2a` line`#2b3140` cyan`#6ea8fe` green`#46d39a` violet`#8b7cf6` warm`#f4c766`。
- 通用 negative:full-scene illustration / cropped edges / white fringe / reversed monitor / floating furniture / huge chibi head / 1x1 faking 2x2。

## 生成管线(等距办公室 · 2026-07-08 老板定版分工)
**核心分工(2026-07-08 老板两轮拍板后定版):**
| 类别 | 走什么 | 原因 |
|---|---|---|
| 地板/地块 | **程序生成** `tools/gen_std_floor_tile.py` | 铺装必须像素级对齐,AI 地块斜率不标准拼不齐;程序=严格 128×64/斜率1:2 |
| 家具(桌/柜/沙发/椅/工位) | **AI 生成(meowa/gemini),精致优先** | 程序家具太丑(老板实评弃用);AI 斜率 0.33~0.64 与格线有轻微不平行,**老板确认可接受**("平行上差的也不多") |
| 大墙面/复杂整面 | **gemini-generate-content + 参考图** | meowa 单件≤256 放大糊;gemini 出 1024² 高清 |
| AI 家具挑选 | 多版生成挑最正(斜率参考值,越近 0.5 越好,偏差 ≤0.15 经验可接受);`tools/iso_check.py` 仅作参考读数,**审美一票优先** | 教训:为 5 度倾角牺牲精致度得不偿失 |

1. **家具 anchor**:AI 件接地点手工标定进 layout(或 OBJECT_ANCHOR 兜底);程序地板 anchor 固定。isofurn 库(tools/isofurn/)保留 core 作坐标参考,**不再产家具**。
2. **员工坐姿单帧**:gemini 参考桌子图生成"人坐桌后"整图(≤256²);**朝向低头看屏/物、不对视观察者**;头占坐姿 24-26%。
3. **人物动画标准四步(2026-07-08 老板定,顺序不可省)**:
   ① **静帧去背+去白边**:统一走 `python3 tools/matte.py <in> <out>`(封装 remove-background --is-white-bg 去底 + alpha腐蚀1px+近白清理去halo + 裁剪);**禁用** flood fill;再缩到 ≤256。
   ② **animate**:`animate-run --is-pixel`;打字=**finger-only**(prompt 写死 hands stay on keyboard, only fingers, body/head/desk steady),偶尔右手移鼠标。
   ③ **逐帧去白(必做,别漏)**:animate 帧会**重新带白 halo**——每帧过 `matte.dehalo()`(= `matte.py --dehalo`:alpha腐蚀1px+近白清理,参数已固化)。存透明帧序列 PNG。
   ④ **调帧率**:idle 类每帧 **130-160ms**(打字 130/看书 150);过慢(220+)显呆、过快(<100)抽搐;动作幅度大的(翻页)prompt 也要压小。
   - app 端:`--output-format spritesheet` 或用第③步存的帧序列 PNG(安卓 `AnimationDrawable` 直接吃)。
5. **状态→动画映射(老板 2026-07-08 采纳,员工生成标准规格)**:动画由真实状态驱动——引擎跑任务→播打字,空闲→播看书;**每员工配 2-3 个状态动画**,不随手单生成。
6. **员工八向**(行走):`character-multi-view-run --mode pixel`。
5. **拼装**:`tools/office-assemble.py`(标准 tile 128×64/pitch 64/32/两遍渲染:地板层永远在物件层之下),布局= layouts/*.json 格子数组。
6. **深度排序/叠加逻辑(2026-07-10 老板定,固化)**:`tools/iso_depth.py` 的 `composite(canvas, layers)` —— 所有会互相遮挡的元素(家具/盆栽/角色)按**接地点屏幕 y(baseline)升序**画:y 小=靠后=下层先画,y 大=靠前=上层后画(painter's / y-sort)。地板永远当背景 canvas 最底。**走动角色每帧按脚底 y 动态插入正确深度层**(秘书走到盆栽后被遮、走到盆栽前遮盆栽)。
   - **铁律:禁止把家具/盆栽预合成进 scene-bg 再固定图层顺序贴角色**——那样角色永远在最上、无法被前方物件遮挡(老板 2026-07-10 指出的病根:"盆栽应在桌子上方、秘书应在盆栽/桌子下方")。物件要独立 sprite + 各自 baseline 参与排序。
   - `layer(sprite,x,y,baseline=None)`:默认 baseline=贴放 y+内容底部;`盆栽 base > 桌 base` 则盆栽遮桌。大件(2×3 桌等)单 baseline 不精确、与角色在同深度带重叠出错时,按 footprint 拆成前/后两片各给 baseline。

## 已有可复用资产(别重生)
V3 alpha 已验收:`floor-carpet-1x1` / `workstation-empty-2x2` / `chairman-desk-2x3` / `plant-1x1`(在 `projects/控制台/artifacts/office-assets/v3-tileset/alpha/`)。缺:floor-edge/corner、墙(落地窗/书架)、程序员/秘书工位、9 个角色 sprite、员工多状态(行走/娱乐/汇报)动画。

## 关联文档库
`office-game-vision.md`(愿景 + 分期路线)、`office-layout-schema.md`(拼装地图格式)、`employee-animation-states.md`(员工动画状态机)。校验 `office-image-template-check.js`;审批走元宵 `notify-yuanxiao-approval.js`。
