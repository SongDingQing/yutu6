# 学习案例库

案例用于让秘书、CEO、主管、董事会和质量治理复用经过验证的经验，而不是复制某个项目的私有内容。

## 必填字段

每条案例必须包含：`来源`、`场景`、`现象`、`根因/判断`、`改法`、`验证`、`可复用原则`。其中 `来源`、`验证`、`可复用原则` 三项不得省略。

可复用原则必须能指导后续不同项目/页面/agent 决策。引用时在任务逻辑链中写 `参考案例:`，并保留 `secretary -> CEO -> supervisor` 的交互证据。

追加案例后向事件日志写入 `learning_case.appended`，事件至少包含案例文件、标题、taskId/queueId（若有）和时间。

## 文件

- `ui-optimization-cases.md`: UI 与交互优化案例。
- `self-reflection-optimizer-cases.md`: 自省优化案例；新增优秀案例可由 `self-reflection-trigger.js` 触发新一轮自省。
