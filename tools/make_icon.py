"""生成 A 素材管家的图标：黑白首字母、几何画的 A（不依赖任何字体文件）。

产出：
  build/icon.png   256x256（dev 下窗口与托盘用）
  build/icon.ico   16/24/32/48/64/128/256 多档（electron-builder 用）

用法：python tools/make_icon.py
"""
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
BASE = 512


def draw_mark(size: int, invert: bool = False) -> Image.Image:
    """invert=False：白底黑字（任务栏/托盘用）；invert=True：黑底白字（深色截图对比用）"""
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    bg = (255, 255, 255, 255) if not invert else (16, 16, 20, 255)
    fg = (16, 16, 20, 255) if not invert else (255, 255, 255, 255)

    pad = int(s * 0.02)
    radius = int(s * 0.20)
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=radius, fill=bg)

    # 几何 A：两条斜腿 + 横杠。推特 X 那种风格 = 字形占满、笔画粗、留白少
    w = max(2, int(s * 0.135))
    apex = (s * 0.50, s * 0.155)
    left_foot = (s * 0.145, s * 0.845)
    right_foot = (s * 0.855, s * 0.845)
    d.line([apex, left_foot], fill=fg, width=w, joint="curve")
    d.line([apex, right_foot], fill=fg, width=w, joint="curve")

    # 横杠：卡在两条腿之间，位置按相似三角形算出来，避免肉眼对齐
    bar_y = s * 0.63
    t = (bar_y - apex[1]) / (left_foot[1] - apex[1])
    half = (right_foot[0] - left_foot[0]) / 2 * t
    cx = s * 0.50
    inset = w * 0.30
    d.line([(cx - half - inset, bar_y), (cx + half + inset, bar_y)], fill=fg, width=int(w * 0.85))

    return img


def main() -> None:
    os.makedirs(BUILD, exist_ok=True)

    mark = draw_mark(BASE)
    png_path = os.path.join(BUILD, "icon.png")
    mark.resize((256, 256), Image.LANCZOS).save(png_path)

    ico_path = os.path.join(BUILD, "icon.ico")
    mark.save(
        ico_path,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    # 深色版给 README / 浅色主题留个备选
    mark_dark = draw_mark(BASE, invert=True)
    mark_dark.resize((256, 256), Image.LANCZOS).save(os.path.join(BUILD, "icon-invert.png"))

    print("wrote", png_path)
    print("wrote", ico_path)
    print("sizes:", os.path.getsize(png_path), os.path.getsize(ico_path))


if __name__ == "__main__":
    main()
