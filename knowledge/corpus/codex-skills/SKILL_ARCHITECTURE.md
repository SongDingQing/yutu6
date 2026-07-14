# 玉兔6通用 Skill 架构

## 分层

1. 全局入口 skill:只做指令补全、项目识别和安全边界。
2. 系统能力 skill:队列、协作、模块登记、通知和桌面控制等跨项目能力。
3. 项目能力包:某个游戏、产品、公司或业务线的 agent、skill、知识、构建与发布规则。

## 硬边界

- 公共核心不得硬编码项目名、用户绝对路径、上传账号或项目密钥。
- 项目能力包必须显式声明项目 ID、安装内容、卸载清单、回滚方式和测试。
- 新项目先由 `project-department.js` 创建项目部门，再按 HR 流程安装项目能力包。
- 未安装项目路由时，全局入口只输出通用补齐稿，不借用另一个项目的命令。
- skill 的创建、更新和持久化应经过 `skill-standard-reviewer`。

## 运行时来源

- 本机技能:`~/.codex/skills/`
- 公共冷档:`knowledge/corpus/codex-skills/skills/`
- 项目能力包:`project-packs/<projectId>/` 或独立私有仓库
- 项目部门:`projects/<projectId>/department.json`
