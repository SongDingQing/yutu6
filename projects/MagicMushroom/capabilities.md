# MagicMushroom 能力与首读

## 首读顺序

1. `projects/MagicMushroom/brief.md`
2. `projects/MagicMushroom/status.md`
3. 当前任务信封与验收标准
4. `/Users/yutu6/UnityProject/MagicMushroom/ProjectSettings/ProjectVersion.txt`
5. `/Users/yutu6/UnityProject/MagicMushroom/Packages/manifest.json`
6. 任务涉及的源码、场景或测试

## 当前工程能力

- Unity 6 `6000.3.16f1`
- URP `17.3.0`
- Input System `1.19.0`
- AI Navigation `2.0.12`
- Unity Test Framework `1.6.0`
- Android/iOS 等平台模块按任务需要再确认，不假设已安装

## 验证原则

- 纯文档/规划：结论必须引用实际工程文件。
- C# 改动：至少执行编译或与改动匹配的自动测试；编辑器不可用时明确标为阻塞，不得伪报通过。
- 场景/UI 改动：提供 Game View 或可复核截图。
- 构建/发布：先确认目标平台模块、签名和发布授权，再执行。
- 完成回报必须列出真实 changed files、测试命令、退出状态和剩余风险。
