/* ============================================================
   RIFT RUMBLE — UI: screens, menus, select, results, records
   ============================================================ */
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const UI = (() => {
  const $$ = s => Array.from(document.querySelectorAll(s));
  let current = 'screen-title';
  let fighters = ['valor', 'grim', 'vesper', 'rook'];   // per-slot keys (4 max)
  let pals = [0, 0, 0, 0];
  let isCPU = [false, true, true, true];
  let teamAssign = [0, 1, 0, 1];
  let activeSlots = 2;
  let selSlot = 0;
  let cursorFighter = 0;
  let rules = Object.assign({}, DEFAULT_RULES);
  let menuIndex = 0;
  let stageIdx = 0;
  let toastTimer = 0;
  let lastScreen = null;
  let vsCPULevel = 5;
  let modeTarget = 'vs';
  let toastEl = null;

  function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }

  function show(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    const s = document.getElementById(id);
    if (s) s.classList.add('active');
    current = id;
    if (id !== 'screen-match' && id !== 'screen-results') AUDIO.stopMusic();
  }

  function toast(msg) {
    if (!toastEl) { toastEl = el(`<div class="toast"></div>`); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400);
  }

  /* ---------------- title ---------------- */
  function buildTitle() {
    const save = SAVE.data;
    $('#title-meta').innerHTML = `
      <span>${save.unlocked.length} FIGHTERS</span><span>·</span>
      <span>${save.matches} MATCHES</span><span>·</span>
      <span>${save.coins} RIFT COINS</span>`;
    AUDIO.startMusic();
  }

  /* ---------------- character select ---------------- */
  function fighterCard(key, i) {
    const d = FIGHTERS[key];
    const locked = !SAVE.data.unlocked.includes(key);
    return `<div class="fcell ${locked ? 'locked' : ''}" data-key="${key}" data-i="${i}" style="--c:${d.color}">
      <img src="assets/portraits/${key}_base.png" alt="${d.name}">
      <div class="fmeta"><b>${d.name}</b><small>${d.title}</small></div>
    </div>`;
  }

  function buildSelect() {
    const grid = $('#fighter-grid');
    grid.innerHTML = FIGHTER_KEYS.map((k, i) => fighterCard(k, i)).join('');
    grid.querySelectorAll('.fcell').forEach(c => c.addEventListener('click', () => {
      const key = c.dataset.key;
      if (!SAVE.data.unlocked.includes(key)) { AUDIO.sfx('back'); toast('LOCKED — WIN MATCHES TO UNLOCK'); return; }
      AUDIO.sfx('menu'); fighters[selSlot] = key; pals[selSlot] = 0; renderSelect();
    }));
    $('#slot-tabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      selSlot = +b.dataset.slot; AUDIO.sfx('menu'); renderSelect();
    }));
    $('#pal-row').addEventListener('click', e => {
      const sw = e.target.closest('.swatch'); if (!sw) return;
      pals[selSlot] = +sw.dataset.p; AUDIO.sfx('menu'); renderSelect();
    });
    $('#cpu-toggle').addEventListener('click', () => {
      isCPU[selSlot] = !isCPU[selSlot]; AUDIO.sfx('menu'); renderSelect();
    });
    $('#add-slot').addEventListener('click', () => {
      if (activeSlots < 4) { activeSlots++; selSlot = activeSlots - 1; isCPU[selSlot] = true; AUDIO.sfx('confirm'); renderSelect(); }
    });
    $('#rem-slot').addEventListener('click', () => {
      if (activeSlots > 2) { activeSlots--; selSlot = Math.min(selSlot, activeSlots - 1); AUDIO.sfx('back'); renderSelect(); }
    });
    $('#sel-rules').addEventListener('click', () => { AUDIO.sfx('menu'); buildRules(); show('screen-rules'); lastScreen = 'screen-select'; });
    $('#sel-fight').addEventListener('click', () => { AUDIO.sfx('confirm'); startFromSelect(); });
    $('#sel-stage').addEventListener('click', () => { AUDIO.sfx('menu'); buildStages(); show('screen-stage'); lastScreen = 'screen-select'; });
    $('#cpu-level').addEventListener('input', e => { rules.aiLevel = +e.target.value; vsCPULevel = +e.target.value; renderSelect(); });
  }

  function renderSelect() {
    const tabs = [];
    for (let i = 0; i < activeSlots; i++) tabs.push(`<button data-slot="${i}" class="${i === selSlot ? 'on' : ''}" style="--c:${FIGHTERS[fighters[i]].color}">P${i + 1}${isCPU[i] ? ' · CPU' : ''}</button>`);
    $('#slot-tabs').innerHTML = tabs.join('');
    $('#slot-tabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { selSlot = +b.dataset.slot; AUDIO.sfx('menu'); renderSelect(); }));

    $$('#fighter-grid .fcell').forEach(c => c.classList.toggle('sel', c.dataset.key === fighters[selSlot]));
    const d = FIGHTERS[fighters[selSlot]];
    const pal = d.palettes[pals[selSlot] % d.palettes.length];
    $('#hero-name').textContent = d.name;
    $('#hero-title').textContent = d.title;
    $('#hero-arch').textContent = d.archetype;
    $('#hero-portrait').src = `assets/portraits/${fighters[selSlot]}_base.png`;
    $('#hero-portrait').style.setProperty('--c', d.color);
    $('#hero-moves').innerHTML = Object.values(d.moves).slice(0, 6).map(m => `<span>${m.name}</span>`).join('') +
      Object.values(d.specials).map(s => `<span class="sp">${s.name}</span>`).join('');
    $('#pal-row').innerHTML = d.palettes.map((p, i) =>
      `<div class="swatch ${i === pals[selSlot] ? 'on' : ''}" data-p="${i}" title="${p.name}" style="background:linear-gradient(135deg,${p.primary},${p.accent})"></div>`).join('');
    $('#cpu-toggle').textContent = isCPU[selSlot] ? 'CPU: ON' : 'HUMAN';
    $('#cpu-toggle').classList.toggle('on', isCPU[selSlot]);
    $('#cpu-level').value = rules.aiLevel;
    $('#cpu-level-val').textContent = rules.aiLevel;
    $('#cpu-level-wrap').style.opacity = isCPU.some((v, i) => v && i < activeSlots) ? 1 : 0.35;
    $('#sel-summary').innerHTML = Array.from({ length: activeSlots }, (_, i) =>
      `<div class="sum" style="--c:${FIGHTERS[fighters[i]].color}"><img src="assets/portraits/${fighters[i]}_base.png"><span>${isCPU[i] ? 'CPU' : 'P' + (i + 1)}</span></div>`).join('');
    $('#rule-summary').textContent = `${rules.mode.toUpperCase()} · ${rules.stocks} STOCK${rules.stocks > 1 ? 'S' : ''}${rules.mode !== 'stock' ? ' · ' + Math.floor(rules.time / 60) + ' MIN' : ''} · ${STAGES[rules.stage].name} · ITEMS ${rules.items.toUpperCase()}`;
  }

  /* ---------------- stages ---------------- */
  function buildStages() {
    $('#stage-grid').innerHTML = STAGE_KEYS.map((k, i) => {
      const s = STAGES[k];
      return `<div class="scell ${k === rules.stage ? 'sel' : ''}" data-k="${k}" style="--c:${s.accent}">
        <canvas class="sthumb" data-stage="${k}" width="260" height="130"></canvas>
        <b>${s.name}</b><small>${s.sub}</small>
      </div>`;
    }).join('');
    $$('#stage-grid .scell').forEach(c => c.addEventListener('click', () => {
      rules.stage = c.dataset.k; AUDIO.sfx('menu'); buildStages();
    }));
    drawStageThumbs();
    const rnd = $('#stage-random');
    rnd.classList.toggle('on', rules.stageRandom);
    rnd.onclick = () => { rules.stageRandom = !rules.stageRandom; AUDIO.sfx('menu'); buildStages(); };
    $('#stage-back').onclick = () => { AUDIO.sfx('back'); if (lastScreen === 'screen-select') { renderSelect(); show('screen-select'); } else { openTitle(); } };
    $('#stage-go').onclick = () => { AUDIO.sfx('confirm'); startFromSelect(); };
  }

  function drawStageThumbs() {
    $$('#stage-grid canvas.sthumb').forEach(cv => {
      const ctx = cv.getContext('2d');
      const s = STAGES[cv.dataset.stage];
      const W = cv.width, H = cv.height;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, s.bg[0]); g.addColorStop(0.6, s.bg[1]); g.addColorStop(1, s.bg[2]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // ground
      const gd = s.ground;
      const sx = W / 1500;
      const ox = W / 2;
      ctx.fillStyle = shade(s.bg[2], 0.2);
      ctx.fillRect(ox + gd.x * sx, H * 0.72, gd.w * sx, 12);
      ctx.fillStyle = withAlpha(s.accent, 0.9);
      ctx.fillRect(ox + gd.x * sx, H * 0.72 - 2, gd.w * sx, 2.5);
      s.platforms.forEach(p => {
        ctx.fillStyle = shade(s.bg[2], 0.3);
        ctx.fillRect(ox + p.x * sx, H * 0.72 - (-p.y) * sx * 0.9, p.w * sx, 4);
        ctx.fillStyle = withAlpha(s.accent, 0.7);
        ctx.fillRect(ox + p.x * sx, H * 0.72 - (-p.y) * sx * 0.9 - 1, p.w * sx, 1.6);
      });
      // sparkle
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = i % 3 ? s.accent : '#ffffff';
        ctx.fillRect((i * 97 % W), (i * 53 % (H * 0.6)), 1.4, 1.4);
      }
      ctx.globalAlpha = 1;
    });
  }

  /* ---------------- rules ---------------- */
  function buildRules() {
    const r = rules;
    $('#rules-body').innerHTML = `
      <div class="rrow"><label>MODE</label><div class="seg" data-k="mode">
        ${['stock', 'time', 'stamina'].map(v => `<button data-v="${v}" class="${r.mode === v ? 'on' : ''}">${v.toUpperCase()}</button>`).join('')}
      </div></div>
      <div class="rrow"><label>STOCKS</label><div class="seg" data-k="stocks">
        ${[1, 2, 3, 4, 5, 8].map(v => `<button data-v="${v}" class="${r.stocks === v ? 'on' : ''}">${v}</button>`).join('')}
      </div></div>
      <div class="rrow"><label>TIME</label><div class="seg" data-k="time">
        ${[60, 120, 150, 180, 300, 420].map(v => `<button data-v="${v}" class="${r.time === v ? 'on' : ''}">${v / 60}M</button>`).join('')}
      </div></div>
      <div class="rrow"><label>ITEMS</label><div class="seg" data-k="items">
        ${['none', 'low', 'medium', 'high'].map(v => `<button data-v="${v}" class="${r.items === v ? 'on' : ''}">${v.toUpperCase()}</button>`).join('')}
      </div></div>
      <div class="rrow"><label>TEAMS</label><div class="seg" data-k="teams">
        <button data-v="0" class="${!r.teams ? 'on' : ''}">FREE-FOR-ALL</button>
        <button data-v="1" class="${r.teams ? 'on' : ''}">TEAM BATTLE</button>
      </div></div>
      <div class="rrow"><label>TEAM ATTACK</label><div class="seg" data-k="teamAttack">
        <button data-v="0" class="${!r.teamAttack ? 'on' : ''}">OFF</button>
        <button data-v="1" class="${r.teamAttack ? 'on' : ''}">ON</button>
      </div></div>
      <div class="rrow"><label>HAZARDS</label><div class="seg" data-k="hazards">
        <button data-v="0" class="${!r.hazards ? 'on' : ''}">OFF</button>
        <button data-v="1" class="${r.hazards ? 'on' : ''}">ON</button>
      </div></div>
      <div class="rrow"><label>DAMAGE RATIO</label><div class="seg" data-k="damageRatio">
        ${[0.5, 0.75, 1, 1.25, 1.5, 2].map(v => `<button data-v="${v}" class="${r.damageRatio === v ? 'on' : ''}">${v}x</button>`).join('')}
      </div></div>`;
    $$('#rules-body .seg button').forEach(b => b.addEventListener('click', () => {
      const k = b.parentElement.dataset.k, v = b.dataset.v;
      rules[k] = ['mode', 'items'].includes(k) ? v : (isNaN(+v) ? v : +v);
      if (k === 'teams') rules.teams = v === '1';
      if (k === 'teamAttack') rules.teamAttack = v === '1';
      if (k === 'hazards') rules.hazards = v === '1';
      if (k === 'damageRatio') rules.damageRatio = +v;
      if (k === 'items') rules.items = v;
      AUDIO.sfx('menu'); buildRules();
    }));
    $('#rules-back').onclick = () => { AUDIO.sfx('back'); renderSelect(); show('screen-select'); };
    $('#rules-go').onclick = () => { AUDIO.sfx('confirm'); startFromSelect(); };
  }

  /* ---------------- start match ---------------- */
  function startFromSelect() {
    if (modeTarget === 'classic') { AUDIO.sfx('confirm'); Modes.startClassic(fighters[0], pals[0], rules.aiLevel); return; }
    if (modeTarget === 'targets') { AUDIO.sfx('confirm'); Modes.startTargets(fighters[0], pals[0]); return; }
    if (modeTarget === 'homered') { AUDIO.sfx('confirm'); Modes.startHomeRun(fighters[0], pals[0]); return; }
    if (modeTarget === 'multiman') { AUDIO.sfx('confirm'); Modes.startMultiMan(fighters[0], pals[0], rules.aiLevel); return; }
    const stageKey = rules.stageRandom ? pick(STAGE_KEYS) : rules.stage;
    const cast = [];
    for (let i = 0; i < activeSlots; i++) {
      cast.push({
        key: fighters[i], palIdx: pals[i] % FIGHTERS[fighters[i]].palettes.length,
        isCPU: isCPU[i], team: rules.teams ? (i % 2) : 0,
        label: isCPU[i] ? 'CPU' : 'P' + (i + 1),
      });
    }
    Game.startMatch({ rules: JSON.parse(JSON.stringify(rules)), cast, stageKey });
  }

  /* ---------------- results ---------------- */
  function showResults(match) {
    const ranks = match.fighters.slice().sort((a, b) => {
      if (a.stocks !== b.stocks) return b.stocks - a.stocks;
      if (a.stats.kos !== b.stats.kos) return b.stats.kos - a.stats.kos;
      return a.damage - b.damage;
    });
    const win = ranks[0];
    $('#res-winner').innerHTML = `<img src="assets/portraits/${win.key}_base.png" class="win-img" style="--c:${win.pal.accent}">
      <div><h2 style="color:${win.pal.accent}">${win.def.name}</h2><p>${win.isCPU ? 'CPU' : 'PLAYER ' + (win.playerIndex + 1)} WINS</p></div>`;
    $('#res-table').innerHTML = `<div class="rt head"><span>#</span><span>FIGHTER</span><span>STOCKS</span><span>KO</span><span>FALLS</span><span>DEALT</span><span>TAKEN</span></div>` +
      ranks.map((f, i) => `<div class="rt ${i === 0 ? 'first' : ''}" style="--c:${f.pal.accent}">
        <span>${i + 1}</span>
        <span class="fname"><img src="assets/portraits/${f.key}_base.png">${f.def.name}${f.isCPU ? ' <em>CPU</em>' : ''}</span>
        <span>${f.stocks}</span><span>${f.stats.kos}</span><span>${f.stats.falls}</span>
        <span>${Math.round(f.stats.dealt)}%</span><span>${Math.round(f.stats.taken)}%</span>
      </div>`).join('');
    const s = SAVE.data;
    $('#res-challenges').innerHTML = s.challengesDone.map(id => `<span>✔ ${({ first_win: 'FIRST VICTORY', five_ko: 'FIVE KOs IN ONE MATCH', tank: 'SURVIVED PAST 200%', heal_up: 'USED A RECOVERY ITEM' })[id] || id}</span>`).join('') || '<span class="dim">No challenges yet</span>';
    show('screen-results');
  }

  /* ---------------- records ---------------- */
  function buildRecords() {
    const s = SAVE.data;
    const best = s.records;
    $('#records-body').innerHTML = `
      <div class="rec"><h3>LIFETIME</h3>
        <div class="rgrid">
          <div><b>${s.matches}</b><span>MATCHES</span></div>
          <div><b>${s.stats.kos || 0}</b><span>KOs</span></div>
          <div><b>${s.stats.falls || 0}</b><span>FALLS</span></div>
          <div><b>${s.coins}</b><span>RIFT COINS</span></div>
        </div>
      </div>
      <div class="rec"><h3>CHALLENGES</h3>
        <div class="chlist">
          ${[['first_win', 'Win your first match'], ['five_ko', 'Score 5 KOs in one match'], ['tank', 'Survive past 200% damage'], ['heal_up', 'Use a recovery item']]
        .map(([id, desc]) => `<div class="ch ${s.challengesDone.includes(id) ? 'done' : ''}"><span class="dot"></span>${desc}</div>`).join('')}
        </div>
      </div>
      <div class="rec"><h3>ROSTER</h3>
        <div class="rosterrow">${FIGHTER_KEYS.map(k => `<div class="rchip ${s.unlocked.includes(k) ? '' : 'locked'}" style="--c:${FIGHTERS[k].color}"><img src="assets/portraits/${k}_base.png"><b>${FIGHTERS[k].name}</b></div>`).join('')}</div>
      </div>
      ${buildCloudPanel()}
      <p class="hint">Earn Rift Coins by completing challenges. All fighters are unlocked from the start — the coin system tracks mastery progress.</p>`;
    wireCloudPanel();
    show('screen-records');
  }

  /* ---- Cloud saves (Settings → js/cloud.js) ---- */
  function cloudState() {
    try { return (typeof CloudSave !== 'undefined' && CloudSave) ? CloudSave.state() : null; } catch (e) { return null; }
  }
  const CLOUD_LABEL = { off: 'OFF', idle: 'SYNCED', syncing: 'SYNCING…', error: 'NOT SYNCED' };

  function buildCloudPanel() {
    if (typeof CloudSave === 'undefined' || !CloudSave) return '';
    const st = cloudState() || { enabled: false, configured: false };
    const cfg = CloudSave.config();
    const when = st.lastSyncAt ? new Date(st.lastSyncAt).toLocaleString() : 'never';
    const note = st.enabled
      ? `${CLOUD_LABEL[st.status] || st.status}${st.detail ? ' · ' + st.detail : ''} · rev ${st.rev || 0} · last sync ${when}`
      : st.configured
        ? 'Turn it on to push this save to your Supabase project and pull it on any other device.'
        : 'Paste your project URL and publishable (anon) key to enable cross-device saves.';
    return `
      <div class="rec" id="cloud-panel">
        <h3>CLOUD SAVES</h3>
        <div class="cld">
          <div class="cld-row">
            <button class="pill ${st.enabled ? 'on' : ''}" id="cloud-toggle">${st.enabled ? 'SYNCED TO CLOUD' : 'LOCAL ONLY'}</button>
            <span class="cld-note">${note}</span>
          </div>
          <label class="cld-field"><span>PROJECT URL</span><input id="cloud-url" type="url" placeholder="https://xxxxxxxx.supabase.co" value="${cfg.url || ''}" autocomplete="off" spellcheck="false"></label>
          <label class="cld-field"><span>PUBLISHABLE KEY</span><input id="cloud-key" type="text" placeholder="${cfg.key ? 'saved — type to replace it' : 'sb_publishable_… (or the legacy anon key)'}" autocomplete="off" spellcheck="false"></label>
          <div class="cld-row">
            <button class="pill" id="cloud-sync">SYNC NOW</button>
            <button class="pill" id="cloud-forget">FORGET THIS DEVICE</button>
          </div>
        </div>
      </div>`;
  }

  let cloudUnsub = null;
  function refreshCloudPanel() {
    const host = document.getElementById('cloud-panel');
    if (!host) return;
    if (cloudUnsub) { try { cloudUnsub(); } catch (e) { } cloudUnsub = null; }
    const tmp = document.createElement('div');
    tmp.innerHTML = buildCloudPanel();
    const fresh = tmp.firstElementChild;
    if (!fresh) return;
    if (host.replaceWith) host.replaceWith(fresh); else host.parentElement.replaceChild(fresh, host);
    wireCloudPanel();
  }

  function wireCloudPanel() {
    if (typeof CloudSave === 'undefined' || !CloudSave) return;
    const $ = sel => document.querySelector(sel);
    const on = (sel, ev, fn) => { const n = $(sel); if (n) n.addEventListener(ev, fn); };
    on('#cloud-toggle', 'click', () => {
      const cfg = CloudSave.config();
      if (!cfg.url || !cfg.key) { AUDIO.sfx('back'); return; }
      const next = !cfg.enabled;
      CloudSave.saveConfig({ enabled: next });
      if (next) CloudSave.syncNow().catch(() => { });
      AUDIO.sfx('menu');
      refreshCloudPanel();
    });
    on('#cloud-sync', 'click', () => { AUDIO.sfx('menu'); CloudSave.syncNow().catch(() => { }); setTimeout(refreshCloudPanel, 1200); });
    on('#cloud-forget', 'click', () => { AUDIO.sfx('back'); CloudSave.disconnect(); refreshCloudPanel(); });
    for (const [sel, field] of [['#cloud-url', 'url'], ['#cloud-key', 'key']]) {
      const node = $(sel);
      if (!node) continue;
      node.addEventListener('change', () => {
        const v = node.value.trim();
        if (!v) return;                                  // untouched field, leave it alone
        CloudSave.saveConfig({ [field]: v });
        AUDIO.sfx('menu');
        refreshCloudPanel();
      });
    }
    const st = cloudState();
    if (st && st.enabled && CloudSave.onChange) cloudUnsub = CloudSave.onChange(() => { try { refreshCloudPanel(); } catch (e) { } });
  }

  function hideResults() { show('screen-match'); }

  function showCustomResults(cfg) {
    $('#res-winner').innerHTML = `<img src="${cfg.img}" class="win-img" style="--c:${cfg.color}">
      <div><h2 style="color:${cfg.color}">${cfg.title}</h2><p>${cfg.sub}</p></div>`;
    $('#res-table').innerHTML = `<div class="res-table">${cfg.lines.map(l => `<div class="rt" style="grid-template-columns:1fr"><span>${l}</span></div>`).join('')}</div>`;
    $('#res-challenges').innerHTML = '';
    $('#hud').style.display = 'none';
    show('screen-results');
  }

  function openTitle() {
    buildTitle();
    show('screen-title');
    AUDIO.startMusic();
  }

  /* ---------------- playback / pause ---------------- */
  function setupMatchScreen() {
    $('#pause-overlay').classList.remove('on');
    $('#btn-resume').onclick = () => { Game.togglePause(false); };
    $('#btn-restart').onclick = () => { Game.togglePause(false); Game.restart(); };
    $('#btn-quit').onclick = () => { Game.togglePause(false); Game.quitToMenu(); };
    $('#btn-pause').onclick = () => Game.togglePause(true);
  }

  function showPause(on) { $('#pause-overlay').classList.toggle('on', on); }

  function boot() {
    SAVE.load();
    INPUT.init();
    buildTitle();
    buildSelect();
    setupMatchScreen();
    $('#btn-vs').onclick = () => { AUDIO.sfx('confirm'); modeTarget = 'vs'; show('screen-select'); renderSelect(); };
    $$('#screen-title .modebtn').forEach(b => b.addEventListener('click', () => {
      AUDIO.sfx('confirm');
      modeTarget = b.dataset.mode;
      show('screen-select'); renderSelect();
    }));
    $('#btn-records').onclick = () => { AUDIO.sfx('menu'); buildRecords(); };
    $('#records-back').onclick = () => { AUDIO.sfx('back'); openTitle(); };
    $('#btn-help').onclick = () => { AUDIO.sfx('menu'); show('screen-help'); };
    $('#help-back').onclick = () => { AUDIO.sfx('back'); openTitle(); };
    $('#btn-results-again').onclick = () => { AUDIO.sfx('confirm'); Game.restart(); };
    $('#btn-results-char').onclick = () => { AUDIO.sfx('menu'); renderSelect(); show('screen-select'); };
    $('#btn-results-menu').onclick = () => { AUDIO.sfx('menu'); Modes.reset(); openTitle(); };
    $('#btn-results-char').onclick = () => { AUDIO.sfx('menu'); Modes.reset(); renderSelect(); show('screen-select'); };
    $('#sel-back').onclick = () => { AUDIO.sfx('back'); openTitle(); };

    window.addEventListener('ui-escape', () => {
      if (current === 'screen-match') { Game.togglePause(); }
      else if (['screen-select', 'screen-rules', 'screen-stage', 'screen-records', 'screen-help'].includes(current)) {
        if (current === 'screen-stage' || current === 'screen-rules') { renderSelect(); show('screen-select'); }
        else openTitle();
      }
    });
    window.addEventListener('ui-enter', () => {
      if (current === 'screen-title') { AUDIO.sfx('confirm'); renderSelect(); show('screen-select'); }
    });
    $('[data-toucha]') && $$('.touchbtn').forEach(b => {
      const key = b.dataset.touch;
      const map = INPUT.map.p1;
      const code = { left: map.left, right: map.right, up: map.up, down: map.down, attack: map.attack, special: map.special, jump: map.jump, shield: map.shield, grab: map.grab }[key];
      const down = e => { e.preventDefault(); INPUT.keys[code] = true; INPUT.pressed[code] = true; b.classList.add('down'); };
      const up = e => { e.preventDefault(); INPUT.keys[code] = false; b.classList.remove('down'); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    });
    show('screen-title');
  }

  return {
    boot, show, toast, showResults, showCustomResults, hideResults, showPause, renderSelect, openTitle,
    get modeTarget() { return modeTarget; },
    get current() { return current; },
    get rules() { return rules; },
  };
})();

/* ============================================================
   GAME LOOP
   ============================================================ */
const Game = (() => {
  let canvas, ctx, match = null, raf = null, last = 0, acc = 0;
  const STEP = 1000 / 60;
  let cameraIntro = 0;

  function init(cv) {
    canvas = cv; ctx = canvas.getContext('2d');
    resize();
    addEventListener('resize', resize);
  }
  function resize() {
    if (!canvas) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
    if (match) { match.W = innerWidth; match.H = innerHeight; match.cam.W = innerWidth; match.cam.H = innerHeight; }
  }

  function startMatch(opts) {
    match = new Match({ rules: opts.rules, cast: opts.cast, stageKey: opts.stageKey, W: innerWidth, H: innerHeight });
    match.cam.x = 0; match.cam.y = -160; match.cam.zoom = 1.3;
    cameraIntro = 60;
    UI.show('screen-match');
    $('#hud').style.display = 'block';
    $('#stage-name').textContent = match.stage.name;
    buildHUD();
    AUDIO.init(); AUDIO.resume();
    if (SAVE.data.settings.music) AUDIO.startMusic();
    if (raf) cancelAnimationFrame(raf);
    last = performance.now(); acc = 0;
    raf = requestAnimationFrame(loop);
  }
  function restart() {
    if (!match) return;
    const rules = JSON.parse(JSON.stringify(match.rules));
    const cast = match.fighters.map(f => ({ key: f.key, palIdx: f.palIdx, isCPU: f.isCPU, team: f.team }));
    startMatch({ rules, cast, stageKey: match.stageDef.key });
  }
  function quitToMenu() {
    if (raf) cancelAnimationFrame(raf); raf = null;
    match = null;
    $('#hud').style.display = 'none';
    UI.openTitle();
  }
  function togglePause(force) {
    if (!match) return;
    match.paused = force === undefined ? !match.paused : force;
    UI.showPause(match.paused);
    if (match.paused) { AUDIO.stopMusic(); } else if (SAVE.data.settings.music) AUDIO.startMusic();
  }

  function buildHUD() {
    const hud = $('#hud-slots');
    hud.innerHTML = '';
    match.fighters.forEach((f, i) => {
      const d = document.createElement('div');
      d.className = 'hud-slot';
      d.id = 'hud-' + i;
      d.style.setProperty('--c', f.pal.accent);
      d.innerHTML = `<div class="hud-portrait"><img src="assets/portraits/${f.key}_base.png"></div>
        <div class="hud-info">
          <div class="hud-tag">${f.isCPU ? 'CPU' : 'P' + (i + 1)}${match.rules.teams ? ' · ' + ['RED', 'BLUE', 'GREEN', 'GOLD'][f.team] : ''}</div>
          <div class="hud-dmg"><span class="pct">0</span><span class="pctsign">%</span></div>
          <div class="hud-stocks">${renderStocks(f)}</div>
        </div>`;
      hud.appendChild(d);
    });
    $('#hud-timer').style.display = match.rules.mode === 'stock' ? 'none' : 'block';
  }
  function renderStocks(f) {
    return Array.from({ length: Math.max(0, f.stocks) }, () => `<i class="stockdot" style="background:${f.pal.accent}"></i>`).join('');
  }

  let hudT = 0;
  function updateHUD() {
    if (!match) return;
    if (hudT++ % 3 !== 0) return;
    match.fighters.forEach((f, i) => {
      const el = document.getElementById('hud-' + i);
      if (!el) return;
      const pct = el.querySelector('.pct');
      const v = Math.floor(f.damage);
      pct.textContent = v;
      // GDD color scale
      let col = '#ffffff';
      if (v > 150) col = '#ff2a2a'; else if (v > 110) col = '#ff6a2a'; else if (v > 70) col = '#ffd23a'; else if (v > 35) col = '#ffe9a8';
      pct.style.color = col;
      pct.style.textShadow = v > 100 ? `0 0 ${12 + Math.sin(performance.now() * 0.01) * 6}px ${col}` : 'none';
      el.querySelector('.hud-stocks').innerHTML = renderStocks(f);
      el.classList.toggle('out', f.stocks <= 0);
      el.classList.toggle('lead', match.fighters.every(o => o === f || o.stocks < f.stocks));
    });
    const t = Math.max(0, Math.ceil(match.matchTime / 60));
    $('#hud-timer span').textContent = t;
  }

  /* -------- camera intro sweep -------- */
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(now - last, 100); last = now;
    // fixed timestep 60fps
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 4) {
      if (match && !match.paused) {
        GAMEPADS.poll();
        match.update();
        INPUT.endFrame();
      }
      acc -= STEP; steps++;
    }
    if (match) render();
    updateHUD();
  }

  function render() {
    const W = match.W, H = match.H;
    const dpr = canvas.width / W;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const cam = match.cam;
    cam.W = W; cam.H = H;

    // background (screen space parallax)
    ctx.save();
    Backdrop.draw(ctx, match.stage, cam, match.time);
    ctx.restore();

    // world
    ctx.save();
    cam.apply(ctx);

    Backdrop.drawStageBody(ctx, match.stage, match.time);
    Backdrop.drawPlatforms(ctx, match.stage, match.time);

    // haze / stage hazard
    if (match.stage.hazard && match.stage.hazard.type === 'lava' && match.rules.hazards) {
      const hy = match.stage.hazard.y;
      ctx.save();
      const g = ctx.createLinearGradient(0, hy - 40, 0, hy + 220);
      g.addColorStop(0, 'rgba(255,90,26,0.05)'); g.addColorStop(0.4, 'rgba(255,120,40,0.45)'); g.addColorStop(1, 'rgba(120,20,0,0.9)');
      ctx.fillStyle = g; ctx.fillRect(-2000, hy - 40, 5000, 320);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 12; i++) {
        const bx = -1400 + ((i * 233 + match.time * 0.06) % 2800);
        ctx.fillStyle = 'rgba(255,160,60,0.22)';
        ctx.beginPath(); ctx.arc(bx, hy + 30 + Math.sin(match.time * 0.004 + i) * 12, 40 + (i % 4) * 12, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    if (match.stage.hazard && match.stage.hazard.type === 'pillar' && match.rules.hazards) {
      const hz = match.stage.hazard;
      const on = Math.floor(((match.pillarT || 0) % hz.period)) < 60;
      if (on) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
        const g = ctx.createLinearGradient(hz.x - hz.w / 2, 0, hz.x + hz.w / 2, 0);
        g.addColorStop(0, 'rgba(47,214,187,0)'); g.addColorStop(0.5, 'rgba(47,214,187,0.75)'); g.addColorStop(1, 'rgba(47,214,187,0)');
        ctx.fillStyle = g; ctx.fillRect(hz.x - hz.w / 2, -900, hz.w, 940);
        ctx.restore();
      }
    }

    // items behind fighters
    for (const it of match.items) if (it.heldBy) it.draw(ctx, match.time);

    // summons
    for (const s of match.summons) s.draw(ctx, match.time);
    // mines
    for (const m of match.mines) m.draw(ctx, match.time);

    // fighters sorted by y (depth illusion)
    const players = match.fighters.slice().filter(f => !f.eliminated || f.state === 'respawn').sort((a, b) => a.y - b.y);
    for (const f of players) {
      if (f.state === 'respawn') {
        // revival platform
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.7;
        const g = ctx.createRadialGradient(f.x, f.y + 10, 6, f.x, f.y + 10, 70);
        g.addColorStop(0, withAlpha(f.pal.accent, 0.8)); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(f.x, f.y + 10, 70, 18, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
      if (!(Sprites.ready && Sprites.ready(f.key) && Sprites.drawSpriteFighter(ctx, f, match.time))) {
        Sprites.drawFighter(ctx, f, match.time);
      }
      // final smash aura
      if (f.hasSmashBall) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const t = match.time * 0.006;
        for (let i = 0; i < 3; i++) {
          ctx.globalAlpha = 0.28 + Math.sin(t * 3 + i) * 0.12;
          const g = ctx.createRadialGradient(f.x, f.y - 56 * f.scale, 8, f.x, f.y - 56 * f.scale, 60 + i * 14);
          g.addColorStop(0, withAlpha('#ffe04a', 0.55)); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y - 56, 60 + i * 14, 0, TAU); ctx.fill();
        }
        ctx.restore();
      }
      // grab indicator
      if (f.grabbing) {
        ctx.save(); ctx.strokeStyle = f.pal.accent; ctx.globalAlpha = 0.7; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.x + f.facing * 30, f.y - 60, 34, 0, TAU); ctx.stroke(); ctx.restore();
      }
      // cpu tag above head (GDD §13.1 player indicator)
      if (!f.eliminated) drawNameTag(ctx, f, match);
    }

    // projectiles & fx
    // ---- Break the Targets
    if (match.targets) {
      for (const t of match.targets) {
        if (t.dead) continue;
        ctx.save();
        const wob = Math.sin(match.time * 0.06 + t.wob) * 3;
        ctx.translate(t.x, t.y + wob);
        ctx.globalCompositeOperation = 'lighter';
        const tg = ctx.createRadialGradient(0, 0, 2, 0, 0, 32);
        tg.addColorStop(0, 'rgba(255,244,180,0.95)');
        tg.addColorStop(0.42, 'rgba(255,196,64,0.55)');
        tg.addColorStop(1, 'rgba(255,150,0,0)');
        ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(0, 0, 32, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 9.5, 0, TAU); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-16, 0); ctx.lineTo(16, 0);
        ctx.moveTo(0, -16); ctx.lineTo(0, 16);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ---- Home-Run sandbag
    if (match.bag) {
      const b2 = match.bag;
      ctx.save();
      ctx.translate(b2.x, b2.y); ctx.rotate(b2.rot);
      ctx.fillStyle = '#cbb491';
      ctx.beginPath(); ctx.roundRect(-19, -38, 38, 52, 9); ctx.fill();
      ctx.fillStyle = '#a98a61'; ctx.fillRect(-19, -14, 38, 5);
      ctx.fillStyle = '#8d7150'; ctx.fillRect(-19, -34, 38, 4);
      ctx.fillStyle = '#241c14'; ctx.fillRect(-9, -27, 6, 6); ctx.fillRect(4, -27, 6, 6);
      ctx.strokeStyle = '#6f583c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -8, 7, 0.3, Math.PI - 0.3); ctx.stroke();
      ctx.restore();
      if (!b2.launched) {
        const dmg = Math.min(300, b2.dmg);
        ctx.save();
        ctx.fillStyle = 'rgba(8,12,18,0.82)';
        ctx.beginPath(); ctx.roundRect(b2.x - 42, b2.y - 78, 84, 12, 6); ctx.fill();
        ctx.fillStyle = mixColor('#5aa9ff', '#ff3a3a', dmg / 300);
        ctx.beginPath(); ctx.roundRect(b2.x - 40, b2.y - 76, 80 * (dmg / 300), 8, 4); ctx.fill();
        ctx.font = '800 11px ui-sans-serif, system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#e8f2ff'; ctx.fillText(Math.round(dmg) + '%', b2.x, b2.y - 84);
        ctx.restore();
      }
    }

    for (const p of match.projectiles) p.draw(ctx, match.time);
    for (const it of match.items) if (!it.heldBy) it.draw(ctx, match.time);
    match.fx.draw(ctx, cam);

    ctx.restore();

    // screen-space overlays
    ctx.save();
    // hit-flash / KO flash
    if (match.slowmo > 0) {
      ctx.fillStyle = `rgba(255,255,255,${clamp(match.slowmo / 90, 0, 0.35) * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (match.state === 'intro') {
      ctx.fillStyle = 'rgba(6,8,12,0.45)'; ctx.fillRect(0, 0, W, H);
      const t = match.stateT;
      if (t < 45) drawBigText(ctx, '3', W, H, (45 - t) / 45, '#9fd4ff');
      else if (t < 90) drawBigText(ctx, '2', W, H, (90 - t) / 45, '#9fd4ff');
    }
    if (match.announcement) {
      drawBanner(ctx, match.announcement.text, match.announcement.color, match.announcement.t, match.announcement.dur, W, H);
    }
    // ---- mode HUD counters
    if (match.targets) {
      const left = match.targets.filter(t => !t.dead).length;
      ctx.save();
      ctx.font = '900 20px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,12,18,0.7)';
      ctx.beginPath(); ctx.roundRect(W / 2 - 92, 52, 184, 34, 10); ctx.fill();
      ctx.fillStyle = '#ffd23a';
      ctx.fillText('TARGETS ' + (match.targets.length - left) + '/' + match.targets.length, W / 2, 76);
      ctx.restore();
    }
    if (match.multiman) {
      ctx.save();
      ctx.font = '900 20px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,12,18,0.7)';
      ctx.beginPath(); ctx.roundRect(W / 2 - 96, 52, 192, 34, 10); ctx.fill();
      ctx.fillStyle = '#c77dff';
      ctx.fillText('KO ' + (match.multiman.kos || 0) + ' / ' + match.multiman.target, W / 2, 76);
      ctx.restore();
    }

    // ---- hazard telegraph
    const hz = match.stage.hazard;
    if (hz && match.rules.hazards && hz.type === 'pillar') {
      const cyc = (match.pillarT || 0) % hz.period;
      if (cyc > hz.period - 70 && cyc < hz.period) {
        const k = (cyc - (hz.period - 70)) / 70;
        ctx.save();
        ctx.globalAlpha = 0.28 + 0.5 * (Math.floor(match.time / 90) % 2);
        ctx.strokeStyle = '#2fd6bb'; ctx.lineWidth = 3;
        const sx = W / 2 + (hz.x - match.cam.x) * match.cam.zoom;
        ctx.beginPath(); ctx.moveTo(sx - hz.w / 2, 0); ctx.lineTo(sx - hz.w / 2, H);
        ctx.moveTo(sx + hz.w / 2, 0); ctx.lineTo(sx + hz.w / 2, H); ctx.stroke();
        ctx.globalAlpha = 0.9;
        ctx.font = '900 16px ui-sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#2fd6bb';
        ctx.fillText('!', sx, 40);
        ctx.restore();
      }
    }

    // sudden death / low timer flash
    if (match.rules.mode !== 'stock' && match.matchTime < 600 && Math.floor(match.matchTime / 15) % 2 === 0) {
      ctx.save(); ctx.globalAlpha = 0.1; ctx.fillStyle = '#ff2a2a'; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    Backdrop.drawVignette(ctx, W, H);
    ctx.restore();

    // results transition
    if (match.state === 'over' && match.overT > 70) {
      if (!match._resultsShown) {
        match._resultsShown = true;
        UI.showResults(match);
        $('#hud').style.display = 'none';
        AUDIO.startMusic();
      }
    }
  }

  function drawNameTag(ctx, f, m) {
    const y = f.y - 122 * f.scale;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    const label = f.isCPU ? 'CPU' : 'P' + (f.playerIndex + 1);
    const w = ctx.measureText(label).width + 14;
    ctx.fillStyle = 'rgba(8,10,16,0.7)';
    ctx.beginPath(); ctx.roundRect(f.x - w / 2, y - 11, w, 16, 5); ctx.fill();
    ctx.strokeStyle = withAlpha(f.pal.accent, 0.7); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = f.pal.accent;
    ctx.fillText(label, f.x, y);
    // combo counter
    if (f.comboCount > 1 && f.comboTimer > 0) {
      ctx.font = '900 20px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = '#ffe04a'; ctx.globalAlpha = 0.95;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 4;
      const s = f.comboCount + ' HIT' + (f.comboCount > 1 ? 'S' : '');
      ctx.strokeText(s, f.x, y - 26); ctx.fillText(s, f.x, y - 26);
    }
    ctx.restore();
  }
  function drawBigText(ctx, txt, W, H, k, color) {
    ctx.save();
    ctx.globalAlpha = clamp(k * 1.4, 0, 1);
    ctx.translate(W / 2, H * 0.45);
    const s = lerp(2.4, 1, 1 - k);
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.font = '900 120px ui-sans-serif, system-ui, sans-serif';
    ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(txt, 0, 0);
    ctx.fillStyle = color; ctx.fillText(txt, 0, 0);
    ctx.restore();
  }

  return { init, startMatch, restart, quitToMenu, togglePause };
})();

/* ============================================================
   BOOT
   ============================================================ */
/* debug/test hooks */
window.RR = {
  get match() { return Game.__match ? Game.__match() : window.__match; },
  SAVE, CPU, FIGHTERS, STAGES, ITEMS, INPUT,
  startDuel(a, b, rules) {
    Game.startMatch({
      rules: Object.assign({}, DEFAULT_RULES, { items: 'medium', stocks: 3 }, rules || {}),
      cast: [{ key: a, palIdx: 0, isCPU: false, team: 0, label: 'P1' },
             { key: b, palIdx: 1, isCPU: true, team: 1, label: 'CPU' }],
      stageKey: 'skyshrine',
    });
  },
  makeAllCPU() {
    const m = window.__match;
    if (!m) return false;
    m.fighters.forEach(f => { if (!f.ai) f.ai = new CPU(f, m); f.isCPU = true; });
    return true;
  },
  diag() {
    const m = window.__match; if (!m) return null;
    const f = m.fighters[0];
    return {
      st: f.state, keys: Object.keys(INPUT.keys).filter(k => INPUT.keys[k]),
      hit: Object.keys(INPUT.pressed).filter(k => INPUT.pressed[k]),
      buf: JSON.parse(JSON.stringify(f.inputBuffer)),
      prev: JSON.parse(JSON.stringify(f.prevInput)),
      act: f.action && { type: f.action.type, key: f.action.key },
      actT: f.actionT, canAct: f.canAct(), canMove: f.canMove(),
      hj: f.hitstun, hl: f.hitlag, onG: f.onGround, y: Math.round(f.y), vy: +f.vy.toFixed(2),
      pend: f.pendingSpecial || null, cd: m.fighters[0].cooldowns,
    };
  },
  /* drive input for N frames deterministically */
  feed(raw, frames = 1) {
    const m = window.__match; if (!m) return null;
    const f = m.fighters[0];
    for (let i = 0; i < frames; i++) {
      f.readInput(raw);
      f.update(m);
      INPUT.endFrame();
    }
    return window.RR.diag();
  },
  step(n = 1) {
    const m = window.__match;
    if (!m) return null;
    for (let i = 0; i < n && m.state === 'play'; i++) { m.update(); INPUT.endFrame(); }
    return { state: m.state, stocks: m.fighters.map(f => f.stocks), dmg: m.fighters.map(f => Math.round(f.damage)), kos: m.fighters.map(f => f.stats.kos), frame: m.frame };
  },
};

addEventListener('DOMContentLoaded', () => {
  Sprites.load();
  UI.boot();
  if (typeof CloudSave !== 'undefined' && CloudSave) CloudSave.boot();
  Game.init(document.getElementById('game-canvas'));
  // first interaction unlocks audio
  const unlock = () => { AUDIO.init(); AUDIO.resume(); if (SAVE.data.settings.music) AUDIO.startMusic(); removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);
});
