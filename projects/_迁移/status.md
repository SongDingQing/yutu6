# 进展:玉兔搬家(主管 → 总管,滚动覆盖)

_更新:2026-06-18_

## 已完成(工作区内)
- ✅ 第一步骨架:`shared/routing/`(模型路由+runner注册表+声明式流程)、`shared/capability_registry/`、`shared/reference/` 误区库闭环、`knowledge/`(corpus冷档+build.sh)、README/版本沿革。
- ✅ B2:Hermes 登记为默认对话 runner;2 个核心模块转入能力库(共 24 文件)。
- ✅ B3:能力 registry + 41-skill manifest 登记(新机 .codex 全新装,实体待从旧机拷)。
- ✅ B4:迁移记录/快照归档进 `knowledge/corpus/`(50 文件)+ 7 篇 wiki 提炼笔记。
- ✅ B1:`restore-secrets.sh` 写好并经合成数据验证(按 Source 精确分发、chmod 600、零泄露)。
- ✅ B5:`clone-repos.sh` + `机器侧清单.md` 就绪。

## ✅ Hermes 已在新机装好(2026-06-18,默认对话 runner)
- Gitee SSH 配好(place-gitee-key.sh)→ clone 改版 Hermes 到 `~/.hermes/hermes-agent`(e8d5efa)。
- plugins/voice-wake 就位;restore-secrets.sh 写好 `~/.hermes/.env`(600)。
- uv venv 装依赖;`hermes doctor` 通过;3 个自定义插件 enabled;语音桥 `--check`=0、API key present;config.yaml 已生成(busy_input_mode=queue)。
- **未**启动 gateway、**未**接飞书(符合"先别接");LaunchAgent 未装。
- 注:restore-secrets.sh 原用 `mapfile`(macOS bash 3.2 不支持)已改兼容写法,现工作区版本即修好版。

## 待主人在 Mac 上做
- ⏳ 授权类:Nous/Codex/Gemini 登录、飞书/Gmail/Brave/API 平台授权;之后决定是否装并启动 LaunchAgent 接飞书。
- ⏳ GitHub 授权后 clone YuanXiao/Simulaid(`clone-repos.sh`)。
- ⏳ 从旧机拷 `~/.codex` skills(41)/modules。
- ⏳ 装 Ollama 后跑 `knowledge/build.sh` 建 kb.sqlite。

## 风险 / 拿不准
- 低:私有仓库 clone 依赖 GitHub 授权;SSH 私钥不在 secrets.env,需另拷。
