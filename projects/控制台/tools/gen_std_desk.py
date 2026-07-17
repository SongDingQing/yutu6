#!/usr/bin/env python3
"""程序生成【精确等距】董事长桌 —— 与地板同一 pitch 64/32,边必然平行于格线。

思路:一切用等距长方体(iso box)拼,box 的边由 P(i,j,z) 投影决定,
斜率恒为 0.5(和地板 tile 完全一致),所以桌子边与地板格线数学上平行。
细节(木纹/显示器/键盘/台灯)都在这个精确骨架上加,既平行又不失精致。
输出: std/std-desk-2x3.png (透明底)。footprint 2×3。
"""
import os, random
from PIL import Image, ImageDraw

PX, PY = 64, 32                       # 主网格半步进(与地板一致)
OX, OY = 210, 120                     # 画布内投影原点
W, H = 380, 340
random.seed(7)


def P(i, j, z):
    return (OX + (i - j) * PX, OY + (i + j) * PY - z)


def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c) + (255,)


def box(d, i0, j0, i1, j1, z0, z1, c, top_edge=None):
    """等距长方体:顶面 + 右下面(i=i1) + 左下面(j=j1)。"""
    # 右下面
    d.polygon([P(i1, j0, z1), P(i1, j1, z1), P(i1, j1, z0), P(i1, j0, z0)], fill=shade(c, 0.60))
    # 左下面
    d.polygon([P(i0, j1, z1), P(i1, j1, z1), P(i1, j1, z0), P(i0, j1, z0)], fill=shade(c, 0.44))
    # 顶面
    top = [P(i0, j0, z1), P(i1, j0, z1), P(i1, j1, z1), P(i0, j1, z1)]
    d.polygon(top, fill=shade(c, 1.0))
    if top_edge:
        d.line([P(i0, j1, z1), P(i1, j1, z1)], fill=top_edge, width=1)
        d.line([P(i1, j1, z1), P(i1, j0, z1)], fill=top_edge, width=1)
    return top


def wood_grain(im, top_poly, base):
    """顶面木纹:噪点 + 沿 i 方向的暗纹线。"""
    xs = [p[0] for p in top_poly]; ys = [p[1] for p in top_poly]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    px = im.load()

    def inside(x, y):
        # 顶面平行四边形内判定(两组等距边界)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        return True
    for y in range(int(y0), int(y1) + 1):
        for x in range(int(x0), int(x1) + 1):
            r, g, b, a = px[x, y]
            if a > 0 and abs(r - base[0]) < 30 and abs(g - base[1]) < 30:
                n = random.randint(-8, 8)
                if (x + 2 * y) % 6 == 0:
                    n -= 10                       # 木纹暗线沿等距方向
                px[x, y] = (max(0, r + n), max(0, g + n), max(0, b + n), 255)


def make(path):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    WOOD = (104, 71, 46)
    CYAN = (110, 168, 254, 255)

    # 柜体(桌子主体) footprint 2×3, 高 60；桌面薄板 68..76
    box(d, 0.0, 0.0, 2.0, 3.0, 0, 60, WOOD)
    # 抽屉分隔线(右下面 i=2)
    for k in (1, 2):
        z = 60 * k / 3
        d.line([P(2, 0.15, z), P(2, 1.35, z)], fill=shade(WOOD, 0.42), width=1)
        d.line([P(2, 1.65, z), P(2, 2.85, z)], fill=shade(WOOD, 0.42), width=1)
    # 桌面板(略大、更亮)
    top = box(d, -0.12, -0.12, 2.12, 3.12, 60, 74, (120, 84, 55), top_edge=CYAN)
    wood_grain(im, top, (120, 84, 55))
    d = ImageDraw.Draw(im)

    # 双显示器(桌面后部 j≈0.35,竖直薄盒 + cyan 屏)
    for (ci) in (0.55, 1.45):
        box(d, ci - 0.42, 0.30, ci + 0.42, 0.44, 74, 128, (26, 28, 36))
        # 屏幕(左下面朝观察者)着 cyan
        d.polygon([P(ci - 0.42, 0.44, 122), P(ci + 0.42, 0.44, 122),
                   P(ci + 0.42, 0.44, 82), P(ci - 0.42, 0.44, 82)], fill=(96, 150, 210, 255))
        # 底座
        box(d, ci - 0.08, 0.36, ci + 0.08, 0.5, 74, 84, (40, 42, 50))
    # 键盘(桌面中部扁盒)
    box(d, 0.45, 1.0, 1.55, 1.7, 74, 80, (34, 36, 44))
    # 台灯(右侧:底座+杆+灯罩)
    box(d, 1.55, 0.35, 1.75, 0.55, 74, 80, (60, 62, 70))
    d.line([P(1.65, 0.45, 80), P(1.62, 0.45, 118)], fill=(150, 150, 158, 255), width=3)
    d.ellipse([P(1.55, 0.45, 120)[0], P(1.55, 0.45, 120)[1] - 6,
               P(1.75, 0.45, 120)[0], P(1.55, 0.45, 120)[1] + 8], fill=(244, 199, 102, 255))

    im = im.crop(im.getbbox())
    im.save(path)
    print("wrote", path, im.size, "| 边斜率精确 0.5,与地板平行")


if __name__ == "__main__":
    out = "artifacts/office-assets/v3-tileset/std"
    os.makedirs(out, exist_ok=True)
    make(os.path.join(out, "std-desk-2x3.png"))
