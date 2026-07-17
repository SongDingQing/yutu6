#!/usr/bin/env python3
"""处理多版 gemini 桌子: flood-fill 去灰棋盘背景 → 测等距角度 → 挑最接近 0.5 的。

用法: python3 process_desks.py <desk-multi 目录>
输出: 每版斜率报告 + 最优版另存 desk-best.png (已去背)
"""
import os, sys, glob
from collections import deque
from PIL import Image


def is_bg(px, x, y, W, H):
    r, g, b, a = px[x, y]
    return a > 0 and min(r, g, b) > 150 and (max(r, g, b) - min(r, g, b)) < 40


def dechecker(im):
    """从四边 flood-fill 去掉连通的浅色棋盘背景(桌子内部白色不受影响)。"""
    im = im.convert("RGBA"); W, H = im.size; px = im.load()
    seen = bytearray(W * H)
    q = deque()
    for x in range(W):
        for y in (0, H - 1):
            if is_bg(px, x, y, W, H): q.append((x, y))
    for y in range(H):
        for x in (0, W - 1):
            if is_bg(px, x, y, W, H): q.append((x, y))
    while q:
        x, y = q.popleft()
        if x < 0 or x >= W or y < 0 or y >= H or seen[y * W + x]: continue
        if not is_bg(px, x, y, W, H): continue
        seen[y * W + x] = 1; px[x, y] = (0, 0, 0, 0)
        q.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    return im.crop(im.getbbox())


def wood_top_slope(im):
    """测桌面木色顶边左右斜率, 返回 (slopeL, slopeR)。标准应=0.5。"""
    W, H = im.size; px = im.load()
    tops = []
    for x in range(W):
        for y in range(H):
            r, g, b, a = px[x, y]
            if a > 120 and r > 80 and r > b + 12 and g < r:  # 木色桌面
                tops.append((x, y)); break
    if len(tops) < 20: return None, None
    def slope(seg, rising):
        if len(seg) < 6: return None
        dx = seg[-1][0] - seg[0][0]
        dy = (seg[0][1] - seg[-1][1]) if rising else (seg[-1][1] - seg[0][1])
        return abs(dy / dx) if dx else None
    L = [t for t in tops if t[0] < W * 0.42]
    R = [t for t in tops if t[0] > W * 0.58]
    return slope(L, True), slope(R, False)


def main(root):
    best = None
    for d in sorted(glob.glob(os.path.join(root, "v*"))):
        pngs = glob.glob(os.path.join(d, "*.png"))
        if not pngs: continue
        im = dechecker(Image.open(pngs[0]))
        sl, sr = wood_top_slope(im)
        vals = [s for s in (sl, sr) if s]
        avg = sum(vals) / len(vals) if vals else None
        err = abs(avg - 0.5) if avg else 9
        name = os.path.basename(d)
        print(f"{name}: 左={sl} 右={sr} 均={avg and round(avg,3)} 距0.5={round(err,3)} 尺寸{im.size}")
        clean = os.path.join(d, "clean.png"); im.save(clean)
        if best is None or err < best[0]:
            best = (err, clean, name, im)
    if best:
        out = os.path.join(root, "desk-best.png"); best[3].save(out)
        print(f"\n>>> 最优: {best[2]} (距0.5={round(best[0],3)}) -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
