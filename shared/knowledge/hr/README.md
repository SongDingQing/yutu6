# HR 部门共享知识区

用途:保存 HR 主管和 HR 专员共用的 agent 生命周期标准、规格卡模板、边界审核记录索引和 smoke 证据说明。

## 固定入口

- 数据地图:`shared/DATA-MAP.md`
- 花名册:`shared/agents/INDEX.md`
- 入职脚本:`projects/控制台/tools/hr-agent-onboarding.js`
- 审核产物:`projects/控制台/artifacts/hr/`

## 新 agent 规格卡最小字段

```json
{
  "id": "example-agent",
  "name": "示例 Agent",
  "role": "example_agent",
  "ownership": "控制台 / HR / 横向",
  "capability": "一句话职责",
  "runner": "zhipu-glm",
  "read_paths": ["shared/DATA-MAP.md"],
  "writes": [],
  "triggers": ["什么时候触发"]
}
```

缺少归属、能力、额度/模型、文件权限任一项时,拒绝创建。
