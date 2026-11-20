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

/* =================== vs-4: the sides of the stage ===================
   Playtest report: "in 4-player a character gets stuck on the sides".  Two things
   made that happen and both are cheap to prove: the crowd solver could not resolve
   a pile at a stage edge (its push and Fighter.confine undid each other), and a
   fighter shoved a few px past the deck face was caught by a ledge-hang whose only
   exit was a button press. */
function packAtWall(m, side) {
  const gd = m.stage.ground;
  const wall = side < 0 ? gd.x : gd.x + gd.w;
  m.fighters.forEach((f, i) => {
    f.x = wall - side * (30 + i * 12); f.y = gd.y; f.vx = 0; f.vy = 0;   // packed just inside the face
    f.onGround = true; f.onPlatform = null; f.state = 'idle'; f.onGround = true;
    f.hitstun = 0; f.hitlag = 0; f.shieldHP = 0; f.grabbedBy = null; f.held = null;
    f.invincT = 0; f.spawnProtect = 0; f.ledge = null; f.ledgeCD = 0; f.ledgeInvuln = 0;
    f.facing = -side; f.facing = side < 0 ? 1 : -1;
  });
  return wall;
}
const deepOverlap = (m) => {
  let worst = 0;
  for (let a = 0; a < m.fighters.length; a++) for (let b = a + 1; b < m.fighters.length; b++) {
    const A = m.fighters[a], B = m.fighters[b];
    if (A.eliminated || B.eliminated) continue;
    if (Math.abs(A.y - B.y) > 44 * (A.scale + B.scale)) continue;
    worst = Math.max(worst, 26 * (A.scale + B.scale) + 8 - Math.abs(B.x - A.x));
  }
  return worst;
};

test('sides: a packed 4-player pile at the wall unwinds and walks nobody off the deck', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(4, ['valor', 'grim', 'vesper', 'rook']), 'skyshrine');
  const gd = m.stage.ground;
  packAtWall(m, -1);
  const c = control(m, () => ({}));                      // nobody presses anything
  let deepRun = 0, worstRun = 0, ledge = 0;
  for (let i = 0; i < 240; i++) {
    c.tick(1);
    deepRun = deepOverlap(m) > 30 ? deepRun + 1 : 0;
    worstRun = Math.max(worstRun, deepRun);
    for (const f of m.fighters) {
      if (f.state === 'ledge') ledge++;
      assert(f.x > gd.x - 20, `a fighter was shoved off the deck by the pile: x=${f.x.toFixed(1)}`);
      assert(!f.eliminated, 'a fighter was KO’d by their own pile');
    }
  }
  assert(worstRun < 24, `the pile stayed welded together for ${worstRun} frames at the wall`);
  assert(ledge === 0, `${ledge} frames of ledge-hangs from a crowd that never left the ground`);
});

test('sides: holding into the wall cannot park you in a ledge-hang', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(4, ['valor', 'grim', 'vesper', 'rook']), 'skyshrine');
  packAtWall(m, -1);
  const me = m.fighters[0];
  const c = control(m, (f, k) => (k === 0 ? { left: true } : {}));   // P1 presses into the wall
  let hang = 0, worst = 0;
  for (let i = 0; i < 240; i++) {
    c.tick(1);
    hang = me.state === 'ledge' ? hang + 1 : 0;
    worst = Math.max(worst, hang);
  }
  assert(worst <= 96, `a ledge-hang lasted ${worst} frames (1.6s of not being in the fight)`);
});

test('ledge: a hang nobody presses a button for still ends', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(1, ['astra']), 'skyshrine');
  const gd = m.stage.ground;
  const f = m.fighters[0];
  f.x = gd.x - 12; f.y = gd.y + 18; f.vx = 0; f.vy = 2; f.onGround = false;
  f.state = 'fall'; f.hitstun = 0; f.ledgeCD = 0;
  m.readPlayerInput = () => ({});
  let hang = 0;
  for (let i = 0; i < 160; i++) {
    m.update();
    if (f.state === 'ledge') hang++;
  }
  assert(hang > 4, 'the fighter never even caught the ledge — the grab test is broken');
  assert(hang < 100, `the hang lasted ${hang} frames; a hang with no input must auto-get-up`);
  assert(f.onGround && f.x > gd.x + 8, `the get-up left them off-stage (x=${f.x.toFixed(0)} onGround=${f.onGround})`);
});

test('ledge: a fighter standing over solid deck is never caught by one', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(1, ['rook']), 'skyshrine');
  const gd = m.stage.ground;
  const f = m.fighters[0];
  // parked just inside the face, airborne for a moment (a hop off the deck)
  f.x = gd.x + 6; f.y = gd.y - 6; f.vx = 0; f.vy = 1; f.onGround = false; f.state = 'fall';
  f.ledgeCD = 0;
  m.readPlayerInput = () => ({});
  for (let i = 0; i < 12; i++) {
    f.x = gd.x + 6; f.y = gd.y - 6 - i; f.onGround = false; f.state = 'fall';
    m.update();
    assert(f.state !== 'ledge', 'a fighter over the deck was snapped into a ledge-hang');
  }
});

/* =================== platforms: standing on a block ===================
   Playtest report: "collision problems with the blocks and things".  Movers were
   integrated but their travel was never handed to whatever was riding them. */
test('platforms: a fighter rides the Ember Foundry lift', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(1, ['valor']), 'foundry');
  const p = m.stage.platforms.find(q => q.move && q.move.axis === 'x');
  assert(p, 'the foundry lift is gone from the stage data');
  const f = m.fighters[0];
  m.readPlayerInput = () => ({});
  let slipped = 0, fell = 0;
  for (let i = 0; i < 260; i++) {
    const py = p.cy !== undefined ? p.cy : p.y;
    if (!f.onPlatform || Math.abs(f.y - py) > 4) {
      f.x = p.cx + p.w / 2; f.y = py; f.vx = 0; f.vy = 0; f.onGround = true; f.onPlatform = p; f.state = 'idle';
    }
    m.update();
    const cx = p.cx + p.w / 2;
    if (Math.abs(f.x - cx) > 2.5) slipped = Math.max(slipped, Math.abs(f.x - cx));
    if (!f.onPlatform) fell++;
  }
  assert(slipped < 4, `the lift slid ${slipped.toFixed(1)}px out from under the fighter`);
  assert(fell <= 2, `the fighter left the lift ${fell} times while standing still on it`);
});

test('platforms: a rising block does not bounce a standing fighter', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(1, ['vesper']), 'cometreach');
  const p = m.stage.platforms.find(q => q.move && q.move.axis === 'y');
  assert(p, 'cometreach has no vertical mover');
  const f = m.fighters[0];
  m.readPlayerInput = () => ({});
  f.x = p.cx + p.w / 2; f.y = p.cy; f.vy = 0; f.onGround = true; f.onPlatform = p; f.state = 'idle';
  let maxJump = 0, off = 0;
  for (let i = 0; i < 260; i++) {
    const py0 = f.y;
    m.update();
    maxJump = Math.max(maxJump, Math.abs(f.y - py0));
    off = Math.max(off, Math.abs(f.y - p.cy));
    if (!f.onGround) off += 0;                            // counted below via maxJump
  }
  assert(maxJump < Math.abs(2 * (p.move.amp * p.move.speed)) + 2.2,
    `the block yanked the fighter ${maxJump.toFixed(2)}px in one frame`);
  assert(off < 3, `the fighter came ${off.toFixed(2)}px off the block's surface`);
});

test('platforms: dropping through a block never drops you through the floor', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(1, ['grim']), 'skyshrine');
  const gd = m.stage.ground;
  const p = m.stage.platforms[0];
  const f = m.fighters[0];
  f.x = p.x + p.w / 2; f.y = p.y; f.vx = 0; f.vy = 0; f.onGround = true; f.onPlatform = p; f.state = 'crouch';
  m.readPlayerInput = (fr) => (fr.__raw || {});
  f.__raw = { down: true };
  m.update();                                             // the crouch sets up the drop
  f.__raw = { down: true, jump: true };
  let below = false, landed = -1;
  for (let i = 0; i < 120 && landed < 0; i++) {
    f.__raw = {};
    m.update();
    if (f.y > gd.y + gd.h) below = true;
    if (f.onGround && f.y >= gd.y - 1) landed = i;
  }
  assert(!below, 'the fighter fell out through the stage deck');
  assert(landed >= 0, `never came back down onto the deck (y=${f.y.toFixed(0)} state=${f.state})`);
});

test('items: an item on a moving lift rides it, then falls when the lift leaves', () => {
  const { ctx, g } = run();
  const m = newMatch(ctx, cast(1, ['astra']), 'foundry', { rules: { items: 'off' } });
  const p = m.stage.platforms.find(q => q.move && q.move.axis === 'x');
  const gd = m.stage.ground;
  const it = m.spawnItem('bobomb', p.cx + p.w / 2, p.cy - 200);
  assert(it, 'spawnItem returned nothing');
  m.readPlayerInput = () => ({});
  let hung = 0, supported = true, tracked = 0;
  for (let i = 0; i < 300; i++) {
    m.update();
    if (it.dead) break;
    const overPlat = it.x > p.x && it.x < p.x + p.w;
    const overDeck = it.x > gd.x - 20 && it.x < gd.x + gd.w + 20;
    if (it.onGround && !overPlat && !overDeck) hung++;
    if (it.onGround && overPlat && Math.abs(it.y - (p.cy - 8)) > 6) hung++;
    tracked = Math.max(tracked, Math.abs(it.x - (p.cx + p.w / 2)));
    supported = !it.onGround || overPlat || overDeck;
  }
  assert(hung === 0, `an item rested on nothing for ${hung} frames`);
  assert(supported, 'the item ended up floating off any surface');
});

test('hazards: the bamboo pillar hits once per rise, not once per frame', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(1, ['rook']), 'hollow', { rules: { hazards: true } });
  const gd = m.stage.ground, hz = m.stage.hazard;
  const f = m.fighters[0];
  m.readPlayerInput = () => ({});
  for (let i = 0; i < hz.period; i++) {                              // exactly one rise
    f.x = hz.x; f.y = gd.y; f.vx = 0; f.vy = 0; f.onGround = true; f.state = 'idle';
    f.hitstun = 0; f.hitlag = 0; f.shieldHP = 60;         // parked in the beam, shield up
    m.update();
  }
  assert(!f.eliminated, 'standing in the pillar KO’d the fighter');
  assert(f.damage <= hz.dmg * 1.5,
    `the pillar did ${f.damage.toFixed(0)}% to a fighter standing in it for one rise (dmg ${hz.dmg})`);
});

test('hazards: lava burns on a rhythm, not every frame', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(1, ['valor']), 'foundry', { rules: { hazards: true } });
  const hz = m.stage.hazard;
  const f = m.fighters[0];
  m.readPlayerInput = () => ({});
  f.y = hz.y + 8; f.vy = 0; f.x = 0; f.onGround = false;
  let hits = 0, prev = 0;
  for (let i = 0; i < 120; i++) {
    f.y = hz.y + 8; f.vy = 0; f.hitstun = 0; f.state = 'fall';
    m.update();
    if (f.damage > prev) hits++;
    prev = f.damage;
    if (f.eliminated || f.stocks < 3) break;
  }
  assert(hits > 0, 'the lava never burned anybody');
  assert(hits <= 4, `the lava hit ${hits} times in 120 frames — that is a shredder, not a hazard`);
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

/* A 4-player CPU match is the stress case the playtesters reported as \"stuck at
   the sides / collisions with things\": twice the bodies to separate, twice the
   items, twice the projectiles.  Everything below is deterministic — Math.random
   is replaced by a seeded LCG for the whole match — because a stress test that
   only fails 1 run in 8 is a test people learn to ignore. */
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const VS4_SEEDS = [['skyshrine', 4242], ['foundry', 1337], ['terminal', 555]];

test('vs4: a 4-player CPU match never locks up, stalls or parks a fighter', () => {
  const realRandom = Math.random;
  try {
    for (const [stage, seed] of VS4_SEEDS) {
      Math.random = seededRandom(seed);
      console.log(`      ${stage} / seed ${seed}`);
      vs4Match(stage);
    }
  } finally { Math.random = realRandom; }
});

function vs4Match(stage) {
  const { ctx } = run();
  const m = newMatch(ctx, cast(4, ['valor', 'grim', 'astra', 'rook'], { cpu: true }), stage, { state: 'play' });
  const gd = m.stage.ground;
  const TICKS = 2400;                                     // 40 seconds of play
  const PARKED = ['helpless', 'respawn', 'ko', 'final', 'stun'];   // long by design
  const runs = m.fighters.map((f) => ({ key: f.key, state: null, n: 0, worst: 0, worstState: '', stale: 0, worstStale: 0, hang: 0, worstHang: 0 }));
  const hitsAt = m.fighters.map(() => []);
  const origHit = m.hitFighter.bind(m);
  m.hitFighter = (atk, tgt, o) => { const k = m.fighters.indexOf(tgt); if (k >= 0) hitsAt[k].push(m.frame); return origHit(atk, tgt, o); };
  let nan = 0, slab = 0, lock = 0, worstLock = 0;
  for (let i = 0; i < TICKS; i++) {
    m.update();
    /* A hitlag lock is the signature of the juggle loop: both fighters are frozen
       by hitlag, the attacker's action timer never advances past the active window,
       and the next tick re-arms the hit.  Nothing recovers from it on its own. */
    lock = m.fighters.some((a) => a.hitlag > 0 && !a.eliminated &&
      m.fighters.some((b) => b !== a && !b.eliminated && Math.abs(a.x - b.x) < 90 && Math.abs(a.y - b.y) < 90)) ? lock + 1 : 0;
    worstLock = Math.max(worstLock, lock);
    m.fighters.forEach((f, k) => {
      if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) nan++;
      if (f.y > gd.y + 6 && f.y < gd.y + gd.h + 8 && f.x > gd.x + 6 && f.x < gd.x + gd.w - 6) slab++;
      const r = runs[k];
      if (m.state !== 'play') { r.state = null; r.n = 0; r.hang = 0; return; }   // the KO pause freezes everybody
      if (f.state === r.state) r.n++; else { r.state = f.state; r.n = 1; }
      if (!PARKED.includes(f.state) && r.n > r.worst) { r.worst = r.n; r.worstState = f.state; r.worstAt = i; }
      /* a fighter with no hitstun left must not stay in a hit state: that is the
         "lying on the floor forever" report, and it also keeps the air drag on, so
         the body slides at a third of a pixel a tick */
      r.stale = ((f.state === 'hitstun' || f.state === 'launch') && f.hitstun <= 0) ? r.stale + 1 : 0;
      r.worstStale = Math.max(r.worstStale, r.stale);
      r.hang = f.state === 'ledge' ? r.hang + 1 : 0;
      r.worstHang = Math.max(r.worstHang, r.hang);
    });
  }
  assert(!nan, `${nan} non-finite positions`);
  assert(!slab, `${slab} frames with a fighter inside the stage slab`);
  assert(worstLock <= 30, `hitlag lock of ${worstLock} frames — a juggle loop`);
  /* Every hit has to come out of an action that can end: at most a handful of hits
     per second on one victim, however many CPUs are crowding it. */
  let burst = 0;
  for (const arr of hitsAt) {
    for (let i = 0; i < arr.length; i++) { let j = i; while (j < arr.length && arr[j] - arr[i] < 60) j++; burst = Math.max(burst, j - i); }
  }
  assert(burst <= 10, `${burst} hits on one fighter inside 60 frames`);
  const stale = runs.reduce((a, r) => Math.max(a, r.worstStale), 0);
  assert(stale <= 8, `a fighter sat in a hit state with no hitstun left for ${stale} frames`);
  const hang = runs.reduce((a, r) => Math.max(a, r.worstHang || 0), 0);
  assert(hang < 100, `a ledge-hang lasted ${hang} frames — the auto-get-up is not firing`);
  const worst = runs.reduce((a, r) => Math.max(a, r.worst), 0);
  const who = runs.find((r) => r.worst === worst);
  assert(worst < 400, `${who.key} sat in ${who.worstState} for ${worst} frames from frame ${who.worstAt}`);
  const kos = m.fighters.reduce((a, f) => a + f.stats.kos, 0);
  const dealt = m.fighters.reduce((a, f) => a + f.stats.dealt, 0);
  console.log(`        worst state run ${worst}f (${who.worstState}); hits ${hitsAt.reduce((a, x) => a + x.length, 0)}, burst ${burst}/60f, ledge ${hang}f, kos ${kos}, damage dealt ${dealt.toFixed(0)}`);
  assert(kos > 0 || dealt > 60, `40 seconds of four CPUs and nothing happened (${kos} kos, ${dealt.toFixed(0)}% dealt)`);
}

/* The three regressions that test was hunting, pinned individually. */
test('vs4: a swing of a held item is one hit, not one hit per frame', () => {
  const { ctx, g } = run();
  const m = newMatch(ctx, cast(2, ['valor', 'grim']), 'skyshrine', { state: 'play' });
  const a = m.fighters[0], b = m.fighters[1];
  a.held = { def: g.ITEMS.beamsword, x: a.x, y: a.y, heldBy: a, ammo: 9 };
  a.state = 'idle'; b.state = 'idle'; b.damage = 0; b.x = a.x + 30; b.vx = 0;
  a.facing = 1;
  let hits = 0;
  const orig = m.hitFighter.bind(m);
  m.hitFighter = (atk, tgt, o) => { hits++; return orig(atk, tgt, o); };
  /* The CPU path calls Match.useHeld directly (ai.js useItemOrThrow); a player pays
     24 frames of item action instead.  Before the cooldown existed, a CPU holding a
     batter hit 60 times in 60 ticks for 660%. */
  for (let i = 0; i < 60; i++) { m.useHeld(a); m.update(); }
  assert(hits === 1, `${hits} hits from 60 frames of swinging — expected 1`);
  assert(b.damage <= 12, `victim ended at ${b.damage}% from one swing`);
});

test('vs4: a multi-hit move lands its authored hits on one target, no more', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(2, ['vesper', 'grim']), 'skyshrine', { state: 'play' });
  const a = m.fighters[0], b = m.fighters[1];
  const move = a.def.moves.jab;
  assert(1 + (move.multi || 0) === 2, 'expected Vesper\'s jab to be the two-hit test case');
  a.state = 'idle'; b.state = 'idle';
  b.x = a.x + 20; b.y = a.y; b.vx = b.vy = 0;
  a.startAttack('jab', m);
  let hits = 0;
  const orig = m.hitFighter.bind(m);
  m.hitFighter = (atk, tgt, o) => { if (atk === a) hits++; return orig(atk, tgt, o); };
  for (let i = 0; i < move.frames + 12; i++) { b.x = a.x + 20; b.vx = b.vy = 0; m.update(); }
  const authored = 1 + (move.multi || 0);
  assert(hits === authored, `${a.key} jab hit ${hits}x, authored ${authored}x`);
});
test('vs4: a grab releases its victim even if the grabber never presses throw', () => {
  const { ctx } = run();
  const m = newMatch(ctx, cast(2, ['grim', 'vesper']), 'skyshrine', { state: 'play' });
  const a = m.fighters[0], b = m.fighters[1];
  a.state = 'idle'; b.state = 'idle'; b.grabbedBy = null; a.grabbing = null;
  m.beginGrab(a, b);
  assert(b.grabbedBy === a, 'beginGrab did not attach the victim');
  let held = 0, stuck = 0;
  for (let i = 0; i < 220; i++) {
    a.input = { attack: true, attackP: i % 10 === 0 };      // pummel, never a throw input
    b.input = {};
    if (a.grabbing) held++;
    if (b.grabbedBy) stuck++;
    m.update();
  }
  /* 120 ticks is GRAB_HOLD_MAX; pummelling every 10 frames must not extend it, or
     the victim has no way out and reads as a fighter that is stuck. */
  assert(held > 100 && held <= 125, `the grab lasted ${held} frames, expected ~120`);
  assert(stuck === held, `the victim stayed attached for ${stuck} of ${held} frames`);
  assert(!a.grabbing && !b.grabbedBy, 'the pair never un-grabbed');
  assert(b.state !== 'grabbed', `victim still in state ${b.state} after the throw`);
});

/* ---------------- entry ---------------- */
T.run(process.argv[2]).then(fail => process.exit(fail ? 1 : 0));
