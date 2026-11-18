/* ============================================================
   RIFT RUMBLE — data: fighters, moves, stages, items
   ============================================================ */
'use strict';

const WORLD = {
  W: 1600, H: 1000,
  blast: { left: -1250, right: 1250, top: -900, bottom: 780 },
  respawnY: -420,
  gravityCap: 26,
};

const PALETTES = {};
function pal(name, skin, hair, primary, secondary, accent, cloth) {
  return { name, skin, hair, primary, secondary, accent, cloth: cloth || secondary };
}

/* ---------- shared move helpers ---------- */
function mv(o) { return Object.assign({ name: '', frames: 30, startup: 4, active: 3, damage: 5, bkb: 10, kbs: 30, angle: 45, reach: 0, hitboxes: null, sfx: 'swing', effect: 'slash', cancelable: 0, charge: 0, multi: 0, landingLag: 0 }, o); }
function hb(x, y, w, h, t0 = 0, t1 = 99) { return { x, y, w, h, t0, t1 }; }

/* ============================================================
   FIGHTERS
   ============================================================ */
const FIGHTERS = {

  /* ---------------- VALOR ---------------- */
  valor: {
    key: 'valor', artFacing: -1, name: 'VALOR', title: 'THE SWORDSMAN', archetype: 'All-Rounder',
    color: '#4aa3ff', theme: '#4aa3ff',
    stats: { weight: 100, walk: 2.4, run: 5.4, air: 4.3, fall: 11.4, fastfall: 17.2, gravity: 0.62, jumps: 2, jumpV: 13.2, djumpV: 12.4, airJumps: 1, size: 1.0, traction: 0.55, airAccel: 0.34, dashFrames: 10 },
    locomotion: 'humanoid', weapon: 'sword', weaponLen: 46,
    palettes: [
      pal('Azure', '#f2c9a3', '#243049', '#2c4f95', '#cfe0f5', '#5aa9ff', '#1c3663'),
      pal('Crimson', '#f0c49c', '#2a1a1a', '#8f2530', '#f0d3d8', '#ff6b6b', '#5e1620'),
      pal('Forest', '#e8bd93', '#22301c', '#2f6033', '#d6e8c8', '#78d98a', '#1d3d20'),
      pal('Violet', '#f4cfa8', '#2c1d3a', '#5b2a86', '#e6d4f2', '#bd7dff', '#3a1a58'),
      pal('Ivory', '#f6d7b4', '#e8e6ea', '#c9d3de', '#ffffff', '#9fd4ff', '#8b98a8'),
      pal('Umbra', '#c99a74', '#111318', '#1a2230', '#4a5568', '#7f8fa8', '#0c1018'),
    ],
    moves: {
      jab: mv({ name: 'Jab', frames: 22, startup: 2, active: 3, damage: 3, bkb: 8, kbs: 24, angle: 35, reach: 40, hitboxes: [hb(14, -58, 46, 30)] }),
      ftilt: mv({ name: 'Sword Arc', frames: 32, startup: 6, active: 4, damage: 9, bkb: 18, kbs: 52, angle: 32, reach: 54, hitboxes: [hb(18, -66, 56, 46)] }),
      utilt: mv({ name: 'Rising Arc', frames: 32, startup: 5, active: 5, damage: 8, bkb: 20, kbs: 56, angle: 96, hitboxes: [hb(-20, -110, 74, 58)] }),
      dtilt: mv({ name: 'Low Sweep', frames: 28, startup: 4, active: 3, damage: 7, bkb: 16, kbs: 42, angle: 18, hitboxes: [hb(14, -26, 52, 28)] }),
      dashattack: mv({ name: 'Lunge', frames: 38, startup: 5, active: 6, damage: 10, bkb: 26, kbs: 46, angle: 40, hitboxes: [hb(6, -62, 58, 46)] }),
      fsmash: mv({ name: 'Lunar Cleave', frames: 52, startup: 12, active: 4, damage: 16, bkb: 30, kbs: 92, angle: 33, reach: 62, charge: 1, hitboxes: [hb(16, -76, 70, 60)] }),
      usmash: mv({ name: 'Starfall', frames: 46, startup: 9, active: 5, damage: 15, bkb: 26, kbs: 88, angle: 88, charge: 1, hitboxes: [hb(-30, -122, 92, 66)] }),
      dsmash: mv({ name: 'Twin Sweep', frames: 46, startup: 8, active: 4, damage: 13, bkb: 24, kbs: 82, angle: 22, charge: 1, hitboxes: [hb(-56, -22, 66, 34), hb(16, -22, 66, 34)] }),
      nair: mv({ name: 'Nair', frames: 30, startup: 3, active: 8, damage: 8, bkb: 14, kbs: 52, angle: 45, hitboxes: [hb(-40, -78, 84, 64)] }),
      fair: mv({ name: 'Fair', frames: 34, startup: 6, active: 4, damage: 11, bkb: 18, kbs: 62, angle: 42, hitboxes: [hb(14, -84, 66, 56)] }),
      bair: mv({ name: 'Bair', frames: 32, startup: 5, active: 4, damage: 12, bkb: 20, kbs: 68, angle: 145, hitboxes: [hb(-72, -78, 62, 52)] }),
      uair: mv({ name: 'Uair', frames: 30, startup: 4, active: 5, damage: 9, bkb: 14, kbs: 58, angle: 88, hitboxes: [hb(-32, -116, 68, 54)] }),
      dair: mv({ name: 'Meteor Point', frames: 36, startup: 7, active: 4, damage: 12, bkb: 18, kbs: 58, angle: 268, hitboxes: [hb(-24, -18, 52, 58)], spike: 1 }),
    },
    specials: {
      neutral: { name: 'LUNAR SLASH', desc: 'Crescent projectile', type: 'projectile', frames: 40, startup: 10, damage: 8, bkb: 14, kbs: 40, angle: 40, cooldown: 26 },
      side: { name: 'RUSH STRIKE', desc: 'Dashing blade rush', type: 'dash', frames: 44, startup: 8, damage: 12, bkb: 24, kbs: 58, angle: 40, dist: 150 },
      up: { name: 'SKYWARD ASCENT', desc: 'Rising recovery', type: 'recover', frames: 40, startup: 3, damage: 9, bkb: 18, kbs: 46, angle: 80, rise: 9.2, drift: 4.2 },
      down: { name: 'GUARDIAN STANCE', desc: 'Counter stance', type: 'counter', frames: 40, startup: 1, window: 20, mult: 1.35 },
    },
    finalSmash: { name: 'BLADE TEMPEST', type: 'spin', duration: 150, damage: 42 },
    grabRange: 46, throwDmg: { f: 8, b: 10, u: 7, d: 6 },
  },

  /* ---------------- GRIM ---------------- */
  grim: {
    key: 'grim', artFacing: 1, name: 'GRIM', title: 'THE COLOSSUS', archetype: 'Heavyweight',
    color: '#ff9330', theme: '#ff9330',
    stats: { weight: 138, walk: 1.9, run: 4.1, air: 2.9, fall: 13.6, fastfall: 21.5, gravity: 0.86, jumps: 2, jumpV: 13.6, djumpV: 12.2, airJumps: 1, size: 1.22, traction: 0.5, airAccel: 0.26, dashFrames: 14 },
    locomotion: 'brute', weapon: 'fists', weaponLen: 0,
    palettes: [
      pal('Stone', '#9aa0a8', '#3a3f46', '#6b7280', '#b8bfc8', '#ff9330', '#4b5158'),
      pal('Rust', '#a8867a', '#3d2a22', '#8a4a2f', '#c9a48e', '#ff7a2a', '#5a2f1e'),
      pal('Moss', '#93a08a', '#2f3a2a', '#55704a', '#a8bf9a', '#c8ff6a', '#33422c'),
      pal('Slate', '#8f9aad', '#2a3242', '#4a5b78', '#a8b8d0', '#5aa9ff', '#2c3849'),
      pal('Obsidian', '#6a6f78', '#12151a', '#2a2f38', '#8a929e', '#ffffff', '#181c22'),
      pal('Bronze', '#c8a878', '#4a3a22', '#a87f3a', '#e0c89a', '#ffd23a', '#6b5228'),
    ],
    moves: {
      jab: mv({ name: 'Hammer Fists', frames: 26, startup: 4, active: 3, damage: 5, bkb: 10, kbs: 28, angle: 40, hitboxes: [hb(12, -66, 52, 40)] }),
      ftilt: mv({ name: 'Overhand', frames: 40, startup: 10, active: 4, damage: 13, bkb: 24, kbs: 60, angle: 38, hitboxes: [hb(14, -84, 66, 66)] }),
      utilt: mv({ name: 'Rising Rock', frames: 38, startup: 8, active: 5, damage: 11, bkb: 24, kbs: 62, angle: 92, hitboxes: [hb(-26, -122, 84, 60)] }),
      dtilt: mv({ name: 'Ground Pound', frames: 34, startup: 7, active: 3, damage: 9, bkb: 20, kbs: 46, angle: 25, hitboxes: [hb(6, -22, 64, 32)] }),
      dashattack: mv({ name: 'Freight Train', frames: 46, startup: 9, active: 8, damage: 14, bkb: 30, kbs: 50, angle: 42, hitboxes: [hb(-4, -76, 70, 66)] }),
      fsmash: mv({ name: 'Continental Punch', frames: 62, startup: 18, active: 5, damage: 23, bkb: 34, kbs: 100, angle: 30, charge: 1, hitboxes: [hb(14, -90, 82, 78)] }),
      usmash: mv({ name: 'Tectonic Rise', frames: 58, startup: 14, active: 5, damage: 20, bkb: 30, kbs: 94, angle: 90, charge: 1, hitboxes: [hb(-38, -130, 108, 78)] }),
      dsmash: mv({ name: 'Seismic Slam', frames: 56, startup: 13, active: 5, damage: 18, bkb: 26, kbs: 88, angle: 20, charge: 1, hitboxes: [hb(-74, -30, 88, 42), hb(20, -30, 88, 42)] }),
      nair: mv({ name: 'Nair', frames: 36, startup: 5, active: 9, damage: 11, bkb: 18, kbs: 56, angle: 45, hitboxes: [hb(-50, -92, 104, 78)] }),
      fair: mv({ name: 'Fair', frames: 42, startup: 9, active: 5, damage: 15, bkb: 22, kbs: 66, angle: 40, hitboxes: [hb(12, -98, 78, 70)] }),
      bair: mv({ name: 'Bair', frames: 40, startup: 8, active: 5, damage: 16, bkb: 24, kbs: 72, angle: 148, hitboxes: [hb(-88, -92, 74, 64)] }),
      uair: mv({ name: 'Uair', frames: 38, startup: 7, active: 5, damage: 13, bkb: 18, kbs: 64, angle: 88, hitboxes: [hb(-40, -136, 84, 64)] }),
      dair: mv({ name: 'Meteor Slam', frames: 44, startup: 11, active: 5, damage: 16, bkb: 20, kbs: 62, angle: 268, hitboxes: [hb(-30, -18, 62, 66)], spike: 1 }),
    },
    specials: {
      neutral: { name: 'MAGMA FIST', desc: 'Heavy fireball', type: 'projectile', frames: 48, startup: 14, damage: 12, bkb: 20, kbs: 52, angle: 35, cooldown: 34, big: 1 },
      side: { name: 'RUSH STRIKE', desc: 'Shoulder charge', type: 'dash', frames: 52, startup: 12, damage: 16, bkb: 30, kbs: 62, angle: 38, dist: 170 },
      up: { name: 'SKYWARD ASCENT', desc: 'Erupting uppercut', type: 'recover', frames: 48, startup: 4, damage: 13, bkb: 22, kbs: 50, angle: 85, rise: 9.8, drift: 3.2 },
      down: { name: 'GUARDIAN STANCE', desc: 'Stone guard + quake', type: 'counter', frames: 46, startup: 1, window: 22, mult: 1.5 },
    },
    finalSmash: { name: 'CONTINENTAL SLAM', type: 'slam', duration: 150, damage: 48 },
    grabRange: 54, throwDmg: { f: 12, b: 14, u: 10, d: 9 },
  },

  /* ---------------- ASTRA ---------------- */
  astra: {
    key: 'astra', artFacing: -1, name: 'ASTRA', title: 'THE STARWEAVER', archetype: 'Floaty Zoner',
    color: '#c77dff', theme: '#c77dff',
    stats: { weight: 76, walk: 2.1, run: 4.3, air: 3.5, fall: 7.4, fastfall: 11.6, gravity: 0.4, jumps: 3, jumpV: 12.6, djumpV: 11.4, airJumps: 2, size: 0.97, traction: 0.42, airAccel: 0.3, dashFrames: 9 },
    locomotion: 'mage', weapon: 'staff', weaponLen: 52,
    palettes: [
      pal('Violet', '#f6d2b8', '#e8e6ef', '#6b3aa8', '#2a1548', '#c77dff', '#3d2064'),
      pal('Midnight', '#ecc8ac', '#c8d8ef', '#28356e', '#121a3a', '#7aa2ff', '#1a2450'),
      pal('Rose', '#f8d8c4', '#f0d0d8', '#a83a6e', '#4a1030', '#ff7ab8', '#701d44'),
      pal('Aurora', '#f2d8c0', '#d8f0e8', '#2a7058', '#0f3a2c', '#6affc0', '#1a4a3a'),
      pal('Lumen', '#fce4cc', '#ffffff', '#d8c8a0', '#7a6a48', '#ffe08a', '#a89a70'),
      pal('Eclipse', '#c8a890', '#8a8a9a', '#1a1a28', '#08080f', '#ff8a5a', '#12121c'),
    ],
    moves: {
      jab: mv({ name: 'Staff Tap', frames: 24, startup: 3, active: 3, damage: 3, bkb: 8, kbs: 22, angle: 35, hitboxes: [hb(14, -62, 56, 30)] }),
      ftilt: mv({ name: 'Crescent Push', frames: 34, startup: 7, active: 5, damage: 8, bkb: 16, kbs: 46, angle: 35, hitboxes: [hb(16, -72, 66, 48)] }),
      utilt: mv({ name: 'Star Lift', frames: 34, startup: 6, active: 5, damage: 7, bkb: 18, kbs: 52, angle: 95, hitboxes: [hb(-26, -116, 76, 60)] }),
      dtilt: mv({ name: 'Comet Sweep', frames: 30, startup: 5, active: 4, damage: 6, bkb: 14, kbs: 38, angle: 20, hitboxes: [hb(10, -24, 58, 28)] }),
      dashattack: mv({ name: 'Nova Rush', frames: 40, startup: 6, active: 6, damage: 9, bkb: 22, kbs: 42, angle: 42, hitboxes: [hb(4, -66, 60, 50)] }),
      fsmash: mv({ name: 'Starfall Arc', frames: 54, startup: 13, active: 5, damage: 15, bkb: 26, kbs: 84, angle: 36, charge: 1, hitboxes: [hb(12, -86, 84, 70)] }),
      usmash: mv({ name: 'Constellation', frames: 50, startup: 10, active: 6, damage: 13, bkb: 24, kbs: 82, angle: 90, charge: 1, hitboxes: [hb(-36, -132, 104, 74)] }),
      dsmash: mv({ name: 'Gravity Well', frames: 50, startup: 10, active: 5, damage: 12, bkb: 22, kbs: 76, angle: 18, charge: 1, hitboxes: [hb(-76, -26, 92, 40), hb(18, -26, 92, 40)] }),
      nair: mv({ name: 'Nair', frames: 32, startup: 4, active: 9, damage: 7, bkb: 12, kbs: 46, angle: 45, hitboxes: [hb(-44, -82, 92, 68)] }),
      fair: mv({ name: 'Fair', frames: 36, startup: 7, active: 5, damage: 10, bkb: 16, kbs: 56, angle: 40, hitboxes: [hb(12, -88, 74, 60)] }),
      bair: mv({ name: 'Bair', frames: 34, startup: 6, active: 4, damage: 11, bkb: 18, kbs: 62, angle: 150, hitboxes: [hb(-80, -82, 68, 56)] }),
      uair: mv({ name: 'Uair', frames: 32, startup: 5, active: 6, damage: 8, bkb: 12, kbs: 52, angle: 88, hitboxes: [hb(-36, -124, 76, 58)] }),
      dair: mv({ name: 'Star Spike', frames: 38, startup: 8, active: 5, damage: 11, bkb: 16, kbs: 54, angle: 265, hitboxes: [hb(-26, -18, 56, 62)], spike: 1 }),
    },
    specials: {
      neutral: { name: 'SHOOTING STAR BOLT', desc: 'Piercing star bolt', type: 'projectile', frames: 42, startup: 11, damage: 7, bkb: 12, kbs: 38, angle: 38, cooldown: 24, pierce: 1 },
      side: { name: 'COMET RUSH', desc: 'Trailing comet dash', type: 'dash', frames: 46, startup: 9, damage: 10, bkb: 22, kbs: 52, angle: 42, dist: 165, float: 1 },
      up: { name: 'STAR BLINK', desc: 'Teleport recovery', type: 'teleport', frames: 40, startup: 8, damage: 8, bkb: 16, kbs: 40, angle: 80, dist: 210 },
      down: { name: 'GRAVITY ORB', desc: 'Pulling void orb', type: 'orb', frames: 46, startup: 12, damage: 2, bkb: 4, kbs: 6, angle: 90, cooldown: 40 },
    },
    finalSmash: { name: 'CONSTELLATION NOVA', type: 'rain', duration: 160, damage: 40 },
    grabRange: 44, throwDmg: { f: 7, b: 9, u: 6, d: 5 },
  },

  /* ---------------- VESPER ---------------- */
  vesper: {
    key: 'vesper', artFacing: -1, name: 'VESPER', title: 'THE SHADE', archetype: 'Rushdown',
    color: '#2fd6bb', theme: '#2fd6bb',
    stats: { weight: 72, walk: 2.9, run: 6.7, air: 5.1, fall: 11.8, fastfall: 18.4, gravity: 0.68, jumps: 2, jumpV: 12.8, djumpV: 12.2, airJumps: 1, size: 0.94, traction: 0.6, airAccel: 0.4, dashFrames: 8 },
    locomotion: 'ninja', weapon: 'daggers', weaponLen: 26,
    palettes: [
      pal('Jade', '#e8c0a0', '#1a2a26', '#1f6b5c', '#0d2a24', '#2fd6bb', '#12443a'),
      pal('Crimson', '#e8bc98', '#2a1214', '#8a2030', '#3a0c12', '#ff5a6a', '#511018'),
      pal('Indigo', '#dcc0b0', '#1a1a2e', '#343a86', '#14163a', '#7a8aff', '#20245c'),
      pal('Dune', '#f0d0a8', '#3a2a18', '#a88a4a', '#4a3a1a', '#ffd06a', '#6a5426'),
      pal('Onyx', '#b89880', '#0c0c10', '#1c1c22', '#0a0a0e', '#9a9aaa', '#101014'),
      pal('Frost', '#f2dcc8', '#d8e8f0', '#7ab8a8', '#2a4a44', '#a8fff0', '#3a6a60'),
    ],
    moves: {
      jab: mv({ name: 'Dagger Flurry', frames: 18, startup: 2, active: 2, damage: 2, bkb: 6, kbs: 18, angle: 32, hitboxes: [hb(10, -56, 40, 26)], multi: 1 }),
      ftilt: mv({ name: 'Cross Slash', frames: 26, startup: 4, active: 3, damage: 7, bkb: 14, kbs: 44, angle: 34, hitboxes: [hb(12, -64, 50, 40)] }),
      utilt: mv({ name: 'Fan Kick', frames: 26, startup: 4, active: 4, damage: 6, bkb: 14, kbs: 48, angle: 92, hitboxes: [hb(-22, -108, 68, 52)] }),
      dtilt: mv({ name: 'Low Sting', frames: 24, startup: 3, active: 3, damage: 5, bkb: 12, kbs: 34, angle: 16, hitboxes: [hb(10, -22, 46, 26)] }),
      dashattack: mv({ name: 'Shredding Dash', frames: 34, startup: 4, active: 5, damage: 8, bkb: 18, kbs: 40, angle: 40, hitboxes: [hb(2, -62, 54, 44)] }),
      fsmash: mv({ name: 'Twin Fang', frames: 44, startup: 9, active: 4, damage: 13, bkb: 24, kbs: 84, angle: 32, charge: 1, hitboxes: [hb(10, -70, 62, 52)] }),
      usmash: mv({ name: 'Viper Rise', frames: 42, startup: 8, active: 5, damage: 12, bkb: 22, kbs: 80, angle: 88, charge: 1, hitboxes: [hb(-30, -118, 84, 62)] }),
      dsmash: mv({ name: 'Low Twin Slash', frames: 42, startup: 8, active: 4, damage: 11, bkb: 20, kbs: 76, angle: 20, charge: 1, hitboxes: [hb(-62, -24, 76, 36), hb(14, -24, 76, 36)] }),
      nair: mv({ name: 'Nair', frames: 26, startup: 3, active: 8, damage: 7, bkb: 12, kbs: 44, angle: 45, hitboxes: [hb(-40, -74, 80, 60)] }),
      fair: mv({ name: 'Fair', frames: 28, startup: 4, active: 4, damage: 9, bkb: 14, kbs: 52, angle: 40, hitboxes: [hb(10, -78, 58, 50)] }),
      bair: mv({ name: 'Bair', frames: 26, startup: 4, active: 4, damage: 10, bkb: 16, kbs: 58, angle: 148, hitboxes: [hb(-66, -74, 58, 48)] }),
      uair: mv({ name: 'Uair', frames: 26, startup: 3, active: 5, damage: 7, bkb: 10, kbs: 48, angle: 88, hitboxes: [hb(-30, -112, 64, 52)] }),
      dair: mv({ name: 'Kunai Spike', frames: 32, startup: 6, active: 4, damage: 10, bkb: 14, kbs: 50, angle: 265, hitboxes: [hb(-22, -16, 46, 56)], spike: 1 }),
    },
    specials: {
      neutral: { name: 'KUNAI BARRAGE', desc: '3-way kunai spread', type: 'projectile', frames: 40, startup: 8, damage: 5, bkb: 10, kbs: 30, angle: 30, cooldown: 22, spread: 3 },
      side: { name: 'SHADOWSTEP DASH', desc: 'Blink through foes', type: 'teleport', frames: 40, startup: 6, damage: 9, bkb: 20, kbs: 48, angle: 40, dist: 190 },
      up: { name: 'VIPER ASCENDANT', desc: 'Rising kick', type: 'recover', frames: 38, startup: 3, damage: 8, bkb: 16, kbs: 44, angle: 82, rise: 9.4, drift: 4.6 },
      down: { name: 'SMOKE COUNTER', desc: 'Counter + smoke', type: 'counter', frames: 38, startup: 1, window: 18, mult: 1.25 },
    },
    finalSmash: { name: 'THOUSAND CUTS', type: 'clones', duration: 150, damage: 45 },
    grabRange: 42, throwDmg: { f: 6, b: 8, u: 5, d: 5 },
  },

  /* ---------------- ROOK ---------------- */
  rook: {
    key: 'rook', artFacing: -1, name: 'ROOK', title: 'THE HEXSHOT', archetype: 'Projectile Zoner',
    color: '#22e08a', theme: '#22e08a',
    stats: { weight: 94, walk: 2.3, run: 4.8, air: 3.7, fall: 11.6, fastfall: 17.6, gravity: 0.64, jumps: 2, jumpV: 13.0, djumpV: 12.2, airJumps: 1, size: 1.04, traction: 0.5, airAccel: 0.32, dashFrames: 10 },
    locomotion: 'gunner', weapon: 'rifle', weaponLen: 54,
    palettes: [
      pal('Verdant', '#e0b898', '#2a2018', '#1d4a3a', '#0f2a22', '#22e08a', '#142e26'),
      pal('Rust', '#e8c0a0', '#3a2418', '#8a4a2a', '#4a2410', '#ffa04a', '#5c3018'),
      pal('Bone', '#f0d8c0', '#e8e2d8', '#c8bfa8', '#8a8270', '#fff0c0', '#a89e88'),
      pal('Royal', '#e8c4a4', '#1a1a30', '#2a3a8a', '#141c4a', '#6a9aff', '#1c2858'),
      pal('Blood', '#e4b898', '#2a1010', '#8a1a22', '#3a080c', '#ff5a4a', '#4e0e14'),
      pal('Onyx', '#c0a088', '#14141a', '#1e2228', '#0c0e12', '#ffd23a', '#101318'),
    ],
    moves: {
      jab: mv({ name: 'Rifle Butt', frames: 24, startup: 3, active: 3, damage: 4, bkb: 8, kbs: 24, angle: 34, hitboxes: [hb(12, -62, 54, 32)] }),
      ftilt: mv({ name: 'Bayonet Sweep', frames: 32, startup: 6, active: 4, damage: 8, bkb: 16, kbs: 48, angle: 33, hitboxes: [hb(14, -70, 62, 44)] }),
      utilt: mv({ name: 'Stock Upper', frames: 32, startup: 5, active: 5, damage: 7, bkb: 18, kbs: 54, angle: 94, hitboxes: [hb(-24, -114, 74, 56)] }),
      dtilt: mv({ name: 'Low Shot', frames: 30, startup: 5, active: 4, damage: 6, bkb: 14, kbs: 38, angle: 18, hitboxes: [hb(12, -24, 56, 28)] }),
      dashattack: mv({ name: 'Sliding Shot', frames: 38, startup: 6, active: 6, damage: 9, bkb: 20, kbs: 44, angle: 40, hitboxes: [hb(4, -64, 62, 46)] }),
      fsmash: mv({ name: 'Charged Hex Blast', frames: 56, startup: 15, active: 5, damage: 16, bkb: 28, kbs: 86, angle: 34, charge: 1, hitboxes: [hb(10, -78, 92, 66)] }),
      usmash: mv({ name: 'Rune Pillar', frames: 50, startup: 11, active: 6, damage: 13, bkb: 24, kbs: 84, angle: 90, charge: 1, hitboxes: [hb(-30, -128, 96, 76)] }),
      dsmash: mv({ name: 'Trap Burst', frames: 50, startup: 11, active: 5, damage: 12, bkb: 22, kbs: 78, angle: 18, charge: 1, hitboxes: [hb(-70, -24, 88, 38), hb(18, -24, 88, 38)] }),
      nair: mv({ name: 'Nair', frames: 32, startup: 4, active: 9, damage: 8, bkb: 12, kbs: 48, angle: 45, hitboxes: [hb(-44, -80, 92, 66)] }),
      fair: mv({ name: 'Fair', frames: 36, startup: 7, active: 5, damage: 10, bkb: 16, kbs: 58, angle: 40, hitboxes: [hb(12, -86, 76, 60)] }),
      bair: mv({ name: 'Bair', frames: 34, startup: 6, active: 4, damage: 11, bkb: 18, kbs: 64, angle: 148, hitboxes: [hb(-82, -80, 70, 54)] }),
      uair: mv({ name: 'Uair', frames: 32, startup: 5, active: 6, damage: 8, bkb: 12, kbs: 50, angle: 88, hitboxes: [hb(-34, -120, 74, 56)] }),
      dair: mv({ name: 'Rifle Slam', frames: 38, startup: 8, active: 5, damage: 11, bkb: 16, kbs: 54, angle: 264, hitboxes: [hb(-24, -16, 52, 60)], spike: 1 }),
    },
    specials: {
      neutral: { name: 'HEX BULLET VOLLEY', desc: '3-round burst', type: 'projectile', frames: 44, startup: 10, damage: 4, bkb: 8, kbs: 26, angle: 34, cooldown: 26, burst: 3 },
      side: { name: 'RUNE LASSO', desc: 'Pulling hex chain', type: 'lasso', frames: 46, startup: 12, damage: 7, bkb: 16, kbs: 36, angle: 30, dist: 230 },
      up: { name: 'DRONE GRAPPLE', desc: 'Tether recovery', type: 'recover', frames: 44, startup: 5, damage: 6, bkb: 12, kbs: 34, angle: 84, rise: 8.6, drift: 5.4 },
      down: { name: 'RUNE MINE', desc: 'Placed proximity trap', type: 'mine', frames: 40, startup: 12, damage: 11, bkb: 20, kbs: 52, angle: 60, cooldown: 44 },
    },
    finalSmash: { name: 'HEX BARRAGE', type: 'bullethell', duration: 160, damage: 44 },
    grabRange: 48, throwDmg: { f: 8, b: 10, u: 7, d: 6 },
  },
};

const FIGHTER_KEYS = ['valor', 'grim', 'astra', 'vesper', 'rook'];

/* ============================================================
   STAGES
   ============================================================ */
const STAGES = {
  skyshrine: {
    key: 'skyshrine', name: 'SKY SHRINE', sub: 'Balanced · 3 platforms', theme: 'shrine',
    bg: ['#0d1830', '#1b2f52', '#31547f'], accent: '#5aa9ff',
    ground: { x: -560, y: 0, w: 1120, h: 44 },
    platforms: [
      { x: -290, y: -190, w: 260, h: 18 },
      { x: 30, y: -190, w: 260, h: 18 },
      { x: -130, y: -350, w: 260, h: 18 },
    ],
    ledges: true, hazard: null,
  },
  terminal: {
    key: 'terminal', name: 'TERMINAL RIFT', sub: 'Flat · Final Destination style', theme: 'rift',
    bg: ['#140f26', '#282050', '#4a3a72'], accent: '#c77dff',
    ground: { x: -620, y: 0, w: 1240, h: 44 }, platforms: [],
    ledges: true, hazard: null,
  },
  foundry: {
    key: 'foundry', name: 'EMBER FOUNDRY', sub: 'Moving lift · lava hazard', theme: 'foundry',
    bg: ['#1d0d09', '#3a1d14', '#6a3520'], accent: '#ff9330',
    ground: { x: -540, y: 0, w: 1080, h: 44 },
    platforms: [
      { x: -300, y: -200, w: 240, h: 18 },
      { x: 60, y: -200, w: 240, h: 18 },
      { x: -120, y: -360, w: 240, h: 18, move: { axis: 'x', amp: 120, speed: 0.012 } },
    ],
    ledges: true, hazard: { type: 'lava', y: 300, dmg: 12, kb: 0.8 },
  },
  cometreach: {
    key: 'cometreach', name: 'COMET REACH', sub: 'Wide · floaty platforms', theme: 'comet',
    bg: ['#100e28', '#211c4e', '#3d3478'], accent: '#7aa2ff',
    ground: { x: -500, y: 0, w: 1000, h: 44 },
    platforms: [
      { x: -330, y: -170, w: 200, h: 16, move: { axis: 'y', amp: 46, speed: 0.02 } },
      { x: 130, y: -170, w: 200, h: 16, move: { axis: 'y', amp: 46, speed: 0.02, phase: Math.PI } },
      { x: -100, y: -320, w: 200, h: 16 },
    ],
    ledges: true, hazard: null,
  },
  hollow: {
    key: 'hollow', name: 'BAMBOO HOLLOW', sub: 'Pillars · tight neutral', theme: 'hollow',
    bg: ['#08190f', '#123a26', '#255a3e'], accent: '#2fd6bb',
    ground: { x: -480, y: 0, w: 960, h: 44 },
    platforms: [
      { x: -250, y: -180, w: 190, h: 16 },
      { x: 60, y: -180, w: 190, h: 16 },
      { x: -95, y: -330, w: 190, h: 16 },
    ],
    ledges: true, hazard: { type: 'pillar', x: 0, w: 90, period: 420, dmg: 10, kb: 0.9 },
  },
  range: {
    key: 'range', name: 'RUNE RANGE', sub: 'Sloped ruins · wide', theme: 'range',
    bg: ['#0f1710', '#22301c', '#3c5230'], accent: '#22e08a',
    ground: { x: -600, y: 0, w: 1200, h: 44 },
    platforms: [
      { x: -360, y: -160, w: 180, h: 16, move: { axis: 'x', amp: 60, speed: 0.015 } },
      { x: 180, y: -160, w: 180, h: 16, move: { axis: 'x', amp: 60, speed: 0.015, phase: Math.PI } },
      { x: -90, y: -310, w: 220, h: 16 },
    ],
    ledges: true, hazard: null,
  },
};
const STAGE_KEYS = Object.keys(STAGES);

/* ============================================================
   ITEMS  (GDD §8)
   ============================================================ */
const ITEMS = {
  beamsword: { name: 'BEAM SWORD', cat: 'batter', color: '#7ad4ff', icon: 'sword', dmg: 11, bkb: 18, kbs: 60, reach: 60 },
  homerunbat: { name: 'HOME-RUN BAT', cat: 'batter', color: '#c8a06a', icon: 'bat', dmg: 22, bkb: 40, kbs: 110, reach: 58, smashKO: 1 },
  starrod: { name: 'STAR ROD', cat: 'batter', color: '#ffd23a', icon: 'rod', dmg: 9, bkb: 16, kbs: 48, reach: 52, shoot: 1 },
  bobomb: { name: 'BOB-OMB', cat: 'throw', color: '#3a4a8a', icon: 'bomb', dmg: 26, bkb: 34, kbs: 70, radius: 120 },
  shell: { name: 'GREEN SHELL', cat: 'throw', color: '#4ac85a', icon: 'shell', dmg: 13, bkb: 22, kbs: 55, radius: 46 },
  bumper: { name: 'BUMPER', cat: 'throw', color: '#e84a6a', icon: 'bumper', dmg: 8, bkb: 30, kbs: 40, radius: 40 },
  raygun: { name: 'RAY GUN', cat: 'shoot', color: '#ff5a8a', icon: 'gun', dmg: 6, bkb: 10, kbs: 26, ammo: 12 },
  fireflower: { name: 'FIRE FLOWER', cat: 'shoot', color: '#ff7a2a', icon: 'flower', dmg: 2, bkb: 2, kbs: 2, ammo: 60, flame: 1 },
  heart: { name: 'HEART CONTAINER', cat: 'heal', color: '#ff4a6a', icon: 'heart', heal: 999 },
  tomato: { name: 'MAXIM TOMATO', cat: 'heal', color: '#ff2a2a', icon: 'tomato', heal: 50 },
  food: { name: 'FOOD', cat: 'heal', color: '#e8a04a', icon: 'food', heal: 6 },
  star: { name: 'SUPER STAR', cat: 'status', color: '#ffe04a', icon: 'star', dur: 540, invincible: 1 },
  mushroom: { name: 'SUPER MUSHROOM', cat: 'status', color: '#ff4a3a', icon: 'mushroom', dur: 600, scale: 1.35 },
  poison: { name: 'POISON MUSHROOM', cat: 'status', color: '#8a4aff', icon: 'poison', dur: 600, scale: 0.72 },
  metalbox: { name: 'METAL BOX', cat: 'status', color: '#9aa8b8', icon: 'metal', dur: 600, weight: 2.6, fallMul: 1.9 },
  bunnyhood: { name: 'BUNNY HOOD', cat: 'status', color: '#ffb8d8', icon: 'bunny', dur: 600, speed: 1.55 },
  crate: { name: 'CRATE', cat: 'container', color: '#b88a4a', icon: 'crate', hp: 22, spawns: 2 },
  capsule: { name: 'CAPSULE', cat: 'container', color: '#d8d8e8', icon: 'capsule', hp: 12, spawns: 1, explode: 0.2 },
  riftorb: { name: 'RIFT ORB', cat: 'summon', color: '#c77dff', icon: 'orb', dur: 480, summon: 'sprite' },
  assist: { name: 'SIGIL TROPHY', cat: 'summon', color: '#22e08a', icon: 'trophy', dur: 480, summon: 'sigil' },
  smashball: { name: 'SMASH BALL', cat: 'special', color: '#ffe04a', icon: 'smash', hp: 120 },
  hammer: { name: 'HAMMER', cat: 'special', color: '#c8a06a', icon: 'hammer', dur: 480, dmg: 18, headless: 0.25 },
};
const ITEM_KEYS = Object.keys(ITEMS);
const ITEM_POOL_COMMON = ['beamsword', 'homerunbat', 'starrod', 'bobomb', 'shell', 'bumper', 'raygun', 'fireflower', 'heart', 'tomato', 'food', 'food', 'star', 'mushroom', 'poison', 'metalbox', 'bunnyhood', 'crate', 'capsule', 'riftorb', 'assist'];

/* ============================================================
   RULES DEFAULTS
   ============================================================ */
const DEFAULT_RULES = {
  mode: 'stock',
  stocks: 3,
  time: 150,
  players: 2,
  cpus: [false, true, false, false],
  teams: false,
  teamAssign: [0, 1, 0, 1],
  teamAttack: false,
  items: 'medium',
  stage: 'skyshrine',
  stageRandom: false,
  aiLevel: 5,
  hazards: true,
  damageRatio: 1,
  stocks8: false,
};
