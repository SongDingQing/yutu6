#!/usr/bin/env python3
"""等距直边件斜率准入校验(老板 2026-07-08 定的 AI 件阈值)。

标准等距边斜率=0.5。AI 生成的直边家具/地块必须过此关才允许入库:
  PASS: 左右顶边 |slope-0.5| ≤ 0.05   (肉眼看不出歪)
  WARN: ≤ 0.10                        (勉强, 需老板点头)
  FAIL: 其他                           (拒收, 重新生成)
  REVIEW: 左右斜率不一致(>warn)         (顶部被凸起物污染/件不对称, 测不准→交人工, 不武断拒)
程序生成(isofurn)件天然=0.5, 本工具主要用于 AI 件准入。
有机件(植物/人物)无长直边, 豁免(--organic 跳过)。
【适用边界】测顶部轮廓斜率, 适用"顶部为纯等距边"的件(地块/桌面/简单柜);
对"顶部有大面积凸起物"的件(带双屏的桌/带高靠背的椅), 顶部轮廓非纯等距边→报 REVIEW 交人工。

用法: python3 iso_check.py <png> [--tol 0.05] [--warn 0.10]
exit: PASS/WARN=0, FAIL=1
"""
import argparse, sys
from PIL import Image


def top_silhouette(im, amin=100):
    W, H = im.size
    px = im.load()
    pts = []
    for x in range(W):
        for y in range(H):
            if px[x, y][3] > amin:
                pts.append((x, y))
                break
    return pts, W


def lsq_slope(seg):
    n = len(seg)
    if n < 8:
        return None
    mx = sum(p[0] for p in seg) / n
    my = sum(p[1] for p in seg) / n
    cov = sum((p[0] - mx) * (p[1] - my) for p in seg)
    var = sum((p[0] - mx) ** 2 for p in seg)
    return abs(cov / var) if var else None


def robust_slope(seg, step=3, band=0.28):
    """抗凸起物的斜率:取局部斜率中位数, 再只在中位数附近 band 内的点上做最小二乘。
    修复(2026-07-08): 家具顶部常有凸起物(显示器/靠背/台灯), 其陡边会污染回归。
    中位数抗离群锁定等距主边(≈0.5), 再窄带精修得到干净斜率。"""
    if not seg or len(seg) < 8:
        return None
    seg = sorted(seg, key=lambda p: p[0])
    locals_ = []
    for i in range(len(seg) - step):
        dx = seg[i + step][0] - seg[i][0]
        if dx:
            locals_.append(abs((seg[i + step][1] - seg[i][1]) / dx))
    if not locals_:
        return None
    locals_.sort()
    med = locals_[len(locals_) // 2]                      # 等距主边斜率(抗凸起物离群)
    # 只保留局部斜率贴近 med 的点段, 再 lsq 精修
    keep = [seg[i] for i in range(len(seg) - step)
            if seg[i + step][0] != seg[i][0]
            and abs(abs((seg[i + step][1] - seg[i][1]) / (seg[i + step][0] - seg[i][0])) - med) <= band]
    refined = lsq_slope(keep)
    return refined if refined is not None else med


def apex_segments(pts):
    """以顶部轮廓顶点(apex)为界分左右段, 各去两端少量像素(避开 apex 圆角与端点装饰)后回归。
    修复(2026-07-08 老板报): 原固定窗口 segL=(0.10~0.42W)/segR=(0.58~0.90W) 隐含
    "顶点在水平中央"假设; 非方形件(如 2x1, 顶点在 ~33%W)会让一侧窗口跨越顶点、
    混合上升+下降两段, 误测斜率(coffee-table 左测 0.306, 实为 0.5)。"""
    if len(pts) < 16:
        return pts, []
    ymin = min(p[1] for p in pts)
    apex_xs = sorted(p[0] for p in pts if p[1] == ymin)
    apex = apex_xs[len(apex_xs) // 2]                      # 顶点 x(多个取中位, 稳平顶)
    left = sorted((p for p in pts if p[0] < apex), key=lambda p: p[0])
    right = sorted((p for p in pts if p[0] > apex), key=lambda p: p[0])

    def trim(seg):
        n = len(seg)
        if n < 12:
            return seg                                    # 太短不裁, 交给 lsq 的最少点数校验
        k = max(2, n // 6)                                 # 去两端各~1/6: 避开 apex 圆角与端点
        return seg[k:n - k]
    return trim(left), trim(right)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("png")
    ap.add_argument("--tol", type=float, default=0.05)
    ap.add_argument("--warn", type=float, default=0.10)
    ap.add_argument("--organic", action="store_true", help="有机件豁免")
    a = ap.parse_args()
    if a.organic:
        print("ORGANIC: 豁免直边校验")
        return 0
    im = Image.open(a.png).convert("RGBA")
    pts, W = top_silhouette(im)
    segL, segR = apex_segments(pts)
    sL, sR = robust_slope(segL), robust_slope(segR)
    devs = [abs(s - 0.5) for s in (sL, sR) if s is not None]
    if not devs:
        print("WARN: 未检出足够直边(可能是有机件?), 人工判断")
        return 0
    dev = max(devs)
    disagree = sL is not None and sR is not None and abs(sL - sR) > a.warn
    if disagree:
        verdict = "REVIEW"          # 两侧不一致=顶部轮廓被凸起物污染/件不对称, 测不准→人工(不武断 FAIL)
    elif dev <= a.tol:
        verdict = "PASS"
    elif dev <= a.warn:
        verdict = "WARN"
    else:
        verdict = "FAIL"
    note = "  ← 两侧斜率不一致, 疑顶部有凸起物(显示器/靠背)或件不对称, 人工核实" if disagree else ""
    print(f"{verdict}: 左={sL and round(sL,3)} 右={sR and round(sR,3)} "
          f"最大偏差={round(dev,3)} (阈值 pass≤{a.tol} warn≤{a.warn}){note}")
    return 1 if verdict == "FAIL" else 0


if __name__ == "__main__":
    sys.exit(main())
