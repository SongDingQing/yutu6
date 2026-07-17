# 玉兔6 · 统一环境配置(单一真相)

> 跨机路径 / 端口 / 运行器 / 密钥位置 / 备份去处的**唯一权威**。非密——**密钥真值不在此、不进 git**,这里只记"在哪、归谁、什么用途"。
> 机器可读子集见同目录 `machine.json`;SSH/Git 远程细节见 `ssh-and-remotes.md`。
> 更新:2026-06-18。

## 1. 机器身份
| 代号 | 用户名 | 家目录 | 角色 |
|---|---|---|---|
| 旧机 | `yutu` | `/Users/yutu` | 玉兔2 之前那台;退为**冷备 / 参照**,按需取旧能力 |
| **新机** | `yutu6` | `/Users/yutu6` | **现役**玉兔6 核心;跑 agent / 控制台 / Hermes |

> 路径迁移规律:旧机 `/Users/yutu/<rel>` → 新机 `/Users/yutu6/<rel>`(即 `$HOME/<rel>`)。

## 2. 关键路径
| 用途 | 路径 | 说明 |
|---|---|---|
| 工作区(文件即大脑) | `~/玉兔6工作区` | git 仓库(Gitee);**真相源** |
| 密钥保险库 | `~/.config/yutu6-secrets/` | 统一 secrets.env + 清单;chmod 700;**不进 git**(2026-06-18 从桌面迁入) |
| Hermes(默认语音/飞书入口) | `~/.hermes/hermes-agent` | clone 自 Gitee;`.env` 在 `~/.hermes/.env`(600) |
| Codex 自定义能力 | `~/.codex/skills` · `~/.codex/modules` | 新机全新装;41 项目技能**按需拉**(见 capability_registry) |
| 项目 · YuanXiao | `~/Projects/YuanXiao` | 私有,待 clone |
| **团结游戏项目(统一父目录)** | `~/TuanjieProjects/` | 所有团结/Unity 游戏放这;ASCII 路径(构建友好) |
| 项目 · Simulaid | `~/TuanjieProjects/Simulaid` | 私有,团结游戏;待 clone |
| 知识库 | `~/玉兔6工作区/knowledge/kb.sqlite` | 待建(embedding 走另一台电脑端点) |

## 3. 端口 / 服务
| 服务 | 端口/标识 | 说明 |
|---|---|---|
| 本地 Web 控制台 | `41218`(127.0.0.1 + ::1) | `projects/控制台/`;launchd `com.yutu6.console` |
| Hermes gateway | (未起) | 接飞书后启;LaunchAgent 未装 |

## 4. 运行器 / CLI(前门与执行)
| runner | 命令 | 角色 | 状态 |
|---|---|---|---|
| Codex | `codex` | **前门总管 + 本地工程执行**;日常对接、补齐指令稿、核心写码与维修均由 Codex 接管 | v0.140.0 已登录 |
| Claude Code | `claude` | 已停用兼容项;不作为自动路由、前门或主管路径 | 订阅可能过期,不得依赖 |
| Hermes | `hermes` | 语音入口;LLM=**MiniMax-M3**;**飞书已接通**(websocket 长连接) | gateway running(launchd ai.hermes.gateway);私聊闭环已验证 |
| **Peekaboo** | `peekaboo agent` | **GUI/桌面控制 runner**(手和眼):截屏 + 读 a11y 树 + click/type/scroll/menu/window;CLI + MCP | 已 brew 装;待授 Screen Recording + Accessibility 权限 |
| 本地模型 | (另一台电脑端点) | embedding / 本地 LLM;**不在 mini 上装 Ollama** | 待该机就绪 |

> Hermes LLM 出口:MiniMax-M3,base `https://api.minimaxi.com/anthropic`(anthropic 兼容)。
> Peekaboo 定位:CLI/API 够不到的"需点击"任务(原生 App、无 API 网页)由引擎派给它;它也是 MCP,Codex 可当工具调用。详细 runner 注册见 `shared/routing/runners.yaml`。

## 5. 密钥分发(值不在此;映射见 secrets.env 的 `# Source`)
> 统一保险库 `~/.config/yutu6-secrets/secrets.env` 已收齐(2026-06-18):飞书 / MiniMax(CN) / DeepSeek / Brave / API_SERVER / YuanXiao 等;桌面原件已清,加密包在夸克。

| secret 组 | 落点文件 | 还原方式 |
|---|---|---|
| `FEISHU_*` / `BRAVE_*` / `MINIMAX_*` / `MINIMAX_CN_*` / `DEEPSEEK_*` / `HERMES_INFERENCE_PROVIDER` / `LLM_MODEL` / `API_SERVER_*` | `~/.hermes/.env` | `bash projects/_迁移/scripts/restore-secrets.sh`(默认源已是保险库) |
| `YUANXIAO_*` | `~/Projects/YuanXiao/ops/config/yuanxiao.env` | 同上 |
| SSH 私钥 | `~/.ssh/`(600) | 不在 secrets.env;Gitee key 备份已入保险库 |

## 6. 备份 / 冷存
| 内容 | 去处 |
|---|---|
| 密钥保险库(加密包) | **夸克网盘**(只传 AES256 加密包,明文不上云) |
| 工作区快照 / kb.sqlite | 玉兔2 冷备 |
| 工作区源码 | Gitee(不含密钥) |

## 7. 硬约束
- 密钥**只本机用、不外传、不贴聊天**;脚本处理密钥不回显值。
- OAuth / 扫码 / 2FA / 各平台登录 → 只列清单,用户手动。

## 8. 工具链 / 系统(2026-06-18)
| 项 | 值 | 备注 |
|---|---|---|
| Homebrew | `/opt/homebrew/bin/brew` · v6.0.2 | 已修到命令行可直接用;`brew doctor` = ready;31 个旧包**未** upgrade(避免影响现有环境) |
| 代理 | `127.0.0.1:10808` | 持久写入 `~/.zprofile` + `~/.zshrc`;`brew update` 走代理成功 |
| **Peekaboo** | `brew install steipete/tap/peekaboo` | GUI/桌面控制 runner(见 §4);**待授权**:系统设置 → 隐私与安全性 → **屏幕录制** + **辅助功能** |

> 待用户手动授权:Peekaboo 的 Screen Recording + Accessibility(否则截屏/点击无效)。
