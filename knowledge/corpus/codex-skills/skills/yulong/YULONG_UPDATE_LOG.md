# 玉龙更新记录

这份文档是玉龙自己的更新台账，用来记录玉龙工作流本身做过什么、升级到哪一号、为什么升级。它属于开发侧记忆，不写入 Simulaid 游戏版本预告或玩家可见版本历史。

## 维护规则

- 只要玉龙工作流、相关 skill、模块注册、飞书提醒格式、夸克上传策略、审查/优化/重构节奏发生变化，就更新这里。
- 记录要短，方便未来 Codex session 在运行玉龙前快速判断当前能力。
- 如果这次只是玉龙流程文档变化，不推进 Simulaid 游戏版本号。
- 如果玉龙运行时实际修改了游戏运行文件，则另按 `simulaid-unity-maintenance` 同步游戏版本、README、VersionHistoryEntries 和 ProjectSettings。

## 当前编号

### 玉龙 19 号：交付前风险审视

- 状态：当前使用中。
- 新增能力：玉龙、黄龙、玉灵、玉玲珑在构建/上传前必须更新 `/Users/yutu/Simulaid/SIMULAID_DELIVERY_RISK_REVIEW.md`，审视从上次相关交付到当前版本的高风险玩法、存档、UI、资源和平台交付变更。
- 安全边界：如果重大风险没有自动测试、存档兜底、手动验收点或主人明确接受，不能继续交付；最终飞书/本地报告必须写明 `交付风险审视` 结论和剩余警惕项。
- 编排边界：独立玉龙/黄龙各自执行一次风险审视；玉玲珑共享质量阶段只执行一次，子阶段不重复。

### 玉龙 18 号：交付后自动 Git 上传

- 状态：历史能力，已并入 19 号。
- 新增能力：独立玉龙在 Simulaid 源码验证/Android 构建通过后，默认获取 `simulaid.git-write` 锁，执行 `git add`、`git commit`、`git push`，并在飞书/最终报告里写明 commit 短哈希和 push 结果。
- 安全边界：不强推、不 rebase、不 reset、不回退/删除用户或其他 agent 的改动；如果源码/构建门禁失败，不把失败状态推到远端，除非主人明确覆盖。
- 编排边界：玉玲珑运行时由玉玲珑做唯一一次合并 Git 上传，玉龙子阶段只回传状态；黄龙继承玉龙上传，并在玉凰后做一次收尾 no-op/补提交检查。

### 玉龙 16 号：安卓交付记录供玉凰汇总区间版本日志

- 状态：历史能力，已并入 18 号。
- 新增能力：每次 Android APK 成功构建后，在 `/Users/yutu/.codex/modules/simulaid-marketing-planning-bridge/release-version-ledger.md` 追加交付版本记录。
- 目的：让 `玉凰` 生成 TapTap/玩家版本日志时按“上次已生成/已发布文案或上次 Android 交付版本 → 当前版本”的区间总结，避免只总结最新一个小补丁。
- 记录边界：只写版本、构建/上传状态和来源；不写本地 APK 路径、隐藏内容剧透或平台敏感信息。

### 玉龙 15 号：安卓直传 Simulaid/Simulaid-apk，PC 包走 Simulaid/Simulaid-PC

- 状态：历史能力，已并入 16 号。
- 主要能力：继承既有 Android 构建、夸克上传、飞书提醒、本地语音、UI/热门 bug 自查、资源验收、三轮优化和三轮重构。
- 路径纠正：安卓 APK 直接上传到云端 `首页 > 文件 / Simulaid / Simulaid-apk/` 子文件夹；打开该文件夹后应能直接看到版本化 APK 文件。
- PC 包规则：Windows PC 包固定上传到 `首页 > 文件 / Simulaid / Simulaid-PC/`，也直接放在这一层。
- 禁止项：安卓 APK 不上传到搜索结果、`全部文件`、`Simulaid` 父文件夹、`Simulaid / Simulaid-PC`、旧 `夸克上传文件 / SIMULAID`，也不在 `Simulaid-apk` 或 `Simulaid-PC` 下创建或使用云端 `Builds/builds` 子文件夹。
- 入口规则不变：优先复用已打开的夸克网盘页；没有可复用页面时，优先点击夸克浏览器右上角头像旁网盘入口；再不行才手动输入 URL/路径。

### 玉龙 14 号：安卓上传固定 Simulaid/apk（已废弃）

- 状态：历史能力，已被 15 号纠正。
- 说明：14 号曾记录为进入 apk 子层；15 号按主人最新纠正改为安卓 APK 直传云端 `Simulaid` 文件夹本身。

### 玉龙 13 号：安卓直传 Simulaid 根层（已废弃）

- 状态：历史试验，已被 15 号纠正。
- 说明：安卓直传 `Simulaid` 根层这点是对的；13/14 号期间关于 Windows 或 apk 子文件夹的命名已由 15 号统一为 `Simulaid-PC`。

### 玉龙 12 号：安卓上传改用 Simulaid 子目录（已废弃）

- 状态：历史能力，已并入 15 号。
- 说明：12 号期间关于 `Simulaid` 子层和旧路径的描述已废弃；当前以安卓直传 `Simulaid`、PC 包上传 `Simulaid / Simulaid-PC` 为准。

## 历史编号

### 玉龙 6 号：新增热门 bug 和 UI bug 自查

- 状态：历史能力，已并入 7 号。
- 主要能力：在三轮优化和三轮重构之前，先读取 bug 回归台账和 UI 常见问题清单，重点审查本轮变化区域。
- 输入文档：
  - `/Users/yutu/Simulaid/SIMULAID_BUG_REGRESSION_LOG.md`
  - `/Users/yutu/Simulaid/SIMULAID_UI_LAYOUT_REVIEW.md`
  - `/Users/yutu/.codex/skills/simulaid-ui-regression-review/SKILL.md`
- 输出要求：能安全修复的 UI / 热门 bug 先修；暂时不能修的写入 bug 台账，并在飞书里简短说明。
- 飞书要求：包含 UI 审查/修复摘要、三轮优化摘要、三轮重构摘要和各自收益预估；不发送本地 APK 路径。

### 玉龙 5 号：双重审查玉龙

- 状态：历史能力。
- 主要能力：三轮优化和三轮重构都带两次中间自评审。
- 节奏：优化 1 后自评审，优化 2 后自评审，再做优化 3；重构同理。
- 目的：避免连续改动时越改越偏，让每一轮都有收益、风险和是否继续的判断。

### 玉龙 4 号：单重审查玉龙

- 状态：历史能力。
- 主要能力：一条龙流程中加入单次自评审，开始把优化/重构结果和收益估计写入飞书。
- 目的：让打包前的优化不再只是“顺手改”，而是有一次明确的收益和风险检查。

### 玉龙 3 号：打包构建上传夸克 + 玉兔发声 + 飞书消息

- 状态：历史能力。
- 主要能力：完成打包构建，上传夸克网盘 Simulaid 文件夹，并通过玉兔语音和飞书消息提醒主人。
- 目的：把本地构建、云端分发和主人提醒串成稳定交付链路。

### 玉龙 2 号：打包构建上传

- 状态：历史能力。
- 主要能力：打包构建版本包并完成上传动作。
- 目的：从单纯上传扩展到可重复的构建交付。

### 玉龙 1 号：只有上传

- 状态：历史能力。
- 主要能力：只负责上传已有包。
- 目的：最早期的轻量交付入口。

## 最近更新

- 2026-05-18：升级为玉龙 19 号，新增交付前风险审视门禁。后续玉龙/黄龙/玉灵/玉玲珑必须在源码验证和平台构建/上传前更新 `SIMULAID_DELIVERY_RISK_REVIEW.md`，把上次交付以来的重大 gameplay/save/UI/resource/platform 风险和对应护栏写进交付报告；无护栏的重大风险阻止交付。

- 2026-05-15：撤销夸克“疑似封号提醒截图”专项观察任务。用户确认页面文案“严禁传播暴力恐怖、色情违法及侵犯他人合法权益的违法信息”只是夸克通用合规标语，不是账号封禁。后续玉龙不再为这类标语截图或打断上传；只有上传控件实际不可用、登录/验证码/权限阻塞、账号明确限制操作、或目标目录无法确认文件时，才作为普通夸克上传 blocker 汇报。若用户未来再次明确要求截图，再按新任务执行。

- 2026-05-14：更正 v1.3.9 夸克上传判断。用户指出没有收到违规提醒后，独立玉龙在正确目录 `Simulaid / Simulaid-apk` 重试点击上传，`Simulaid-1.3.9.apk` 成功完成扫描/上传并出现在文件列表。结论：页面残留“账号涉嫌违规已被封禁”文字不一定等于本次上传被阻断；后续必须以文件选择、扫描、上传任务和最终列表确认作为 blocker 判定依据。

- 2026-05-14：历史记录：曾完成用户后来补充的“一次性夸克账号状态截图”任务。2026-05-15 已由用户撤销后续专项观察/截图要求，保留此记录仅作历史背景，不再作为未来玉龙行动依据。

- 2026-05-14：历史记录：曾完成 2026-05-13 记录的一次性夸克账号状态截图任务。2026-05-15 已由用户撤销后续专项观察/截图要求；通用违规内容提示和疑似状态文案都不再触发截图任务，除非用户重新明确要求。

- 2026-05-13：升级为玉龙 16 号，新增 Android 交付版本 ledger，供玉凰跨多个小版本生成玩家可见版本日志。同步更新 `玉凰` 为 2 号，要求读 ledger 后按区间汇总，而不是默认只总结最新版本。

- 2026-05-13：固化夸克上传偏好：独立玉龙上传 APK 时优先通过 Computer Use 直接操作夸克浏览器；先看是否已有夸克网盘页，若没有则点击浏览器右上角用户头像旁边的网盘入口打开，只有入口不可用/阻塞时才退回手动输入或新页面。此规则是用户要求的后续持久偏好，不走 QQ、不换 Safari/Chrome、不优先研究 API。

- 2026-05-13：历史记录：当时曾记录一次性玉龙观察任务。2026-05-15 已撤销，不再执行“看到疑似封号就截图”的专项任务；玉龙只按真实上传成功/失败状态汇报。

- 2026-05-09：升级 `玉玲珑` 为 7 号，新增 Studio 优化台账规则：`/Users/yutu/Simulaid/SIMULAID_OPTIMIZATION_NOTES.md` 是唯一优化记忆文件；三轮优化/三轮重构前必须先查台账，之后必须更新台账，避免重复尝试已验证、已拒绝或禁止重复的优化点。

- 2026-05-06：升级为玉龙 15 号，修正夸克精确路径：安卓 APK 直接上传到 `首页 > 文件 / Simulaid / Simulaid-apk/`，Windows PC 包固定上传到 `首页 > 文件 / Simulaid / Simulaid-PC/`，两者都不使用云端 `Builds/builds` 子文件夹。

- 2026-05-06：历史记录：玉龙 14 号曾把安卓路径记为 apk 子层，后续已被 15 号纠正为直传云端 `Simulaid` 文件夹本身。

- 2026-05-06：历史记录：玉龙 12/13 号期间曾记录过 Simulaid 根层或同名子层理解；当前已由 15 号统一为安卓直传 `Simulaid / Simulaid-apk`、PC 包走 `Simulaid / Simulaid-PC`。

- 2026-05-05：补充夸克合规提示识别规则：页面上“请勿上传违法/暴力/色情等违规内容”的通用平台提示不等于账号封禁；只有上传被实际阻断、账号明确受限/封禁、登录/验证码/权限阻塞，或目标文件夹无法确认文件时，才把夸克上传报告为 blocker。

- 2026-05-04：升级 `玉玲珑` 为 3 号，修正聚合交付最终语音：无论安卓/iOS 哪一侧成功、失败或阻塞，最终本地玉兔语音都必须在同一句里同时提到安卓和 iOS 两个阶段；禁止在玉玲珑触发时退化成只播 iOS 或只播 Android。

- 2026-05-04：升级为玉龙 10 号，补充夸克上传页面复用规则：玉龙/玉玲珑上传 APK 前先检查夸克浏览器是否已有夸克网盘页面，能复用则复用并导航到 `夸克上传文件 / SIMULAID`（历史旧路径，12 号后改为 `Simulaid`），只有没有可用网盘页或复用受阻时才打开新页面。

- 2026-05-04：升级 `玉玲珑` 为 2 号，修正聚合交付时的语音去重：玉玲珑运行中，玉龙/玉灵子阶段只返回状态，不各自播报；发送飞书报告时用复制配置关闭本次 `feishu_send_voice_notice_enabled`，避免飞书发送提示音和最终玉玲珑语音重叠成“主人主人”。玉龙独立运行时仍保留自己的本地语音，但同脚本发送飞书+语音也建议禁用本次飞书发送提示音。

- 2026-05-03：修正夸克上传路径记忆：后续 APK 上传必须先进入 `夸克上传文件 / SIMULAID`（历史旧路径，12 号后改为 `Simulaid`） 子文件夹，不能从搜索结果页或上级目录直接上传；相关规则同步到 `玉龙`、`玉玲珑`、`simulaid-build-qq-delivery` 和 `simulaid-optimize-build-deliver`。

- 2026-05-03：新增聚合 skill `玉玲珑`（`/Users/yutu/.codex/skills/yulinglong/SKILL.md`），主人后续可用“玉玲珑”同时触发玉龙 + 玉灵；共享 UI 审查、资源验收、三轮优化和三轮重构，只在交付阶段拆分 Android/夸克与 iOS/TestFlight。

- 2026-05-03：升级为玉龙 9 号，将 iOS 导出/Archive/TestFlight 上传从玉龙拆出，新增独立 skill `玉灵`；玉龙保留 Android APK、夸克上传、飞书提醒、本地语音和三轮优化/重构。
- 2026-05-02：iOS 手动 App Store 分发签名上传成功，Archive `/Users/yutu/SimulaidBuilds/iOSArchives/Simulaid-0.32.35-20260502-234821.xcarchive` 使用 `Apple Distribution: Chengzuo Song (HA6WZWUG6Q)` 与 `Simulaid App Store` profile，Xcode Organizer 显示 `Simulaid 0.32.35 (3235) uploaded / Uploaded to Apple`。玉龙记录为可在主人同轮明确要求时执行的 iOS 上传路径；默认玉龙仍不自动上传 iOS。
- 2026-05-02：iOS TestFlight 上传试跑被 Xcode 签名阻塞：Xcode 当前可见 Team 为 `Chengzuo Song (Individual)`，但只有 Apple Development 证书、没有本地 provisioning profile，且 Xcode 报告没有可用于 `com.yutu.simulaid` 的 profile / 团队无设备可生成开发 profile。玉龙暂不把 iOS 上传纳入自动流程；后续必须先由主人完成 Apple Developer Team、证书、profile/设备或 App Store 分发签名配置，再继续 Archive / Upload。
- 2026-05-02：升级为玉龙 8 号，新增 iOS Xcode 工程导出/包信息报告；默认不上传 TestFlight，Apple 账号、证书、钥匙串、验证码和隐私/协议问题必须停下让主人处理。
- 2026-05-01：玉龙 7 号补充夸克上传规则，上传 APK 到夸克网盘时固定使用夸克浏览器；阻塞时报告，不静默切换到其他浏览器或 QQ。
- 2026-05-01：升级为玉龙 7 号，新增 Unity/Tuanjie 本地资源体积与性能验收；交付报告和飞书提醒必须列出压缩、Max Size、MipMap、Read/Write、Sprite Atlas、动画采样率、冗余关键帧、首包体积和运行时加载稳定性检查结果。
- 2026-04-30：升级为玉龙 6 号，新增热门 bug 和 UI bug 自查；新增 `SIMULAID_BUG_REGRESSION_LOG.md`、`SIMULAID_UI_LAYOUT_REVIEW.md` 和 `simulaid-ui-regression-review`。
- 2026-04-30：升级为玉龙 5 号，三轮优化/三轮重构各自加入两次中间自评审。
- 2026-04-29：玉龙入口接入非 QQ 的构建、夸克上传、飞书提醒和本地玉兔语音播报。

## 2026-05-09

- Promoted 玉龙 from a Simulaid-only mental model to a cross-project wrapper entry.
- Added route-guard rules pointing to `/Users/yutu/.codex/skills/project-routes/INDEX.md` and per-project routes.
- Simulaid remains the only fully configured 玉龙 delivery route for now; unsupported projects must stop instead of reusing Simulaid build/Quark rules.

- 2026-05-16：升级为玉龙 17 号，新增 Android 发布安全门禁。后续玉龙/黄龙在 APK 上传前必须保持 IL2CPP + ARM64-only、非 Development Build、关闭调试/符号、开启 Release minify/R8/ProGuard，并运行严格 APK 安全扫描；扫描失败即停止上传并汇报 blocker。
