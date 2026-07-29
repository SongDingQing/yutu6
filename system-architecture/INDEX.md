# 玉兔6系统架构

本目录是玉兔6系统级设计的权威入口。新的系统架构说明、跨模块协议、运行时边界和架构变更记录统一放在这里；既有文档暂不搬迁，避免历史链接失效。

## 权威入口

| 主题 | 当前文档 |
|---|---|
| 总体架构 | `wiki/system/architecture.md` |
| 能力与 runner | `wiki/system/capabilities-and-runners.md` |
| 多智能体设计 | `shared/reference/多智能体架构设计.md` |
| 架构归属与自动发布 | `system-architecture/manifest.json` |
| 自动发布审计 | `system-architecture/changes/` |

后续新增的系统级设计应直接写入本目录，并从本索引链接；历史文档在被正式迁移前仍保持原路径。

## 自动发布边界

系统架构改动只有同时满足以下条件才会自动提交并推送：

1. 引擎发出 `task.true_done`，并通过 done gate 的只读复核。
2. 任务逻辑链明确声明实际改动文件。
3. 所有声明文件都属于 `manifest.json` 的系统架构归属范围；混合业务文件时不拆分、不自动提交。
4. Git 暂存区在开始时为空，防止并发任务被夹带。
5. 只精确暂存声明文件和本次架构审计回执，绝不使用 `git add -A`。
6. 暂存内容通过统一密钥扫描。
7. `releaseImpact=manual` 或未批准的重大改动保持人工通道。

提交后推送到当前分支对应的 GitHub 远端。若推送暂时失败，本地提交会保留并记录警告，现有 `post-commit` 自动推送与后续人工补推都可恢复。

## 启停与回滚

当前机器启用：

```bash
git config yutu6.architectureAutoPublish true
```

临时停用：

```bash
git config yutu6.architectureAutoPublish false
```

该开关只影响系统架构专用通道，不影响普通提交和已有版本发布钩子。回滚某次架构提交仍使用标准 Git 回滚流程，并以 `system-architecture/changes/` 中对应回执确定范围。
