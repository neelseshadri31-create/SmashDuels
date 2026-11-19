#!/usr/bin/env python3
"""tools/film_render.py — turn anim-films/<key>.film.json into something to look at.

tools/film.js records, for every tick, the exact drawImage list the shipped
renderer asked for plus the hitboxes the resolver says are live and the hurtbox it
tests them against.  This rasterises that: the real atlas PNG is warped through the
recorded matrix (nearest, because it is pixel art), so a cell shows what the game
would paint — same tile, same feet anchor, same squash, same mirror — with the
collision boxes over the top.  A scrolling world grid sits under the feet so
stride sync (or skating) is visible in a still.

  python3 tools/film_render.py                       every spec in anim-films/
  python3 tools/film_render.py valor                   one fighter
  python3 tools/film_render.py valor --rows fsmash,jab  just those rows
  python3 tools/film_render.py --cell 118x104 --cols 13

Writes <key>.film.png (every row) and <key>.film.gif (the curated rows, animated at
60 fps), and prints a one-line summary per row.  Pillow only, no numpy.
"""
import json
import os
import sys
from PIL import Image, ImageChops, ImageDraw

NEAREST = getattr(Image, 'Resampling', Image).NEAREST   # Pillow >= 9.1

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # project dir
GAME = ROOT
OUT = os.path.join(ROOT, 'anim-films')
BG = (16, 18, 26)
GROUND = (58, 66, 92)
GRID = (30, 34, 48)
FRAME_LINE = (40, 46, 66)
HIT = (255, 74, 74)
HURT = (78, 214, 255)
LABEL = (150, 205, 255)
CAPTION = (120, 130, 150)
GUTTER = 132
GIF_ROWS = ['idle', 'walk', 'run', 'pivot', 'dash', 'jab', 'ftilt', 'fsmash', 'dtilt',
            'nair', 'dair', 'hurt', 'launch', 'crouch']


def parse_args():
    """--cell WxH, --cols N, --rows a,b,c and bare fighter names."""
    cell, cols, words, rows = (118, 104), 13, [], None
    a = sys.argv[1:]
    i = 0
    while i < len(a):
        if a[i] == '--cell' and i + 1 < len(a):
            w, h = a[i + 1].lower().split('x')
            cell, i = (int(w), int(h)), i + 2
        elif a[i] == '--cols' and i + 1 < len(a):
            cols, i = int(a[i + 1]), i + 2
        elif a[i] == '--rows' and i + 1 < len(a):
            rows, i = [r for r in a[i + 1].split(',') if r], i + 2
        else:
            words.append(a[i])
            i += 1
    return cell, cols, words, rows


def blit(dst, atlas, op, ox, oy):
    """Paste one recorded drawImage into the cell through the matrix it was drawn with."""
    a, b, c, d, e, f = op['m']
    det = a * d - b * c
    sw, sh, dw, dh = op['sw'], op['sh'], op['dw'], op['dh']
    if abs(det) < 1e-9 or not (sw and sh and dw and dh):
        return
    # source pixel (u,v) -> local (dx + u*dw/sw, dy + v*dh/sh) -> matrix -> + cell offset
    # PIL wants the inverse mapping, so build it here rather than transforming twice
    ex, ey = ox + e, oy + f
    kx, ky = sw / dw, sh / dh
    aa, ab = kx * d / det, -kx * c / det
    ac = kx * (-(d * ex - c * ey) / det - op['dx']) + op['sx']
    dd, de = -ky * b / det, ky * a / det
    df = ky * ((b * ex - a * ey) / det - op['dy']) + op['sy']
    layer = atlas.transform(dst.size, Image.AFFINE, (aa, ab, ac, dd, de, df), resample=NEAREST)
    al = max(0.0, min(1.0, op.get('a', 1)))
    if al < 1.0:
        r, g, bch, a2 = layer.split()
        layer = Image.merge('RGBA', (r, g, bch, a2.point(lambda v: int(v * al))))
    if op.get('gco') == 'lighter':
        lit = ImageChops.add(dst, Image.composite(layer.convert('RGB'), Image.new('RGB', dst.size, (0, 0, 0)), layer.split()[3]))
        dst.paste(lit, (0, 0))
    else:
        dst.paste(layer, (0, 0), layer)


def render_cell(atlas, fr, cell, ground_pad):
    """One tick: the world grid, the ground line, the sprite, the boxes."""
    w, h = cell
    img = Image.new('RGB', (w, h), BG)
    d = ImageDraw.Draw(img)
    gy = h - ground_pad
    ox, oy = w / 2 - fr['x'], gy - fr['y']
    step = 32
    px = ((-ox) // step) * step + ox
    while px < w + step:
        d.line([(px, 0), (px, gy)], fill=GRID)
        px += step
    d.rectangle([0, gy, w, h], fill=GROUND)
    d.line([(0, gy), (w, gy)], fill=(120, 140, 190))
    for op in fr['ops']:
        blit(img, atlas, op, ox, oy)
    d = ImageDraw.Draw(img)
    hb = fr.get('hurt')
    if hb:
        d.rectangle([w / 2 + hb[0], gy + hb[1], w / 2 + hb[0] + hb[2], gy + hb[1] + hb[3]], outline=HURT)
    for b in fr.get('hit') or []:
        d.rectangle([w / 2 + b['x'] - fr['x'], gy + b['y'] - fr['y'],
                     w / 2 + b['x'] - fr['x'] + b['w'], gy + b['y'] - fr['y'] + b['h']],
                    outline=HIT, width=2)
    return img


def summarise(sc):
    fr = sc['frames']
    anims = [f['anim'] for f in fr if f['anim']]
    hits = [f for f in fr if f['hit']]
    blank = sum(1 for f in fr if not f['drew'])
    b = hits[0]['hit'][0] if hits else None
    parts = ['%2df' % len(fr), '%d frame%s' % (len(set(anims)), '' if len(set(anims)) == 1 else 's'),
             'hit on %d' % len(hits)]
    if b:
        parts.append('box %dx%d' % (round(b['w']), round(b['h'])))
    parts.append('%.0fpx travelled' % (abs(fr[-1]['x'] - fr[0]['x']) if len(fr) > 1 else 0))
    if blank:
        parts.append('%d BLANK' % blank)
    return ', '.join(parts)


def sheet(atlas, sc, cell, cols, gp):
    """A scene's ticks laid out left to right, wrapping into sub-rows."""
    cw, ch = cell
    frames = sc['frames']
    rows = max(1, (len(frames) + cols - 1) // cols)
    out = Image.new('RGB', (GUTTER + cols * (cw + 4), rows * (ch + 17)), BG)
    d = ImageDraw.Draw(out)
    d.text((6, 5), sc['name'], fill=LABEL)
    d.text((6, 22), summarise(sc)[:26], fill=CAPTION)
    d.text((6, 36), ('tick order →' if rows == 1 else 'rows wrap →'), fill=CAPTION)
    for i, fr in enumerate(frames):
        r, c = divmod(i, cols)
        x, y = GUTTER + c * (cw + 4), r * (ch + 17)
        out.paste(render_cell(atlas, fr, cell, gp), (x, y))
        d = ImageDraw.Draw(out)
        d.rectangle([x, y, x + cw - 1, y + ch - 1], outline=FRAME_LINE)
        tag = '%d %s' % (i, fr['anim'] or '-')
        if fr['hit']:
            tag += ' HIT'
        if fr['state'] not in ('idle', 'run', 'walk'):
            tag += ' ' + fr['state']
        d.text((x + 2, y + ch + 2), tag[:36], fill=(255, 200, 90) if fr['hit'] else CAPTION)
    return out


def film(atlas, scenes, cell, gp):
    """The same tick of each curated row, stacked: every row plays at 60 fps."""
    cw, ch = cell
    n = max((len(s['frames']) for s in scenes), default=0)
    frames = []
    for i in range(n):
        rows = []
        for sc in scenes:
            fr = sc['frames'][min(i, len(sc['frames']) - 1)]
            img = render_cell(atlas, fr, cell, gp)
            line = Image.new('RGB', (GUTTER + cw + 4, ch + 4), BG)
            line.paste(img, (GUTTER, 2))
            d = ImageDraw.Draw(line)
            d.text((4, ch / 2 - 6), '%s %d' % (sc['name'][:12], i), fill=LABEL)
            rows.append(line)
        strip = Image.new('RGB', (max(r.width for r in rows), sum(r.height for r in rows) + 2 * len(rows)), (8, 9, 14))
        y = 0
        for r in rows:
            strip.paste(r, (0, y))
            y += r.height + 2
        frames.append(strip)
    return frames


def main():
    cell, cols, words, rows = parse_args()
    keys = [w for w in words if not w.startswith('--')]
    if not os.path.isdir(OUT) or not [f for f in os.listdir(OUT) if f.endswith('.film.json')]:
        print('no specs in %s — run: node tools/film.js' % os.path.relpath(OUT, ROOT))
        return 1
    for fn in sorted(f for f in os.listdir(OUT) if f.endswith('.film.json')):
        spec = json.load(open(os.path.join(OUT, fn)))
        if keys and spec['key'] not in keys:
            continue
        scenes = [sc for sc in spec['scenes'] if not rows or sc['name'] in rows]
        if not scenes:
            print('%s: no row matched --rows=%s\n     available: %s'
                  % (spec['key'], ','.join(rows), ' '.join(sc['name'] for sc in spec['scenes'])))
            continue
        atlas = Image.open(os.path.join(ROOT, spec['atlas'])).convert('RGBA')
        gp = spec.get('groundPad', 20)
        print('\n== %s (atlas %dx%d, drawn height %.0f) =='
              % (spec['key'], spec['atlasSize'][0], spec['atlasSize'][1], spec.get('drawnH', 0)))
        sheets = []
        for sc in scenes:
            sheets.append(sheet(atlas, sc, cell, cols, gp))
            print('   %-13s %s' % (sc['name'], summarise(sc)))
        W = max(s0.width for s0 in sheets)
        H = sum(s0.height for s0 in sheets) + 6 * len(sheets)
        out = Image.new('RGB', (W, H), (8, 9, 14))
        y = 0
        for s0 in sheets:
            out.paste(s0, (0, y))
            y += s0.height + 6
        tag = '' if not rows else '-' + '_'.join(rows)[:40]
        png = os.path.join(OUT, '%s.film%s.png' % (spec['key'], tag))
        out.save(png, optimize=True)
        picked = [sc for sc in scenes if sc['name'] in GIF_ROWS] or scenes[:10]
        frames = film(atlas, picked, cell, gp)
        gif = os.path.join(OUT, '%s.film%s.gif' % (spec['key'], tag))
        frames[0].save(gif, save_all=True, append_images=frames[1:],
                       duration=int(1000 / 60), loop=0, optimize=True)
        print('   -> %s  %dx%d   and   %s  %d frames @60fps'
              % (os.path.relpath(png, ROOT), W, H, os.path.relpath(gif, ROOT), len(frames)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
