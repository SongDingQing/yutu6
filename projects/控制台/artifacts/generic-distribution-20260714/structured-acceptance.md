# 通用发行版产品化 · implement 验收

- taskId: `cr-1784023254548-b9854dd7`
- specFingerprint: `d83854d80f900006527db0a993072cffc8f73a9bdc82293b4b29b8f221afc726`
- 基线: GitHub `main` / `e1564f451bcbd9250a0973d6174d7907ea4e38f4`
- review-loop 节点: `worker_code implement`；主管 review 仍由 `supervisor-控制台` 后续执行。

## 结构化验收表

| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |
|---|---|---|---|
| 任务验收: 在 控制台 项目 scope 内跑 review-loop; 完成前更新 projects/控制台/status.md。 | 完成 | `projects/控制台/status.md`；`node tests/run.js` exit 0；`bash tests/deploy-macos-smoke.sh` exit 0 | 任务信封明确 `queueAgent=supervisor-控制台`；本节点只声明 implement 完成，不冒充主管 review。 |

## Loop engineering 检查

- S1-S8 中可由 implement 候选件控制的 8 项全部命中：使用单一模板字段、要点逐字复制、状态为“完成”、证据非空且对应本行。
- 本轮可测评分: `1.0`；目标: `0.85`；已收敛。
- 应用上轮方法改进: 每个改进结论都指向实际文件、命令退出码或任务信封，不用泛化“已完成”作证据。

## 可执行验证

- `node tests/run.js` → exit 0，全部测试文件通过。
- `bash tests/deploy-macos-smoke.sh` → exit 0，覆盖 dry-run、首装、幂等重跑、脏目录拒绝、失败克隆与私有配置回滚。
- `node tests/setup-config-migration.test.js` → exit 0，覆盖新目录优先、旧 `yutu6-secrets` 迁移、Codex 登录态、权限和写入失败恢复。
- `node tests/project-departments.test.js` 与 `node tests/setup-gate.test.js` → exit 0，覆盖 CLI/API、幂等、路径穿越、限额、限速、动态映射和懒队列。
- `git diff --check` → exit 0。
