#!/usr/bin/env python3
"""程序生成【经典 IDE 样式代码打字动画】——用作工位屏幕的动态内容层(干活状态)。

VSCode 深色风: 标题栏(红黄绿点+文件名) + 行号栏 + 语法高亮代码 + 打字机逐字出现 + 光标闪。
输出: 帧序列 PNG(可透视贴到等距屏幕) + 预览 gif。
可复用: 换 CODE 即换屏幕内容。
"""
import os, io, base64
from PIL import Image, ImageDraw, ImageFont

W, H = 560, 360
BG, BAR, GUTTER = (30, 30, 30), (45, 45, 48), (37, 37, 38)
LINENO, CURSOR = (110, 110, 110), (170, 200, 255)
# VSCode 配色
KW, CTRL, FN, STR, CMT, TXT, VAR, TYPE = (86,156,214),(197,134,192),(220,220,170),(206,145,120),(106,153,85),(212,212,212),(156,220,254),(78,201,176)
CODE = [
    [("from ",CTRL),("engine ",TYPE),("import ",CTRL),("run_node",FN)],
    [("import ",CTRL),("queue",TYPE)],
    [],
    [("def ",KW),("run_engine",FN),("(",TXT),("task",VAR),("):",TXT)],
    [("    q ",VAR),("= ",TXT),("queue",TYPE),(".Queue()",TXT)],
    [("    q.put",FN),("(",TXT),("task",VAR),(")",TXT)],
    [("    while ",CTRL),("not ",CTRL),("q.empty():",TXT)],
    [("        node ",VAR),("= ",TXT),("q.get()",TXT)],
    [("        result ",VAR),("= ",TXT),("run_node",FN),("(node)",TXT)],
    [("        if ",CTRL),("result.ok:",TXT)],
    [("            emit",FN),("(node.id)  ",TXT),("# 事件账本",CMT)],
    [("    return ",CTRL),('"done"',STR)],
]


def load_font(sz):
    for p in ("/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/Monaco.ttf",
              "/System/Library/Fonts/SFNSMono.ttf", "/Library/Fonts/Menlo.ttc"):
        if os.path.exists(p):
            try: return ImageFont.truetype(p, sz)
            except Exception: pass
    return ImageFont.load_default()


FONT = load_font(15)
TITLE = load_font(12)
LH = 24          # 行高
X0 = 52          # 代码起始 x(行号栏后)
Y0 = 42          # 代码起始 y(标题栏后)


def total_chars():
    return sum(sum(len(t) for t, _ in line) for line in CODE)


def render(chars_shown, cursor_on):
    im = Image.new("RGBA", (W, H), BG + (255,))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 30], fill=BAR)                       # 标题栏
    for i, c in enumerate([(255,95,86),(255,189,46),(39,201,63)]):
        d.ellipse([14 + i*20, 10, 24 + i*20, 20], fill=c)
    d.text((90, 8), "engine_runner.py", font=TITLE, fill=(200,200,200))
    d.rectangle([0, 30, 44, H], fill=GUTTER)                   # 行号栏
    shown, cx, cy = 0, X0, Y0
    for ln, line in enumerate(CODE):
        d.text((14, Y0 + ln*LH), str(ln+1), font=TITLE, fill=LINENO)
        x = X0
        for text, col in line:
            for ch in text:
                if shown >= chars_shown:
                    cx, cy = x, Y0 + ln*LH
                    if cursor_on:
                        d.rectangle([cx, cy+2, cx+2, cy+17], fill=CURSOR)
                    return im
                d.text((x, Y0 + ln*LH), ch, font=FONT, fill=col)
                x += 9; shown += 1
            cx, cy = x, Y0 + ln*LH
    if cursor_on:
        d.rectangle([cx, cy+2, cx+2, cy+17], fill=CURSOR)
    return im


def main():
    tc = total_chars()
    frames = []
    step = 4
    for k in range(0, tc + 1, step):
        frames.append(render(k, (k // step) % 2 == 0))
    for _ in range(10):                                        # 末尾停顿+光标闪
        frames.append(render(tc, len(frames) % 2 == 0))
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "..", "artifacts", "office-assets", "screens", "ide-typing")
    os.makedirs(out_dir, exist_ok=True)
    for i, f in enumerate(frames):
        f.save(os.path.join(out_dir, f"frame_{i:03d}.png"))
    flat = [f.convert("RGB").quantize(colors=200) for f in frames]
    gif_path = os.path.join(out_dir, "preview.gif")
    flat[0].save(gif_path, save_all=True, append_images=flat[1:], duration=70, loop=0)
    print(f"IDE 打字动画: {len(frames)} 帧 -> {gif_path}")
    return gif_path


if __name__ == "__main__":
    main()
