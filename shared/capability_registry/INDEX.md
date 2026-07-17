# 能力注册表 · capability_registry/

> 新机的"能力目录"。沿用旧机 `~/.codex/modules` 的**先查注册表、再查源码**原则(精华索引 §2、迁移记录 08 §3–4)。
> 模块 = 长期知识 / 接口契约 / 文件图谱 / 历史坑;skill = 薄触发说明书。

## 查找流程(沿用旧机)

1. 读本文件。
2. 读 `registry.json`(关键词路由)。
3. 命中后只打开该模块的 `INDEX.md`,再按 `read_order` 读少量文件。
4. 实现文件最后才看。

## 政策(2026-06-18)

项目技能和项目模块不再批量拷,改为**按需拉**(pull_on_demand)——做到对应项目时再从旧机/备份取。全局只维护本模块索引、环境配置 `shared/config/environment.md` 与补齐指令稿 `modules/instruction-expansion-router`。

## 模块现状

| 模块 | 状态 | 位置 |
|---|---|---|
| `multi-agent-collaboration-contract` | ✅ 已转入(包内快照) | `modules/multi-agent-collaboration-contract/` |
| `hermes-yutu-voice-bridge` | ✅ 已转入(包内快照) | `modules/hermes-yutu-voice-bridge/` |
| `instruction-expansion-router` | ✅ **新机重建**(全局件③) | `modules/instruction-expansion-router/` |
| `meowa-game-assets` | ✅ 已接入(共享 CLI + 统一 key + module) | `modules/meowa-game-assets/` |
| `peekaboo-desktop-control` | ✅ 已 brew 装(GUI/桌面控制 runner,待授权) | `shared/routing/runners.yaml` (id=peekaboo) |
| `chang-e-android-control-plane` | 🔻 按需拉(元宵/嫦娥,已后置) | 旧机 `~/.codex/modules/` |
| `simulaid-optimize-build-deliver` | 🔻 按需拉(做 Simulaid 时) | 同上 |
| `simulaid-studio-operating-model` | 🔻 按需拉(做 Simulaid 时) | 同上 |
| `simulaid-taptap-release-gate` | 🔻 按需拉(做 Simulaid 时) | 同上 |
| `user-clipboard-response-preference` | 🔻 按需拉 | 同上 |
## Skills 现状

- 旧机 `~/.codex/skills` 有 **41 个自定义 skill**(玉龙/玉灵/玉凤/玉鼠/simulaid-*/yuanxiao-* 等),多为**具体项目**用。
- **新机 `~/.codex/skills` 是全新 Codex 安装**——只有系统自带 skill。41 个自定义 skill **不批量拷**,做到对应项目时**按需拉**。
- 清单与用途见 `skills-manifest.md`。例外:全局件③ `instruction-expansion-router` **不拷、已在新机重建**(见 `modules/instruction-expansion-router/`)。

## 指令补齐优先级(迁移记录 08 §4.1)

1. 用户**显式点名**的 skill/agent(最高)
2. 项目专用 expander(Simulaid / YuanXiao / Zongzi)
3. 跨项目 wrapper(玉龙/玉灵/玉豚/玉凤/玉鼠/玉虎/玉衡/玉凰)
4. 全局 `instruction-expansion-router`(只分发,不重复输出补齐稿)

> 每次任务最多输出一个可见"指令补齐稿"块;项目 expander 已输出则 global router 不再重复。

## 与 routing/ 的关系

- `runners.yaml` 里的 runner(Hermes/Codex)→ 对应这里的能力模块。
- 硬化产物(§16 软骨:参数化 skill)落地后登记进本注册表,供路由调用。
