/* ============================================================
   tools/cloudtest.js — cloud save-sync tests (game/js/cloud.js)
   ------------------------------------------------------------
   Loads the module in a fresh vm context with a stub localStorage, a stub
   fetch that speaks the same protocol as the Postgres function in
   supabase/migrations (rev-guarded get-or-create), and a stub SAVE — then
   checks the parts that could cost a player their progress: merge direction,
   revision conflicts, retries, and every failure path.

     node tools/cloudtest.js
     node tools/cloudtest.js conflict        filter by name
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeRunner, GAME } = require('./harness');

const T = makeRunner();
const { test, assert, near } = T;

const SRC = fs.readFileSync(path.join(GAME, 'js', 'cloud.js'), 'utf8') + '\n;globalThis.CloudSave = CloudSave;';

/* ------------------------------------------------------------------ */
/* in-memory stand-in for the Supabase project                        */
/* ------------------------------------------------------------------ */
function mockServer(opts = {}) {
  const s = {
    row: opts.row || null,          // { data, rev }  (null = no save yet)
    anonEnabled: opts.anonEnabled !== false,
    net: opts.net || 'up',          // 'down' → connection error, '500'
    calls: [],
    refreshes: 0,
    signups: 0,
  };
  s.fetch = async function (url, init = {}) {
    const body = init.body ? JSON.parse(init.body) : null;
    s.calls.push({ url, body, keepalive: !!(init && init.keepalive) });
    if (s.net === 'down') throw Object.assign(new Error('Failed to fetch'), { name: 'TypeError' });
    if (s.net === '500') return res(500, { message: 'database outage' });
    if (s.net === 'unauthorized') return res(401, { message: 'invalid api key' });
    const hdr = init.headers || {};
    if (!hdr.apikey) return res(401, { message: 'missing apikey' });

    if (url.endsWith('/auth/v1/signup')) {
      if (!s.anonEnabled) return res(422, { msg: 'Sign-ins with an empty Body are not allowed' });
      s.signups++;
      return res(200, { access_token: 'tok-' + s.signups, refresh_token: 'rt-' + s.signups, expires_in: 3600 });
    }
    if (url.includes('/auth/v1/token?grant_type=refresh_token')) {
      s.refreshes++;
      if (body.refresh_token !== 'rt-1') return res(400, { error_description: 'invalid refresh token' });
      return res(200, { access_token: 'tok-refreshed', refresh_token: 'rt-1', expires_in: 3600 });
    }
    if (url.endsWith('/rest/v1/rpc/save_sync')) {
      if (hdr.Authorization !== 'Bearer authenticated' && !/^Bearer tok/.test(hdr.Authorization || '')) {
        return res(401, { message: 'not signed in' });
      }
      const pRev = body.p_rev === undefined ? null : body.p_rev;
      if (pRev === null) {                                   // read only
        return res(200, s.row ? [{ rev: s.row.rev, updated_at: 'now', data: s.row.data, applied: false }]
          : [{ rev: 0, updated_at: null, data: null, applied: false }]);
      }
      if (!s.row) {                                          // get-or-create
        s.row = { data: body.p_data, rev: 1 };
        return res(200, [{ rev: 1, updated_at: 'now', data: s.row.data, applied: true }]);
      }
      if (Number(pRev) === Number(s.row.rev)) {
        s.row = { data: body.p_data, rev: Number(s.row.rev) + 1 };
        return res(200, [{ rev: s.row.rev, updated_at: 'now', data: s.row.data, applied: true }]);
      }
      return res(200, [{ rev: s.row.rev, updated_at: 'now', data: s.row.data, applied: false }]);
    }
    return res(404, { message: 'no such endpoint ' + url });
  };
  function res(status, json) {
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(json) };
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* load the module against stubs                                      */
/* ------------------------------------------------------------------ */
function load(stubs = {}) {
  const store = stubs.store || {};
  const save = { data: stubs.data || { unlocked: ['valor'], stats: {}, coins: 10, matches: 2, challengesDone: [], records: {}, settings: { music: true, sfx: true } }, writes: 0 };
  save.save = () => { save.writes++; };   // as core.js does, minus localStorage
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, Promise, Date, Math, JSON, Object, Array, String, Number,
    Boolean, Error, RegExp, TypeError, AbortController, isNaN, parseInt, parseFloat,
    localStorage: {
      getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    fetch: stubs.server ? stubs.server.fetch : async () => { throw new Error('no fetch stub'); },
    document: { addEventListener() { }, visibilityState: 'visible' },
    navigator: { userAgent: stubs.ua || 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120.0 Safari/537.36' },
    performance,
    SAVE: save,
  });
  ctx.globalThis = ctx;
  vm.runInContext(SRC, ctx, { filename: 'game/js/cloud.js' });
  if (stubs.configure !== false) {
    ctx.CloudSave.saveConfig({ url: 'https://test.supabase.co', key: 'sb_publishable_test', enabled: stubs.enabled !== false });
  }
  return { mod: ctx.CloudSave, store, save, ctx };
}

const pushes = s => s.calls.filter(c => c.url.endsWith('/rpc/save_sync'));

/* ------------------------------------------------------------------ */
test('merge: an older device syncing never rolls progress back', () => {
  const { mod } = load({ configure: false });
  const a = { unlocked: ['valor', 'grim'], stats: { kos: 40, maxDamage: 180 }, coins: 500, matches: 9, challengesDone: ['first_win'], records: { valor: 120, targetsBest: 44 }, settings: { music: true, sfx: true } };
  const b = { unlocked: ['valor', 'astra'], stats: { kos: 12, maxDamage: 60 }, coins: 40, matches: 2, challengesDone: ['first_win', 'tank'], records: { valor: 200, grim: 88, targetsBest: 51 }, settings: { music: false, sfx: true } };
  const m = mod.mergeSave(a, b);
  assert(m.coins === 500, 'coins must keep the larger balance, got ' + m.coins);
  assert(m.matches === 9, 'matches must keep the larger count');
  assert(m.stats.kos === 40 && m.stats.maxDamage === 180, 'stats must take the best of both');
  assert(m.unlocked.join(',') === 'valor,grim,astra', 'unlocked must union, got ' + m.unlocked);
  assert(m.challengesDone.join(',') === 'first_win,tank', 'challenges must union');
  near(m.records.valor, 200, 1e-9, 'distance records want the larger throw');
  near(m.records.grim, 88, 1e-9, 'records unique to the other device must survive');
  near(m.records.targetsBest, 44, 1e-9, 'a best *time* wants the smaller number');
  assert(m.settings.music === true, 'this device keeps its own sound settings');
});

test('merge: unknown and future fields are carried, not dropped', () => {
  const { mod } = load({ configure: false });
  const m = mod.mergeSave({ ghost: { a: 1 } }, { newThing: [1, 2], ghost: { b: 2 } });
  assert(Array.isArray(m.newThing) && m.newThing.length === 2, 'an unknown array field must pass through');
  assert(m.ghost && m.ghost.a === 1 && m.ghost.b === 2, 'nested objects merge rather than overwrite');
});

test('sync: a clean boot pulls, pushes and bumps the revision', async () => {
  const server = mockServer({ row: null });
  const { mod, save } = load({ server });
  await mod.syncNow();
  assert(server.signups === 1, 'one anonymous session, got ' + server.signups);
  const p = pushes(server);
  assert(p.length === 1, 'one push, got ' + p.length);
  assert(p[0].body.p_rev === 0, 'a first push is made at revision 0');
  assert(p[0].body.p_data.coins === 10, 'the payload is the local save');
  assert(p[0].body.p_device === 'chrome/mac', 'device tag comes from the UA, got ' + p[0].body.p_device);
  assert(mod.state().rev === 1, 'the stored revision is the server revision');
  assert(mod.state().signedIn && mod.state().status === 'idle', 'signed in and quiet afterwards');
  assert(save.data.coins === 10, 'a clean sync never rewrites the local save');
  assert(save.writes === 0, 'nor writes at all when there was nothing to merge');
});

test('sync: an unchanged save does not touch the network again', async () => {
  const server = mockServer({ row: null });
  const { mod, save } = load({ server });
  await mod.syncNow();
  const before = server.calls.length;
  assert(mod.queue(1) === false, 'queue() on identical data is a no-op');
  await new Promise(r => setTimeout(r, 30));
  assert(pushes(server).length === 1, 'no extra pushes, got ' + pushes(server).length);
  assert(server.calls.length === before, 'nothing at all was sent');
  save.data.coins = 11;
  assert(mod.queue(1) === true, 'a real change is queued');
  await new Promise(r => setTimeout(r, 40));
  assert(pushes(server).length === 2, 'and then pushed');
});

test('conflict: a stale revision merges the server copy and retries once', async () => {
  const server = mockServer({ row: { data: { coins: 40, matches: 30, stats: { kos: 5 } }, rev: 5 } });
  const { mod, save } = load({ server });
  await mod.syncNow();
  const p = pushes(server);
  assert(p.length === 2, 'rejected at rev 0, then retried at the server revision; calls=' + p.length);
  assert(p[1].body.p_rev === 5, 'the retry carries the revision the server reported');
  assert(p[1].body.p_data.coins === 40, 'the retry payload is the merge, coins=' + p[1].body.p_data.coins);
  near(save.data.coins, 40, 1e-9, 'the device adopts the larger balance');
  assert(save.data.matches === 30 && save.data.stats.kos === 5, 'the other side counters come back too');
  assert(server.row.rev === 6, 'merged payload was accepted, rev=' + server.row.rev);
  assert(save.writes === 1, 'the merged save is written back exactly once, got ' + save.writes);
  assert(mod.state().status === 'idle' && /merged/.test(mod.state().detail), 'the panel explains the merge: ' + mod.state().detail);
});

test('conflict: a server that keeps moving does not loop forever', async () => {
  const server = mockServer({ row: { data: { coins: 1 }, rev: 5 } });
  const original = server.fetch;
  let n = 0;
  server.fetch = async (url, init) => {
    if (url.endsWith('/rpc/save_sync')) {
      n++;
      server.row = { data: { coins: n }, rev: 100 + n };     // always ahead of us
      return { ok: true, status: 200, text: async () => JSON.stringify([{ rev: server.row.rev, updated_at: 'now', data: server.row.data, applied: false }]) };
    }
    return original(url, init);
  };
  const { mod, save } = load({ server });
  await mod.syncNow();
  assert(n === 2, 'exactly one retry, then it stops; pushes=' + n);
  assert(save.data.coins >= 1, 'the local save stays usable');
  assert(mod.state().status !== 'syncing', 'the module is not stuck in a spin');
});

test('offline: a dropped connection keeps the local save working', async () => {
  const server = mockServer({ net: 'down' });
  const { mod, save } = load({ server });
  await mod.syncNow().catch(() => { });
  assert(mod.state().status === 'error', 'reports an error, got ' + mod.state().status);
  assert(/Failed to fetch/.test(mod.state().detail), 'with the reason: ' + mod.state().detail);
  near(save.data.coins, 10, 1e-9, 'the save itself is untouched');
  save.data.coins = 99; save.data.matches = 3;
  assert(mod.queue(1) === true, 'play continues to queue while offline');
  await new Promise(r => setTimeout(r, 30));
  assert(mod.state().status === 'error', 'and still fails quietly');
  near(save.data.coins, 99, 1e-9, 'never rolled back by a failed sync');
});

test('server error: a 500 is reported, not swallowed as success', async () => {
  const server = mockServer({ net: '500' });
  const { mod } = load({ server });
  await mod.syncNow().catch(() => { });
  assert(mod.state().status === 'error', 'error state, got ' + mod.state().status);
  assert(/database outage/.test(mod.state().detail), 'surfaces the server message: ' + mod.state().detail);
  assert(mod.state().rev === 0, 'the revision must not advance on a failed push');
});

test('auth: anonymous sign-ins disabled says what to switch on', async () => {
  const server = mockServer({ anonEnabled: false });
  const { mod } = load({ server });
  await mod.syncNow().catch(() => { });
  assert(mod.state().status === 'error', 'refuses politely');
  assert(/anonymous/i.test(mod.state().detail), 'mentions anonymous sign-ins: ' + mod.state().detail);
  assert(pushes(server).length === 0, 'and never writes without a session');
});

test('session: an expired token is refreshed on reload, not re-signed-up', async () => {
  const server = mockServer({ row: null });
  const first = load({ server });
  await first.mod.syncNow();
  const sessionKey = first.mod.KEYS.SESSION_KEY;
  const s = JSON.parse(first.store[sessionKey]);
  assert(s.access_token === 'tok-1', 'the first session is an anonymous one');
  s.expires_at = Date.now() - 1000;                          // the tab was left open overnight
  first.store[sessionKey] = JSON.stringify(s);
  server.signups = 0;
  /* a reload = a fresh module over the same localStorage */
  const again = load({ server, store: first.store });
  await again.mod.syncNow();
  assert(server.refreshes === 1, 'refreshed once, got ' + server.refreshes);
  assert(server.signups === 0, 'did not mint a second player for the same device');
  assert(JSON.parse(first.store[sessionKey]).access_token === 'tok-refreshed', 'keeps the new token');
  assert(pushes(server).length === 2, 'and still pushed after refreshing');
});

test('off: nothing is sent while the player has not turned it on', async () => {
  const server = mockServer({ row: null });
  const { mod, save } = load({ server, enabled: false });
  save.data.coins = 77;
  assert(mod.queue(1) === false, 'queue() refuses when disabled');
  await new Promise(r => setTimeout(r, 20));
  await mod.syncNow();
  assert(server.calls.length === 0, 'zero requests, got ' + server.calls.length);
  assert(mod.state().enabled === false && mod.state().configured === true, 'configured but off');
});

test('disconnect: forgets the device but keeps the cloud row and the local save', async () => {
  const server = mockServer({ row: null });
  const { mod, store, save } = load({ server });
  await mod.syncNow();
  assert(server.row && server.row.rev === 1, 'row exists first');
  mod.disconnect();
  assert(!store['rift-rumble-cloud-session-v1'], 'session dropped');
  assert(mod.state().enabled === false, 'toggled off here');
  assert(mod.state().rev === 0, 'forgets the revision so the next opt-in re-reads');
  near(save.data.coins, 10, 1e-9, 'local save intact');
  const kept = server.row;
  await mod.syncNow().catch(() => { });
  assert(server.row === kept, 'no further writes to the cloud row');
});

test('bad config: a junk URL or key fails into a message, not a crash', async () => {
  const server = mockServer({ row: null, net: 'unauthorized' });
  const { mod } = load({ server });
  mod.saveConfig({ url: 'https://test.supabase.co', key: 'wrong-key' });
  await mod.syncNow().catch(() => { });
  assert(mod.state().status === 'error', 'reported');
  assert(/invalid api key/.test(mod.state().detail), mod.state().detail);
});

test('guard: an unloaded or empty save is never pushed over a real one', async () => {
  const server = mockServer({ row: { data: { coins: 500 }, rev: 7 } });
  const { mod, save } = load({ server });
  save.data = {};                                   // SAVE.load() has not run yet
  await mod.syncNow();
  assert(pushes(server).length === 0, 'nothing sent, got ' + pushes(server).length);
  assert(/no local save/.test(mod.state().detail), 'and the panel says why: ' + mod.state().detail);
  assert(server.row.rev === 7 && server.row.data.coins === 500, 'the cloud row is untouched');
  save.data = { coins: 3 };
  await mod.syncNow();
  assert(pushes(server).length === 2, 'a real save is pushed, and retried once at the server revision');
  assert(save.data.coins === 500, 'the fresh device adopts the cloud coins, got ' + save.data.coins);
  assert(server.row.rev === 8 && server.row.data.coins === 500, 'and the merged blob lands in the cloud row');
});

test('pagehide: the last push of a session is sent with keepalive', async () => {
  const server = mockServer({ row: null });
  const { mod } = load({ server });
  await mod.syncNow();
  assert(pushes(server).some(c => !c.keepalive), 'a normal push is a plain fetch');
  mod.saveConfig({ url: 'https://test.supabase.co', key: 'sb_publishable_test', enabled: true });
  await mod.flush();
  const last = pushes(server).slice(-1)[0];
  assert(last.keepalive === true, 'a flush on pagehide survives the tab closing');
});

T.run(process.argv[2]).then(n => process.exit(n ? 1 : 0));
