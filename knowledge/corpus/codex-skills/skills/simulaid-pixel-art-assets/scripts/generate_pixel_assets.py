from argparse import ArgumentParser
from pathlib import Path

from PIL import Image, ImageDraw


DEFAULT_PROJECT = Path("/Users/yutu/Simulaid")
ITEM_SIZE = 64


P = {
    "clear": (0, 0, 0, 0),
    "ink": (7, 13, 26, 255),
    "navy0": (8, 18, 34, 255),
    "navy1": (15, 35, 62, 255),
    "navy2": (25, 59, 95, 255),
    "blue0": (18, 67, 111, 255),
    "blue1": (36, 105, 155, 255),
    "cyan": (99, 181, 220, 255),
    "ice": (183, 226, 244, 255),
    "white": (232, 245, 255, 255),
    "gold0": (176, 119, 34, 255),
    "gold1": (226, 177, 61, 255),
    "gold2": (249, 219, 105, 255),
    "orange": (198, 91, 43, 255),
    "red0": (139, 38, 55, 255),
    "red1": (205, 58, 78, 255),
    "green0": (42, 92, 55, 255),
    "green1": (63, 136, 77, 255),
    "green2": (102, 178, 103, 255),
    "soil0": (64, 40, 33, 255),
    "soil1": (96, 61, 43, 255),
    "soil2": (137, 88, 54, 255),
    "steel0": (76, 91, 111, 255),
    "steel1": (119, 142, 161, 255),
    "steel2": (177, 195, 207, 255),
    "purple0": (55, 45, 98, 255),
    "purple1": (99, 82, 169, 255),
    "purple2": (158, 136, 216, 255),
    "shadow": (3, 7, 14, 130),
}


def output_root(project: Path) -> Path:
    return project / "Assets" / "Resources" / "GeneratedPixel"


def canvas(width=ITEM_SIZE, height=ITEM_SIZE, bg=None):
    return Image.new("RGBA", (width, height), P["clear"] if bg is None else bg)


def draw(img):
    return ImageDraw.Draw(img)


def rect(d, box, color):
    d.rectangle(tuple(int(v) for v in box), fill=color)


def line(d, points, color, width=1):
    d.line(points, fill=color, width=width)


def box(d, xy, fill, outline=P["ink"], border=2):
    x0, y0, x1, y1 = xy
    rect(d, (x0, y0, x1, y1), outline)
    rect(d, (x0 + border, y0 + border, x1 - border, y1 - border), fill)


def diamond(d, cx, cy, r, fill, outline=P["ink"]):
    d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=outline)
    d.polygon([(cx, cy - r + 3), (cx + r - 3, cy), (cx, cy + r - 3), (cx - r + 3, cy)], fill=fill)


def ellipse(d, xy, fill, outline=P["ink"], width=2):
    d.ellipse(xy, fill=outline)
    inset = width
    d.ellipse((xy[0] + inset, xy[1] + inset, xy[2] - inset, xy[3] - inset), fill=fill)


def color_shift(color, amount):
    r, g, b, a = color
    if a == 0:
        return color
    return (
        max(0, min(255, r + amount)),
        max(0, min(255, g + amount)),
        max(0, min(255, b + amount)),
        a,
    )


def detail_texture(img, name):
    if img.width != ITEM_SIZE or img.height != ITEM_SIZE:
        return img

    seed = sum(ord(ch) for ch in name)
    source = img.copy()
    pixels = source.load()
    out = img.load()
    for y in range(2, img.height - 2):
        for x in range(2, img.width - 2):
            color = pixels[x, y]
            if color[3] == 0 or color == P["ink"] or color == P["shadow"]:
                continue

            has_air = (
                pixels[x - 1, y][3] == 0
                or pixels[x + 1, y][3] == 0
                or pixels[x, y - 1][3] == 0
                or pixels[x, y + 1][3] == 0
            )
            if has_air and (x + y + seed) % 4 == 0:
                out[x, y] = color_shift(color, 18)
            elif (x * 3 + y * 5 + seed) % 23 == 0:
                out[x, y] = color_shift(color, 10)
            elif (x * 7 + y * 2 + seed) % 31 == 0:
                out[x, y] = color_shift(color, -12)

    d = draw(img)
    for i in range(3):
        x = 12 + ((seed + i * 17) % 38)
        y = 10 + ((seed + i * 11) % 36)
        if pixels[x, y][3] != 0 and pixels[x, y] != P["ink"]:
            rect(d, (x, y, x + 1, y + 1), P["white"] if i == 0 else P["ice"])
    return img


def refined_asset(name, img):
    if img.width == ITEM_SIZE and img.height == ITEM_SIZE:
        return detail_texture(img, name)
    return img


def add_ground(d):
    rect(d, (8, 45, 55, 55), P["soil0"])
    rect(d, (10, 42, 53, 49), P["soil1"])
    rect(d, (12, 39, 51, 43), P["soil2"])
    for x in range(13, 50, 8):
        rect(d, (x, 46, x + 3, 47), P["gold0"])
        rect(d, (x + 1, 51, x + 5, 52), P["soil2"])


def crop_icon(kind):
    img = canvas()
    d = draw(img)
    add_ground(d)
    if kind == "wheat":
        for x in (18, 25, 32, 39, 46):
            line(d, [(x, 18), (x - 1, 42)], P["gold1"], 2)
            for y in (20, 25, 30):
                rect(d, (x - 5, y, x - 1, y + 3), P["gold1"])
                rect(d, (x + 1, y + 2, x + 5, y + 5), P["gold2"])
        rect(d, (14, 43, 50, 45), P["green0"])
    elif kind == "carrot":
        for x, h in ((15, 20), (28, 25), (42, 18)):
            d.polygon([(x, 22), (x + 9, 22), (x + 5, 22 + h)], fill=P["ink"])
            d.polygon([(x + 2, 24), (x + 7, 24), (x + 5, 20 + h)], fill=P["orange"])
            rect(d, (x + 2, 19, x + 8, 23), P["green1"])
            line(d, [(x + 5, 20), (x + 1, 12)], P["green2"], 2)
            line(d, [(x + 5, 20), (x + 10, 13)], P["green1"], 2)
            rect(d, (x + 4, 31, x + 6, 32), P["gold2"])
    elif kind == "tomato":
        for x, y in ((15, 25), (28, 19), (40, 27)):
            ellipse(d, (x, y, x + 13, y + 12), P["red1"], P["red0"], 2)
            rect(d, (x + 5, y - 3, x + 8, y + 1), P["green1"])
            rect(d, (x + 3, y + 3, x + 5, y + 4), (239, 118, 118, 255))
        line(d, [(18, 24), (31, 18), (45, 26)], P["green0"], 2)
    elif kind == "strawberry":
        for x, y in ((14, 24), (28, 18), (42, 27)):
            d.polygon([(x, y), (x + 14, y), (x + 10, y + 17), (x + 4, y + 17)], fill=P["red0"])
            d.polygon([(x + 2, y + 2), (x + 12, y + 2), (x + 9, y + 14), (x + 5, y + 14)], fill=P["red1"])
            for px, py in ((x + 5, y + 5), (x + 9, y + 8), (x + 6, y + 12)):
                rect(d, (px, py, px + 1, py + 1), P["gold2"])
            rect(d, (x + 4, y - 3, x + 10, y + 2), P["green1"])
    elif kind == "corn":
        for x in (19, 36):
            box(d, (x, 14, x + 10, 43), P["gold1"], P["green0"], 2)
            for yy in range(18, 39, 5):
                rect(d, (x + 3, yy, x + 5, yy + 2), P["gold2"])
                rect(d, (x + 7, yy + 2, x + 8, yy + 3), P["gold0"])
            d.polygon([(x - 7, 27), (x + 2, 21), (x + 1, 43)], fill=P["green1"])
            d.polygon([(x + 17, 27), (x + 9, 21), (x + 9, 43)], fill=P["green0"])
    elif kind == "cotton":
        for x, y in ((15, 26), (28, 18), (41, 27)):
            ellipse(d, (x, y, x + 12, y + 12), P["white"], P["steel2"], 1)
            ellipse(d, (x + 6, y - 5, x + 17, y + 8), P["ice"], P["steel2"], 1)
            rect(d, (x + 5, y + 12, x + 13, y + 15), P["green0"])
        line(d, [(21, 43), (34, 28), (48, 43)], P["green0"], 2)
    return img


def card_frame():
    img = canvas()
    d = draw(img)
    box(d, (10, 7, 53, 57), P["navy1"], P["cyan"], 2)
    rect(d, (14, 11, 49, 53), P["navy0"])
    rect(d, (17, 14, 46, 17), P["blue1"])
    rect(d, (13, 10, 17, 14), P["gold1"])
    rect(d, (47, 10, 50, 14), P["gold1"])
    rect(d, (13, 51, 17, 54), P["gold0"])
    rect(d, (47, 51, 50, 54), P["gold0"])
    return img, d


def card_art(kind):
    img, d = card_frame()
    if kind == "strike":
        line(d, [(19, 45), (43, 18)], P["steel2"], 5)
        line(d, [(22, 47), (45, 20)], P["ink"], 2)
        d.polygon([(41, 13), (50, 16), (44, 25)], fill=P["red1"])
        rect(d, (17, 41, 27, 48), P["gold1"])
    elif kind == "guard":
        d.polygon([(32, 18), (47, 24), (43, 44), (32, 51), (21, 44), (17, 24)], fill=P["ink"])
        d.polygon([(32, 21), (44, 26), (40, 42), (32, 47), (24, 42), (20, 26)], fill=P["blue1"])
        rect(d, (30, 27, 34, 43), P["ice"])
        rect(d, (25, 34, 39, 38), P["ice"])
    elif kind == "counter":
        line(d, [(18, 39), (38, 21)], P["steel2"], 4)
        d.polygon([(39, 18), (48, 23), (41, 29)], fill=P["orange"])
        d.arc((15, 16, 43, 45), 205, 25, fill=P["cyan"], width=4)
        rect(d, (20, 19, 25, 25), P["cyan"])
    elif kind == "overload":
        diamond(d, 32, 34, 18, P["purple1"], P["purple0"])
        d.polygon([(32, 13), (26, 33), (34, 31), (29, 50), (42, 25), (34, 27)], fill=P["gold2"])
        rect(d, (20, 43, 44, 47), P["red1"])
    elif kind == "fieldAid":
        box(d, (19, 18, 45, 46), P["green0"], P["steel2"], 2)
        rect(d, (29, 22, 35, 42), P["white"])
        rect(d, (23, 29, 41, 35), P["white"])
        rect(d, (21, 46, 43, 50), P["soil1"])
    elif kind == "treasureMap":
        box(d, (17, 20, 47, 43), (183, 145, 87, 255), P["gold0"], 2)
        line(d, [(21, 27), (27, 30), (32, 26), (40, 35)], P["ink"], 2)
        rect(d, (38, 32, 42, 36), P["red1"])
        rect(d, (23, 34, 28, 38), P["gold2"])
        rect(d, (18, 17, 24, 22), P["steel1"])
    elif kind == "deepSearch":
        ellipse(d, (17, 17, 42, 42), P["navy2"], P["purple2"], 2)
        ellipse(d, (23, 23, 36, 36), P["navy0"], P["cyan"], 2)
        line(d, [(39, 39), (50, 50)], P["gold1"], 5)
        rect(d, (26, 28, 30, 31), P["white"])
    return img


def enemy_art(kind):
    img = canvas()
    d = draw(img)
    d.ellipse((14, 49, 50, 58), fill=P["shadow"])
    if kind == "scout":
        box(d, (23, 18, 41, 46), P["steel0"], P["ink"], 2)
        box(d, (20, 11, 44, 23), P["navy1"], P["ink"], 2)
        rect(d, (25, 16, 39, 18), P["cyan"])
        line(d, [(19, 30), (10, 39)], P["steel1"], 3)
        line(d, [(42, 29), (54, 25)], P["orange"], 3)
        rect(d, (27, 46, 31, 53), P["steel1"])
        rect(d, (35, 46, 39, 53), P["steel1"])
    elif kind == "raider":
        box(d, (21, 21, 43, 49), P["orange"], P["ink"], 2)
        box(d, (22, 12, 42, 25), P["red0"], P["ink"], 2)
        rect(d, (26, 17, 38, 19), P["white"])
        line(d, [(17, 31), (8, 27)], P["steel1"], 4)
        line(d, [(45, 28), (56, 39)], P["steel2"], 4)
        rect(d, (29, 30, 35, 42), P["soil0"])
        rect(d, (24, 49, 29, 55), P["steel0"])
        rect(d, (37, 49, 42, 55), P["steel0"])
    elif kind == "warden":
        box(d, (18, 18, 46, 50), P["purple1"], P["ink"], 2)
        box(d, (22, 9, 42, 22), P["steel1"], P["ink"], 2)
        rect(d, (26, 27, 38, 34), P["cyan"])
        rect(d, (27, 29, 36, 31), P["navy0"])
        line(d, [(16, 30), (8, 48)], P["steel2"], 5)
        line(d, [(48, 30), (56, 48)], P["steel2"], 5)
        rect(d, (23, 50, 29, 56), P["purple0"])
        rect(d, (35, 50, 41, 56), P["purple0"])
    return img


def item_art(kind):
    img = canvas()
    d = draw(img)
    d.ellipse((15, 49, 49, 57), fill=P["shadow"])
    if kind == "gold":
        for y, x0, x1 in ((39, 17, 47), (32, 20, 50), (25, 15, 45)):
            ellipse(d, (x0, y, x1, y + 12), P["gold1"], P["gold0"], 2)
            rect(d, (x0 + 8, y + 4, x0 + 13, y + 6), P["gold2"])
    elif kind == "food":
        box(d, (17, 19, 47, 47), P["soil2"], P["ink"], 2)
        rect(d, (21, 24, 43, 29), P["gold1"])
        rect(d, (23, 33, 30, 41), P["green2"])
        rect(d, (34, 33, 41, 41), P["red1"])
    elif kind == "water":
        d.polygon([(32, 9), (47, 31), (42, 48), (32, 55), (22, 48), (17, 31)], fill=P["ink"])
        d.polygon([(32, 14), (43, 32), (39, 45), (32, 51), (25, 45), (21, 32)], fill=P["cyan"])
        rect(d, (27, 31, 31, 36), P["white"])
    elif kind == "energy":
        box(d, (23, 13, 42, 50), P["blue1"], P["ink"], 2)
        rect(d, (25, 16, 40, 22), P["steel2"])
        d.polygon([(33, 24), (27, 37), (34, 35), (30, 48), (41, 31), (34, 33)], fill=P["gold2"])
    elif kind == "exp":
        diamond(d, 32, 33, 20, P["purple2"], P["purple0"])
        rect(d, (29, 16, 34, 50), P["ice"])
        rect(d, (20, 30, 44, 35), P["cyan"])
    elif kind == "talent":
        diamond(d, 32, 32, 22, P["blue1"], P["cyan"])
        for x, y in ((32, 15), (47, 32), (32, 49), (17, 32)):
            rect(d, (x - 2, y - 2, x + 2, y + 2), P["gold2"])
        line(d, [(32, 18), (45, 32), (32, 46), (19, 32), (32, 18)], P["ice"], 2)
    elif kind == "water_bottle":
        box(d, (22, 14, 42, 50), P["cyan"], P["steel2"], 2)
        rect(d, (26, 9, 38, 15), P["steel1"])
        rect(d, (26, 26, 38, 38), P["blue1"])
        rect(d, (28, 18, 31, 24), P["white"])
    elif kind == "energy_drink":
        box(d, (21, 12, 43, 51), P["blue1"], P["steel1"], 2)
        rect(d, (24, 17, 40, 23), P["red1"])
        d.polygon([(33, 25), (27, 37), (34, 35), (30, 48), (41, 31), (34, 33)], fill=P["gold2"])
    elif kind == "scrap":
        d.polygon([(17, 39), (28, 19), (37, 42)], fill=P["steel0"])
        d.polygon([(28, 43), (45, 21), (50, 48)], fill=P["steel1"])
        rect(d, (20, 36, 46, 40), P["cyan"])
        rect(d, (33, 25, 38, 30), P["orange"])
    elif kind == "relic":
        box(d, (18, 18, 46, 46), P["purple0"], P["gold0"], 2)
        diamond(d, 32, 32, 12, P["cyan"], P["ink"])
        rect(d, (21, 21, 27, 27), P["gold2"])
        rect(d, (38, 38, 43, 43), P["gold2"])
    return img


def seed_packet(crop_kind):
    img = canvas()
    d = draw(img)
    box(d, (14, 12, 50, 52), P["soil2"], P["gold0"], 2)
    rect(d, (18, 17, 46, 24), P["navy1"])
    mini = crop_icon(crop_kind).resize((32, 32), Image.Resampling.NEAREST)
    img.alpha_composite(mini, (16, 22))
    rect(d, (19, 48, 45, 50), P["gold2"])
    return img


def gacha_pod():
    img = canvas()
    d = draw(img)
    d.ellipse((14, 50, 50, 58), fill=P["shadow"])
    box(d, (18, 16, 46, 50), P["navy1"], P["ink"], 2)
    box(d, (21, 9, 43, 20), P["cyan"], P["ink"], 2)
    rect(d, (23, 23, 41, 39), P["blue1"])
    diamond(d, 32, 32, 9, P["gold2"], P["gold0"])
    rect(d, (21, 50, 43, 54), P["steel1"])
    return img


def chest():
    img = canvas()
    d = draw(img)
    d.ellipse((12, 50, 52, 58), fill=P["shadow"])
    box(d, (14, 25, 50, 49), P["soil1"], P["ink"], 2)
    box(d, (16, 17, 48, 31), P["gold1"], P["ink"], 2)
    rect(d, (29, 28, 35, 42), P["cyan"])
    rect(d, (19, 34, 27, 38), P["gold0"])
    rect(d, (37, 34, 45, 38), P["gold0"])
    return img


def farm_patch():
    img = canvas(192, 96, P["clear"])
    d = draw(img)
    rect(d, (8, 42, 183, 83), P["soil0"])
    rect(d, (13, 32, 178, 48), P["soil2"])
    for x in range(23, 170, 24):
        rect(d, (x, 47, x + 10, 74), P["green0"])
        rect(d, (x + 3, 35, x + 7, 48), P["green2"])
        rect(d, (x - 5, 50, x + 4, 59), P["green1"])
        rect(d, (x + 8, 51, x + 17, 61), P["green1"])
    for x in range(18, 180, 18):
        rect(d, (x, 82, x + 10, 85), P["shadow"])
    return img


def main_bg():
    img = canvas(320, 180, P["navy0"])
    d = draw(img)
    for y in range(180):
        color = (8 + y // 30, 20 + y // 18, 42 + y // 10, 255)
        rect(d, (0, y, 319, y), color)
    rect(d, (0, 122, 319, 179), (12, 31, 38, 255))
    rect(d, (0, 151, 319, 179), (8, 20, 29, 255))
    rect(d, (18, 94, 134, 137), (29, 70, 73, 255))
    rect(d, (32, 68, 114, 96), (58, 133, 111, 255))
    rect(d, (43, 75, 101, 90), (118, 203, 168, 255))
    rect(d, (56, 104, 94, 125), P["green0"])
    for x in range(26, 126, 18):
        rect(d, (x, 128, x + 8, 141), P["soil2"])
        rect(d, (x + 2, 118, x + 5, 128), P["green2"])
    rect(d, (186, 67, 286, 132), P["navy1"])
    rect(d, (205, 82, 267, 118), P["blue1"])
    rect(d, (213, 91, 226, 105), P["cyan"])
    rect(d, (244, 91, 258, 105), P["cyan"])
    rect(d, (229, 39, 237, 79), P["cyan"])
    rect(d, (232, 34, 234, 39), P["white"])
    rect(d, (190, 132, 290, 139), (6, 13, 25, 180))
    for x, y in ((43, 34), (83, 24), (151, 48), (263, 31), (298, 55), (120, 18), (204, 23), (174, 34)):
        rect(d, (x, y, x + 2, y + 2), P["white"])
    for x in range(0, 320, 12):
        rect(d, (x, 155 + (x // 12) % 3, x + 5, 156 + (x // 12) % 3), (19, 48, 49, 255))
    return img


def build_assets():
    crop_names = ["wheat", "carrot", "tomato", "strawberry", "corn", "cotton"]
    card_names = ["strike", "guard", "counter", "overload", "fieldAid", "treasureMap", "deepSearch"]
    enemy_names = ["scout", "raider", "warden"]
    item_names = ["gold", "food", "water", "energy", "exp", "talent", "water_bottle", "energy_drink", "scrap", "relic"]
    assets = {
        "main_menu_bg": main_bg(),
        "farm_patch": farm_patch(),
        "gacha_pod": gacha_pod(),
        "settlement_chest": chest(),
    }
    for name in crop_names:
        assets[f"crop_{name}"] = crop_icon(name)
        assets[f"seed_{name}"] = seed_packet(name)
    for name in card_names:
        assets[f"card_{name}"] = card_art(name)
    for name in enemy_names:
        assets[f"enemy_{name}"] = enemy_art(name)
    for name in item_names:
        assets[f"item_{name}"] = item_art(name)
    return {name: refined_asset(name, img) for name, img in assets.items()}


def save_assets(project: Path):
    root = output_root(project)
    root.mkdir(parents=True, exist_ok=True)
    assets = build_assets()
    for name, img in assets.items():
        img.save(root / f"{name}.png")
    return root, len(assets)


def main():
    parser = ArgumentParser(description="Generate Simulaid 64x64 pixel assets for Unity.")
    parser.add_argument("--project", type=Path, default=DEFAULT_PROJECT)
    args = parser.parse_args()
    root, count = save_assets(args.project)
    print(f"generated {count} pixel assets in {root}")


if __name__ == "__main__":
    main()
