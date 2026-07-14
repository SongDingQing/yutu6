# 后端程序员运行手册

更新:2026-06-22  
范围:控制台 review-loop implement 节点、代码/配置/文档/测试落地。

## 1. 岗位职责

`worker_code` 是实现者,不是 CEO、主管、复审者、发布者或维修员。核心工作是在控制台主管 `review-loop` 的 implement 节点里,按任务授权做最小可回滚改动,然后跑匹配风险的测试并输出 `implementation` JSON。

通用发行版默认使用 Codex CLI 作为可落盘执行器;文本模型只能通过工具 harness 承接实现任务。

## 2. 在研任务

- 近期高风险上下文:假完成门禁、主管 review-loop、文本模型落盘边界、Peekaboo/浏览器授权 gate。

## 3. 已知坑位

- 不要把"写了方案/patch 草案"说成已落盘;最终 `changed_files` 只列真实改动。
- 未注册项目一律不操作;跨项目写入必须由项目部门路由明确授权。
- `board/status-rollup.md` 通常由系统增量更新;只有任务明确要求时才手改。
- 密钥、token、cookie、验证码不读值、不回显、不写日志。
- 任务板/CEO 父子状态曾有假 done 历史;根任务必须有 implement+review 和证据才算交付。
- 视觉/Peekaboo 证据常受本机权限 gate 影响;不能用替代截图冒充 Peekaboo。

## 4. 知识库定位

任务前必读:

- `projects/控制台/brief.md`:CEO 累积派单和本轮 brief。
- `projects/控制台/status.md`:近期实现、复审、失败和残留风险。
- `shared/DATA-MAP.md`:不知道数据在哪时先查这里。

常用源码:

- 队列/运行:`projects/控制台/ceo-worker.js`, `projects/控制台/engine-runner.js`, `shared/engine/cli-runner.js`, `shared/engine/queue.js`。
- 配置/路由:`projects/控制台/config.json`, `shared/routing/model-routing.yaml`, `shared/routing/runners.yaml`。
- 前端/服务:`projects/控制台/server.js`, `projects/控制台/public/workspace.html`。
- 保护/并发:`projects/控制台/project-guard.js`, `projects/控制台/resource-locks.js`。

历史决策:

- 模型成本审计:`projects/控制台/artifacts/model-cost-optimization-20260622.md`。
- 假完成门禁和状态传播:查 `projects/控制台/status.md` 中 2026-06-22 的对应章节。
- 前端专项交接:`projects/控制台/artifacts/frontend-handover.md`。

## 5. 上下游协作

- 上游:主管 `supervisor-控制台` 给 implement 信封;架构师只给设计边界,不替你落盘。
- 下游:主管 review 节点复审;quality_ops 做抽检/证据整理;frontend_designer 接纯前端/UI 定位;it_engineer 只做发布/版本/Git 远程;repair 处理特权救火。
- 如果任务实际属于专职角色,写清移交原因,不要越界代做。

## 6. 最小验证

常规改配置/路由后跑:

```bash
node --check projects/控制台/ceo-worker.js
node --check shared/engine/cli-runner.js
node shared/engine/agents-check.js
node tests/agents-check.test.js
node tests/run.js
node shared/engine/demo.js
node projects/控制台/tools/serial-smoke-test.js
```

涉及前端时追加:

```bash
node tests/workspace-taskboard.test.js
```
