---
name: yuhua
description: "Use when the user says 玉华, asks to apply the fixed OpenClaw/Hermes material style, reduce AI-like writing in business materials, or requests PPT/PPTX/poster/table-image cleanup with the red #C00000 palette, all 微软雅黑 fonts, editable PowerPoint components, readable tables, no text overflow, and delivery-ready visual QA."
---

# 玉华

玉华 is the user's persistent formatting and layout guard for business/technical materials, especially OpenClaw + Hermes mixed-deployment decks, comparison posters, architecture diagrams, and one-page summaries.

## Scope

Use this skill to enforce final visual standards. It does not replace `Presentations` for PPTX creation or `imagegen` for raster artwork; it adds the user's locked style, typography, table, and QA rules before delivery.

## Fixed Style Rules

- Default language is Chinese unless the user asks otherwise.
- Use `#C00000` for every intentional accent or colorful emphasis: headers, pills, icons, rules, highlights, robot eyes, category tags, table headers, and diagram connectors.
- Keep backgrounds simple and mostly neutral: white, near-white, light gray, and very pale red are acceptable. Avoid multi-color palettes, decorative blobs, busy comic detail, and heavy gradients.
- Use `微软雅黑` for all text. This includes slide text, table text, chart labels, footer notes, theme fonts, master/default fonts, and any XML-level typeface declarations in PPTX.
- For PowerPoint tables, set body cells to `11 pt 微软雅黑` and table headers to `12 pt 微软雅黑` unless the user explicitly changes the sizes.
- Make text readable at normal PPT viewing size. If text feels small, simplify copy or enlarge the block instead of squeezing it.
- Keep layouts concise. Merge thin slides when possible, prefer clear comparison tables and labeled flows over dense prose.
- Use simple, slightly technical robot/assistant marks when helpful, but do not make the robot overly Q-style or mascot-heavy.

## PPTX Requirements

- Final output must be real `.pptx`, not an image renamed as PPTX.
- Keep components editable: text boxes, tables, shapes, connectors, and diagrams should remain manipulable in PowerPoint.
- Do not flatten tables or diagrams into a single screenshot unless the user explicitly asks for a non-editable image.
- If exporting a 16:9 image from PPT/materials, keep the PPT source editable alongside the exported image when possible.
- Use the requested filename exactly when the user gives one.

## Content Structure Rules

- Avoid vague claims. State the deployment option, supported functions, unsupported functions, strengths, weaknesses, cost/price, and recommended scenario.
- Reduce AI-like writing. Prefer concrete scenes, visible tradeoffs, and a clear recommendation over balanced but forgettable prose.
- For OpenClaw + Hermes materials, preserve this division:
  - `OpenClaw`: unified entry, login/session/permission, receiving Feishu/web/voice/Codex/file requests.
  - `Hermes`: task classification, security/cost routing, local/cloud/tool dispatch, queue/retry/logging.
  - `Local`: local LLM, embedding/rerank, RAG/document library, offline image generation, private data handling.
  - `Cloud/API`: paid closed-source models, high-quality public creative work, video generation, large multimodal tasks, variable per-call cost and latency.
- Include concrete business routes for common functions when relevant: PPT MCP, offline image generation, Hermes self-built document library, department AI Q&A assistant, Codex automation, Feishu entry, web entry, and voice entry.
- Put terminology notes at the bottom when using professional terms. Explain terms in plain Chinese, not as another dense glossary.

## Low AI-Flavor Writing Rules

Use these rules whenever the user asks for fewer AI traces, less AI flavor, more human copy, or when business material reads too polished but forgettable:

- Lead with a decision, not a neutral frame. Prefer `先做入口试点，再补 GPU` over `需要综合考虑不同阶段需求`.
- Replace abstract words with scenes. Prefer `员工在飞书里丢一个合同，系统先判断能不能出域` over `提升部门协同效率`.
- Keep one or two sharp tradeoffs. Say what is good and what is annoying: `本地问答便宜又安全，但前期要买显卡和维护模型`.
- Avoid filler phrases such as `总的来说`, `综上所述`, `在实际场景中`, `需要根据实际情况灵活调整`, `赋能`, `闭环`, `体系化`, `全面提升`, and `多维度`.
- Do not over-explain every concept. Keep the main slide blunt and useful; put terms in the footer note.
- Use short sentences with verbs. Prefer `OpenClaw 接请求，Hermes 选路线` over `OpenClaw 与 Hermes 共同构成任务处理能力`.
- Keep a little human judgment. Words like `先别`, `够用`, `不急着`, `容易踩坑`, and `跑通后再加钱` are acceptable in internal方案 material when they clarify the recommendation.
- Remove ornamental symmetry. If two columns do not need the same length, do not pad one side with vague words.
- For tables, use noun phrases and concrete examples instead of complete report-style paragraphs.
- After rewriting, read the slide title and first sentence aloud. If it sounds like a consulting template, rewrite it once more.

## Layout QA

Before delivery, inspect rendered previews, not just source code:

1. Check every slide/page at full preview size and contact-sheet size.
2. Verify no text crosses a table cell, block, footer, or page edge.
3. Ensure table cells have visible left/right padding and do not touch borders.
4. Ensure every flow/architecture block states its entry, usage端, processing layer, execution layer, and return channel when the slide is technical architecture.
5. Confirm slide 4-style architecture pages do not overcrowd the center four blocks; enlarge blocks or reduce copy before reducing text below readable size.
6. Re-render after each layout fix and inspect again.

## Font And Color Audit

For PPTX deliverables, unzip or script-check the package before upload/send:

- All `typeface="..."` entries must be `typeface="微软雅黑"`.
- There must be no `Calibri`, `Calibri Light`, `+mn-lt`, `+mn-ea`, `+mn-cs`, or `+mj-lt` residual theme fonts.
- Old accent colors from previous variants should be absent when the user has locked `#C00000`, including `#2F6BDE`, `#0E948D`, `#7A4DDE`, `#D98A00`, `#0F9F6E`, `#C94A4A`, `#1261A6`, and `#5DE1FF`.
- `unzip -t` should pass.

Use `scripts/normalize_pptx_fonts.mjs` when a generated deck visually uses 微软雅黑 but still contains theme/default font leftovers.

Example:

```bash
node /Users/yutu/.codex/skills/yuhua/scripts/normalize_pptx_fonts.mjs \
  input.pptx output.pptx 微软雅黑
```

Then audit with commands like:

```bash
rm -rf /tmp/yuhua-pptx-check && mkdir -p /tmp/yuhua-pptx-check
unzip -q output.pptx -d /tmp/yuhua-pptx-check
rg -o 'typeface="[^"]+"' /tmp/yuhua-pptx-check | sort | uniq -c
rg -i 'Calibri|\+mn-|\+mj-' /tmp/yuhua-pptx-check || true
unzip -t output.pptx
```

## Image Poster Rule

If the user asks for a text-heavy 16:9 image or comic poster, prefer building it with editable PPT/HTML/canvas and exporting a PNG. Use image generation for background or character art only when it improves the page. Do not rely on image generation to typeset large Chinese tables, because text placement and Chinese glyph accuracy are fragile.

## Delivery

- For iterative revisions of the same material, proactively increment the `V` suffix in the filename instead of reusing the old name or relying on Quark/Feishu to append `(1)`. Example: `爱马仕龙虾混合部署方案V1.pptx` should become `爱马仕龙虾混合部署方案V2.pptx`, then `V3.pptx`.
- Current remembered preference for the OpenClaw/Hermes deck: the next modified deliverable should use `爱马仕龙虾混合部署方案V6.pptx` unless the user gives a different name.
- When uploading to Quark, use the incremented filename before upload so the cloud folder shows a clean version number.
- When uploading/sending final materials, report the exact file name and destination. If Quark upload is requested, verify the destination folder shows the uploaded file before final response.
