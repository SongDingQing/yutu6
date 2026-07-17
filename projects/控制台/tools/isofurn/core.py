#!/usr/bin/env python3
"""isofurn — 等距家具程序生成库 · 核心

为什么存在: AI 生图做不到精确等距(实测斜率 0.33~0.64, 标准=0.5),
家具边与地板格线不平行, 拼装就歪。本库用与地板同一套网格数学画家具,
每条结构性水平边斜率恒 0.5 —— 平行是数学保证的, 且接地锚点自动精确。

网格约定(与 projects/控制台/tools/office-assemble.py 完全一致):
  PX, PY = 64, 32          # 半步进; 地板 tile 顶面 128×64
  家具占 footprint (fw, fd) 格, 生成空间 i∈[0,fw], j∈[0,fd], z 向上(像素)
  接地锚点 = P(fw, fd, 0) = footprint 最前角 —— save_std() 自动算好写进
  sidecar JSON({name,footprint,anchor,size}), 渲染器自动读取, 无需手工标定。

屏幕朝向: +i → 屏幕右下, +j → 屏幕左下, z → 上。
观察者可见两个立面: +j 面(亮, ×0.60) 与 +i 面(暗, ×0.44); 顶面 ×1.00。
"面向观察者" = 可见内容画在 +j(或+i) 侧立面上。

画序(painter): 先画低 z / 小 j / 小 i(远处), 后画近处; 同一件内自行注意。

模块模板:
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from core import Scene, PAL
    sc = Scene(fw=1, fd=1, height=120)
    sc.box(0.12, 0.12, 0.88, 0.88, 0, 30, PAL['leather'])
    sc.save_std('std-xxx-1x1.png', name='xxx-1x1')
"""
import json, os, random
from PIL import Image, ImageDraw

PX, PY = 64, 32
TOP_F, LEFT_F, RIGHT_F = 1.00, 0.60, 0.44   # 顶 / +j 面 / +i 面 光照系数

STD_DIR = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "artifacts", "office-assets", "v3-tileset", "std"))

PAL = {
    "carpet":     (52, 49, 62),
    "wood":       (104, 71, 46),
    "wood_top":   (120, 84, 55),
    "wood_dark":  (70, 48, 32),
    "leather":    (38, 40, 48),
    "leather_dk": (26, 28, 34),
    "metal":      (120, 124, 134),
    "dark_metal": (40, 42, 50),
    "mesh":       (88, 92, 102),
    "screen":     (96, 150, 210),
    "cyan":       (110, 168, 254),
    "warm":       (244, 199, 102),
    "paper":      (225, 222, 210),
    "glass":      (70, 90, 110),
    "book_red":   (140, 70, 66),
    "book_blue":  (70, 96, 140),
    "book_green": (76, 120, 90),
    "white":      (230, 233, 240),
}


def shade(c, f=1.0):
    return tuple(max(0, min(255, int(v * f))) for v in c[:3]) + (255,)


class Scene:
    """一件家具的画布。fw/fd=footprint 格数, height=最高点 z(px)。"""

    def __init__(self, fw, fd, height, margin=26):
        self.fw, self.fd = fw, fd
        W = (fw + fd) * PX + margin * 2
        H = height + (fw + fd) * PY + margin * 2 + 16
        self.ox = margin + fd * PX
        self.oy = margin + height
        self.im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    # ── 投影(单一真相) ──
    def P(self, i, j, z=0):
        return (self.ox + (i - j) * PX, self.oy + (i + j) * PY - z)

    # ── 等距长方体: 顶面 + 两可见立面。要求 i0<i1, j0<j1, z0<z1 ──
    def box(self, i0, j0, i1, j1, z0, z1, c, top_edge=None,
            top_f=TOP_F, left_f=LEFT_F, right_f=RIGHT_F):
        P, d = self.P, self.d
        d.polygon([P(i1, j0, z1), P(i1, j1, z1), P(i1, j1, z0), P(i1, j0, z0)],
                  fill=shade(c, right_f))                      # +i 面(暗)
        d.polygon([P(i0, j1, z1), P(i1, j1, z1), P(i1, j1, z0), P(i0, j1, z0)],
                  fill=shade(c, left_f))                       # +j 面(亮)
        top = [P(i0, j0, z1), P(i1, j0, z1), P(i1, j1, z1), P(i0, j1, z1)]
        d.polygon(top, fill=shade(c, top_f))
        if top_edge:
            d.line([P(i0, j1, z1), P(i1, j1, z1)], fill=shade(top_edge), width=1)
            d.line([P(i1, j1, z1), P(i1, j0, z1)], fill=shade(top_edge), width=1)
        return top

    # ── 竖直面板: 固定 j, 面向 +j(观察者左下)。屏幕/椅背/柜门用 ──
    def panel_j(self, j, i0, i1, z0, z1, c, f=LEFT_F):
        P = self.P
        poly = [P(i0, j, z1), P(i1, j, z1), P(i1, j, z0), P(i0, j, z0)]
        self.d.polygon(poly, fill=shade(c, f))
        return poly

    # ── 竖直面板: 固定 i, 面向 +i(观察者右下) ──
    def panel_i(self, i, j0, j1, z0, z1, c, f=RIGHT_F):
        P = self.P
        poly = [P(i, j0, z1), P(i, j1, z1), P(i, j1, z0), P(i, j0, z0)]
        self.d.polygon(poly, fill=shade(c, f))
        return poly

    # ── 竖杆 / 地面等距圆盘(ry=rx/2) ──
    def rod(self, i, j, z0, z1, w, c):
        x0, y0 = self.P(i, j, z1)
        x1, y1 = self.P(i, j, z0)
        self.d.line([x0, y0, x1, y1], fill=shade(c), width=w)

    def disc(self, i, j, z, rx, c, f=1.0):
        x, y = self.P(i, j, z)
        self.d.ellipse([x - rx, y - rx // 2, x + rx, y + rx // 2], fill=shade(c, f))

    # ── 顶面材质: 噪点 + 沿等距方向的织纹/木纹 ──
    def texture(self, poly, base, noise=7, weave=6, seed=7):
        rnd = random.Random(seed)
        px = self.im.load()
        xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
        for y in range(int(min(ys)), int(max(ys)) + 1):
            for x in range(int(min(xs)), int(max(xs)) + 1):
                if not (0 <= x < self.im.width and 0 <= y < self.im.height):
                    continue
                r, g, b, a = px[x, y]
                if a > 0 and abs(r - base[0]) < 26 and abs(g - base[1]) < 26 and abs(b - base[2]) < 26:
                    n = rnd.randint(-noise, noise)
                    if weave and (x + 2 * y) % weave == 0:
                        n -= noise
                    px[x, y] = (max(0, r + n), max(0, g + n), max(0, b + n), 255)

    # ── 保存: 裁剪 + 自动锚点 + sidecar JSON ──
    def save_std(self, filename, name):
        os.makedirs(STD_DIR, exist_ok=True)
        path = os.path.join(STD_DIR, filename)
        bbox = self.im.getbbox()
        im = self.im.crop(bbox)
        ax, ay = self.P(self.fw, self.fd, 0)
        ax -= bbox[0]; ay -= bbox[1]
        im.save(path)
        meta = {"name": name, "footprint": [self.fw, self.fd],
                "anchor": [ax, ay], "size": list(im.size),
                "grid": {"px": PX, "py": PY}, "generator": "isofurn"}
        with open(os.path.splitext(path)[0] + ".json", "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=1)
        print("wrote", path, im.size, "anchor", (ax, ay))
        return path
