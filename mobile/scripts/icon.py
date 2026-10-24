# The app's icon: Claude's spark in its orange, with the remote's two arrows small at the bottom
# left; drawn on a 512 canvas, the adaptive icon's safe circle radius 156 around the middle.
#   python3 mobile/scripts/icon.py   (writes mobile/assets/*.png through rsvg-convert)
import math, os, subprocess
ORANGE, DARK, WHITE = '#d97757', '#1a1a18', '#ffffff'
LENGTHS = [124, 92, 116, 100, 76, 88, 120, 100, 126, 94, 112, 106]  # the 5th, toward the arrows, short

def spark(cx, cy, scale, color):
    out = []
    for i, r in enumerate(LENGTHS):
        a = math.radians(i * 30 + 23)
        x, y = cx + math.cos(a) * r * scale, cy + math.sin(a) * r * scale
        out.append(f'<line x1="{cx}" y1="{cy}" x2="{x:.1f}" y2="{y:.1f}" stroke="{color}" stroke-width="{23*scale:.1f}" stroke-linecap="round"/>')
    return ''.join(out)

def arrows(bx, by, s, color, width=9):
    w = width * s
    return (f'<g fill="none" stroke="{color}" stroke-width="{w:.1f}" stroke-linecap="round" stroke-linejoin="round">'
            f'<path d="M{bx-22*s:.1f} {by-11*s:.1f}H{bx+22*s:.1f}M{bx+11*s:.1f} {by-22*s:.1f}L{bx+22*s:.1f} {by-11*s:.1f}L{bx+11*s:.1f} {by}"/>'
            f'<path d="M{bx+22*s:.1f} {by+11*s:.1f}H{bx-22*s:.1f}M{bx-11*s:.1f} {by}L{bx-22*s:.1f} {by+11*s:.1f}L{bx-11*s:.1f} {by+22*s:.1f}"/></g>')

# The arrows on the icon itself, no disc and no cut: the spark a little up and right, the arrows
# in the open corner at the bottom left; both inside the adaptive icon's safe circle
SPARK, SHIFT, SIZE = 0.82, 28, 1.35

def art(cx=256, cy=256, s=1.0, bg=None, mono=False):
    body = ''
    if bg: body += f'<rect width="{2*cx}" height="{2*cy}" fill="{bg}"/>'
    body += spark(cx + SHIFT * s, cy - SHIFT * s, s * SPARK, WHITE if mono else ORANGE)
    body += arrows(cx - 78 * s, cy + 78 * s, s * SIZE, WHITE)
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{2*cx}" height="{2*cy}" viewBox="0 0 {2*cx} {2*cy}">{body}</svg>'

BACKGROUND = f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="{DARK}"/></svg>'
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
for name, svg, size in [
    ('android-icon-foreground', art(), 512),
    ('android-icon-background', BACKGROUND, 512),
    ('android-icon-monochrome', art(mono=True), 432),
    ('icon', art(512, 512, 2.6, bg=DARK), 1024),
    ('splash-icon', art(512, 512, 2.2), 1024),
    ('favicon', art(512, 512, 2.6, bg=DARK), 48),
]:
    subprocess.run(['rsvg-convert', '-w', str(size), '-h', str(size), '-o', os.path.join(ASSETS, f'{name}.png')], input=svg.encode(), check=True)
