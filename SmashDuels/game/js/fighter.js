/* ============================================================
   RIFT RUMBLE — fighter physics + state machine
   ============================================================ */
'use strict';

const FRAME = 1; // logic frame unit

class Fighter {
  constructor(opts) {
    const def = FIGHTERS[opts.key];
    this.def = def;
    this.key = opts.key;
    this.palIdx = opts.palIdx || 0;
    this.pal = def.palettes[this.palIdx % def.palettes.length];
    this.playerIndex = opts.playerIndex;
    this.team = opts.team || 0;
    this.isCPU = !!opts.isCPU;
    this.cpuLevel = opts.cpuLevel || 5;
    this.label = opts.label || 'P' + (opts.playerIndex + 1);
    this.resetAt(opts.x, opts.y, opts.facing || 1);
    this.stocks = opts.stocks ?? 3;
    this.damage = 0;
    this.stats = { kos: 0, falls: 0, sd: 0, dealt: 0, taken: 0, maxCombo: 0 };
    this.cooldowns = {};
    this.buffs = { star: 0, mushroom: 0, poison: 0, metal: 0, bunny: 0, flower: 0 };
    this.held = null;      // item
    this.hasSmashBall = false;
    this.finalSmashUses = 0;
    this.ledgeCD = 0;
    this.techWindow = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.lastHitBy = null;
    this.spawnProtect = 60;
  }

  resetAt(x, y, facing) {
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.facing = facing || 1; this.facingInput = 0;
    this.state = 'idle'; this.stateT = 0; this.animT = 0;
    this.jumpsLeft = this.def.stats.jumps;
    this.airJumpsLeft = this.def.stats.airJumps;
    this.fastfalled = false; this.usedUpB = false; this.usedAirDodge = false;
    this.dashT = 0; this.shieldDodging = false;
    this.hitstun = 0; this.hitlag = 0; this.shakeX = 0; this.shakeY = 0;
    this.invincT = 0; this.respawnT = 0; this.respawnDropT = 0; this.flashT = 0; this.hitT = 0;
    this.shieldHP = 0; this.shieldStun = 0; this.shieldT = 0;
    this.action = null; this.actionT = 0; this.hitIds = new Set();
    this.ledge = null; this.ledgeCD = 0; this.ledgeInvuln = 0;
    this.grabbing = null; this.grabbedBy = null; this.grabT = 0;
    this.groundDist = 0; this.onGround = false;
    this.comboCount = 0; this.comboTimer = 0;
    this.dropThroughT = 0; this.tauntIdx = 0;
    this.chargeT = 0; this.charging = false; this.forceRelease = false; this.attackHoldT = 0;
    this.finalActive = 0; this.finalT = 0;
    this.diX = 0; this.diY = 0;
    this.stunT = 0;
    this.crouchHeld = false;
    this.inputBuffer = { attack: 0, special: 0, jump: 0, shield: 0, grab: 0 };
    this.dirTapT = { left: 99, right: 99, up: 99, down: 99 };
    this.prevInput = {};
    // neutral input so update() is safe before the first readInput()
    this.input = {
      left: false, right: false, up: false, down: false,
      attack: false, special: false, jump: false, shield: false, grab: false,
      leftP: false, rightP: false, upP: false, downP: false,
      attackP: false, specialP: false, jumpP: false, shieldP: false, grabP: false,
    };
    this.touchedWall = false;
    this.staleQueue = [];       // last 10 move keys
  }

  staleMult(key) {
    if (!this.staleQueue) this.staleQueue = [];
    const uses = this.staleQueue.filter(k => k === key).length;
    // 1.0 fresh → ~0.62 at 5+ repeats
    return Math.max(0.62, 1 - uses * 0.075);
  }
  pushStale(key) {
    if (!this.staleQueue) this.staleQueue = [];
    this.staleQueue.push(key);
    while (this.staleQueue.length > 10) this.staleQueue.shift();
  }

  get size() { return this.def.stats.size; }
  get weight() {
    let w = this.def.stats.weight;
    if (this.buffs.metal > 0) w *= 2.6;
    if (this.buffs.mushroom > 0) w *= 1.3;
    if (this.buffs.poison > 0) w *= 0.75;
    return w;
  }
  get scale() {
    let s = this.def.stats.size;
    if (this.buffs.mushroom > 0) s *= 1.35;
    if (this.buffs.poison > 0) s *= 0.72;
    if (this.buffs.metal > 0) s *= 1.06;
    return s;
  }
  get hurtbox() {
    const s = this.scale;
    return { x: this.x - 22 * s, y: this.y - 104 * s, w: 44 * s, h: 104 * s };
  }
  get center() { return { x: this.x, y: this.y - 52 * this.scale }; }
  get invincible() { return this.invincT > 0 || this.respawnT > 0 || this.ledgeInvuln > 0 || this.buffs.star > 0 || this.spawnProtect > 0; }

  speedMul() {
    let m = 1;
    if (this.buffs.bunny > 0) m *= 1.5;
    if (this.buffs.metal > 0) m *= 0.62;
    if (this.buffs.mushroom > 0) m *= 1.15;
    if (this.buffs.poison > 0) m *= 1.05;
    return m;
  }
  jumpMul() {
    let m = 1;
    if (this.buffs.bunny > 0) m *= 1.22;
    if (this.buffs.metal > 0) m *= 0.72;
    if (this.buffs.mushroom > 0) m *= 1.1;
    return m;
  }

  /* ---------------- input normalization ---------------- */
  readInput(raw) {
    const prev = this.prevInput;
    const inp = {
      left: !!raw.left, right: !!raw.right, up: !!raw.up, down: !!raw.down,
      attack: !!raw.attack, special: !!raw.special, jump: !!raw.jump, shield: !!raw.shield, grab: !!raw.grab,
      leftP: !!raw.left && !prev.left, rightP: !!raw.right && !prev.right,
      upP: !!raw.up && !prev.up, downP: !!raw.down && !prev.down,
      attackP: !!raw.attack && !prev.attack, specialP: !!raw.special && !prev.special,
      jumpP: !!raw.jump && !prev.jump, shieldP: !!raw.shield && !prev.shield, grabP: !!raw.grab && !prev.grab,
    };
    this.prevInput = { ...raw };
    // buffers
    for (const k of ['attack', 'special', 'jump', 'shield', 'grab']) {
      if (inp[k + 'P']) this.inputBuffer[k] = 8;
      else if (this.inputBuffer[k] > 0) this.inputBuffer[k]--;
    }
    for (const d of ['left', 'right', 'up', 'down']) {
      if (inp[d + 'P']) this.dirTapT[d] = 0; else this.dirTapT[d] = Math.min(99, this.dirTapT[d] + 1);
    }
    this.input = inp;
    this.attackHoldT = inp.attack ? this.attackHoldT + 1 : 0;
    return inp;
  }
  buf(k) { return this.inputBuffer[k] > 0; }
  consume(k) { this.inputBuffer[k] = 0; }
  horiz() { return (this.input.left ? -1 : 0) + (this.input.right ? 1 : 0); }
  vert() { return (this.input.up ? -1 : 0) + (this.input.down ? 1 : 0); }
  dirIsTap(d) { return this.dirTapT[d] <= 4; }

  /* ---------------- main update ---------------- */
  update(match) {
    this.stateT++; this.animT++; this.hitT++;
    this.comboTimer = Math.max(0, this.comboTimer - 1);
    if (this.comboTimer === 0) this.comboCount = 0;
    for (const k in this.buffs) if (this.buffs[k] > 0) {
      this.buffs[k]--;
      if (this.buffs[k] === 0 && k === 'star') AUDIO.sfx('beep');
    }
    if (this.cooldowns) for (const k in this.cooldowns) if (this.cooldowns[k] > 0) this.cooldowns[k]--;
    this.shakeX = this.shakeY = 0;

    // hitlag freeze
    // KO check first: nobody survives outside the blastzones
    if (!this.eliminated && this.state !== 'respawn' && this.checkBlastNow(match)) return;
    if (this.hitlag > 0) {
      this.hitlag--;
      const amt = Math.min(3.2, this.hitlag * 0.7);
      this.shakeX = rand(-amt, amt); this.shakeY = rand(-amt, amt);
      return;
    }

    if (this.flashT > 0) this.flashT--;
    if (this.invincT > 0) this.invincT--;
    if (this.respawnT > 0) { this.respawnT--; this.updateRespawn(match); return; }
    if (this.spawnProtect > 0) this.spawnProtect--;
    if (this.ledgeCD > 0) this.ledgeCD--;
    if (this.ledgeInvuln > 0) this.ledgeInvuln--;
    if (this.shieldStun > 0) this.shieldStun--;
    if (this.stunT > 0) { this.stunT--; this.applyPhysics(match); return; }
    if (this.dropThroughT > 0) this.dropThroughT--;
    if (this.respawnDropT > 0) this.respawnDropT--;

    // buffs visuals: flower damage
    if (this.buffs.flower > 0 && this.stateT % 40 === 0) this.takeDamage(1, this, match, { ignoreKB: true, noSound: true });

    // ---- final smash active
    if (this.finalActive > 0) { this.updateFinalSmash(match); return; }

    // ---- hitstun
    if (this.hitstun > 0) {
      this.hitstun--;
      // DI
      const diX = (this.input.left ? -1 : 0) + (this.input.right ? 1 : 0);
      const diY = (this.input.up ? -1 : 0) + (this.input.down ? 1 : 0);
      if (diX || diY) {
        // rotate the launch vector perpendicular to its direction (classic DI)
        const sp = Math.hypot(this.vx, this.vy);
        const ang = Math.atan2(this.vy, this.vx);
        const perp = Math.atan2(diY, diX) + Math.PI / 2;
        let diff = perp - ang;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        const newAng = ang + sign(diff) * Math.min(Math.abs(diff), 0.20);
        this.vx = Math.cos(newAng) * sp;
        this.vy = Math.sin(newAng) * sp;
      }
      this.state = this.onGround ? 'hitstun' : 'launch';
      this.applyPhysics(match);
      if (this.checkBlast(match)) return;
      // tech window
      if (this.input.shieldP && !this.onGround) this.techWindow = 22;
      if (this.techWindow > 0) this.techWindow--;
      if (this.onGround) this.state = 'hitstun';
      return;
    }

    // ---- grabbed by someone
    if (this.grabbedBy) {
      const g = this.grabbedBy;
      this.x = g.x + g.facing * 30 * g.scale; this.y = g.y - 2;
      this.vx = this.vy = 0;
      this.state = 'grabbed';
      this.facing = -g.facing;
      return;
    }

    // ---- ledge
    if (this.state === 'ledge') { this.updateLedge(match); return; }

    // ---- action states that lock movement
    if (this.state === 'attack' || this.state === 'special' || this.state === 'grab' || this.state === 'grabbing' || this.state === 'spotdodge' || this.state === 'roll' || this.state === 'airdodge' || this.state === 'land') {
      if (this.updateAction(match)) return;
    }

    // stale 'launch' with no hitstun → normal aerial drift
    if (this.state === 'launch' && this.hitstun <= 0) this.state = this.onGround ? 'idle' : 'fall';

    // ---- shield
    this.updateShield(match);

    // ---- final smash activation
    if (this.hasSmashBall && this.buf('special') && this.onGroundish() && this.canAct()) {
      this.startFinalSmash(match); return;
    }

    // ---- actions & movement
    if (this.canAct()) this.handleActions(match);
    if (this.canMove()) this.handleMovement(match);
    this.applyPhysics(match);
    this.checkBlast(match);
  }

  canAct() {
    return !this.grabbedBy && this.state !== 'grabbed' && this.ledge !== 'hang' &&
      ['idle', 'walk', 'run', 'crouch', 'air', 'jump', 'land', 'shield', 'fall', 'doublejump', 'helpless', 'taunt'].includes(this.state) &&
      this.shieldStun <= 0 && this.stunT <= 0;
  }
  canMove() {
    return ['idle', 'walk', 'run', 'crouch', 'air', 'jump', 'shield', 'fall', 'doublejump', 'helpless', 'land'].includes(this.state);
  }
  onGroundish() { return this.onGround; }
  airborne() { return !this.onGround && this.state !== 'ledge'; }

  /* ---------------- movement ---------------- */
  handleMovement(match) {
    const st = this.def.stats;
    const inp = this.input;
    const h = this.horiz();
    const spd = this.speedMul();

    if (this.onGround) {
      // crouch
      if (inp.down && this.state !== 'land' && !this.held) {
        this.state = 'crouch'; this.vx = approach(this.vx, 0, st.traction * 2);
        // drop through platform
        if (inp.downP && this.onPlatform) { this.dropThroughT = 12; this.y += 6; this.onGround = false; this.onPlatform = null; }
        return;
      }
      if (h !== 0) {
        const prevFacing = this.facing;
        this.facing = h;
        // a fresh tap in a direction (or a reversal) starts a dash
        const tapped = h > 0 ? this.dirIsTap('right') : this.dirIsTap('left');
        const reversing = prevFacing !== h;
        if (tapped || reversing || this.dashT > 0) {
          if (this.dashT === undefined || this.dashT <= 0) this.dashT = st.dashFrames;
          this.dashT--;
        } else if (this.dashT > 0) this.dashT--;

        // speed tiers: tap = dash burst, holding keeps the run, releasing drops to walk
        const dashing = this.dashT > 0;
        const wasRunning = this.state === 'run';
        const target = h * ((dashing || wasRunning) ? st.run : st.walk) * spd;
        const accel = st.traction * ((dashing || wasRunning) ? 1.5 : 1.6);
        this.vx = approach(this.vx, target, accel);
        this.state = Math.abs(this.vx) > st.walk * 1.12 ? 'run' : 'walk';
      } else {
        this.dashT = 0;
        this.vx = approach(this.vx, 0, st.traction * 2.2);
        if (Math.abs(this.vx) < 0.25 && this.state !== 'land') this.state = this.shieldHP > 0 ? 'shield' : 'idle';
      }
      // jumps (jump button only — up-tap jump removed so up+attack can be utilts)
      if (this.buf('jump')) { this.tryJump(match); return; }
    } else {
      // air
      if (h !== 0) this.facing = h;
      const target = h * st.air * spd * (this.fastfalled ? 1.05 : 1);
      const accel = st.airAccel * (this.hitstun > 0 ? 0 : 1);
      this.vx = approach(this.vx, target, accel);
      this.state = this.vy < -0.5 ? 'jump' : (this.fastfalled ? 'fastfall' : 'fall');
      if (this.def.stats.jumps > 2 && this.airJumpsLeft > 0 && this.vy < 0) this.state = this.vy < -1 ? 'jump' : 'fall';
      // fast fall
      if (inp.downP && this.vy > -1.5 && !this.fastfalled) { this.fastfalled = true; this.vy = Math.max(this.vy, 2); }
      // jumps in air
      if (this.buf('jump')) { this.tryJump(match); }
    }
  }

  tryJump(match) {
    const st = this.def.stats;
    if (this.onGround) {
      this.consume('jump');
      this.vy = -st.jumpV * this.jumpMul();
      this.onGround = false; this.onPlatform = null;
      this.fastfalled = false; this.usedAirDodge = false;
      this.jumpsLeft = st.jumps; this.airJumpsLeft = st.airJumps;
      this.state = 'jump';
      this.jumpHoldT = 8; this.jumpCut = true;
      AUDIO.sfx('jump');
      match.fx.ring(this.x, this.y, this.pal.accent, 18);
      return true;
    }
    if (this.airJumpsLeft > 0) {
      this.consume('jump');
      this.airJumpsLeft--;
      this.jumpsLeft = this.airJumpsLeft;
      this.vy = -st.djumpV * this.jumpMul();
      this.vx += this.horiz() * 1.2;
      this.fastfalled = false;
      this.state = 'doublejump'; this.animT = 0;
      AUDIO.sfx('djump');
      match.fx.ring(this.x, this.y - 20, this.pal.accent, 26);
      return true;
    }
    return false;
  }

  applyPhysics(match) {
    const st = this.def.stats;
    const gScale = this.buffs.metal > 0 ? 1.9 : 1;
    let maxFall = (this.fastfalled ? st.fastfall : st.fall) * (this.buffs.bunny > 0 ? 0.85 : 1) * gScale;
    if (this.state === 'helpless') maxFall *= 1.15;
    if (this.vy < 0 && this.jumpHoldT > 0 && this.jumpCut && !this.input.jump) { this.vx *= 0.99; this.vy *= 0.55; this.jumpHoldT = 0; }
    if (this.jumpHoldT > 0) this.jumpHoldT--;
    const grav = st.gravity * gScale * (this.vy > 0 ? 1.15 : 1);
    this.vy = Math.min(this.vy + grav, maxFall);
    if (this.hitstun <= 0 && this.state !== 'launch') this.vx *= 0.995;

    this.x += this.vx;
    this.y += this.vy;

    // stage collision
    const stage = match.stage;
    const gd = stage.ground;
    const wasGrounded = this.onGround;
    const wasY = this.y;
    this.onGround = false; this.onPlatform = null;

    // drop-through
    if (this.dropThroughT > 0) { }
    else {
      // main platform top — solid from above only, never snapped up from below
      if (this.x > gd.x - 16 && this.x < gd.x + gd.w + 16) {
        const top = gd.y;
        const crossed = this.y - this.vy <= top + 2;   // was above the surface last frame
        if (this.y >= top - 1 && this.vy >= 0 && crossed) {
          if (wasGrounded) {
            // already standing — just rest on the surface
            this.y = top; this.vy = 0; this.onGround = true;
          } else {
            this.landOn(top, match, false);
          }
        }
      }
      // platforms
      for (const p of stage.platforms) {
        if (this.respawnDropT > 0) break;              // drop-in ignores soft platforms
        const px = p.cx !== undefined ? p.cx : p.x, py = p.cy !== undefined ? p.cy : p.y;
        if (this.x > px - 4 && this.x < px + p.w + 4 && !(this.input.down && this.state === 'crouch')) {
          if (this.y >= py && this.y - this.vy <= py + 2) {
            if (wasGrounded) { this.y = py; this.vy = 0; this.onGround = true; this.onPlatform = p; }
            else this.landOn(py, match, true, p);
          }
        }
      }
    }
    this.prevY = this.y;

    // the stage slab is solid from the sides; see confine()
    this.confine(gd);
  }

  /* Keep a fighter out of the stage slab.
   *
   * This used to teleport anyone below `gd.y + 20` to a fixed offset outside
   * the platform (±24px).  That had no lower bound, so a fighter knocked past
   * the side of the stage was yanked sideways mid-fall, and combined with the
   * separation clamp in Match it pinned 3-4 fighters against an invisible
   * wall — the jitter/pinning at the stage edges, worst in 4v4/4-player.
   * Now the slab is resolved as a real body, only while they are actually
   * inside its vertical span, so they slide down the outside and get KO'd at
   * the blast zone like any other. */
  confine(gd) {
    if (this.isMob) return;                     // mobs walk through, by design
    const half = 24 * this.scale;
    if (this.y > gd.y + 2 && this.y < gd.y + gd.h + 14) {
      if (this.x > gd.x - half && this.x < gd.x + half) {
        this.x = gd.x - half;
        if (this.vx > 0) this.vx = -this.vx * 0.22;
      } else if (this.x > gd.x + gd.w - half && this.x < gd.x + gd.w + half) {
        this.x = gd.x + gd.w + half;
        if (this.vx < 0) this.vx = -this.vx * 0.22;
      }
    }
  }

  /* How hard this fighter is to shove around (used by the separation solver). */
  pushResist() {
    let r = 1 + (this.weight - 100) / 240;
    if (this.onGround) r += 0.9;
    if (this.shieldHP > 0 || this.state === 'shield') r += 0.6;
    if (this.state === 'ledge') r += 1.4;        // ledge hangs are tenacious
    if (this.hitstun > 0 || this.state === 'launch' || this.state === 'helpless') r -= 0.6;
    if (this.state === 'roll' || this.state === 'airdodge') r -= 0.25;
    return Math.max(0.3, r);
  }

  landOn(top, match, platform, p) {
    const impact = this.vy;
    this.y = top; this.vy = 0; this.onGround = true;
    this.onPlatform = p || null;
    if (this.respawnDropT > 0 && !platform) this.respawnDropT = 0;
    this.airJumpsLeft = this.def.stats.airJumps;
    this.jumpsLeft = this.def.stats.jumps;
    this.fastfalled = false; this.usedUpB = false; this.usedAirDodge = false;
    this.ledge = null; this.ledgeInvuln = 0;
    // tech
    if (this.hitstun > 0 || this.techWindow > 0) {
      if (this.input.shield || this.input.shieldP) { this.startTech(match); return; }
      // hard landing from hitstun → bounce
      this.hitstun = Math.floor(this.hitstun * 0.18);
      this.vy = -Math.abs(impact) * 0.24;
      if (Math.abs(this.vy) < 1.2) { this.vy = 0; this.hitstun = Math.min(this.hitstun, 4); }
      this.y -= 1; this.onGround = false;
      match.fx.dust(this.x, this.y, 8, this.pal.accent);
      AUDIO.sfx('land');
      return;
    }
    if (this.hitstun <= 0 && this.state !== 'attack' && this.state !== 'shield' && this.state !== 'special' && this.state !== 'land') {
      this.state = 'land'; this.stateT = 0;
      this.landLag = impact > 14 ? 9 : 4;
      this.action = { type: 'landing', dur: this.landLag };
      this.actionT = 0;
    }
    if (impact > 4) {
      match.fx.dust(this.x, this.y, Math.min(10, 2 + impact * 0.4), '#ffffff');
      if (impact > 10) match.cam.shake(Math.min(6, impact * 0.3));
      AUDIO.sfx('land');
    }
  }

  startTech(match) {
    this.hitstun = 0; this.techWindow = 0;
    this.invincT = 22;
    this.state = 'land'; this.action = { type: 'landing', dur: 14 };
    this.techDir = (this.input.left ? -1 : this.input.right ? 1 : 0);
    if (this.techDir !== 0) { this.vx = this.techDir * 6; this.vy = -2; this.onGround = false; }
    match.fx.ring(this.x, this.y, '#ffffff', 28);
    AUDIO.sfx('dodge');
    match.fx.text(this.x, this.y - 110, 'TECH!', '#ffffff');
  }

  /* ---------------- shield ---------------- */
  updateShield(match) {
    if (this.grabbedBy) return;
    if (this.input.shield && this.onGround && this.canAct() && this.shieldHP === 0 && this.shieldStun <= 0 && !this.held) {
      // shorthop guard: shield + direction = roll
      const h = this.horiz();
      if (this.input.leftP || this.input.rightP) {
        this.startRoll(h, match); return;
      }
      if (this.input.downP) { this.startSpotDodge(match); return; }
      this.shieldHP = 60; this.shieldT = 0;
      this.state = 'shield';
      AUDIO.sfx('shieldUp');
    }
    if (this.shieldHP > 0) {
      this.shieldT++;
      // drain
      this.shieldHP -= 0.12 + (this.shieldT > 260 ? 0.4 : 0);
      if (this.input.shieldP && this.shieldT > 0) { }
      // roll / dodge out of shield
      if (this.input.leftP || this.input.rightP) this.startRoll(this.horiz(), match);
      else if (this.input.downP) this.startSpotDodge(match);
      else if (this.input.jumpP) { this.shieldHP = 0; this.tryJump(match); }
      else if (this.input.attackP) { this.shieldHP = 0; this.startGrab(match); }
      if (!this.input.shield) { this.shieldHP = 0; if (this.state === 'shield') this.state = 'idle'; }
      // only break from sustained depletion, never as a side-effect of rolling/dodging
      if (!this.shieldDodging && this.shieldHP <= 0 && this.state === 'shield') { this.shieldBreak(match); }
    }
    // shield regen
    if (this.shieldHP === 0 && !this.input.shield) this.shieldRegen = (this.shieldRegen || 0) + 0.08;
    if (this.shieldRegen > 0) {
      if (this.shieldRegen > 1) this.shieldRegen -= 1;
      else { this.shieldRegen = 0; }
    }
  }

  shieldBreak(match) {
    this.shieldHP = 0; this.stunT = 180;
    this.state = 'hitstun'; this.hitstun = 0;
    AUDIO.sfx('shieldBreak');
    match.fx.burst(this.x, this.y - 50, this.pal.accent, 30);
    match.fx.text(this.x, this.y - 120, 'SHIELD BREAK!', '#ff5a7a');
    match.cam.shake(10);
    this.shieldT = 0;
  }

  startRoll(dir, match) {
    if (dir === 0) dir = this.facing;
    this.shieldDodging = true; this.shieldHP = 0;
    this.state = 'roll'; this.action = { type: 'roll', dur: 26 }; this.actionT = 0;
    this.rollDir = dir; this.invincT = 16;
    // facing is NOT snapped to the roll direction: a back-roll should still
    // leave you looking at the opponent, and the old snap left every roll
    // ending face-first into thin air (the "facing wrong way" report).
    AUDIO.sfx('dodge');
  }
  startSpotDodge(match) {
    this.shieldDodging = true; this.shieldHP = 0;
    this.state = 'spotdodge'; this.action = { type: 'spotdodge', dur: 22 }; this.actionT = 0;
    this.invincT = 14;
    AUDIO.sfx('dodge');
  }
  startAirDodge(match) {
    this.usedAirDodge = true;
    this.state = 'airdodge'; this.action = { type: 'airdodge', dur: 26 }; this.actionT = 0;
    this.invincT = 18;
    const h = this.horiz(), v = this.vert();
    if (h || v) { this.vx = h * 5.4; this.vy = v * 5.4 * 0.8; }
    else this.vx *= 0.3;
    this.fastfalled = false;
    AUDIO.sfx('dodge');
  }

  /* ---------------- attacks ---------------- */
  /* true when a direction was tapped within 3 frames of the attack press */
  smashInput() {
    const d = this.dirTapT || {};
    const fresh = Math.min(d.left ?? 99, d.right ?? 99, d.up ?? 99, d.down ?? 99);
    return fresh <= 3;
  }

  attackTypeFor() {
    const inp = this.input;
    const h = this.horiz(), v = this.vert();
    const smash = this.smashInput();
    if (this.onGround) {
      if (Math.abs(this.vx) > this.def.stats.walk * 1.12 || this.state === 'run') return 'dashattack';
      if (v < 0 || (this.dirIsTap('up') && this.input.up)) return smash ? 'usmash' : 'utilt';
      if (v > 0 || (this.dirIsTap('down') && this.input.down)) return smash ? 'dsmash' : 'dtilt';
      if (h !== 0) return smash ? 'fsmash' : 'ftilt';
      return 'jab';
    } else {
      if (v < 0) return 'uair';
      if (v > 0) return 'dair';
      if (h !== 0) return (h === this.facing) ? 'fair' : 'bair';
      return 'nair';
    }
  }

  startAttack(kind, match) {
    const m = this.def.moves[kind];
    if (!m) return;
    this.state = 'attack';
    this.action = Object.assign({}, m, {
      dur: m.frames, type: 'move', key: kind,
      poseType: kind === 'jab' ? 'jab' : kind.includes('air') ? 'air' : kind.includes('smash') ? 'smash' : 'swing',
      dir: kind.startsWith('u') ? 'u' : kind.startsWith('d') ? 'd' : 'f',
      aerialDir: kind === 'nair' ? 'n' : kind === 'fair' ? 'f' : kind === 'bair' ? 'b' : kind === 'uair' ? 'u' : 'd',
      charge: !!m.charge, dirFacing: this.facing,
    });
    this.actionT = 0; this.hitIds = new Set();
    this.charging = false; this.chargeT = 0; this.forceRelease = false;
    if (!this.onGround) this.vy = Math.min(this.vy, 0) * 0.4; // slight float
    AUDIO.sfx('swing');
    match.fx.swoosh(this, m.reach || 40);
    // small forward lunge for ground attacks
    if (this.onGround && (kind === 'ftilt' || kind === 'fsmash')) this.vx += this.facing * (kind === 'fsmash' ? 1.6 : 1.0);
  }

  startGrab(match) {
    // grabs auto-turn toward their target (Melee-style).  Use the same
    // candidate set the grab tests, so the animation and the hitbox agree;
    // fall back to the nearest opponent so a whiffed grab still faces out.
    let t = match && match.findGrabTarget ? match.findGrabTarget(this) : null;
    if (!t && match) {
      let bd = 200;
      for (const o of match.fighters) {
        if (o === this || o.eliminated || o.grabbedBy) continue;
        if (match.sameTeam && match.sameTeam(this, o)) continue;
        const d = Math.abs(o.x - this.x);
        if (d < bd && Math.abs(o.y - this.y) < 84) { bd = d; t = o; }
      }
    }
    if (t && Math.abs(t.x - this.x) > 2) this.facing = t.x > this.x ? 1 : -1;
    this.state = 'grab';
    this.action = { type: 'grabbing', dur: 30, poseType: 'grab', dir: 'f' };
    this.actionT = 0; this.grabAttempt = true;
    AUDIO.sfx('swing');
  }

  startSpecial(dir, match) {
    const sp = dir === 'n' ? this.def.specials.neutral : dir === 's' ? this.def.specials.side : dir === 'u' ? this.def.specials.up : this.def.specials.down;
    if (!sp) return;
    if (sp.cooldown && (this.cooldowns[dir] || 0) > 0) return;
    this.state = 'special';
    // keep the move's own kind (projectile / dash / recover / counter / mine …)
    // — overwriting `type` with 'special' made every special-type branch dead
    this.action = Object.assign({}, sp, { dur: sp.frames, kind: 'special', specialType: sp.type, type: 'special', specialKey: dir, poseType: 'special', specialDir: dir });
    this.actionT = 0; this.hitIds = new Set(); this.specPhase = 'startup';
    if (sp.cooldown) this.cooldowns[dir] = sp.cooldown;
    this.specialData = { fired: 0, timer: 0, projFired: false, orbFired: false, dashFired: false, tpFired: false, lassoFired: false, riseHit: false, mineFired: false };
    if (dir === 'u') { this.usedUpB = true; }
    AUDIO.sfx('swing');
  }

  handleActions(match) {
    const inp = this.input;
    // item pickup
    if (!this.held) match.tryPickup(this);
    // aerial dodge
    if (!this.onGround && this.buf('shield') && !this.usedAirDodge) { this.consume('shield'); this.startAirDodge(match); return; }
    // grab
    if (this.buf('grab') || (this.buf('shield') && this.buf('attack'))) {
      this.consume('grab'); this.consume('attack');
      this.startGrab(match); return;
    }
    // held item: attack swings, shield throws
    if (this.held) {
      if (this.buf('attack')) { this.consume('attack'); this.state='attack'; this.action={type:'item',dur:24}; this.actionT=0; match.useHeld(this); return; }
      if (this.buf('shield')) { this.consume('shield'); this.state='attack'; this.action={type:'item',dur:20}; this.actionT=0; match.throwHeld(this); return; }
    }
    // attack — one press = one move. A held button does NOT auto-repeat, so
    // releasing always returns to idle; tapping again chains a fresh jab.
    if (this.buf('attack')) {
      this.consume('attack');
      const kind = this.attackTypeFor();
      this.startAttack(kind, match);
      match.fx.swoosh(this, 30);
      return;
    }
    // specials
    if (this.buf('special')) {
      this.consume('special');
      const h = this.horiz(), v = this.vert();
      let dir = 'n';
      if (v < 0) dir = 'u'; else if (v > 0) dir = 'd'; else if (h !== 0) dir = 's';
      this.startSpecial(dir, match);
      return;
    }
    // taunt (down while idle on ground and not crouching handled in movement) — tap up on idle = taunt
    if (inp.upP && this.onGround && !this.held && this.state === 'idle') {
      // up-tap is a jump by default; taunt assigned to holding down+shield? keep jump priority
    }
  }

  updateAction(match) {
    const a = this.action;
    if (!a) { this.state = 'idle'; return false; }
    this.actionT++;
    const t = this.actionT;

    /* charge smashes */
    if (a.charge && a.type === 'move' && !this.forceRelease) {
      if (this.charging) {
        this.chargeT++;
        this.vx *= 0.7;
        // release: stop charging and let the timer run into the active window
        if (!this.input.attack || this.chargeT >= 60) {
          this.charging = false;
          this.forceRelease = true;
          this.actionT = Math.max(this.actionT, a.startup - 1);
        } else {
          match.fx.charge(this.x, this.y - 60, this.pal.accent, this.chargeT);
        }
      } else if (t === a.startup - 1 && this.input.attack) {
        // arm the charge exactly once, on the last startup frame
        this.charging = true; this.chargeT = 0;
        this.actionT = a.startup - 1;
      }
    }

    const dur = a.dur || 30;
    const ended = t >= dur;
    // a new active window must be able to hit the same target again
    if (a.type === 'move' && t === a.startup + (a.active || 0) + 1) this.hitIds.clear();

    // resolve hitboxes
    if (a.type === 'move') {
      const activeStart = a.startup, activeEnd = a.startup + a.active;
      if (t >= activeStart && t <= activeEnd) this.checkHit(match, this.smashMultiplier());
      else if (a.multi && t > activeEnd) { /* multi hit later frames */ }
    }
    if (a.type === 'special') this.updateSpecial(match, a, t);
    if (a.type === 'item') {
      if (ended) { this.action=null; this.state='idle'; }
      return !ended;
    }
    if (a.type === 'holding') {
      // holding a grabbed opponent
      const t = this.grabbing;
      if (!t || t.eliminated) { this.grabbing = null; if (t) t.grabbedBy = null; this.action=null; this.state='idle'; return false; }
      const inp = this.input;
      if (inp.attackP) { match.pummel(this); this.actionT = 0; }
      if (inp.leftP || this.input.left && this.actionT > 4 && this.dirIsTap('left')) { match.throwGrabbed(this, 'b'); return true; }
      if (this.dirIsTap('right')) { match.throwGrabbed(this, 'f'); return true; }
      if (this.dirIsTap('up')) { match.throwGrabbed(this, 'u'); return true; }
      if (this.dirIsTap('down')) { match.throwGrabbed(this, 'd'); return true; }
      if (inp.upP) { match.throwGrabbed(this, 'u'); return true; }
      if (inp.downP) { match.throwGrabbed(this, 'd'); return true; }
      if (inp.leftP) { match.throwGrabbed(this, 'b'); return true; }
      if (inp.rightP) { match.throwGrabbed(this, 'f'); return true; }
      if (t >= 60) { match.throwGrabbed(this, 'f'); return true; }
      return true;
    }
    if (a.type === 'grabbing') {
      // grab check on first active frames
      if (t >= 4 && t <= 12 && this.grabAttempt) {
        const target = match.findGrabTarget(this);
        if (target) { this.grabAttempt = false; match.beginGrab(this, target); }
      }
      if (t > 12) this.grabAttempt = false;
    }
    if (a.type === 'roll') {
      const p = t / a.dur;
      this.vx = this.rollDir * 6.5 * (1 - p);
      this.vy = 0;
    }
    if (a.type === 'airdodge') {
      this.vx *= 0.95; this.vy *= 0.95;
    }
    if (a.type === 'landing') { this.vx *= 0.8; }

    if (ended || (a.cancelable && t > a.cancelable)) {
      this.shieldDodging = false;
      if (this.state === 'roll' || this.state === 'spotdodge' || this.state === 'airdodge') this.invincT = Math.min(this.invincT, 2);
      this.action = null; this.actionT = 0; this.charging = false; this.chargeT = 0; this.forceRelease = false;
      this.state = this.onGround ? 'idle' : 'fall';
      return false;
    }
    return true;
  }

  smashMultiplier() {
    if (!this.action || !this.action.charge) return 1;
    const c = clamp(this.chargeT / 60, 0, 1);
    return 1 + c * 0.55;
  }

  updateSpecial(match, a, t) {
    const s = this.specialData || (this.specialData = { fired: 0, timer: 0 });
    // shadow `sp` with the move's own kind so `sp.type` means projectile/dash/etc.
    const sp = Object.assign({}, a, { type: a.specialType || a.type });
    s.timer++;
    switch (sp.specialKey) {
      case 'n': {
        if (sp.type === 'projectile' && t >= sp.startup && !s.projFired) { s.projFired = true;
          match.spawnProjectile({
            owner: this, x: this.x + this.facing * 26, y: this.y - 56,
            vx: this.facing * (sp.big ? 7.5 : 9), damage: sp.damage, bkb: sp.bkb, kbs: sp.kbs, angle: sp.angle,
            life: 80, color: this.pal.accent, size: sp.big ? 15 : 10, kind: 'bolt', pierce: sp.pierce,
            burst: sp.burst || 1, spread: sp.spread || 1,
          });
          AUDIO.sfx('shoot');
          match.fx.muzzle(this.x + this.facing * 30, this.y - 56, this.pal.accent, this.facing);
        }
        if (sp.type === 'orb' && t >= sp.startup && !s.orbFired) { s.orbFired = true;
          match.spawnProjectile({
            owner: this, x: this.x + this.facing * 40, y: this.y - 60,
            vx: this.facing * 1.2, damage: sp.damage, bkb: sp.bkb, kbs: sp.kbs, angle: sp.angle,
            life: 110, color: this.pal.accent, size: 26, kind: 'orb', pull: 1, static: true,
          });
          AUDIO.sfx('shoot');
        }
        break;
      }
      case 's': {
        if (sp.type === 'dash' && t >= sp.startup && !s.dashFired) { s.dashFired = true;
          this.vx = this.facing * 12; this.vy = sp.float ? -1.4 : 0;
          this.invincT = Math.max(this.invincT, 6);
          AUDIO.sfx('dodge');
          match.fx.speedLines(this);
        }
        if (sp.type === 'teleport' && t >= sp.startup && !s.tpFired) { s.tpFired = true;
          const nx = clamp(this.x + this.facing * sp.dist, WORLD.blast.left + 40, WORLD.blast.right - 40);
          match.fx.burst(this.x, this.y - 50, this.pal.accent, 18);
          this.x = nx;
          this.invincT = Math.max(this.invincT, 8);
          match.fx.burst(this.x, this.y - 50, this.pal.accent, 18);
          AUDIO.sfx('dodge');
          // hit along path
          match.aoeHit(this, this.x, this.y - 60, 70, sp.damage, sp.bkb, sp.kbs, sp.angle);
        }
        if (sp.type === 'lasso' && t >= sp.startup && !s.lassoFired) { s.lassoFired = true;
          match.spawnProjectile({ owner: this, x: this.x + this.facing * 26, y: this.y - 56, vx: this.facing * 14, damage: sp.damage, bkb: sp.bkb, kbs: sp.kbs, angle: sp.angle, life: 22, color: this.pal.accent, size: 9, kind: 'lasso', pull: 1 });
          AUDIO.sfx('shoot');
        }
        break;
      }
      case 'u': {
        if (sp.type === 'recover') {
          // rise during early frames
          if (t >= sp.startup && t < sp.startup + 20) {
            this.vy = -sp.rise * (1 - (t - sp.startup) / 26);
            this.vx = lerp(this.vx, this.horiz() * sp.drift + this.facing * sp.drift * 0.4, 0.25);
            this.hitstun = 0;
          }
          if (t >= sp.startup + 2 && !s.riseHit) { s.riseHit = true;
            match.aoeHit(this, this.x, this.y - 70, 62, sp.damage, sp.bkb, sp.kbs, sp.angle);
            AUDIO.sfx('swing');
            match.fx.burst(this.x, this.y - 40, this.pal.accent, 14);
          }
        }
        if (sp.type === 'teleport' && t >= sp.startup && !s.tpFired) { s.tpFired = true;
          const up = sp.dist || 200;
          match.fx.burst(this.x, this.y - 50, this.pal.accent, 20);
          this.y = Math.max(WORLD.blast.top + 80, this.y - up);
          this.vy = -2; this.vx = this.horiz() * 4;
          this.invincT = Math.max(this.invincT, 10);
          match.fx.burst(this.x, this.y - 50, this.pal.accent, 20);
          AUDIO.sfx('dodge');
        }
        break;
      }
      case 'd': {
        if (sp.type === 'counter') {
          this.counterActive = t <= sp.window;
          if (this.counterHit) {
            // triggered
            const atk = this.counterHit;
            match.counterAttack(this, atk);
            this.counterHit = null; this.counterActive = false;
            this.actionT = sp.frames;
          }
        }
        if (sp.type === 'mine' && t >= sp.startup && !s.mineFired) { s.mineFired = true;
          match.spawnMine(this, this.x, this.y, sp.damage, sp.bkb, sp.kbs, sp.angle);
          AUDIO.sfx('itemSpawn');
        }
        break;
      }
    }
  }

  checkHit(match, mult = 1) {
    const a = this.action;
    const boxes = a.hitboxes;
    if (!boxes) return;
    const t = this.actionT - a.startup;
    for (const b of boxes) {
      if (t < (b.t0 || 0) || t > (b.t1 === undefined ? 99 : b.t1)) continue;
      const wx = this.x + (b.x + b.w / 2) * this.facing * this.scale - (b.w / 2) * this.scale;
      const wy = this.y + b.y * this.scale;
      const box = { x: this.facing > 0 ? this.x + b.x * this.scale : this.x - (b.x + b.w) * this.scale, y: this.y + b.y * this.scale, w: b.w * this.scale, h: b.h * this.scale };
      for (const target of match.fighters) {
        if (target === this || target.eliminated) continue;
        if (match.sameTeam(this, target)) continue;
        if (this.hitIds.has(target.id)) continue;
        if (target.invincible) continue;
        if (!aabb(box, target.hurtbox)) continue;
        // shield?
        if (target.shieldHP > 0 && !a.grab) {
          this.hitIds.add(target.id);
          match.shieldHit(this, target, a.damage, box);
          continue;
        }
        if (target.counterActive) {
          target.counterHit = this; target.counterActive = false;
          this.hitIds.add(target.id);
          continue;
        }
        this.hitIds.add(target.id);
        const stale = this.staleMult(a.key || 'jab');
        this.pushStale(a.key || 'jab');
        match.hitFighter(this, target, {
          damage: a.damage * mult * stale,
          bkb: a.bkb, kbs: a.kbs, angle: a.angle, spike: a.spike,
          heavy: a.charge ? 1 : 0, smashMult: mult,
        });
      }
      // hit items too
      match.itemsHitByAttack(this, box, a.damage);
    }
  }

  /* ---------------- damage ---------------- */
  takeDamage(dmg, attacker, match, opts = {}) {
    if (this.invincible && !opts.ignoreInv) return;
    this.damage = Math.min(999, this.damage + dmg);
    this.stats.taken += dmg;
    if (attacker && attacker !== this) attacker.stats.dealt += dmg;
    if (!opts.ignoreKB) {
      // GDD formula: kb = base + scaling * damage%
      const weightFactor = Math.pow(100 / this.weight, 0.62);
      const kb = (opts.bkb || 6 + (opts.kbs || 30) * 0) ;
      // handled by match.hitFighter
    }
    if (dmg >= 1) this.flashT = 6;
  }

  /* ---------------- ledge ---------------- */
  tryLedgeGrab(match) {
    if (this.ledgeCD > 0 || this.state === 'ledge' || this.usedUpB && this.ledgeGrabsThisAir === 1) return;
    const gd = match.stage.ground;
    if (this.vy < -1) return;
    const edges = [{ side: -1, x: gd.x }, { side: 1, x: gd.x + gd.w }];
    for (const e of edges) {
      if (Math.abs(this.x - e.x) < 30 && Math.abs(this.y - gd.y) < 40 && this.y > gd.y - 70) {
        // must be approaching from outside/below
        this.snapLedge(match, e.side, e.x);
        return true;
      }
    }
    return false;
  }
  snapLedge(match, side, edgeX) {
    this.state = 'ledge'; this.ledge = { side, x: edgeX };
    this.x = edgeX + side * 14; this.y = match.stage.ground.y - 8;
    this.vx = this.vy = 0; this.facing = -side;
    this.ledgeInvuln = 30; this.actionT = 0;
    this.jumpsLeft = this.def.stats.jumps; this.airJumpsLeft = this.def.stats.airJumps;
    this.fastfalled = false; this.usedUpB = false; this.usedAirDodge = false;
    AUDIO.sfx('ledge');
  }
  updateLedge(match) {
    const inp = this.input;
    this.ledgeInvuln = Math.max(this.ledgeInvuln, 0);
    if (this.ledgeInvuln > 0) this.ledgeInvuln--;
    if (inp.upP || inp.jumpP || (inp.up && this.stateT > 6)) { this.ledgeGetup(match, 'climb'); return; }
    if (inp.attackP) { this.ledgeGetup(match, 'attack'); return; }
    if (inp.shieldP) { this.ledgeGetup(match, 'roll'); return; }
    if (inp.downP) {
      this.state = 'fall'; this.vx = this.facing * 2; this.vy = 2; this.ledge = null; this.ledgeCD = 30; return;
    }
    if (this.stateT > 300) { this.state = 'fall'; this.vy = 2; this.ledge = null; }
  }
  ledgeGetup(match, kind) {
    const gd = match.stage.ground;
    const side = this.ledge.side;
    this.ledge = null; this.ledgeCD = 24;
    this.x = side < 0 ? gd.x + 30 : gd.x + gd.w - 30;
    this.y = gd.y - 2; this.onGround = true; this.vy = 0;
    if (kind === 'attack') {
      this.startAttack('jab', match);
      match.aoeHit(this, this.x, this.y - 50, 60, 7, 16, 40, 40);
    } else if (kind === 'roll') {
      this.invincT = 20; this.x += side * -40;
      this.state = 'roll'; this.action = { type: 'roll', dur: 20 }; this.actionT = 0; this.rollDir = -side; this.facing = -side;
      AUDIO.sfx('dodge');
    } else if (kind === 'climb') {
      this.invincT = 10;
      this.state = 'idle';
    }
    match.fx.dust(this.x, this.y, 8, '#ffffff');
  }

  /* ---------------- final smash ---------------- */
  startFinalSmash(match) {
    this.hasSmashBall = false;
    this.finalActive = this.def.finalSmash.duration;
    this.finalT = 0;
    this.invincT = 40;
    this.state = 'final';
    AUDIO.sfx('final');
    match.cam.zoomPunch(0.6);
    match.cam.shake(14);
    match.fx.finalBurst(this);
    match.announce(this.def.finalSmash.name, this.pal.accent);
  }
  updateFinalSmash(match) {
    this.finalActive--; this.finalT++;
    const fs = this.def.finalSmash;
    const t = this.finalT;
    this.vx *= 0.96;
    // a grounded final smash hovers: never sink through the deck
    const grounded = this.onGround || this.onPlatform;
    if (grounded) { this.vy = 0; }
    else { this.vy = Math.min(this.vy + 0.2, 3); }
    this.x += this.vx; this.y += this.vy;
    // hard floor guard for every surface we could be standing on
    const gd = match.stage.ground;
    if (this.x > gd.x - 16 && this.x < gd.x + gd.w + 16 && this.y > gd.y) {
      this.y = gd.y; this.vy = 0; this.onGround = true;
    }
    if (this.onPlatform) {
      const p = this.onPlatform;
      const py = p.cy !== undefined ? p.cy : p.y;
      if (this.y > py) { this.y = py; this.vy = 0; }
    }
    // damage pulses
    const pulseRate = 10;
    if (t % pulseRate === 0 && t < fs.duration - 30) {
      match.aoeHit(this, this.x, this.y - 60, 240, fs.damage / (fs.duration / pulseRate - 3), 12, 30, 45, { final: 1 });
      match.fx.finalPulse(this, t);
      if (t % (pulseRate * 3) === 0) AUDIO.sfx('hit', { power: 0.5 });
    }
    if (this.finalActive <= 0) {
      this.finalActive = 0; this.state = 'idle';
      this.invincT = 10;
      match.cam.zoomPunch(0.3);
    }
  }

  checkBlastNow(match) {
    const b = WORLD.blast;
    if (this.x < b.left || this.x > b.right || this.y < b.top || this.y > b.bottom) {
      match.koFighter(this, this.lastHitBy);
      return true;
    }
    return false;
  }

  /* ---------------- KO ---------------- */
  checkBlast(match) {
    const b = WORLD.blast;
    if (this.x < b.left || this.x > b.right || this.y < b.top || this.y > b.bottom) {
      match.koFighter(this, this.lastHitBy);
      return true;
    }
    // ledge grab attempt
    if (!this.onGround && this.state !== 'ledge' && this.vy > -1 && this.ledgeCD === 0) this.tryLedgeGrab(match);
    return false;
  }

  die(match, killer, opts = {}) {
    if (this.isMob && match.multiman) match.multiman.kos = (match.multiman.kos || 0) + 1;
    this.stocks--;
    this.stats.falls++;
    if (!killer || killer === this) this.stats.sd++;
    if (killer && killer !== this) killer.stats.kos++;
    this.eliminated = this.stocks <= 0;
    this.damage = 0;
    this.hitstun = 0; this.state = 'respawn'; this.respawnT = 110;
    // respawn above this fighter's own spawn slot, not the stage centre
    const gd0 = match.stage.ground;
    this.x = clamp(this.spawnX !== undefined ? this.spawnX : 0, gd0.x + 120, gd0.x + gd0.w - 120);
    this.y = WORLD.respawnY;
    this.vx = this.vy = 0;
    this.held = null; this.hasSmashBall = false;
    this.buffs = { star: 0, mushroom: 0, poison: 0, metal: 0, bunny: 0, flower: 0 };
    this.grabbedBy = null; this.grabbing = null;
    this.ledge = null; this.finalActive = 0;
    this.action = null;
    this.respawnPlatformT = 70;
  }
  updateRespawn(match) {
    const gd = match.stage.ground;
    this.x = clamp(this.x, gd.x + 80, gd.x + gd.w - 80);
    this.y = WORLD.respawnY;
    this.vy = 0; this.vx = 0;
    if (this.respawnT <= 0) {
      // drop out of the respawn bubble onto the stage
      this.state = 'fall'; this.onGround = false; this.onPlatform = null;
      this.vy = 2.4; this.spawnProtect = 90; this.respawnPlatformT = 0; this.respawnDropT = 120;
      AUDIO.sfx('respawn');
    }
  }
}

Fighter.prototype.id = 0;
let __fid = 1;
