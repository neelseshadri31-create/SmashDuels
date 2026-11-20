/* ============================================================
   tools/film.js — write down what the animation layer actually draws
   ------------------------------------------------------------
   There is no browser in this sandbox (no chrome/chromium/playwright, and none
   installable), so "run it and look" is not available to me.  A headless test can
   prove invariants about an animation; it cannot tell you a jab *looks* like a
   jab.  This is the compromise, and it is the half that keeps the film honest:

     1. drive the real engine at a fixed 60 Hz tick through the real modules;
     2. on every tick, call the shipped Sprites.drawSpriteFighter against the
        recording canvas from tools/harness.js — so what gets written down is the
        actual drawImage list with the actual transform the renderer computed, plus
        the boxes Fighter.activeBoxes says are live and the hurtbox the engine
        tests them against, all in one world space;
     3. tools/film_render.py pastes the real atlas tiles through those matrices
        into per-tick cells and returns a contact sheet + an animated GIF per
        fighter.

   Nothing here reimplements the render or the hit maths.  Output: anim-films/.

     node tools/film.js                      every fighter, every row
     node tools/film.js valor                one fighter
     node tools/film.js valor jab fsmash     one fighter, two rows
     node tools/film.js --ticks=32
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { boot, cast, control, newMatch, makeCtx } = require('./harness');

const OUT = path.join(__dirname, '..', 'anim-films');
const KEYS = ['valor', 'grim', 'astra', 'vesper', 'rook'];
const MOVES = ['jab', 'ftilt', 'utilt', 'dtilt', 'dashattack', 'fsmash', 'usmash', 'dsmash',
  'nair', 'fair', 'bair', 'uair', 'dair'];

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const words = argv.filter((a) => !a.startsWith('--'));
const flag = (k, d) => { const a = flags.find((x) => x.startsWith('--' + k + '=')); return a ? Number(a.split('=')[1]) : d; };
const TICKS = flag('ticks', 26);
const CELL = [flag('cellw', 150), flag('cellh', 138)];
/* --hz=120 films the *drawn* frames, not the ticks: the panel runs faster than the
   60 Hz simulation, and whether a frame is a repeat of the one before it is the
   whole smoothness question.  --blend=0 turns Sprites.beginFrame off so you can
   watch the difference. */
const HZ = flag('hz', 60);
const SUBS = HZ > 60 ? Math.max(1, Math.round(HZ / 60)) : 1;
const BLEND = flag('blend', 1) ? 1 : 0;

/* ---------------- the scenes ----------------
   `warm` ticks establish a state (a run, a fall) before the film starts, `setup`
   pokes the engine directly.  Attacks are started through startAttack rather than
   the input buffer so the film shows the same move from tick 0 every time. */
function attack(kind, opts = {}) {
  return {
    ticks: opts.ticks || TICKS,
    foeX: opts.contact ? 300 + 66 : 1400,
    setup: (m, f, foe) => {
      if (opts.air) { f.onGround = false; f.y -= 70; f.vy = -2; f.state = 'fall'; }
      f.startAttack(kind, m);
      if (opts.charge) { f.charging = true; f.chargeT = 0; }
    },
    input: (t) => (opts.charge && t < 10 ? { attack: true } : {}),
  };
}
const SCENES = {
  idle: { ticks: TICKS },
  // A tap from a standstill is a dash by design, so the walk cycle is filmed with
  // the run deliberately left un-armed (that is the state after a turn-around, and
  // after any release-and-repress outside the tap window).
  walk: { ticks: TICKS, input: () => ({ left: true }), onTick: (t, f) => { f.runArmed = false; } },
  run: { ticks: TICKS, warm: 10, input: () => ({ right: true }) },
  dash: { ticks: 14, fresh: true, input: () => ({ right: true }) },
  pivot: { ticks: 16, warm: 22, warmInput: () => ({ right: true }), input: () => ({ left: true }) },
  crouch: { ticks: 12, input: () => ({ down: true }) },
  jump: { ticks: 16, input: (t) => (t === 0 ? { jump: true } : {}) },
  fall: { ticks: 16, setup: (m, f) => { f.onGround = false; f.y -= 190; f.vy = 1; }, input: () => ({ right: true }) },
  land: { ticks: 16, setup: (m, f) => { f.onGround = false; f.y -= 170; f.vy = 10; } },
  shield: { ticks: 14, input: () => ({ shield: true }) },
  roll: { ticks: 26, input: (t) => (t === 0 ? { shield: true, right: true } : { right: true }) },
  spotdodge: { ticks: 22, input: (t) => (t === 0 ? { down: true, shield: true } : { down: true }) },
  airdodge: {
    ticks: 24,
    setup: (m, f) => { f.onGround = false; f.y -= 150; f.vy = 0; f.state = 'fall'; },
    input: (t) => (t === 0 ? { shield: true, right: true } : {}),
  },
  hurt: { ticks: 16, setup: (m, f, foe) => m.hitFighter(foe, f, { damage: 24, bkb: 26, kbs: 60, angle: 75 }) },
  launch: { ticks: 22, setup: (m, f, foe) => m.hitFighter(foe, f, { damage: 130, bkb: 74, kbs: 90, angle: 58 }) },
  grabbed: { ticks: 16, setup: (m, f, foe) => { f.grabbedBy = foe; foe.grabbing = f; foe.facing = 1; } },
  shieldbreak: { ticks: 20, setup: (m, f) => { f.shieldHP = 0; f.stunT = 150; f.hitstun = 6; f.state = 'hitstun'; } },
  taunt1: { ticks: 16, setup: (m, f) => { f.state = 'taunt'; f.tauntIdx = 0; f.action = { type: 'taunt', dur: 40 }; f.actionT = 0; } },
  jabContact: attack('jab', { contact: true, ticks: 20 }),
  fsmashCharge: attack('fsmash', { charge: true, ticks: 34 }),
  fsmashContact: attack('fsmash', { contact: true, ticks: 26 }),
};
for (const mv of MOVES) SCENES[mv] = attack(mv, { air: mv.endsWith('air') });

/* ---------------- record one scene ---------------- */
function scene(h, name, spec, key) {
  const m = newMatch(h.ctx, cast(2, [key, 'grim']), 'skyshrine', { state: 'play' });
  control(m).tick(2);
  const [me, foe] = m.fighters;
  const ground = m.stage.ground.y;
  const place = (f, x) => {
    f.x = x; f.y = ground; f.vx = 0; f.vy = 0; f.onGround = true; f.onPlatform = null;
    f.hitstun = 0; f.hitlag = 0; f.shieldHP = 0; f.stunT = 0; f.grabbedBy = null; f.held = null;
    f.invincT = 0; f.spawnProtect = 0; f.facing = x < (spec.foeX || 1400) ? 1 : -1;
  };
  place(me, 300); place(foe, spec.foeX || 1400);
  me.animT = 0; foe.animT = 0;
  const rec = { ops: [], stack: [] };
  const ctx = makeCtx(rec);
  const S = h.g.Sprites;

  const feed = (i, src) => m.fighters.forEach((f, k) => { f.__raw = k === 0 ? (src(i, f, foe, m) || {}) : {}; });
  for (let i = 0; i < (spec.warm || 0); i++) feed(i, spec.warmInput || spec.input || (() => ({})));
  if (spec.fresh) { me.dirTapT = {}; me.dashT = 0; me.turnT = 0; me.runArmed = false; me.vx = 0; me.state = 'idle'; me.animT = 0; }
  if (spec.setup) spec.setup(m, me, foe);

  const frames = [];
  const n = spec.ticks || TICKS;

  /* One drawn frame.  `alpha` is the fraction of the *next* tick this frame is
     rendered at, exactly as Game.loop computes it from the fixed-step leftover;
     0 means "draw the tick", which is what a 60 Hz panel gets. */
  const oneFrame = (alpha, clock) => {
    const undo = S.beginFrame ? S.beginFrame(m, alpha) : null;
    rec.ops.length = 0;
    /* the harness canvas starts at a borrowed alpha; the real render pass draws
       fighters opaque, so match that before recording (a fighter's own blink sets
       its alpha inside, and that we do want to capture) */
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const drew = S.drawSpriteFighter(ctx, me, clock);
    const sel = S.pickAnim(me, 0);
    if (undo) undo();
    const hurt = me.hurtbox;
    frames.push({
      drew: !!drew, sub: Math.round(alpha * 100) / 100,
      x: Math.round(me.x * 100) / 100, y: Math.round(me.y * 100) / 100,
      state: me.state, anim: sel ? `${sel.name}:${sel.i}` : null,
      vfx: sel && sel.vfx !== undefined ? Math.round(sel.vfx * 100) / 100 : 1,
      swing: sel && sel.swing ? Math.round(sel.swing.dx * 10) / 10 : 0,
      vx: Math.round(me.vx * 100) / 100, vy: Math.round(me.vy * 100) / 100,
      // exactly what the renderer asked the canvas to blit, in its own transform
      ops: rec.ops.filter((o) => o.op === 'drawImage' && o.finite).map((o) => ({
        sx: o.sx, sy: o.sy, sw: o.sw, sh: o.sh,
        dx: o.dx, dy: o.dy, dw: o.dw, dh: o.dh,
        m: o.matrix.map((v) => Math.round(v * 1000) / 1000),
        a: o.alpha === undefined ? 1 : o.alpha, gco: o.blend || 'source-over',
      })),
      // the collision reality of this tick, same world space as the blits
      hit: (me.activeBoxes ? me.activeBoxes() : []).map((o) => o.box),
      hurt: hurt ? [hurt.x - me.x, hurt.y - me.y, hurt.w, hurt.h] : null,
    });
  };

  for (let i = 0; i < n; i++) {
    feed(i, spec.input || (() => ({})));
    /* onTick runs before the sim so a forced flag is part of this tick's input
       state, not a change made after the frame was already chosen */
    if (spec.onTick) { m.fighters.forEach((f, k) => { if (k === 0) spec.onTick(i, f, foe, m); }); }
    m.update();
    if (SUBS <= 1) oneFrame(0, i * 16.7);
    else for (let q = 0; q < SUBS; q++) oneFrame(BLEND ? q / SUBS : 0, (i + q / SUBS) * 16.7);
  }
  return { name, frames };
}

/* ---------------- main ---------------- */
(async () => {
  const keys = words.filter((w) => KEYS.includes(w));
  const rows = words.filter((w) => !KEYS.includes(w));
  const names = rows.length ? Object.keys(SCENES).filter((n) => rows.some((r) => n === r || n.startsWith(r))) : Object.keys(SCENES);
  if (!names.length) { console.error('no scene matched ' + rows.join(', ') + '\nknown: ' + Object.keys(SCENES).join(' ')); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });

  const h = boot({ render: true, record: true });
  h.g.Sprites.load();
  await h.settle(16);

  let total = 0;
  for (const key of (keys.length ? keys : KEYS)) {
    const scenes = names.map((n) => scene(h, n, SCENES[n], key));
    const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'game', 'assets', 'atlas', key + '.json'), 'utf8'));
    total += scenes.reduce((a, s) => a + s.frames.length, 0);
    fs.writeFileSync(path.join(OUT, key + '.film.json'), JSON.stringify({
      key, cell: CELL, groundPad: 22,
      atlas: path.join('game', 'assets', 'atlas', key + '.png').split(path.sep).join('/'),
      atlasSize: meta.atlas, refH: meta.refH, drawnH: h.g.Sprites.atlas(key).scale * meta.refH,
      scenes,
    }));
    const empty = scenes.filter((s) => s.frames.some((f) => !f.drew)).map((s) => s.name);
    console.log(`  ${key}: ${scenes.length} rows, ${scenes[0].frames.length} ${(HZ > 60 ? HZ + ' Hz drawn frames' : 'ticks')} each` +
      (empty.length ? `   (rows with an unpainted frame: ${empty.join(' ')})` : ''));
  }
  console.log(`\n${keys.length ? keys.length : KEYS.length} spec(s), ${total} frames -> ${path.relative(path.join(__dirname, '..'), OUT)}/`);
  console.log('now:  python3 tools/film_render.py          (needs Pillow; in this sandbox'
    + ' the venv at ../.imgenv has it:  ../.imgenv/bin/python tools/film_render.py)');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
