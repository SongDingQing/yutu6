#!/usr/bin/env python3
"""isofurn — 深木开放书架 2×1(奖杯/书/柜门)

结构(全部 core 网格, 斜率恒 0.5):
  柜体   box(0,0, 2,0.55, 0,158, wood_dark), 顶缘微亮 + 顶面木纹
  +j 面  三层格子: 凹进暗背板(panel_j, f=0.32) + 层间隔板亮细线(沿 P 点)
  格内   书=竖直窄条(red/blue/green 交替, 高矮错落, 1 本 cyan 点缀)
         金奖杯=warm rod+disc ×3(两大一小), 相框=white 细边小面板
         另有平放书堆 + 文件夹(带纸标签)
  底部   两扇柜门(wood, 内嵌暗芯板) + metal 把手小点
画序: 柜体 → 背板(远/暗) → 格内内容(低→高) → 隔板亮线(柜唇最前) → 柜门
z 布局: 踢脚0-4 | 门4-48 | 横档48-54 | 格54-84 | 板84-89 | 格89-119
        | 板119-124 | 格124-152 | 顶152-158
"""
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from core import Scene, PAL
from core import shade

sc = Scene(fw=2, fd=1, height=165)
JF = 0.55                      # 可见 +j 面所在平面
wood, wood_dark, wood_top = PAL['wood'], PAL['wood_dark'], PAL['wood_top']

# ── 1) 柜体(顶缘微亮) + 顶面木纹 ──
top = sc.box(0.0, 0.0, 2.0, JF, 0, 158, wood_dark,
             top_edge=shade(wood_top, 1.15))
sc.texture(top, wood_dark, noise=6, weave=6, seed=5)

# ── 2) 三层凹进暗背板 + 格顶阴影线(凹陷感) ──
I0, I1 = 0.10, 1.90            # 开口左右边界(留竖框)
FLOORS = [54, 89, 124]         # 各层格底 z
CEILS  = [84, 119, 152]        # 各层格顶 z
for zf, zc in zip(FLOORS, CEILS):
    sc.panel_j(JF, I0, I1, zf, zc, wood_dark, f=0.32)
    sc.d.line([sc.P(I0, JF, zc), sc.P(I1, JF, zc)],
              fill=shade(wood_dark, 0.16), width=2)


# ── 3) 格内内容(全画在 +j 面) ──
def books(i, floor, specs):
    """竖直窄条书排。specs: (宽, 高, 色名, 亮度) 列表, 返回结束 i。"""
    for w, h, cn, f in specs:
        sc.panel_j(JF, i, i + w, floor, floor + h, PAL[cn], f=f)
        i += w + 0.014
    return i


def trophy(i, floor, s=1.0):
    """金奖杯: 底座 disc ×2 + 杯柄 rod + 收窄杯身 rod + 外扩杯口 disc + 高光。"""
    warm = PAL['warm']
    f, zr = floor, floor + int(15 * s)
    sc.rod(i, JF, f, f + 3, max(4, int(6 * s)), shade(warm, 0.50))       # 矩形底座块
    sc.disc(i, JF, f + 4, max(2, int(3 * s)), warm, f=0.66)              # 台阶
    sc.rod(i, JF, f + 4, f + int(9 * s), 2, shade(warm, 0.75))           # 杯柄
    sc.rod(i, JF, f + int(9 * s), zr, max(3, int(5 * s)),
           shade(warm, 0.95))                                            # 杯身(窄)
    sc.disc(i, JF, zr, max(4, int(5.5 * s)), warm, f=1.12)               # 杯口外扩
    if s >= 1.0:
        sc.disc(i, JF, zr + 1, max(2, int(2.5 * s)), warm, f=0.70)       # 杯口内阴影
    sc.rod(i - 0.020, JF, f + int(10 * s), zr - 1, 1, shade(warm, 1.30))  # 高光


# 底层(z54): 书 ×6 → 文件夹 ×3(纸标签) → 小奖杯
books(0.20, 54, [
    (0.075, 21, 'book_red', .60), (0.060, 17, 'book_blue', .55),
    (0.080, 23, 'book_green', .62), (0.065, 18, 'book_blue', .58),
    (0.070, 20, 'book_red', .56), (0.065, 22, 'book_green', .60)])
for k, (bi, bf) in enumerate([(0.98, .42), (1.094, .38), (1.208, .45)]):
    sc.panel_j(JF, bi, bi + 0.10, 54, 74, PAL['book_blue'], f=bf)
    sc.panel_j(JF, bi + 0.036, bi + 0.064, 63, 65, PAL['paper'], f=0.55)
trophy(1.62, 54, s=0.8)

# 中层(z89): 长书排 ×10(含 1 本 cyan 点缀) + 平放书堆 ×3
books(0.18, 89, [
    (0.075, 22, 'book_red', .60), (0.060, 18, 'book_blue', .55),
    (0.080, 24, 'book_green', .62), (0.065, 19, 'book_blue', .58),
    (0.070, 21, 'book_red', .56), (0.060, 17, 'cyan', .50),
    (0.080, 23, 'book_green', .60), (0.070, 20, 'book_blue', .62),
    (0.065, 18, 'book_red', .55), (0.075, 22, 'book_green', .58)])
sc.panel_j(JF, 1.45, 1.72, 89, 93, PAL['book_red'], f=.55)
sc.panel_j(JF, 1.47, 1.70, 93, 96, PAL['book_green'], f=.60)
sc.panel_j(JF, 1.46, 1.71, 96, 100, PAL['book_blue'], f=.58)

# 顶层(z124): 大小金奖杯 ×2 → 白细边相框 → 书 ×4
trophy(0.30, 124, s=1.1)
trophy(0.58, 124, s=0.85)
sc.panel_j(JF, 0.95, 1.20, 125, 141, PAL['white'], f=0.72)   # 白细边
sc.panel_j(JF, 0.97, 1.18, 127, 139, PAL['glass'], f=0.55)   # 相片芯
books(1.42, 124, [
    (0.070, 18, 'book_green', .58), (0.060, 15, 'book_red', .55),
    (0.075, 19, 'book_blue', .60), (0.065, 16, 'book_green', .56)])

# ── 4) 层间隔板亮细线(柜唇, 最后画压住书底) ──
lip = shade(wood_top, 0.80)
for zf in FLOORS:
    sc.d.line([sc.P(I0, JF, zf), sc.P(I1, JF, zf)], fill=lip, width=1)

# ── 5) 底部两扇柜门(内嵌暗芯板) + metal 把手 ──
for di0, di1 in [(0.08, 0.97), (1.03, 1.92)]:
    sc.panel_j(JF, di0, di1, 4, 48, wood)                    # 门框
    sc.panel_j(JF, di0 + 0.06, di1 - 0.06, 9, 43, wood, f=0.50)  # 芯板
sc.d.line([sc.P(1.0, JF, 4), sc.P(1.0, JF, 48)],
          fill=shade(wood_dark, 0.35), width=1)              # 门缝
sc.disc(0.90, JF, 27, 2, PAL['metal'], f=0.95)               # 把手 ×2
sc.disc(1.10, JF, 27, 2, PAL['metal'], f=0.95)
sc.d.line([sc.P(0.06, JF, 4), sc.P(1.94, JF, 4)],
          fill=shade(wood_dark, 0.30), width=1)              # 踢脚暗线

sc.save_std('std-bookshelf-2x1.png', name='bookshelf-2x1')
