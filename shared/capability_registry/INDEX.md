# 能力注册表

本目录是玉兔6通用发行版的能力索引。先查注册表，再按需读取模块文档，避免每个智能体扫描整个工作区。

## 查找顺序

1. 读取 `registry.json`，按关键词定位模块。
2. 打开命中模块的 `INDEX.md`，再按其 `read_order` 读取必要文件。
3. 只有实施时才读取源码。

## 内置能力

| 模块 | 作用 |
|---|---|
| `multi-agent-collaboration-contract` | 智能体职责、能力和交接契约 |
| `instruction-expansion-router` | 前门指令补齐与项目路由 |
| `self-reflection-optimizer` | 自省、挑刺和案例沉淀 |
| `hermes-yutu-voice-bridge` | 可选语音与飞书桥接 |
| `meowa-game-assets` | 可选共享素材生成 |
| `peekaboo-desktop-control` | 可选桌面控制 runner |

## 项目边界

通用发行版不内置任何具体项目的 agent、skill、业务资料或发布流程。创建项目部门后，按 `project-packs/README.md` 安装项目能力包，并登记：

- `projects/<projectId>/department.json`
- `knowledge/corpus/codex-skills/skills/project-routes/<projectId>.md`
- 项目自有的 skill、测试、构建和回滚命令

系统路由优先级：显式能力 → 已安装项目包 → 通用 wrapper → 全局指令补齐器。每个任务只生成一份补齐稿。

## 安全规则

- 注册表只记录 KEY 名、来源契约和能力边界，不保存密钥值。
- 项目包不得修改系统部门；系统部门升级也不得携带项目私有内容。
- 新增或升级能力后必须更新 `registry.json` 和 `skills-manifest.md`。
