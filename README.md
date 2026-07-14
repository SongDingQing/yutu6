# 玉兔6 · 通用多智能体工作区

「多智能体 · 多模型」系统的共享大脑(文件即真相)。公共仓库只包含通用系统部门；具体游戏、公司或业务线能力通过项目部门和独立项目能力包接入。

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

- `shared/routing/`:模型路由(本机 CLI→API→可选本地模型)、runner 注册表和声明式流程图。
- `shared/capability_registry/`:通用能力目录;项目能力包安装后也从这里被各 agent 发现。

## 内置部门与项目部门

系统内置总裁办公室、董事会、质量与监管部、系统运营部、维修部和人力资源部，权威清单在 `shared/organization/system-departments.json`。

业务项目不写死在系统核心。新建一个项目时会同时创建独立项目部门、项目主管身份和 `supervisor-<projectId>` 队列：

```bash
node projects/控制台/tools/project-department.js create \
  --id website \
  --name "官网项目" \
  --description "完成官网建设和持续运营"
```

项目专属 agent、skill 和知识应放在独立项目能力包中，约定见 `project-packs/README.md`。

## 新 Mac 一键部署

前置条件:

- macOS，且已完成 `xcode-select --install`（提供 Git）。
- 当前用户已配置该仓库的 GitHub SSH 访问；部署脚本不会读取、复制或提示输入凭据。
- 已安装 Node.js 20+；如果缺少 Node.js 但已有 Homebrew，脚本会自动执行 `brew install node`。

在新机终端执行一条命令:

```bash
git clone --branch main --single-branch git@github.com:SongDingQing/yutu6.git "$HOME/玉兔6工作区" && "$HOME/玉兔6工作区/deploy-macos.sh"
```

脚本会启用仓库 Git hooks、启动本地控制台并打开首次配置向导。向导依次检测 Codex/可选 Claude CLI 登录态，并允许连接智谱 Coding Plan、MiniMax、DeepSeek 或其他 OpenAI 兼容接口。API key 只写入本机 `~/.config/yutu6/providers.env`(权限 600)，不会写入 Git、日志或网页回显。

至少一个执行 CLI 和一个 API 模型检测通过后，向导才开放工作区。脚本可以安全重复执行；如果目标是脏工作树、非空的非仓库目录或不可识别的仓库，会直接失败且不覆盖内容。先只看执行计划:

```bash
"$HOME/玉兔6工作区/deploy-macos.sh" --dry-run
```

只部署、不自动启动:

```bash
"$HOME/玉兔6工作区/deploy-macos.sh" --no-start
```

常见失败处理:

- `缺少 Git`:运行 `xcode-select --install`，安装完成后重新执行一键命令。
- `克隆失败`:用 `ssh -T git@github.com` 检查 GitHub SSH 授权；脚本不会回显仓库凭据。
- `目标工作树有未提交或未跟踪改动`:先自行提交、转移或清理本地改动；脚本不会代替用户处理。
- `Node.js 版本过旧`:升级到 Node.js 20 或更高版本后重试。
- `模型检测失败`:向导只显示认证/端点/限流等错误类别，不显示密钥或供应商原始响应；修正后重新检测即可。

## 玉兔系列 · 版本沿革

- **玉兔2** 旧 Mac mini 上一代(退冷备/参照)· **玉兔3–5** 中间各代 · **玉兔6** 当前代(本工作区,新 Mac mini)。
- 升级方式:复制工作区、版本号 +1;旧代留作可回溯快照。**底层架构(四层 + 文件协议)不随版本变,变的是上面跑的能力。**

## 迁移状态

旧搬家包与 Claude Code 交接快照已归档出仓库；新机器统一使用根目录 `deploy-macos.sh` 从 GitHub 当前 `main` 部署。
