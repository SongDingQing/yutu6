# Simulaid 能力索引(多智能体项目)

> Simulaid 的技能集 + wrapper + 锁 + 交付目的地。源自旧机 `project-routes/Simulaid.md`,已 **repath 到新机**。
> 技能实体归档在 `knowledge/corpus/codex-skills/skills/`;安装到本机 Codex 见 `_迁移/转发给codex.txt`。
> 项目根:`~/TuanjieProjects/Simulaid`。标识:Simulaid / 模拟纪元 / Tail泰尔 / 黑莲 / 奖励卡 / 狗狗 / 主世界 / 模拟世界。

## 首读(canonical first reads · 已 repath)
- `~/TuanjieProjects/Simulaid/CODE_INDEX.md`
- `knowledge/corpus/codex-skills/skills/simulaid-unity-maintenance/SKILL.md`
- `~/TuanjieProjects/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md` · `SIMULAID_UI_LAYOUT_REVIEW.md` · `SIMULAID_OPTIMIZATION_NOTES.md` · `SIMULAID_TESTING_STRATEGY.md` · `SIMULAID_SAVE_COMPATIBILITY_INDEX.md` · `SIMULAID_DELIVERY_RISK_REVIEW.md` · `GameAgentBenchmark.md`
- 剧情/美术另读:`SIMULAID_STORY_BIBLE.md` · `SIMULAID_IMAGE_GENERATION_REQUIREMENTS.md`

## Simulaid 专属技能(13,已归档)
| 技能 | 作用 |
|---|---|
| `simulaid-command-expander`(玉猿) | **第一步**:把简略指令补成完整可执行命令,再路由到下游专家技能 |
| `simulaid-unity-maintenance` | 运行时/代码/构建/文档/版本工作的**强制基底**;先读 CODE_INDEX |
| `simulaid-architecture-guardian` | 反复 bug/架构审查/代码臃肿治理 |
| `simulaid-performance-refactor` · `simulaid-code-refactor-navigation` | 性能重构 / 重构导航 |
| `simulaid-pixel-art-assets` · `simulaid-animation-assets` | 像素美术 / 动画资产管线 |
| `simulaid-ui-regression-review` | UI 视觉回归审查 |
| `simulaid-optimize-build-deliver` · `simulaid-build-qq-delivery` | 优化-构建-交付 / 构建+QQ 交付 |
| `simulaid-taptap-release-gate` | TapTap 上架门禁 |
| `simulaid-marketing-planning-bridge` · `simulaid-studio-operating-model` | 营销策划桥 / 制作组运营模型 |

## 跨项目 wrapper(玉系列,Simulaid 支持)
玉猿(补齐)· 玉鼠 yushu(内容定义)· 玉豚 yutun(生图/补图)· 玉凤 yufeng(剧情一致性)· 玉虎 yuhu(bug 根因守门)· 玉衡 yuheng(测试门禁)· 玉鸡/金鸡 yuji(礼包码)· 玉龙 yulong(Android 优化/构建/夸克交付)· 玉灵 yuling(iOS 导出/Archive/App Store)· 玉玲珑 yulinglong(Android+iOS 合并)· 玉凰 yuhuang(TapTap/社区文案)· 黄龙 huanglong(玉龙+玉凰 合并)。

## 独占锁(project key = simulaid)
`unity-editor` / `android-build` / `quark-upload` / `ios-archive` / `appstore-upload` / `image-assets` / `story-docs` / `git-write`。玉玲珑交付期独占编辑器/构建/上传锁;子阶段不单独发飞书/语音。

## 交付目的地(已 repath)
- **Android**:本地 APK `~/Documents/codexProjects/Simulaid/Builds`;夸克 `Simulaid / Simulaid-apk`(直传带版本号 APK,不进 Builds 子目录、不改名 Simulaid.apk)。
- **iOS**:导出根 `~/SimulaidBuilds/iOS/Simulaid-{version}`;Archive 根 `~/SimulaidBuilds/iOSArchives`;Bundle `com.yutu.simulaid`;Team `HA6WZWUG6Q`;Profile `Simulaid App Store`。
- **PC**:夸克 `Simulaid / Simulaid-PC`。

## 验收 / 测试门(已 repath)
- 源/运行时/UI/存档/经济/数据有改 → 先 `玉衡`,再跑测试门:
  ```sh
  /Applications/Tuanjie/Hub/Editor/2022.3.62t7/Tuanjie.app/Contents/MacOS/Tuanjie -batchmode -quit \
    -projectPath ~/TuanjieProjects/Simulaid -executeMethod SimulaidTestRunner.RunAll -logFile /tmp/simulaid-tests.log
  ```
- 触存档/版本门控/迁移/经济 → 查 `SIMULAID_SAVE_COMPATIBILITY_INDEX.md`;未决兼容风险**阻断** 玉龙/黄龙/玉玲珑(除非用户显式接受)。
- 交付前更新 `SIMULAID_DELIVERY_RISK_REVIEW.md`;重大风险无测试/手测/回滚/接受则阻断交付。

## Git 交付策略
玉龙/玉玲珑/黄龙 成功验证后自动把 `~/TuanjieProjects/Simulaid` 推 Git:先取 `simulaid.git-write` 锁;**不 revert/reset/rebase/force-push/删未跟踪**;代码型失败态不推(除非用户看到阻塞后显式覆盖)。
