/* ============================================================
   RIFT RUMBLE — procedural sprite renderer + stage art
   ============================================================ */
'use strict';

const Sprites = (() => {
  /* ---- raster sprite support: 6 distinct concept-art frames per fighter ---- */
  const FRAMES = {};        // key -> [Image, ...]
  const TINTS = {};         // key -> [ [canvas,...] per palette ]
  const FRAME_META = {};
  const KEYS = ['valor', 'grim', 'astra', 'vesper', 'rook'];
  const NFRAMES = 6;
  const VARIANTS = [
    { hue: 0,   alpha: 0.00, light: 0.00 },  // default palette
    { hue: 200, alpha: 0.22, light: 0.06 },  // blue
    { hue: 120, alpha: 0.26, light: 0.04 },  // green
    { hue: 300, alpha: 0.26, light: 0.06 },  // magenta
    { hue: 40,  alpha: 0.20, light: 0.08 },  // gold
    { hue: 0,   alpha: 0.00, light: -0.22 }, // shadow / dark
  ];

  function load() {
    let pending = KEYS.length * NFRAMES;
    for (const k of KEYS) {
      FRAMES[k] = [];
      TINTS[k] = [];
      for (let i = 0; i < NFRAMES; i++) {
        const img = new Image();
        img.onload = () => {
          pending--;
          // build tinted copies once every frame for this key is ready
          if (pending === 0 || FRAMES[k].every(f => f && f.complete)) buildTints(k);
        };
        img.src = `assets/frames/${k}_${i}.png`;
        FRAMES[k][i] = img;
      }
      TINTS[k] = VARIANTS.map(() => []);
    }
  }

  function buildTints(key) {
    if (TINTS[key][0] && TINTS[key][0].length === NFRAMES) return;   // already built
    VARIANTS.forEach((v, vi) => {
      TINTS[key][vi] = [];
      for (let i = 0; i < NFRAMES; i++) {
        const src = FRAMES[key][i];
        if (!src || !src.complete) return;
        const c = document.createElement('canvas');
        c.width = src.width; c.height = src.height;
        const g = c.getContext('2d');
        g.drawImage(src, 0, 0);
        if (v.alpha > 0) {
          g.globalCompositeOperation = 'source-atop';
          g.fillStyle = `hsl(${v.hue} 65% 55%)`;
          g.globalAlpha = v.alpha;
          g.fillRect(0, 0, c.width, c.height);
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'source-over';
        }
        if (v.light !== 0) {
          g.globalCompositeOperation = 'source-atop';
          g.fillStyle = v.light > 0 ? '#ffffff' : '#000000';
          g.globalAlpha = Math.abs(v.light);
          g.fillRect(0, 0, c.width, c.height);
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'source-over';
        }
        TINTS[key][vi][i] = c;
      }
    });
  }

  function ready(key) {
    return !!(TINTS[key] && TINTS[key][0] && TINTS[key][0].length === NFRAMES);
  }

  /* ---- which of the 6 frames to show, per game state ---- */
  const STATE_FRAMES = {
    idle:      [0],
    walk:      [1, 3, 5, 3],
    run:       [2, 4, 5, 4],
    land:      [4],
    jump:      [4],
    doublejump:[2],
    fall:      [3],
    fastfall:  [5],
    crouch:    [3],
    shield:    [5],
    roll:      [2, 3, 4],
    spotdodge: [5],
    airdodge:  [2],
    hitstun:   [4],
    launch:    [4],
    grab:      [2],
    grabbing:  [2],
    grabbed:   [4],
    ledge:     [3],
    helpless:  [4],
    respawn:   [0],
    taunt:     [2, 1, 2, 3],
    final:     [2],
  };
  const ATTACK_FRAMES = {
    jab: [2, 4], ftilt: [2, 4], utilt: [2, 5], dtilt: [3, 5],
    dashattack: [2, 4], fsmash: [5, 4], usmash: [5, 2], dsmash: [3, 5],
    nair: [2, 4], fair: [2, 4], bair: [2, 5], uair: [2, 5], dair: [3, 4],
  };

  function pickFrame(f, time) {
    // attacks: windup pose -> strike pose -> settle
    if (f.state === 'attack' && f.action) {
      const SEQ = ATTACK_FRAMES[f.action.key] || [2, 4];
      const a = f.action, t = f.actionT || 0;
      const startup = a.startup || 4, active = a.active || 3;
      if (t < startup) return SEQ[0];
      if (t < startup + active + 2) return SEQ[1];
      return SEQ[0];
    }
    if (f.state === 'special') {
      const t = f.actionT || 0;
      return t < 8 ? 5 : 2;
    }
    const seq = STATE_FRAMES[f.state];
    if (!seq) return 0;
    if (seq.length === 1) {
      // idle holds ONE pose; the breathing is a bob in drawSpriteFighter,
      // alternating between two different drawings read as flickering
      return seq[0];
    }
    const speed = f.state === 'run' ? 90 : f.state === 'walk' ? 110 : 90;
    return seq[Math.floor(time / speed) % seq.length];
  }

  function getFrameCanvas(f, time) {
    const key = f.key;
    if (!ready(key)) return null;
    const vi = (f.palIdx || 0) % VARIANTS.length;
    const idx = pickFrame(f, time);
    return TINTS[key][vi] && TINTS[key][vi][idx] ? TINTS[key][vi][idx] : null;
  }

  /* ---------------- pose derivation ---------------- */
  // returns a simple skeleton spec; all coords in unflipped local space, feet at 0,0, facing +x
  function getPose(f) {
    const t = f.animT;
    const st = f.state;
    const p = {
      hipY: -46, torso: -46, torsoLean: 0, headY: -92, headX: 2, headTilt: 0,
      armF: [-16, -34, 0.6, 0.35], armB: [-34, -30, 0.5, 0.3], // shoulder angle, elbow, upper len, fore len
      legF: [8, 0.0, -44, 0.02], legB: [-8, 0.0, -44, 0.02],
      weaponA: -0.6, weaponExt: 1, crouch: 0, squash: 1, tilt: 0,
      fx: null,
    };
    const spd = Math.abs(f.vx);
    switch (st) {
      case 'idle': {
        const b = Math.sin(t * 0.07) * 1.6;
        p.hipY = -46 + b * 0.4; p.headY = -92 + b; p.torsoLean = -0.04;
        p.armF = [-10, -40, 0.55, 0.32]; p.armB = [-38, -26, 0.5, 0.3];
        p.legF = [10, 0, -46, 0]; p.legB = [-10, 0, -46, 0];
        p.weaponA = -0.85 + Math.sin(t * 0.05) * 0.05;
        break;
      }
      case 'walk': {
        const s = Math.sin(t * 0.22);
        p.hipY = -45 + Math.abs(s) * -1.5; p.headY = -91 + Math.abs(s) * -1.5;
        p.legF = [10 + s * 16, Math.max(0, s) * 6, -46, s * 0.5];
        p.legB = [-10 - s * 16, Math.max(0, -s) * 6, -46, -s * 0.5];
        p.armF = [-8 - s * 14, -34, 0.55, 0.3]; p.armB = [-30 + s * 14, -28, 0.5, 0.3];
        p.torsoLean = 0.06 * f.dirX;
        break;
      }
      case 'run': {
        const s = Math.sin(t * 0.42);
        p.hipY = -44 - Math.abs(s) * 3; p.headY = -90 - Math.abs(s) * 3;
        p.legF = [12 + s * 26, Math.max(0, s) * 16, -46, s * 0.7];
        p.legB = [-12 - s * 26, Math.max(0, -s) * 16, -46, -s * 0.7];
        p.armF = [-4 - s * 30, -50, 0.55, 0.32]; p.armB = [-40 + s * 30, -22, 0.5, 0.3];
        p.torsoLean = 0.16;
        p.weaponA = 0.25;
        break;
      }
      case 'jump': case 'air': {
        const rising = f.vy < 0;
        p.legF = [16, rising ? 26 : 8, -40, 0.4]; p.legB = [-14, rising ? 10 : 34, -40, -0.3];
        p.armF = [-20, rising ? -80 : -20, 0.5, 0.32]; p.armB = [-50, rising ? -60 : 10, 0.5, 0.3];
        p.hipY = -48; p.headY = -94;
        p.weaponA = rising ? -1.4 : -0.4;
        break;
      }
      case 'doublejump': {
        const s = Math.sin(t * 0.5);
        p.legF = [22, 40, -38, 0.5]; p.legB = [-18, 20, -38, -0.5];
        p.armF = [-60, -40, 0.5, 0.3]; p.armB = [-80, -20, 0.5, 0.3];
        p.torsoLean = -0.1; p.weaponA = -1.9; p.spin = s;
        break;
      }
      case 'fall': {
        p.legF = [10, 8, -42, 0.1]; p.legB = [-14, 20, -42, -0.1];
        p.armF = [-30, -70, 0.5, 0.3]; p.armB = [-70, -50, 0.5, 0.3];
        p.weaponA = -0.2;
        break;
      }
      case 'fastfall': {
        p.legF = [6, 0, -46, 0]; p.legB = [-8, 6, -46, 0];
        p.armF = [-4, -100, 0.5, 0.3]; p.armB = [-100, -70, 0.5, 0.3];
        p.weaponA = 0.5; p.torsoLean = 0.08;
        break;
      }
      case 'crouch': {
        p.hipY = -30; p.headY = -74; p.legF = [16, 40, -30, 0]; p.legB = [-16, 40, -30, 0];
        p.armF = [-6, 10, 0.5, 0.3]; p.armB = [-34, -10, 0.5, 0.3];
        p.weaponA = 0.3; break;
      }
      case 'land': {
        const k = clamp(f.actionT / 10, 0, 1);
        p.hipY = -46 + k * 16; p.headY = -92 + k * 18;
        p.legF = [16 + k * 10, 40 * k, -46, 0]; p.legB = [-16 - k * 10, 40 * k, -46, 0];
        p.armF = [-6, 10 * k, 0.5, 0.3]; p.armB = [-34, -10, 0.5, 0.3];
        break;
      }
      case 'hitstun': case 'launch': {
        const k = clamp(f.hitT * 0.12, 0, 1);
        p.torsoLean = -0.35 * k; p.headTilt = -0.4 * k;
        p.armF = [20, -110, 0.5, 0.32]; p.armB = [30, -100, 0.5, 0.3];
        p.legF = [22, 30, -44, 0.2]; p.legB = [-20, 10, -44, -0.2];
        p.weaponA = 1.2;
        break;
      }
      case 'shield': {
        p.hipY = -40; p.headY = -86;
        p.legF = [12, 22, -42, 0]; p.legB = [-12, 22, -42, 0];
        p.armF = [10, -70, 0.5, 0.32]; p.armB = [-20, -70, 0.5, 0.3];
        p.weaponA = 0.4; p.crouch = 1; break;
      }
      case 'spotdodge': {
        const k = Math.sin(clamp(f.actionT / 18, 0, 1) * Math.PI);
        p.torsoLean = -0.3 * k; p.headX = -6 * k; p.hipY = -40 - 6 * k;
        break;
      }
      case 'roll': {
        const k = clamp(f.actionT / f.action.dur, 0, 1);
        p.spin = k * TAU * f.rollDir;
        break;
      }
      case 'airdodge': {
        p.torsoLean = -0.5; p.legF = [30, 60, -38, 0.6]; p.legB = [-30, 60, -38, -0.6];
        p.armF = [-30, -120, 0.5, 0.3]; p.armB = [-120, -120, 0.5, 0.3];
        break;
      }
      case 'grab': case 'grabbing': {
        p.armF = [10, 4, 0.62, 0.34]; p.armB = [-6, 0, 0.6, 0.32]; p.torsoLean = 0.12;
        p.weaponA = 0.9; break;
      }
      case 'grabbed': {
        p.torsoLean = 0.3; p.armF = [40, -30, 0.5, 0.3]; p.armB = [-40, -20, 0.5, 0.3];
        p.legF = [10, 20, -40, 0]; p.legB = [-10, 30, -40, 0]; p.weaponA = 1.4; break;
      }
      case 'ledge': {
        p.torsoLean = 0; p.hipY = -50; p.headY = -92;
        p.armF = [-70, -10, 0.55, 0.3]; p.armB = [-80, -10, 0.55, 0.3];
        p.legF = [10, 20, -42, 0]; p.legB = [-6, 40, -42, 0]; p.weaponA = 1.5; break;
      }
      case 'helpless': {
        p.legF = [8, 10, -42, 0]; p.legB = [-10, 16, -42, 0];
        p.armF = [-10, -60, 0.5, 0.3]; p.armB = [-60, -80, 0.5, 0.3]; p.headTilt = 0.2; break;
      }
      case 'respawn': {
        p.armF = [-20, -80, 0.5, 0.32]; p.armB = [-80, -80, 0.5, 0.3]; p.legF = [10, 30, -42, 0]; break;
      }
      case 'taunt': {
        const k = Math.sin(t * 0.16) * 0.5 + 0.5;
        p.armF = [-40 - k * 120, -20, 0.5, 0.3]; p.weaponA = -2.2 - k; p.headTilt = -0.15;
        break;
      }
      case 'grabbing_hold': break;
      default: break;
    }
    return p;
  }

  /* attack pose interpolation */
  function attackPose(f) {
    const a = f.action; if (!a) return null;
    const prog = clamp(f.actionT / a.dur, 0, 1);
    const startupP = a.startup / a.dur, activeP = (a.startup + a.active) / a.dur;
    let phase = 0; // 0 windup, 1 extended, 2 recover
    if (prog < startupP) phase = 0; else if (prog < activeP) phase = 1; else phase = 2;
    const easeOut = x => 1 - Math.pow(1 - x, 3);
    const p = getPose(f);
    const type = a.poseType || 'swing';
    const dir = a.dir || 'f';
    const wind = phase === 0 ? eased(prog / Math.max(startupP, 0.01)) : phase === 1 ? 1 : 1 - eased((prog - activeP) / Math.max(1 - activeP, 0.01));
    const swing = phase === 0 ? -1 * wind : phase === 1 ? 1 : 1 - wind * 0.7;
    switch (type) {
      case 'jab': {
        p.armF = [-6 + swing * 8, -88 - swing * 6, 0.55 + 0.25 * Math.max(0, swing), 0.3];
        p.torsoLean = 0.12 * swing; break;
      }
      case 'swing': {
        if (dir === 'f') { p.armF = [-30 + swing * 90, -70 + swing * 20, 0.58, 0.32]; p.weaponA = -2.0 + swing * 2.6; p.torsoLean = 0.14 * swing; }
        if (dir === 'u') { p.armF = [-90 + swing * 40, -120 + swing * 60, 0.6, 0.3]; p.weaponA = -2.4 + swing * 2.2; p.torsoLean = -0.1 * swing; }
        if (dir === 'd') { p.armF = [-10 + swing * 30, 40 - swing * 60, 0.55, 0.3]; p.weaponA = 1.2 - swing * 2.0; p.torsoLean = 0.24 * swing; p.hipY = -40; }
        break;
      }
      case 'punch': {
        p.armF = [-10 + swing * 14, -92 + swing * 4, 0.6 + 0.2 * Math.max(0, swing), 0.32];
        p.armB = [-40 + swing * 6, -40, 0.5, 0.3]; p.torsoLean = 0.2 * swing; break;
      }
      case 'kick': {
        p.legF = [20 + swing * 60, 0 + swing * 10, -44, 0.2]; p.torsoLean = -0.2 * swing; break;
      }
      case 'spin': {
        p.spin = swing * TAU; p.armF = [-20, -90, 0.6, 0.32]; p.weaponA = 0; break;
      }
      case 'air': {
        const d = a.aerialDir || 'n';
        if (d === 'n') { p.armF = [-20, -90, 0.6, 0.3]; p.armB = [-100, -60, 0.6, 0.3]; p.spin = swing * TAU; p.legF = [20, 60, -40, 0.4]; }
        if (d === 'f') { p.armF = [-10 + swing * 20, -100, 0.62, 0.32]; p.weaponA = -1.6 + swing * 1.8; p.legF = [30, 40, -40, 0.5]; }
        if (d === 'b') { p.torsoLean = -0.2; p.armF = [-140 + swing * 20, -60, 0.6, 0.32]; p.weaponA = 2.6 - swing * 2.0; p.legF = [-30, 20, -40, -0.4]; }
        if (d === 'u') { p.armF = [-60, -160, 0.6, 0.3]; p.weaponA = -1.2 + swing * 1.4; p.legF = [10, 30, -42, 0.2]; p.legB = [-10, 40, -42, -0.2]; }
        if (d === 'd') { p.armF = [-30, 60, 0.6, 0.3]; p.weaponA = 1.4 - swing * 0.4; p.legF = [10, 70, -40, 0.4]; p.legB = [-10, 60, -40, -0.4]; p.torsoLean = 0.3; }
        break;
      }
      case 'grab': {
        p.armF = [-4 + swing * 16, -20, 0.6, 0.34]; p.armB = [-14 + swing * 10, -14, 0.58, 0.32]; break;
      }
      case 'special': {
        const d = a.specialDir || 'n';
        if (d === 'n') { p.armF = [-20 + swing * 30, -80, 0.6, 0.34]; p.weaponA = -1.2 + swing * 1.0; p.torsoLean = -0.06; }
        if (d === 's') { p.armF = [0, 60, 0.6, 0.34]; p.weaponA = 0.6; p.torsoLean = 0.3; p.hipY = -40; }
        if (d === 'u') { p.armF = [-100, -160, 0.6, 0.32]; p.weaponA = -2.6; p.legF = [10, 50, -40, 0.2]; }
        if (d === 'd') { p.armF = [-30, 40, 0.6, 0.32]; p.weaponA = 1.2; p.torsoLean = 0.2; p.hipY = -38; }
        break;
      }
    }
    return p;
  }
  function eased(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

  /* ---------------- weapons ---------------- */
  function drawWeapon(ctx, f, x, y, ang, pal) {
    const w = f.def.weapon;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    const L = f.def.weaponLen * (f.def.stats.size || 1);
    switch (w) {
      case 'sword': {
        poly(ctx, [[0, -3], [L * 0.82, -2.2], [L, 0], [L * 0.82, 2.2], [0, 3]], '#dfe8f5');
        poly(ctx, [[0, -1], [L * 0.8, -0.9], [L * 0.95, 0], [L * 0.8, 0.9], [0, 1]], '#ffffff');
        ctx.fillStyle = pal.accent; ctx.fillRect(-2, -6, 5, 12);
        ctx.fillStyle = shade(pal.accent, -0.4); ctx.fillRect(-12, -2, 12, 4);
        ctx.fillStyle = '#2a2f3a'; ctx.fillRect(-16, -3, 5, 6);
        break;
      }
      case 'staff': {
        ctx.fillStyle = shade(pal.secondary, 0.15);
        ctx.fillRect(-L * 0.35, -2.2, L * 1.05, 4.4);
        ctx.fillStyle = pal.accent;
        ctx.beginPath(); ctx.arc(L * 0.72, 0, 9, 0.4, TAU - 0.9); ctx.lineWidth = 4; ctx.strokeStyle = pal.accent; ctx.stroke();
        circle(ctx, L * 0.72, -8, 3.2, '#ffffff');
        break;
      }
      case 'fists': {
        circle(ctx, 2, 0, 11, shade(pal.primary, -0.25));
        circle(ctx, 3, -2, 8.5, pal.primary);
        ctx.strokeStyle = pal.accent; ctx.globalAlpha = 0.85; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(3, -2, 8.5, -0.6, 1.6); ctx.stroke(); ctx.globalAlpha = 1;
        break;
      }
      case 'daggers': {
        poly(ctx, [[0, -2], [L, -1.2], [L + 8, 0], [L, 1.2], [0, 2]], '#e6f2ee');
        ctx.fillStyle = pal.accent; ctx.fillRect(-3, -4, 4, 8);
        break;
      }
      case 'rifle': {
        ctx.fillStyle = shade(pal.primary, -0.45);
        ctx.fillRect(-14, -4, L * 0.9, 8);
        ctx.fillStyle = '#20262f'; ctx.fillRect(-14, -5.5, L * 0.35, 11);
        ctx.fillStyle = pal.accent; ctx.fillRect(L * 0.45, -3, L * 0.34, 6);
        ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.8; ctx.fillRect(L * 0.72, -1.4, L * 0.2, 2.8); ctx.globalAlpha = 1;
        break;
      }
      default: break;
    }
    ctx.restore();
  }

  /* ---------------- fighter ---------------- */
  function drawFighter(ctx, f, time) {
    const def = f.def, s = def.stats.size * 1.34, pal = f.pal;
    const pose = (f.action && f.state === 'attack') ? (attackPose(f) || getPose(f)) : getPose(f);

    ctx.save();
    ctx.translate(f.x, f.y);

    // ground shadow
    if (f.groundDist >= 0 && f.groundDist < 240) {
      const a = clamp(1 - f.groundDist / 240, 0, 1) * 0.42;
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(0, f.groundDist, 34 * s, 9 * s, 0, 0, TAU); ctx.fill(); ctx.restore();
    }

    // spin/rotation (rolls, spins)
    if (pose.spin) { ctx.translate(0, -46 * s); ctx.rotate(pose.spin); ctx.translate(0, 46 * s); }

    ctx.scale(f.facing * s, s);

    const flashing = f.flashT > 0;
    const inv = f.invincT > 0 || f.respawnT > 0;
    if (inv && Math.floor(time / 4) % 2 === 0) ctx.globalAlpha = 0.55;

    const skin = pal.skin, hair = pal.hair, prim = pal.primary, sec = pal.secondary, acc = pal.accent, cloth = pal.cloth;
    const dark = shade(prim, -0.35), light = shade(prim, 0.25);

    const lean = pose.torsoLean || 0;
    const hipY = pose.hipY * s, headY = pose.headY * s;
    const hipX = lean * 6 * s;

    // ---- back leg / arm
    const legB = pose.legB, armB = pose.armB;
    const lbFoot = [legB[0] * s * 0.5 + Math.sin(legB[3]) * 0, -Math.abs(legB[2]) * 0 + legB[2] * s * 0.02];
    capsule(ctx, hipX - 6 * s, hipY, (legB[0]) * 1.0 * s * 0.5, legB[2] * 0.46 * s, 7.5 * s, 5.5 * s, shade(cloth, -0.28));
    capsule(ctx, (legB[0]) * s * 0.5, legB[2] * 0.46 * s, (legB[0] + legB[1] * 0.4) * s * 0.6, legB[2] * s * 0.02, 5.5 * s, 4.2 * s, shade(cloth, -0.28));
    ctx.save(); ctx.translate((legB[0] + legB[1] * 0.4) * s * 0.6, legB[2] * s * 0.02);
    ctx.fillStyle = shade(hair, -0.1); ctx.fillRect(-6 * s, -2 * s, 15 * s, 5 * s); ctx.restore();

    const shB = [armB[0] * s * 0.3 + hipX, hipY - 32 * s];
    const elB = [shB[0] + Math.cos(armB[1] * Math.PI / 180) * armB[2] * 34 * s, shB[1] + Math.sin(armB[1] * Math.PI / 180) * armB[2] * 34 * s];
    const haB = [elB[0] + Math.cos(armB[1] * Math.PI / 180) * armB[3] * 40 * s, elB[1] + Math.sin(armB[1] * Math.PI / 180) * armB[3] * 40 * s];
    capsule(ctx, shB[0], shB[1], elB[0], elB[1], 6.5 * s, 5.4 * s, shade(prim, -0.3));
    capsule(ctx, elB[0], elB[1], haB[0], haB[1], 5.4 * s, 4.6 * s, shade(skin, -0.22));

    // ---- torso
    const shoulderY = headY + 14 * s;
    ctx.beginPath();
    ctx.moveTo(hipX - 11 * s, hipY + 4 * s);
    ctx.quadraticCurveTo(hipX - 13 * s + lean * 10 * s, (hipY + shoulderY) / 2, hipX - 14 * s + lean * 16 * s, shoulderY);
    ctx.lineTo(hipX + 14 * s + lean * 16 * s, shoulderY);
    ctx.quadraticCurveTo(hipX + 13 * s + lean * 8 * s, (hipY + shoulderY) / 2, hipX + 11 * s, hipY + 4 * s);
    ctx.closePath();
    const grd = ctx.createLinearGradient(-18 * s, shoulderY, 18 * s, hipY);
    grd.addColorStop(0, shade(prim, 0.4)); grd.addColorStop(0.45, light); grd.addColorStop(0.75, prim); grd.addColorStop(1, dark);
    ctx.fillStyle = grd; ctx.fill();
    // rim light (facing edge)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = withAlpha(acc, 0.5); ctx.lineWidth = 2.2 * s;
    ctx.beginPath();
    ctx.moveTo(hipX + 13 * s + lean * 15 * s, shoulderY + 2 * s);
    ctx.lineTo(hipX + 11 * s, hipY + 2 * s);
    ctx.stroke();
    ctx.restore();
    // chest accent stripe
    ctx.strokeStyle = acc; ctx.lineWidth = 2.4 * s; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(hipX + lean * 12 * s - 2 * s, shoulderY + 8 * s); ctx.lineTo(hipX + 3 * s, hipY - 2 * s); ctx.stroke();
    ctx.globalAlpha = 1;
    // belt
    ctx.fillStyle = shade(sec, -0.15); ctx.fillRect(hipX - 12 * s, hipY - 3 * s, 24 * s, 6 * s);
    ctx.fillStyle = acc; ctx.fillRect(hipX - 3 * s, hipY - 3.4 * s, 6 * s, 6.8 * s);

    // ---- cape / coat / scarf
    const capeSway = f.vx * 1.6 + Math.sin(time * 0.05) * 3;
    if (def.locomotion === 'humanoid' || def.locomotion === 'mage') {
      ctx.beginPath();
      ctx.moveTo(hipX - 10 * s + lean * 10 * s, shoulderY + 2 * s);
      ctx.quadraticCurveTo(-30 * s - capeSway * s * 0.4, hipY + 4 * s, -26 * s - capeSway * s * 0.6, hipY + 30 * s);
      ctx.quadraticCurveTo(-8 * s, hipY + 20 * s, hipX + 8 * s, hipY + 2 * s);
      ctx.closePath();
      ctx.fillStyle = withAlpha(cloth, 0.92); ctx.fill();
      ctx.strokeStyle = withAlpha(acc, 0.5); ctx.lineWidth = 1.6 * s; ctx.stroke();
    }
    if (def.locomotion === 'ninja') {
      ctx.fillStyle = withAlpha(cloth, 0.95);
      ctx.beginPath();
      ctx.moveTo(hipX + 2 * s, shoulderY);
      ctx.quadraticCurveTo(-26 * s - capeSway * s, shoulderY - 4 * s, -40 * s - capeSway * 1.4 * s, shoulderY + 22 * s);
      ctx.quadraticCurveTo(-16 * s, shoulderY + 12 * s, hipX + 6 * s, shoulderY + 10 * s);
      ctx.closePath(); ctx.fill();
    }
    if (def.locomotion === 'gunner') {
      // duster tails
      ctx.fillStyle = withAlpha(cloth, 0.95);
      poly(ctx, [[hipX - 12 * s, hipY - 6 * s], [-24 * s - capeSway * 0.5 * s, hipY + 34 * s], [2 * s, hipY + 26 * s], [hipX + 10 * s, hipY - 4 * s]], withAlpha(cloth, 0.95));
      ctx.strokeStyle = withAlpha(acc, 0.55); ctx.lineWidth = 1.4 * s;
      ctx.beginPath(); ctx.moveTo(-22 * s - capeSway * 0.5 * s, hipY + 32 * s); ctx.lineTo(hipX - 8 * s, hipY + 4 * s); ctx.stroke();
    }
    if (def.locomotion === 'brute') {
      // rock shoulder plates
      circle(ctx, hipX - 12 * s + lean * 14 * s, shoulderY + 2 * s, 10 * s, shade(prim, -0.12));
      circle(ctx, hipX + 12 * s + lean * 14 * s, shoulderY + 2 * s, 10 * s, shade(prim, 0.06));
      ctx.strokeStyle = acc; ctx.lineWidth = 2 * s; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(hipX - 12 * s + lean * 14 * s, shoulderY + 2 * s, 6 * s, 0.4, 2.4); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ---- head
    const hx = hipX + lean * 20 * s + (pose.headX || 0) * s, hy = headY;
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(pose.headTilt || 0);
    // neck
    ctx.fillStyle = shade(skin, -0.2); ctx.fillRect(-3.5 * s, 8 * s, 7 * s, 8 * s);
    // head shape
    circle(ctx, 0, 0, 13 * s, skin);
    ctx.fillStyle = withAlpha(shade(skin, -0.25), 0.5);
    ctx.beginPath(); ctx.arc(3 * s, 3 * s, 12 * s, -0.4, 1.9); ctx.fill();
    // hair
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(0, -2 * s, 13.4 * s, Math.PI * 0.92, Math.PI * 2.08);
    ctx.quadraticCurveTo(12 * s, -6 * s, 8 * s, 4 * s);
    ctx.quadraticCurveTo(2 * s, -2 * s, -13 * s, 4 * s);
    ctx.closePath(); ctx.fill();
    if (def.key === 'astra') {
      // long flowing hair
      ctx.beginPath();
      ctx.moveTo(-10 * s, -6 * s);
      ctx.quadraticCurveTo(-26 * s, 10 * s, -20 * s, 34 * s);
      ctx.quadraticCurveTo(-12 * s, 16 * s, -2 * s, 8 * s);
      ctx.closePath(); ctx.fillStyle = withAlpha(hair, 0.85); ctx.fill();
    }
    if (def.key === 'vesper') {
      // mask
      ctx.fillStyle = shade(cloth, -0.1);
      ctx.beginPath(); ctx.arc(1 * s, 3 * s, 11 * s, 0.15, Math.PI - 0.15); ctx.fill();
      ctx.fillStyle = acc; ctx.fillRect(4 * s, -3.5 * s, 7 * s, 2.4 * s);
    }
    if (def.key === 'rook') {
      // hat
      ctx.fillStyle = shade(cloth, -0.15);
      poly(ctx, [[-17 * s, -8 * s], [17 * s, -8 * s], [10 * s, -12 * s], [-9 * s, -12 * s]], shade(cloth, -0.1));
      ctx.fillRect(-9 * s, -21 * s, 18 * s, 10 * s);
      ctx.fillStyle = acc; ctx.fillRect(-9 * s, -13 * s, 18 * s, 2.2 * s);
      // goggle glint
      ctx.fillStyle = acc; ctx.fillRect(5 * s, -2 * s, 7 * s, 3 * s);
    } else {
      // eye
      ctx.fillStyle = '#10141c'; ctx.fillRect(5.5 * s, -1 * s, 3.4 * s, 3.6 * s);
      ctx.fillStyle = acc; ctx.globalAlpha = 0.9; ctx.fillRect(6.4 * s, -0.4 * s, 1.8 * s, 1.8 * s); ctx.globalAlpha = 1;
      // brow
      ctx.strokeStyle = shade(hair, -0.2); ctx.lineWidth = 1.6 * s;
      ctx.beginPath(); ctx.moveTo(4 * s, -4 * s); ctx.lineTo(10 * s, -3.4 * s); ctx.stroke();
    }
    if (def.key === 'grim') {
      // ember cracks
      ctx.strokeStyle = acc; ctx.lineWidth = 1.4 * s; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.moveTo(-6 * s, -4 * s); ctx.lineTo(-2 * s, 2 * s); ctx.lineTo(-5 * s, 7 * s); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // ---- front leg
    const legF = pose.legF;
    capsule(ctx, hipX + 5 * s, hipY, legF[0] * s * 0.5, legF[2] * 0.46 * s, 8 * s, 6 * s, cloth);
    capsule(ctx, legF[0] * s * 0.5, legF[2] * 0.46 * s, (legF[0] + legF[1] * 0.4) * s * 0.6, legF[2] * s * 0.02, 6 * s, 4.6 * s, cloth);
    ctx.save(); ctx.translate((legF[0] + legF[1] * 0.4) * s * 0.6, legF[2] * s * 0.02);
    ctx.fillStyle = shade(prim, -0.2); ctx.fillRect(-7 * s, -2.4 * s, 17 * s, 5.4 * s);
    ctx.fillStyle = acc; ctx.globalAlpha = 0.6; ctx.fillRect(2 * s, -2.4 * s, 8 * s, 1.4 * s); ctx.globalAlpha = 1;
    ctx.restore();

    // ---- front arm + weapon
    const armF = pose.armF;
    const shF = [armF[0] * s * 0.3 + hipX, hipY - 32 * s];
    const elF = [shF[0] + Math.cos(armF[1] * Math.PI / 180) * armF[2] * 34 * s, shF[1] + Math.sin(armF[1] * Math.PI / 180) * armF[2] * 34 * s];
    const haF = [elF[0] + Math.cos(armF[1] * Math.PI / 180) * armF[3] * 40 * s, elF[1] + Math.sin(armF[1] * Math.PI / 180) * armF[3] * 40 * s];
    capsule(ctx, shF[0], shF[1], elF[0], elF[1], 7 * s, 5.8 * s, prim);
    capsule(ctx, elF[0], elF[1], haF[0], haF[1], 5.8 * s, 4.8 * s, shade(skin, 0.06));
    circle(ctx, haF[0], haF[1], 4.6 * s, skin);

    // weapon at hand
    let wang = pose.weaponA;
    if (f.state === 'attack' && f.action) {
      const prog = clamp(f.actionT / f.action.dur, 0, 1);
      const sp = f.action.startup / f.action.dur;
      const ap = (f.action.startup + f.action.active) / f.action.dur;
      let w2 = prog < sp ? -1 : prog < ap ? 1 : 0.35;
      wang = pose.weaponA !== undefined ? pose.weaponA : wang;
    }
    drawWeapon(ctx, f, haF[0], haF[1], wang, { primary: prim, secondary: sec, accent: acc });

    // ---- hit flash overlay
    if (flashing) {
      ctx.globalAlpha = clamp(f.flashT / 8, 0, 1) * 0.55;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(0, -52 * s, 26 * s, 46 * s, 0, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // ---- invincibility sparkle
    if (inv) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const a = time * 0.08 + i * 2.1;
        const sx = f.x + Math.cos(a) * 26 * s, sy = f.y - 52 * s + Math.sin(a * 1.3) * 34 * s;
        ctx.globalAlpha = 0.4 + Math.sin(a * 2) * 0.2;
        ctx.fillStyle = acc;
        ctx.beginPath(); ctx.arc(sx, sy, 2.4, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    // ---- shield bubble (drawn after)
    if (f.shieldHP > 0) {
      const r = 40 * s * (0.55 + 0.45 * f.shieldHP / 60);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(f.x, f.y - 50 * s, r * 0.2, f.x, f.y - 50 * s, r);
      g.addColorStop(0, withAlpha(acc, 0.05)); g.addColorStop(0.7, withAlpha(acc, 0.16)); g.addColorStop(1, withAlpha(acc, 0.42));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(f.x, f.y - 50 * s, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = withAlpha('#ffffff', 0.5); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(f.x, f.y - 50 * s, r, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  /* ---- draw a fighter from the raster frame set ---- */
  function drawSpriteFighter(ctx, f, time) {
    const canvas = getFrameCanvas(f, time);
    if (!canvas) return false;
    const def = f.def;
    // per-fighter height normalisation: frames are trimmed to different
    // canvases, so scale each roster member to a consistent drawn height
    const TARGET_H = { valor: 104, grim: 124, astra: 100, vesper: 100, rook: 104 };
    const th = (TARGET_H[f.key] || 104) * (f.scale || 1);
    const s = th / canvas.height;
    const w = canvas.width * s, h = canvas.height * s;

    const moving = (f.state === 'walk' || f.state === 'run');
    const bob = f.state === 'idle' ? Math.sin(time * 0.006 + f.id) * 1.4
      : moving ? Math.abs(Math.sin(time * (f.state === 'run' ? 0.020 : 0.012))) * -2.6 : 0;
    const lean = f.state === 'run' ? 0.10
      : (f.state === 'hitstun' || f.state === 'launch') ? -0.20 : 0;
    let squash = f.state === 'land' ? 1.07
      : (f.state === 'jump' || f.state === 'fall' || f.state === 'doublejump') ? 0.97 : 1;

    // impact reaction — smooth, not a per-frame toggle
    if (f.hitlag > 0) squash *= 0.97;

    // ground shadow
    if (f.groundDist >= 0 && f.groundDist < 240) {
      ctx.save();
      ctx.globalAlpha = clamp(1 - f.groundDist / 240, 0, 1) * 0.45;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(f.x, f.y + f.groundDist, w * 0.30, 7.2, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }

    ctx.save();
    const inv = f.invincT > 0 || f.respawnT > 0 || f.buffs.star > 0 || f.spawnProtect > 0;
    if (inv && Math.floor(time / 4) % 2 === 0) ctx.globalAlpha = 0.45;
    if (f.buffs.metal > 0) ctx.filter = 'grayscale(0.6) brightness(1.15)';

    ctx.translate(f.x + (f.shakeX || 0), f.y + bob + (f.shakeY || 0));

    // roll spin
    if (f.state === 'roll') {
      const k = clamp((f.actionT || 0) / ((f.action && f.action.dur) || 26), 0, 1);
      ctx.translate(0, -h * 0.5);
      ctx.rotate(k * TAU * (f.rollDir || 1));
      ctx.translate(0, h * 0.5);
    }
    // ledge hang: dangle below the ledge
    if (f.state === 'ledge') {
      ctx.translate(0, 6);
      ctx.rotate(0.06);
    }

    const artFaces = (def.artFacing === undefined ? -1 : def.artFacing);
    ctx.scale(f.facing * artFaces * squash, (2 - squash));
    ctx.rotate(lean * f.facing);

    ctx.drawImage(canvas, -w / 2, -h, w, h);
    ctx.restore();
    ctx.filter = 'none';

    // ---- shield bubble: a readable dome, not a sprite-wide glow (a big
    //      shadowBlur turned Grim into a fireball and hid the fighter)
    if (f.shieldHP > 0) {
      const s = h / 104;
      const r = 40 * s * (0.58 + 0.42 * Math.max(0, f.shieldHP) / 60);
      const cy = f.y - 50 * s;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(f.x, cy, r * 0.25, f.x, cy, r);
      g.addColorStop(0, withAlpha(f.pal.accent, 0.04));
      g.addColorStop(0.72, withAlpha(f.pal.accent, 0.14));
      g.addColorStop(1, withAlpha(f.pal.accent, 0.40));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(f.x, cy, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = withAlpha('#ffffff', 0.45); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(f.x, cy, r, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    // white flash on hit
    if (f.flashT > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(f.flashT / 9, 0, 1) * 0.5;
      ctx.translate(f.x, f.y);
      ctx.scale(f.facing * (def.artFacing === undefined ? -1 : def.artFacing), 1);
      ctx.drawImage(canvas, -w / 2, -h, w, h);
      ctx.restore();
    }
    return true;
  }

  return { drawFighter, getPose, load, drawSpriteFighter, ready, FRAMES, TINTS, pickFrame };
})();

/* ============================================================
   STAGE BACKGROUNDS
   ============================================================ */
const Backdrop = (() => {
  const cache = {};
  function hash(i) { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); }

  function draw(ctx, stage, cam, time) {
    const W = 1600, H = 1000;
    const [c0, c1, c2] = stage.bg;
    // sky
    const skyTop = -H * 1.05, skyBot = H * 0.85;
    const g = ctx.createLinearGradient(0, skyTop, 0, skyBot);
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      // c0 (deep top) -> c1 -> c2 (warm horizon)
      const col = t < 0.5 ? mixColor(shade(c0, -0.35), c1, t * 2) : mixColor(c1, shade(c2, -0.15), (t - 0.5) * 2);
      g.addColorStop(t, col);
    }
    ctx.fillStyle = g; ctx.fillRect(-2400, skyTop - 10, 6800, (skyBot - skyTop) + 20);
    // below the horizon: deep ground haze
    const gh = ctx.createLinearGradient(0, skyBot - 1, 0, H * 2);
    gh.addColorStop(0, shade(c2, -0.55)); gh.addColorStop(1, shade(c0, -0.6));
    ctx.fillStyle = gh; ctx.fillRect(-2400, skyBot, 6800, H * 2);
    // soft god-rays from above
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const rx = -700 + i * 360 + Math.sin(time * 0.0002 + i) * 40 - cam.x * 0.04;
      const rg = ctx.createLinearGradient(rx, -900, rx + 160, 300);
      rg.addColorStop(0, withAlpha(stage.accent, 0.13));
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(rx - 40, -900); ctx.lineTo(rx + 120, -900);
      ctx.lineTo(rx + 300, 400); ctx.lineTo(rx + 40, 400);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // horizon glow
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const hg = ctx.createRadialGradient(0, 60, 40, 0, 60, 900);
    hg.addColorStop(0, withAlpha(stage.accent, 0.18));
    hg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hg; ctx.fillRect(-1600, -600, 3200, 1400);
    ctx.restore();

    const theme = stage.theme;
    // parallax starfield / motes
    ctx.save();
    for (let i = 0; i < 70; i++) {
      const px = (hash(i) * 2600 - 1300) - cam.x * 0.08;
      const py = (hash(i + 99) * 1600 - 1100) - cam.y * 0.05;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(time * 0.0012 + i));
      ctx.globalAlpha = 0.16 + hash(i + 7) * 0.5 * tw;
      ctx.fillStyle = i % 5 === 0 ? stage.accent : '#cfe0ff';
      const r = 0.8 + hash(i + 31) * 1.8;
      ctx.fillRect((px % 2600 + 2600) % 2600 - 1300, py, r, r);
    }
    ctx.restore();

    ctx.save();
    const par = (k) => -cam.x * k;

    if (theme === 'shrine') {
      // distant torii + mountains
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 6; i++) {
        const bx = -1500 + i * 520 + par(0.1);
        ctx.fillStyle = '#101a2c';
        ctx.beginPath(); ctx.moveTo(bx - 320, 210); ctx.lineTo(bx, -180 - hash(i) * 140); ctx.lineTo(bx + 340, 210); ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 0.85;
      for (let i = 0; i < 3; i++) {
        const bx = -600 + i * 700 + par(0.22);
        ctx.fillStyle = '#0d1422';
        ctx.fillRect(bx - 8, -320, 16, 520);
        ctx.fillRect(bx - 90, -326, 180, 16);
        ctx.fillRect(bx - 70, -292, 140, 11);
        ctx.fillStyle = withAlpha('#ff5a6a', 0.5);
        ctx.fillRect(bx - 90, -330, 180, 5);
      }
    } else if (theme === 'rift') {
      // floating monoliths + rift crack
      ctx.globalAlpha = 0.7;
      for (let i = 0; i < 7; i++) {
        const bx = -1200 + i * 400 + par(0.12), by = -260 + hash(i) * 200;
        ctx.save(); ctx.translate(bx, by); ctx.rotate(hash(i + 4) * 0.5 - 0.25);
        ctx.fillStyle = '#141222';
        ctx.fillRect(-70, -140, 140, 280);
        ctx.strokeStyle = withAlpha('#c77dff', 0.5); ctx.lineWidth = 2;
        ctx.strokeRect(-70, -140, 140, 280);
        ctx.restore();
      }
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const rg = ctx.createLinearGradient(0, -600, 0, 200);
      rg.addColorStop(0, withAlpha('#c77dff', 0.0)); rg.addColorStop(0.5, withAlpha('#c77dff', 0.25)); rg.addColorStop(1, withAlpha('#7aa2ff', 0));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(par(0.2) + 60, -700);
      for (let i = 0; i < 9; i++) ctx.lineTo(par(0.2) + 60 + Math.sin(i * 2.1 + time * 0.0006) * 60, -700 + i * 110);
      for (let i = 8; i >= 0; i--) ctx.lineTo(par(0.2) + 150 + Math.sin(i * 2.1 + time * 0.0006) * 60, -700 + i * 110);
      ctx.closePath(); ctx.fill(); ctx.restore();
    } else if (theme === 'foundry') {
      // gears + chimneys + lava glow
      ctx.globalAlpha = 0.6;
      for (let i = 0; i < 5; i++) {
        const bx = -1000 + i * 500 + par(0.14);
        ctx.fillStyle = '#170a06';
        ctx.fillRect(bx, -420, 120, 620);
        ctx.fillStyle = withAlpha('#ff6a2a', 0.35);
        ctx.fillRect(bx + 30, -420, 60, 12);
      }
      for (let i = 0; i < 4; i++) {
        const bx = -800 + i * 620 + par(0.24), by = -120 + hash(i) * 90;
        ctx.save(); ctx.translate(bx, by); ctx.rotate(time * 0.0004 * (i % 2 ? 1 : -1));
        ctx.strokeStyle = withAlpha('#c86a3a', 0.5); ctx.lineWidth = 9;
        ctx.beginPath(); ctx.arc(0, 0, 70, 0, TAU); ctx.stroke();
        for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 70, Math.sin(a) * 70); ctx.lineTo(Math.cos(a) * 92, Math.sin(a) * 92); ctx.stroke(); }
        ctx.restore();
      }
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createLinearGradient(0, 160, 0, 520);
      lg.addColorStop(0, withAlpha('#ff5a20', 0)); lg.addColorStop(1, withAlpha('#ff7a2a', 0.5));
      ctx.fillStyle = lg; ctx.fillRect(-2000, 160, 5000, 380); ctx.restore();
    } else if (theme === 'comet') {
      // big planet + comet trails
      ctx.globalAlpha = 0.55;
      const pg = ctx.createRadialGradient(par(0.08) - 300, -420, 40, par(0.08) - 300, -420, 300);
      pg.addColorStop(0, '#5a4a9a'); pg.addColorStop(1, 'rgba(30,22,60,0)');
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(par(0.08) - 300, -420, 300, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.8;
      for (let i = 0; i < 5; i++) {
        const t2 = (time * 0.05 + i * 220) % 900;
        const cx = ((i * 520 + t2 * 2) % 2400) - 1200 + par(0.18), cy = -500 + i * 130 + t2 * 0.3;
        ctx.strokeStyle = withAlpha('#9ab8ff', 0.5); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - 120, cy + 46); ctx.stroke();
        ctx.fillStyle = '#dfe8ff'; ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, TAU); ctx.fill();
      }
    } else if (theme === 'hollow') {
      // bamboo forest
      for (let i = 0; i < 26; i++) {
        const bx = -1400 + i * 120 + par(0.16 + hash(i) * 0.1);
        const hgt = 500 + hash(i + 3) * 500;
        ctx.globalAlpha = 0.28 + hash(i) * 0.4;
        ctx.fillStyle = i % 3 === 0 ? '#1d5a44' : '#164234';
        ctx.fillRect(bx, -hgt, 9 + hash(i) * 5, hgt + 400);
        ctx.fillStyle = withAlpha('#0c2a20', 0.9);
        for (let k = 1; k < 5; k++) ctx.fillRect(bx, -hgt + k * hgt / 5, 12, 3);
      }
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#0a1a14';
      ctx.beginPath(); ctx.ellipse(par(0.1) - 200, 230, 700, 120, 0, 0, TAU); ctx.fill();
    } else if (theme === 'range') {
      // ruined arches
      ctx.globalAlpha = 0.6;
      for (let i = 0; i < 5; i++) {
        const bx = -1100 + i * 560 + par(0.15);
        ctx.fillStyle = '#16241a';
        ctx.fillRect(bx, -300, 40, 520);
        ctx.fillRect(bx + 200, -300, 40, 520);
        ctx.beginPath(); ctx.arc(bx + 120, -300, 120, Math.PI, TAU); ctx.lineWidth = 34; ctx.strokeStyle = '#16241a'; ctx.stroke();
        ctx.fillStyle = withAlpha('#22e08a', 0.35);
        ctx.fillRect(bx + 105, -300, 30, 16);
      }
    }
    ctx.restore();

    // ground shadow gradient under stage
    ctx.save();
    const sd = ctx.createLinearGradient(0, 60, 0, 420);
    sd.addColorStop(0, 'rgba(0,0,0,0.35)'); sd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sd; ctx.fillRect(-1600, 60, 3200, 360);
    ctx.restore();
  }

  function drawPlatforms(ctx, stage, time) {
    ctx.save();
    for (const p of stage.platforms) {
      const px = p.cx !== undefined ? p.cx : p.x, py = p.cy !== undefined ? p.cy : p.y;
      const pg = ctx.createLinearGradient(0, py, 0, py + p.h + 6);
      pg.addColorStop(0, shade(stage.bg[2], 0.5));
      pg.addColorStop(0.5, shade(stage.bg[2], 0.16));
      pg.addColorStop(1, shade(stage.bg[1], -0.05));
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.roundRect(px, py, p.w, p.h, 4); ctx.fill();
      // bright leading edge
      ctx.fillStyle = withAlpha(stage.accent, 0.95);
      ctx.fillRect(px + 2, py - 2.5, p.w - 4, 3.5);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35;
      ctx.fillStyle = withAlpha(stage.accent, 0.6);
      ctx.fillRect(px + 6, py + p.h, p.w - 12, 6);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawStageBody(ctx, stage, time) {
    const gd = stage.ground;
    ctx.save();
    // main platform
    const grad = ctx.createLinearGradient(0, gd.y - 10, 0, gd.y + 100);
    grad.addColorStop(0, shade(stage.bg[2], 0.55));
    grad.addColorStop(0.10, shade(stage.bg[2], 0.28));
    grad.addColorStop(0.45, shade(stage.bg[2], -0.18));
    grad.addColorStop(1, shade(stage.bg[1], -0.55));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(gd.x, gd.y);
    ctx.lineTo(gd.x + gd.w, gd.y);
    ctx.lineTo(gd.x + gd.w - 26, gd.y + 96);
    ctx.lineTo(gd.x + 26, gd.y + 96);
    ctx.closePath(); ctx.fill();
    // top edge glow
    const eg = ctx.createLinearGradient(gd.x, 0, gd.x + gd.w, 0);
    eg.addColorStop(0, withAlpha(stage.accent, 0.2)); eg.addColorStop(0.5, withAlpha(stage.accent, 0.95)); eg.addColorStop(1, withAlpha(stage.accent, 0.2));
    ctx.fillStyle = eg; ctx.fillRect(gd.x - 4, gd.y - 5, gd.w + 8, 6);
    // under-lattice
    ctx.strokeStyle = withAlpha(stage.accent, 0.18); ctx.lineWidth = 2;
    for (let x = gd.x; x < gd.x + gd.w; x += 54) {
      ctx.beginPath(); ctx.moveTo(x, gd.y + 6); ctx.lineTo(x + 26, gd.y + 92); ctx.stroke();
    }
    // side walls
    ctx.fillStyle = shade(stage.bg[1], -0.2);
    ctx.fillRect(gd.x - 16, gd.y, 16, 300);
    ctx.fillRect(gd.x + gd.w, gd.y, 16, 300);

    ctx.restore();
  }

  function drawVignette(ctx, W, H) {
    ctx.save();
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.55, W / 2, H / 2, H * 1.08);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  return { draw, drawStageBody, drawPlatforms, drawVignette };
})();
