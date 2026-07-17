#!/usr/bin/env python3
"""exec_chair — 董事长高背真皮椅 1x1 (isofurn)

五星底座(disc)+气压中柱+真皮坐垫+左右扶手+高背(带水平缝线)+头枕。
比员工工学椅(office_chair)明显大一号、更厚重: 全真皮、背更高、有头枕有扶手。
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core import Scene, PAL, shade

sc = Scene(fw=1, fd=1, height=130)

CX, CY = 0.5, 0.5                    # 底座中心
L, LDK, DM, MT = PAL['leather'], PAL['leather_dk'], PAL['dark_metal'], PAL['metal']
HL  = shade(L, 1.35)[:3]             # 皮革顶缘弱高光
HLK = shade(LDK, 1.40)[:3]           # 深皮顶缘弱高光

# ── 1. 接地软阴影(最先画, 最低) ──
sc.disc(CX, CY, 0, 29, LDK, 0.55)

# ── 2. 五星脚轮: 沿底盘椭圆(屏幕 rx=25)边缘 5 个小轮, 一腿朝向观察者正前 ──
CASTERS = [(0.195, 0.195), (-0.125, 0.245), (-0.273, -0.043),
           (-0.043, -0.273), (0.245, -0.125)]
for di, dj in CASTERS:
    sc.disc(CX + di, CY + dj, 1, 5, DM, 1.35)

# ── 3. 底盘(压住脚轮, 缩小让脚轮露出) + 上层倒角 + 中心轮毂 ──
sc.disc(CX, CY, 3, 23, DM)
sc.disc(CX, CY, 4, 18, DM, 1.45)
sc.disc(CX, CY, 5, 8, DM, 1.80)

# ── 4. 气压中柱到座下机构(z=30): 外柱暗 + 内侧细亮线 ──
sc.rod(CX, CY, 4, 30, 7, DM)
sc.rod(CX - 0.016, CY + 0.016, 6, 29, 2, MT)   # 亮线左移2px, 垂直不破坏等距

# ── 5. 座下倾仰机构(暗金属小盒, 衔接中柱与坐垫底) ──
sc.box(0.32, 0.32, 0.68, 0.68, 26, 31, DM)

# ── 6. 坐垫(厚真皮) + 顶面皮纹 + 前缘缝线 ──
seat_top = sc.box(0.14, 0.14, 0.86, 0.86, 30, 46, L, top_edge=HL, top_f=1.12)
sc.texture(seat_top, L, noise=6, weave=7, seed=5)
# 坐垫前(+j)面近底部一条暗缝线(包边)
sc.d.line([sc.P(0.14, 0.86, 33), sc.P(0.86, 0.86, 33)],
          fill=shade(LDK, 0.55), width=1)

# ── 7. 高背(低 j 侧, 真皮) + 顶缘高光 ──
sc.box(0.14, 0.10, 0.86, 0.26, 46, 122, L, top_edge=HL)
# +j 可见面皮纹
back_face = [sc.P(0.14, 0.26, 122), sc.P(0.86, 0.26, 122),
             sc.P(0.86, 0.26, 46),  sc.P(0.14, 0.26, 46)]
sc.texture(back_face, shade(L, 0.60)[:3], noise=5, weave=8, seed=17)
# 3 条水平缝线(暗槽+下方1px受光, 体现皮革分段坐感)
for z in (64, 84, 104):
    sc.d.line([sc.P(0.17, 0.26, z), sc.P(0.83, 0.26, z)],
              fill=shade(LDK, 0.50), width=1)
    sc.d.line([sc.P(0.17, 0.26, z - 2), sc.P(0.83, 0.26, z - 2)],
              fill=shade(L, 0.82), width=1)

# ── 8. 头枕(顶部略窄一段, 更厚重的商务轮廓) ──
sc.box(0.22, 0.10, 0.78, 0.26, 122, 134, L, top_edge=HL, top_f=1.12)
sc.d.line([sc.P(0.25, 0.26, 127), sc.P(0.75, 0.26, 127)],
          fill=shade(LDK, 0.50), width=1)

# ── 9. 左右扶手(深皮, 先远 i 后近 i) ──
sc.box(0.06, 0.30, 0.20, 0.80, 46, 64, LDK, top_edge=HLK, top_f=1.10)
sc.box(0.80, 0.30, 0.94, 0.80, 46, 64, LDK, top_edge=HLK, top_f=1.10)

sc.save_std('std-exec-chair-1x1.png', name='exec-chair-1x1')
