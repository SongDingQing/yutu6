#!/usr/bin/env python3
"""isofurn — 黑色真皮三人沙发 2×1

结构(全部 core.box, 斜率恒 0.5):
  靠背  沿低 j 侧, z 0→64, top_edge 微亮
  扶手  两侧 i∈[0,0.20] / [1.80,2.0], z 0→52
  坐垫  两块 leather_dk, z 0→34, 顶面皮革噪点(weave=0)
  坐垫间缝隙一条暗线(顶面 + 前立面)
画序: 靠背(最小 j) → 左扶手(最小 i) → 坐垫 → 右扶手(最大 i)

方向光(评审返工后的定标, 全件统一):
  +j 立面(朝左下, 亮)  leather ×0.72 → (27,28,34) lum≈29
                       leather_dk ×1.00 → (26,28,34) lum≈28
  +i 立面(朝右下, 暗)  leather ×0.44 → (16,17,21) lum≈17
                       leather_dk ×0.57 → (14,15,19) lum≈16
  顶面为最亮层级(31-43)不变; 同朝向同材质系数全件一致。
"""
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from core import Scene, PAL
from core import shade

sc = Scene(fw=2, fd=1, height=80)
leather, leather_dk = PAL['leather'], PAL['leather_dk']

# 方向光系数(同朝向同材质全件一致)
LTH_LF, LTH_RF = 0.72, 0.44      # leather:    +j lum≈29 / +i lum≈17
DK_LF,  DK_RF  = 1.00, 0.57      # leather_dk: +j lum≈28 / +i lum≈16

# ── 1) 靠背(最远, 低 j 侧), 顶缘微亮 ──
back_hi = shade(leather, 1.55)
sc.box(0.0, 0.0, 2.0, 0.22, 0, 64, leather, top_edge=back_hi,
       left_f=LTH_LF, right_f=LTH_RF)

# 靠背前立面上, 与坐垫缝隙对齐的竖向暗缝(暗示靠背分块)
back_seam = shade(leather, 0.35)
sc.d.line([sc.P(1.0, 0.22, 60), sc.P(1.0, 0.22, 34)], fill=back_seam, width=1)

# ── 2) 左扶手 ──
arm_hi = shade(leather, 1.40)
sc.box(0.0, 0.0, 0.20, 0.92, 0, 52, leather, top_edge=arm_hi,
       left_f=LTH_LF, right_f=LTH_RF)

# ── 3) 坐垫两块(leather_dk, 顶面提亮出坐垫感) + 顶面皮革噪点 ──
CUSH_TOP_F = 1.35
cush_top = shade(leather_dk, CUSH_TOP_F)[:3]
cush_hi = shade(leather_dk, 1.75)
t1 = sc.box(0.22, 0.22, 1.0, 0.88, 0, 34, leather_dk, top_edge=cush_hi,
            top_f=CUSH_TOP_F, left_f=DK_LF, right_f=DK_RF)
t2 = sc.box(1.0, 0.22, 1.78, 0.88, 0, 34, leather_dk, top_edge=cush_hi,
            top_f=CUSH_TOP_F, left_f=DK_LF, right_f=DK_RF)
sc.texture(t1, cush_top, noise=6, weave=0, seed=11)
sc.texture(t2, cush_top, noise=6, weave=0, seed=23)

# ── 4) 坐垫间缝隙暗线(顶面沿 j 向 + 前立面短竖线) ──
seam = shade(leather_dk, 0.45)
sc.d.line([sc.P(1.0, 0.22, 34), sc.P(1.0, 0.88, 34)], fill=seam, width=1)
sc.d.line([sc.P(1.0, 0.88, 34), sc.P(1.0, 0.88, 14)], fill=seam, width=1)

# ── 5) 右扶手(最近, 大 i) ──
sc.box(1.80, 0.0, 2.0, 0.92, 0, 52, leather, top_edge=arm_hi,
       left_f=LTH_LF, right_f=LTH_RF)

sc.save_std('std-sofa-2x1.png', name='sofa-2x1')
