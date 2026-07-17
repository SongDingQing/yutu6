#!/usr/bin/env python3
"""Generate the weekly Yutu6 quality-operations PDF from audited trace records."""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


FONT = "YutuUnicode"
ACCENT = colors.HexColor("#2869B0")
INK = colors.HexColor("#1E293B")
MUTED = colors.HexColor("#64748B")
PALE = colors.HexColor("#EAF2FB")
LINE = colors.HexColor("#CBD5E1")


def read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def parse_date(value: str | None) -> dt.date:
    if value:
        return dt.date.fromisoformat(value)
    return dt.datetime.now().date()


def in_window(value: str | None, start: dt.date, end: dt.date) -> bool:
    if not value:
        return False
    try:
        day = dt.datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return False
    return start <= day <= end


def load_results(root: Path, start: dt.date, end: dt.date) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for file in sorted((root / "quality-ops" / "audits").glob("**/results/*.json")):
        data = read_json(file, None)
        if not isinstance(data, dict):
            continue
        if in_window(data.get("ingested_at"), start, end):
            data["_file"] = str(file)
            rows.append(data)
    return rows


def p(text: Any, style: ParagraphStyle) -> Paragraph:
    value = "-" if text is None or text == "" else str(text)
    safe = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return Paragraph(safe, style)


def compact(text: Any, limit: int = 180) -> str:
    value = " ".join(str(text or "").split())
    return value if len(value) <= limit else value[: limit - 1] + "…"


def page_decor(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFont(FONT, 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 12 * mm, "玉兔6 · 质量运营周报")
    canvas.drawRightString(A4[0] - 18 * mm, 12 * mm, f"第 {doc.page} 页")
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 16 * mm, A4[0] - 18 * mm, 16 * mm)
    canvas.restoreState()


def build_report(artifacts: Path, output_dir: Path, end: dt.date) -> dict[str, Any]:
    start = end - dt.timedelta(days=6)
    qops = artifacts / "quality-ops"
    results = load_results(artifacts, start, end)
    ledger = read_json(qops / "review-ledger.json", {"reviews": [], "reservations": []})
    proposals = read_json(qops / "proposal-ledger.json", {"proposals": []})
    reviews = [row for row in ledger.get("reviews", []) if in_window(row.get("reviewed_at"), start, end)]
    week_proposals = [row for row in proposals.get("proposals", []) if in_window(row.get("created_at"), start, end)]

    verdicts = {"pass": 0, "warning": 0, "fail": 0}
    routes: dict[str, int] = {}
    findings: list[tuple[str, str, str]] = []
    for row in reviews:
        verdict = row.get("verdict", "warning")
        verdicts[verdict] = verdicts.get(verdict, 0) + 1
        route = row.get("route_key") or "unknown"
        routes[route] = routes.get(route, 0) + 1
    for result in results:
        for review in result.get("chain_reviews", []):
            for finding in review.get("findings", []):
                findings.append((review.get("verdict", "warning"), review.get("chain_id", "-"), compact(finding, 260)))

    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"玉兔质量运营报告-{end.isoformat()}.pdf"
    font_candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
        Path("/System/Library/Fonts/STHeiti Light.ttc"),
    ]
    font_file = next((item for item in font_candidates if item.exists()), None)
    if font_file is None:
        raise RuntimeError("No embeddable Unicode font found for Chinese PDF rendering")
    pdfmetrics.registerFont(TTFont(FONT, str(font_file), subfontIndex=0))
    doc = SimpleDocTemplate(
        str(output), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=20 * mm, bottomMargin=22 * mm,
        title=f"玉兔6质量运营周报 {start.isoformat()} - {end.isoformat()}",
        author="玉兔6质量运营",
    )
    styles = getSampleStyleSheet()
    title = ParagraphStyle("CNTitle", parent=styles["Title"], fontName=FONT, fontSize=22, leading=29, textColor=INK, spaceAfter=8)
    subtitle = ParagraphStyle("CNSub", parent=styles["Normal"], fontName=FONT, fontSize=10, leading=16, textColor=MUTED, spaceAfter=14)
    h1 = ParagraphStyle("CNH1", parent=styles["Heading1"], fontName=FONT, fontSize=15, leading=21, textColor=ACCENT, spaceBefore=10, spaceAfter=7)
    body = ParagraphStyle("CNBody", parent=styles["BodyText"], fontName=FONT, fontSize=9.3, leading=15, textColor=INK, alignment=TA_LEFT)
    small = ParagraphStyle("CNSmall", parent=body, fontSize=8.2, leading=13, textColor=MUTED)

    story: list[Any] = [
        p("玉兔6质量运营周报", title),
        p(f"统计周期：{start.isoformat()} 至 {end.isoformat()} · 数据来源：脱敏交互索引、抽查账本、质量运营待办", subtitle),
        p("本报告不保存或复述模型隐藏思维链；审计对象是显式 prompt、智能体交接、可观察输出、工具/文件证据与终态。", body),
        Spacer(1, 5 * mm),
        p("本周概览", h1),
    ]

    metric_data = [
        [p("已审链路", small), p("通过", small), p("警告", small), p("失败", small), p("待拍板提案", small)],
        [p(len(reviews), body), p(verdicts.get("pass", 0), body), p(verdicts.get("warning", 0), body), p(verdicts.get("fail", 0), body), p(len(week_proposals), body)],
    ]
    metrics = Table(metric_data, colWidths=[34 * mm] * 5, rowHeights=[9 * mm, 12 * mm])
    metrics.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PALE),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))
    story.extend([metrics, Spacer(1, 4 * mm)])

    pending = [r for r in ledger.get("reservations", []) if r.get("status") == "reserved"]
    story.append(p(
        f"本周完成 {len(results)} 个审计批次，覆盖 {len(routes)} 条角色/runner 路线；当前仍有 {len(pending)} 条抽查预留待完成。"
        "抽样账本按 chain_id + 内容指纹去重，避免反复检查同一条未变化链路。",
        body,
    ))

    story.append(p("线路覆盖与冷门线路", h1))
    route_rows = [[p("线路", small), p("本周抽查", small)]]
    for route, count in sorted(routes.items(), key=lambda item: (item[1], item[0]))[:16]:
        route_rows.append([p(compact(route, 120), body), p(count, body)])
    if len(route_rows) == 1:
        route_rows.append([p("本周尚无已完成抽查", body), p(0, body)])
    route_table = Table(route_rows, colWidths=[145 * mm, 25 * mm], repeatRows=1)
    route_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PALE),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 1), (1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(route_table)

    story.extend([PageBreak(), p("挑错发现", h1)])
    finding_rows = [[p("级别", small), p("链路", small), p("发现", small)]]
    for verdict, chain, finding in findings[:40]:
        finding_rows.append([p(verdict, body), p(chain, small), p(finding, body)])
    if len(finding_rows) == 1:
        finding_rows.append([p("-", body), p("-", body), p("本周无已入库的链路缺陷。", body)])
    finding_table = Table(finding_rows, colWidths=[18 * mm, 42 * mm, 110 * mm], repeatRows=1)
    finding_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PALE),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(finding_table)

    story.append(p("待主人拍板的沉淀建议", h1))
    proposal_rows = [[p("类别", small), p("建议", small), p("状态", small)]]
    for proposal in week_proposals[:30]:
        proposal_rows.append([
            p(proposal.get("category", "process"), body),
            p(compact(proposal.get("title"), 180), body),
            p("待拍板", body),
        ])
    if len(proposal_rows) == 1:
        proposal_rows.append([p("-", body), p("本周无新增沉淀建议。", body), p("-", body)])
    proposal_table = Table(proposal_rows, colWidths=[30 * mm, 112 * mm, 28 * mm], repeatRows=1)
    proposal_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PALE),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.extend([proposal_table, Spacer(1, 6 * mm), p(
        "运营原则：首周每天覆盖全部新增链路；第八天起采用不重复、冷门线路加权的随机抽查。"
        "任何建议只进入待办公告板，未经主人拍板不自动启用或修改生产系统。",
        small,
    )])

    doc.build(story, onFirstPage=page_decor, onLaterPages=page_decor)
    return {
        "ok": True,
        "output": str(output),
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "reviewed_chains": len(reviews),
        "audit_batches": len(results),
        "proposals": len(week_proposals),
        "bytes": output.stat().st_size,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifacts", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--end-date")
    args = parser.parse_args()
    result = build_report(Path(args.artifacts), Path(args.output_dir), parse_date(args.end_date))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
