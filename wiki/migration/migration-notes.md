# 玉兔搬家 · 迁移要点(提炼)

> 提炼自 `新机迁移执行清单.md` + 迁移记录 08。完整机器侧步骤见 `projects/_迁移/机器侧清单.md`。
> 旧机用户名 `yutu`(路径 `/Users/yutu/...`),新机 `yutu6`(`/Users/yutu6/...`)。

## 换机不丢的积累(在哪 / 怎么启用)
- **Hermes 改版**(默认对话 runner):官方 `NousResearch/hermes-agent` + 5 文件 patch → `~/.hermes/hermes-agent`。
- **自定义能力**:旧机 `~/.codex/{skills(41), modules}`;**新机 .codex 是全新装,需从旧机/备份拷**。
- **项目仓库**:`SongDingQing/YuanXiao`、`SongDingQing/Simulaid`、Hermes fork;`SongDingQing/Starlaid`**硬排除**。
- **密钥**:桌面 `MacMini-Secrets-PRIVATE-2026-06-18/secrets.env`(只本机用,不进 git)。

## 当前新机状态(2026-06-18 由总管核查)
- ✅ 工作区四层骨架 + 控制平面 + 能力库 + 知识库脚手架已就位。
- ✅ 2 个核心能力模块已转入 `shared/capability_registry/modules/`。
- ⏳ `~/.hermes`、`~/Projects` 尚不存在(Hermes 未装、仓库未 clone)。
- ⏳ `~/.codex` 无自定义 skills/modules(全新装)。
- ⏳ `kb.sqlite` 未建(需 Mac 上 Ollama,跑 `knowledge/build.sh`)。

## 验证清单(08 §10.4)
Hermes 启动 · 飞书收发 · 播报后能再唤醒 · 忙碌时新消息进队列不打断 · Codex handoff 建任务回传 · YuanXiao 构建 APK · Simulaid 开 Unity/团结 · 自动研究继续硬排除 Starlaid。

## 相关实体
玉兔搬家 · Hermes · .codex · YuanXiao · Simulaid · Starlaid · 密钥 · kb.sqlite · 机器侧清单
