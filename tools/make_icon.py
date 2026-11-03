#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""BiliFound Windows 图标生成器。

产出：
  build/icon.png        1024×1024 透明 PNG（BrowserWindow / 文档预览）
  build/icon.ico        多尺寸 ICO（exe 资源、任务栏、Alt-Tab、资源管理器）
  assets/icon.png|ico   随包分发的副本（打包后 build/ 不在应用内）
  build/icon-preview.png 16/32/48/96 预览条

用法：
  python tools/make_icon.py                        # 用 build/icon-source.png
  python tools/make_icon.py 源图.png                # 指定源图
  python tools/make_icon.py 手绘稿.jpg --ink        # 白底黑线：白转透明 + 自动裁边
  python tools/make_icon.py 源图.png --pad 0.74     # 图形占画布的比例（默认 0.72）
  python tools/make_icon.py 手绘稿.jpg --ink --tile  # 再垫一层圆角底板（深色任务栏也看得清）
  python tools/make_icon.py 手绘稿.jpg --ink --tile --tile-colors 255,255,255,248,249,251  # 白底

--ink 会把「白底」理解成透明，并按墨色浓淡生成 alpha；适合扫描/手绘稿。
小尺寸（≤48）会额外加粗一点笔画，否则 16px 下细线会糊没。
"""
import os
import sys

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
DEFAULT_SRC = os.path.join(BUILD, "icon-source.png")

ICO_SIZES = [16, 24, 32, 40, 48, 64, 96, 128, 256]
PNG_SIZE = 1024


def parse_args(argv):
    opts = {"src": None, "ink": False, "pad": 0.72, "tile": False,
            "tile-top": (255, 157, 187), "tile-bottom": (251, 114, 153)}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--ink":
            opts["ink"] = True
        elif a == "--tile":
            opts["tile"] = True
        elif a == "--tile-colors":
            i += 1
            r1, g1, b1, r2, g2, b2 = [int(x) for x in argv[i].split(",")]
            opts["tile-top"] = (r1, g1, b1)
            opts["tile-bottom"] = (r2, g2, b2)
        elif a == "--pad":
            i += 1
            opts["pad"] = float(argv[i])
        elif not a.startswith("--") and opts["src"] is None:
            opts["src"] = a
        i += 1
    return opts


def ink_layer(im):
    """白底黑线 → 透明底黑墨。alpha 由「有多黑」决定。"""
    im = im.convert("RGB")
    gray = im.convert("L")
    # 轻度提拉：让铅笔的中灰也能保留一点浓度，纯白严格归零
    alpha = gray.point(lambda v: max(0, min(255, int((255 - v) * 1.08))))
    out = Image.new("RGBA", im.size, (18, 18, 22, 0))
    out.putalpha(alpha)
    return out


def trim(im):
    """按 alpha 裁掉四周空白。"""
    a = im.getchannel("A").point(lambda v: 255 if v > 10 else 0)
    bbox = a.getbbox()
    return im.crop(bbox) if bbox else im


def with_tile(im, top, bottom, size=2048, radius=0.235, art=0.70):
    """黑墨垫一层圆角底板：深色/浅色背景下都能看清。"""
    from PIL import ImageDraw

    S = size
    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # 竖向渐变
    grad = Image.new("RGB", (1, S))
    for y in range(S):
        t = y / (S - 1)
        grad.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    grad = grad.resize((S, S))

    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * radius), fill=255)
    canvas.paste(grad, (0, 0), mask)

    # 顶部一层很淡的高光，避免整块死板
    hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hl).rounded_rectangle(
        (int(S * 0.04), int(S * 0.04), int(S * 0.96), int(S * 0.56)),
        radius=int(S * radius * 0.9), fill=(255, 255, 255, 26),
    )
    canvas.alpha_composite(hl)

    # 墨：亮度归一化到近黑，叠在底板上
    w, h = im.size
    k = min((S * art) / w, (S * art) / h)
    nw, nh = max(1, int(round(w * k))), max(1, int(round(h * k)))
    art_im = im.resize((nw, nh), Image.LANCZOS)
    px = art_im.load()
    for yy in range(nh):
        for xx in range(nw):
            r, g, b, a = px[xx, yy]
            if a:
                px[xx, yy] = (26, 24, 30, a)
    canvas.alpha_composite(art_im, ((S - nw) // 2, (S - nh) // 2))

    # 底板描边：浅色底板在白色背景上也要能看出边界，深色底板则加一道浅边
    lum = (0.299 * top[0] + 0.587 * top[1] + 0.114 * top[2] + 0.299 * bottom[0] + 0.587 * bottom[1] + 0.114 * bottom[2]) / 2
    edge = (16, 18, 24, 30) if lum > 150 else (255, 255, 255, 44)
    lw = max(2, int(S * 0.007))
    ImageDraw.Draw(canvas).rounded_rectangle(
        (lw // 2, lw // 2, S - 1 - lw // 2, S - 1 - lw // 2),
        radius=int(S * radius), outline=edge, width=lw,
    )
    return canvas


def fit(im, size, pad):
    """等比缩放到 size×size 画布，图形占 pad 比例，居中，保留透明边。"""
    box = int(round(size * pad))
    w, h = im.size
    k = min(box / w, box / h)
    nw, nh = max(1, int(round(w * k))), max(1, int(round(h * k)))
    scaled = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(scaled, ((size - nw) // 2, (size - nh) // 2), scaled)
    return canvas


def small_size_boost(im, size):
    """小尺寸加粗笔画：放大 4 倍做一次 MaxFilter，再缩回去。"""
    big = im.resize((size * 4, size * 4), Image.LANCZOS)
    big = big.filter(ImageFilter.MaxFilter(3))
    return big.resize((size, size), Image.LANCZOS)


def main():
    opts = parse_args(sys.argv[1:])
    src = opts["src"] or DEFAULT_SRC
    if not os.path.exists(src):
        raise SystemExit(f"找不到源图：{src}")
    os.makedirs(BUILD, exist_ok=True)

    im = Image.open(src)
    print(f"源图：{src}  {im.width}x{im.height}  mode={im.mode}")
    if opts["ink"]:
        im = ink_layer(im)
        print("  → 白底转透明（--ink）")
    elif im.mode != "RGBA":
        im = im.convert("RGBA")

    before = im.size
    im = trim(im)
    print(f"  → 裁边：{before[0]}x{before[1]} → {im.width}x{im.height}")

    if opts["tile"]:
        im = with_tile(im, opts["tile-top"], opts["tile-bottom"])
        print("  → 垫圆角底板（粉色渐变）")

    pad = opts["pad"]
    if opts["tile"]:
        pad = 0.94
    # 源图本身已经占满画布（例如已合成好的图标）时，原样保留，别二次缩小
    coverage = max(im.width, im.height) / float(PNG_SIZE)
    if not opts["tile"] and not opts["src"] and coverage >= 0.88:
        pad = coverage
        print(f"  → 源图已占满画布（{coverage:.0%}），保持原始比例")
    big = fit(im, PNG_SIZE, pad)
    print(f"  → 画布 {PNG_SIZE}×{PNG_SIZE}，图形占 {int(pad * 100)}%")

    png_path = os.path.join(BUILD, "icon.png")
    big.save(png_path, "PNG")
    print(f"写出 {png_path}")

    frames = []
    for s in ICO_SIZES:
        f = fit(im, s, pad)
        if s <= 48 and not opts["tile"]:
            f = small_size_boost(f, s)
        frames.append(f)

    ico_path = os.path.join(BUILD, "icon.ico")
    frames[-1].save(ico_path, format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"写出 {ico_path}  ({', '.join(str(s) for s in ICO_SIZES)})")

    assets = os.path.join(ROOT, "assets")
    os.makedirs(assets, exist_ok=True)
    big.save(os.path.join(assets, "icon.png"), "PNG")
    frames[-1].save(os.path.join(assets, "icon.ico"), format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"写出 {assets}\\icon.png / icon.ico")

    # 预览：深色底一排 + 浅色底一排
    gap = 12
    strip_w = 16 + 24 + 32 + 48 + 96 + gap * 4 + 20
    preview = Image.new("RGBA", (strip_w, 96 * 2 + 30), (0, 0, 0, 0))
    for row, bg in enumerate([(28, 30, 38, 255), (245, 246, 250, 255)]):
        plate = Image.new("RGBA", (strip_w, 96 + 10), bg)
        preview.paste(plate, (0, row * (96 + 20)))
        x = 10
        for s in (16, 24, 32, 48, 96):
            icon = fit(im, s, pad)
            if s <= 48 and not opts["tile"]:
                icon = small_size_boost(icon, s)
            preview.paste(icon, (x, row * (96 + 20) + 5 + (96 - s) // 2), icon)
            x += max(s, 16) + gap
    preview_path = os.path.join(BUILD, "icon-preview.png")
    preview.save(preview_path, "PNG")
    print(f"写出 {preview_path}  (深/浅底预览)")


if __name__ == "__main__":
    main()
