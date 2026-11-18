/* ============================================================
   RIFT RUMBLE — match orchestration, camera, HUD, main loop
   ============================================================ */
'use strict';

const LAUNCH_SCALE = 0.40;
const LAUNCH_MAX = 62;

class Camera {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.x = 0; this.y = -180; this.zoom = 1;
    this.tx = 0; this.ty = -180; this.tz = 1;
    this.shakeAmt = 0; this.shakeT = 0;
    this.sx = 0; this.sy = 0;
    this.punch = 0;
  }
  update(fighters, dt = 1) {
    let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
    let n = 0;
    for (const f of fighters) {
      if (f.eliminated && f.state === 'respawn') continue;
      mnx = Math.min(mnx, f.x); mxx = Math.max(mxx, f.x);
      mny = Math.min(mny, f.y - 110); mxy = Math.max(mxy, f.y + 30);
      n++;
    }
    if (n === 0) { mnx = -200; mxx = 200; mny = -100; mxy = 100; }
    const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2;
    // frame the whole fighting area: the stage deck plus breathing room, and
    // always keep both fighters comfortably on screen
    const gd = this.stage ? this.stage.ground : null;
    let w = (mxx - mnx) + 760, h = (mxy - mny) + 520;
    if (gd) {
      w = Math.max(w, gd.w * 0.92 + 240);
      h = Math.max(h, 640);
    }
    let z = Math.min(this.W / w, this.H / h);
    z = clamp(z, 0.42, 1.06);
    this.tx = cx; this.ty = cy; this.tz = z;
    this.x = lerp(this.x, this.tx, 0.075 * dt);
    this.y = lerp(this.y, this.ty, 0.075 * dt);
    this.zoom = lerp(this.zoom, this.tz, 0.055 * dt);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmt * (this.shakeT / 12);
      this.sx = rand(-a, a); this.sy = rand(-a, a);
    } else { this.sx *= 0.8; this.sy *= 0.8; }
    if (this.punch > 0) this.punch = Math.max(0, this.punch - 0.04 * dt);
  }
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); this.shakeT = 12; }
  zoomPunch(a) { this.punch = Math.max(this.punch, a); }
  apply(ctx) {
    const z = this.zoom * (1 + this.punch * 0.12);
    ctx.translate(this.W / 2 + this.sx, this.H / 2 + this.sy);
    ctx.scale(z, z);
    ctx.translate(-this.x, -this.y);
  }
  screenToWorld(sx, sy) {
    const z = this.zoom * (1 + this.punch * 0.12);
    return { x: (sx - this.W / 2 - this.sx) / z + this.x, y: (sy - this.H / 2 - this.sy) / z + this.y };
  }
  get viewBounds() {
    const z = this.zoom * (1 + this.punch * 0.12);
    return { x: this.x - this.W / 2 / z, y: this.y - this.H / 2 / z, w: this.W / z, h: this.H / z };
  }
}

class Match {
  constructor(opts) {
    this.opts = opts;
    this.rules = opts.rules;
    this.stageDef = STAGES[opts.stageKey] || STAGES.skyshrine;
    this.stage = JSON.parse(JSON.stringify(this.stageDef));
    // materialize moving platforms
    this.stage.platforms.forEach((p, i) => {
      p.baseX = p.x; p.baseY = p.y; p.phase = p.phase || 0;
      p.cx = p.x; p.cy = p.y;
    });
    this.W = opts.W || 1600; this.H = opts.H || 1000;
    this.cam = new Camera(this.W, this.H);
    this.cam.stage = this.stage;
    this.fx = new FXSystem(this);
    this.fighters = [];
    this.projectiles = [];
    this.items = [];
    this.mines = [];
    this.summons = [];
    this.time = 0;
    this.frame = 0;
    this.state = 'intro';   // intro → play → over
    this.stateT = 0;
    this.paused = false;
    this.announcement = null;
    this.grabTimer = 0;
    this.smashBallActive = false;
    this.itemTimer = 0;
    this.suddenDeath = false;
    this.matchTime = this.rules.time * 60;
    this.winner = null;
    this.overT = 0;
    this.statsDirty = false;
    this.slowmo = 0;
    this.hitstop = 0;

    // cast
    let spawnX = [-260, 260, -420, 420, -120, 120, -320, 320];
    opts.cast.forEach((c, i) => {
      const f = new Fighter({
        key: c.key, palIdx: c.palIdx, playerIndex: i, team: c.team || 0,
        isCPU: c.isCPU, cpuLevel: opts.rules.aiLevel, label: c.label || (c.isCPU ? 'CPU' : 'P' + (i + 1)),
        stocks: this.rules.stocks, x: spawnX[i % spawnX.length], y: -10, facing: i % 2 ? -1 : 1,
      });
      f.id = i;
      f.spawnX = spawnX[i % spawnX.length];
      f.spawnProtect = 0;
      f.match = this;
      f.ai = c.isCPU ? new CPU(f, this) : null;
      this.fighters.push(f);
    });
    AUDIO.init();
    window.__match = this;
  }

  sameTeam(a, b) {
    if (!this.rules.teams || !a || !b) return false;
    if (a === b) return true;
    return this.rules.teams && a.team === b.team && !this.rules.teamAttack;
  }

  announce(text, color = '#ffffff', dur = 70) { this.announcement = { text, color, t: 0, dur }; }

  /* ---------------- loop ---------------- */
  update() {
    this.frame++;
    if (this.paused) { this.cam.update(this.fighters); return; }
    this.time += 16.67;

    // moving platforms
    for (const p of this.stage.platforms) {
      if (p.move) {
        const off = Math.sin(this.frame * p.move.speed + p.phase) * p.move.amp;
        if (p.move.axis === 'x') p.cx = p.baseX + off; else p.cy = p.baseY - Math.abs(off) * 0.5 - off * 0.5;
        p.x = p.cx; p.y = p.cy;
      }
    }

    // resolve active grabs every frame (even during intro)
    for (const f of this.fighters) {
      const t = f.grabbing;
      if (t && (t.eliminated || t.grabbedBy !== f)) { f.grabbing = null; if (t) t.grabbedBy = null; }
      if (t) t.hitstun = 0;
    }
    if (this.state === 'intro') {
      this.stateT++;
      if (this.stateT === 1) AUDIO.sfx('beep');
      if (this.stateT === 45) AUDIO.sfx('beepHi');
      if (this.stateT === 90) { AUDIO.sfx('go'); this.state = 'play'; this.announce('GO!', '#9fd4ff', 50); }
      for (const f of this.fighters) { f.animT++; }
      this.fx.update(); this.cam.update(this.fighters);
      return;
    }

    if (this.state === 'over') {
      this.overT++;
      for (const f of this.fighters) { f.animT++; }
      this.fx.update(); this.cam.update(this.fighters);
      if (this.announcement) { this.announcement.t++; if (this.announcement.t > this.announcement.dur) this.announcement = null; }
      return;
    }

    // ---- play
    if (this.announcement) { this.announcement.t++; if (this.announcement.t > this.announcement.dur) this.announcement = null; }

    // timer
    if (this.rules.mode !== 'stock') {
      this.matchTime--;
      if (this.matchTime === 600) this.announce('1 MINUTE LEFT', '#ffd23a');
      if (this.matchTime <= 0) { this.endByTime(); return; }
    }

    // items
    this.updateItems();

    // home-run sandbag physics
    if (this.bag) {
      const bg2 = this.bag;
      if (bg2.launched) {
        bg2.vy += 0.32;
        bg2.x += bg2.vx; bg2.y += bg2.vy;
        bg2.vx *= 0.995;
        bg2.rot += bg2.vx * 0.004;
        if (bg2.y > 420 || bg2.x > WORLD.blast.right + 400 || bg2.x < WORLD.blast.left) { Modes.homeRunEnd(this); this.bag = null; }
      } else {
        bg2.y = Math.min(bg2.y, this.stage.ground.y - 22);
        bg2.x += bg2.vx; bg2.vx *= 0.86;
        // any attack connecting near the bag adds damage
        const p1 = this.fighters[0];
        if (p1 && p1.state === 'attack' && p1.action && p1.actionT === p1.action.startup) {
          if (Math.abs(p1.x - bg2.x) < 95) Modes.homeRunSwing(this);
        }
      }
      // auto-launch on the final smash-style hit while charging
      if (!bg2.launched && bg2.dmg >= 120) Modes.homeRunLaunch(this);
    }

    // multiman waves
    if (this.multiman) {
      const aliveMobs = this.fighters.filter(f => f.isMob && f.stocks > 0).length;
      this.multimanTimer = (this.multimanTimer || 0) + 1;
      if (aliveMobs === 0 && this.multimanTimer > 40) {
        this.multimanTimer = 0;
        Modes.spawnMob(this);
      }
      if (this.multiman.spawned >= this.multiman.target && aliveMobs === 0) {
        // wave cleared
        Modes.reset();
      }
    }

    // hazards
    this.updateHazards();

    // fighters
    for (const f of this.fighters) {
      if (f.eliminated) continue;
      if (this.state !== 'play') break;
      if (f.isCPU && !f.ai) f.ai = new CPU(f, this);
      const raw = f.isCPU && f.ai ? f.ai.think(this) : this.readPlayerInput(f);
      f.readInput(raw);
      f.update(this);
    }

    // resolve fighter overlap (soft push)
    for (let i = 0; i < this.fighters.length; i++) {
      for (let j = i + 1; j < this.fighters.length; j++) {
        const a = this.fighters[i], b = this.fighters[j];
        if (a.eliminated || b.eliminated || a.grabbedBy || b.grabbedBy) continue;
        if (Math.abs(a.y - b.y) > 70) continue;         // different heights → ignore
        const dx = b.x - a.x;
        const minGap = (26 * (a.scale + b.scale)) + 8;
        if (Math.abs(dx) < minGap) {
          const push = (minGap - Math.abs(dx)) * 0.16 * sign(dx || 1);
          a.x -= push; b.x += push;
          // keep both inside the stage footprint
          const gd2 = this.stage.ground;
          a.x = clamp(a.x, gd2.x - 120, gd2.x + gd2.w + 120);
          b.x = clamp(b.x, gd2.x - 120, gd2.x + gd2.w + 120);
        }
      }
    }

    // projectiles / mines / summons
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]; p.update(this);
      if (p.dead) this.projectiles.splice(i, 1);
    }
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i]; m.update(this);
      if (m.dead) this.mines.splice(i, 1);
    }
    for (let i = this.summons.length - 1; i >= 0; i--) {
      const s = this.summons[i]; s.update(this);
      if (s.dead) this.summons.splice(i, 1);
    }

    // stars / regen etc
    for (const f of this.fighters) {
      if (f.eliminated) continue;
      if (f.buffs.star > 0 && this.frame % 4 === 0) this.fx.particle({ x: f.x + rand(-24, 24), y: f.y - rand(20, 100), vx: rand(-1, 1), vy: rand(-2, -0.5), life: 20, size: rand(2, 4), color: '#ffe04a', grav: 0, drag: 0.95, shape: 'spark' });
      if (f.buffs.flower > 0 && this.frame % 30 === 0) this.fx.particle({ x: f.x + rand(-8, 8), y: f.y - 108, vx: 0, vy: -0.6, life: 26, size: 4, color: '#ff7a2a', grav: 0, drag: 1, shape: 'smoke' });
      // combo decay
      if (f.comboTimer > 0) f.comboTimer--;
    }

    this.fx.update();
    this.cam.update(this.fighters);
    this.checkEnd();
  }

  readPlayerInput(f) {
    const map = INPUT.map['p' + (f.playerIndex + 1)];
    const gp = GAMEPADS.state[f.playerIndex];
    const r = {
      left: INPUT.down(map.left), right: INPUT.down(map.right), up: INPUT.down(map.up), down: INPUT.down(map.down),
      attack: INPUT.hit(map.attack) || INPUT.down(map.attack), special: INPUT.hit(map.special) || INPUT.down(map.special),
      jump: INPUT.hit(map.jump) || INPUT.down(map.jump), shield: INPUT.down(map.shield) || INPUT.hit(map.shield),
      grab: INPUT.hit(map.grab) || INPUT.down(map.grab),
    };
    if (gp) {
      r.left = r.left || gp.left; r.right = r.right || gp.right; r.up = r.up || gp.up; r.down = r.down || gp.down;
      r.attack = r.attack || gp.attack; r.special = r.special || gp.special;
      r.jump = r.jump || gp.jump; r.shield = r.shield || gp.shield; r.grab = r.grab || gp.grab;
    }
    return r;
  }

  updateItems() {
    const mode = this.rules.items;
    if (mode === 'none') return;
    const rate = mode === 'low' ? 520 : mode === 'medium' ? 320 : 170;
    this.itemTimer--;
    if (this.itemTimer <= 0) {
      this.itemTimer = rate + randInt(-40, 60);
      this.spawnRandomItem();
    }
    // smash ball
    if (!this.smashBallActive && this.rules.mode !== 'stamina' && this.frame > 400 && chance(0.004)) {
      this.smashBallActive = true;
      const gd = this.stage.ground;
      const it = new Item('smashball', gd.x + gd.w * rand(0.2, 0.8), -300, this);
      it.smashBall = true;
      this.items.push(it);
      AUDIO.sfx('smashBall');
      this.announce('SMASH BALL!', '#ffe04a', 60);
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.update(this);
      if (it.dead) { this.items.splice(i, 1); if (it.smashBall) this.smashBallActive = false; }
    }
  }

  spawnRandomItem() {
    const gd = this.stage.ground;
    const key = pick(ITEM_POOL_COMMON);
    const x = gd.x + gd.w * rand(0.12, 0.88);
    const it = new Item(key, x, -420, this);
    this.items.push(it);
    AUDIO.sfx('itemSpawn');
  }

  spawnItem(key, x, y, vx = 0, vy = 0) {
    const it = new Item(key, x, y, this);
    it.vx = vx; it.vy = vy;
    this.items.push(it);
    return it;
  }

  updateHazards() {
    if (!this.rules.hazards) return;
    const hz = this.stage.hazard;
    if (!hz) return;
    if (hz.type === 'lava') {
      for (const f of this.fighters) {
        if (f.eliminated) continue;
        if (f.y > hz.y) {
          this.hitFighter(null, f, { damage: hz.dmg / 2, bkb: 26, kbs: 10, angle: 85, hazard: 1 });
          if (f.y > hz.y + 160) this.koFighter(f, null);
        }
      }
    }
    if (hz.type === 'pillar') {
      this.pillarT = (this.pillarT || 0) + 1;
      const cyc = this.pillarT % hz.period;
      if (cyc === 1) this.pillarActive = true;
      if (cyc === 60) this.pillarActive = false;
      if (this.pillarActive && cyc < 60) {
        for (const f of this.fighters) {
          if (f.eliminated) continue;
          if (Math.abs(f.x - hz.x) < hz.w / 2 + 18) this.hitFighter(null, f, { damage: hz.dmg / 6, bkb: 12, kbs: 4, angle: 90, hazard: 1 });
        }
        if (cyc % 6 === 0) this.fx.particle({ x: hz.x + rand(-hz.w / 2, hz.w / 2), y: -10, vx: 0, vy: -6, life: 20, size: rand(3, 7), color: '#2fd6bb', grav: 0, drag: 1, shape: 'spark' });
      }
    }
  }

  /* ---------------- combat ---------------- */
  hitFighter(attacker, target, o) {
    if (!target || target.eliminated) return;
    if (target.invincible) return;
    const dmg = o.damage * this.rules.damageRatio;
    const attackerIsFinal = o.final;
    target.damage = Math.min(999, target.damage + dmg);
    target.stats.taken += dmg;
    if (attacker && attacker !== target) attacker.stats.dealt += dmg;

    // GDD knockback formula — must stay uncapped enough that damage% actually
    // decides KOs (a hard 62 cap made everything survivable at high percent)
    let kb = (o.bkb + o.kbs * target.damage / 100) * (100 / target.weight);
    if (o.smashMult) kb *= o.smashMult;
    // Launch speed is in px/frame, so it must be scaled to the stage size:
    // a fresh smash should KO around 90-110% from centre stage and low-percent
    // hits should be survivable, instead of every hit crossing the blastzone.
    kb = clamp(kb * LAUNCH_SCALE, 0, LAUNCH_MAX);
    let angle = o.angle;
    if (o.spike) angle = 268;
    // DI from victim input
    const diDir = (target.input && target.input.left ? -1 : 0) + (target.input && target.input.right ? 1 : 0);
    angle += diDir * 5;
    const ar = angle * Math.PI / 180;

    target.hitstun = Math.floor(kb * 0.62) + 8;
    target.hitT = 0;
    target.vx = Math.cos(ar) * kb;
    target.vy = -Math.sin(ar) * kb * 0.92;
    if (target.onGround && target.vy > 0) target.vy = -Math.abs(target.vy) * 0.5;
    target.onGround = false; target.onPlatform = null;
    target.state = 'launch';
    target.ledge = null;
    target.shieldHP = 0; target.shielding = false;
    target.grabbing = null; target.grabbedBy = null;
    target.charging = false;
    target.lastHitBy = attacker || null;
    if (target.action && target.action.type !== 'move') target.action = null;

    // hitlag
    const hl = Math.round(clamp(kb * 0.22, 2, 14));
    target.hitlag = hl;
    if (attacker) attacker.hitlag = Math.round(hl * 0.6);

    // combo counter
    if (attacker && attacker !== target) {
      if (target.hitstun > 20) attacker.comboCount++;
      attacker.comboTimer = 60;
      if (attacker.comboCount > attacker.stats.maxCombo) attacker.stats.maxCombo = attacker.comboCount;
    }

    // fx + audio
    const power = clamp(kb / 45, 0.1, 1);
    const cx = (target.x + (attacker ? attacker.x : target.x)) / 2;
    const cy = target.y - 56 * target.scale;
    if (o.hazard) {
      this.fx.burst(cx, cy, '#ff7a2a', 10);
    } else {
      this.fx.hitSpark(target.x - Math.cos(ar) * 14, cy, attacker ? attacker.pal.accent : '#ffffff', power, ar);
      this.fx.impact(cx, cy, attacker ? attacker.pal.accent : '#ffffff', power);
    }
    AUDIO.sfx('hit', { power });
    this.cam.shake(2 + power * 9);
    if (power > 0.72) this.slowmo = Math.max(this.slowmo, 5);
    if (target.damage > 100 && chance(0.5)) this.fx.particle({ x: target.x, y: target.y - 100, vx: 0, vy: -1.2, life: 30, size: 5, color: '#ff8a5a', grav: 0, drag: 1, shape: 'smoke' });
    this.triggerChallenge('damage', target);
  }

  shieldHit(attacker, target, dmg, box) {
    target.shieldHP -= dmg * 1.35;
    target.shieldStun = Math.floor(dmg * 0.8) + 4;
    target.vx += (target.x > (attacker ? attacker.x : target.x) ? 1 : -1) * dmg * 0.12;
    if (attacker) attacker.hitlag = 5;
    target.hitlag = 4;
    this.fx.ring(target.x, target.y - 50 * target.scale, target.pal.accent, 44, 12);
    AUDIO.sfx('shieldHit');
    if (target.shieldHP <= 0) target.shieldBreak(this);
  }

  aoeHit(attacker, x, y, radius, dmg, bkb, kbs, angle, o = {}) {
    for (const f of this.fighters) {
      if (f === attacker || f.eliminated) continue;
      if (attacker && this.sameTeam(attacker, f)) continue;
      const d = Math.hypot(f.x - x, (f.y - 50) - (y - 50));
      if (d < radius + 22) {
        if (f.invincible) continue;
        if (f.shieldHP > 0 && !o.final) { this.shieldHit(attacker, f, dmg, null); continue; }
        this.hitFighter(attacker, f, Object.assign({ damage: dmg, bkb, kbs, angle }, o));
      }
    }
  }

  counterAttack(f, atk) {
    this.fx.burst(f.x, f.y - 60, f.pal.accent, 24);
    this.announce('COUNTER!', f.pal.accent, 40);
    AUDIO.sfx('shieldBreak');
    this.aoeHit(f, f.x, f.y - 60, 110, 12 * (f.def.specials.down.mult || 1.3), 30, 80, 45);
    f.invincT = 14;
  }

  findGrabTarget(f) {
    let best = null, bd = 1e9;
    for (const t of this.fighters) {
      if (t === f || t.eliminated || t.grabbedBy || this.sameTeam(f, t)) continue;
      if (t.invincible) continue;
      if (t.state === 'ledge') continue;
      const dx = (t.x - f.x) * f.facing;
      if (dx > -14 && dx < f.def.grabRange + 26 && Math.abs(t.y - f.y) < 76) {
        if (dx < bd) { bd = dx; best = t; }
      }
    }
    return best;
  }

  beginGrab(attacker, target) {
    attacker.grabbing = target; target.grabbedBy = attacker;
    attacker.grabT = 0;
    attacker.state = 'grabbing'; attacker.action = { type: 'holding', dur: 60 };
    target.hitstun = 0;
    AUDIO.sfx('grab');
    this.fx.text(target.x, target.y - 120, 'GRAB', attacker.pal.accent, 22);
  }

  updateGrabs() { }

  pummel(attacker) {
    const t = attacker.grabbing;
    if (!t) return;
    this.hitFighter(attacker, t, { damage: 2, bkb: 3, kbs: 0, angle: 90, pummel: 1, noLaunch: 1 });
    t.hitstun = 0; // keep grabbed
    attacker.grabT = 0;
    AUDIO.sfx('grab');
  }

  throwGrabbed(attacker, dir) {
    const t = attacker.grabbing;
    if (!t) return;
    attacker.grabbing = null; t.grabbedBy = null;
    const throwDmg = attacker.def.throwDmg[dir];
    const cfg = {
      f: { angle: 40, kb: 26 }, b: { angle: 140, kb: 30 }, u: { angle: 88, kb: 28 }, d: { angle: 280, kb: 22 },
    }[dir];
    t.x = attacker.x + attacker.facing * 26; t.y = attacker.y - 20;
    this.hitFighter(attacker, t, { damage: throwDmg, bkb: cfg.kb, kbs: 62, angle: cfg.angle });
    if (dir === 'b') t.vx = -attacker.facing * Math.abs(t.vx);
    AUDIO.sfx('throw');
    attacker.action = { type: 'throw', dur: 22 }; attacker.actionT = 0; attacker.state = 'attack';
    this.fx.burst(t.x, t.y - 50, attacker.pal.accent, 12);
  }

  spawnProjectile(o) {
    const p = new Projectile(o);
    this.projectiles.push(p);
    // bursts (multi-shot burst)
    if (o.burst > 1) {
      for (let i = 1; i < o.burst; i++) {
        const q = new Projectile(Object.assign({}, o));
        q.x += o.vx * 4 * i; q.y += 0;
        q.hitIds = new Set();
        this.projectiles.push(q);
      }
    }
    if (o.spread > 1) {
      for (let i = -1; i <= 1; i++) {
        if (i === 0) continue;
        const q = new Projectile(Object.assign({}, o));
        const a = Math.atan2(o.vy || 0, o.vx) + i * 0.22;
        const sp = Math.hypot(o.vx, o.vy || 0);
        q.vx = Math.cos(a) * sp; q.vy = Math.sin(a) * sp;
        q.hitIds = new Set();
        this.projectiles.push(q);
      }
    }
    return p;
  }
  spawnMine(owner, x, y, dmg, bkb, kbs, angle) {
    this.mines.push(new Mine({ owner, x, y: this.stage.ground.y - 6, damage: dmg, bkb, kbs, angle }));
  }
  spawnSummon(owner, key) {
    this.summons.push(new Summon({ owner, x: owner.x + owner.facing * 50, y: owner.y - 40, kind: key }));
  }

  hitTargets(box, attacker, dmg) {
    if (!this.targets) return;
    for (const t of this.targets) {
      if (t.dead) continue;
      const tb = { x: t.x - 18, y: t.y - 18, w: 36, h: 36 };
      if (!aabb(box, tb)) continue;
      if (t.hp === undefined) t.hp = 3;
      t.hp -= Math.max(1, Math.round(dmg / 5));
      this.fx.hitSpark(t.x, t.y, '#ffd23a', 0.7, 0);
      AUDIO.sfx('hit', { power: 0.5 });
      if (t.hp <= 0) {
        t.dead = true;
        this.fx.explode(t.x, t.y, 46, '#ffd23a');
        AUDIO.sfx('smashBall');
        if (this.multimanOrTargetsScore) this.multimanOrTargetsScore++;
        if (this.targets.every(x => x.dead)) this.announce('ALL TARGETS!', '#ffd23a', 90);
      } else {
        t.x += sign(t.x - (attacker ? attacker.x : t.x)) * 6;
      }
    }
  }

  itemsHitByAttack(f, box, dmg) {
    this.hitTargets(box, f, dmg);
    for (const it of this.items) {
      if (it.heldBy) continue;
      if (aabb(box, it.box)) {
        it.hp = (it.hp || 0) - dmg;
        this.fx.burst(it.x, it.y, it.def.color, 6);
        if (it.smashBall) {
          if (it.hp <= 0) { this.breakSmashBall(it, f); }
        } else if (it.hp <= 0) {
          this.breakContainer(it, f);
        }
      }
    }
  }

  breakSmashBall(it, f) {
    f.hasSmashBall = true;
    it.dead = true; this.smashBallActive = false;
    this.fx.explode(it.x, it.y, 90, '#ffe04a');
    this.announce(f.def.name + ' GETS THE SMASH BALL!', f.pal.accent, 70);
    AUDIO.sfx('smashBall');
    this.cam.zoomPunch(0.4);
  }

  breakContainer(it, f) {
    it.dead = true;
    this.fx.explode(it.x, it.y, it.def.explode ? 100 : 40, it.def.color);
    if (it.def.explode && chance(0.3)) {
      this.aoeHit(f, it.x, it.y, 70, 12, 24, 50, 60);
      AUDIO.sfx('bomb');
    }
    const n = it.def.spawns || 1;
    for (let i = 0; i < n; i++) {
      const key = pick(['food', 'heart', 'tomato', 'beamsword', 'bobomb', 'raygun', 'star', 'shell']);
      const child = new Item(key, it.x + rand(-20, 20), it.y - 10, this);
      child.vy = -4; child.vx = rand(-2, 2);
      this.items.push(child);
    }
    AUDIO.sfx('pickup');
  }

  /* item pickup / use */
  tryPickup(f) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.heldBy || it.spawnT > 0) continue;
      if (it.smashBall) continue;
      if (dist({ x: f.x, y: f.y - 40 }, { x: it.x, y: it.y }) < 40 * f.scale) {
        if (it.def.cat === 'heal') {
          f.damage = Math.max(0, f.damage - it.def.heal);
          this.fx.text(f.x, f.y - 120, '-' + Math.min(it.def.heal, 99) + '%', '#78ff9a', 26);
          this.fx.burst(it.x, it.y, it.def.color, 14);
          it.dead = true; AUDIO.sfx('heal');
          this.triggerChallenge('heal', f);
          return true;
        }
        if (it.def.cat === 'status') {
          this.applyStatus(f, it.type);
          it.dead = true; AUDIO.sfx('pickup');
          return true;
        }
        if (it.def.cat === 'summon') {
          this.spawnSummon(f, it.def.summon);
          it.dead = true; AUDIO.sfx('pickup');
          this.announce('SUMMON!', it.def.color, 40);
          return true;
        }
        if (it.def.cat === 'container') {
          this.breakContainer(it, f);
          return true;
        }
        if (it.def.cat === 'special' && it.type === 'hammer') {
          f.held = it; it.heldBy = f; AUDIO.sfx('pickup');
          return true;
        }
        // equippable
        f.held = it; it.heldBy = f;
        AUDIO.sfx('pickup');
        return true;
      }
    }
    return false;
  }

  applyStatus(f, type) {
    const d = ITEMS[type];
    if (type === 'star') { f.buffs.star = d.dur; }
    if (type === 'mushroom') { f.buffs.mushroom = d.dur; f.buffs.poison = 0; }
    if (type === 'poison') { f.buffs.poison = d.dur; f.buffs.mushroom = 0; }
    if (type === 'metalbox') { f.buffs.metal = d.dur; }
    if (type === 'bunnyhood') { f.buffs.bunny = d.dur; }
    this.fx.burst(f.x, f.y - 50, d.color, 20);
    this.fx.text(f.x, f.y - 130, d.name, d.color, 18);
  }

  useHeld(f) {
    const it = f.held;
    if (!it) return false;
    const d = it.def;
    if (d.cat === 'shoot') {
      if (it.ammo === undefined) it.ammo = d.ammo;
      if (it.ammo <= 0) { f.held = null; it.dead = true; return false; }
      it.ammo--;
      this.spawnProjectile({
        owner: f, x: f.x + f.facing * 26, y: f.y - 56, vx: f.facing * 13, vy: 0,
        damage: d.dmg, bkb: d.bkb, kbs: d.kbs, angle: 30, life: 34, color: d.color, size: d.flame ? 7 : 6, kind: 'bullet',
      });
      if (it.ammo % 2 === 0) AUDIO.sfx('shoot');
      return true;
    }
    if (d.cat === 'batter') {
      this.aoeHit(f, f.x + f.facing * 40, f.y - 56, 60, d.dmg, d.bkb, d.kbs, 40);
      AUDIO.sfx('bat');
      this.cam.shake(4);
      this.fx.swoosh(f, 56);
      return true;
    }
    return false;
  }

  throwHeld(f) {
    const it = f.held;
    if (!it) return;
    f.held = null; it.heldBy = null;
    it.x = f.x + f.facing * 30; it.y = f.y - 60;
    it.vx = f.facing * 11; it.vy = -3;
    it.onGround = false;
    // convert to hazard projectile
    if (it.def.cat === 'throw' || it.type === 'bobomb' || it.type === 'shell') {
      const p = new Projectile({
        owner: f, x: it.x, y: it.y, vx: it.vx, vy: it.vy, damage: it.def.dmg, bkb: it.def.bkb, kbs: it.def.kbs, angle: 40,
        life: 120, color: it.def.color, size: 14, kind: it.type === 'bobomb' ? 'bomb' : 'thrown', grav: 1,
      });
      p.thrownItem = it; it.dead = true;
      this.projectiles.push(p);
      AUDIO.sfx('throw');
      return;
    }
    this.items.push(it);
    AUDIO.sfx('throw');
  }

  /* ---------------- KO ---------------- */
  koFighter(f, killer) {
    if (f.eliminated && f.stocks <= 0) return;
    const isStar = chance(0.35);
    this.fx.burst(f.x, f.y - 50, f.pal.accent, isStar ? 30 : 18, 8);
    this.fx.ring(f.x, f.y - 50, '#ffffff', 120, 26);
    this.cam.shake(isStar ? 12 : 8);
    this.cam.zoomPunch(0.25);
    AUDIO.sfx(isStar ? 'starKO' : 'ko');
    if (f.stocks - 1 > 0) this.announce('KO!', '#ff5a7a', 45);
    f.die(this, killer);
    if (f.stocks <= 0) {
      this.announce(f.def.name + ' ELIMINATED!', '#ff5a7a', 80);
      this.fx.text(f.x, f.y - 140, 'GAME OVER', f.pal.accent, 30);
    }
    this.triggerChallenge('ko', killer);
  }

  checkEnd() {
    const alive = this.fighters.filter(f => f.stocks > 0);
    if (this.rules.teams) {
      const teamsAlive = new Set(alive.map(f => f.team));
      if (teamsAlive.size <= 1 && this.fighters.length > 1) this.endMatch();
    } else if (alive.length <= 1 && this.fighters.length > 1) {
      this.endMatch();
    }
  }

  endByTime() {
    this.matchTime = 0;
    this.endMatch();
  }

  endMatch() {
    if (this.state === 'over') return;
    this.state = 'over'; this.overT = 0;
    // ranking
    const alive = this.fighters.filter(f => f.stocks > 0);
    let winners;
    if (this.rules.teams) {
      const best = {};
      for (const f of this.fighters) best[f.team] = (best[f.team] || 0) + f.stocks;
      const top = Math.max(...Object.values(best));
      winners = this.fighters.filter(f => best[f.team] === top);
    } else {
      winners = alive.length ? alive : [this.fighters.slice().sort((a, b) => b.stocks - a.stocks)[0]];
      if (alive.length > 1) {
        // time mode: compare scores
        const sorted = alive.slice().sort((a, b) => (b.stocks - a.stocks) || (b.stats.kos - a.stats.kos) || (a.damage - b.damage));
        winners = [sorted[0]];
      }
    }
    this.winner = winners;
    this.announce('GAME!', '#ffffff', 120);
    this._modeHandled = Modes.reportMatchEnd(this);
    AUDIO.sfx('game');
    this.slowmo = 40;
    this.cam.zoomPunch(0.8);
    AUDIO.stopMusic();
    SAVE.data.matches++;
    SAVE.save();
    // challs
    if (winners.length && !winners[0].isCPU) this.triggerChallenge('win', winners[0]);
  }

  triggerChallenge(kind, f) {
    if (!f || f.isCPU) return;
    const S = SAVE.data;
    if (kind === 'win' && !S.challengesDone.includes('first_win')) {
      SAVE.challengeDone('first_win'); S.coins += 100; SAVE.save();
    }
    if (kind === 'ko' && f.stats.kos >= 5 && !S.challengesDone.includes('five_ko')) {
      SAVE.challengeDone('five_ko'); S.coins += 150; SAVE.save();
    }
    if (kind === 'damage' && f.damage > 200 && !S.challengesDone.includes('tank')) {
      SAVE.challengeDone('tank'); S.coins += 75; SAVE.save();
    }
    if (kind === 'heal' && !S.challengesDone.includes('heal_up')) {
      SAVE.challengeDone('heal_up'); S.coins += 50; SAVE.save();
    }
  }
}
