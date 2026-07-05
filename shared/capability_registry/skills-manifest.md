# Skills 清单(41 个自定义 · 旧机 ~/.codex/skills)

> 政策(2026-06-18):**不批量拷**。41 个多为具体项目用 → **按需拉**(做到对应项目时再从旧机/备份取)。
> 例外:`instruction-expansion-router`(全局件③)**不拷、已在新机重建**,见 `modules/instruction-expansion-router/`。
> 用途速查源:迁移记录 08 §4.2 / §4.3。Skill = 薄说明书(何时触发/先读什么/怎么做/不要做);长期知识在对应模块。

## 核心 / 路由

| Skill | 作用 |
|---|---|
| `module-registry` | 查本机持久化模块,防每次全局扫描 |
| `instruction-expansion-router` | 全局指令补齐路由器(口语/简略/截图/跨项目);只分发。✅**已在新机重建**(绑前门 Codex CLI) |
| `skill-standard-reviewer` | 新建/改 skill 的质量门 |
| `repair-work-principles` | 维修员专用薄触发器; path=`/Users/yutu6/.codex/skills/repair-work-principles`; scope=`repair-agent-only`; source_of_truth=`shared/agents/repair/prompt.md#核心工作准则`; source_version=`sha256:1627b712bd143518a3e1f0fdc52176aa8fb6dee0cf19ba56588e04f32cd09508`; status=`present` |
| `multi-agent-collaboration-contract` | 多 agent 能力目录与 handoff 契约 |
| `hermes-yutu-voice-bridge` | 玉兔语音/飞书/Codex handoff 入口 |
| `personal-contacts` | 联系人查询(不存邮件正文/密钥) |
| `user-clipboard-response` | 复制可转发文本到剪贴板 |

## YuanXiao / 嫦娥 / 元宵(Android 控制面)

| Skill | 作用 |
|---|---|
| `yuanxiao-command-expander` | 元宵/嫦娥/玉兔/Hermes/Android 控制面任务补齐 |
| `嫦娥改装计划` | YuanXiao/ChangE Android 控制面与自更新工作流 |
| `yuanxiao-mobile-file-inbox` | 手机文件传给玉兔/传奇后的收件箱 |
| `chang-e-android-control-plane` | 嫦娥安卓控制面 |

## Simulaid(游戏开发)

| Skill | 作用 |
|---|---|
| `simulaid-command-expander` | Simulaid 开发/UI/资产/构建/发布前置补齐 |
| `simulaid-unity-maintenance` | Simulaid Unity/团结 维护入口 |
| `simulaid-architecture-guardian` | 反复 bug/架构审查/代码臃肿治理 |
| `simulaid-optimize-build-deliver` | 优化-构建-交付 |
| `simulaid-performance-refactor` | 性能重构 |
| `simulaid-code-refactor-navigation` | 代码重构导航 |
| `simulaid-pixel-art-assets` | 像素美术资产管线 |
| `simulaid-animation-assets` | 动画资产 |
| `simulaid-marketing-planning-bridge` | 营销策划桥 |
| `simulaid-build-qq-delivery` | 构建 + QQ 交付 |
| `simulaid-taptap-release-gate` | TapTap 上架门禁 |
| `simulaid-ui-regression-review` | UI 视觉回归审查 |

## 跨项目 wrapper(交付 / 内容 / 质量)

| Skill | 作用 |
|---|---|
| `yulong` 玉龙 | Android 打包/交付 |
| `yuling` 玉灵 | iOS/TestFlight 交付 |
| `yulinglong` 玉玲珑 | Android+iOS 合并交付 |
| `huanglong` 黄龙 | Android 交付 + 玩家更新日志 |
| `yutun` 玉豚 | 游戏生图/补图 |
| `yufeng` 玉凤 | 剧情/世界观/设定一致性审查 |
| `yushu` 玉鼠 | 游戏内容定义(卡牌/角色/装备/道具/文本) |
| `yuhu` 玉虎 | bug 根因修复守门 |
| `yuheng` 玉衡 | 测试用例/回归测试门禁 |
| `yuhuang` 玉凰 | TapTap/社区/玩家公告文案 |
| `yuhua` | (玉系列 wrapper,待核对) |
| `yuji` | (玉系列 wrapper,待核对) |

## Zongzi(粽子助手)

| Skill | 作用 |
|---|---|
| `zongzi-command-expander` | 粽子助手/控制台/服务器任务补齐 |

## 媒体 / 其他

| Skill | 作用 |
|---|---|
| `doubao-seedance-animation` | 豆包 Seedance 动画 |
| `starlaid-game-development` | 🚫 Starlaid——硬排除 |
| `starlaid-image-generation` | 🚫 Starlaid——硬排除 |
| `starlaid-test-maintenance` | 🚫 Starlaid——硬排除 |
| `starlaid-unity-maintenance` | 🚫 Starlaid——硬排除 |

> **按需拉方式**:做到某项目(如 Simulaid/YuanXiao)时,只从旧机 `~/.codex/skills` 取**该项目相关**技能拷进新机 `~/.codex/skills`,并把 registry 对应项标 `present`。不一次性全拷。Starlaid 四项保持硬排除。
