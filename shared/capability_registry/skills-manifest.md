# 通用 Skill 清单

公开发行版只归档可跨项目复用的 skill。项目专用 skill 不随系统安装，必须通过项目能力包显式接入。

| Skill | 作用 |
|---|---|
| `module-registry` | 定位持久化模块，减少全局扫描 |
| `instruction-expansion-router` | 补齐口语、简略、截图和跨项目任务 |
| `skill-standard-reviewer` | 审核新建或修改的 skill |
| `multi-agent-collaboration-contract` | 智能体能力和 handoff 契约 |
| `hermes-yutu-voice-bridge` | 可选语音、飞书与搜索桥接 |
| `personal-contacts` | 联系人查询接口，不保存正文或密钥 |
| `user-clipboard-response` | 生成并复制可转发文本 |
| `yuhua` | 通用商务材料视觉规范 |

## 项目 Skill

创建项目部门不会自动假设业务能力。项目包应自行提供：

- 项目命令补齐器；
- 项目路由文件；
- 构建、测试、发布和回滚 skill；
- 专用 agent 定义及最小写权限；
- 项目能力注册表增量。

安装与登记契约见 `project-packs/README.md`。未安装项目包时，系统只能使用通用项目主管和通用员工模板，不得借用其他项目的能力。
