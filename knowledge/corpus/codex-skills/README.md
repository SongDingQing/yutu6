# 归档 · 旧机 Codex 41 技能(重建源)

> 来源:U盘 `月饼/codex-41-skills-yutu-2026-06-18/`(旧机 yutu 的 `~/.codex/skills` 全量,2026-06-18 抽取)。
> 用途:**重建源** —— 后续任务需要某项目的能力时,从这里取对应技能重新构建/安装,不必每次回旧机。

## 内容
- `SKILL_ARCHITECTURE.md` —— 旧机技能架构总图(分层、路由原则、各技能定位)。
- `skill-list.txt` —— 全清单。
- `skills/` —— 现有技能归档目录(含 13 个 simulaid-*、玉系列 wrapper、yuanxiao/zongzi/hermes/通用元层等)。
- `skills/project-routes/` —— 跨项目 wrapper 路由与 Simulaid 路由。

## 路径迁移须知(旧机→新机)
技能文档内路径多为旧机 `/Users/yutu/...`,重建/安装到新机时换算:
- `/Users/yutu/.codex/skills` → `/Users/yutu6/.codex/skills`
- `/Users/yutu/Simulaid` → `/Users/yutu6/TuanjieProjects/Simulaid`(团结游戏统一父目录)
- 其它 `/Users/yutu/` → `/Users/yutu6/`

## 怎么用(重建/导入)
- **新架构(玉兔6 多智能体)**:某项目转为多智能体项目时,把相关技能登记进 `shared/capability_registry`,并在 `projects/<项目>/` 建能力索引。Simulaid 已做(见 `projects/Simulaid/`)。
- **旧 Codex 机制**:若仍要让本机 Codex 自动加载,把相关技能拷到 `~/.codex/skills/`(Mac 侧,见 `projects/_迁移/转发给codex.txt` 的安装任务),并按上表 repath。
