#!/usr/bin/env python3
"""tools/sheet_grid.py — re-flow a generated pose sheet onto an exact grid.

An image model asked for "row 1: 6 frames, row 2: 8" will hand back a sheet where row 1
carries eight figures and two of them belong to row 2, or where the bottom two rows are
staggered into one band.  The poses are fine; only the layout is wrong — and re-rolling the
sheet costs a generation *and* loses the character the first sheet had already locked in.
So fix the sheet instead of the model:

  1. key the flat magenta field out, find the row bands by their blank lines, and the
     figures inside each band by column runs;
  2. keep each row's figures in left-to-right order — that order is the animation's timing
     and is never reshuffled;
  3. resample to the row's wanted count: too many → evenly spaced, first and last always
     kept because those are the ends of the cycle; too few → repeat the tail rather than
     invent a pose or drop the pose that closes the loop;
  4. paste onto a fresh magenta field at an exact pitch with wide gutters, feet on the row
     line, and **no scaling**: every figure keeps its source size, because
     `tools/slice_rows.py` scales a whole sheet from row 0 and picks a row's own height as
     the unit itself.  Blow a row of crouches up to full height here and the fighter
     changes size the moment it lands.

    python3 tools/sheet_grid.py --in assets-src/rows/valor-sheetA.png \
            --out assets-src/rows/valor-gridA.png --cells 6,8,6,4 --preview /tmp/g.png
    python3 tools/sheet_grid.py --in s.png --out g.png --spec '0.0-6 | 1.* | 0.6-8,2.*' --dry
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slice_items import key_out          # the same magenta key the slicer and items use
from slice_rows import segment           # the slicer's "cut at the emptiest column" split

MAGENTA = (255, 0, 255, 255)


def bands_of(mask, w, h, min_h=18):
    """Row bands, from the blank lines between them."""
    prof = []
    for y in range(h):
        base, n = y * w, 0
        for x in range(0, w, 2):
            if mask[base + x]:
                n += 1
        prof.append(n)
    out, start = [], None
    for y, v in enumerate(prof):
        if v > 0 and start is None:
            start = y
        elif v == 0 and start is not None:
            if y - start >= min_h:
                out.append((start, y))
            start = None
    if start is not None and h - start >= min_h:
        out.append((start, h))
    return out


def runs_of(mask, w, y0, y1, min_w=8, xa=0, xb=None):
    """Figures inside one band, as x spans, left to right.

    `xa`/`xb` narrow the scan, which is how `boxes_in` re-splits a sub-row without
    dragging in every other figure on the same line."""
    xb = w if xb is None else xb
    prof = []
    for x in range(xa, xb):
        n = 0
        for y in range(y0, y1):
            if mask[y * w + x]:
                n += 1
        prof.append(n)
    runs, start = [], None
    for i, v in enumerate(prof):
        x = xa + i
        if v > 0 and start is None:
            start = x
        elif v == 0 and start is not None:
            if x - start >= min_w:
                runs.append((start, x))
            start = None
    if start is not None and xb - start >= min_w:
        runs.append((start, xb))
    return [runs[0]] if False else runs


def boxes_in(mask, w, y0, y1, x0, x1, min_w=8, min_h=18):
    """The figures inside one rectangle: split on blank columns, and split again on
    blank rows inside each of those, then once more on columns.

    Two rows of a generated sheet often overlap in x — a crouch sitting directly above
    a standing pose — and a plain column run then reads as one giant figure spanning the
    whole band.  Going x, then y, then x again separates the stacked pair without ever
    cutting a single pose, because a pose has no blank line through itself.
    """
    out = []
    for (a, b) in runs_of(mask, w, y0, y1, min_w):
        rows_ = []
        start = None
        for y in range(y0, y1):
            hit = any(mask[y * w + x] for x in range(a, b))
            if hit and start is None:
                start = y
            elif not hit and start is not None:
                if y - start >= min_h:
                    rows_.append((start, y))
                start = None
        if start is not None and y1 - start >= min_h:
            rows_.append((start, y1))
        for (c, d) in rows_:
            for (e, f) in runs_of(mask, w, c, d, min_w, a, b):
                out.append((max(a, e), c, min(b, f), d))
    return out


def comps_of(mask, w, box):
    """The ink inside a box, as components: [(area, x0, y0, x1, y1), …] largest first."""
    x0, y0, x1, y1 = box
    bw = max(1, x1 - x0)
    seen = bytearray(bw * (y1 - y0))
    out = []
    for i in range(len(seen)):
        cy, cx = divmod(i, bw)
        if seen[i] or not mask[(cy + y0) * w + (cx + x0)]:
            continue
        seen[i] = 1
        comp, stack = [i], [i]
        while stack:
            j = stack.pop()
            py, pxx = divmod(j, bw)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = py + dy, pxx + dx
                    if not (0 <= ny < y1 - y0 and 0 <= nx < x1 - x0):
                        continue
                    k = ny * bw + nx
                    if seen[k] or not mask[(ny + y0) * w + (nx + x0)]:
                        continue
                    seen[k] = 1
                    comp.append(k)
                    stack.append(k)
        xs = [cx for c in comp for cx in [c % bw]]
        ys = [cy for c in comp for cy in [c // bw]]
        out.append((len(comp), min(xs) + x0, min(ys) + y0, max(xs) + 1 + x0, max(ys) + 1 + y0, comp))
    out.sort(key=lambda t: -t[0])
    return out


def despeck(sheet, mask, w, box, min_area):
    """Clean a figure's box in place: no dust, and nothing detached under its feet.

    Two junk cases, both born the same way — a generated field is never perfectly clean, and
    the slicer files every leftover blob as its own baked-effect tile:

      * a speck of a few pixels, which becomes a 4x4 tile anchored a few px under the deck
        line, which is exactly what tools/atlascheck.js rejects;
      * a piece of flare or a broken-off foot that hangs *below* the figure's own bottom.
        The atlas anchors a row on the body, so anything below it is drawn on the stage floor.

    Anything with a name in the sheet (a cloak, a trail, a crescent) is kept: only ink that is
    tiny, or that sits entirely under the largest blob, is erased.
    """
    x0, y0, x1, y1 = box
    if x1 <= x0 or y1 <= y0:
        return
    px = sheet.load()
    cs = comps_of(mask, w, box)
    if not cs:
        return
    floor = cs[0][4]                       # the bottom of the body, the largest component
    for area, cx0, cy0, cx1, cy1, comp in cs:
        if not (area < min_area or (cy0 >= floor - 1 and len(comp) < 0.25 * cs[0][0])):
            continue
        for j in comp:
            cy, cx = divmod(j, max(1, x1 - x0))
            mask[(cy + y0) * w + (cx + x0)] = 0
            px[cx + x0, cy + y0] = MAGENTA[:3]


def read_order(boxes):
    """Boxes in the order a human reads them: rows top to bottom, left to right.

    Rows are found in the *tops*, not by overlap: a model that ran out of row puts
    frame 4 of the jump at y=442 and the landing under it at y=586, and every one of
    those boxes reaches most of the way down the band, so "do they overlap" says yes to
    all of them.  Sorting the tops and cutting where the jump between neighbours is
    bigger than a third of a figure finds the real break (498 -> 578) and keeps a
    correctly drawn single row, whose tops sit within a few px, in one piece.
    """
    if not boxes:
        return [], 0
    hs = sorted(b[3] - b[1] for b in boxes)
    thr = max(12, int(0.3 * hs[len(hs) // 2]))
    by_top = sorted(boxes, key=lambda b: b[1])
    clusters, cur = [], [by_top[0]]
    for b in by_top[1:]:
        if b[1] - max(x[1] for x in cur) > thr:
            clusters.append(cur)
            cur = [b]
        else:
            cur.append(b)
    clusters.append(cur)
    out = []
    for li, c in enumerate(clusters):
        out.extend([b + (li,) for b in sorted(c, key=lambda b: b[0])])
    return out, len(clusters)


def trim_rule(mask, w, x0, y0, x1, y1):
    """Trim up to three rows of a drawn ground line off a figure's bottom edge.

    Some sheets put a horizon under every pose.  The slicer plants a row on the bottom of
    the ink, so that line *becomes* the feet and every grounded frame of the row ends up a
    few px under the deck — which tools/atlascheck.js is right to call a failure.  A rule
    is one to three rows of nearly full-width ink with nothing solid under it; a wide
    stance is not, so the row above the cut has to thin out before anything is trimmed.
    """
    if y1 - y0 < 12:
        return (x0, y0, x1, y1)

    def run(y):
        """Longest unbroken ink run on the row, as a fraction of the box.

        Counting ink is the wrong measure: a crouch has two boots and a coat hem, and
        together they cover most of the width, so a *density* test cut Rook's knees.  A
        drawn rule is one unbroken stroke across the cell, which nothing about a pose is.
        """
        best = cur = 0
        for x in range(x0, x1):
            if mask[y * w + x]:
                cur += 1
                best = max(best, cur)
            else:
                cur = 0
        return best / float(max(1, x1 - x0))

    cut = 0
    while cut < 3 and y1 - 1 - cut > y0 and run(y1 - 1 - cut) > 0.55:
        cut += 1
    if not cut or run(y1 - 1 - cut) > 0.40:
        return (x0, y0, x1, y1)
    return (x0, y0, x1, y1 - cut)


def tight(mask, w, x0, y0, x1, y1):
    """Shrink a rect onto its ink; None if it is empty."""
    ax0, ay0, ax1, ay1 = x1, y1, x0, y0
    for y in range(y0, y1):
        base = y * w
        for x in range(x0, x1):
            if mask[base + x]:
                ax0 = min(ax0, x); ax1 = max(ax1, x + 1)
                ay0 = min(ay0, y); ay1 = max(ay1, y + 1)
    if ax1 <= ax0 or ay1 <= ay0:
        return None
    # Plant the figure on its own median support line.  A pose's feet are what the atlas
    # anchors to, and the bottom of a tight ink box is only the feet if nothing else hangs
    # lower — a glint, a puff of dust or the end of a drawn horizon is.  Trim to the
    # per-column median and those outliers go with it, so the row keeps `ay == h`, which is
    # the contract tools/atlascheck.js reads as "nothing is drawn under the deck".
    bottoms = []
    for x in range(ax0, ax1):
        for y in range(ay1 - 1, ay0 - 1, -1):
            if mask[y * w + x]:
                bottoms.append(y)
                break
    if bottoms:
        bottoms.sort()
        med = bottoms[len(bottoms) // 2]
        if med < ay1 - 1:
            ay1 = max(med, ay1 - 5) + 1
    return trim_rule(mask, w, ax0, ay0, ax1, ay1)


def cut_weld(mask, w, figs, i):
    """Split figure `i` into two at its emptiest column.

    A generated row welds a pose and its impact effect together whenever they touch, and
    a welded cell is not a frame: the slicer would scale one giant tile to the row's
    height and the pose would arrive with somebody else's shockwave stapled to it.  Cut
    where the ink is thinnest, with the slicer's own segmenter — the same rule that keeps
    a slash arc out of the pose in front of it.
    """
    x0, y0 = figs[i]['at']
    cw, chh = figs[i]['size']
    x1, y1 = x0 + cw, y0 + chh
    inset = max(2, cw // 8)
    prof = [sum(1 for y in range(y0, y1) if mask[y * w + x]) for x in range(x0 + inset, x1 - inset)]
    spans = segment(prof, 2, search=max(6, cw // 8))
    if len(spans) < 2:
        return [figs[i]]
    cx = x0 + inset + spans[0][1]
    out, line = [], figs[i].get('row', 0)
    for (a, b) in ((x0, cx), (cx, x1)):
        t = tight(mask, w, a, y0, b, y1)
        if t:
            out.append({'band': figs[i]['band'], 'row': line, 'at': (t[0], t[1]),
                        'size': (t[2] - t[0], t[3] - t[1])})
    return out or [figs[i]]


def resample(items, want):
    n = len(items)
    if n == 0 or n == want:
        return list(items)
    if n > want:
        return [items[round(i * (n - 1) / (want - 1))] for i in range(want)]
    out = list(items)
    # A short line is padded by holding the tail — and alternating the last two frames
    # rather than freezing one, because a frozen frame reads as a hitch even in a pose
    # the state machine only touches once.  Nothing is invented and no pose is dropped.
    back = min(2, n)
    while len(out) < want:
        out.append(items[-1 - ((len(out) - n) % back)])
    return out[:want]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--cells', default=None, help='figures wanted per output row, comma list (default: whatever the spec gives)')
    ap.add_argument('--figures', default=None, help="how many figures to expect on each source "
                    "line, '*' to keep what was found — '6,8,6,4' for the movement sheet. A line "
                    "found with far more boxes than that was drawn with detached limbs (a staff, a "
                    "star charm, a trailing scarf), so it is re-cut by ink mass the way the slicer "
                    "cuts cells; a line with a couple extra poses is thinned evenly, first and last "
                    "kept, because those are the ends of the cycle.")
    ap.add_argument('--equal', default=None, type=int, help='ignore the ink bands and divide the '
                    'sheet into N equal rows first — for a sheet whose figures touch from one row '
                    'to the next (a cape over a head), where band detection would weld them')
    ap.add_argument('--nolines', action='store_true', help='keep the sheet\'s drawn grid rules')
    ap.add_argument('--cols', default=None, type=int, help='trust the grid: cut every row band '
                    'into N equal columns and take each column\'s ink as one pose. A sheet of '
                    'detached limbs, sparkles and capes defeats both box detection and mass '
                    'segmentation, and the recipe asked for a uniform grid — so ask for it back.')
    ap.add_argument('--use', default=None, help='which source line each output row takes, e.g. '
                    '"0,1,1,2,2,3" for idle,run,walk,jump,fall,land off a 4-line sheet')
    ap.add_argument('--spec', default=None, help="'band.range' terms per row, rows split on |, "
                    "terms on ','; range is 'a-b', 'a-' or '*' — e.g. '0.* | 1.0-6,2.* | 3.*'")
    ap.add_argument('--pitch', default=1.30, type=float, help='cell width ÷ widest figure')
    ap.add_argument('--gap', default=24, type=int)
    ap.add_argument('--cut', default=None, help="welded figures to split in two, 'band.index' "
                    "list — the model often draws the dive and its shockwave touching, and one "
                    "tile of two poses makes a panorama the fighter would have to wear")
    ap.add_argument('--despeck', default=30, type=int, help='delete ink blobs smaller than this '
                    'many pixels from a figure (a speck the model left on the field becomes a '
                    '4x4 baked-VFX tile in the atlas, anchored a few px under the deck)')
    ap.add_argument('--list', action='store_true', help='print every figure index with its x span')
    ap.add_argument('--preview', default=None)
    ap.add_argument('--json', default=None)
    ap.add_argument('--dry', action='store_true')
    args = ap.parse_args()

    want = [int(x) for x in args.cells.split(',')] if args.cells else None
    sheet = Image.open(args.src).convert('RGBA')
    w, h = sheet.size
    mask = key_out(sheet.convert('RGB').load(), w, h)
    # Some sheets come back with the grid itself drawn — a dark rule down every column
    # and across every row.  Those rules are ink to the keyer, so every cell's tight box
    # grew to its whole column and a pose carried a hairline frame.  A rule spans the
    # sheet and is a few px thick; a pose does neither.
    if not args.nolines:
        px = sheet.load()
        def runs_over(vals, limit=5):
            """Consecutive line numbers, as [n, n+1, …] groups no wider than `limit`.

            Kept short on purpose: a band of ink eight rows deep is a figure lying down,
            and erasing it would erase her fast-fall frame with it.
            """
            out, cur = [], []
            for v in vals:
                if cur and v - cur[-1] <= 1:
                    cur.append(v)
                else:
                    if cur:
                        out.append(cur)
                    cur = [v]
            if cur:
                out.append(cur)
            return [r for r in out if len(r) <= limit]
        ys = [y for y in range(h)
              if sum(1 for x in range(0, w, 2) if mask[y * w + x]) > 0.80 * (w // 2)]
        xs = [x for x in range(w)
              if sum(1 for y in range(0, h, 2) if mask[y * w + x]) > 0.80 * (h // 2)]
        killed = 0
        for r in runs_over(ys):
            for y in r:
                base = y * w
                for x in range(w):
                    mask[base + x] = 0
                    px[x, y] = MAGENTA[:3]
                killed += 1
        for r in runs_over(xs):
            for x in r:
                for y in range(h):
                    mask[y * w + x] = 0
                    px[x, y] = MAGENTA[:3]
                killed += 1
        if killed:
            print('  stripped %d drawn grid rule line(s) from the sheet' % killed)
    bands = bands_of(mask, w, h)
    if args.equal:
        bands = [(int(round(i * h / float(args.equal))), int(round((i + 1) * h / float(args.equal))))
                 for i in range(args.equal)]
    if not bands:
        sys.exit('%s: nothing but magenta in the sheet' % args.src)

    inv, nrows = [], []
    for bi, (y0, y1) in enumerate(bands):
        if args.cols:
            n = int(args.cols)
            figs = []
            for i in range(n):
                x0c, x1c = int(round(i * w / float(n))), int(round((i + 1) * w / float(n)))
                t = tight(mask, w, x0c, y0, x1c, y1)
                if t:
                    figs.append({'band': bi, 'row': 0, 'at': (t[0], t[1]), 'size': (t[2] - t[0], t[3] - t[1])})
            inv.append(figs)
            print('  band %d  rows[%d..%d]  %d of %d columns carry a pose'
                  % (bi, y0, y1, len(figs), n))
            continue
        if args.equal:
            # one box over the whole row: `--figures` re-cuts it into poses by ink mass,
            # which is the only cut that survives a row whose outlines touch the next
            inv.append([{'band': bi, 'row': 0, 'at': (0, y0), 'size': (w, y1 - y0)}])
            print('  band %d  rows[%d..%d]  one row, to be cut by --figures' % (bi, y0, y1))
            continue
        boxes, rows_ = read_order(boxes_in(mask, w, y0, y1, 0, w))
        figs = []
        for (x0, a, x1, b, li) in boxes:
            figs.append({'band': bi, 'row': li, 'at': (x0, a), 'size': (x1 - x0, b - a)})
        cuts = sorted(int(t.split('.')[1]) for t in (args.cut.split(',') if args.cut else [])
                      if t.strip().startswith('%d.' % bi) and int(t.split('.')[1]) < len(figs))
        for i in reversed(cuts):                     # high indices first: the list shifts
            figs[i:i + 1] = cut_weld(mask, w, figs, i)
        inv.append(figs)
        nrows.append(rows_)
        print('  band %d  rows[%d..%d]  %d figures in %d row(s)' % (bi, y0, y1, len(figs), rows_))
        if args.list or cuts:
            print('      ' + '  '.join('%d:x%d/%d' % (i, f['at'][0], f['at'][1]) for i, f in enumerate(figs)))

    # A row is a list of (band, first, last) takes.  --spec is for the sheet where the model
    # squeezed two rows into one band, or drew eight poses when six were asked for: `0.0-6`
    # takes the first six of band 0, and a row can be the tail of one band plus the head of
    # the next.  Without it, band r feeds row r whole.
    # Lines, in reading order across the sheet: a band is a row of the model's grid, a
    # line is a row of *poses*, and the two differ exactly when the sheet ran over.
    lines = []
    for bi, figs in enumerate(inv):
        for li in sorted({f.get('row', 0) for f in figs}):
            lines.append([f for f in figs if f.get('row', 0) == li])
    if args.figures:
        # `8` adapts (thin or pad what was found), `8+` forces a mass re-cut — a line whose
        # five boxes are really eight poses welded pairwise needs segment(), not resample()
        def count_of(t):
            t = t.strip()
            if t in ('*', '0'):
                return None, False
            force = t.endswith('+')
            return int(t.rstrip('+')), force
        counts = [count_of(t) for t in args.figures.split(',')]
        while len(counts) < len(lines):
            counts.append(None)
        for i, (n, force) in enumerate(counts[:len(lines)]):
            pool = lines[i]
            if not n or (not force and n == len(pool)):
                continue
            if not args.cols and (force or args.equal or len(pool) / float(n) >= 1.5):
                # fragmented: re-cut by mass
                y0 = min(f['at'][1] for f in pool)
                y1 = max(f['at'][1] + f['size'][1] for f in pool)
                prof = [sum(1 for y in range(y0, y1) if mask[y * w + x]) for x in range(w)]
                boxes = [t for t in segment(prof, n) if any(prof[t[0]:t[1]])]
                pool = []
                for (a, b) in boxes:
                    t = tight(mask, w, a, y0, b, y1)
                    if t:
                        pool.append({'band': i, 'row': i, 'at': (t[0], t[1]),
                                     'size': (t[2] - t[0], t[3] - t[1])})
                if not pool:
                    sys.exit('line %d: re-cutting it into %d figures found nothing' % (i, n))
            elif n != len(pool):                             # a couple extra or short: thin/pad
                pool = resample(pool, n)

            lines[i] = pool
        for i, pool in enumerate(lines):
            print('  line %d  %d figures' % (i, len(pool)))

    if args.spec:
        rows = []
        for part in args.spec.split('|'):
            takes = []
            for term in part.strip().split(','):
                term = term.strip()
                num = lambda t: None if t.strip() in ('', '*') else int(t)
                if '#' in term:                      # `2#1` = that band's second sub-row
                    band, _, rng = term.partition('#')
                    takes.append((int(band), None, None, num(rng), num(rng.split('-')[-1]) if '-' in rng else None))
                else:
                    band, _, rng = term.partition('.')
                    a, _, b = rng.partition('-')
                    takes.append((int(band), num(a) or 0, num(b), None, None))
            rows.append(takes)
    elif args.use:
        use = [int(x) for x in args.use.split(',')]
        for i in use:
            if i >= len(lines):
                sys.exit('--use names line %d, the sheet has %d' % (i, len(lines)))
        rows = [[('L', i, 0, None)] for i in use]
    else:
        n = len(want) if args.cells else len(lines)
        rows = [[('L', r, 0, None)] for r in range(n)]

    src = []
    for takes in rows:
        figs = []
        for take in takes:
            bi, a, b = take[0], take[1], take[2]
            if bi == 'L':                             # a whole line, as --figures shaped it
                figs.extend(lines[a])
                continue
            if bi >= len(inv):
                sys.exit('spec wants source band %d, the sheet has %d' % (bi, len(inv)))
            pool = inv[bi]
            if len(take) > 3 and take[3] is not None:      # select by sub-row, not by index
                lo, hi = take[3], (take[4] if take[4] is not None else take[3])
                pool = [f for f in pool if f.get('row', 0) >= lo and f.get('row', 0) <= hi]
            else:
                pool = pool[a:b]
            if not pool:
                sys.exit('spec term %r matched no figures in band %d' % (take, bi))
            figs.extend(pool)
        if not figs:
            sys.exit('an output row resolved to no figures: %r' % (takes,))
        src.append(figs)
    if not args.cells:
        want = [len(f) for f in src]
    if len(want) != len(src):
        sys.exit('--cells has %d entries for %d rows' % (len(want), len(src)))

    tallest = max(f['size'][1] for row in src for f in row)
    # A pitch per row, not one for the sheet: a 4-line band (rook drew his whole sheet as
    # one band) would otherwise set one cell width from its widest cape and pad every
    # other row out to it.  tools/slice_rows.py --grid reads the exact columns back out of
    # the layout, so the rows never have to agree with each other.
    cw = [int(round(max(f['size'][0] for f in row) * args.pitch)) for row in src]
    ch = tallest + 8
    gap = args.gap
    out = Image.new('RGBA', (gap * 2 + max(cw) * max(want), gap * 2 + ch * len(want) + gap), MAGENTA)
    placed = []
    for r, n in enumerate(want):
        base_y = gap + r * (ch + gap) + ch                  # the row's ground line
        row = resample(src[r], n)
        # One ground line per row, not one per figure.  tight() already planted each figure
        # on its own support line, but a landing frame whose dust spreads under its boots
        # puts *that* lower, and the row is then keyed to the odd one out — every other
        # pose floats a few px and the puff digs into the deck.  Take the median of the
        # row's own support lines and cut each figure back to it.
        lines_ = sorted(f['at'][1] + f['size'][1] for f in row)
        rowline = lines_[len(lines_) // 2]
        for f in row:
            bot = f['at'][1] + f['size'][1]
            if bot > rowline:
                f['size'] = (f['size'][0], max(2, rowline - f['at'][1]))
        for c, f in enumerate(row):
            fbox = (f['at'][0], f['at'][1], f['at'][0] + f['size'][0], f['at'][1] + f['size'][1])
            despeck(sheet, mask, w, fbox, args.despeck)
            t = tight(mask, w, *fbox) or fbox
            f = dict(f, at=(t[0], t[1]), size=(t[2] - t[0], t[3] - t[1]))
            img = sheet.crop((f['at'][0], f['at'][1], f['at'][0] + f['size'][0], f['at'][1] + f['size'][1]))
            x = gap + c * cw[r] + (cw[r] - f['size'][0]) // 2
            y = base_y - f['size'][1]
            out.paste(img, (x, y), img)
            placed.append({'row': r, 'cell': c, 'from': list(f['at']), 'size': list(f['size']),
                           'at': [x, y], 'band': f['band']})
    print('  grid %d rows × %d cells · pitch %s · row %d · 1:1 scale · feet on the row line'
          % (len(want), max(want), '%d..%d' % (min(cw), max(cw)), ch))
    if args.preview:
        out.convert('RGB').save(args.preview)
        print('  preview -> %s' % args.preview)
    if args.json:
        # the exact layout, so tools/slice_rows.py --grid can cut the cells it is told
        # about instead of re-deriving them from ink mass (which it must not guess: two
        # identical poses side by side balance the mass right through a figure)
        layout = [{'y': [gap + r * (ch + gap), gap + r * (ch + gap) + ch],
                   'x': [[gap + c * cw[r], gap + (c + 1) * cw[r]] for c in range(n)]}
                  for r, n in enumerate(want)]
        json.dump({'sheet': args.src, 'cell': [cw, ch], 'rows': want, 'pitch': cw, 'gap': gap,
                   'rowH': ch, 'layout': layout,
                   'used': [[f['at'] for f in row] for row in src],
                   'bands': [len(b) for b in inv], 'placed': placed}, open(args.json, 'w'), indent=1)
        print('  inventory -> %s' % args.json)
    if args.dry:
        print('%s: dry run, nothing written' % os.path.basename(args.src))
        return 0
    d = os.path.dirname(os.path.abspath(args.out))
    if d:
        os.makedirs(d, exist_ok=True)
    out.convert('RGB').save(args.out)
    print('wrote %s (%dx%d)' % (args.out, out.size[0], out.size[1]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
