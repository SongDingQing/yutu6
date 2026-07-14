# 玉兔6 通用环境契约

本文件只描述 KEY 名和本机落点，不保存任何密钥值或个人机器信息。

## 路径

| 用途 | 默认位置 |
|---|---|
| 工作区 | 部署脚本的 `--target`，默认 `~/玉兔6工作区` |
| 模型私有配置 | `~/.config/yutu6/providers.env` |
| 初始化状态 | `~/.config/yutu6/setup-state.json` |
| 控制台日志与 PID | `~/.config/yutu6/console.log`、`console.pid` |
| 项目部门 | `projects/<projectId>/` |

私有目录权限为 `700`，私有文件为 `600`。

## 基础模型

| 能力 | KEY / 登录方式 | 必需 |
|---|---|---|
| Codex 执行器 | `codex login`，向导运行 `codex login status` | 至少一个执行器 |
| Claude Code | 本机 CLI 登录态 | 可选 |
| 智谱 Coding Plan | `ZHIPU_API_KEY`、`ZHIPU_BASE_URL`、`ZHIPU_MODEL` | API 模型任选其一 |
| MiniMax | `MINIMAX_API_KEY`、`MINIMAX_BASE_URL`、`MINIMAX_MODEL` | API 模型任选其一 |
| DeepSeek | `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` | API 模型任选其一 |
| 自定义兼容接口 | `OPENAI_COMPAT_API_KEY`、`OPENAI_COMPAT_BASE_URL`、`OPENAI_COMPAT_MODEL` | 可选 |

初始化向导只返回检测状态、端点和模型名，不返回 API key。

## 可选能力

- Hermes / 飞书：由对应模块单独安装和授权。
- Peekaboo：安装后由用户在 macOS 授予屏幕录制与辅助功能权限。
- Meowa：使用 `MEOWART_API_KEY`，遵循共享能力模块契约。

## 安全边界

- 密钥、token、cookie、私钥和 OAuth 凭据不进入 Git。
- 登录、扫码、2FA 和系统隐私授权由用户亲自完成。
- 具体项目的路径、账号、agent 和发布流程由项目能力包维护。
