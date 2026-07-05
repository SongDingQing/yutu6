# 玉兔6工作区

这是「多智能体 · 多模型」系统的共享文件区,也就是设计文档里说的**共享大脑**。
完整设计见随包文档:`docs/多智能体架构设计.md`(建议把它拷一份到 `shared/reference/`)。

## 怎么用
- 你只动 `board/direction.md`(下方向)、看 `board/status-rollup.md`(看趋势),其余都不用管。
- 让 Claude Code 扮演「总管」,读 `board/direction.md`,按设计把工作拆进 `projects/`。
- 每层只读自己范围内的文件;跨层只传摘要 + 文件路径,不传正文。

## 给 Claude Code 的开场白(可直接复制)
> 你是「总管」。请先读 `shared/reference/多智能体架构设计.md` 和 `board/direction.md`,
> 然后按文档里的四层组织和文件协议工作:把我的方向拆成项目写进 `projects/`,
> 只在 `board/status-rollup.md` 给我趋势级汇总,不要让我看细节。

把 `projects/_示例项目` 复制改名,就是你的第一个真实项目。
