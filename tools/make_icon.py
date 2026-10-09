"""Atrium 图标：黑底白色首字母，A 是按 X 那套语言**画出来的字形**，不是字体。

X 的 logo 之所以像"设计过的"，靠的是四件事：字形占满、笔画粗、末端是**平切或 45° 斜切**
（不是圆头）、左右两笔不一样重。这里把同样的手法用在 A 上，出四个方案：

  v1 正切  —— 顶口平切、两脚平切、横杠齐平。最稳，小尺寸最清楚。
  v2 模板  —— 横杠左端留一道断口（喷漆模板那种），顶上 45° 斜切。最有"设计"味。
  v3 斜压  —— 左右两笔不等粗、横杠做成平行四边形（往右上抬）。最有动势，也最激进。
  v4 斜顶  —— v1 的骨架 + 顶口只留一刀 45° 斜切。推荐：小尺寸不糊，又比 v1 有辨识度。

⚠ v2 的断口与 v3 的斜横杠在 32 / 16 像素上会读成"画坏了"（对照图里看得见），
   所以真要选它们，得同时接受任务栏与托盘里那个小尺寸会变差。

产出：
  build/icon.png / build/icon.ico     当前定稿方案（--variant 指定，默认 v4 斜顶）
  build/icon-invert.png               白底黑字版（浅色背景上用）
  docs/screenshots/preview-icon-variants.png  四方案 × 256/64/32/24/16 的对照图（--preview 出）

用法：
  python tools/make_icon.py --preview            # 只看对照图
  python tools/make_icon.py --variant=v2         # 定稿 v2 并重出 png/ico
"""
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")

# 画布与配色：X 用的是纯黑圆角方块 + 纯白字形；这里留一点点灰，免得在深色任务栏上糊成一团
BG = (10, 10, 12, 255)
FG = (255, 255, 255, 255)
SUPER = 2048  # 先按这个尺寸画，再缩到目标 —— 抗锯齿全靠它


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def inner_x(half: float, y0: float, y: float, cx: float = 0.5) -> float:
    """A 的内三角在高度 y 处的半宽（从内顶点 y0 线性张开到脚口）"""
    t = (y - y0) / (0.90 - y0)
    return half * max(0.0, min(1.0, t))


def glyph_v1() -> list[tuple[list[tuple[float, float]], str]]:
    """正切：外三角（顶口平切）→ 挖上三角 → 挖下开口。横杠就是两挖之间留下的那条。"""
    yA, a = 0.115, 0.052  # 顶口高度与半宽（平切）
    R = 0.395  # 脚口外沿半宽
    r = 0.185  # 脚口内沿半宽
    y0 = 0.295  # 内顶点
    y1, y2 = 0.575, 0.675  # 横杠上下沿
    out = [
        ([(0.5 - a, yA), (0.5 + a, yA), (0.5 + R, 0.90), (0.5 - R, 0.90)], "fill"),
        ([(0.5, y0), (0.5 + inner_x(r, y0, y1), y1), (0.5 - inner_x(r, y0, y1), y1)], "cut"),
        (
            [
                (0.5 - inner_x(r, y0, y2), y2),
                (0.5 + inner_x(r, y0, y2), y2),
                (0.5 + r, 0.90),
                (0.5 - r, 0.90),
            ],
            "cut",
        ),
    ]
    return out


def glyph_v2() -> list[tuple[list[tuple[float, float]], str]]:
    """模板：顶上改 45° 斜切，横杠左端断一刀（喷漆模板的读法）。"""
    yA, a = 0.115, 0.052
    R, r, y0 = 0.395, 0.185, 0.295
    y1, y2 = 0.575, 0.675
    out = [
        # 左肩平、右肩斜切下来 —— 这一刀就是"设计过"的地方
        [(0.5 - a, yA), (0.5 + a, yA - 0.012), (0.5 + R, 0.90), (0.5 - R, 0.90)],
        ([(0.5, y0), (0.5 + inner_x(r, y0, y1), y1), (0.5 - inner_x(r, y0, y1), y1)], "cut"),
        (
            [
                (0.5 - inner_x(r, y0, y2), y2),
                (0.5 + inner_x(r, y0, y2), y2),
                (0.5 + r, 0.90),
                (0.5 - r, 0.90),
            ],
            "cut",
        ),
        # 横杠左端断口：从左边腿内侧往右切掉一小条
        (
            [
                (0.5 - inner_x(r, y0, y1) - 0.055, y1),
                (0.5 - inner_x(r, y0, y1) + 0.008, y1),
                (0.5 - inner_x(r, y0, y2) + 0.008, y2),
                (0.5 - inner_x(r, y0, y2) - 0.055, y2),
            ],
            "cut",
        ),
    ]
    return out


def glyph_v3() -> list[tuple[list[tuple[float, float]], str]]:
    """斜压：顶点右偏、左腿比右腿粗、横杠抬成平行四边形。"""
    cx = 0.482  # 顶点右偏一点，整字就有方向
    yA, a = 0.115, 0.05
    Rl, Rr = 0.415, 0.355  # 左腿外沿更开 = 左腿更粗
    r = 0.175
    y0 = 0.30
    yl1, yr1 = 0.585, 0.555  # 横杠：左边低、右边高
    yl2, yr2 = 0.685, 0.655
    out = [
        [(cx - a, yA), (cx + a, yA), (cx + Rr, 0.90), (cx - Rl, 0.90)],
        ([(cx, y0), (cx + inner_x(r, y0, yr1, cx), yr1), (cx - inner_x(r, y0, yl1, cx), yl1)], "cut"),
        (
            [
                (cx - inner_x(r, y0, yl2, cx), yl2),
                (cx + inner_x(r, y0, yr2, cx), yr2),
                (cx + r, 0.90),
                (cx - r, 0.90),
            ],
            "cut",
        ),
    ]
    return out


def glyph_v4() -> list[tuple[list[tuple[float, float]], str]]:
    """斜顶：v1 的骨架（粗腿、平脚、实心横杠）+ 顶口一刀 45° 斜切。
    只留一个"设计"手势，因为小尺寸（16/24 的任务栏与托盘）经不起第二处细节 ——
    v2 那道横杠断口在 32 像素上会糊成"横杠画坏了"。
    斜口拉得比第一版更狠（左肩 0.168 / 右肩 0.082），否则缩到 32 像素就看不出来了；
    内腔也放大一点（y0 0.285、脚口内沿 0.20），不然小尺寸上整个字糊成一块黑。"""
    yA_l, yA_r = 0.168, 0.082  # 左肩低、右肩高 = 斜顶
    R = 0.395
    r = 0.20
    y0 = 0.285
    y1, y2 = 0.575, 0.675
    out = [
        # 顶点不再是一条水平线，而是从左上到右下一条斜口；斜口方向与右腿走向呼应
        [(0.448, yA_l), (0.562, yA_r), (0.5 + R, 0.90), (0.5 - R, 0.90)],
        ([(0.5, y0), (0.5 + inner_x(r, y0, y1), y1), (0.5 - inner_x(r, y0, y1), y1)], "cut"),
        (
            [
                (0.5 - inner_x(r, y0, y2), y2),
                (0.5 + inner_x(r, y0, y2), y2),
                (0.5 + r, 0.90),
                (0.5 - r, 0.90),
            ],
            "cut",
        ),
    ]
    return out


VARIANTS = {
    "v1": (glyph_v1, "正切"),
    "v2": (glyph_v2, "模板"),
    "v3": (glyph_v3, "斜压"),
    "v4": (glyph_v4, "斜顶"),
}


def draw_mark(size: int, variant: str = "v4", invert: bool = False) -> Image.Image:
    """黑底白字（invert=False）；白底黑字（invert=True，给浅色背景用）"""
    bg, fg = (BG, FG) if not invert else ((255, 255, 255, 255), BG)
    s = SUPER
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(s * 0.02)
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=int(s * 0.215), fill=bg)

    shapes = VARIANTS[variant][0]()
    for shape in shapes:
        # 约定：裸 list = 一笔画白；(点列, 'cut') = 拿背景色挖掉
        pts, mode = (shape, "fill") if isinstance(shape, list) else shape
        px = [(x * s, y * s) for x, y in pts]
        d.polygon(px, fill=fg if mode == "fill" else bg)

    return img.resize((size, size), Image.LANCZOS)


def preview() -> None:
    """三方案 × 四个尺寸的对照图，直接开这张挑。
    每个尺寸贴三张：浅灰底 / 中灰底 / 白底反色件 —— 任务栏可能深可能浅，只看一种会挑错。
    （格子宽度按"两张并排 + 间距"算，第一版按单张算，结果互相压住了。）"""
    sizes = [256, 64, 32, 24, 16]
    gap = 20
    cells = [sz * 2 + gap * 2 + 16 for sz in sizes]
    pad, row_h = 40, 560
    W = pad * 2 + sum(cells)
    H = pad * 2 + row_h * len(VARIANTS)
    sheet = Image.new("RGBA", (W, H), (246, 246, 248, 255))
    d = ImageDraw.Draw(sheet)
    for i, (key, (_, name)) in enumerate(VARIANTS.items()):
        top = pad + 30 + i * row_h
        d.text((pad, top - 26), key + " · " + name, fill=(20, 20, 24, 255))
        x = pad
        for j, sz in enumerate(sizes):
            mark = draw_mark(sz, key)
            inv = draw_mark(sz, key, invert=True)
            d.rectangle([x, top, x + sz, top + sz], fill=(236, 236, 239, 255))
            sheet.paste(mark, (x, top), mark)
            x2 = x + sz + gap
            d.rectangle([x2, top, x2 + sz, top + sz], fill=(168, 168, 175, 255))
            sheet.paste(mark, (x2, top), mark)
            d.text((x, top + sz + 4), str(sz), fill=(120, 120, 128, 255))
            if sz >= 64:
                y2 = top + sz + 24
                d.rectangle([x, y2, x + sz, y2 + sz], fill=(255, 255, 255, 255))
                sheet.paste(inv, (x, y2), inv)
            x += cells[j]
    out = os.path.join(ROOT, "docs", "screenshots", "preview-icon-variants.png")
    os.makedirs(BUILD, exist_ok=True)
    sheet.save(out)
    print("wrote", out, sheet.size)


def main() -> None:
    args = sys.argv[1:]
    if "--preview" in args:
        preview()
        return
    variant = "v4"
    for a in args:
        if a.startswith("--variant="):
            variant = a.split("=", 1)[1]
    if variant not in VARIANTS:
        print("不认识 --variant=" + variant + "（可填 v1/v2/v3）")
        sys.exit(1)

    os.makedirs(BUILD, exist_ok=True)
    mark = draw_mark(512, variant)
    png_path = os.path.join(BUILD, "icon.png")
    mark.resize((256, 256), Image.LANCZOS).save(png_path)
    ico_path = os.path.join(BUILD, "icon.ico")
    mark.save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    draw_mark(512, variant, invert=True).resize((256, 256), Image.LANCZOS).save(
        os.path.join(BUILD, "icon-invert.png")
    )
    print("wrote", png_path)
    print("wrote", ico_path)
    print("variant", variant, VARIANTS[variant][1], "sizes:", os.path.getsize(png_path), os.path.getsize(ico_path))


if __name__ == "__main__":
    main()
