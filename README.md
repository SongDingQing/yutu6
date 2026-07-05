# 玉兔6工作区

「多智能体 · 多模型」系统的**共享大脑**(文件即真相)。完整蓝图见 `shared/reference/多智能体架构设计.md`。

## 你(老板)只需要

- 动 `board/direction.md`(下方向)、看 `board/status-rollup.md`(看趋势)。其余不用管。
- 给总管的开场白:
  > 你是「总管」。先读 `shared/reference/多智能体架构设计.md` 和 `board/direction.md`,
  > 按四层组织 + 文件协议:把方向拆成项目写进 `projects/`,只在 `board/status-rollup.md` 给我趋势级汇总。

## 目录结构(谁该知道什么,写进文件夹)

```
玉兔6工作区/
├── board/                    # 你 ↔ 总管:只放趋势与决策
│   ├── direction.md          #   你下的方向
│   ├── status-rollup.md      #   总管给你的趋势(无细节)
│   └── decisions.md          #   待拍板 + 已决议
├── projects/<项目>/          # 主管的地盘
│   ├── brief.md  status.md   #   范围/验收 · 进展摘要
│   └── tasks/<任务>/         #   ★ tasks 嵌套在项目内(need-to-know),非顶层
│       ├── task.md result.md questions.md
│   └── artifacts/            #   真正的产物(跨模型共享文件)
├── shared/
│   ├── routing/              # ★ 控制平面:声明式路由 + runner 注册表 + 模型路由(零 token)
│   ├── capability_registry/  # ★ 能力目录:旧机 .codex 模块/skill 的新机槽位
│   ├── reference/            # 全局只读:蓝图 + 监管SOP + 误区库 + 失败案例库
│   └── glossary.md           # 统一术语
├── knowledge/                # 本地知识库(wiki 原文 → kb.sqlite 向量+全文+图谱)
│   ├── ingest.py query.py schema.sql build.sh
│   └── corpus/               #   原始冷档(迁移记录/快照),提炼进 wiki 才被嵌入
└── wiki/                     # 知识库原文真相(人可读可编辑的 Markdown)
```

## 三层 agent 看得到什么(强制 need-to-know)

- 你 → 只读 `board/`
- 总管 → `board/` + 各项目 `brief/status`(不读具体任务)
- 主管 → 自己项目全部 + `artifacts/`(不读别的项目)
- 员工 → 自己 `task.md` + 点名输入 + `shared/reference/`

## 控制平面与能力(本代新增)

- `shared/routing/`:模型路由(订阅→API→Ollama 兜底)、runner 注册表(**Hermes=默认对话 runner**、Codex=最强推理执行)、声明式流程图。
- `shared/capability_registry/`:旧机 `~/.codex` 的模块/skill 落到新机的目录;2 个核心模块已转入,其余待从旧机拷。

## 玉兔系列 · 版本沿革

- **玉兔2** 旧 Mac mini 上一代(退冷备/参照)· **玉兔3–5** 中间各代 · **玉兔6** 当前代(本工作区,新 Mac mini)。
- 升级方式:复制工作区、版本号 +1;旧代留作可回溯快照。**底层架构(四层 + 文件协议)不随版本变,变的是上面跑的能力。**

## 迁移状态

搬家进度与机器侧待办见 `projects/_迁移/`(由总管维护)。原始搬家包:`玉兔搬家部署包/`(纸箱,长期知识已抽进 knowledge/ 与 shared/ 后可归档)。
