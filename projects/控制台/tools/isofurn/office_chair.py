#!/usr/bin/env python3
"""office_chair — 员工人体工学椅 1x1 (isofurn)

五星底座(disc)+气压中柱+网布坐垫+低靠背(dark_metal 框 + mesh 内嵌面板)。
比董事长椅明显小一号、朴素; 无头枕、无扶手。
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import Scene, PAL

sc = Scene(fw=1, fd=1, height=100)

CX, CY = 0.5, 0.5           # 底座中心

# ── 1. 接地软阴影(先画, 最低) ──
sc.disc(CX, CY, 0, 24, PAL['leather_dk'], 0.55)

# ── 2. 五星脚轮: 沿底盘椭圆边缘 5 个小轮(屏幕椭圆 rx=21 反解回网格坐标) ──
CASTERS = [(0.164, 0.164), (-0.105, 0.207), (-0.229, -0.036),
           (-0.036, -0.229), (0.207, -0.105)]
for di, dj in CASTERS:
    sc.disc(CX + di, CY + dj, 1, 5, PAL['dark_metal'], 1.35)

# ── 3. 底盘(略抬起压在脚轮上, 缩小让脚轮露出) + 上层倒角 + 中心轮毂 ──
sc.disc(CX, CY, 3, 18, PAL['dark_metal'])
sc.disc(CX, CY, 4, 14, PAL['dark_metal'], 1.45)
sc.disc(CX, CY, 5, 7, PAL['dark_metal'], 1.80)

# ── 4. 气压中柱到坐垫底(z=28): 外柱暗 + 内侧细亮线 ──
sc.rod(CX, CY, 4, 28, 6, PAL['dark_metal'])
sc.rod(CX, CY, 6, 27, 2, PAL['metal'])

# ── 5. 坐垫(mesh 偏灰) + 顶面织纹 + 近侧顶缘一线弱高光 ──
from core import shade
seat_top = sc.box(0.18, 0.18, 0.82, 0.82, 28, 40, PAL['mesh'],
                  top_edge=shade(PAL['mesh'], 1.35)[:3])
sc.texture(seat_top, PAL['mesh'], noise=6, weave=5, seed=11)

# ── 6. 靠背框(低 j 侧, dark_metal), 顶缘一线弱高光 ──
sc.box(0.18, 0.14, 0.82, 0.26, 40, 96, PAL['dark_metal'],
       top_edge=PAL['mesh'])

# ── 7. +j 可见面内嵌网布面板(略小一圈, 提亮与暗框拉开对比)+ 织纹 ──
panel = sc.panel_j(0.26, 0.23, 0.77, 46, 91, PAL['mesh'], f=0.72)
sc.texture(panel, shade(PAL['mesh'], 0.72)[:3], noise=5, weave=4, seed=23)
# 腰托暗带(面板中下部一条略暗横带, 体现人体工学分区)
sc.panel_j(0.26, 0.23, 0.77, 58, 62, PAL['mesh'], f=0.55)

sc.save_std('std-office-chair-1x1.png', name='office-chair-1x1')
