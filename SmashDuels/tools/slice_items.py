#!/usr/bin/env python3
"""Slice the generated item sheets into per-item sprites.

    python3 tools/slice_items.py                    # build game/assets/items/
    python3 tools/slice_items.py --report           # measure what came out
    python3 tools/slice_items.py --preview /tmp/items.png

The art lives in `assets-src/items/` as grids of cells painted on a flat magenta
field, one cell per item (`items-a` and `items-b` hold twelve each, `items-c` is a
single replacement cell — a later sheet simply overrides an earlier one, which is how
a retake is shipped without touching the others).  Nothing here needs numpy.

The background is removed by a flood from the cell border, not by a colour threshold:
a threshold punches holes in the pink and purple items (bunny hood, poison mushroom,
rift orb) or, set loose enough to spare them, eats the item's own outline.  Each sprite
is then cropped to its ink, scaled so the long side matches the size the item is drawn
at, and written at 2x into `game/assets/items/<key>.png` beside an `items.json`
manifest the renderer reads.

The 2x is deliberate: the game draws a sprite at its manifest size, so a 1x panel
downsamples and a 2x one gets real pixels, instead of the browser upscaling a 1x
bitmap and blurring it.  Placement is not this file's business — see `Item.draw` in
`game/js/items.js`, which anchors a resting item's sprite on the deck line rather than
at the centre of its 30x30 collision box.
"""
import argparse
import json
import os
import sys
from collections import deque
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# grid position of every item, sheet by sheet, later sheets winning
SHEETS = [
    ('items-a.png', [
        ['beamsword', 'homerunbat', 'starrod', 'bobomb'],
        ['shell', 'bumper', 'raygun', 'fireflower'],
        ['heart', 'tomato', 'food', 'hammer'],
    ]),
    ('items-b.png', [
        ['star', 'mushroom', 'poison', 'metalbox'],
        ['bunnyhood', 'crate', 'capsule', 'riftorb'],
        ['assist', 'smashball', None, None],
    ]),
    ('items-c.png', [            # the Smash Ball retake: gold with a star band
        ['smashball'],           # 1x1 grid: the whole image is the cell
    ]),
]

# Long side of the sprite as the game draws it, in px.  The collision box is a flat
# 30x30 for every item (items.js), so this is presentation only — but it is the
# number that decides whether an item reads on screen, so weapons and crates are
# allowed to be bigger than a tomato.
LONG = {
    'beamsword': 58, 'homerunbat': 56, 'starrod': 50, 'hammer': 52,
    'raygun': 46, 'fireflower': 46, 'bobomb': 42, 'shell': 44, 'bumper': 44,
    'heart': 40, 'tomato': 38, 'food': 42, 'star': 46, 'mushroom': 44,
    'poison': 44, 'metalbox': 46, 'bunnyhood': 44, 'crate': 46, 'capsule': 40,
    'riftorb': 44, 'assist': 48, 'smashball': 44,
}

# held items the renderer mirrors with the holder's facing, because the art points the
# useful way already; the rest (orbs, shells, food) are symmetric enough to spin freely
MIRROR_WHEN_HELD = {'beamsword', 'homerunbat', 'starrod', 'hammer', 'raygun', 'bobomb',
                    'food', 'tomato', 'heart', 'star', 'crate', 'capsule', 'metalbox'}


def key_out(px, w, h):
    """Return a keep-mask (255 = ship this pixel) for one cell of a generated sheet."""
    # What counts as field: a magenta-direction pixel — red and blue well above green.
    # A distance test against the sampled border colour is not enough, because these
    # sheets carry a brightness gradient and faint cell lines, and a threshold tight
    # enough to spare a dark navy outline cannot cross them.  Connectivity does the
    # real work: the flood arrives from the cell border, and an item's outline ring
    # keeps it out of the interior.
    def near_bg(x, y):
        r, g, b = px[x, y][:3]
        return r > 60 and b > 60 and r > g + 24 and b > g + 24

    field = bytearray(w * h)                    # 1 = background the border can reach
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near_bg(x, y) and not field[y * w + x]:
                field[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if near_bg(x, y) and not field[y * w + x]:
                field[y * w + x] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h:
                j = ny * w + nx
                if not field[j] and near_bg(nx, ny):
                    field[j] = 1
                    q.append((nx, ny))

    # ink = whatever the field could not reach; each object is flooded whole so that
    # an enclosed pocket of background (the gap under the bunny hood, between the
    # trophy's handles) stays transparent instead of shipping as a magenta blob
    MIN_SPECK = 48                              # a stray pixel of near-field colour
    keep = bytearray(w * h)
    for y0 in range(h):
        for x0 in range(w):
            i = y0 * w + x0
            if field[i] or keep[i] or near_bg(x0, y0):
                continue
            comp = [i]
            keep[i] = 255
            q.append((x0, y0))
            while q:
                x, y = q.popleft()
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if not (0 <= nx < w and 0 <= ny < h):
                        continue
                    j = ny * w + nx
                    # walk the object, not the field: an enclosed pocket of magenta
                    # stays out of `comp`, so it ships transparent rather than pink
                    if field[j] or keep[j] or near_bg(nx, ny):
                        continue
                    keep[j] = 255
                    comp.append(j)
                    q.append((nx, ny))
            if len(comp) < MIN_SPECK:
                for j in comp:
                    keep[j] = 0
    # shave the outer ring so the last row of field colour never ships as a halo
    outp = bytearray(keep)
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            i = y * w + x
            if not keep[i]:
                continue
            if keep[i - 1] == 0 or keep[i + 1] == 0 or keep[i - w] == 0 or keep[i + w] == 0:
                outp[i] = 0
    return outp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=os.path.join(ROOT, 'assets-src', 'items'))
    ap.add_argument('--out', default=os.path.join(ROOT, 'game', 'assets', 'items'))
    ap.add_argument('--report', action='store_true')
    ap.add_argument('--preview', default=None)
    args = ap.parse_args()

    man, rows, prev = {}, [], []
    for fname, grid in SHEETS:
        path = os.path.join(args.src, fname)
        if not os.path.exists(path):
            print('  (no %s — skipping)' % fname)
            continue
        im = Image.open(path).convert('RGB')
        cols_n = max(len(r) for r in grid)
        rows_n = len(grid)
        cw, ch = im.size[0] // cols_n, im.size[1] // rows_n
        for r, row in enumerate(grid):
            for c, key in enumerate(row):
                if not key:
                    continue
                cell = im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
                w, h = cell.size
                mask = key_out(cell.load(), w, h)
                rgba = cell.convert('RGBA')
                outp = rgba.load()
                for y in range(h):
                    for x in range(w):
                        if not mask[y * w + x]:
                            outp[x, y] = (0, 0, 0, 0)
                bbox = rgba.split()[3].getbbox()
                if not bbox:
                    sys.exit('%s: no ink left after keying the background' % key)
                ink = rgba.crop(bbox)
                long_side = LONG.get(key, 44)
                scale = long_side / float(max(ink.size))
                dw = max(8, int(round(ink.size[0] * scale)))
                dh = max(8, int(round(ink.size[1] * scale)))
                big = ink.resize((dw * 2, dh * 2), Image.Resampling.LANCZOS)
                canvas = Image.new('RGBA', (dw * 2, dh * 2), (0, 0, 0, 0))
                canvas.paste(big, (0, 0), big)
                if not args.report:
                    os.makedirs(args.out, exist_ok=True)
                    canvas.save(os.path.join(args.out, key + '.png'))
                man[key] = {'w': dw, 'h': dh, 'file': key + '.png',
                            'mirror': key in MIRROR_WHEN_HELD}
                rows.append((key, dw, dh, bbox[2] - bbox[0], bbox[3] - bbox[1]))
                prev.append((key, canvas.resize((dw, dh), Image.Resampling.LANCZOS)))

    if not args.report:
        with open(os.path.join(args.out, 'items.json'), 'w') as f:
            json.dump({'items': man, 'scale': 2}, f, indent=1, sort_keys=True)

    print('%d items -> %s' % (len(man), os.path.relpath(args.out, ROOT)))
    for k, dw, dh, sw, sh in sorted(rows, key=lambda t: -t[1]):
        print('  %-11s draw %3dx%-3d  source ink %4dx%-4d' % (k, dw, dh, sw, sh))
    missing = sorted(set(LONG) - set(man))
    if missing:
        print('  !! no art for: ' + ', '.join(missing))
    if args.preview and prev:
        pad = 8
        wide = sum(p[1].width for p in prev) + pad * (len(prev) + 1)
        tall = max(p[1].height for p in prev) + pad * 2
        sheet = Image.new('RGBA', (wide, tall), (46, 34, 66, 255))
        x = pad
        for key, s in prev:
            sheet.paste(s, (x, pad), s)
            x += s.width + pad
        sheet.convert('RGB').save(args.preview)
        print('  preview -> ' + args.preview)
    return 0


if __name__ == '__main__':
    sys.exit(main())
