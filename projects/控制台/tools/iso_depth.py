#!/usr/bin/env python3
"""等距深度排序(y-sort)叠加 —— 谁靠前谁在上层,动态遮挡。

老板 2026-07-10 痛点:盆栽应在桌子上方、秘书应在盆栽/桌子下方(按位置动态遮挡);
预合成 scene-bg + 固定图层顺序做不到,要按接地点排序。

原理(painter's algorithm / y-sort):
  等距场景里"靠前=靠下=在上层"。一个物件的前后深度由它的**接地点屏幕 y**决定
  (等距: sy = oy+(i+j)*HALF_H,所以接地点 y 越大 = i+j 越大 = 越靠前)。
  按 baseline(接地点 y)升序画:y 小的先画(在后/下层),y 大的后画(在前/上层)。
  地板永远最底(不参与,直接当背景 canvas)。走动的角色每帧按脚底 y 动态插入正确层。

大件注意:一个大 sprite 只有一个 baseline,对跨多格的家具不精确;
  若某大件与角色在同一深度带重叠出错,把它按 footprint 拆成前/后两片各给 baseline。
"""
from PIL import Image


def content_bottom(sprite):
    """sprite 内容底部 y(相对自身左上)。接地点默认取这里。"""
    bb = sprite.getbbox()
    return bb[3] if bb else sprite.height


def layer(sprite, x, y, baseline=None):
    """构造一个可参与深度排序的元素。
    x,y = 贴放左上; baseline = 接地点屏幕 y(默认 = 贴放 y + 内容底部)。"""
    if baseline is None:
        baseline = y + content_bottom(sprite)
    return {"img": sprite, "x": x, "y": y, "baseline": baseline}


def composite(canvas, layers):
    """把 layers 按 baseline 升序(靠后先画)合成到 canvas。就地修改并返回。"""
    for L in sorted(layers, key=lambda d: d["baseline"]):
        canvas.alpha_composite(L["img"], (int(L["x"]), int(L["y"])))
    return canvas
