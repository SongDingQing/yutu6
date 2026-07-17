# 洞察员冷热分离迁移报告

迁移时间:2026-06-24T10:08:16.129Z
临时快照:board/insights/.migration-snapshot-20260624T100816Z (校验通过后已删除)

## 范围
- 仅重排 `board/insights/` 内数据;未修改 `engine-runner.js`、`insight-scout-repos.js` 或洞察员 prompt。
- 本单交付结构前置条件;完整持续降本仍依赖后续 prompt/engine 子单。

## 前后体积
- insights.md:382671 -> 36732 bytes
- seen-repos.json:62423 -> 6832 bytes
- borrowed_libraries:76 条 -> references/borrowed-watch.json

## 批次对账
- 原始日期批次:41;热区:4;冷区:37;合计:41
- 原始 `##` 标题:49;热区:6;冷区:43;合计:49
- 原始 section hash 序列与迁移后冷+热 section hash 序列一致:true

## URL 对账
- insights 全量 URL 集合:before=119,after=119,missing=0,added=0
- seen-repos repos URL 集合:before=135,after=135,missing=0,added=0

## 抽样 hash
- #1 4746ca3f17f02e8a16689456d7f9b3fe4fb3b3dbd0bc9414315445d02fdf433f ## 2026-06-19
- #11 3049d05e2bd27b485bac6b93c4fedbab3c95d67f8912190bcf4ed146171edc05 ## 2026-06-21 · 第十批(选题:AI agent 工具与 skills / LLM 网关 — 能力分发 / 工具治理网关 / 模型语义路由;运行 ~04:0x)
- #21 8d146517f183fd18dc786c013a7dd9246c3d18857792a0e63844db3c06b44212 ## 2026-06-22 · 第二十批(选题:像素素材与画风 / 优秀网页设计 — 文本生成「带动作行」动画精灵表 / 精灵有限状态机+JSON / 控制台命令面板 cmd+k;运行 ~20:0x+08:00)
- #37 a450f12c98c16160b6495f2a3e2138f29b4577ae0cf7c4248ca2ced720899b0b ## 2026-06-24 · 第二十九批(选题:Unity / Simulaid — 像素办公室「仿真层」三段:目标导向行为决策(GOAP)/ 2D 俯视角寻路 / 多实体高性能 ECS;运行 ~08:0x+08:00,网络已恢复)
- #41 6ee7e6bbfb6d39cab21bfd7b28d14a812778a50679401b9d6823df7546677153 ## 2026-06-24 · 第三十一批(选题:多智能体编排 — 三例同主题成一谱:并行 agent 编队的「编排层」/ 确定性声明式 YAML 编排 + DAG 仪表盘 / 自我进化的 SDLC 编排「治理纪律」;运行 ~08:0x+08:00,网络已恢复,WebSearch+web_fetch 直读)

## 归档文件
- board/insights/references/archive-202606.md: dated=37, headings=43, bytes=346845

## 备份收敛
- insights root kept:2; moved:11
- seen-repos root kept:2; moved:6
- manifest:board/insights/references/backups/backup-manifest.json

## 验证结论
- PASS:批次数、标题数、section hash、URL 集、JSON parse、冷字段外移均通过。
