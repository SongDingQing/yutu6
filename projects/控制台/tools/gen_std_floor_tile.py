#!/usr/bin/env python3
"""程序化生成【几何精确】的标准等距地板 tile。

为什么程序生成:AI 生成的地块 diamond 边斜率不标准(实测 0.64,应为 0.5),
永远拼不齐。程序生成保证:
  - diamond 顶面严格 128×64 (2:1),四顶点整数、边斜率恰为 1:2
  - pitch 64/32 拼接时相邻 tile 的边【像素级重合】,青色边线连成整片网格
参数化:颜色/厚度可调,随时重生成一整套标准地块。

画布 130×98:diamond 顶点 top(65,16) right(129,48) bottom(65,80) left(1,48)。
渲染器用 FLOOR_TOP_IN_IMG=(65,16), HALF=(64,32)。
"""
import os, random
from PIL import Image, ImageDraw

W, H = 130, 98
TH = 14                                   # 厚度(px)
TOP, RIGHT, BOT, LEFT = (65, 16), (129, 48), (65, 80), (1, 48)

TOP_FILL   = (52, 49, 62, 255)            # 顶面地毯(取自现有画风中心色)
SIDE_L     = (30, 28, 38, 255)            # 左下侧厚度(暗)
SIDE_R     = (23, 22, 30, 255)            # 右下侧厚度(更暗)
CYAN       = (110, 168, 254, 255)         # 前两条边高光 #6ea8fe
BACK_EDGE  = (68, 64, 80, 255)            # 后两条边微亮描边


def make_tile(path):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # 厚度侧面(先画,在顶面下)
    d.polygon([LEFT, BOT, (BOT[0], BOT[1] + TH), (LEFT[0], LEFT[1] + TH)], fill=SIDE_L)
    d.polygon([BOT, RIGHT, (RIGHT[0], RIGHT[1] + TH), (BOT[0], BOT[1] + TH)], fill=SIDE_R)
    # 顶面 diamond
    d.polygon([TOP, RIGHT, BOT, LEFT], fill=TOP_FILL)
    # 地毯纹理: 顶面内加细噪点 + 沿等距双向的编织细纹(固定种子, 可复现)
    random.seed(42)
    px = im.load()
    for y in range(TOP[1], BOT[1] + 1):
        for x in range(LEFT[0], RIGHT[0] + 1):
            r, g, b, a = px[x, y]
            if a > 0 and (r, g, b) == TOP_FILL[:3]:
                n = random.randint(-6, 6)
                # 沿等距两个方向的编织暗纹(每 4px 一道极淡线)
                if (x + 2 * y) % 8 == 0 or (x - 2 * y) % 8 == 0:
                    n -= 5
                px[x, y] = (max(0, r + n), max(0, g + n), max(0, b + n), 255)
    # 后两条边(左上、右上)微亮描边
    d.line([LEFT, TOP], fill=BACK_EDGE, width=1)
    d.line([TOP, RIGHT], fill=BACK_EDGE, width=1)
    # 前两条边(左下、右下)青色高光 —— 拼接基准线
    d.line([LEFT, BOT], fill=CYAN, width=2)
    d.line([BOT, RIGHT], fill=CYAN, width=2)
    im.save(path)
    print("wrote", path, im.size, "| diamond 128×64 边斜率精确 1:2")


if __name__ == "__main__":
    out_dir = "artifacts/office-assets/v3-tileset/std"
    os.makedirs(out_dir, exist_ok=True)
    make_tile(os.path.join(out_dir, "std-floor-1x1.png"))
