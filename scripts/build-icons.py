"""Render the simple rectangle SVG to web icons and matching Android vectors.
Requires Pillow (build-time only). Does not access signing material or user data.
"""
from pathlib import Path
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
svg = ET.parse(ROOT / 'public/app-icon.svg').getroot()
rectangles = []
for node in svg:
    if node.tag.rsplit('}', 1)[-1] != 'rect':
        raise ValueError('Only rounded rectangles are supported by this icon renderer')
    rectangles.append({k: float(node.get(k, '0')) for k in ['x', 'y', 'width', 'height', 'rx']} | {'fill': node.get('fill')})
background = rectangles[0]['fill']

def render(size, full_bleed=False):
    scale = size * 4 / 108
    image = Image.new('RGBA', (size * 4, size * 4), background if full_bleed else (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for index, r in enumerate(rectangles):
        if index == 0 and full_bleed:
            continue
        box = tuple(v * scale for v in [r['x'], r['y'], r['x'] + r['width'], r['y'] + r['height']])
        draw.rounded_rectangle(box, radius=r['rx'] * scale, fill=r['fill'])
    return image.resize((size, size), Image.Resampling.LANCZOS)

for size in [192, 512]:
    render(size).save(ROOT / f'public/app-icon-{size}.png')
render(512, True).save(ROOT / 'public/app-icon-maskable-512.png')

def path(r):
    x, y, w, h, a = (r[k] for k in ['x', 'y', 'width', 'height', 'rx'])
    return f'M{x+a:g},{y:g}H{x+w-a:g}A{a:g},{a:g} 0,0 1 {x+w:g},{y+a:g}V{y+h-a:g}A{a:g},{a:g} 0,0 1 {x+w-a:g},{y+h:g}H{x+a:g}A{a:g},{a:g} 0,0 1 {x:g},{y+h-a:g}V{y+a:g}A{a:g},{a:g} 0,0 1 {x+a:g},{y:g}Z'

def vector(rows, monochrome=False):
    header = '<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">\n'
    return header + ''.join(f'    <path android:fillColor="{("#FFFFFF" if monochrome else r["fill"])}" android:pathData="{path(r)}" />\n' for r in rows) + '</vector>\n'

resources = ROOT / 'android/app/src/main/res'
(resources / 'drawable/ic_launcher_foreground.xml').write_text(vector(rectangles[1:]))
(resources / 'drawable/ic_launcher_monochrome.xml').write_text(vector([rectangles[i] for i in [1, 2, 4]], True))
(resources / 'values/launcher_colors.xml').write_text(f'<resources><color name="launcher_background">{background}</color></resources>\n')
print('Rendered 192/512/maskable web icons and matching Android vectors')
