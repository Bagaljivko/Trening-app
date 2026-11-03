"""iPhone launch screens: plain app background, light and dark, one per iPhone screen size.

iOS shows these while the installed app opens (instead of a white flash). They're plain on
purpose, like a native app's launch screen. Run from the repo root: python3 tools/make_splash.py
It writes icons/splash/*.png and prints the <link> tags for index.html.
"""
import os
from PIL import Image

THEMES = {"light": (0xF5, 0xF5, 0xF7), "dark": (0, 0, 0)}
# (CSS width, CSS height, pixel ratio), portrait
SCREENS = [
    (320, 568, 2),   # SE (1st gen)
    (375, 667, 2),   # SE 2/3, 6-8
    (414, 736, 3),   # 6-8 Plus
    (375, 812, 3),   # X, XS, 11 Pro, 12/13 mini
    (414, 896, 2),   # XR, 11
    (414, 896, 3),   # XS Max, 11 Pro Max
    (390, 844, 3),   # 12, 13, 14, 16e
    (428, 926, 3),   # 12/13 Pro Max, 14 Plus
    (393, 852, 3),   # 14 Pro, 15, 15 Pro, 16
    (430, 932, 3),   # 14 Pro Max, 15 Plus/Pro Max, 16 Plus
    (402, 874, 3),   # 16 Pro, 17, 17 Pro
    (420, 912, 3),   # Air
    (440, 956, 3),   # 16 Pro Max, 17 Pro Max
]

os.makedirs("icons/splash", exist_ok=True)
tags = []
for theme, rgb in THEMES.items():
    for w, h, r in SCREENS:
        name = f"icons/splash/{theme}-{w * r}x{h * r}.png"
        Image.new("RGB", (w * r, h * r), rgb).save(name, optimize=True)
        tags.append(
            f'<link rel="apple-touch-startup-image" href="{name}" media="(device-width: {w}px) and '
            f'(device-height: {h}px) and (-webkit-device-pixel-ratio: {r}) and (orientation: portrait) '
            f'and (prefers-color-scheme: {theme})">'
        )
print("\n".join(tags))
