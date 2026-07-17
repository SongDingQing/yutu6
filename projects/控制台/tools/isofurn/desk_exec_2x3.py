#!/usr/bin/env python3
"""isofurn · 董事长大班台 2x3 —— 旧 gen_std_desk.py 用 core 重写并修瑕疵。

修复点: 双显示器作为一对居中(0.55..1.45, 各有底座连桌面), 键盘居中于显示器
正前, 台灯移到桌面右后角且斜杆用两 P 点(斜率随网格), 抽屉两可见面都有
分隔线+把手小点, 桌面木纹/前缘 cyan 由 core 统一。
"""
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from core import Scene, PAL
from core import shade

sc = Scene(fw=2, fd=3, height=145)
P, d = sc.P, sc.d


def dot(i, j, z, c, f=1.0):
    x, y = P(i, j, z)
    d.rectangle([x - 1, y - 1, x + 1, y], fill=shade(c, f))


# ── 1 柜体(桌身) ──────────────────────────────────────────────
sc.box(0, 0, 2, 3, 0, 60, PAL['wood'])

# +j 面(亮, j=3): 两组抽屉, 分隔线 + 每格把手小点
d.line([P(1.0, 3, 4), P(1.0, 3, 52)], fill=shade(PAL['wood'], 0.42), width=1)   # 组间竖分隔
for z in (20, 40):
    d.line([P(0.12, 3, z), P(0.92, 3, z)], fill=shade(PAL['wood'], 0.42), width=1)
    d.line([P(1.08, 3, z), P(1.88, 3, z)], fill=shade(PAL['wood'], 0.42), width=1)
for zc in (10, 30, 50):
    dot(0.52, 3, zc, PAL['dark_metal'])
    dot(1.48, 3, zc, PAL['dark_metal'])
# +i 面(暗, i=2): 两组抽屉
d.line([P(2, 1.5, 4), P(2, 1.5, 52)], fill=shade(PAL['wood'], 0.30), width=1)   # 组间竖分隔
for z in (20, 40):
    d.line([P(2, 0.15, z), P(2, 1.35, z)], fill=shade(PAL['wood'], 0.30), width=1)
    d.line([P(2, 1.65, z), P(2, 2.85, z)], fill=shade(PAL['wood'], 0.30), width=1)
for zc in (10, 30, 50):
    dot(2, 0.75, zc, PAL['dark_metal'], 0.8)
    dot(2, 2.25, zc, PAL['dark_metal'], 0.8)
# 柜体 +j 面桌沿下 cyan 氛围灯带(参考图总裁桌发光条); z=48 避开桌面板
# 外扩 0.1 造成的遮挡(z≥53.6 被前脸盖住)                  [cyan 第1处]
d.line([P(0.15, 3, 48), P(1.85, 3, 48)], fill=shade(PAL['cyan'], 0.80), width=1)

# ── 2 桌面板(略外扩, 前两缘 cyan)                       [cyan 第2处] ──
top = sc.box(-0.10, -0.10, 2.10, 3.10, 60, 74, PAL['wood_top'], top_edge=PAL['cyan'])
sc.texture(top, PAL['wood_top'], noise=7, weave=6, seed=11)

# ── 3 绿植小盆(桌面左后角, 画序最先: i+j 最小) ──
sc.box(0.14, 0.28, 0.40, 0.54, 74, 82, PAL['dark_metal'])
lx, ly = P(0.27, 0.41, 92)
d.ellipse([lx - 9, ly - 3, lx + 1, ly + 5], fill=shade(PAL['book_green'], 0.62))
d.ellipse([lx - 4, ly + 0, lx + 6, ly + 7], fill=shade(PAL['book_green'], 0.50))
d.ellipse([lx - 3, ly - 7, lx + 7, ly + 1], fill=shade(PAL['book_green'], 0.95))
d.ellipse([lx - 1, ly - 4, lx + 4, ly - 1], fill=shade(PAL['book_green'], 1.20))

# ── 4 双显示器: 一对居中 i∈[0.55,1.45], 屏幕面完整朝 +j ──
for ci in (0.76, 1.24):
    sc.box(ci - 0.11, 0.28, ci + 0.11, 0.46, 74, 77, PAL['dark_metal'])   # 底座连桌面
    sc.box(ci - 0.03, 0.31, ci + 0.03, 0.41, 77, 80, PAL['dark_metal'])   # 颈
    sc.box(ci - 0.21, 0.30, ci + 0.21, 0.38, 78, 122, PAL['leather_dk'])  # 机身
    sc.panel_j(0.38, ci - 0.18, ci + 0.18, 82, 118, PAL['screen'], f=1.0)  # 屏幕(自发光)
    # 屏幕内容: 几行浅色 UI 线(端点都是 P 点, 斜率随网格)
    d.line([P(ci - 0.13, 0.38, 108), P(ci + 0.10, 0.38, 108)], fill=shade(PAL['white'], 0.90), width=1)
    d.line([P(ci - 0.13, 0.38, 101), P(ci + 0.04, 0.38, 101)], fill=shade(PAL['white'], 0.62), width=1)
    d.line([P(ci - 0.13, 0.38, 94),  P(ci + 0.08, 0.38, 94)],  fill=shade(PAL['white'], 0.62), width=1)

# ── 5 台灯(桌面右后角 i≈1.72, j≈0.30) ──
sc.box(1.62, 0.20, 1.84, 0.42, 74, 78, PAL['dark_metal'])                 # 底座
d.line([P(1.74, 0.32, 78), P(1.66, 0.40, 110)], fill=shade(PAL['metal'], 0.80), width=2)  # 斜杆
sx, sy = P(1.65, 0.41, 110)
d.ellipse([sx - 8, sy - 5, sx + 8, sy + 4], fill=shade(PAL['dark_metal'], 1.15))  # 灯罩
d.line([sx - 6, sy - 4, sx + 4, sy - 4], fill=shade(PAL['metal'], 0.55), width=1)  # 罩顶高光
gx, gy = P(1.65, 0.41, 104)
d.rectangle([gx - 2, gy, gx + 2, gy + 1], fill=shade(PAL['warm']))        # 暖光少量
d.point([(gx - 4, gy + 2), (gx + 4, gy + 2)], fill=shade(PAL['warm'], 0.70))
px_, py_ = P(1.60, 0.52, 74)                                               # 桌面暖光斑 2px
d.point([(px_, py_), (px_ + 2, py_ + 1)], fill=shade(PAL['warm'], 0.45))

# ── 6 键盘(居中于显示器正前) ──
sc.box(0.60, 0.95, 1.40, 1.30, 74, 80, PAL['dark_metal'])
for jj in (1.03, 1.11, 1.19):                                             # 键位行
    d.line([P(0.65, jj, 80), P(1.35, jj, 80)], fill=shade(PAL['dark_metal'], 0.62), width=1)

# ── 7 文件纸堆(右前区) ──
sc.box(1.48, 1.62, 1.86, 1.94, 74, 76, PAL['paper'])
sc.box(1.52, 1.58, 1.90, 1.90, 76, 77, PAL['white'])
d.line([P(1.58, 1.68, 77), P(1.82, 1.68, 77)], fill=shade(PAL['dark_metal'], 0.9), width=1)
d.line([P(1.58, 1.76, 77), P(1.74, 1.76, 77)], fill=shade(PAL['dark_metal'], 0.9), width=1)

sc.save_std('std-desk-exec-2x3.png', name='desk-exec-2x3')
