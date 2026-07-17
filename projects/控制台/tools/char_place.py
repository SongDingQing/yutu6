#!/usr/bin/env python3
"""角色摆放工具 —— 统一"人物 vs 格子"比例 + 定位到格 + 脚底锚点对齐。

老板 2026-07-08:比例渲染用工具承接,别每次手调;所有人物和格子比例应近似。
标准:站姿人物身高 = PERSON_H(相对 tile 顶面 128×64,pitch 64/32)。
所有站姿角色(秘书/员工/访客)一律缩到 PERSON_H,统一比例;摆到格子时脚底对齐格 diamond 底点。

用法:
  from char_place import place, PERSON_H
  place(scene_img, char_png_or_Image, (i,j), ox, oy)   # 就地合成到 scene
"""
from PIL import Image

PX, PY, TILE_H = 64, 32, 64
PERSON_H = 170            # 站姿人物统一身高(≈2.65 个 tile 顶面高),秘书/员工/访客共用(老板 2026-07-09 两轮 +20%)


def grid_to_screen(i, j, ox, oy):
    return (ox + (i - j) * PX, oy + (i + j) * PY)


def scale_person(img, person_h=PERSON_H):
    """裁剪到内容 bbox + 等比缩放到统一身高。"""
    if isinstance(img, str):
        img = Image.open(img)
    img = img.convert("RGBA")
    bb = img.getbbox()
    if bb:
        img = img.crop(bb)
    w = max(1, round(img.width * person_h / img.height))
    return img.resize((w, person_h), Image.LANCZOS)


def place(scene, char, cell, ox, oy, person_h=PERSON_H, dx=0, dy=0):
    """把角色缩到统一身高、脚底中心对齐格(cell)的 diamond 底点,合成到 scene。"""
    im = scale_person(char, person_h)
    sx, sy = grid_to_screen(cell[0], cell[1], ox, oy)
    left = sx - im.width // 2 + dx
    top = sy + TILE_H - im.height + dy       # 脚底对齐格 diamond 底点
    scene.alpha_composite(im, (int(left), int(top)))
    return scene
