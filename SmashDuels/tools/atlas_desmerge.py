#!/usr/bin/env python3
"""tools/atlas_desmerge.py — split the atlas rows that came out as one long strip.

Some attack rows on the concept sheets are drawn as a single wide drawing: the
poses overlap and the crescent bridges them, so the slicer's ink-gap rules
recovered ONE frame of 165-260px instead of the two or three poses that are
actually in there.  Those rows are the worst animation in the game — every tick
paints the whole overlapping strip, two figures at once — and `Sprites.usable()`
rejects such a frame for measurement, so the move loses its art-derived hitbox and
falls back to its authored rectangle (the names animtest prints as
"fall back to authored").  Five fighters, thirteen frames, down-smashes and the
side specials mostly.

This re-cuts those frames out of the atlas PNG that already ships: no re-slicing,
no new PNG, no re-packing.  For every implausibly wide frame it walks the tile's
alpha column profile, finds the deep valleys between overlapping figures, and
replaces the one frame with one frame per cell, each tight-cropped to its own ink
so the engine's "a tile rect is the silhouette" assumption still holds.  The cells
keep the offsets they were drawn at, which is what the slicer does for a normal
row: the artist's step-into-the-blow stays in the animation.

Rows whose profile cannot be cut — a genuinely continuous drawing, like Grim's and
Astra's side-special beams — are left exactly as they are, and the engine keeps
using the authored boxes for them.

    python3 tools/atlas_desmerge.py --check     report, change nothing
    python3 tools/atlas_desmerge.py --verbose   …and say why a row was left alone
    python3 tools/atlas_desmerge.py             rewrite the atlas JSONs
    python3 tools/atlas_desmerge.py --dump DIR  write each cell to DIR as a PNG
    python3 tools/atlas_desmerge.py --revert    restore the pre-desmerge JSONs

Idempotent: a re-cut frame is one cell wide, so it passes the plausibility test
and is not touched again.  The original JSON is kept beside it as <key>.orig.json,
which is what --revert puts back.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
ATLAS_DIR = os.path.join(PROJ, 'game', 'assets', 'atlas')
KEYS = ['valor', 'grim', 'astra', 'vesper', 'rook']

MIN_CELL = 0.62     # a cell narrower than this fraction of a unit is not a pose
MIN_FIRST = 0.80    # … and the pose the move *starts* on has to be a whole figure,
                    # not the fragment left between two drawings (Grim's down-smash
                    # cuts to a 40x32 chip of rock in front of his two poses, which
                    # would read as a missing frame rather than a wind-up)
DEEP = 0.34         # a seam has to dip to this fraction of the strip's tallest column
MIN_SPAN = 0.60     # … and seams must stay this many units apart to be separate poses
INK = 8             # alpha above which a pixel counts as drawn


def usable(w, h, unit):
    """The engine's plausibility test (Sprites.usable), mirrored here by hand: a
    frame the engine rejects is a frame worth trying to cut."""
    return w <= 2.2 * max(h, 0.55 * unit) and w <= 2.4 * unit and h <= 2.6 * unit


def profile(img, x, y, w, h):
    """Per-column ink height, plus the ink bounding box of the rect, in rect-local
    coordinates.  Returns (prof, None) for an empty rect."""
    a = img.crop((x, y, x + w, y + h)).split()[3].load()
    prof = [0] * w
    x0, x1, y0, y1 = w, -1, h, -1
    for cx in range(w):
        top = bot = -1
        for cy in range(h):
            if a[cx, cy] > INK:
                if top < 0:
                    top = cy
                bot = cy
        if top >= 0:
            prof[cx] = bot - top + 1
            x0 = min(x0, cx)
            x1 = max(x1, cx)
            y0 = min(y0, top)
            y1 = max(y1, bot)
    if x1 < 0:
        return prof, None
    return prof, (x0, y0, x1 - x0 + 1, y1 - y0 + 1)


def cut_cells(prof, unit):
    """[(x0, w)] — the column ranges to treat as separate poses, or [] if the strip
    is one continuous drawing (or the cut would leave a fragment)."""
    w = len(prof)
    mx = max(prof) if prof else 0
    if mx <= 0 or w < 2.0 * unit:
        return []
    lo, hi = max(1, int(w * 0.16)), min(w - 1, int(w * 0.86))
    cands = [x for x in range(lo, hi)
             if prof[x] <= prof[x - 1] and prof[x] <= prof[x + 1] and prof[x] <= DEEP * mx]
    cands.sort(key=lambda x: prof[x])                 # deepest valleys first
    seams = []
    for x in cands:
        if all(abs(x - s) >= MIN_SPAN * unit for s in seams):
            seams.append(x)
    seams.sort()
    if not seams:
        return []
    iv = [[a, b] for a, b in zip([0] + seams, seams + [w])]
    # fold a fragment into its left neighbour until every cell could hold a pose
    changed = True
    while changed and len(iv) > 1:
        changed = False
        for i in range(len(iv) - 1, -1, -1):
            if iv[i][1] - iv[i][0] < MIN_CELL * unit:
                if i == 0:
                    iv[1][0] = 0
                    iv.pop(0)
                else:
                    iv[i - 1][1] = iv[i][1]
                    iv.pop(i)
                changed = True
                break
    if len(iv) < 2:
        return []
    return [(a, b - a) for a, b in iv]


def revert():
    n = 0
    for key in KEYS:
        orig = os.path.join(ATLAS_DIR, '%s.orig.json' % key)
        if os.path.isfile(orig):
            with open(orig) as fh:
                data = fh.read()
            with open(os.path.join(ATLAS_DIR, '%s.json' % key), 'w') as fh:
                fh.write(data)
            os.remove(orig)
            n += 1
    print('restored %d atlas JSONs from their .orig.json backups' % n)
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='report without writing')
    ap.add_argument('--revert', action='store_true', help='restore the pre-run JSONs')
    ap.add_argument('--keys', default=','.join(KEYS))
    ap.add_argument('--dump', default='', help='write every cut cell into DIR as a PNG')
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()
    if args.revert:
        return revert()

    done = 0
    for key in [k for k in args.keys.split(',') if k]:
        jp, pp = (os.path.join(ATLAS_DIR, key + ext) for ext in ('.json', '.png'))
        if not (os.path.isfile(jp) and os.path.isfile(pp)):
            print('%s: no atlas, skipped' % key)
            continue
        meta = json.load(open(jp))
        img = Image.open(pp).convert('RGBA')
        unit = max(24, meta.get('refH') or 64)
        base = len(meta['tiles'])
        tiles = list(meta['tiles'])
        anims = meta.get('anims') or {}
        rows = []
        for row in sorted(anims):
            frames = anims[row]
            merged = [fi for fi, ent in enumerate(frames)
                      if not usable(meta['tiles'][ent[0]]['w'], meta['tiles'][ent[0]]['h'], unit)]
            if not merged:
                continue
            out, cut = [], []
            for fi, ent in enumerate(frames):
                t = meta['tiles'][ent[0]]
                if fi not in merged:
                    out.append(list(ent))
                    continue
                prof, _ = profile(img, t['x'], t['y'], t['w'], t['h'])
                cells = cut_cells(prof, unit)
                if not cells:
                    if args.verbose:
                        print('  %-6s %-9s f%d %3dx%-3d  one continuous drawing' % (key, row, fi, t['w'], t['h']))
                    out.append(list(ent))
                    continue
                # Horizontal: crop each cell to its own ink.  Vertical: crop the
                # CELLS TOGETHER, to the union of their ink rows — the slicer's own
                # rule is that every frame of a grounded row shares one baseline
                # (`atlascheck` measures tile bottom vs anchor), and a per-cell
                # vertical crop would make the fighter bob a few px between the
                # wind-up and the sweep.
                boxes = []
                for cx0, cw in cells:
                    _, box = profile(img, t['x'] + cx0, t['y'], cw, t['h'])
                    boxes.append((cx0, cw, box))
                live = [b for b in boxes if b[2]]
                if len(live) < 2:
                    out.append(list(ent))
                    continue
                ytop = min(b[2][1] for b in live)
                ybot = max(b[2][1] + b[2][3] for b in live)
                parts = []
                for ci, (cx0, cw, box) in enumerate(boxes):
                    if not box:
                        continue
                    bx, by, bw, bh = box
                    rect = {'x': t['x'] + cx0 + bx, 'y': t['y'] + ytop,
                            'w': bw, 'h': ybot - ytop}
                    pad = [by - ytop, ybot - (by + bh)]
                    tid = len(tiles)
                    tiles.append(rect)
                    # the frame is drawn with its tile's top-left at (-ax, -ay), so a
                    # crop that drops dx/dy of ink has to push the tile back by the
                    # same amount: the pose stays planted exactly where the strip put
                    # it, which is how the artist's step into the blow survives
                    # ent[5] = the cell's own ink rows inside that band.  The tile
                    # (what gets drawn) keeps the shared band so every frame of the
                    # row stands on one baseline; the measurement (what the hitbox
                    # and hurtbox are derived from) reads the ink, so a crescent that
                    # sweeps below the feet is still recognisable as the strike
                    # frame.  Slot 4 is the slicer's `held` flag — not available.
                    # slot order is the atlas' own: [tile, ax, ay, layers, held, pad]
                    parts.append([tid, ent[1] - (cx0 + bx), ent[2] - ytop,
                                  list(ent[3]) if len(ent) > 3 and ent[3] else [],
                                  ent[4] if len(ent) > 4 else None,
                                  pad])
                    if args.dump:
                        os.makedirs(args.dump, exist_ok=True)
                        img.crop((rect['x'], rect['y'], rect['x'] + bw, rect['y'] + bh)).save(
                            '%s/%s__%s_f%d_c%d.png' % (args.dump, key, row, fi, ci))
                t0 = tiles[parts[0][0]]
                if len(parts) < 2 or t0['w'] < MIN_FIRST * unit:
                    if args.verbose and len(parts) >= 2:
                        print('  %-6s %-9s f%d  cut leaves a %dx%d fragment first: left alone'
                              % (key, row, fi, t0['w'], t0['h']))
                    out.append(list(ent))
                    continue
                out.extend(parts)
                cut.append((fi, t['w'], t['h'], [(tiles[p[0]]['w'], tiles[p[0]]['h']) for p in parts]))
            if not cut:
                continue
            before = len(frames)
            anims[row] = out
            rows.append((row, before, len(out), cut))
        for row, before, after, cut in rows:
            for fi, w0, h0, sizes in cut:
                print('  %-6s %-9s f%d  %3dx%-3d -> %d frames: %s'
                      % (key, row, fi, w0, h0, len(sizes), ' '.join('%dx%d' % s for s in sizes)))
        if not rows:
            print('  %s: nothing to cut' % key)
        done += len(rows)
        if rows and not args.check:
            meta['tiles'] = tiles
            meta['desmerged'] = sorted({r[0] for r in rows} | set(meta.get('desmerged') or []))
            with open(os.path.join(ATLAS_DIR, '%s.orig.json' % key), 'w') as fh:
                json.dump(json.load(open(jp)), fh, separators=(',', ':'))
            tmp = jp + '.tmp'
            with open(tmp, 'w') as fh:
                json.dump(meta, fh, separators=(',', ':'))
            os.replace(tmp, jp)
            print('  %s: %d rows re-cut, %d tiles added (now %d)'
                  % (key, len(rows), len(tiles) - base, len(tiles)))
        elif rows:
            print('  %s: %d rows would be re-cut, %d tiles added (--check: nothing written)'
                  % (key, len(rows), len(tiles) - base))
    print('\n%d rows re-cut' % done)
    print('then: node tools/atlascheck.js  and  node tools/animtest.js')
    return 0


if __name__ == '__main__':
    sys.exit(main())
