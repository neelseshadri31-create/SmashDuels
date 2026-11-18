#!/usr/bin/env python3
"""
Rift Rumble roster slicer  —  concept sheets -> animation atlases
================================================================

Reads the labelled sheets in ``SmashDuels/roster/*_spritesheet.png`` and writes
atlases the game draws from directly:

    game/assets/atlas/<key>.png    packed RGBA tiles (sheet background keyed out)
    game/assets/atlas/<key>.json   animations -> tiles, anchors, fx overlays

Pipeline
--------
1. Threshold the noisy near-black sheet to an "ink" mask, take connected
   components: sprites, baked VFX (crescents, dust, sparkles) and label text.
2. Assign every non-text component to an animation window.  All five sheets use
   one authored template so the rows sit at stable normalised positions (see
   WINDOWS); a component goes to the window it overlaps most, which stops a
   big overshooting sprite (Grim) reading as its neighbour's frame.
3. Inside a window: split into rows (wrapped animations use 2-3 rows), tell
   bodies (tall/large) from decoration, fit the uniform cell pitch through the
   body centres, then emit one frame per cell.  Cells past the last body become
   "held" frames - the fighter keeps its pose while its projectile flies - so a
   frame is never just a crescent.
4. Key out the background per component by flood-filling inwards from the crop
   border, so dark outline pixels *inside* a sprite survive (a flat luminance
   key would erase them and wash the art out).
5. Anchor every frame at (cell centre x, row baseline y).  That, plus reusing
   one tile per source component, is what removes the jitter the old
   6-frame-per-fighter sheets had.
6. Reactions the sheets never drew (hurt, launch, KO, shield-break, grabbed,
   grab, throw, air-dodge, shield, crouch, get-up, down, respawn) are derived
   from each fighter's own frames with a rotate/shear/flash pass.

    python3 tools/slice_roster.py --report      audit the recovered structure
    python3 tools/slice_roster.py --montage     contact sheet per fighter
    python3 tools/slice_roster.py               write atlases + meta
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
ROSTER_DIR = os.path.join(PROJ, 'roster')
OUT_DIR = os.path.join(PROJ, 'game', 'assets', 'atlas')

TEXT_H = 0.030        # component this short is sheet text, not a sprite
MIN_AREA = 12         # ignore speckle
BODY_H = 0.62         # fraction of a row's tallest comp still counted as a body
BODY_A = 0.55         # … or fraction of its biggest area
MAX_TRAIL = 3         # held frames a row may grow when VFX flies past the body
PAD = 2               # atlas gutter
ATLAS_W = 1024        # pack width
COMPOSE_R = 200       # half-size of the frame-composition canvas

# lane x ranges (fraction of sheet width)
LANE_X = [(0.0, 0.44), (0.44, 0.675), (0.675, 1.0)]

# (names, y0, y1, sub-label anchors) per lane, in sheet reading order.  A row
# with several names is split on the anchors; ``None`` = section we ignore.
WINDOWS = [
    [
        # the swatch strip under "COLOR PALETTES" is not animation — palettes are
        # tinted from the atlas in the renderer, so the row is skipped
        ((None,), 0.000, 0.100, None),
        (('idle',), 0.100, 0.205, None),
        (('walk',), 0.205, 0.298, None),
        (('run',), 0.298, 0.394, None),
        (('jump',), 0.394, 0.499, None),
        (('fall',), 0.499, 0.594, None),
        (('land',), 0.594, 0.678, None),
        (('dash', 'spotdodge', 'rollfwd', 'rollback'), 0.678, 0.782,
         (0.013, 0.140, 0.245, 0.330)),
        (('taunt1', 'taunt2', 'taunt3'), 0.782, 0.990, (0.013, 0.150, 0.280)),
    ],
    [
        (('jab',), 0.030, 0.135, None),
        (('utilt',), 0.135, 0.225, None),
        (('stilt',), 0.225, 0.292, None),
        (('dtilt',), 0.292, 0.388, None),
        (('nair',), 0.388, 0.470, None),
        (('fair',), 0.470, 0.535, None),
        (('bair',), 0.535, 0.600, None),
        (('uair',), 0.600, 0.668, None),
        (('dair',), 0.668, 0.800, None),
        ((None,), 0.800, 1.000, None),
    ],
    [
        ((None,), 0.000, 0.135, None),
        (('usmash',), 0.135, 0.228, None),
        (('ssmash',), 0.228, 0.295, None),
        (('dsmash',), 0.295, 0.388, None),
        (('nspecial',), 0.388, 0.490, None),
        (('sspecial',), 0.490, 0.578, None),
        (('uspecial',), 0.578, 0.683, None),
        (('dspecial',), 0.683, 0.800, None),
        ((None,), 0.800, 1.000, None),
    ],
]

# reaction states that the sheets never drew:
# anim -> [(source anim, frame fraction, lean rad, scaleX, scaleY, dx, dy, flash)]
DERIVE = {
    'hurt': [('land', 0.12, -0.16, 0.98, 1.04, -4, 0, 1.00),
             ('land', 0.50, -0.34, 0.93, 1.08, -9, -3, 0.50),
             ('land', 0.85, -0.24, 0.97, 1.02, -6, -1, 0.00),
             ('land', 0.65, -0.09, 1.01, 1.00, -2, 0, 0.00)],
    'launch': [('fall', 0.30, -0.55, 0.96, 1.05, -7, -6, 0.80),
               ('fall', 0.70, -1.05, 1.03, 0.97, -4, -14, 0.15),
               ('fall', 1.00, -1.65, 1.06, 0.94, 0, -18, 0.00),
               ('fall', 1.00, -2.25, 1.04, 0.96, 2, -14, 0.00)],
    'ko': [('fall', 0.80, -1.35, 1.06, 0.94, 0, -22, 0.70),
           ('fall', 1.00, -2.30, 1.12, 0.86, 4, -12, 0.00),
           ('fall', 1.00, -3.10, 1.16, 0.80, 8, -3, 0.00)],
    'shieldbreak': [('idle', 0.00, -0.42, 0.95, 1.06, -8, -2, 0.90),
                    ('land', 0.60, -0.24, 0.94, 1.08, -11, 0, 0.25)],
    'grabbed': [('idle', 0.40, 0.12, 0.98, 1.04, 3, 0, 0.35),
                ('fall', 0.80, 0.22, 0.95, 1.02, 6, -3, 0.00)],
    'grab': [('idle', 0.50, 0.05, 1.03, 0.99, 6, 0, 0.00),
             ('idle', 0.85, 0.02, 1.07, 0.97, 11, -1, 0.00)],
    'throw': [('land', 0.60, 0.14, 1.12, 0.94, 14, -4, 0.00),
              ('idle', 0.60, -0.06, 1.03, 1.00, 7, 0, 0.00)],
    'airdodge': [('jump', 0.60, -0.65, 1.07, 0.93, 0, -7, 0.30),
                 ('fall', 0.40, -0.95, 1.12, 0.90, 0, -9, 0.00)],
    'shield': [('idle', 0.00, 0.00, 1.00, 1.00, -2, 0, 0.00),
               ('idle', 0.35, -0.06, 0.99, 1.01, -4, 0, 0.00)],
    'crouch': [('land', 0.45, 0.02, 1.02, 0.90, 0, 0, 0.00),
               ('land', 0.80, 0.02, 1.04, 0.87, 0, 0, 0.00)],
    'down': [('land', 1.00, -2.70, 1.18, 0.70, 6, 4, 0.00),
             ('land', 1.00, -1.60, 1.10, 0.86, 2, -2, 0.00)],
    'getup': [('land', 0.35, -0.35, 1.02, 1.04, 0, -2, 0.20),
              ('land', 0.10, -0.06, 1.00, 1.01, 0, 0, 0.00)],
    'respawn': [('idle', 0.20, 0.00, 1.00, 1.00, 0, 0, 0.55)],
}


# ---------------------------------------------------------------- components
def components(lum, bg, H):
    """Connected components of the ink mask, text split off."""
    ink = lum > bg + 18
    lab, _ = ndimage.label(ink, structure=np.ones((3, 3)))
    sprites, allc = [], []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        if sl is None:
            continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        area = int((lab[y0:y1, x0:x1] == (i + 1)).sum())
        if area < MIN_AREA:
            continue
        # sheet furniture: 1-3px rules and brackets between rows are never art
        if min(x1 - x0, y1 - y0) <= 3 and max(x1 - x0, y1 - y0) > 8 * max(1, min(x1 - x0, y1 - y0)):
            continue
        c = {'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1, 'w': x1 - x0, 'h': y1 - y0,
             'area': area, 'lab': i + 1,
             'cx': (x0 + x1) / 2.0, 'cy': (y0 + y1) / 2.0}
        allc.append(c)
        if c['h'] > H * TEXT_H:
            sprites.append(c)
    return sprites, allc, lab


def assign_windows(sprites, H, W, lane):
    """Bucket components into this lane's animation windows."""
    a0, a1 = LANE_X[lane]
    in_lane = [c for c in sprites if a0 * W <= c['cx'] < a1 * W]
    out = {i: [] for i in range(len(WINDOWS[lane]))}
    for c in in_lane:
        cy0, cy1 = c['y0'] / H, c['y1'] / H
        best, bo = None, 0.0
        for i, (_names, w0, w1, _anch) in enumerate(WINDOWS[lane]):
            ov = min(cy1, w1) - max(cy0, w0)
            if ov <= 0:
                continue
            sc = ov / max(1e-3, cy1 - cy0)
            if sc > bo:
                best, bo = i, sc
        if best is not None:
            out[best].append(c)
    return out


def rows_of(items, H):
    """Split a window into rows (a wrapped animation occupies 2-3)."""
    rows = []
    for it in sorted(items, key=lambda c: c['y0']):
        placed = False
        for r in rows:
            ov = min(it['y1'], r['y1']) - max(it['y0'], r['y0'])
            if ov > 0.4 * min(it['h'], r['y1'] - r['y0']):
                r['y0'] = min(r['y0'], it['y0'])
                r['y1'] = max(r['y1'], it['y1'])
                r['items'].append(it)
                placed = True
                break
        if not placed:
            rows.append({'y0': it['y0'], 'y1': it['y1'], 'items': [it]})
    rows.sort(key=lambda r: (r['y0'], r['items'][0]['x0']))
    for r in rows:
        r['items'].sort(key=lambda c: c['x0'])
    return rows


def frame_pitch(sprites, H, W):
    """Frame-to-frame spacing on this sheet, measured on lane 0's long rows.

    Lane 0 (idle/walk/run/jump/fall/land) is drawn one pose per cell with no
    overlapping VFX, so the distance between neighbouring poses is the cell
    pitch — the ruler for deciding when a row blob swallowed two poses."""
    x0, x1 = LANE_X[0]
    row = sorted([c for c in sprites if x0 * W <= c['cx'] <= x1 * W],
                 key=lambda c: (round(c['cy'] / 12), c['cx']))
    gaps, cur = [], []
    for c in row:
        if cur and abs(c['cy'] - cur[-1]['cy']) > 14:
            if len(cur) >= 3:
                gaps.extend(np.diff([g['cx'] for g in cur]))
            cur = []
        cur.append(c)
    if len(cur) >= 3:
        gaps.extend(np.diff([g['cx'] for g in cur]))
    gaps = [g for g in gaps if g > 8]
    return float(np.median(gaps)) if len(gaps) >= 4 else 0.0


def split_merged(comp, lab, unit_w):
    """Break a row blob whose frames were drawn touching into frames.

    Some rows (Astra's nair, most crescent-heavy smashes) are authored so the
    VFX bridges every pose into ONE connected component, which would otherwise
    read as a single frame.  Cut on the emptiest column near each expected seam,
    then keep the split only if every piece looks like a whole drawing: ink that
    runs full-height against a cut edge means we sliced through a figure, so the
    blob is left alone and that animation simply has fewer frames.
    """
    if lab is None or unit_w <= 0:
        return [comp]
    w = comp['w']
    if w < 1.45 * unit_w:
        return [comp]
    n = int(round(w / unit_w))
    if n < 2:
        return [comp]
    x0, y0, x1, y1 = comp['x0'], comp['y0'], comp['x1'], comp['y1']
    own = lab[y0:y1, x0:x1] == comp['lab']
    col = own.sum(0)
    cuts = [0]
    for k in range(1, n):
        want = int(round(k * w / n))
        span = max(1, int(round(unit_w * 0.34)))
        lo, hi = max(1, want - span), min(w - 1, want + span)
        cuts.append(lo + int(np.argmin(col[lo:hi])) if hi > lo else want)
    cuts.append(w)
    # only trust a cut where the ink actually thins out around the seam
    for c in cuts[1:-1]:
        lo, hi = max(0, c - 16), min(len(col), c + 17)
        win = col[lo:hi]
        if not len(win) or col[c] > 0.62 * float(win.max()) + 1.0:
            return [comp]
    pieces = []
    for a, b in zip(cuts[:-1], cuts[1:]):
        if b - a < 6:
            return [comp]
        sl = own[:, a:b]
        ys, xs = np.where(sl)
        if len(ys) < 12:
            return [comp]
        sy0, sy1 = int(ys.min()), int(ys.max()) + 1
        sx0, sx1 = int(xs.min()), int(xs.max()) + 1
        prof = sl[sy0:sy1, sx0:sx1].sum(0)       # columns of the tight piece
        # a pose sliced in half leaves a wall of ink against the cut, while a
        # real seam ends on a tapered edge (a crescent tip, a trailing robe)
        edge = max(int(prof[:2].max()), int(prof[-2:].max()))
        if edge > 0.66 * int(prof.max()) + 1:
            return [comp]
        pieces.append((x0 + a + sx0, y0 + sy0, x0 + a + sx1, y0 + sy1, int(len(ys))))
    hs = [c[3] - c[1] for c in pieces]
    areas = [c[4] for c in pieces]
    if min(hs) < 0.45 * max(hs) or min(areas) < 0.25 * max(areas):
        return [comp]
    return [{'x0': px0, 'y0': py0, 'x1': px1, 'y1': py1,
             'w': px1 - px0, 'h': py1 - py0, 'area': area,
             'lab': comp['lab'], 'cx': (px0 + px1) / 2.0, 'cy': comp['cy'],
             'merged': True}
            for (px0, py0, px1, py1, area) in pieces]


def unit_width(sprites):
    """Median width of a single pose on this sheet — fallback ruler for split_merged."""
    solo = [c['w'] for c in sprites if c['h'] >= 18 and c['w'] <= 1.6 * c['h']]
    return float(np.median(solo)) if solo else 0.0


def frames_of_row(items, H, W, unit_w=0.0, lab=None):
    """Bodies define the cell grid; VFX rides along in the nearest cell."""
    if not items:
        return []
    items = [c for it in items for c in split_merged(it, lab, unit_w)]
    hmax = max(c['h'] for c in items)
    amax = max(c['area'] for c in items)
    bodies = [c for c in items if c['h'] >= hmax * BODY_H or c['area'] >= amax * BODY_A]
    fx = [c for c in items if c not in bodies]
    if not bodies:
        bodies, fx = list(items), []
    bodies.sort(key=lambda c: c['cx'])
    # frames sit in uniform cells; the pitch is the median body spacing but it
    # must never be smaller than a body, or two poses collapse into one cell
    med_w = float(np.median([b['w'] for b in bodies]))
    pitch = med_w * 1.15
    if len(bodies) > 1:
        d = np.diff([b['cx'] for b in bodies])
        d = d[d > med_w * 0.5]
        if len(d):
            pitch = max(float(np.median(d)), med_w * 1.02)
    slot = lambda cx: int(round((cx - bodies[0]['cx']) / pitch))
    # least-squares-ish fit of the cell grid: x_k = origin + k * pitch
    origin = float(np.median([b['cx'] - slot(b['cx']) * pitch for b in bodies]))
    first = min(slot(b['cx']) for b in bodies)
    last = max(slot(b['cx']) for b in bodies)
    base = max(c['y1'] for c in items)
    cells = {}
    for b in bodies:
        cells.setdefault(slot(b['cx']), {'bodies': [], 'fx': []})['bodies'].append(b)
    for f in fx:
        s = min(max(slot(f['cx']), first), last)   # never invent a cell for dust
        cells.setdefault(s, {'bodies': [], 'fx': []})['fx'].append(f)
    # trailing VFX (a projectile flying away) may open up to MAX_TRAIL held cells
    far = sorted({slot(f['cx']) for f in fx if last < slot(f['cx']) <= last + MAX_TRAIL})
    out, last_pose = [], None
    for s in list(range(first, last + 1)) + far:
        cell = cells.get(s)
        if not cell:
            continue
        if cell['bodies']:
            body = max(cell['bodies'], key=lambda c: c['area'])
            held, body_ax = False, origin + s * pitch
            # A second "body" in the same cell is the same pose's weapon or a
            # piece its glow pushed over the size threshold.  It used to be
            # dropped, which is why some attack frames came out as a lone
            # crescent; keep it as an overlay of this frame instead.
            extras = [c for c in cell['bodies'] if c is not body]
            cell_fx = extras + cell['fx']
        else:
            cell_fx = cell['fx']
            if last_pose is None:
                continue
            body, held, body_ax = last_pose['body'], True, last_pose['bodyAx']
        last_pose = {'body': body, 'fx': cell_fx, 'held': held,
                     'ax': origin + s * pitch, 'bodyAx': body_ax, 'ay': base}
        out.append(last_pose)
    return out


def subsplit(items, anchors, W):
    """Split a shared row on its sub-label anchors (dash | spotdodge | roll…)."""
    out = [[] for _ in anchors]
    for c in sorted(items, key=lambda c: c['x0']):
        k = 0
        for i, a in enumerate(anchors):
            if c['cx'] / W + 0.006 >= a:
                k = i
        out[k].append(c)
    return out


def extract(lum, bg, lab, sprites, H, W, report):
    """Recover the animation table: name -> frames."""
    frames = {}
    unit_w = frame_pitch(sprites, H, W) or unit_width(sprites)
    report.append('   frame pitch %.1f px' % unit_w)
    for lane in range(3):
        buckets = assign_windows(sprites, H, W, lane)
        for i, (names, w0, w1, anchors) in enumerate(WINDOWS[lane]):
            items = buckets[i]
            if names[0] is None:
                if items:
                    report.append('   skip  lane%d y%.3f comps=%2d (palette/VFX strip)'
                                  % (lane, w0, len(items)))
                continue
            if not items:
                report.append('   MISS  %-10s lane%d y%.3f (no sprites)'
                              % (names[0], lane, w0))
                continue
            groups = ([list(t) for t in zip(names, subsplit(items, anchors, W))]
                      if anchors else [(names[0], items)])
            for nm, part in groups:
                if not part:
                    report.append('   MISS  %-10s (empty group)' % nm)
                    continue
                fl = []
                for r in rows_of(part, H):
                    fl.extend(frames_of_row(r['items'], H, W, unit_w, lab))
                frames[nm] = fl
                held = sum(1 for f in fl if f['held'])
                report.append('   %-10s lane%d y%.3f comps=%3d -> %2d frames%s'
                              % (nm, lane, w0, len(part), len(fl),
                                 '  (%d held)' % held if held else ''))
    return frames


# ------------------------------------------------------------ background key
def key_tile(arr, lab, comp, bg):
    """Crop one component and make the sheet background transparent.

    The sheet is flat grey noise with a dithered texture, so a plain luminance
    key eats dark outlines and translucent motion blur.  Instead: keep every
    pixel of the component, plus anything it encloses (fill holes -> dark
    interiors), plus anything that carries colour *and touches the sprite* — the
    art is tinted, the background is not, and the crop box of a pose also frames
    the row's caption, which a plain brightness key used to paste into the tile.
    """
    H, W = lab.shape
    x0, y0 = max(0, comp['x0'] - 1), max(0, comp['y0'] - 1)
    x1, y1 = min(W, comp['x1'] + 1), min(H, comp['y1'] + 1)
    sub = arr[y0:y1, x0:x1, :3].astype(np.int16)
    lum = sub.max(2)
    sat = sub.max(2) - sub.min(2)
    own = lab[y0:y1, x0:x1] == comp['lab']
    # Fill only the SMALL enclosed gaps: those are shaded interiors (the
    # inside of a cloak, an eye, a hilt).  A pose whose limbs outline a big
    # pocket of background would otherwise ship a slab of flat grey inside the
    # tile — a floating rectangle once it is drawn over the stage.
    holes = ndimage.binary_fill_holes(own) & ~own
    hl, hn = ndimage.label(holes, structure=np.ones((3, 3)))
    if hn:
        sizes = np.asarray(ndimage.sum(holes, hl, np.arange(1, hn + 1)))
        limit = max(24.0, 0.20 * max(1, int(own.sum())))
        body = own | np.isin(hl, np.nonzero(sizes <= limit)[0] + 1)
    else:
        body = own
    if comp.get('merged'):
        # a slice of a joined blob: only its own pixels, or the cut would drag
        # the neighbouring frame's art in with it
        opaque = body
    else:
        # bright pixels join the tile only within a couple of px of the sprite:
        # that keeps anti-aliased edges and motion blur, and refuses the row
        # caption ("K.O.", "TAUNT 1") that shares the crop box.
        bright = (sat >= 6) & (lum > bg + 6)
        skirt = ndimage.binary_dilation(body, iterations=2) & ~body
        opaque = body | (bright & skirt)
    ys, xs = np.where(opaque)
    if len(xs) < 5:
        return None
    by0, by1, bx0, bx1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
    a = np.zeros(opaque.shape, dtype=np.uint8)
    a[opaque] = 255
    ring = ndimage.binary_dilation(opaque) & ~opaque      # 1px soft edge
    a[ring] = 110
    rgb = arr[y0 + by0:y0 + by1, x0 + bx0:x0 + bx1, :3].astype(np.uint8)
    tile = Image.fromarray(np.dstack([rgb, a[by0:by1, bx0:bx1]]), 'RGBA')
    return {'img': tile, 'w': tile.width, 'h': tile.height,
            'tx0': x0 + bx0, 'ty0': y0 + by0}


# ------------------------------------------------------------- frame compose
class Packer:
    """Unique tiles -> atlas rectangles."""

    def __init__(self):
        self.tiles = []          # {'img', 'tx0', 'ty0', 'w', 'h'}
        self.seen = {}
        self.baked = 0

    def add(self, comp_tile):
        self.tiles.append(comp_tile)
        self.baked += 1
        return len(self.tiles) - 1

    def for_comp(self, key, comp_tile):
        if key in self.seen:
            return self.seen[key]
        i = len(self.tiles)
        self.tiles.append(comp_tile)
        self.seen[key] = i
        return i

    def pack(self):
        meta, x, y, rowh = [], 0, 0, 0
        for t in self.tiles:
            if x and x + t['w'] + PAD * 2 > ATLAS_W:
                x, y = 0, y + rowh + PAD
                rowh = 0
            meta.append({'x': x, 'y': y, 'w': t['w'], 'h': t['h']})
            x += t['w'] + PAD * 2
            rowh = max(rowh, t['h'])
        Wc = max([m['x'] + m['w'] for m in meta], default=64) + PAD
        canvas = Image.new('RGBA', (int(Wc), int(y + rowh + PAD)), (0, 0, 0, 0))
        for m, t in zip(meta, self.tiles):
            canvas.paste(t['img'], (m['x'], m['y']), t['img'])
        return canvas, meta


def tile_id(packer, comp):
    """One atlas tile per distinct sheet component (dedup by bbox)."""
    key = (comp['x0'], comp['y0'], comp['x1'], comp['y1'])
    if key in packer.seen:
        return packer.seen[key]
    t = comp.get('_tile')
    if t is None:
        return None
    i = packer.add(dict(t))
    packer.seen[key] = i
    return i


def compose_frame(packer, f, R=COMPOSE_R):
    """Render one frame (body + its VFX) into a canvas with its anchor at R,R."""
    bid = tile_id(packer, f['body'])
    if bid is None:
        return None
    canvas = Image.new('RGBA', (R * 2, R * 2), (0, 0, 0, 0))
    t = packer.tiles[bid]
    bax = f.get('bodyAx', f['ax'])
    canvas.alpha_composite(t['img'], (int(round(R + t['tx0'] - bax)),
                                      int(round(R + t['ty0'] - f['ay']))))
    for e in f['fx']:
        eid = tile_id(packer, e)
        if eid is None:
            continue
        et = packer.tiles[eid]
        canvas.alpha_composite(et['img'], (int(round(R + et['tx0'] - f['ax'])),
                                           int(round(R + et['ty0'] - f['ay']))))
    return canvas


def build_frames(packer, frames):
    """Source animations -> meta entries: [tile, ax, ay] + optional fx/flags."""
    anims = {}
    for name in sorted(frames):
        fl = []
        for f in frames[name]:
            bid = tile_id(packer, f['body'])
            if bid is None:
                continue
            bt = packer.tiles[bid]
            bax = f.get('bodyAx', f['ax'])
            ent = [bid, round(bax - bt['tx0'], 1), round(f['ay'] - bt['ty0'], 1)]
            fx = []
            for e in f['fx']:
                eid = tile_id(packer, e)
                if eid is None:
                    continue
                et = packer.tiles[eid]
                fx.append([eid, round(f['ax'] - et['tx0'], 1),
                           round(f['ay'] - et['ty0'], 1)])
            ent.append(fx)
            fl.append(ent)
        if fl:
            anims[name] = fl
    return anims


def build_derived(packer, frames, R=COMPOSE_R):
    """Bake the reaction animations into fresh atlas tiles."""
    anims = {}
    for name, spec in DERIVE.items():
        fl = []
        for (src, frac, rot, sx, sy, dx, dy, flash) in spec:
            pool = frames.get(src) or frames.get('idle')
            if not pool:
                continue
            i = min(len(pool) - 1, int(round(frac * (len(pool) - 1))))
            img = compose_frame(packer, pool[i])
            if img is None:
                continue
            ax, ay = float(R), float(R)
            if (sx, sy) != (1.0, 1.0):
                w, h = max(1, int(round(img.width * sx))), max(1, int(round(img.height * sy)))
                img = img.resize((w, h), Image.NEAREST)
                ax, ay = ax * sx, ay * sy        # the whole canvas was rescaled
            ax, ay = ax + dx, ay + dy
            if abs(rot) > 1e-3:
                img = img.rotate(math.degrees(rot), resample=Image.NEAREST,
                                 center=(ax, ay))
            if flash > 0:
                # a hit flash has to stay readable: blend the ink toward white
                # instead of whitening it out, or the frame is a white cut-out
                a = np.array(img).astype(np.float32)
                m = a[..., 3] > 0
                k = 0.32 * min(1.0, flash)
                a[..., :3] = a[..., :3] * (1 - k) + 255.0 * k
                a[..., :3] = np.where(m[..., None], a[..., :3], 0)
                img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')
            bb = img.getbbox()
            if not bb:
                continue
            img = img.crop(bb)
            ax, ay = ax - bb[0], ay - bb[1]
            tid = packer.add({'img': img, 'w': img.width, 'h': img.height,
                              'tx0': 0, 'ty0': 0})
            fl.append([tid, round(ax, 1), round(ay, 1), []])
        if fl:
            anims[name] = fl
    return anims


def prep_tiles(arr, lab, bg, sprites, frames=None):
    """Key every sprite component once and stash the tile on the component.

    The merged-row splitter invents sub-components that are not in ``sprites``,
    so every body/VFX referenced by the animation table is keyed too — anything
    left unkeyed silently loses its frame at pack time."""
    keyed = 0
    for c in sprites:
        c['_tile'] = key_tile(arr, lab, c, bg)
        keyed += 1
    if frames:
        for fl in frames.values():
            for f in fl:
                for c in [f['body']] + list(f['fx']):
                    if '_tile' not in c:
                        c['_tile'] = key_tile(arr, lab, c, bg)
                        keyed += 1
    return keyed


# --------------------------------------------------------------------- main
def run(path, args):
    key = os.path.basename(path).split('_the_')[0]
    arr = np.array(Image.open(path).convert('RGB')).astype(np.int16)
    H, W = arr.shape[:2]
    lum = arr[..., :3].max(2).astype(np.int16)
    vals, cnt = np.unique(lum[lum < 90], return_counts=True)
    bg = int(sorted(zip(cnt, vals), key=lambda t: -t[0])[0][1]) if len(vals) else 8
    sprites, allc, lab = components(lum, bg, H)
    report = ['== %s  %dx%d  bg=%d  comps=%d  sprites=%d'
              % (key, W, H, bg, len(allc), len(sprites))]
    _ = report
    frames = extract(lum, bg, lab, sprites, H, W, report)
    total = sum(len(v) for v in frames.values())
    report.append('   TOTAL %d frames across %d animations' % (total, len(frames)))
    print('\n'.join(report))
    if args.report:
        return
    nkeyed = prep_tiles(arr, lab, bg, sprites, frames)
    packer = Packer()
    anims = build_frames(packer, frames)
    derived = build_derived(packer, frames)
    if args.montage:
        montage(packer, anims, derived, key)
        return
    canvas, tmeta = packer.pack()
    for m in tmeta:
        m.pop('img', None)
    ref = frames.get('idle') or []
    ref_h = max([f['body']['h'] for f in ref], default=64)
    meta = {'key': key, 'atlas': [canvas.width, canvas.height],
            'tiles': [{k: v for k, v in m.items()} for m in tmeta],
            'anims': anims, 'derived': derived, 'refH': int(ref_h),
            'sheet': os.path.relpath(path, PROJ).replace('\\', '/'),
            'names': sorted(list(anims) + list(derived))}
    os.makedirs(OUT_DIR, exist_ok=True)
    canvas.save(os.path.join(OUT_DIR, key + '.png'), optimize=True)
    with open(os.path.join(OUT_DIR, key + '.json'), 'w') as fh:
        json.dump(meta, fh, separators=(',', ':'))
    kb = os.path.getsize(os.path.join(OUT_DIR, key + '.png')) // 1024
    print('   -> atlas/%s.png  %dx%d  %d tiles  %d anims (%d derived)  %d KB'
          % (key, canvas.width, canvas.height, len(tmeta), len(anims) + len(derived),
             len(derived), kb))


def montage(packer, anims, derived, key):
    """Contact sheet of every animation, composed from the shipped meta."""
    from PIL import ImageDraw
    R, BASE, STEP = 150, 190, 132
    rows = []
    for name in sorted(list(anims) + list(derived)):
        fl = anims.get(name) or derived.get(name) or []
        ims = []
        for ent in fl:
            canvas = Image.new('RGBA', (R * 2, BASE + R), (0, 0, 0, 0))
            parts = [(ent[0], ent[1], ent[2])] + [tuple(f) for f in (ent[3] if len(ent) > 3 else [])]
            for tid, ax, ay in parts:
                t = packer.tiles[tid]
                canvas.alpha_composite(t['img'], (int(round(R - ax)), int(round(BASE - ay))))
            ims.append(canvas)
        if not ims:
            continue
        w = STEP * len(ims) + 180
        row = Image.new('RGBA', (w, BASE + 12), (14, 14, 20, 255))
        d = ImageDraw.Draw(row)
        d.text((6, 4), '%s (%d)' % (name, len(ims)), fill=(120, 200, 255, 255))
        d.line([(0, BASE), (w, BASE)], fill=(45, 85, 125, 255))
        for i, im in enumerate(ims):
            row.alpha_composite(im, (180 + i * STEP - R, 0))
        rows.append(row)
    if not rows:
        print('   nothing to montage')
        return
    n = max(1, len(rows) // 9 + (1 if len(rows) % 9 else 0))
    chunks = np.array_split(np.arange(len(rows)), n)
    d0 = os.path.join(os.path.expanduser('~/scratch'))
    os.makedirs(d0, exist_ok=True)
    for ci, ch in enumerate(chunks):
        sub = [rows[i] for i in ch]
        Wc = max(r.width for r in sub)
        Hc = sum(r.height + 2 for r in sub)
        out = Image.new('RGBA', (Wc, Hc), (6, 6, 10, 255))
        y = 0
        for r in sub:
            out.alpha_composite(r, (0, y))
            y += r.height + 2
        p = os.path.join(d0, 'montage_%s_%d.png' % (key, ci))
        out.convert('RGB').save(p)
        print('   montage ->', p)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--report', action='store_true')
    ap.add_argument('--montage', action='store_true')
    ap.add_argument('--only', default=None)
    a = ap.parse_args()
    sheets = sorted(glob.glob(os.path.join(ROSTER_DIR, '*_spritesheet.png')))
    if a.only:
        sheets = [s for s in sheets if a.only in os.path.basename(s)]
    for s in sheets:
        run(s, a)
