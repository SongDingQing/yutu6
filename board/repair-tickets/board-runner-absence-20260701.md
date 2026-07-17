# 维修单：董事 runner 失败误显示为否决

status: done
owner: repair-lead
date: 2026-07-01

## 问题

董事会评审里，部分董事 runner 调用失败时被系统渲染成“失败/否决”，导致老板看到像是董事不批。实际链路里，runner 没有产出有效意见，应该标为“缺席/通道失败”，不能参与否决、风险汇总或修订轮次判断。

## 链路证据

- 任务：`b9d8942d`
- 运行目录：`projects/控制台/artifacts/engine-runs/cr-1782873306295-b9d8942d/`
- 现象：董事链路中出现多个“董事失败”，但同轮其它董事已经给出有效意见。
- Kimi 直接调用返回：`Invalid Authentication`
- GLM 通过 new-api 命中渠道后返回：`该模型当前访问量过大，请您稍后再试`

## 严重度

系统性问题。它影响所有依赖董事会的任务判定，会把“通道不可用”误解释成“董事否决”，造成路线判断错误。

## 修复

- `projects/控制台/board-review.js`
  - runner 调用失败改为 `absent: true`，不再设置为有效否决。
  - 新增 `node.absent` 和 `board.review.director.absent` 事件。
  - 缺席董事不进入 `opinionNeedsMoreRounds`、hard block、风险/偏差修订计数。
  - 汇总里单独列“董事缺席”，不混入“风险/偏差”。
- `projects/控制台/server.js`
  - 任务链路板兼容新 `node.absent`。
  - 旧历史 `node.fail` 若来自董事 runner/auth/timeout/channel 类错误，兼容显示为“缺席”。
- `projects/控制台/public/workspace.html`
  - 工位/链路 UI 增加 `absent` 状态。
  - 旧董事 runner 失败事件兼容渲染为“缺席”。
- `tests/board-review.test.js`
  - 覆盖 runner fail 不得变成否决。
  - 覆盖董事缺席不触发追加修订轮。
- `tests/task-failure-reason.test.js`
  - 覆盖历史董事 `node.fail` 在任务板显示为“缺席”。

## Kimi / GLM 结论

- Kimi：本机存在 `MOONSHOT_API_KEY` 配置名，但当前 key 对 `https://api.moonshot.cn/v1` + `kimi-k2.7-code` 返回 401 `Invalid Authentication`。需要更换有效 Moonshot/Kimi key，或确认该 key 对应的正确 provider/endpoint/model。
- GLM：new-api 正常运行且模型列表包含 `glm-5.2` / `glm-5`；请求能打到配置的 GLM CodePlan 代理/渠道，但上游返回 429 code `1305`，含义为当前访问量过大。`glm-5v` 当前没有可用渠道。

## 验证

- `node tests/board-review.test.js`：通过
- `node tests/task-failure-reason.test.js`：通过
- `node --check projects/控制台/board-review.js && node --check projects/控制台/server.js`：通过
- `node tests/workspace-taskboard.test.js`：仍有既有断言失败：`cancel queue button must remain outside the mode chip group`。本次新增的 `absent` 静态检查位于该断言之前，已执行通过；该失败与董事缺席修复无关。

## 后续

- 更换或校准 Kimi key 后再做一次董事会 Kimi 冒烟。
- GLM 429 属供应商/渠道拥塞或额度侧问题，建议为董事会增加可用 fallback 或降低 GLM 在高峰期的权重。
