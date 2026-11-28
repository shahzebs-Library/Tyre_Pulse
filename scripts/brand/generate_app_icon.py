"""Tyre Pulse app icon (owner choice 2026-11-28: icon "B" = TP mark + TYRE PULSE).

One source, every platform, so the phone, the store and the website match:
  * the TP mark and the TYRE PULSE lettering are cropped from
    store-assets/splash_2048.png (the approved brand splash), never redrawn;
  * launcher / home-screen sizes (>= 72 px) get mark + name;
  * tiny sizes (browser tab, iOS Settings / Spotlight / notifications, < 72 px)
    get the mark alone, because lettering is unreadable there;
  * Android adaptive foreground keeps everything inside the 66 dp safe circle.

Run:  python3 scripts/brand/generate_app_icon.py   (needs Pillow)
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SPLASH = ROOT / 'store-assets' / 'splash_2048.png'
BG = (22, 22, 22)
WORD_BOX = (524, 1129, 1522, 1293)   # TYRE PULSE lettering in the splash
MARK_BOX = (798, 610, 1250, 1026)    # TP mark in the splash
SMALL_LIMIT = 72                     # below this, mark only

src = Image.open(SPLASH).convert('RGB')


def _cut(box):
    """Crop and turn the flat background into transparency (keeps soft edges)."""
    im = src.crop(box).convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, _ = px[x, y]
            d = max(abs(r - BG[0]), abs(g - BG[1]), abs(b - BG[2]))
            px[x, y] = (r, g, b, min(255, d * 3))
    return im


MARK = _cut(MARK_BOX)
WORD = _cut(WORD_BOX)


def _fit(im, width):
    return im.resize((round(width), round(im.height * width / im.width)), Image.LANCZOS)


def artwork(n, *, with_name, content_width):
    """Transparent n x n layer with the mark (and name) centred."""
    layer = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    if not with_name:
        m = _fit(MARK, n * content_width)
        layer.alpha_composite(m, ((n - m.width) // 2, (n - m.height) // 2))
        return layer
    w = _fit(WORD, n * content_width)
    m = _fit(MARK, w.width * 0.62)
    gap = round(n * 0.065)
    top = (n - (m.height + gap + w.height)) // 2
    layer.alpha_composite(m, ((n - m.width) // 2, top))
    layer.alpha_composite(w, ((n - w.width) // 2, top + m.height + gap))
    return layer


def full_icon(n):
    small = n < SMALL_LIMIT
    base = Image.new('RGBA', (n, n), BG + (255,))
    art = artwork(1024, with_name=not small, content_width=0.62 if small else 0.74)
    base.alpha_composite(art.resize((n, n), Image.LANCZOS))
    return base.convert('RGB')


def save(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)


# ---- iOS ----------------------------------------------------------------
ios = ROOT / 'tyre_pulse_flutter/ios/Runner/Assets.xcassets/AppIcon.appiconset'
for name, px in {
    'Icon-App-20x20@1x.png': 20, 'Icon-App-20x20@2x.png': 40, 'Icon-App-20x20@3x.png': 60,
    'Icon-App-29x29@1x.png': 29, 'Icon-App-29x29@2x.png': 58, 'Icon-App-29x29@3x.png': 87,
    'Icon-App-40x40@1x.png': 40, 'Icon-App-40x40@2x.png': 80, 'Icon-App-40x40@3x.png': 120,
    'Icon-App-60x60@2x.png': 120, 'Icon-App-60x60@3x.png': 180,
    'Icon-App-76x76@1x.png': 76, 'Icon-App-76x76@2x.png': 152,
    'Icon-App-83.5x83.5@2x.png': 167, 'Icon-App-1024x1024@1x.png': 1024,
}.items():
    # Settings / Spotlight / notifications (20, 29, 40 pt) stay mark-only.
    pt = float(name.split('-')[2].split('x')[0])
    img = full_icon(px)
    if pt < 60:
        base = Image.new('RGBA', (px, px), BG + (255,))
        base.alpha_composite(artwork(1024, with_name=False, content_width=0.62).resize((px, px), Image.LANCZOS))
        img = base.convert('RGB')
    save(img, ios / name)

# ---- Android ------------------------------------------------------------
res = ROOT / 'tyre_pulse_flutter/android/app/src/main/res'
for d, (legacy, adaptive) in {
    'mdpi': (48, 108), 'hdpi': (72, 162), 'xhdpi': (96, 216),
    'xxhdpi': (144, 324), 'xxxhdpi': (192, 432),
}.items():
    # Legacy icon: rendered big then reduced, so the name stays crisp.
    save(full_icon(legacy) if legacy < SMALL_LIMIT else full_icon(1024).resize((legacy, legacy), Image.LANCZOS), res / f'mipmap-{d}' / 'ic_launcher.png')
    # Adaptive foreground: content inside the 66/108 safe circle.
    fg = artwork(1024, with_name=True, content_width=0.44).resize((adaptive, adaptive), Image.LANCZOS)
    save(fg, res / f'mipmap-{d}' / 'ic_launcher_foreground.png')
    mono = fg.copy()
    a = mono.getchannel('A')
    mono = Image.new('RGBA', mono.size, (255, 255, 255, 0))
    mono.putalpha(a)
    save(mono, res / f'mipmap-{d}' / 'ic_launcher_monochrome.png')

# ---- Stores ---------------------------------------------------------------
save(full_icon(1024).resize((512, 512), Image.LANCZOS), ROOT / 'store-assets/play_store_icon_512.png')
save(full_icon(1024), ROOT / 'store-assets/app_store/app_icon_1024.png')

# ---- Web / PWA (installed app icons get the name, browser tabs do not) -----
web = ROOT / 'public/icons'
for px in (72, 96, 128, 144, 152, 192, 384, 512):
    save(full_icon(1024).resize((px, px), Image.LANCZOS), web / f'icon-{px}x{px}.png')
save(full_icon(1024).resize((152, 152), Image.LANCZOS), web / 'apple-touch-icon-152x152.png')
save(full_icon(1024).resize((180, 180), Image.LANCZOS), ROOT / 'public/apple-touch-icon.png')
for px in (192, 512):
    m = Image.new('RGBA', (px, px), BG + (255,))
    m.alpha_composite(artwork(1024, with_name=True, content_width=0.48).resize((px, px), Image.LANCZOS))
    save(m.convert('RGB'), web / f'icon-{px}x{px}-maskable.png')
print('app icon B written for iOS, Android, stores and web')
