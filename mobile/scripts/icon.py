# The app's icon, drawn here (not Anthropic's file): an abstract computer screen on Claude's
# orange, a white rounded rectangle with a white line under it for its stand, and in the screen a
# small orange spark of twelve uneven rays, each ending in cut corners. Drawn on a 512 canvas,
# inside the adaptive icon's safe circle (radius 156 round the middle).
#   python3 mobile/scripts/icon.py   (writes mobile/assets/*.png through rsvg-convert)
import math, os, subprocess

ORANGE, ORANGE_LOW, CREAM, WHITE = '#dd7a58', '#d06a49', '#fbf5ef', '#ffffff'
# each ray: its angle (degrees, 0 to the right, clockwise), its length and its width at the tip
RAYS = [
    (-112, 132, 30), (-80, 118, 24), (-52, 134, 30), (-18, 116, 24), (8, 140, 26), (32, 120, 24),
    (62, 112, 22), (88, 132, 26), (112, 122, 24), (138, 126, 22), (162, 112, 24), (190, 136, 28),
]

def ray(cx, cy, s, angle, length, tip):
    a = math.radians(angle)
    ux, uy = math.cos(a), math.sin(a)   # along the ray
    px, py = -uy, ux                    # across it
    base, cut = 10 * s, tip * 0.32 * s
    L, w = length * s, tip * s / 2
    pts = [
        (0, -base), (L - cut, -w), (L, -w + cut), (L, w - cut), (L - cut, w), (0, base),
    ]
    return ' '.join(f'{cx + ux * t + px * d:.1f},{cy + uy * t + py * d:.1f}' for t, d in pts)

def spark(cx, cy, s, color):
    rays = ''.join(f'<polygon points="{ray(cx, cy, s, *r)}" fill="{color}" stroke="{color}" stroke-width="{3*s:.1f}" stroke-linejoin="round"/>' for r in RAYS)
    return rays + f'<circle cx="{cx}" cy="{cy}" r="{24*s:.1f}" fill="{color}"/>'

def ground(w, h):
    return (f'<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{ORANGE}"/>'
            f'<stop offset="1" stop-color="{ORANGE_LOW}"/></linearGradient></defs><rect width="{w}" height="{h}" fill="url(#g)"/>')

# the screen (its width, height and corner radius), the gap to the stand and the stand's length,
# and the spark's size inside, all in the 512 canvas's units
SCREEN_W, SCREEN_H, CORNER, STAND_GAP, STAND_W, STROKE, SPARK = 236, 158, 26, 30, 116, 18, 0.36

def art(cx=256, cy=256, s=1.0, bg=False, mono=False):
    w, h = SCREEN_W * s, SCREEN_H * s
    top = cy - (SCREEN_H + STAND_GAP) * s / 2
    x0, y0 = cx - w / 2, top
    sy = top + h + STAND_GAP * s
    body = ground(2 * cx, 2 * cy) if bg else ''
    screen = f'<rect x="{x0:.1f}" y="{y0:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{CORNER*s:.1f}"'
    if mono:
        # alpha only: the screen white with the spark cut out of it
        body += f'<mask id="m">{screen} fill="#fff"/>{spark(cx, y0 + h / 2, s * SPARK, "#000")}</mask>{screen} fill="{WHITE}" mask="url(#m)"/>'
    else:
        body += f'{screen} fill="{WHITE}"/>' + spark(cx, y0 + h / 2, s * SPARK, ORANGE_LOW)
    body += f'<line x1="{cx - STAND_W * s / 2:.1f}" y1="{sy:.1f}" x2="{cx + STAND_W * s / 2:.1f}" y2="{sy:.1f}" stroke="{WHITE}" stroke-width="{STROKE*s:.1f}" stroke-linecap="round"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{2*cx}" height="{2*cy}" viewBox="0 0 {2*cx} {2*cy}">{body}</svg>'

BACKGROUND = f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">{ground(512, 512)}</svg>'
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
if __name__ == '__main__':
    for name, svg, size in [
        ('android-icon-foreground', art(), 512),
        ('android-icon-background', BACKGROUND, 512),
        ('android-icon-monochrome', art(mono=True), 432),
        ('icon', art(512, 512, 2.3, bg=True), 1024),
        ('splash-icon', art(512, 512, 2.0), 1024),  # on the splash's own orange
        ('favicon', art(512, 512, 2.3, bg=True), 48),
    ]:
        subprocess.run(['rsvg-convert', '-w', str(size), '-h', str(size), '-o', os.path.join(ASSETS, f'{name}.png')], input=svg.encode(), check=True)
