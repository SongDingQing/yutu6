# a11y Tree 序列化与截图分块只读评测报告

- 日期:2026-06-24
- 任务:CEO brief `cr-1782293818054-298ef440` / supervisor implement `cr-1782294416660-06e6e9dd`;复验补证 `cr-1782297828106-06e6e9dd`
- 范围:控制台 `projects/控制台/` 与 brief 明确授权的 `board/` 报告;Starlaid/星桥排除。
- 边界:未改 runner/运行代码,未新采集截图,未下载或引入任何模型权重,未读取密钥,未触发登录/辅助功能授权。

## 结论

建议 **部分采纳,但暂不进入 runner 实现**。

理由:方向上,a11y tree -> 结构化元素清单 -> 点 bbox 中心,再以截图/视觉兜底,是控制台 computer-use 高分屏点偏问题的低风险路线。但现有离线样本只有历史截图、少量 Peekaboo 坐标/窗口元数据和一份 Safari a11y tree 空结果,没有成对的 `query + target_bbox + candidate_bbox/point + screenshot + a11y tree` 标注集。因此本轮只能完成 schema、评测口径、风险和许可证 gate;不能声称 a11y 路线已经比裸像素准确。

第二步建议改成一个更小的前置 gate:先做 **离线样本标注包**,只对已有历史截图补标 target bbox,并允许导入已沉淀的 a11y tree JSON;样本数达到至少 20 个、可复算 hit-rate 和 center deviation 后,再决定是否实现动作前 grounding。

## 输入与样本来源

| 来源 | 本轮用途 | 证据 |
|---|---|---|
| CEO brief | 立项边界与验收 | `projects/控制台/brief.md:10947` |
| 董事会记忆 | 重要架构任务默认执行与本任务董事会记录 | `memory/decisions.md:13`, `memory/decisions.md:542` |
| slot 20260624-12 | OmniParser / OSWorld / ShowUI 三例来源 | `board/insights/insights.md:1275` |
| 第二十二批 a11y 主线 | macapptree / macOS-use 方向来源 | `board/insights/insights.md:795`, `board/insights/insights.md:806` |
| 已有 a11y tree | Safari inspect_ui 样本,元素数为 0 | `projects/控制台/artifacts/office-agent-rename-20260623/safari-ui-tree.json:1` |
| 已有截图/交互样本 | 任务板 4 张历史截图与 DOM 状态转移证据 | `projects/控制台/artifacts/running-task-interaction-20260622/peekaboo-current-20260622/report.json:16` |
| 已有坐标体系样本 | Quark 窗口截图记录 `global_display_points` / `scale_factor` / `logical_bounds` | `projects/控制台/artifacts/task-board-refine/screenshot-quark-20260620-012456.json:15` |
| 已有点击坐标样本 | Peekaboo foreground click 使用 `global` 坐标 `(1,1)` | `projects/控制台/artifacts/peekaboo-baseline/20260619-102106/click-foreground-smoke.stdout.txt:7` |

本轮没有新开截图采集。上表中的截图和 JSON 均为既有归档。

## 可复算评测口径

### 样本定义

一个可进入 accuracy 评测的样本必须同时具备:

1. `screenshot_path`
2. `query` 或目标描述
3. `target_bbox_px = {x,y,w,h}` 人工或既有标注
4. 至少一个候选输出:`a11y_candidate_bbox_px` 或 `pixel_candidate_point_px`
5. `coordinate_space`, `screen_scale`, `display_id`, `window_bbox`, `timestamp`

### 指标定义

| 指标 | 公式 | 说明 |
|---|---|---|
| `center_deviation_px` | `sqrt((candidate_cx - target_cx)^2 + (candidate_cy - target_cy)^2)` | 以物理像素为准;如果候选是 bbox,取候选中心。 |
| `hit_rate` | `hits / evaluable_samples` | 点候选中心落在 target bbox 内即 hit;如果输出 bbox,另算 `bbox_iou >= 0.5` 命中。 |
| `bbox_iou` | `area(intersection(candidate,target)) / area(union(candidate,target))` | 仅 bbox 输出可算。 |
| `failure_type` | 枚举 | `no_a11y_node`, `stale_a11y_node`, `webview_missing_bbox`, `scale_mismatch`, `window_offset_mismatch`, `visual_only_miss`, `privacy_redacted`。 |

### 本轮离线样本统计

| 统计项 | 数值 | 证据/口径 |
|---|---:|---|
| 历史截图样本数 | 5 | 任务板 4 张 + Peekaboo baseline `smoke.png`;均为既有文件。 |
| 已有 a11y tree 样本数 | 1 | Safari `inspect_ui`;`element_count=0`, `actionable_count=0`。 |
| 成对 bbox accuracy 可评测样本数 | 0 | 现有样本缺 `target_bbox` 与同屏 a11y candidate 配对。 |
| a11y tree actionable coverage | 0/1 = 0% | `safari-ui-tree.json` 记录 `element_count=0`, `actionable_count=0`。 |
| 既有 DOM 状态转移成功率 | 2/2 = 100% | queued click 与 outside click 前后状态均符合预期,但该项不是 grounding accuracy,因为 click 由 browser script 派发。 |
| 可复算 `center_deviation_px` | N/A, n=0 | 没有 paired target bbox,不能计算。 |
| 可复算 `hit_rate` | N/A, n=0 | 没有 paired target bbox,不能计算。 |

判定:当前样本足以证明“需要 schema 和坐标系约束”,不足以证明“a11y 比裸像素更准”。第二步实现前必须先补离线标注包。

## a11y JSON Schema 草案

本 schema 只记录动作前 grounding 所需的最小字段,默认不落 name/value 原文到长期日志;需要文本匹配时先脱敏、截断并标注来源。

```json
{
  "schema_version": "a11y_snapshot.v0",
  "snapshot_id": "uuid",
  "timestamp": "2026-06-24T09:39:16.793Z",
  "source_app": {
    "bundle_id": "com.example.App",
    "name_redacted": "hash-or-safe-name",
    "pid": 1234
  },
  "coordinate_context": {
    "coordinate_space": "global_display_points",
    "pixel_space": "physical_pixels",
    "screen_scale": 2,
    "display_id": "main",
    "screen_index": 0,
    "window_id": 1106,
    "window_bbox_points": {"x": 104, "y": 81, "w": 2386, "h": 1247},
    "screenshot_size_pixels": {"w": 4772, "h": 2494}
  },
  "privacy": {
    "redaction_policy": "no_password_no_token_no_cookie; text fields hash_or_truncate",
    "sensitive_fields_removed": ["AXValue", "AXSelectedText", "AXURL"],
    "max_text_chars": 80
  },
  "elements": [
    {
      "element_id": "stable-hash-of-path-role-bbox",
      "role": "AXButton",
      "subrole": null,
      "name": {"text_redacted": "safe label or hash", "hash": "sha256"},
      "value": {"redacted": true},
      "enabled": true,
      "visible": true,
      "focused": false,
      "bbox_points": {"x": 10, "y": 20, "w": 80, "h": 32},
      "bbox_pixels": {"x": 20, "y": 40, "w": 160, "h": 64},
      "visible_bbox_points": {"x": 10, "y": 20, "w": 80, "h": 32},
      "element_path": [0, 3, 2],
      "sibling_index": 2,
      "child_count": 0,
      "actions": ["press"],
      "staleness": {
        "snapshot_age_ms": 0,
        "api_async_update_risk": "unknown"
      }
    }
  ]
}
```

坐标约定:

- `bbox_points` 对齐 macOS Accessibility/Peekaboo 逻辑点坐标。
- `bbox_pixels` 必须由 `screen_scale` 显式换算,不能隐式假设 Retina scale。
- `window_bbox_points` 与 `screenshot_size_pixels` 必须同时保存,避免窗口偏移、多显示器和裁剪截图造成误点。
- eventlog 只保存 `snapshot_id`,指标、bbox 和脱敏摘要;禁止保存密码框/token/cookie/验证码/完整路径等敏感文本。

已知边界:

- macOS Accessibility API 有异步更新延迟,元素可能已消失但 tree 未刷新;点击前需要 timestamp 与 snapshot_age gate。
- WebView、Canvas、自绘 UI、游戏画布和部分 Electron 控件可能缺 bbox 或语义不准;必须回退现有视觉路径。
- 滚动容器内元素需要记录容器 bbox 与滚动偏移,否则同一元素的 screen bbox 解释会漂移。

## 截图分块策略对照

| 策略 | 适用场景 | 是否需视觉模型 | 本地可跑性 | 风险 |
|---|---|---|---|---|
| 固定网格分块 | 大屏粗定位、无语义场景 | 否 | 最高,纯规则 | 易切断按钮/文本,对小图标帮助有限。 |
| DOM/a11y bbox 分块 | 控件有 OS/DOM 结构化 bbox | 否 | 高,但需辅助功能授权 | WebView/Canvas 缺失;stale tree 会误导。 |
| 交互候选膨胀分块 | 已知候选 bbox 周围二次放大 | 否或轻量视觉 | 高,可作为 a11y 回退前处理 | 候选错则越放越错。 |
| RegionFocus 式裁剪重查 | 目标小、首轮不确定或高分屏密集界面 | 是,复用现有视觉模型 | 中,不新训模型但多一次视觉调用 | 成本/延迟上升,需记录裁剪坐标换算。 |
| OmniParser/set-of-marks | 纯截图生成可点元素清单 | 是,检测/OCR/ caption 模型 | 低到中;需要 Python/模型,部分权重许可复杂 | 受模型许可、GPU/延迟和小控件误检影响。 |
| ShowUI/端到端 VLA | 裸截图直接输出动作点 | 是,VLM/VLA | 中到低;可本地但需权重/GPU或 vLLM | 本轮不引权重;商业许可需逐项复核。 |

## 方案 x 许可证 x 本地可跑性 x 是否需视觉模型

| 方案/来源 | 许可证速查 | 本地可跑性 | 是否需视觉模型 |
|---|---|---|---|
| OmniParser | GitHub 根 LICENSE 为 CC-BY-4.0;HF `microsoft/OmniParser-v2.0` 页面标 license MIT,但模型卡说明 `icon_detect` 为 AGPL、`icon_caption` 为 MIT;商用/分发前需人工复核。Sources: https://github.com/microsoft/OmniParser , https://huggingface.co/microsoft/OmniParser-v2.0 | 可本地跑但需要 Python 与检测/caption 权重;不进入本轮。 | 是 |
| OSWorld | GitHub 仓库 Apache-2.0;网站/数据另需按各自条款核对。Source: https://github.com/xlang-ai/OSWorld | 作为 benchmark 需 VM/Docker/AWS 等环境;本轮只借评测口径。 | 不一定;benchmark 可评各种 agent。 |
| ShowUI | GitHub 代码 Apache-2.0;HF `showlab/ShowUI-2B` 标 MIT。初始 brief 提到 CC-BY-NC/受限权重,因此本轮保守处理为“只借思路,不引权重/数据”。Sources: https://github.com/showlab/ShowUI , https://huggingface.co/showlab/ShowUI-2B | 可通过 HF/Transformers/vLLM 跑,但需模型权重和 GPU/大内存;不进入本轮。 | 是 |
| macapptree | MIT。Source: https://github.com/MacPaw/macapptree | macOS + Python + PyObjC + Accessibility 授权;本轮只借 JSON 形态。 | 否 |
| macOS-use | `browser-use/macOS-use` MIT;危险动作警告明确,登录/验证码/凭据风险必须保留人审门。Source: https://github.com/browser-use/macOS-use | macOS + Python/MLX + LLM provider;本轮不安装不运行。 | 主路径 a11y,可配 LLM/视觉兜底。 |

## 第二步建议

不建议现在直接改 computer-use runner。建议下一步只批准一个更窄、仍可逆的离线数据 gate:

1. 只使用既有截图文件补 `query + target_bbox_px + failure_type` 标注,不少于 20 个样本。
2. 样本必须记录 `coordinate_space`, `screen_scale`, `display_id`, `window_bbox`, `screenshot_size_pixels`。
3. 指标必须输出 `center_deviation_px`, `hit_rate`, `bbox_iou`(如有 bbox candidate),以及失败类型分布。
4. a11y tree 采集若需要系统授权,只列手动步骤交主人;未授权时不采集、不绕过。
5. 达到样本 gate 后,才考虑最小实现:动作前取 a11y 元素清单 -> 模型在清单上选元素 -> 点 bbox 中心 -> a11y 缺失或低置信时回退现有视觉。

## 验收表

| 要点 | 完成状态(完成/部分/未完成) | 证据位置(文件:行 / git diff / 截图路径) | 备注 |
|---|---|---|---|
| 设计对照 memory/decisions.md:542 任务:由 CEO 决定是否立项:评估 a11y tree 序列化与截图分块方案,先做只读探查与离线评测,商用权重(如 ShowUI 的 CC-BY-NC)一律仅作思路借鉴 | 完成 | `memory/decisions.md:542`; `board/a11y-grounding-readonly-eval-2026-06-24.md:1` | 报告落 `board/`,只读评测,未改 runner,未引受限权重。 |
| 设计对照 memory/decisions.md:13 **董事会评议机制**(2026-06-21):重要架构任务必须先由 DeepSeek(new-api)、GLM-5.2(zhipu-glm)、GPT-5.5(codex)、Opus-4.8(claude) 四董事挑刺评议,最多 3 轮;默认安全直接执行,唯一阻断是第 3 轮后 Opus 仍判误判风险,此时生成需主人点击的决策卡。 | 完成 | `memory/decisions.md:13`; `projects/控制台/brief.md:10948`; `memory/decisions.md:541` | brief 已含四董事修订;本次按 memory 记录 `默认执行` 落报告。 |
| 设计对照 memory/decisions.md:12 **GLM-5.2 定位**(2026-06-20):去掉「智谱设计师」这个窄角色;GLM-5.2(走 new-api,老板充了会员、token 多、编程强)**保留为通用模型 runner**,后续承接编程/通用任务,可作 worker_code 的补充以省 codex/claude 额度。 | 完成 | `memory/decisions.md:12`; `shared/knowledge/engineering/worker-code-handoff.md:12` | 本轮 worker_code 由 Codex 执行;未改 GLM runner 定位。 |
| 设计对照 memory/decisions.md:65 理由:粒度改分钟方向对,但CEO根因诊断经代码核实为错(后端多处写started_at且server.js:1929已做enqueued_at兜底),被否两轮的enqueued_at喂运行芯片方案仍在、配合宽松验收会放行'刚启动就显示运行N分钟'的错误执行,故误判风险为真;带'只用真实运行起点+静态兜底文案+收紧验收'修订后可执行。 | 完成 | `memory/decisions.md:65`; `board/a11y-grounding-readonly-eval-2026-06-24.md:35` | 本轮继承“收紧验收”原则,明确无 paired bbox 时不放行准确率结论。 |
| 设计对照 memory/decisions.md:22 理由:第3轮 Opus 未判误判风险,按方案默认执行。 | 完成 | `memory/decisions.md:22`; `memory/decisions.md:541` | 本任务对应董事会记录为单轮默认执行,无第 3 轮 Opus 阻断。 |
| 设计对照 memory/decisions.md:44 理由:第3轮 Opus 未判误判风险,按方案默认执行。 | 完成 | `memory/decisions.md:44`; `memory/decisions.md:541` | 同样按默认执行机制处理;本轮未触发硬阻断或决策卡。 |
| 任务验收: 在 控制台 项目 scope 内跑 review-loop | 完成 | `node shared/engine/demo.js` exit 0; `node projects/控制台/tools/serial-smoke-test.js` exit 0 | 已在控制台 workspace 执行 review-loop demo 与 serial smoke;serial smoke 临时 runRoot 未用作评测证据并已移除,避免保留新截图采集。 |
| 任务验收: 完成后更新 projects/控制台/status.md,并由系统增量更新 board/status-rollup.md。 | 完成 | `projects/控制台/status.md:25`; `board/status-rollup.md:18` | 已追加控制台 status 与 rollup 摘要;行号按当前文件重核。 |
| 视觉/UI证据: peekaboo截图路径 + opus-4.8对照设计挑错报告 | 完成 | `projects/控制台/artifacts/running-task-interaction-20260622/peekaboo-current-20260622/03-queued-click-expanded-selected.png`; `projects/控制台/artifacts/a11y-grounding-readonly-eval-20260624/opus48-visual-scope-review.md:1` | 本任务无 UI 改动;截图仅作为既有离线样本,Opus-4.8 明确不能当新 UI 验收证据。 |
