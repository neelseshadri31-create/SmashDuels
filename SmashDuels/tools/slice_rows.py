#!/usr/bin/env python3
"""tools/slice_rows.py — inject generated animation rows into a fighter atlas.

The shipped atlases came from `tools/slice_roster.py` reading the concept sheets in
`roster/`.  Those sheets run out of poses exactly where the game needs them most:
`dash` is 2 frames, both rolls are 2 frames, and the dash attack has no row at all —
`MOVE_ANIM.dashattack` borrows `stilt` (the side tilt), which is why Grim's dash attack
looked like a squashed panorama instead of a lunge.

This tool adds real frames for those rows.  It reads a generated sheet — poses on a
flat magenta field, one row of cells per animation, no labels or grid lines — splits it
by projection (rows on the y axis, cells on the x axis), scales a whole row to the
atlas's own reference height, packs the tiles into the free space of the existing atlas
PNG, and rewrites the row in `<key>.json`.  Nothing else about the atlas is touched, so
a re-run is safe and `--revert` puts the original JSON (and PNG) back.

    python3 tools/slice_rows.py --key grim --sheet assets-src/rows/grim-sheetA.png \
            --rows idle,run,walk,jump,fall,land --preview /tmp/grim-rows.png
    python3 tools/slice_rows.py --key grim --revert

The two rules the atlas is built on, and which this tool has to satisfy because
tools/atlascheck.js checks them: a frame is anchored at (feet x, ground line y) with
the ground line at the bottom of its tile (`ay - h` stays within a few px for every
frame of a grounded row, so nothing bounces), and a tile whose ink is far wider than it
is tall is rejected by `Sprites.usable()` as an unsplit montage — so each row is scaled
so even its widest pose stays inside that bound, rather than being trimmed to fit.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slice_items import key_out                      # the same magenta keying recipe

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
ATLAS_DIR = os.path.join(PROJ, 'game', 'assets', 'atlas')

PAD = 2            # gutter around a packed tile, matching slice_roster
GAP_ROW = 0.030    # fraction of sheet height that separates two rows
GAP_COL = 0.012    # fraction of sheet width that separates two cells
MIN_ROW_H = 0.035  # a band this short is dust or a stray mark, not a row


def project(mask, w, h, x0, x1, y0, y1, axis):
    """Ink count per line along one axis, inside a window."""
    if axis == 'y':
        out = []
        for y in range(y0, y1):
            n = 0
            base = y * w
            for x in range(x0, x1):
                if mask[base + x]:
                    n += 1
            out.append(n)
        return out
    out = []
    for x in range(x0, x1):
        n = 0
        for y in range(y0, y1):
            if mask[y * w + x]:
                n += 1
        out.append(n)
    return out


def gap_split(counts, min_gap=2):
    """The bands of ink separated by empty lines — how a well-behaved sheet is read."""
    n, out, i = len(counts), [], 0
    while i < n:
        if not counts[i]:
            i += 1
            continue
        j = i
        while j < n and counts[j]:
            j += 1
        out.append([i, j])
        i = j
    merged = []
    for r in out:
        if merged and r[0] - merged[-1][1] < min_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(list(r))
    return [(a, b) for (a, b) in merged]


def segment(counts, want, search=26):
    """Cut an ink profile into `want` contiguous pieces, at low-mass lines.

    This is 1-D segmentation, not clustering: a generated row is a left-to-right
    sequence of poses, so the cuts have to keep the pieces contiguous and land in the
    blank space between figures.  Cutting on the biggest gaps alone fails, because the
    sheets draw a slash arc, a muzzle flash or a comet trail detached from the body that
    owns it — the gap in front of an effect is wider than the gap between two poses, and
    the pose ends up sliced in half with its effect in the next cell.  So each split
    goes to the half-mass line of the piece being divided (balanced, therefore stable)
    and is then nudged to the emptiest column within a short reach of it.
    """
    n = len(counts)
    if not want or want <= 1:
        return [(0, n)] if any(counts) else []
    spans = [(0, n)]
    while len(spans) < want:
        # split the piece carrying the most ink, so the mass ends up balanced
        k = max(range(len(spans)), key=lambda i: sum(counts[spans[i][0]:spans[i][1]]))
        a, b = spans.pop(k)
        span = counts[a:b]
        total = float(sum(span))
        if total <= 0:
            continue
        half, acc, mid = total / 2.0, 0.0, 0
        for i, c in enumerate(span):
            acc += c
            if acc >= half:
                mid = i
                break
        lo, hi = max(1, mid - search), min(b - a - 1, mid + search)
        best, cut = None, a + mid
        for i in range(lo, max(lo, hi) + 1):
            # local emptiness: a few columns either side, so a thin limb is not a cut
            v = sum(counts[a + max(0, i - 3):a + i + 4])
            d = abs(i - mid)
            score = (v, d)
            if best is None or score < best:
                best, cut = score, a + i
        spans.insert(k, (a, cut))
        spans.insert(k + 1, (cut, b))
        spans = [sp for sp in spans if any(counts[sp[0]:sp[1]])] or [(a, b)]
    spans.sort()
    return [tuple(sp) for sp in spans if any(counts[sp[0]:sp[1]])]


def split(sheet_mask, w, h, want_rows, want_cells):
    """Rows on the y axis, cells on x within each row (see `segment`)."""
    yprof = project(sheet_mask, w, h, 0, w, 0, h, 'y')
    # Rows first by the blank lines between them: a generated sheet often carries an
    # extra variation row nobody asked for, and balancing the ink mass into exactly
    # `want_rows` bands would cut that sheet straight through its figures.  So the
    # discovered bands win, the first `want_rows` of them are taken in reading order,
    # and the count mismatch is reported for whoever is looking.
    found = gap_split(yprof, 3)
    dropped = 0
    if len(found) > (want_rows or 0) > 0:
        dropped = len(found) - want_rows
        found = found[:want_rows]
    elif want_rows and len(found) < want_rows:
        found = segment(yprof, want_rows)
    rows = [(a, b, sum(yprof[a:b])) for (a, b) in found]
    if dropped:
        print('  note: the sheet has %d more row(s) than asked for — the extra %d are ignored'
              % (dropped, dropped))
    # A sheet off `tools/sheet_grid.py` has a different, deliberate cell count per row
    # (6 idles, 8 runs, 4 landings).  Splitting every row with the largest count would
    # cut the short rows through their poses, so a list means "this many, per row".
    per = want_cells if isinstance(want_cells, (list, tuple)) else [want_cells] * len(rows)
    out = []
    for i, (y0, y1, _) in enumerate(rows):
        want_cells_i = per[i] if i < len(per) else None
        xprof = project(sheet_mask, w, h, 0, w, y0, y1, 'x')
        cells = [(a, b, 0) for (a, b) in segment(xprof, want_cells_i)]
        boxes = []
        for (cx0, cx1, _) in cells:
            lo = hi = None
            for y in range(y0, y1):
                base = y * w
                hit = False
                for x in range(cx0, cx1):
                    if sheet_mask[y * w + x]:
                        hit = True
                        break
                if hit:
                    lo = y if lo is None else lo
                    hi = y
            if lo is not None:
                boxes.append((cx0, lo, cx1, hi + 1))
        out.append((y0, y1, boxes, len(boxes) != (want_cells_i or len(boxes))))
    return out


def from_grid(mask, w, h, spec, rows):
    """Row bands and cell columns straight off a `tools/sheet_grid.py` layout.

    Same shape as `split()` returns, so nothing downstream knows the difference: one
    (y0, y1, boxes, even) per row, and `boxes` one tight ink box per cell in the order
    the grid tool laid them out.  A cell with no ink in it is an error rather than an
    empty tile: a repeated pose is a choice, an empty one is a miscount.
    """
    layout = spec.get('layout') or []
    if len(layout) != len(rows):
        sys.exit('grid: the layout has %d row(s), the injection asked for %d'
                 % (len(layout), len(rows)))
    out = []
    for i, name in enumerate(rows):
        band = layout[i]
        y0 = max(0, int(min(band['y'])))
        y1 = min(h, int(max(band['y'])))
        boxes = []
        for j, (cx0, cx1) in enumerate(band['x']):
            cx0, cx1 = max(0, int(cx0)), min(w, int(cx1))
            lo = hi = None
            for y in range(y0, y1):
                base = y * w
                if any(mask[base + x] for x in range(cx0, cx1)):
                    lo = y if lo is None else lo
                    hi = y
            if lo is None:
                sys.exit('grid: row %s cell %d is empty — the sheet lost a pose' % (name, j))
            boxes.append((cx0, lo, cx1, hi + 1))
        out.append((y0, y1, boxes, True))
    return out


class Packer:
    """Shelf packer that only ever uses space the atlas is not already using.

    Two rules matter here.  The new tiles must not touch a tile that is already
    referenced — a paste into an occupied rect silently paints over somebody's idle
    pose, and every geometry test still passes because the rects are individually fine
    (tools/atlascheck.js now checks the overlap too).  And the bookkeeping has to stay
    cheap: a free-rect list carved against 128 existing tiles explodes into thousands
    of fragments, which is how a four-second job turns into a minute per fighter.

    So: candidate shelf lines are the bottoms of existing tiles, and for each line the
    occupied x-spans on that band are subtracted from the row width.  First span wide
    enough wins; if no line has room, the canvas grows by a band and the new row is
    empty by definition.
    """

    def __init__(self, w, h, tiles):
        self.w, self.h = w, h
        self.used = [dict(t) for t in tiles]

    def place(self, w, h):
        w, h = w + PAD * 2, h + PAD * 2
        ys = sorted({0} | set(t['y'] + t['h'] + PAD for t in self.used))
        for y in ys:
            if y < 0 or y + h > self.h + 1:
                continue
            lo = max(0, y - PAD)
            spans = [(0, self.w)]
            for t in self.used:
                if t['y'] - PAD >= y + h or t['y'] + t['h'] + PAD <= y:
                    continue
                a, b = max(0, t['x'] - PAD), min(self.w, t['x'] + t['w'] + PAD)
                out = []
                for (s0, s1) in spans:
                    if b <= s0 or a >= s1:
                        out.append((s0, s1))
                        continue
                    if s0 < a:
                        out.append((s0, a))
                    if b < s1:
                        out.append((b, s1))
                spans = out
            for (s0, s1) in spans:
                if s1 - s0 >= w:
                    x = s0 + PAD
                    self.used.append({'x': x, 'y': y + PAD, 'w': w - PAD * 2, 'h': h - PAD * 2})
                    return x, y + PAD
        self.grow(w, h)
        return self.place(w - PAD * 2, h - PAD * 2)

    def grow(self, w, h):
        self.h += max(64, h + PAD * 2)


def parts_of(mask, w, box, img_px):
    """Split one cell's ink into (body, effect) by connected components.

    Baked VFX — the crescent of a slash, the crack of a down smash, a comet tail — is
    drawn free of the figure or wrapped around it, and the atlas needs the two apart:
    `Sprites.usable()` throws a frame away once its *body* is far wider than it is tall
    (that is how it rejects an unsplit montage), and `vfxGate` fades an effect in
    through the wind-up and back out after the hit, which only works if the effect is
    its own overlay tile.  Painting them together gives a heavy attack one grey
    rectangle and a hitbox that falls back to the authored numbers.

    So: the biggest blob is the body; a smaller blob goes to the effect layer when it is
    brighter than the body (a glow, a spark) or when it is a fragment (debris, a dust
    puff).  Anything else — dark and sizeable, e.g. a sword the hand does not touch — is
    part of the figure, so it stays with the body rather than fading in and out.
    """
    x0, y0, x1, y1 = box
    n = (x1 - x0) * (y1 - y0)
    lab = [-1] * n
    comps = []
    nxt = 0
    stack = []
    for yy in range(y0, y1):
        for xx in range(x0, x1):
            i = (yy - y0) * (x1 - x0) + (xx - x0)
            if not mask[yy * w + xx] or lab[i] >= 0:
                continue
            lab[i] = nxt
            stack.append(i)
            cells = []
            while stack:
                j = stack.pop()
                cells.append(j)
                jy, jx = divmod(j, x1 - x0)
                for nx2, ny2 in ((jx - 1, jy), (jx + 1, jy), (jx, jy - 1), (jx, jy + 1)):
                    if not (0 <= nx2 < x1 - x0 and 0 <= ny2 < y1 - y0):
                        continue
                    k = ny2 * (x1 - x0) + nx2
                    if mask[(ny2 + y0) * w + nx2 + x0] and lab[k] < 0:
                        lab[k] = nxt
                        stack.append(k)
            comps.append({'cells': cells, 'label': nxt})
            nxt += 1
    if not comps:
        return None, None

    def stats(c):
        lum = 0
        bx0, by0, bx1, by1 = 1 << 30, 1 << 30, -1, -1
        for j in c['cells']:
            jy, jx = divmod(j, x1 - x0)
            X, Y = jx + x0, jy + y0
            r, g, b = img_px[X, Y][:3]
            lum += 0.2126 * r + 0.7152 * g + 0.0722 * b
            bx0, by0 = min(bx0, X), min(by0, Y)
            bx1, by1 = max(bx1, X + 1), max(by1, Y + 1)
        return {'bbox': (bx0, by0, bx1, by1), 'area': len(c['cells']),
                'lum': lum / float(max(1, len(c['cells'])))}

    st = [stats(c) for c in comps]
    order = sorted(range(len(comps)), key=lambda i: -st[i]['area'])
    body_i = order[0]
    body, fx = [], []
    for i in order:
        if i == body_i:
            body.append(i)
        elif st[i]['lum'] > st[body_i]['lum'] + 10 or st[i]['area'] < 0.12 * st[body_i]['area']:
            fx.append(i)
        else:
            body.append(i)

    def crop(keep_labels):
        if not keep_labels:
            return None
        bx0, by0, bx1, by1 = 1 << 30, 1 << 30, -1, -1
        for i in keep_labels:
            b = st[i]['bbox']
            bx0, by0 = min(bx0, b[0]), min(by0, b[1])
            bx1, by1 = max(bx1, b[2]), max(by1, b[3])
        cw, chh = bx1 - bx0, by1 - by0
        out = Image.new('RGBA', (cw, chh), (0, 0, 0, 0))
        op = out.load()
        keep = set(comps[i]['label'] for i in keep_labels)
        for yy in range(by0, by1):
            for xx in range(bx0, bx1):
                j = (yy - y0) * (x1 - x0) + (xx - x0)
                if 0 <= j < n and lab[j] in keep and mask[yy * w + xx]:
                    op[xx - bx0, yy - by0] = tuple(img_px[xx, yy][:3]) + (255,)
        return out, (bx0, by0, bx1, by1)

    # The largest blob is the figure -- unless it is not a figure at all.  A body spans
    # most of its cell's height; a smoke puff does not.  Vesper's recovery frame is
    # mostly the smoke he stepped out of, and that puff is a bigger blob than the
    # crouching ninja beside it, so trusting area alone would make the smoke the body:
    # the fighter would be painted into the effect layer and faded in by vfxGate, and
    # the row would measure its hitbox off a cloud.  When the biggest blob is too flat
    # to be a pose, keep the frame as one baked tile -- which is what the roster rows
    # that never needed a split already are.
    if st[body_i]['bbox'][3] - st[body_i]['bbox'][1] < 0.55 * (y1 - y0):
        return [(None, (x0, y0, x1, y1))]
    return [g for g in (crop(body), crop(fx)) if g]


def anchor_x(mask, w, box):
    """Where the pose touches the ground, as a fraction of its own ink box.

    A tile's anchor decides where the fighter is planted, and the shipped rows are
    anchored at the centre of their *cell* — which for these tight crops would be the
    centre of the ink.  A lunge with a flame trail behind it has its ink centre well
    back of the body, so the whole figure would slide forward out of the feet it is
    standing on.  The median x of the bottom band is the support foot, and it is robust
    to a thin dust or trail smear sharing the ground row."""
    x0, y0, x1, y1 = box
    band = max(2, int(round((y1 - y0) * 0.12)))
    xs = []
    for y in range(max(y0, y1 - band), y1):
        base = y * w
        xs.extend(x for x in range(x0, x1) if mask[base + x])
    if len(xs) < 6:
        return (x0 + x1) / 2.0
    xs.sort()
    return (xs[len(xs) // 2] + xs[max(0, len(xs) // 2 - 1)]) / 2.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--key', required=True)
    ap.add_argument('--sheet', default=None)
    ap.add_argument('--rows', default='dashattack,dash,rollfwd,rollback')
    ap.add_argument('--cells', default=None, help='expected cells per row, comma list')
    ap.add_argument('--grid', default=None, help="an exact layout from tools/sheet_grid.py "
                    "(its --json file): cut these cells instead of re-deriving them from ink "
                    "mass, which a sheet of deliberately even-pitch poses does not need and "
                    "which two identical neighbouring poses can defeat")
    ap.add_argument('--preview', default=None)
    ap.add_argument('--dry', action='store_true')
    ap.add_argument('--revert', action='store_true')
    args = ap.parse_args()

    png = os.path.join(ATLAS_DIR, args.key + '.png')
    jsn = os.path.join(ATLAS_DIR, args.key + '.json')
    bk_png, bk_jsn = png + '.prerows', jsn + '.prerows'

    if args.revert:
        if os.path.exists(bk_jsn):
            os.replace(bk_jsn, jsn)
            if os.path.exists(bk_png):
                os.replace(bk_png, png)
            print('%s: reverted to the pre-injection atlas' % args.key)
        else:
            print('%s: nothing to revert' % args.key)
        return 0

    rows = [r.strip() for r in args.rows.split(',') if r.strip()]
    expect = [int(x) for x in args.cells.split(',')] if args.cells else [None] * len(rows)
    if len(expect) != len(rows):
        expect = [expect[0] if len(expect) == 1 else None] * len(rows)
    if not os.path.exists(png) or not os.path.exists(jsn):
        sys.exit('%s: no atlas at %s' % (args.key, ATLAS_DIR))
    if not args.sheet or not os.path.exists(args.sheet):
        sys.exit('%s: sheet %s missing' % (args.key, args.sheet))

    meta = json.load(open(jsn))
    unit = float(meta.get('refH') or 53)
    notes = []
    sheet = Image.open(args.sheet).convert('RGB')
    sw, sh = sheet.size
    mask = key_out(sheet.load(), sw, sh)

    # count of expected rows = the ones asked for
    # `expect` is a per-row cell count, and a row nobody constrained is None — so the
    # hint passed to the splitter has to be the max of the numbers only (max() of a list
    # holding None raises, which is what made an omitted `--cells` crash).
    want_cells = [e for e in (expect or []) if e]
    per_row = expect if all(expect) else (max(want_cells) if want_cells else None)
    if args.grid:
        with open(args.grid) as fh:
            spec = json.load(fh)
        layout = from_grid(mask, sw, sh, spec, rows)
        expect = [len(b[2]) for b in layout]        # the grid is the count, by definition
    else:
        layout = split(mask, sw, sh, len(rows), per_row)
    if len(layout) != len(rows):
        sys.exit('%s: sheet split into %d rows, asked for %d — retake it or trim --rows'
                 % (args.key, len(layout), len(rows)))
    for i, (name, (y0, y1, cols, even)) in enumerate(zip(rows, layout)):
        want = expect[i]
        if want and len(cols) != want:
            sys.exit('%s: row %s came out with %d cells, expected %d' % (args.key, name, len(cols), want))
        if not cols:
            sys.exit('%s: row %s is empty' % (name, args.key))
        notes.append('  %-11s rows[%d..%d] %d cells%s' % (name, y0, y1, len(cols), ' (even pitch)' if even else ''))

    if not os.path.exists(bk_jsn) and not args.dry:
        import shutil
        shutil.copyfile(jsn, bk_jsn)
        shutil.copyfile(png, bk_png)
    atlas = Image.open(png).convert('RGBA')
    aw, ah = atlas.size
    atlas_orig = (aw, ah)
    tiles = meta['tiles']
    packer = Packer(aw, ah, tiles)
    crops = []
    added = 0
    # One scale for the whole sheet, not one per row.  The model draws a tucked roll as
    # a ball roughly four fifths of the standing height, and a per-row scale would blow
    # that ball up to full height — the fighter would change size the moment it rolled.
    # Sharing one k keeps every row in proportion with every other one.
    sized = []
    for name, (y0, y1, boxes, even) in zip(rows, layout):
        ink = []
        for b in boxes:
            bx0, bx1, by0, by1 = b[2], b[0], b[3], b[1]
            for y in range(b[1], b[3]):
                base = y * sw
                for x in range(b[0], b[2]):
                    if mask[base + x]:
                        bx0 = min(bx0, x); bx1 = max(bx1, x + 1)
                        by0 = min(by0, y); by1 = max(by1, y + 1)
            ink.append((bx0, by0, bx1, by1))
        sized.append((name, ink))
    # Scale from the first row's tallest figure, not the sheet's: row 0 is the full-body
    # lunge, so it is the only row whose height is a body.  A dash row drawn with a smoke
    # plume over the head is as tall as a standing figure, and keying off it would shrink
    # every other row down to make room for somebody's exhaust.
    r0 = max(b[3] - b[1] for b in sized[0][1])
    gall = max(b[3] - b[1] for (_, ink) in sized for b in ink)
    hmax = r0 if r0 > 0.5 * gall else gall
    k = 0.94 * unit / float(hmax)
    meta['rowsScale'] = round(k, 5)
    for name, ink in sized:
        # per-row ceiling: a row must not outgrow the body it is the same character
        # standing on.  Grim's generated roll ball came out taller than his idle pose,
        # and an un-corrected 152px boulder would visibly balloon the moment he rolled.
        hrow = max(b[3] - b[1] for b in ink)
        kr = min(k, 1.12 * unit / float(hrow))
        row = []
        wide = []
        sheet_px = sheet.load()
        for b in ink:
            groups = parts_of(mask, sw, b, sheet_px)
            if not groups:
                sys.exit('%s.%s: a cell lost all its ink' % (args.key, name))
            if groups[0][0] is None:
                # too flat to split: the whole cell is one baked tile
                box = groups[0][1]
                w0 = max(4, int(round((box[2] - box[0]) * kr)))
                h0 = max(4, int(round((box[3] - box[1]) * kr)))
                groups = [(sheet.crop(box).convert('RGBA').resize((w0, h0), Image.Resampling.LANCZOS), box)]
            body_img, body_box = groups[0]
            if len(groups) > 1:
                # an effect that reaches below the ground line is floor debris; the
                # stage paints over it, and atlascheck fails the frame for it
                fimg, fbox = groups[1]
                if fbox[3] > body_box[3]:
                    fimg = fimg.crop((0, 0, fimg.size[0], max(1, body_box[3] - fbox[1])))
                    groups[1] = (fimg, (fbox[0], fbox[1], fbox[2], body_box[3]))
            # one origin for both tiles: the support foot on the ground line
            ox = min(max(anchor_x(mask, sw, b), body_box[0] + 4.0), body_box[2] - 4.0)
            oy = body_box[3]
            ent = None
            for gi, (gimg, gbox) in enumerate(groups):
                cw = max(4, int(round((gbox[2] - gbox[0]) * kr)))
                chh = max(4, int(round((gbox[3] - gbox[1]) * kr)))
                cell = gimg.resize((cw, chh), Image.Resampling.LANCZOS)
                px = cell.load()
                ap = cell.split()[3]
                alp = ap.load()
                for yy in range(chh):
                    for xx in range(cw):
                        r, g, bl = px[xx, yy][:3]
                        # hard-key the magenta the resize pulled inside the silhouette
                        if r > 70 and bl > 70 and r > g + 26 and bl > g + 26:
                            alp[xx, yy] = 0
                cell.putalpha(ap)
                bb = ap.getbbox()
                if not bb:
                    sys.exit('%s.%s: a cell lost all its ink after keying' % (args.key, name))
                cell = cell.crop(bb)
                px_, py_ = packer.place(cell.size[0], cell.size[1])
                if py_ + cell.size[1] > atlas.size[1]:
                    canvas = Image.new('RGBA', (atlas.size[0], packer.h), (0, 0, 0, 0))
                    canvas.paste(atlas, (0, 0))
                    atlas = canvas
                    aw, ah = atlas.size
                    meta['atlas'] = [aw, ah]
                atlas.paste(cell, (px_, py_), cell.split()[3])
                idx = len(tiles)
                tiles.append({'x': px_, 'y': py_, 'w': cell.size[0], 'h': cell.size[1]})
                ax = round((ox - gbox[0]) * kr - bb[0], 1)
                ay = round((oy - gbox[1]) * kr - bb[1], 1)
                if gi == 0:
                    ent = [idx, ax, ay]
                    crops.append((name, cell, px_, py_))
                    wide.append(cell.size[0] / float(max(1, cell.size[1])))
                else:
                    ent.append([[idx, ax, ay]])         # the baked-VFX overlay layer
                    added += 1
            added += 1
            row.append(ent)
        meta['anims'][name] = row
        if max(wide) > 2.15:
            notes.append('  !! %-11s widest frame is %.2fx its height — Sprites.usable() may '
                         'reject it for hitboxes (attack rows only)' % (name, max(wide)))
        notes.append('  %-11s %d cells, %dpx tall in the atlas (unit %.0f)' %
                     (name, len(row), max(t['h'] for t in tiles[-len(row):]), unit))
    inj = meta.setdefault('injected', {})
    inj['rows'] = sorted(set(inj.get('rows', [])) | set(rows))
    inj['sheet'] = os.path.relpath(args.sheet, PROJ)

    if args.preview:
        pad = 10
        tall = sum(max(c[1].size[1] for c in crops if c[0] == n) for n in rows) + pad * (len(rows) + 1)
        wide = max(sum(c[1].size[0] for c in crops if c[0] == n) + pad * (len([c for c in crops if c[0] == n]) + 1)
                   for n in rows)
        prev = Image.new('RGBA', (int(wide), int(tall)), (30, 30, 44, 255))
        y = pad
        for n in rows:
            x = pad
            for (nm, img, _, _) in [c for c in crops if c[0] == n]:
                prev.paste(img, (x, y), img)
                x += img.size[0] + pad
            y += max(c[1].size[1] for c in crops if c[0] == n) + pad
        prev.save(args.preview)
        print('  preview -> %s' % args.preview)
        # the same rows against the real atlas art, at the same scale, on a deck line
        S = 3
        j0 = json.load(open(bk_jsn if os.path.exists(bk_jsn) else jsn))
        t0 = j0['tiles']
        ref = Image.open(bk_png if os.path.exists(bk_png) else png).convert('RGBA')
        old = []
        for n in rows:
            for e in (j0['anims'].get(n) or [])[:4]:
                t = t0[e[0]]
                old.append((n, ref.crop((t['x'], t['y'], t['x'] + t['w'], t['y'] + t['h']))))
        old_rows = sorted(set(n for (n, _) in old))
        if old and old_rows:
            wide = max(sum(c[1].size[0] * S for c in old if c[0] == n) + 40 for n in old_rows)
            tall = sum(max(c[1].size[1] for c in old if c[0] == n) * S + 40 for n in old_rows) + 20
            comp = Image.new('RGBA', (int(wide), int(tall)), (16, 16, 24, 255))
            y = 10
            for n in old_rows:
                x = 10
                for (nm, img) in [c for c in old if c[0] == n]:
                    big = img.resize((img.size[0] * S, img.size[1] * S), Image.Resampling.NEAREST)
                    comp.paste(big, (x, y + (max(c[1].size[1] for c in old if c[0] == n) * S - big.size[1])), big)
                    x += big.size[0] + 12
                y += max(c[1].size[1] for c in old if c[0] == n) * S + 40
            comp.save(args.preview.replace('.png', '-old.png'))
            print('  old rows -> %s' % args.preview.replace('.png', '-old.png'))

    print('\n'.join(notes))
    if args.dry:
        print('%s: %d tiles for %s (dry run, nothing written)' % (args.key, added, ','.join(rows)))
        return 0

    atlas.save(png)
    with open(jsn, 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    print('%s: +%d tiles (atlas now %dx%d%s), rows %s' %
          (args.key, added, aw, ah,
           '' if (aw, ah) == (atlas_orig[0], atlas_orig[1]) else ', canvas grew from %dx%d' % atlas_orig,
           ', '.join('%s[%d]' % (n, len(meta['anims'][n])) for n in rows)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
