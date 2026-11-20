/* ============================================================
   tools/harness.js — headless boot for the Rift Rumble engine
   ------------------------------------------------------------
   Loads the browser modules (js/core.js … js/match.js, js/render.js) inside a
   `vm` context with just enough DOM/AudioContext/canvas fakery to run the game
   logic and the sprite renderer without a browser, and exposes the little test
   runner the suites share.

   Assets are read straight off disk, so `fetch('assets/atlas/x.json')` and
   `new Image().src = 'assets/atlas/x.png'` behave like the real thing.

   Used by tools/simtest.js (physics / collision / facing) and
   tools/atlascheck.js (roster atlas + renderer).  A previous generation of
   debug scripts drove a real Chromium over Playwright; that needed a server and
   a browser download, while everything worth asserting about the simulation is
   reachable from the logic layer directly.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAME = path.join(__dirname, '..', 'game');

const LOGIC = ['js/core.js', 'js/data.js', 'js/fighter.js', 'js/items.js', 'js/ai.js', 'js/match.js'];

const noop = () => { };

/* ---------------- PNG header reader ---------------- */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return { w: 0, h: 0 };
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/* ---------------- recording 2D context ---------------- */
function makeCtx(rec) {
  const state = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    globalCompositeOperation: 'source-over', filter: 'none', font: '10px sans-serif',
    lineJoin: 'miter', lineCap: 'butt', shadowBlur: 0, shadowColor: 'transparent',
    textAlign: 'start', textBaseline: 'alphabetic', imageSmoothingEnabled: true,
  };
  // maintain the CTM so tests can assert where a sprite actually landed
  let m = [1, 0, 0, 1, 0, 0];
  const mul = (n) => {
    const [a, b, c, d, e, f] = m, [g, h, i, j, k, l] = n;
    m = [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
  };
  const ctx = {
    canvas: { width: 960, height: 540 },
    // snapshot the paint state as well as the CTM: the renderer sets globalAlpha
    // for a ground shadow and expects restore() to undo it, and a recorder that
    // only tracks the matrix leaks that alpha onto every later op (tools/film.js
    // reads alpha per op to composite the frame, so the leak would show up there)
    save() { (rec.stack || (rec.stack = [])).push({ m: m.slice(), state: Object.assign({}, state) }); rec.ops.push({ op: 'save' }); },
    restore() {
      const s = rec.stack && rec.stack.pop();
      if (s) { m = s.m; for (const k in s.state) state[k] = s.state[k]; }
      rec.ops.push({ op: 'restore' });
    },
    setTransform(a, b, c, d, e, f) { m = [a, b, c, d, e, f]; rec.ops.push({ op: 'setTransform' }); },
    resetTransform() { m = [1, 0, 0, 1, 0, 0]; },
    translate(x, y) { mul([1, 0, 0, 1, x, y]); rec.ops.push({ op: 'translate', x, y }); },
    scale(x, y) { mul([x, 0, 0, y, 0, 0]); rec.ops.push({ op: 'scale', x, y }); },
    rotate(a) { mul([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); rec.ops.push({ op: 'rotate', a }); },
    transform(a, b, c, d, e, f) { mul([a, b, c, d, e, f]); },
    getTransform: () => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }),
    drawImage(img, ...a) {
      const args = a.map(v => Number(v));
      let sx = 0, sy = 0, sw = 0, sh = 0, dx = 0, dy = 0, dw = 0, dh = 0;
      if (args.length >= 8) { [sx, sy, sw, sh, dx, dy, dw, dh] = args; }
      else if (args.length === 4) { [dx, dy, dw, dh] = args; sw = dw; sh = dh; }
      else if (args.length === 2) { [dx, dy] = args; dw = img && img.width; dh = img && img.height; }
      rec.ops.push({
        op: 'drawImage', img, sx, sy, sw, sh, dx, dy, dw, dh,
        // the paint state matters as much as the geometry for a rasteriser: the
        // shadow and the invulnerability blink draw at partial alpha, and baked
        // VFX layers composite additively over the body
        alpha: state.globalAlpha, blend: state.globalCompositeOperation,
        matrix: m.slice(),
        world: [m[0] * dx + m[2] * dy + m[4], m[1] * dx + m[3] * dy + m[5]],
        anchorWorld: [
          m[0] * (dx + (args.length >= 8 ? sx * 0 : 0)) + m[2] * dy + m[4],
          m[1] * dy + m[3] * dy + m[5],
        ],
        finite: [...args, m[0], m[1], m[2], m[3], m[4], m[5]].every(Number.isFinite) && !!img,
      });
    },
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => ({ setTransform: noop }),
    measureText: (t) => ({ width: String(t).length * 6 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    putImageData: noop, createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    clip: noop, setLineDash: noop, getLineDash: () => [],
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, arcTo: noop,
    ellipse: noop, rect: noop, roundRect: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    fill: noop, stroke: noop, fillRect: noop, strokeRect: noop, clearRect: noop, fillText: noop, strokeText: noop,
    drawFocusIfNeeded: noop, scrollPathIntoView: noop, isPointInPath: () => false,
  };
  for (const k of ['filter', 'globalAlpha', 'globalCompositeOperation', 'imageSmoothingEnabled', 'shadowBlur', 'shadowColor']) {
    Object.defineProperty(ctx, k, { get: () => state[k], set: (v) => { state[k] = v; rec.ops.push({ op: 'set', k, v }); } });
  }
  for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline', 'lineJoin', 'lineCap', 'miterLimit', 'lineDashOffset']) {
    Object.defineProperty(ctx, k, { get: () => state[k], set: (v) => { state[k] = v; } });
  }
  return ctx;
}

/* ---------------- sandbox ---------------- */
function makeSandbox(opts = {}) {
  const rec = opts.record ? { ops: [] } : null;
  const sharedCtx = opts.record ? makeCtx(rec) : null;
  const assets = opts.assets || GAME;
  const el = (tag) => {
    const canvas = tag === 'canvas';
    const node = {
      tagName: String(tag || 'div').toUpperCase(), width: 960, height: 540, style: {}, dataset: {},
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      getContext: () => sharedCtx || makeSandbox.noopCtx,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
      addEventListener: noop, removeEventListener: noop, appendChild: noop, prepend: noop,
      insertBefore: noop, removeChild: noop, setAttribute: noop, removeAttribute: noop,
      querySelector: () => el('div'), querySelectorAll: () => [], focus: noop, blur: noop, click: noop,
      animate: () => ({ cancel: noop, finished: Promise.resolve() }),
      toDataURL: () => 'data:,', play: () => Promise.resolve(), pause: noop, load: noop,
      textContent: '', innerHTML: '', value: '', checked: false, disabled: false, children: [],
      parentElement: null, nextSibling: null, parentNode: null, firstChild: null,
    };
    if (canvas) node.getContext = (kind) => (opts.record ? makeCtx({ ops: [] }) : makeSandbox.noopCtx);
    return node;
  };
  makeSandbox.noopCtx = makeSandbox.noopCtx || makeCtx({ ops: [] });

  const gainNode = () => ({ gain: pulse(), connect: noop, disconnect: noop });
  const pulse = () => ({ value: 0, setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop, setTargetAtTime: noop, cancelScheduledValues: noop });
  const sandbox = {
    console, Math, JSON, Date, Object, Array, Number, String, Boolean, Set, Map, Symbol,
    Error, TypeError, RangeError, isNaN, isFinite, parseInt, parseFloat, Promise,
    performance: { now: () => Date.now() },
    Float32Array, Float64Array, Uint8Array, Uint8ClampedArray, Uint32Array, Int16Array, Int32Array, ArrayBuffer, DataView,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
    fetch: (url) => {
      // ?v=<build> is part of the real URL, so the shim has to look past it too
      const rel = String(url).replace(/^\/+/, '').replace(/^\.\//, '').replace(/[?#].*$/, '');
      const file = path.join(assets, rel);
      if (!file.startsWith(assets) || !fs.existsSync(file)) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('missing ' + rel)), text: () => Promise.resolve('') });
      const text = fs.readFileSync(file, 'utf8');
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(JSON.parse(text)),
        text: () => Promise.resolve(text),
        arrayBuffer: () => Promise.resolve(fs.readFileSync(file).buffer),
      });
    },
    Image: class {
      constructor() { this.width = 0; this.height = 0; this.complete = false; this.onload = null; this.onerror = null; this._src = ''; }
      get src() { return this._src; }
      set src(v) {
        this._src = v;
        const file = path.join(assets, String(v).replace(/^\/+/, '').replace(/[?#].*$/, ''));
        queueMicrotask(() => {
          if (fs.existsSync(file)) {
            const { w, h } = pngSize(fs.readFileSync(file));
            this.width = w; this.height = h; this.complete = true;
            if (this.onload) this.onload();
          } else if (this.onerror) this.onerror(new Error('missing image ' + v));
        });
      }
    },
    document: {
      readyState: 'complete',
      createElement: el, createDocumentFragment: () => el('div'),
      body: el('body'), head: el('head'),
      documentElement: { style: {}, clientWidth: 960, clientHeight: 540 },
      getElementById: () => el('div'), querySelector: () => el('div'), querySelectorAll: () => [],
      addEventListener: noop, removeEventListener: noop,
      fonts: { ready: Promise.resolve(), load: () => Promise.resolve(), check: () => true },
    },
    localStorage: {
      _d: {},
      getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; }, clear() { this._d = {}; }, key: () => null, length: 0,
    },
    AudioContext: class {
      constructor() { this.destination = { connect: noop, disconnect: noop }; this.sampleRate = 44100; }
      get currentTime() { return 0; }
      get state() { return 'running'; }
      createGain() { return gainNode(); }
      createOscillator() { return { type: 'sine', frequency: pulse(), detune: pulse(), connect: noop, start: noop, stop: noop, onended: null }; }
      createBiquadFilter() { return { type: 'lowpass', Q: pulse(), frequency: pulse(), connect: noop, disconnect: noop }; }
      createStereoPanner() { return { pan: pulse(), connect: noop, disconnect: noop }; }
      createDynamicsCompressor() { return { threshold: pulse(), knee: pulse(), ratio: pulse(), attack: pulse(), release: pulse(), reduction: 0, connect: noop, disconnect: noop }; }
      createBuffer(ch, len) { const d = []; for (let i = 0; i < ch; i++) d.push(new Float32Array(len)); return { length: len, sampleRate: 44100, numberOfChannels: ch, getChannelData: (i) => d[i], copyToChannel: noop }; }
      createBufferSource() { return { buffer: null, loop: false, playbackRate: pulse(), connect: noop, disconnect: noop, start: noop, stop: noop }; }
      resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); }
    },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    navigator: { userAgent: 'node', maxTouchPoints: 0, vibrate: noop, getGamepads: () => [] },
    location: { href: 'http://localhost/', search: '', hash: '', origin: 'http://localhost' },
    devicePixelRatio: 1, innerWidth: 960, innerHeight: 540,
    addEventListener: noop, removeEventListener: noop,
    // modes.js is menu/UI glue; match.js calls a few of its hooks
    Modes: { homeRunEnd: noop, homeRunSwing: noop, homeRunLaunch: noop, spawnMob: noop, reset: noop, reportMatchEnd: noop },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  context.__rec = rec;
  return { sandbox, context, rec };
}

/* ---------------- module loading ---------------- */
function load(context, files) {
  for (const rel of files) {
    const src = fs.readFileSync(path.join(GAME, rel), 'utf8');
    try {
      vm.runInContext(src, context, { filename: rel });
    } catch (e) {
      throw new Error(`failed to load ${rel}: ${e.message}`);
    }
  }
  // SAVE/AUDIO are normally primed by the boot path in index.html
  vm.runInContext(`
    try { if (typeof SAVE !== 'undefined' && SAVE) { SAVE.data = SAVE.data || { stats: {}, coins: 0, matches: 0, challengesDone: [], records: {}, settings: {}, unlocks: [] }; SAVE.save = function () {}; } } catch (e) {}
    try { if (typeof AUDIO !== 'undefined' && AUDIO) { AUDIO.init = function(){}; AUDIO.sfx = function(){}; AUDIO.music = function(){}; AUDIO.stop = function(){}; } } catch (e) {}
  `, context, { filename: 'harness-bootstrap' });
}

/* Top-level `class`/`const` in a vm script live in the context's global lexical
   scope instead of the sandbox object, so they have to be read back in scope. */
const DEFAULT_GLOBALS = ['Match', 'Fighter', 'FIGHTERS', 'WORLD', 'STAGES', 'DEFAULT_RULES',
  'ITEMS', 'CPU', 'Camera', 'clamp', 'sign', 'TAU', 'INPUT', 'Sprites', 'Backdrop'];
function globals(context, names) {
  const list = names || DEFAULT_GLOBALS;
  const expr = '({' + list.map(k => `${k}:(typeof ${k} !== 'undefined' ? ${k} : undefined)`).join(',') + '})';
  return vm.runInContext(expr, context);
}

/* Let queued microtasks (Image.onload, fetch chains) run. */
function settle(rounds = 6) {
  let p = Promise.resolve();
  for (let i = 0; i < rounds; i++) p = p.then(() => new Promise(r => setImmediate(r)));
  return p;
}

/* ---------------- match helpers ---------------- */
function rulesFor(context, extra) {
  const base = Object.assign({}, globals(context).DEFAULT_RULES);
  return Object.assign(base, { stocks: 3, time: 999, items: 'off' }, extra || {});
}

function cast(n, keys, opts = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      key: keys[i % keys.length], palIdx: i % 6, isCPU: !!opts.cpu,
      team: opts.teams ? (i % 2) : 0, label: 'T' + i,
    });
  }
  return out;
}

function newMatch(context, list, stageKey = 'skyshrine', extra = {}) {
  const M = globals(context).Match;
  const m = new M({ rules: rulesFor(context, extra.rules), cast: list, stageKey, W: 960, H: 540 });
  m.state = extra.state || 'play';
  return m;
}

/* Drive human input with no keyboard: patch the match's reader and tick. */
function control(m, fn) {
  m.readPlayerInput = (f) => f.__raw || {};
  return {
    tick(frames) {
      for (let i = 0; i < (frames || 1); i++) {
        if (fn) m.fighters.forEach((f, k) => { f.__raw = fn(f, k, m.frame + i, m) || {}; });
        m.update();
      }
    },
    step(n) { this.tick(n || 1); },
  };
}

/* ---------------- test runner ---------------- */
function makeRunner() {
  const results = [];
  let pass = 0, fail = 0;
  return {
    test(name, fn) { results.push([name, fn]); },
    assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); },
    near(a, b, eps, msg) { if (!(Math.abs(a - b) <= eps)) throw new Error(`${msg || 'near'}: ${a} vs ${b}`); },
    async run(filter) {
      let ran = 0;
      for (const [name, fn] of results) {
        if (filter && !name.toLowerCase().includes(String(filter).toLowerCase())) continue;
        ran++;
        const t0 = Date.now();
        try {
          await fn();
          pass++;
          console.log(`  ok    ${name}  (${Date.now() - t0}ms)`);
        } catch (e) {
          fail++;
          console.log(`  FAIL  ${name}\n        ${e && e.message}`);
          if (process.env.V) console.log(String(e && e.stack).split('\n').slice(1, 5).join('\n'));
        }
      }
      console.log(`\n${pass} passed, ${fail} failed${ran ? '' : ' (no test matched the filter)'}`);
      return fail;
    },
  };
}

/* Boot a fresh context with the logic modules (and optionally the renderer). */
function boot(opts = {}) {
  const files = opts.render ? LOGIC.concat(['js/render.js']) : LOGIC.slice();
  const { sandbox, context, rec } = makeSandbox(opts);
  load(context, files);
  const g = globals(context);
  return { sandbox, ctx: context, g, rec, settle, newMatch: (list, stage, extra) => newMatch(context, list, stage, extra), cast, control, globals: () => g };
}

module.exports = {
  GAME, LOGIC, makeSandbox, makeCtx, load, globals, settle, rulesFor, cast, newMatch, control,
  makeRunner, boot, pngSize,
};
