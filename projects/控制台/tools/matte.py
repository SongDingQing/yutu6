#!/usr/bin/env python3
"""统一抠图(matte)工具 —— 所有 meowa 生图产物的标准去背+去白边。

老板 2026-07-08:把董事长那套抠图算法固化成工具,后续 meowa 生图一律走这里,别再各处手写。

两道工序(董事长/员工动画验证过的参数):
  ① 去底:白/灰棋盘底 → meowa `remove-background-run --is-white-bg`(可选,--dehalo 跳过)
  ② 去白边 halo:alpha 腐蚀 1px(MinFilter(3),2px 会啃掉台灯杆等细物) + 近白边缘像素清理
  + 裁剪到内容 bbox。

用法:
  python3 matte.py <in.png> <out.png>            # 去底+去halo+裁剪(白/灰底图,如 gemini 产物)
  python3 matte.py <in.png> <out.png> --dehalo   # 只去halo(已透明图,如 animate 帧)
可 import: from matte import dehalo, matte_file
"""
import os, sys, subprocess, argparse
from PIL import Image, ImageFilter

MEOWA = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                      "..", "..", "..", "shared", "tools", "meowa", "meowart_api.py"))


def dehalo(im):
    """去白边 halo:alpha 腐蚀 1px + 近白半透明/边缘像素清理。参数已在董事长动画固化。"""
    im = im.convert("RGBA")
    r, g, b, a = im.split()
    a = a.filter(ImageFilter.MinFilter(3))              # 腐蚀 1px 去主 halo(勿用 2px,啃细物)
    im = Image.merge("RGBA", (r, g, b, a))
    px = im.load(); W, H = im.size

    def near_white(rr, gg, bb):
        return min(rr, gg, bb) > 212 and max(rr, gg, bb) - min(rr, gg, bb) < 26

    todo = []
    for y in range(H):
        for x in range(W):
            rr, gg, bb, aa = px[x, y]
            if aa == 0 or not near_white(rr, gg, bb):
                continue
            edge = aa < 250
            if not edge:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < H and px[nx, ny][3] == 0:
                        edge = True
                        break
            if edge:
                todo.append((x, y))
    for x, y in todo:
        rr, gg, bb, _ = px[x, y]
        px[x, y] = (rr, gg, bb, 0)
    return im


def remove_bg(in_path, tmp_dir):
    """调 meowa remove-background --is-white-bg 去白/灰底,返回 result.png 路径(失败返回 None)。"""
    os.makedirs(tmp_dir, exist_ok=True)
    subprocess.run(["python3", MEOWA, "--no-bootstrap", "remove-background-run",
                    "--image-file", os.path.abspath(in_path), "--is-white-bg",
                    "--output-dir", os.path.abspath(tmp_dir)],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for root, _, files in os.walk(tmp_dir):
        if "result.png" in files:
            return os.path.join(root, "result.png")
    return None


def matte_file(in_path, out_path, dehalo_only=False):
    if dehalo_only:
        im = Image.open(in_path)
    else:
        r = remove_bg(in_path, out_path + ".nobg")
        im = Image.open(r) if r else Image.open(in_path)
    im = dehalo(im)
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    im.save(out_path)
    print(f"matte -> {out_path} {im.size}")
    return out_path


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("outp")
    ap.add_argument("--dehalo", action="store_true", help="只去 halo(已透明图,如 animate 帧)")
    a = ap.parse_args()
    matte_file(a.inp, a.outp, a.dehalo)
