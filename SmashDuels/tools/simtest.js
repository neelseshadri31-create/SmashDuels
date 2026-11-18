/* ============================================================
   tools/simtest.js — headless simulation tests
   ------------------------------------------------------------
   Physics, collision, state machine and facing rules, run through the real
   engine modules with a stubbed DOM (see tools/harness.js).  Rendering is out
   of scope here — the atlas/sprite layer is covered by tools/atlascheck.js.

     node tools/simtest.js            run everything
     node tools/simtest.js sides      run tests whose name matches
     V=1 node tools/simtest.js        print failure stacks
   ============================================================ */
'use strict';

const { boot, cast, control, newMatch, makeRunner } = require('./harness');

const T = makeRunner();
const { test, assert } = T;
const run = boot;

/* =================== boot =================== */
test('boot: modules load, classes resolve, a 1v1 steps', () => {
  const { g, ctx } = run();
  assert(typeof g.Match === 'function', 'Match missing');
  assert(typeof g.Fighter === 'function', 'Fighter missing');
  assert(Object.keys(g.FIGHTERS).length >= 5, 'roster missing');
  assert(g.WORLD && g.WORLD.blast, 'WORLD missing');
  assert(g.Sprites === undefined, 'simtest must not load the renderer');
  const m = ctx.newMatch ? null : null;
  const match = newMatch(ctx, cast(2, ['valor', 'grim']));
  control(match).tick(240);
  for (const f of match.fighters) {
    assert(Number.isFinite(f.x) && Number.isFinite(f.y), 'NaN position');
    assert(Math.abs(f.y) < 4000, 'fighter flew off: ' + f.y);
  }
});

/* =================== sides / collisions =================== */
test('sides: no fighter is ever embedded in the stage slab', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(4, ['valor', 'grim', 'astra', 'vesper']), 'skyshrine');
  const gd = m.stage.ground;
  let worst = null;
  const c = control(m, () => {
    const t = m.frame % 90;
    return {
      left: t < 60, right: t >= 60 && t < 70, down: t >= 70 && t < 78,
      attack: t % 23 === 0, jump: t % 37 === 0, shield: t >= 80,
    };
  });
  for (let i = 0; i < 900; i++) {
    c.tick(1);
    for (const f of m.fighters) {
      if (f.eliminated) continue;
      const inSlabY = f.y > gd.y + 6 && f.y < gd.y + gd.h + 8;
      const inSlabX = f.x > gd.x + 6 && f.x < gd.x + gd.w - 6;
      if (inSlabY && inSlabX) worst = { frame: i, x: Math.round(f.x), y: Math.round(f.y), key: f.key, state: f.state };
    }
  }
  assert(!worst, 'fighter stuck inside the stage slab: ' + JSON.stringify(worst));
});

test('sides: a crowd shoved into the edge separates instead of pinning', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(4, ['grim', 'valor', 'astra', 'rook']), 'skyshrine');
  const gd = m.stage.ground;
  m.fighters.forEach((f, i) => {                   // all four pressed on the left face
    f.x = gd.x - 24 - i * 2; f.y = gd.y; f.vx = 0; f.vy = 0;
    f.state = 'idle'; f.onGround = true; f.hitstun = 0; f.damage = 0;
  });
  control(m, () => ({ right: true })).tick(90);
  const xs = m.fighters.map(f => f.x).sort((a, b) => a - b);
  const spread = xs[xs.length - 1] - xs[0];
  assert(spread > 40, `crowd did not separate at the wall (spread ${spread.toFixed(1)}: ${xs.map(v => v.toFixed(0))})`);
  for (let i = 1; i < xs.length; i++) {
    assert(xs[i] - xs[i - 1] > 6, `still overlapping at the edge: ${xs.map(v => v.toFixed(1))}`);
  }
  for (const f of m.fighters) {
    const inSlab = f.y > gd.y + 6 && f.y < gd.y + gd.h + 8 && f.x > gd.x + 6 && f.x < gd.x + gd.w - 6;
    assert(!inSlab, `pushed into the slab by the crowd: x=${f.x.toFixed(1)} y=${f.y.toFixed(1)}`);
  }
});

test('sides: edge-up shoves never pop a fighter across the stage', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(2, ['grim', 'vesper']), 'skyshrine');
  const gd = m.stage.ground;
  const a = m.fighters[0], b = m.fighters[1];
  a.x = 0; b.x = 0; a.y = gd.y; b.y = gd.y; a.onGround = b.onGround = true;
  let maxJump = 0;
  const before = [a.x, b.x];
  for (let i = 0; i < 60; i++) {
    const p0 = a.x, p1 = b.x;
    m.update();
    maxJump = Math.max(maxJump, Math.abs(a.x - p0), Math.abs(b.x - p1));
  }
  assert(maxJump < 12, `separation moved a fighter ${maxJump.toFixed(1)}px in one frame`);
  assert(Math.abs(a.x - before[0]) < 300 && Math.abs(b.x - before[1]) < 300, 'fighter teleported');
});

test('sides: falling past the deck never teleports a fighter sideways', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(1, ['valor']), 'skyshrine');
  const gd = m.stage.ground;
  const f = m.fighters[0];
  // dropped straight down the middle of the stage (under-stage techs,
  // drop-throughs and clipped platforms all land here)
  f.x = -40; f.y = gd.y + 30; f.vx = 0; f.vy = 4; f.onGround = false;
  f.state = 'fall'; f.hitstun = 0;
  m.readPlayerInput = () => ({});
  let jump = 0, prev = f.x;
  for (let i = 0; i < 60; i++) {
    m.update();
    if (f.eliminated || f.state === 'respawn') break;   // a real KO/respawn may reposition
    jump = Math.max(jump, Math.abs(f.x - prev));
    prev = f.x;
    if (!Number.isFinite(f.x)) break;
  }
  assert(Number.isFinite(f.x), 'x went NaN below the deck');
  assert(jump < 30, `x moved ${jump.toFixed(0)}px in one frame — the wall push-out is snapping fighters across the stage`);
});

test('sides: a knocked-out fighter is not clamped back onto the platform', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(2, ['grim', 'vesper']), 'skyshrine');
  const gd = m.stage.ground;
  const a = m.fighters[0], b = m.fighters[1];
  // both far off the left side, overlapping in the air (a classic 2v1 edge-up)
  a.x = gd.x - 420; b.x = a.x + 6;
  a.y = b.y = gd.y + 120; a.onGround = b.onGround = false;
  a.vx = b.vx = -8; a.vy = b.vy = 2;
  a.state = b.state = 'launch'; a.hitstun = b.hitstun = 90;
  m.readPlayerInput = () => ({});
  let jump = 0, pa = a.x, pb = b.x;
  for (let i = 0; i < 24; i++) {
    m.update();
    if (a.eliminated || b.eliminated || a.state === 'respawn' || b.state === 'respawn') break;
    jump = Math.max(jump, Math.abs(a.x - pa), Math.abs(b.x - pb));
    pa = a.x; pb = b.x;
  }
  assert(jump < 30, `a fighter was yanked ${jump.toFixed(0)}px in one frame by the edge-up clamp`);
  assert(pa < gd.x - 300, `fighter was pulled back toward the stage (x=${pa.toFixed(0)})`);
});

test('sides: a fighter shoved past the side blast zone is KO’d', () => {
  const { ctx, g } = run();
  const m = newMatch(ctx, cast(2, ['valor', 'astra']), 'skyshrine');
  const gd = m.stage.ground, blast = g.WORLD.blast;
  const f = m.fighters[0];
  assert(f.x > blast.left, 'fighter already outside the blast zone');
  f.x = gd.x - 60; f.y = gd.y + 60; f.vx = -34; f.vy = 6;
  f.onGround = false; f.state = 'launch'; f.hitstun = 120;
  let ko = false;
  for (let i = 0; i < 240 && !ko; i++) { m.update(); ko = f.eliminated || f.stocks < 3; }
  assert(ko, 'fighter shoved off the side was never KO’d');
});

/* =================== facing =================== */
test('facing: a back-roll keeps the fighter turned toward the opponent', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(2, ['valor', 'grim']), 'terminal');
  const f = m.fighters[0], o = m.fighters[1];
  f.x = -80; o.x = 80; f.y = o.y = m.stage.ground.y;
  f.onGround = true; f.state = 'idle';
  m.readPlayerInput = (fr) => fr.__raw || {};
  f.__raw = { right: true }; o.__raw = {};
  for (let i = 0; i < 4; i++) m.update();
  assert(f.facing === 1, 'expected to face right, got ' + f.facing);
  // roll backwards (left): shield + direction on the same frame is the
  // shorthop-guard roll, so that's the path under test
  let sawRoll = false, flipped = false;
  for (let i = 0; i < 40; i++) {
    f.__raw = (i < 6) ? { shield: true, left: i >= 3 } : {};
    o.__raw = {};
    m.update();
    if (f.state === 'roll') {
      sawRoll = true;
      if (f.facing !== 1) flipped = true;
    }
  }
  assert(sawRoll, 'roll never started (state=' + f.state + ')');
  assert(!flipped, 'facing flipped during a back-roll');
  assert(f.facing === 1, 'fighter ended up facing away after rolling backwards');
});

test('facing: committed attacks keep their facing', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(2, ['vesper', 'rook']), 'terminal');
  const f = m.fighters[0];
  f.x = 0; f.y = m.stage.ground.y; f.onGround = true; f.state = 'idle';
  f.__raw = { right: true };
  m.readPlayerInput = () => f.__raw;
  m.update();
  assert(f.facing === 1, 'setup facing');
  f.__raw = { attack: true };
  m.update();
  assert(f.state === 'attack', 'attack did not start: ' + f.state);
  for (let i = 0; i < 30; i++) {
    f.__raw = { left: true };                 // hold the opposite direction
    m.update();
    if (f.state !== 'attack') break;
    assert(f.facing === 1, 'facing changed mid-attack at frame ' + i);
  }
});

test('facing: a grab turns toward the target', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(2, ['valor', 'grim']), 'terminal');
  const f = m.fighters[0], o = m.fighters[1];
  const gd = m.stage.ground;
  // opponent behind the input direction: the grab must still commit to them
  f.x = 40; o.x = -60; f.y = o.y = gd.y; f.onGround = o.onGround = true;
  f.facing = 1; f.state = 'idle';
  f.startGrab(m);
  assert(f.facing === -1, 'grab did not turn toward the target (facing ' + f.facing + ')');
});

test('facing: air turn still works (the fix is not a freeze)', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(1, ['astra']), 'terminal');
  const f = m.fighters[0];
  f.__raw = { left: true };
  m.readPlayerInput = () => f.__raw;
  f.x = 0; f.y = m.stage.ground.y - 260; f.vy = 0; f.onGround = false;
  f.state = 'fall'; f.facing = 1;
  let turned = false;
  for (let i = 0; i < 30 && !turned; i++) { m.update(); if (f.facing === -1) turned = true; }
  assert(turned, 'air turn did not happen (state=' + f.state + ')');
});

/* =================== states / stress =================== */
test('states: jump / land / crouch / fall are all reachable and settle', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(1, ['rook']), 'hollow');
  const f = m.fighters[0];
  m.readPlayerInput = (fr) => fr.__raw || {};
  f.y = m.stage.ground.y - 320; f.vy = 0; f.onGround = false;
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const t = i % 80;
    f.__raw = { jump: t === 0, down: t > 40 && t < 60, left: t > 10 && t < 30, right: t > 60 };
    m.update();
    seen.add(f.state);
    assert(Number.isFinite(f.x) && Number.isFinite(f.y), 'NaN in ' + f.state);
  }
  for (const want of ['land', 'crouch', 'jump', 'fall']) {
    assert(seen.has(want), `state ${want} never reached (saw ${[...seen].join(',')})`);
  }
});

test('hitstun: a launched crowd gets pushed apart, not stacked', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(4, ['grim', 'valor', 'vesper', 'astra']), 'terminal');
  m.fighters.forEach((f, i) => {
    f.x = -20 + i * 6; f.y = m.stage.ground.y - 40; f.vx = 0; f.vy = -6;
    f.onGround = false; f.state = 'launch'; f.hitstun = 200; f.damage = 120;
  });
  let minGap = 1e9;
  for (let i = 0; i < 120; i++) {
    m.update();
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
      const A = m.fighters[a], B = m.fighters[b];
      if (!A || !B || A.eliminated || B.eliminated) continue;
      if (Math.abs(A.y - B.y) > 40) continue;
      minGap = Math.min(minGap, Math.abs(A.x - B.x));
    }
  }
  assert(minGap > 6 || !Number.isFinite(minGap), 'launched fighters stayed stacked (gap ' + minGap.toFixed(1) + ')');
});

test('ledge: three fighters contesting one ledge never enter the slab', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(3, ['vesper', 'valor', 'grim']), 'skyshrine');
  const gd = m.stage.ground;
  m.fighters.forEach(f => {
    f.x = gd.x - 20; f.y = gd.y + 24; f.vx = -2; f.vy = 2;
    f.onGround = false; f.state = 'fall'; f.hitstun = 0;
  });
  m.readPlayerInput = (f) => f.__raw || {};
  for (let i = 0; i < 200; i++) {
    m.fighters.forEach((f, k) => { f.__raw = { right: k === 0, up: i % 40 === 0 }; });
    m.update();
    for (const f of m.fighters) {
      if (f.eliminated) continue;
      assert(Number.isFinite(f.x), 'NaN x at ledge');
      const inSlab = f.y > gd.y + 6 && f.y < gd.y + gd.h + 8 && f.x > gd.x + 6 && f.x < gd.x + gd.w - 6;
      assert(!inSlab, `fighter ${f.key} inside slab at (${f.x.toFixed(0)},${f.y.toFixed(0)}) state=${f.state}`);
    }
  }
});

test('4v4 teams + items: 30s of frames stays finite, in-bounds and unstacked', () => {
  const { ctx, g } = run();
  const m = newMatch(ctx, cast(4, ['valor', 'grim', 'astra', 'vesper'], { teams: true, cpu: true }), 'foundry', {
    rules: { items: 'medium', teams: true, mode: 'teams' },
  });
  const gd = m.stage.ground;
  const keys = Object.keys(g.ITEMS);
  let worstOverlap = 0, inSlab = 0;
  for (let i = 0; i < 1800; i++) {
    if (i % 300 === 0) m.spawnItem(keys[Math.floor(i / 300) % keys.length], (i % 2 ? 140 : -140), -80);
    m.update();
    for (const f of m.fighters) {
      assert(Number.isFinite(f.x) && Number.isFinite(f.y) && Number.isFinite(f.vx),
        `NaN on ${f.key} frame ${i} state=${f.state}`);
      assert(Math.abs(f.x) < 3000, `fighter escaped the world: ${f.key} x=${f.x}`);
      if (f.y > gd.y + 6 && f.y < gd.y + gd.h + 8 && f.x > gd.x + 6 && f.x < gd.x + gd.w - 6) inSlab++;
    }
    for (let a = 0; a < m.fighters.length; a++) {
      for (let b = a + 1; b < m.fighters.length; b++) {
        const A = m.fighters[a], B = m.fighters[b];
        if (A.eliminated || B.eliminated || Math.abs(A.y - B.y) > 40) continue;
        worstOverlap = Math.max(worstOverlap, 52 - Math.abs(A.x - B.x));
      }
    }
  }
  assert(inSlab === 0, inSlab + ' frames had a fighter inside the stage slab');
  assert(worstOverlap < 52, 'fighters were fully stacked for part of the match');
});

test('stress: random mashers never produce NaN or a stuck overlap', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(4, ['valor', 'vesper', 'rook', 'grim']), 'range');
  const rnd = (n) => Math.floor(Math.random() * n);
  const BTN = ['left', 'right', 'up', 'down', 'attack', 'special', 'jump', 'shield', 'grab'];
  m.readPlayerInput = (f) => f.__raw || {};
  let stuckFrames = 0;
  for (let i = 0; i < 2400; i++) {
    if (i % 7 === 0) {
      for (const f of m.fighters) {
        const r = {};
        for (let k = 0; k < 3; k++) r[BTN[rnd(BTN.length)]] = true;
        f.__raw = r;
      }
    }
    m.update();
    for (const f of m.fighters) {
      if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) throw new Error(`NaN on ${f.key} at frame ${i}`);
    }
    const alive = m.fighters.filter(f => !f.eliminated);
    let anyOverlap = false;
    for (let a = 0; a < alive.length; a++) for (let b = a + 1; b < alive.length; b++) {
      if (Math.abs(alive[a].y - alive[b].y) < 30 && Math.abs(alive[a].x - alive[b].x) < 4) anyOverlap = true;
    }
    stuckFrames = anyOverlap ? stuckFrames + 1 : 0;
    assert(stuckFrames < 45, `fighters pinned on top of each other for ${stuckFrames} frames`);
  }
});

/* ---------------- entry ---------------- */
T.run(process.argv[2]).then(fail => process.exit(fail ? 1 : 0));
