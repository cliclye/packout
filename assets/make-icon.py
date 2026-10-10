"""Generates assets/icon.png (1024²) from the Packout mark. Run: python3 assets/make-icon.py"""
import math, sys
from PIL import Image, ImageDraw, ImageFilter

S = 2048                       # supersampled canvas, downscaled to 1024
PAD = int(S * 0.098)           # macOS icon grid margin
R = int((S - 2 * PAD) * 0.2237)  # squircle-ish corner radius
BOX = (PAD, PAD, S - PAD, S - PAD)

def lerp(a, b, t): return int(a + (b - a) * t)
c0, c1 = (112, 134, 255), (52, 74, 226)   # top-left -> bottom-right

# diagonal gradient
grad = Image.new('RGB', (S, S))
px = grad.load()
for y in range(S):
    for x in range(S):
        t = (x + y) / (2 * (S - 1))
        px[x, y] = (lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t))

mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle(BOX, R, fill=255)

icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
icon.paste(grad, (0, 0), mask)

# soft top sheen: vertical alpha ramp, clipped to the icon shape
ramp = Image.new('L', (1, S))
rp = ramp.load()
for y in range(S):
    t = max(0.0, 1 - (y - PAD) / (S * 0.55))
    rp[0, y] = int(58 * t * t)
ramp = ramp.resize((S, S))
sheen = Image.new('RGBA', (S, S), (255, 255, 255, 0))
sheen.putalpha(Image.composite(ramp, Image.new('L', (S, S), 0), mask))
icon = Image.alpha_composite(icon, sheen)

# the "P" mark, same geometry as the in-app logo (32-unit grid)
inner = S - 2 * PAD
k = inner / 32.0
def P(x, y): return (PAD + x * k, PAD + y * k)
pts = [P(9, 22), P(9, 10), P(15.2, 10)]
# arc: centre (15.2, 14), r=4, from top (-90°) around the right to bottom (90°)
for i in range(0, 41):
    a = math.radians(-90 + 180 * i / 40)
    pts.append(P(15.2 + 4 * math.cos(a), 14 + 4 * math.sin(a)))
pts.append(P(9, 18))

mark = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(mark)
w = int(2.6 * k)
# stamp a round brush along a densely sampled path (no join artifacts)
dense = []
for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
    n = max(2, int(math.hypot(x1 - x0, y1 - y0) / 3))
    for i in range(n + 1):
        t = i / n
        dense.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
for x, y in dense:
    d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=(255, 255, 255, 255))
cx, cy = P(22.5, 21.5)
r = 2.0 * k
d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 225))

# drop shadow under the mark for depth
sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
sh.paste((20, 30, 120, 120), (0, int(k * 0.5)), mark.split()[3])
sh = sh.filter(ImageFilter.GaussianBlur(int(k * 0.7)))
icon = Image.alpha_composite(icon, sh)
icon = Image.alpha_composite(icon, mark)

out = icon.resize((1024, 1024), Image.LANCZOS)
out.save('assets/icon.png')
print('wrote assets/icon.png')
