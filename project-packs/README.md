# 项目能力包

玉兔6 公共仓库只保留通用系统部门。游戏、营销、业务线或某个公司的专属智能体，应作为独立项目能力包维护，不直接写进系统核心。

一个项目能力包应至少包含：

- 项目部门 `department.json` 与 `brief.md` 模板；
- 项目专属 agent、skill 和 capability module；
- 安装前检查、卸载清单与回滚说明；
- 不含密钥、用户路径和私有历史记录的测试夹具。

创建普通项目部门：

```bash
node projects/控制台/tools/project-department.js create \
  --id example \
  --name "示例项目" \
  --description "项目目标"
```

项目创建后会得到独立的 `supervisor-<projectId>` 主管队列；项目专属能力可再由 HR 流程按需安装。
