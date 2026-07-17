#!/usr/bin/env python3
"""等距办公室拼装渲染器 —— 规范固定尺寸算法 (v2)。

设计要点(老板 2026-07-07 定):
  1. 固定 tile 几何常量 —— 所有 tile 按同一网格,拼接结果确定、可复现。
  2. 标准等距投影 grid_to_screen(i,j) —— 单一真相,家具/地板/墙共用。
  3. 【两遍渲染】地板层(FLOOR)永远整体画在物件层(OBJECT)之下 ——
     地板绝不遮挡家具;家具之间再按深度前后遮挡。这修掉"地板盖住桌子"。

标准几何(实测 v3 地块 diamond 顶面):
  - diamond 顶面 116×66, 半步进 HALF=(58,33)
  - 1x1 tile 源图 128×96, 其 diamond 顶点(top vertex) 在图内像素 (64,15)
  - diamond 底点(bottom vertex) = 顶点 + (0, TILE_H)  ← 物件接地对齐到这里

布局项:
  - cells:"fill"       地板铺满(FLOOR 层, z=0)
  - 默认(cell+footprint) 家具/地块(OBJECT 层), 可选 anchor:[ax,ay] px:[dx,dy]
  - kind:"wall"        墙(OBJECT 层最底, 永远最先画), anchor_cell+px, 可选 scale
素材: 字符串(相对 assets_dir) 或 {"path": 相对CWD}
用法: python3 office-assemble.py <layout.json> <assets_dir> <out.png>
"""
import json, os, sys
from PIL import Image

# ── 标准 tile 几何 (固定, 勿随意改) ──────────────────────────
# 标准等距 2:1: diamond 顶面 128×64, 边斜率精确 1:2 (由 gen_std_floor_tile.py 生成)
TILE_W, TILE_H = 128, 64              # diamond 顶面宽 × 高
HALF_W, HALF_H = TILE_W // 2, TILE_H // 2   # 64, 32  半步进(pitch)
FLOOR_TOP_IN_IMG = (65, 16)           # 标准地板源图(130×98)内 diamond 顶点像素
BG = (15, 17, 23, 255)

# 物件接地点(图内像素) 按 footprint 兜底; layout 的 "anchor" 可逐件覆盖
OBJECT_ANCHOR = {
    (1, 1): (64, 85),
    (2, 2): (127, 222),
    (2, 3): (128, 205),
    (5, 5): (128, 205),
}


def grid_to_screen(i, j, ox, oy):
    """格(i,j) 的 diamond 顶点(top vertex) 屏幕坐标。等距投影单一真相。"""
    return ox + (i - j) * HALF_W, oy + (i + j) * HALF_H


def render(layout, assets_dir, out_path):
    cols, rows = layout["grid"]["cols"], layout["grid"]["rows"]
    W = (cols + rows) * HALF_W + 380
    H = (cols + rows) * HALF_H + 720
    ox = rows * HALF_W + 150
    oy = 340

    canvas = Image.new("RGBA", (W, H), BG)
    cache = {}
    def asset_path(name):
        spec = layout["assets"][name]
        return spec["path"] if isinstance(spec, dict) else os.path.join(assets_dir, spec)

    def load(name):
        if name not in cache:
            cache[name] = Image.open(asset_path(name)).convert("RGBA")
        return cache[name]

    meta_cache = {}
    def meta_of(name):
        """isofurn sidecar JSON(自动锚点/footprint), 无则空 dict。"""
        if name not in meta_cache:
            mp = os.path.splitext(asset_path(name))[0] + ".json"
            meta_cache[name] = json.load(open(mp, encoding="utf-8")) if os.path.exists(mp) else {}
        return meta_cache[name]

    floor_layer, object_layer = [], []   # 各: (depth, img, left, top)

    for t in layout["tiles"]:
        # ── 墙: OBJECT 层最底(最先画, 永远在后方) ──
        if t.get("kind") == "wall":
            img = load(t["asset"])
            sc = t.get("scale", 1.0)
            if sc != 1.0:
                img = img.resize((round(img.width * sc), round(img.height * sc)), Image.LANCZOS)
            AX, AY = grid_to_screen(*t.get("anchor_cell", [0, 0]), ox, oy)
            dx, dy = t.get("px", [0, 0])
            object_layer.append((-1e9, img, AX + dx, AY + dy))
            continue

        # ── 地板铺满: FLOOR 层, 顶点对齐, 按深度铺(前排盖后排厚度) ──
        if t.get("cells") == "fill":
            img = load(t["asset"])
            ax, ay = FLOOR_TOP_IN_IMG
            for j in range(rows):
                for i in range(cols):
                    sx, sy = grid_to_screen(i, j, ox, oy)
                    floor_layer.append((i + j, img, sx - ax, sy - ay))
            continue

        # ── 家具/地块: OBJECT 层, 接地点对齐到 footprint 前格的 diamond 底点 ──
        meta = meta_of(t["asset"])
        fp = tuple(t.get("footprint") or meta.get("footprint") or (1, 1))
        img = load(t["asset"])
        ax, ay = (t.get("anchor") or meta.get("anchor")
                  or OBJECT_ANCHOR.get(fp, (img.width // 2, img.height)))
        dx, dy = t.get("px", [0, 0])
        ci, cj = t["cell"]
        fi, fj = ci + fp[0] - 1, cj + fp[1] - 1        # 最前格
        sx, sy = grid_to_screen(fi, fj, ox, oy)
        bottom_x, bottom_y = sx, sy + TILE_H            # 该格 diamond 底点
        object_layer.append((fi + fj, img, bottom_x - ax + dx, bottom_y - ay + dy))

    # 两遍渲染: 先地板层(整体在下), 再物件层; 各自按深度 painter 排序
    for _, img, left, top in sorted(floor_layer, key=lambda d: d[0]):
        canvas.alpha_composite(img, (int(left), int(top)))
    for _, img, left, top in sorted(object_layer, key=lambda d: d[0]):
        canvas.alpha_composite(img, (int(left), int(top)))

    canvas.save(out_path)
    print("wrote", out_path, canvas.size, f"(floor {len(floor_layer)} + object {len(object_layer)})")


if __name__ == "__main__":
    layout = json.load(open(sys.argv[1], encoding="utf-8"))
    render(layout, sys.argv[2] if len(sys.argv) > 2 else ".", sys.argv[3] if len(sys.argv) > 3 else "office-preview.png")
