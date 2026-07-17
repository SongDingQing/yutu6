#!/usr/bin/env python3
"""isofurn — 深木咖啡桌带玻璃内嵌 2x1

结构: 四条 wood_dark 细腿(z 0..26) + wood_top 桌面(z 26..34, 顶面木纹)
     + 顶面玻璃内嵌(0.15..1.85 × 0.15..0.85) + 两本杂志 + 一支暖光小蜡烛。
画序: 先远后近(小 i+j 先画), 先低后高。
"""
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from core import Scene, PAL
from core import shade

sc = Scene(fw=2, fd=1, height=40)
P, d = sc.P, sc.d

LEG = 0.08          # 腿截面(格)
LEG_TOP = 26        # 腿高
TOP0, TOP1 = 26, 34 # 桌面 z 区间

# ── 四条腿(painter: 小 i+j 先画) ──
legs = [(0.0, 0.0), (0.0, 1.0 - LEG), (2.0 - LEG, 0.0), (2.0 - LEG, 1.0 - LEG)]
legs.sort(key=lambda p: p[0] + p[1])
for li, lj in legs:
    sc.box(li, lj, li + LEG, lj + LEG, 0, LEG_TOP, PAL['wood_dark'])

# ── 桌面(顶面木纹 + 近边勾深色轮廓线) ──
top = sc.box(0.0, 0.0, 2.0, 1.0, TOP0, TOP1, PAL['wood_top'],
             top_edge=PAL['wood_dark'])
sc.texture(top, PAL['wood_top'], noise=8, weave=8, seed=11)

# ── 玻璃内嵌(顶面内一圈更小的平行四边形) ──
g0i, g0j, g1i, g1j = 0.15, 0.15, 1.85, 0.85
gz = TOP1
d.polygon([P(g0i, g0j, gz), P(g1i, g0j, gz), P(g1i, g1j, gz), P(g0i, g1j, gz)],
          fill=shade(PAL['glass']))
# 玻璃内缘一圈暗线(内嵌下沉感)
rim = [P(g0i, g0j, gz), P(g1i, g0j, gz), P(g1i, g1j, gz), P(g0i, g1j, gz), P(g0i, g0j, gz)]
d.line(rim, fill=shade(PAL['glass'], 0.55), width=1)
# 玻璃反光: 两道沿 +i 方向的浅色窄条(网格方向, 斜率自动 0.5)
d.line([P(0.30, 0.32, gz), P(1.05, 0.32, gz)], fill=shade(PAL['glass'], 1.55), width=1)
d.line([P(1.20, 0.62, gz), P(1.70, 0.62, gz)], fill=shade(PAL['glass'], 1.35), width=1)
# cyan 点缀(克制, 仅 1 处): 玻璃角一小段冷光
d.line([P(1.60, 0.80, gz), P(1.82, 0.80, gz)], fill=shade(PAL['cyan'], 0.85), width=1)

# ── 杂志两本(paper 薄 box, 叠放错位; 下层蓝封面条留在可见带) ──
m1 = sc.box(0.30, 0.26, 0.76, 0.64, TOP1, TOP1 + 2, PAL['paper'])
d.polygon([P(0.34, 0.31, TOP1 + 2), P(0.44, 0.31, TOP1 + 2),
           P(0.44, 0.40, TOP1 + 2), P(0.34, 0.40, TOP1 + 2)],
          fill=shade(PAL['book_blue']))
m2 = sc.box(0.46, 0.40, 0.92, 0.78, TOP1 + 2, TOP1 + 4, PAL['paper'])
d.polygon([P(0.54, 0.48, TOP1 + 4), P(0.84, 0.48, TOP1 + 4),
           P(0.84, 0.62, TOP1 + 4), P(0.54, 0.62, TOP1 + 4)],
          fill=shade(PAL['book_red']))

# ── warm 小点缀: 玻璃上一支小蜡烛(暖光少量) ──
ci, cj = 1.50, 0.58
sc.disc(ci + 0.02, cj + 0.02, TOP1, 7, PAL['warm'], f=0.62)          # 玻璃上暖反光
sc.box(ci - 0.05, cj - 0.05, ci + 0.05, cj + 0.05, TOP1, TOP1 + 4, PAL['paper'])
sc.rod(ci, cj, TOP1 + 4, TOP1 + 6, 2, PAL['warm'])                   # 竖向小火苗
sc.disc(ci, cj, TOP1 + 6, 1, PAL['white'], f=1.0)                    # 火苗尖

sc.save_std('std-coffee-table-2x1.png', name='coffee-table-2x1')
