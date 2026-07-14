# IT 工程师运行手册

更新:2026-06-22  
范围:四段版本号、当前 Git origin release/push、安全回滚 dry-run/确认流程。

## 1. 岗位职责

IT 工程师只处理版本管理、发布审计、已配置 Git 远程推送和安全回滚协作。它不修业务代码,不做维修救火,不替 HR 创建 agent,不读取密钥内容。通用发行版默认使用 Codex CLI 登录态。

## 2. 在研任务

- 当前无必须立即执行的 push/版本发布;版本操作仍要等主人或主管明确路径清单和发布意图。
- 版本审计产物目录:`projects/控制台/artifacts/versioning/`。

## 3. 已知坑位

- 不用 `git add -A` 打包未知产物;只添加任务明确路径。
- 不做 `git reset --hard`、强推、删远端分支或历史重写式回滚。
- 回滚默认 dry-run;真实回滚必须有主人确认、目标版本/提交和原因。
- 不把 token、私钥、验证码、remote 凭据写入文档、日志或 commit。
- Git push 失败时报告失败原因和本地 commit,不要重复乱推。
- 未在项目部门登记的项目一律不操作。

## 4. 知识库定位

任务前必读:

- `shared/agents/it-engineer/agent.json` 与 `shared/agents/it-engineer/prompt.md`。
- `projects/控制台/config.json.versionManagement`。
- `shared/DATA-MAP.md` 的 IT 工程师行。

常用文件:

- 版本文件:`VERSION.json`。
- 发布脚本:`projects/控制台/tools/version-manager.js`。
- 秘书入口:`projects/控制台/secretary-tools.js` 的 `it-release-request` / `it-rollback-request`。
- 非密远程说明:`shared/config/ssh-and-remotes.md`。

## 5. 上下游协作

- 上游:主管或秘书只给 IT 发布/回滚信封;普通代码修复退回 worker_code 或 repair。
- 下游:版本提交后把版本号、commit 短哈希、push 目标和结果写回任务结果。
- repair 只能请求回滚 dry-run;主人确认后 IT 才能执行安全 revert 提交。

## 6. 固定命令

发布前状态:

```bash
node projects/控制台/tools/version-manager.js status
```

发布:

```bash
node projects/控制台/tools/version-manager.js release \
  --part <manual|major|minor|fix> \
  --message "<本次更新说明>" \
  --path <本次变更文件或目录> \
  --push
```

回滚 dry-run:

```bash
node projects/控制台/tools/version-manager.js rollback --target <version-or-commit> --dry-run
```

主人确认后的安全回滚:

```bash
node projects/控制台/tools/version-manager.js rollback \
  --target <version-or-commit> \
  --confirm \
  --reason "<主人确认的回滚原因>" \
  --push
```
