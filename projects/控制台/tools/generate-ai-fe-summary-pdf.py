#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable,
    Image,
    KeepTogether,
    LongTable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

CONTROL_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = CONTROL_ROOT.parents[1]
SCREENSHOT_DIR = CONTROL_ROOT / "artifacts" / "ai-fe-upgrade" / "screenshots"

NAVY = colors.HexColor("#172238")
BLUE = colors.HexColor("#3B76C5")
PALE_BLUE = colors.HexColor("#EAF2FC")
INK = colors.HexColor("#1D2735")
MUTED = colors.HexColor("#647184")
LINE = colors.HexColor("#D8E0EA")
GREEN = colors.HexColor("#178A60")
AMBER = colors.HexColor("#A56A10")
SOFT = colors.HexColor("#F5F7FA")
FONT_NAME = "YutuSans"
FONT_CANDIDATES = (
    Path(
        "/System/Library/AssetsV2/com_apple_MobileAsset_Font8/"
        "53fe5be564086fefc7523ccd0a31200acf92e0e5.asset/AssetData/STHEITI.ttf"
    ),
    Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
)


class AccentRule(Flowable):
    def __init__(self, width: float, color=BLUE, thickness: float = 2.0):
        super().__init__()
        self.width = width
        self.height = thickness
        self.color = color
        self.thickness = thickness

    def draw(self):
        self.canv.setFillColor(self.color)
        self.canv.rect(0, 0, self.width, self.thickness, stroke=0, fill=1)


def styles():
    font_path = next((path for path in FONT_CANDIDATES if path.is_file()), None)
    if font_path is None:
        raise FileNotFoundError("No embeddable CJK font was found")
    pdfmetrics.registerFont(TTFont(FONT_NAME, str(font_path)))
    base = getSampleStyleSheet()
    return {
        "cover_title": ParagraphStyle(
            "cover_title",
            parent=base["Title"],
            fontName=FONT_NAME,
            fontSize=27,
            leading=38,
            textColor=colors.white,
            alignment=TA_LEFT,
            spaceAfter=10,
            wordWrap="CJK",
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub",
            parent=base["BodyText"],
            fontName=FONT_NAME,
            fontSize=12,
            leading=20,
            textColor=colors.HexColor("#D3E3F9"),
            wordWrap="CJK",
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName=FONT_NAME,
            fontSize=19,
            leading=27,
            textColor=NAVY,
            spaceBefore=2,
            spaceAfter=9,
            wordWrap="CJK",
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName=FONT_NAME,
            fontSize=13,
            leading=19,
            textColor=INK,
            spaceBefore=8,
            spaceAfter=5,
            wordWrap="CJK",
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["BodyText"],
            fontName=FONT_NAME,
            fontSize=9.5,
            leading=16,
            textColor=INK,
            spaceAfter=6,
            wordWrap="CJK",
        ),
        "small": ParagraphStyle(
            "small",
            parent=base["BodyText"],
            fontName=FONT_NAME,
            fontSize=8,
            leading=12,
            textColor=MUTED,
            wordWrap="CJK",
        ),
        "metric": ParagraphStyle(
            "metric",
            parent=base["BodyText"],
            fontName=FONT_NAME,
            fontSize=18,
            leading=22,
            textColor=NAVY,
            alignment=TA_CENTER,
            wordWrap="CJK",
        ),
        "metric_label": ParagraphStyle(
            "metric_label",
            parent=base["BodyText"],
            fontName=FONT_NAME,
            fontSize=8,
            leading=12,
            textColor=MUTED,
            alignment=TA_CENTER,
            wordWrap="CJK",
        ),
        "table_head": ParagraphStyle(
            "table_head",
            parent=base["BodyText"],
            fontName=FONT_NAME,
            fontSize=8.5,
            leading=12,
            textColor=colors.white,
            alignment=TA_LEFT,
            wordWrap="CJK",
        ),
        "table": ParagraphStyle(
            "table",
            parent=base["BodyText"],
            fontName=FONT_NAME,
            fontSize=7.6,
            leading=11.5,
            textColor=INK,
            wordWrap="CJK",
        ),
        "caption": ParagraphStyle(
            "caption",
            parent=base["BodyText"],
            fontName=FONT_NAME,
            fontSize=8,
            leading=12,
            textColor=MUTED,
            alignment=TA_CENTER,
            wordWrap="CJK",
        ),
        "code": ParagraphStyle(
            "code",
            parent=base["Code"],
            fontName=FONT_NAME,
            fontSize=8,
            leading=12,
            textColor=colors.HexColor("#DDEBFF"),
            backColor=NAVY,
            borderPadding=7,
            wordWrap="CJK",
        ),
    }


def header_footer(canvas, doc):
    if doc.page == 1:
        return
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(18 * mm, A4[1] - 14 * mm, A4[0] - 18 * mm, A4[1] - 14 * mm)
    canvas.setFont(FONT_NAME, 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, A4[1] - 11 * mm, "玉兔6 AI 前端知识库优化总结")
    canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"{doc.page}")
    canvas.restoreState()


def cover(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
    canvas.setFillColor(colors.HexColor("#213C63"))
    canvas.rect(0, 0, 18 * mm, A4[1], fill=1, stroke=0)
    canvas.setFillColor(BLUE)
    canvas.rect(18 * mm, A4[1] - 48 * mm, A4[0] - 18 * mm, 4 * mm, fill=1, stroke=0)
    canvas.restoreState()


def metric_grid(S):
    values = [
        ("13", "升级任务"),
        ("15/15", "发布门通过"),
        ("7.025 秒", "发布门耗时"),
        ("0", "破图与横向溢出"),
        ("62,923 B", "主 JS gzip"),
        ("24,643 B", "工作区快照"),
    ]
    rows = []
    for offset in (0, 3):
        rows.append([Paragraph(f"<b>{values[i][0]}</b>", S["metric"]) for i in range(offset, offset + 3)])
        rows.append([Paragraph(values[i][1], S["metric_label"]) for i in range(offset, offset + 3)])
    table = Table(rows, colWidths=[54 * mm] * 3, rowHeights=[13 * mm, 8 * mm, 13 * mm, 8 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def upgrade_rows(S):
    data = [
        ("AI-FE-01", "版本化前端契约", "TypeScript 类型系统、运行时校验", "建立 decoder、路径化错误和 schemaVersion；兼容未知字段。"),
        ("AI-FE-02", "聚合快照与 ETag", "BFF、HTTP 缓存、减少瀑布", "新增 /api/workspace/snapshot；ETag/304；快照 24,643 B。"),
        ("AI-FE-03", "增量事件数据流", "事件序列、幂等、断档恢复", "游标、去重、乱序保护；断档回快照，不猜测状态。"),
        ("AI-FE-04", "渲染性能", "虚拟列表、局部更新", "1,000 行只渲染可见窗口；任务板独立滚动。"),
        ("AI-FE-05", "附件引用", "大对象分离、内容寻址", "图片先暂存，队列只传 ID/hash/path；7 天清理。"),
        ("AI-FE-06", "React 模块化", "feature 边界、错误隔离、懒加载", "Vite + React 18 + TypeScript；38 个源文件，多视图分块。"),
        ("AI-FE-07", "办公室与办公楼", "视觉资产和状态解耦", "保留像素资产；办公楼三状态；办公室 50 张图无破图。"),
        ("AI-FE-08", "工位与链路图", "图布局、信息分层", "24 个工位、25 个链路节点；主链、支撑和复核分层。"),
        ("AI-FE-09", "AI 任务详情", "结构化过程、隐私边界", "目标、验收、步骤、失败、模型和证据；不展示私有 prompt。"),
        ("AI-FE-10", "模型用量", "计量口径、缺失语义", "24h/7d/30d；订阅、本机日志、new-api 分开；未知写未计量。"),
        ("AI-FE-11", "控制室与 API 网关", "统一壳、请求取消、资源复用", "真实 NDJSON 流、runner 探测、网关概览；无新增 interval。"),
        ("AI-FE-12", "质量门瘦身", "测试金字塔、风险分层", "快门 8 项 6.145 秒；发布门 15 项 7.025 秒。"),
        ("AI-FE-13", "灰度与回滚", "基线、金丝雀、可逆发布", "/workspace 已切 React；legacy 保留；一条命令回滚。"),
    ]
    table_data = [[
        Paragraph("任务", S["table_head"]),
        Paragraph("升级", S["table_head"]),
        Paragraph("知识吸收", S["table_head"]),
        Paragraph("实际落地", S["table_head"]),
    ]]
    for task, title, knowledge, result in data:
        table_data.append([
            Paragraph(task, S["table"]),
            Paragraph(f"<b>{title}</b>", S["table"]),
            Paragraph(knowledge, S["table"]),
            Paragraph(result, S["table"]),
        ])
    table = LongTable(
        table_data,
        repeatRows=1,
        colWidths=[22 * mm, 33 * mm, 45 * mm, 67 * mm],
    )
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def screenshot_block(S, filename: str, caption: str, width=166 * mm):
    file = SCREENSHOT_DIR / filename
    if not file.exists():
        return Paragraph(f"截图缺失：{filename}", S["small"])
    image = Image(str(file))
    image._restrictSize(width, 94 * mm)
    return KeepTogether([
        image,
        Spacer(1, 2 * mm),
        Paragraph(caption, S["caption"]),
    ])


def build_pdf(output: Path):
    S = styles()
    output.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(output),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=20 * mm,
        bottomMargin=16 * mm,
        title="玉兔6 AI 前端知识库优化总结",
        author="玉兔6 Codex",
        subject="AI 前端设计题库驱动的工程升级总结",
    )
    story = []

    story.extend([
        Spacer(1, 46 * mm),
        Paragraph("玉兔6<br/>AI 前端知识库优化总结", S["cover_title"]),
        AccentRule(70 * mm, colors.HexColor("#6EA8FE"), 2.5),
        Spacer(1, 9 * mm),
        Paragraph("从 8 章、144 道 AI 前端设计题中提炼工程原则，并按 AI-FE-01 至 AI-FE-13 逐项落地。", S["cover_sub"]),
        Spacer(1, 55 * mm),
        Paragraph("React 18 + TypeScript | Node 零新增运行时依赖 | API 合同兼容 | 一键回滚", S["cover_sub"]),
        Spacer(1, 12 * mm),
        Paragraph("2026-07-17", S["cover_sub"]),
        PageBreak(),
    ])

    story.extend([
        Paragraph("执行摘要", S["h1"]),
        AccentRule(42 * mm),
        Spacer(1, 5 * mm),
        Paragraph(
            "AI-FE-01 至 AI-FE-13 已按依赖顺序完成实现和专项回归。"
            "<b>/workspace</b> 已切换为 React 构建，经典页保留在 <b>/workspace-legacy</b>。"
            "服务端继续保持零新增运行时依赖，既有 /api/* 合同未被破坏。",
            S["body"],
        ),
        Spacer(1, 4 * mm),
        metric_grid(S),
        Spacer(1, 7 * mm),
        Paragraph("这次没有机械照搬题库", S["h2"]),
        Paragraph(
            "没有引入微前端、CRDT、WebRTC 或浏览器直连模型 API。"
            "只选择能解决当前真实问题的契约、快照、事件流、虚拟列表、附件分离、可观测、测试分层和灰度回滚。",
            S["body"],
        ),
        Paragraph("当前状态", S["h2"]),
        Table([
            [Paragraph("<b>生产入口</b>", S["body"]), Paragraph("/workspace = React", S["body"])],
            [Paragraph("<b>回滚入口</b>", S["body"]), Paragraph("/workspace-legacy", S["body"])],
            [Paragraph("<b>服务 PID</b>", S["body"]), Paragraph("76327", S["body"])],
            [Paragraph("<b>长稳观察</b>", S["body"]), Paragraph("launchd com.yutu6.frontend-canary 正在运行；首样本健康", S["body"])],
        ], colWidths=[35 * mm, 125 * mm], style=TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.4, LINE),
            ("BACKGROUND", (0, 0), (0, -1), PALE_BLUE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ])),
        PageBreak(),
    ])

    story.extend([
        Paragraph("知识库到工程的映射", S["h1"]),
        AccentRule(58 * mm),
        Spacer(1, 5 * mm),
        Paragraph(
            "题库来源：/Users/yutu6/Documents/参考知识库/AI前端设计面试题库-2026/。"
            "下表把面试知识点转换为可验证、可回滚的生产改动。",
            S["body"],
        ),
        upgrade_rows(S),
        PageBreak(),
    ])

    story.extend([
        Paragraph("数据与交互架构升级", S["h1"]),
        AccentRule(52 * mm),
        Spacer(1, 5 * mm),
        Paragraph("改造前", S["h2"]),
        Paragraph(
            "单文件页面同时承担请求、状态、渲染和交互；多个接口并行拉取；任务和事件容易整块重绘；"
            "大图片以内联数据进入任务；任一脚本异常可能拖垮整页。",
            S["body"],
        ),
        Paragraph("改造后", S["h2"]),
        Table([
            [Paragraph("<b>服务端</b>", S["body"]), Paragraph("版本化 API -> 聚合快照 + ETag -> 增量事件 -> 安全附件引用", S["body"])],
            [Paragraph("<b>状态层</b>", S["body"]), Paragraph("规范化 store -> 序号幂等 -> 断档回快照 -> 模块级错误隔离", S["body"])],
            [Paragraph("<b>视图层</b>", S["body"]), Paragraph("React feature -> lazy chunk -> 可见窗口渲染 -> 结构化任务详情", S["body"])],
            [Paragraph("<b>发布层</b>", S["body"]), Paragraph("快门 -> 发布门 -> 视觉证据 -> 运行基线 -> 8 小时金丝雀 -> 自动回滚", S["body"])],
        ], colWidths=[30 * mm, 132 * mm], style=TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.45, LINE),
            ("BACKGROUND", (0, 0), (0, -1), PALE_BLUE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7),
            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ])),
        Spacer(1, 7 * mm),
        Paragraph("隐私边界", S["h2"]),
        Paragraph(
            "任务详情只展示结构化目标、验收、节点、状态和证据引用。"
            "服务端过滤 interaction-trace、原始 prompt、token、cookie、私钥和疑似密钥字段；"
            "前端不保存或展示模型私有思维链。",
            S["body"],
        ),
        Paragraph("资源边界", S["h2"]),
        Paragraph(
            "主 JavaScript gzip 为 62,923 B，CSS gzip 为 9,794 B；"
            "工作区快照 24,643 B。办公室、链路、用量、控制室、网关和设置均按需加载。",
            S["body"],
        ),
        PageBreak(),
    ])

    story.extend([
        Paragraph("质量门从堆叠改为分层", S["h1"]),
        AccentRule(52 * mm),
        Spacer(1, 5 * mm),
        Table([
            [Paragraph("门", S["table_head"]), Paragraph("何时运行", S["table_head"]), Paragraph("成本", S["table_head"]), Paragraph("防止的问题", S["table_head"])],
            [Paragraph("快门", S["table"]), Paragraph("每次前端或合同变更", S["table"]), Paragraph("8 文件 / 6.145 秒", S["table"]), Paragraph("类型、合同、快照、附件、模块和包体回归", S["table"])],
            [Paragraph("视觉门", S["table"]), Paragraph("只有 UI 像素或交互变化", S["table"]), Paragraph("浏览器截图", S["table"]), Paragraph("溢出、遮挡、破图、实页与自查不一致", S["table"])],
            [Paragraph("发布门", S["table"]), Paragraph("切默认路由或跨视图重构", S["table"]), Paragraph("15 文件 / 7.025 秒", S["table"]), Paragraph("设置、办公楼、E2E、路由和回滚", S["table"])],
            [Paragraph("长稳门", S["table"]), Paragraph("发布后", S["table"]), Paragraph("8 小时 / 60 秒采样", S["table"]), Paragraph("HTTP 失步、事件倒退、RSS 趋势和持续硬失败", S["table"])],
        ], colWidths=[23 * mm, 43 * mm, 35 * mm, 61 * mm], style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("GRID", (0, 0), (-1, -1), 0.45, LINE),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ])),
        Spacer(1, 8 * mm),
        Paragraph("一键回滚", S["h2"]),
        Paragraph("node projects/控制台/tools/set-workspace-ui.js legacy", S["code"]),
        Spacer(1, 3 * mm),
        Paragraph(
            "生产往返已实测：切到 legacy 后 React 构建标记为 0；恢复 React 后标记为 3。"
            "切换读取本机 600 权限状态文件，不需要改代码或重启服务。",
            S["body"],
        ),
        Paragraph("长稳说明", S["h2"]),
        Paragraph(
            "8 小时观察正在运行，尚未把未经过的时间提前算作成功。"
            "每 60 秒检查 /api/health、/api/workspace/snapshot、事件序号和 RSS。"
            "连续 3 次硬失败会自动切回 legacy。",
            S["body"],
        ),
        PageBreak(),
    ])

    story.extend([
        Paragraph("真实页面验收 - 工作区与设置", S["h1"]),
        AccentRule(68 * mm),
        Spacer(1, 4 * mm),
        screenshot_block(S, "ai-fe-13-workspace-default.png", "默认 /workspace：React 任务板、队列独立滚动、底部派单框。"),
        Spacer(1, 7 * mm),
        screenshot_block(S, "ai-fe-13-settings.png", "React 设置中心：预设档位、资源估算、已保存/未保存和安全重启。"),
        PageBreak(),
    ])

    story.extend([
        Paragraph("真实页面验收 - 办公室与可观测", S["h1"]),
        AccentRule(68 * mm),
        Spacer(1, 4 * mm),
        screenshot_block(S, "ai-fe-13-office-default.png", "办公室：保留认可的像素资产，状态来自真实队列。"),
        Spacer(1, 7 * mm),
        screenshot_block(S, "ai-fe-10-usage.png", "模型用量：来源与计量口径分开，未知明确显示未计量。"),
        PageBreak(),
    ])

    story.extend([
        Paragraph("真实页面验收 - 任务与管理", S["h1"]),
        AccentRule(62 * mm),
        Spacer(1, 4 * mm),
        screenshot_block(S, "ai-fe-09-task-detail.png", "结构化任务详情：目标、验收、当前步骤、失败原因和证据。"),
        Spacer(1, 7 * mm),
        screenshot_block(S, "ai-fe-11-control-room.png", "控制室：runner 探测、真实 NDJSON 聊天和事件账本。"),
        PageBreak(),
    ])

    story.extend([
        Paragraph("交付路径与后续观察", S["h1"]),
        AccentRule(58 * mm),
        Spacer(1, 5 * mm),
        Paragraph("关键文件", S["h2"]),
        LongTable([
            [Paragraph("总结 Markdown", S["table"]), Paragraph("projects/控制台/artifacts/ai-fe-upgrade/AI前端知识库优化总结-20260717.md", S["table"])],
            [Paragraph("质量门报告", S["table"]), Paragraph("projects/控制台/artifacts/ai-fe-upgrade/quality-gates/", S["table"])],
            [Paragraph("运行基线", S["table"]), Paragraph("projects/控制台/artifacts/ai-fe-upgrade/runtime-baseline.json", S["table"])],
            [Paragraph("长稳账本", S["table"]), Paragraph("projects/控制台/artifacts/ai-fe-upgrade/canary/", S["table"])],
            [Paragraph("视觉证据", S["table"]), Paragraph("projects/控制台/artifacts/ai-fe-upgrade/screenshots/", S["table"])],
            [Paragraph("React 构建", S["table"]), Paragraph("projects/控制台/public/app/", S["table"])],
        ], colWidths=[34 * mm, 128 * mm], style=TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.45, LINE),
            ("BACKGROUND", (0, 0), (0, -1), PALE_BLUE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ])),
        Spacer(1, 8 * mm),
        Paragraph("后续只需要观察，不需要重复改造", S["h2"]),
        Paragraph(
            "等待 8 小时金丝雀自然结束并查看 latest.json。"
            "经典页至少保留一个稳定版本周期；只有在确认没有 legacy 独有功能后，才另开任务清理旧页。",
            S["body"],
        ),
        Paragraph("最终判断", S["h2"]),
        Paragraph(
            "这轮升级把题库里的抽象知识变成了机器可验证的生产机制："
            "先保证数据可信，再控制渲染成本；先保留回滚，再切默认入口；"
            "只让有历史依据的门常驻，其余重门按风险唤醒。",
            S["body"],
        ),
    ])

    doc.build(story, onFirstPage=cover, onLaterPages=header_footer)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(os.path.expanduser(args.output)).resolve()
    build_pdf(output)
    print(output)


if __name__ == "__main__":
    main()
