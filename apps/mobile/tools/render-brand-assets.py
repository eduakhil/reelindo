from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)
SIZE = 1024


def gradient(size: tuple[int, int]) -> Image.Image:
    width, height = size
    image = Image.new("RGBA", size)
    pixels = image.load()
    stops = [(232, 93, 74), (249, 177, 138), (233, 139, 88)]
    for y in range(height):
        for x in range(width):
            amount = (x / max(1, width - 1) + y / max(1, height - 1)) / 2
            if amount < 0.55:
                start, end, local = stops[0], stops[1], amount / 0.55
            else:
                start, end, local = stops[1], stops[2], (amount - 0.55) / 0.45
            pixels[x, y] = tuple(round(a + (b - a) * local) for a, b in zip(start, end)) + (255,)
    return image


def mark(size: int = SIZE) -> Image.Image:
    scale = size / SIZE
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ring_mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(ring_mask)
    draw.ellipse((172 * scale, 172 * scale, 852 * scale, 852 * scale), outline=255, width=80 * size // SIZE)
    layer.alpha_composite(Image.composite(gradient((size, size)), Image.new("RGBA", (size, size)), ring_mask))
    draw = ImageDraw.Draw(layer)
    draw.polygon([(408 * scale, 354 * scale), (408 * scale, 670 * scale), (672 * scale, 512 * scale)], fill="#2B211D")
    for x, y in [(276, 328), (748, 328), (276, 696), (748, 696)]:
        radius = 32 * scale
        draw.ellipse(((x - 32) * scale, (y - 32) * scale, (x + 32) * scale, (y + 32) * scale), fill="#FBF8F4")
    return layer


icon = Image.new("RGBA", (SIZE, SIZE), "#FBF8F4")
icon.alpha_composite(mark())
icon.convert("RGB").save(ASSETS / "icon.png", optimize=True)

foreground = mark()
foreground.save(ASSETS / "adaptive-icon.png", optimize=True)

mark(512).save(ASSETS / "splash.png", optimize=True)

graphic = Image.new("RGB", (1024, 500), "#FBF8F4")
glow = gradient((1024, 500))
glow_mask = Image.new("L", graphic.size, 0)
ImageDraw.Draw(glow_mask).ellipse((-180, -280, 560, 500), fill=100)
graphic = Image.composite(glow.convert("RGB"), graphic, glow_mask)
graphic_rgba = graphic.convert("RGBA")
large_mark = mark(330)
graphic_rgba.alpha_composite(large_mark, (70, 85))
draw = ImageDraw.Draw(graphic_rgba)
font_candidates = [
    ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf"),
    ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
]
font_pair = next((pair for pair in font_candidates if Path(pair[0]).exists() and Path(pair[1]).exists()), None)
if font_pair is None:
    raise RuntimeError("Install Arial or DejaVu Sans fonts to render the Play feature graphic")
font_title = ImageFont.truetype(font_pair[0], 72)
font_tagline = ImageFont.truetype(font_pair[1], 36)
draw.text((440, 170), "REELINDO", font=font_title, fill="#2B211D")
draw.text((445, 270), "Watch. Create. Vibe.", font=font_tagline, fill="#766B64")
graphic_rgba.convert("RGB").save(ASSETS / "play-feature-graphic.png", optimize=True)
