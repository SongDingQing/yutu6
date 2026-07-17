#!/usr/bin/env python3
"""isofurn — 员工工位桌 2×2(不含椅子)

两侧抽屉柜 + 木纹桌面(前缘 cyan) + 双显示器(面向观察者) + 键盘 + 地面主机塔。
朝向: 屏幕内容画在 +j 侧; 画序: 先远(小 i+j)后近, 先低后高。
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import Scene, PAL
from core import shade

sc = Scene(fw=2, fd=2, height=125)
P, d = sc.P, sc.d

WD, WT = PAL['wood_dark'], PAL['wood_top']
DM, MT = PAL['dark_metal'], PAL['metal']
SC, CY = PAL['screen'], PAL['cyan']
LD, WM = PAL['leather_dk'], PAL['warm']

# ── 1) 膝洞背板(最远, 先画): 深色内衬, 参考图里桌下是暗腔 ──
sc.panel_j(0.32, 0.50, 1.50, 4, 52, LD, f=0.42)

# ── 2) 两侧抽屉柜(wood_dark), +j 柜面画抽屉分隔细线 + 拉手 ──
def cabinet(i0, i1):
    sc.box(i0, 0.30, i1, 1.05, 0, 52, WD)
    ic = (i0 + i1) / 2
    for z in (17, 34):                       # 三抽屉 → 两条分隔线
        d.line([P(i0 + 0.03, 1.05, z), P(i1 - 0.03, 1.05, z)],
               fill=shade(WD, 0.28), width=1)
    for z in (9, 26, 43):                    # 金属拉手
        d.line([P(ic - 0.07, 1.05, z), P(ic + 0.07, 1.05, z)],
               fill=shade(MT, 0.55), width=1)

cabinet(0.05, 0.50)
cabinet(1.50, 1.95)

# ── 3) 桌面板: 顶面木纹, 前缘 cyan(点缀 1/2) ──
top = sc.box(0.0, 0.25, 2.0, 1.10, 52, 64, WT, top_edge=CY)
sc.texture(top, WT, noise=6, weave=7, seed=11)

# ── 4) 双显示器(dark_metal 机身, +j 面内嵌屏幕), 底座连到桌面 ──
LINE_W = [0.30, 0.42, 0.24, 0.46, 0.34, 0.40, 0.20]

def monitor(i0, i1, seed_shift=0):
    ic = (i0 + i1) / 2
    sc.box(ic - 0.14, 0.40, ic + 0.14, 0.62, 64, 66, DM)      # 底座脚
    sc.box(ic - 0.04, 0.43, ic + 0.04, 0.51, 66, 72, DM)      # 立柱
    sc.box(i0, 0.42, i1, 0.50, 70, 112, DM)                    # 机身
    si0, si1 = i0 + 0.03, i1 - 0.03
    sc.panel_j(0.50, si0, si1, 74, 108, SC, f=0.68)            # 屏底(自发光, 靠齐 desk_exec)
    sc.panel_j(0.50, si0, si1, 104, 108, SC, f=1.00)           # 标题栏
    z = 100
    for k in range(6):                                         # 代码行(亮蓝白)
        w = LINE_W[(k + seed_shift) % len(LINE_W)]
        x0 = si0 + 0.02 + (0.05 if k % 3 == 1 else 0.0)
        sc.panel_j(0.50, x0, min(x0 + w, si1 - 0.02), z - 2, z, SC, f=1.35)
        z -= 4
    sc.panel_j(0.50, si0, si1, 74, 76, SC, f=0.40)             # 底部任务栏(暗)
    sc.panel_j(0.50, i1 - 0.075, i1 - 0.055, 71, 73, WM, f=1.0)  # 电源灯(warm)

monitor(0.35, 0.95, 0)
monitor(1.05, 1.65, 3)

# ── 5) 键盘 + 键帽微高光 ──
sc.box(0.70, 0.75, 1.30, 1.00, 64, 69, DM)
for r, jk in enumerate((0.775, 0.835, 0.895)):
    for c in range(9):
        ik = 0.73 + c * 0.062 + 0.012 * r
        d.polygon([P(ik, jk, 69), P(ik + 0.045, jk, 69),
                   P(ik + 0.045, jk + 0.042, 69), P(ik, jk + 0.042, 69)],
                  fill=shade(DM, 1.45))

# ── 6) 主机塔(最近, 最后画): +j 面 cyan 竖发光线(点缀 2/2) ──
sc.box(1.55, 1.25, 1.95, 1.90, 0, 58, DM)
sc.panel_j(1.90, 1.58, 1.92, 4, 54, DM, f=0.50)                # 前面板内衬
d.line([P(1.63, 1.90, 8), P(1.63, 1.90, 48)], fill=shade(CY, 0.40), width=3)
d.line([P(1.63, 1.90, 8), P(1.63, 1.90, 48)], fill=shade(CY, 1.00), width=1)
sc.panel_j(1.90, 1.84, 1.87, 44, 47, MT, f=0.80)               # 电源钮
for k in range(3):                                              # 顶面散热槽
    d.line([P(1.61 + k * 0.10, 1.32, 58), P(1.61 + k * 0.10, 1.83, 58)],
           fill=shade(DM, 0.70), width=1)

sc.save_std('std-workstation-2x2.png', name='workstation-2x2')
