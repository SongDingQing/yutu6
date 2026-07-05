# Input And Output Contracts

## Machine Manifest

File:

`/Users/yutu/.codex/modules/multi-agent-collaboration-contract/agent-manifest.json`

Purpose:

- machine-readable agent capability and route map
- safe to read by Hermes, Codex, and future agents
- contains no secrets

## Module Registry

Codex registry:

`/Users/yutu/.codex/modules/registry.json`

Lookup script:

`/Users/yutu/.codex/modules/scripts/module_lookup.py "<query>"`

Hermes entry skill:

`/Users/yutu/.hermes/skills/autonomous-ai-agents/multi-agent-collaboration-contract/SKILL.md`

Codex entry skill:

`/Users/yutu/.codex/skills/multi-agent-collaboration-contract/SKILL.md`

## Feishu Confirmation Cards

Voice task card:

- title: `Command Required: Voice Task`
- source: Hermes voice bridge
- approval output: confirmed task replayed into Hermes gateway

Codex handoff card:

- title: `Command Required: Codex Handoff`
- source: Hermes codex-handoff plugin
- approval output: local Codex CLI starts with project path and task

## Email Task Contract

Input examples:

- `帮我搜索最新 AI 消息，发送给我的邮箱`
- `给姐姐发邮件`
- `把结果发给我`

Resolved recipients:

- `主人` / `我` / `我的邮箱`: `songchengzuo@hotmail.com`
- `姐姐`: `scc12251988@hotmail.com`

Output:

- confirmation card before execution when voice-originated
- sent email or concise missing-info question after approval

## Coding Task Contract

Input examples:

- `给这个 Unity 游戏加一个功能`
- `修改项目里的登录 bug`
- `打包 APK 发给我`
- `让 Codex 写一个文档发回来`

Required output:

- Feishu confirmation card
- Codex run summary
- test/build result when available
- APK/file attachment if requested and produced
- durable latest status at `/Users/yutu/.hermes/codex-handoff/latest-status.json`

Document/file return:

- If the task asks to send/upload/return a document/file/report, Hermes should set `deliver_document: true`.
- Supported returned artifact types: `.md`, `.txt`, `.pdf`, `.docx`, `.xlsx`, `.pptx`.
- Codex should create returned artifacts inside the `project_path` tree and include absolute paths in the final reply; Hermes scans the project directory and final text to find files.
- If Codex writes the file only to Desktop, Downloads, or another unrelated directory, Hermes may complete the task but fail to attach the file automatically.

## IT Version Management Contract

Release request:

- command: `node projects/控制台/secretary-tools.js it-release-request --part <manual|major|minor|fix> --message "..." --path <file>`
- queue: `projects/控制台/artifacts/queues/it_engineer`
- required fields: version part, update summary, explicit path list
- output: `VERSION.json`, commit subject beginning with `v<manual.major.minor.fix>`, Gitee push result, concise release summary

Rollback request:

- command: `node projects/控制台/secretary-tools.js it-rollback-request --target <version-or-commit> --reason "..."`
- queue: `projects/控制台/artifacts/queues/it_engineer`
- required fields: target version or commit, repair reason
- output before confirmation: rollback dry-run plan only
- output after owner confirmation: revert-based four-part version commit and Gitee push result

Version display:

- API: `GET /api/version`
- UI: `projects/控制台/public/workspace.html` right header badge near the update time
- source file: `VERSION.json`

## Scheduled Codex Task Contract

Input examples:

- `30 分钟后让 Codex 检查这个 Unity 项目`
- `每天早上 9 点让 Codex 生成项目状态报告`
- `每 2 小时让 Codex 跑一次构建检查，跑 3 次`

Required output:

- Feishu confirmation card before creating the schedule.
- Hermes cron job after approval.
- Codex run summary delivered back to the origin chat on each due run.
- Artifact attachment if requested and produced.
- Artifact-producing scheduled tasks should write files under `project_path`; the generated runner only scans inside the project tree for attachments.

Required fields:

- `project_path`
- `task`
- `schedule`

Optional fields:

- `repeat`
- `verification`
- `deliver_apk`
- `deliver_document`

Persistent files:

- `/Users/yutu/.hermes/cron/jobs.json`
- `/Users/yutu/.hermes/scripts/codex-handoff`
- `/Users/yutu/.hermes/codex-handoff/scheduled-runs`
