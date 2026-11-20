#!/usr/bin/env node
/* ============================================================
   tools/atlas_geo.js — the geometry contract that lets a fighter be re-skinned
   ------------------------------------------------------------
   render.js gives the drawing a vote on both boxes: an attack's hitbox grows to
   cover the limb or crescent that paints past the resting silhouette, and the
   hurtbox follows the body.  That is the right rule for a sheet cut by hand and a
   dangerous one for a re-skin: new art means a new silhouette, so a longer sword,
   a wider cape or a bigger shockwave silently re-balances every move — and, the
   other way, a *narrower* resting pose can take a swing's extension away.

   So the extents are captured before the pixels move and carried in the atlas as
   `meta.geo` (hitbox extents, per frame, atlas px from the anchor) and `meta.geoBody`
   (the same row without baked VFX — the hurtbox).  The picture changes underneath
   them, the boxes do not.

     node tools/atlas_geo.js --capture                 # write tools/atlas-geo.json
     node tools/atlas_geo.js --apply --keys valor \
             --rows idle,run,walk,jump,fall,land       # stamp the contract into the atlas
     node tools/atlas_geo.js --check                   # every atlas still measures as the contract

   Run --capture while the atlases still hold the art you want pinned, --apply right
   before tools/slice_rows.py injects over it, and --check after.  --check failing on
   a row nobody re-skinned means the atlas lost tiles; on a row that was re-skinned it
   means the injection went in without its contract, which is a hitbox change.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { boot, GAME } = require('./harness');

const KEYS = ['valor', 'grim', 'astra', 'vesper', 'rook'];
const OUT = path.join(__dirname, 'atlas-geo.json');
const r1 = (v) => Math.round(v * 10) / 10;
const pack = (row) => (row || []).map((b) => (b ? b.map(r1) : null));

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
}
const has = (name) => process.argv.indexOf('--' + name) >= 0;

async function atlases() {
  const h = boot({ render: true });
  h.g.Sprites.load();
  await h.settle(14);                       // the same warm-up animtest.js uses
  const S = h.g.Sprites;
  const out = {};
  for (const key of KEYS) {
    const at = S.atlas(key);
    if (!at) throw new Error(`${key}: the atlas did not load — is the server path right?`);
    const rows = {};
    for (const name in at.anims) rows[name] = { box: pack(at.box[name]), body: pack(at.bodyBox[name]) };
    out[key] = { unit: r1(at.unit), scale: +at.scale.toFixed(5), rows };
  }
  return out;
}

(async () => {
  if (has('check')) {
    const want = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const now = await atlases();
    const bad = [];
    for (const key of KEYS) {
      for (const name in want[key].rows) {
        const a = want[key].rows[name], b = now[key].rows[name];
        if (!b) { bad.push(`${key}.${name}: the row is gone from the atlas`); continue; }
        ['box', 'body'].forEach((k) => {
          /* A re-skin does not have to keep the frame count — 8 idles over a 6-frame row
             is still the same blow — so the contract is sampled across whatever length the
             atlas now has, exactly the way render.js resamples meta.geo. */
          const m = a[k].length, n = b[k].length;
          const at = (arr, i) => arr[m === n ? i : Math.round(i * (m - 1) / Math.max(1, n - 1))];
          for (let i = 0; i < n; i++) {
            const f = at(a[k], i), g = b[k][i];
            if (!f !== !g) { bad.push(`${key}.${name}.${k}[${i}]: measured ${g ? 'a tile' : 'nothing'}, contract says ${f ? 'a tile' : 'nothing'}`); return; }
            if (f && f.some((v, j) => Math.abs(v - g[j]) > 0.25)) {
              bad.push(`${key}.${name}.${k}[${i}]: [${g}] is not the contract [${f}]`);
            }
          }
        });
      }
    }
    /* A row the atlas pins is measured from meta.geo, which was sampled from this same
       contract — that half is a tautology, and it is the half that lets the art change.
       What is not a tautology is every row the atlas does *not* name: those boxes come
       from the ink, so if any fighter's art moved without a contract behind it, the two
       sides stop agreeing and this reports it. */
    console.log(bad.length ? bad.join('\n') : `contract held: ${KEYS.length} fighters, ${Object.keys(want[KEYS[0]].rows).length} rows each measure as the art the contract was cut from`);
    process.exit(bad.length ? 1 : 0);
  }

  if (has('apply')) {
    const want = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const keys = (arg('keys', KEYS.join(','))).split(',');
    const rows = (arg('rows', '') || '').split(',').filter(Boolean);
    if (!rows.length) { console.error('apply: --rows is required (which rows are about to be replaced)'); process.exit(2); }
    for (const key of keys) {
      const file = path.join(GAME, 'assets/atlas', key + '.json');
      const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
      const geo = {}, geoBody = {};
      for (const name of rows) {
        const r = want[key].rows[name];
        if (!r) { console.error(`${key}.${name}: nothing in the contract — run --capture first`); process.exit(2); }
        geo[name] = r.box; geoBody[name] = r.body;
      }
      meta.geo = Object.assign(meta.geo || {}, geo);
      meta.geoBody = Object.assign(meta.geoBody || {}, geoBody);
      fs.writeFileSync(file, JSON.stringify(meta));
      console.log(`${key}: geometry of ${rows.length} row(s) pinned — ${rows.join(', ')}`);
    }
    process.exit(0);
  }

  const snap = await atlases();
  fs.writeFileSync(OUT, JSON.stringify({ captured: new Date().toISOString().slice(0, 10), keys: KEYS, ...snap }, null, 1));
  const n = Object.keys(snap).reduce((t, k) => t + Object.keys(snap[k].rows).length, 0);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} — ${Object.keys(snap).length} fighters, ${n} rows`);
  process.exit(0);
})().catch((e) => { console.error('atlas_geo:', e && e.stack || e); process.exit(1); });
