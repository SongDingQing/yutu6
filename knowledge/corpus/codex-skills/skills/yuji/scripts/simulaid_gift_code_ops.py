#!/usr/bin/env python3
"""Small helpers for Simulaid gift-code registry, Excel exports, and reward icons.

The script intentionally prints concise summaries only. Do not dump workbook XML.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple


@dataclass
class GiftCodeRow:
    code: str
    name: str
    version: str
    validity: str
    reward: str
    note: str


def parse_registry(path: Path) -> List[GiftCodeRow]:
    rows: List[GiftCodeRow] = []
    pattern = re.compile(
        r"^\|\s*`(?P<code>[A-Z]{8,16})`\s*"
        r"\|\s*(?P<name>[^|]+?)\s*"
        r"\|\s*(?P<version>[^|]+?)\s*"
        r"\|\s*(?P<validity>[^|]+?)\s*"
        r"\|\s*(?P<reward>[^|]+?)\s*"
        r"\|\s*(?P<note>[^|]+?)\s*\|"
    )
    for line in path.read_text(encoding="utf-8").splitlines():
        match = pattern.match(line)
        if not match:
            continue
        rows.append(GiftCodeRow(**{key: value.strip() for key, value in match.groupdict().items()}))
    return rows


def select_rows(rows: Sequence[GiftCodeRow], codes: Optional[Sequence[str]]) -> List[GiftCodeRow]:
    if not codes:
        return list(rows)
    by_code = {row.code: row for row in rows}
    missing = [code for code in codes if code not in by_code]
    if missing:
        raise SystemExit("Missing codes in registry: " + ", ".join(missing))
    return [by_code[code] for code in codes]


def cmd_list(args: argparse.Namespace) -> None:
    rows = select_rows(parse_registry(Path(args.registry)), args.codes)
    if args.json:
        print(json.dumps([row.__dict__ for row in rows], ensure_ascii=False, indent=2))
        return
    for row in rows:
        print(f"{row.code}\t{row.name}\t{row.version}\t{row.reward}")
    print(f"count={len(rows)}")


def cmd_export_excels(args: argparse.Namespace) -> None:
    from openpyxl import Workbook

    rows = select_rows(parse_registry(Path(args.registry)), args.codes)
    out_dir = Path(args.out_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)
    outputs: List[Path] = []
    for index, row in enumerate(rows, start=1):
        wb = Workbook()
        ws = wb.active
        ws.title = args.sheet_name
        for excel_row in range(1, args.rows + 1):
            ws.cell(row=excel_row, column=1, value=row.code)
        output = out_dir / f"{args.prefix}{index:02d}_codes_{args.rows}.xlsx"
        wb.save(output)
        outputs.append(output)
    for output in outputs:
        print(output)
    print(f"files={len(outputs)} rows_each={args.rows}")


def parse_asset_spec(spec: str) -> Tuple[str, int, str]:
    parts = spec.split(":", 2)
    name = parts[0]
    count = 1
    label = ""
    if len(parts) >= 2 and parts[1]:
        count = int(parts[1])
    if len(parts) >= 3:
        label = parts[2]
    return name, count, label


def resolve_asset(asset_root: Path, name: str) -> Path:
    raw = Path(name).expanduser()
    if raw.is_absolute() and raw.exists():
        return raw
    candidates = []
    if raw.suffix:
        candidates.append(asset_root / raw)
    else:
        candidates.append(asset_root / f"{name}.png")
        candidates.append(asset_root / name)
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise SystemExit(f"Missing reward icon asset: {name}")


def load_font(size: int):
    from PIL import ImageFont

    for path in (
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            pass
    return ImageFont.load_default()


def crop_alpha(image):
    bbox = image.getbbox()
    return image.crop(bbox) if bbox else image


def cmd_make_reward_image(args: argparse.Namespace) -> None:
    from PIL import Image, ImageDraw

    asset_root = Path(args.asset_root).expanduser()
    specs = [parse_asset_spec(spec) for spec in args.asset]
    if not specs:
        raise SystemExit("At least one --asset is required")

    size = args.size
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    label_font = load_font(max(11, size // 11))
    badge_font = load_font(max(13, size // 9))

    n = len(specs)
    if n == 1:
        boxes = [(size * 0.16, size * 0.10, size * 0.84, size * 0.78)]
    elif n == 2:
        boxes = [(size * 0.06, size * 0.16, size * 0.50, size * 0.66), (size * 0.50, size * 0.16, size * 0.94, size * 0.66)]
    elif n == 3:
        boxes = [
            (size * 0.06, size * 0.08, size * 0.50, size * 0.50),
            (size * 0.50, size * 0.08, size * 0.94, size * 0.50),
            (size * 0.28, size * 0.48, size * 0.72, size * 0.90),
        ]
    else:
        boxes = [
            (size * 0.06, size * 0.06, size * 0.50, size * 0.48),
            (size * 0.50, size * 0.06, size * 0.94, size * 0.48),
            (size * 0.06, size * 0.48, size * 0.50, size * 0.90),
            (size * 0.50, size * 0.48, size * 0.94, size * 0.90),
        ]

    for (name, count, label), box in zip(specs[:4], boxes):
        path = resolve_asset(asset_root, name)
        icon = crop_alpha(Image.open(path).convert("RGBA"))
        x0, y0, x1, y1 = [int(v) for v in box]
        max_w = max(1, x1 - x0)
        max_h = max(1, y1 - y0)
        icon.thumbnail((max_w, max_h), Image.Resampling.LANCZOS)
        px = x0 + (max_w - icon.width) // 2
        py = y0 + (max_h - icon.height) // 2
        canvas.alpha_composite(icon, (px, py))

        if count != 1:
            badge = f"×{count}"
            tx = x1 - max(34, size // 4)
            ty = y1 - max(24, size // 6)
            draw.rounded_rectangle((tx, ty, x1 - 2, y1 - 2), radius=8, fill=(20, 38, 54, 220), outline=(255, 220, 110, 230), width=2)
            draw.text((tx + 4, ty + 1), badge, font=badge_font, fill=(255, 238, 170, 255))
        if label:
            draw.text((x0, y1 - 14), label, font=label_font, fill=(255, 238, 170, 255))

    output = Path(args.output).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output)
    print(output)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Simulaid gift-code helper")
    sub = parser.add_subparsers(dest="command", required=True)

    list_parser = sub.add_parser("list", help="List gift codes from registry")
    list_parser.add_argument("--registry", default="/Users/yutu/Simulaid/GIFT_CODE_REGISTRY.md")
    list_parser.add_argument("--codes", nargs="*")
    list_parser.add_argument("--json", action="store_true")
    list_parser.set_defaults(func=cmd_list)

    export_parser = sub.add_parser("export-excels", help="Export one no-header Excel per code")
    export_parser.add_argument("--registry", default="/Users/yutu/Simulaid/GIFT_CODE_REGISTRY.md")
    export_parser.add_argument("--codes", nargs="*")
    export_parser.add_argument("--rows", type=int, default=4000)
    export_parser.add_argument("--out-dir", default="/Users/yutu/Downloads")
    export_parser.add_argument("--prefix", default="simulaid_signin_day")
    export_parser.add_argument("--sheet-name", default="礼包码")
    export_parser.set_defaults(func=cmd_export_excels)

    image_parser = sub.add_parser("make-reward-image", help="Composite reward icons into a PNG")
    image_parser.add_argument("--asset-root", default="/Users/yutu/Simulaid/Assets/Resources/GeneratedPixel")
    image_parser.add_argument("--asset", action="append", default=[], help="resource[:count[:label]], repeatable")
    image_parser.add_argument("--output", required=True)
    image_parser.add_argument("--size", type=int, default=144)
    image_parser.set_defaults(func=cmd_make_reward_image)

    return parser


def main(argv: Optional[Sequence[str]] = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
