/* ============================================================
   RIFT RUMBLE — optional cross-device save sync (Supabase)
   ------------------------------------------------------------
   Local save data (SAVE in core.js) stays the source of truth; this module only
   mirrors it to one row per player so a second device can pick up where the
   first left off.  Nothing here runs unless the player turns it on in
   Records → CLOUD SAVES, and the project URL + publishable key live in
   localStorage, never in the repo.

   No SDK and no build step: raw fetch against the endpoints Supabase already
   exposes —
     POST /auth/v1/signup                        (anonymous session)
     POST /auth/v1/token?grant_type=refresh_token
     POST /rest/v1/rpc/save_sync                  (get-or-create + rev-guarded push)
   and the database does the conflict rules (see supabase/migrations).  A push
   that is not at the stored revision is rejected with the stored row so the two
   copies can be merged and retried, which is what keeps two devices open at the
   same time from silently discarding each other.

   Every failure path is inert: no network access, a bad key, an offline
   browser, a 500 — the local save still works, and the panel just reports it.
   ============================================================ */
'use strict';

const CloudSave = (() => {
  const CFG_KEY = 'rift-rumble-cloud-v1';
  const SESSION_KEY = 'rift-rumble-cloud-session-v1';
  const META_KEY = 'rift-rumble-cloud-meta-v1';
  const VERSION = 'v1';                 // stored server-side; bump on a save-shape change
  const TIMEOUT = 8000;
  const DEBOUNCE = 2500;
  const RETRIES = 1;                    // one merge-and-retry after a revision conflict

  let cfg = null, meta = null, session = null;
  let timer = 0, running = null, again = false;
  let status = 'off', detail = '', lastPushed = '';

  /* ---------------- storage ---------------- */
  function ls() { try { return localStorage; } catch (e) { return null; } }
  function readJSON(key) {
    const s = ls(); if (!s) return null;
    try { return JSON.parse(s.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function writeJSON(key, v) {
    const s = ls(); if (!s) return;
    try { if (v === null || v === undefined) s.removeItem(key); else s.setItem(key, JSON.stringify(v)); } catch (e) { }
  }
  function meta_() { return meta || (meta = Object.assign({ rev: 0, lastSyncAt: 0 }, readJSON(META_KEY) || {})); }
  function setMeta(patch) { meta = Object.assign(meta_(), patch); writeJSON(META_KEY, meta); return meta; }

  function config() {
    if (!cfg) {
      const saved = readJSON(CFG_KEY) || {};
      const injected = (typeof window !== 'undefined' && window.RR_CLOUD) || {};
      cfg = {
        enabled: !!saved.enabled,
        url: String(saved.url || injected.url || ''),
        key: String(saved.key || injected.key || ''),
      };
    }
    return cfg;
  }
  function saveConfig(patch) {
    cfg = Object.assign({}, config(), patch || {});
    if (cfg.url) cfg.url = String(cfg.url).replace(/\/+$/, '');
    writeJSON(CFG_KEY, cfg);
    status = cfg.enabled && cfg.url && cfg.key ? 'idle' : 'off';
    publish();
    return cfg;
  }
  function enabled() { const c = config(); return !!(c.enabled && c.url && c.key); }
  function base() { return config().url; }

  /* ---------------- the save we mirror ---------------- */
  // Indirected so this file has no hard dependency on core.js order, and so the
  // headless tests can hand it a plain object.
  const local = {
    read() { return (typeof SAVE !== 'undefined' && SAVE && SAVE.data) ? SAVE.data : null; },
    write(data) {
      // SAVE is a const object literal, so replace its fields rather than the binding.
      if (typeof SAVE !== 'undefined' && SAVE) { SAVE.data = data; SAVE.save(); }
    },
  };

  /* ---------------- fetch ---------------- */
  function headers(authed) {
    const c = config();
    const h = { 'Content-Type': 'application/json', 'apikey': c.key };
    const token = (authed !== false && session && session.access_token) ? session.access_token : c.key;
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  async function call(path, body, opts = {}) {
    if (typeof fetch !== 'function') throw new Error('no fetch in this environment');
    const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    const kill = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) { } }, TIMEOUT) : 0;
    try {
      const res = await fetch(base() + path, {
        method: opts.method || 'POST',
        headers: headers(opts.anon),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined,
        /* On pagehide the tab is going away under us; keepalive lets the browser
           finish the request, which a plain fetch is free to abandon. */
        keepalive: !!opts.keepalive,
      });
      const text = await (res.text ? res.text() : Promise.resolve('')).catch(() => '');
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
      if (!res.ok) {
        const msg = (json && (json.msg || json.error_description || json.error || json.message)) || ('HTTP ' + res.status);
        throw Object.assign(new Error(msg), { status: res.status, payload: json });
      }
      return json;
    } finally {
      if (kill) clearTimeout(kill);
    }
  }

  /* ---------------- session ---------------- */
  const now = () => (typeof performance !== 'undefined' && performance.now ? Date.now() : Date.now());

  function usable(s) { return !!s && !!s.access_token && (!s.expires_at || s.expires_at - now() > 30000); }
  /* Take ownership of a fresh/renewed JWT from GoTrue.  Named apart from adopt()
     below on purpose: one stores a session, the other stores merged save data, and
     a single `adopt` name in this closure silently meant both calls hit the
     second one — the save got the tokens merged into it and the request went out
     unauthenticated. */
  function keepSession(r) {
    if (!r || !r.access_token) throw new Error('unexpected sign-in response');
    const secs = Math.max(120, Number(r.expires_in || 3600) - 60);
    const s = { access_token: r.access_token, refresh_token: r.refresh_token || '', expires_at: now() + secs * 1000 };
    session = s;
    writeJSON(SESSION_KEY, s);
    return s;
  }
  function forgetSession() { session = null; writeJSON(SESSION_KEY, null); }
  function restoreSession() {
    /* The in-memory copy is only a cache; storage is what survives a reload, so
       re-read it whenever the cached token is no longer usable. */
    if (!session || !usable(session)) {
      const s = readJSON(SESSION_KEY);
      if (s && (usable(s) || s.refresh_token)) session = s;
    }
    return session;
  }

  async function ensureSession() {
    restoreSession();
    if (usable(session)) return session;
    if (session && session.refresh_token) {
      try {
        return await call('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token }, { anon: true })
          .then(r => keepSession(r));
      } catch (e) { /* refresh failed — start a new anonymous session */ }
    }
    try {
      return await call('/auth/v1/signup', { data: {} }, { anon: true }).then(r => keepSession(r));
    } catch (e) {
      if (e.status === 422 || /password/i.test(e.message)) {
        throw Object.assign(new Error('anonymous sign-ins are disabled on the project — enable Authentication → Sign In / Providers → Anonymous'), { hint: 'anon' });
      }
      throw e;
    }
  }

  /* ---------------- merge ---------------- */
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const keys = (a, b) => { const out = Object.keys(a || {}); for (const k of Object.keys(b || {})) if (out.indexOf(k) < 0) out.push(k); return out; };
  const union = (a, b) => { const out = Array.isArray(a) ? a.slice() : []; for (const v of (Array.isArray(b) ? b : [])) if (out.indexOf(v) < 0) out.push(v); return out; };

  /* Records mix directions: distance/score wants the larger value, a best *time*
     wants the smaller.  Anything else keeps this device's copy. */
  const RECORD_MIN = ['targetsBest'];

  function mergeNumbers(a, b, minKeys) {
    const out = {};
    for (const k of keys(a, b)) {
      const x = a && a[k], y = b && b[k];
      if (y === undefined) out[k] = x;
      else if (x === undefined) out[k] = y;
      else if (isNum(x) && isNum(y)) out[k] = (minKeys && minKeys.indexOf(k) >= 0) ? Math.min(x, y) : Math.max(x, y);
      else if (Array.isArray(x) && Array.isArray(y)) out[k] = union(x, y);
      else if (isObj(x) && isObj(y)) out[k] = mergeNumbers(x, y, minKeys);
      else out[k] = x;
    }
    return out;
  }

  /* Combine two SAVE.data objects.  Monotonic by design: coins, matches, stats,
     unlocks and completed challenges can only grow, so a device that syncs an
     older save never rolls progress back. */
  function mergeSave(a, b) {
    const L = a || {}, R = b || {};
    const out = {};
    for (const k of keys(L, R)) {
      const l = L[k], r = R[k];
      if (k === 'settings') { out[k] = Object.assign({}, r, l); continue; }     // sound/music stay per device
      if (k === 'records') { out[k] = mergeNumbers(l, r, RECORD_MIN); continue; }
      if (k === 'stats') { out[k] = mergeNumbers(l, r); continue; }              // lifetime counters
      if (l === undefined) { out[k] = r; continue; }
      if (r === undefined) { out[k] = l; continue; }
      if (isNum(l) && isNum(r)) { out[k] = Math.max(l, r); continue; }
      if (Array.isArray(l) && Array.isArray(r)) { out[k] = union(l, r); continue; }
      if (isObj(l) && isObj(r)) { out[k] = Object.assign({}, r, l); continue; }
      out[k] = l;
    }
    return out;
  }

  /* ---------------- sync ---------------- */
  function deviceTag() {
    try {
      const ua = String((typeof navigator !== 'undefined' && navigator.userAgent) || '');
      const browser = /Edg\//.test(ua) ? 'edge' : /OPR\//.test(ua) ? 'opera' : /Chrome\//.test(ua) ? 'chrome'
        : /Safari\//.test(ua) ? 'safari' : /firefox/i.test(ua) ? 'firefox' : 'unknown';
      const os = /Windows/.test(ua) ? 'windows' : /Mac OS X/.test(ua) ? 'mac' : /Android/.test(ua) ? 'android'
        : /(iPhone|iPad|iPod)/.test(ua) ? 'ios' : /Linux/.test(ua) ? 'linux' : 'other';
      return browser + '/' + os;
    } catch (e) { return 'unknown'; }
  }

  function publish() {
    for (const fn of watchers.slice()) { try { fn(state()); } catch (e) { } }
  }
  const watchers = [];
  function onChange(fn) { if (typeof fn === 'function') watchers.push(fn); return () => { const i = watchers.indexOf(fn); if (i >= 0) watchers.splice(i, 1); }; }

  function state() {
    const m = meta_();
    return {
      status, detail,
      configured: !!config().url && !!config().key,
      enabled: enabled(),
      signedIn: !!(session && session.access_token),
      rev: m.rev, lastSyncAt: m.lastSyncAt,
      pending: !!running,
    };
  }

  function fail(msg, e) {
    status = 'error';
    detail = msg + (e && e.message ? ' — ' + e.message : '');
    publish();
    return e || new Error(detail);
  }

  function markSaved() {
    try { lastPushed = JSON.stringify(local.read()); } catch (e) { lastPushed = ''; }
  }

  /* Adopt a payload we just agreed with the server on.  Stamping lastPushed
     *before* the write is what stops SAVE.save()'s own queue() hook from firing
     a redundant follow-up push of the data we just merged. */
  function adopt(incoming) {
    let merged = incoming;
    try { merged = mergeSave(local.read(), incoming); } catch (e) { return false; }
    const snap = JSON.stringify(merged);
    if (snap === JSON.stringify(local.read())) return false;
    lastPushed = snap;
    local.write(merged);
    return true;
  }

  async function pushOnce(row) {
    const r = await call('/rest/v1/rpc/save_sync', {
      p_data: row.data, p_rev: row.rev, p_device: deviceTag(), p_version: VERSION,
    }, { keepalive: !!row.beacon });
    const out = Array.isArray(r) ? r[0] : r;
    if (!out) throw new Error('empty response from save_sync');
    return { rev: Number(out.rev) || 0, applied: !!out.applied, data: out.data || null, at: out.updated_at || '' };
  }

  /* One sync = one round trip in the happy path.  `rev` is the revision we last
     saw; the server only accepts a push at that revision, and hands back its own
     row otherwise, so we merge and try once more. */
  async function sync(reason) {
    if (!enabled()) return { skipped: 'off' };
    if (running) { again = true; return running; }
    status = 'syncing'; detail = reason ? String(reason) : ''; publish();
    running = (async () => {
      try {
        const src = local.read();
        /* A save that has not loaded (or an empty one) is not a save to push: at
           revision 0 it would create a blank cloud row, and at the current
           revision it would overwrite a real one.  Refuse instead. */
        if (!src || typeof src !== 'object' || !Object.keys(src).length) {
          status = 'idle'; detail = 'no local save to sync yet'; publish();
          return { skipped: 'empty' };
        }
        await ensureSession();
        let rev = Number(meta_().rev) || 0;
        let payload = src;
        const beacon = reason === 'flush';
        for (let attempt = 0; ; attempt++) {
          const res = await pushOnce({ data: payload, rev, beacon });
          if (res.applied) {
            setMeta({ rev: res.rev, lastSyncAt: Date.now() });
            /* The server accepted our merge, which already contains the other
               device's progress — write it back so this device sees it too
               instead of waiting for the next pull. */
            if (attempt > 0) adopt(payload);
            markSaved();
            status = 'idle';
            detail = attempt > 0 ? 'merged with a newer save from another device' : '';
            return { ok: true, rev: res.rev, attempts: attempt + 1 };
          }
          payload = mergeSave(payload, res.data);
          rev = res.rev;
          setMeta({ rev: res.rev });
          if (attempt >= RETRIES) {
            /* Give up on pushing, but never lose either side: this device keeps
               the union, the cloud keeps its row, and the next real change starts
               from the revision the server reported. */
            const changed = adopt(payload);
            markSaved();
            status = 'idle';
            detail = changed ? 'merged with a newer save from another device'
              : 'another device is ahead; this save will push on the next change';
            return { ok: true, merged: changed, rev: res.rev, attempts: attempt + 1 };
          }
        }
      } catch (e) {
        throw fail('sync failed', e);
      } finally {
        publish();
      }
    })();
    const done = running.then(
      r => { running = null; if (again) { again = false; return sync('queued'); } return r; },
      e => { running = null; if (again) { again = false; return sync('queued'); } throw e; }
    );
    return done;
  }

  /* SAVE.save() calls this on every write.  Cheap: identical payloads are
     dropped, which also stops our own write-back during a sync from re-triggering
     a push. */
  function queue(delay) {
    if (!enabled()) return false;
    let snap = '';
    try { snap = JSON.stringify(local.read()); } catch (e) { return false; }
    if (snap && snap === lastPushed) return false;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      sync('dirty').catch(() => { });
    }, delay === undefined ? DEBOUNCE : delay);
    return true;
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (!enabled()) return Promise.resolve({ skipped: 'off' });
    return sync('flush').catch(() => ({ ok: false }));
  }

  async function syncNow() {
    if (timer) { clearTimeout(timer); timer = 0; }
    lastPushed = '';
    return sync('manual');
  }

  function boot() {
    if (!enabled()) { status = 'off'; publish(); return false; }
    status = 'idle';
    try {
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
      }
      if (typeof addEventListener === 'function') {
        addEventListener('pagehide', () => flush());
        addEventListener('beforeunload', () => flush());
      }
    } catch (e) { }
    sync('boot').catch(() => { });
    return true;
  }

  /* Forget this device: drop the stored session and revision, leave the cloud row
   * (and the local save) alone. */
  function disconnect(opts) {
    forgetSession();
    if (!opts || !opts.keepConfig) saveConfig({ enabled: false });
    setMeta({ rev: 0, lastSyncAt: meta_().lastSyncAt });
    lastPushed = '';
    status = 'off'; detail = 'disconnected from this device';
    publish();
  }

  return {
    config, saveConfig, enabled, boot, sync, syncNow, flush, queue, disconnect,
    state, onChange, mergeSave, deviceTag, forgetSession,
    KEYS: { CFG_KEY, SESSION_KEY, META_KEY },
    VERSION,
  };
})();
