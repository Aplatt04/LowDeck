/* ── Settings panel + edit-layout mode ─────────────────────────────────────────
   Uses globals from renderer.js: deckSettings, applyLayout, renderApplications,
   renderGames, renderLibrary, connectSpotify, spotifyAuthed, discordState, esc.     */

const WIDGET_INFO = {
  nowplaying: { name: 'Now Playing',   desc: 'Album art, track info and playback controls' },
  spotify:    { name: 'Spotify',       desc: 'Search plus your recently played playlists and albums' },
  games:      { name: 'Games',         desc: 'Your recently played Steam games' },
  clock:      { name: 'Clock & Stats', desc: 'Time, date and CPU / RAM / GPU usage' },
  apps:       { name: 'Apps',          desc: 'Your shortcuts to websites and programs' },
  discord:    { name: 'Discord',       desc: 'Voice channel, who\'s talking, mute and deafen' },
  volume:     { name: 'Volume',        desc: 'Master volume and a slider for each app playing sound' },
};
const DEFAULT_LAYOUT = { columns: [['nowplaying'], ['games', 'spotify'], ['clock', 'apps', 'discord']], hidden: ['volume'] };
const clone = o => JSON.parse(JSON.stringify(o));

let settingsTab = 'general';

async function saveSettings(patch) {
  deckSettings = await window.api.saveSettings(patch);
  return deckSettings;
}

/* ── Panel shell ─────────────────────────────────────────────────────────── */
function openSettings(tab = settingsTab) {
  settingsTab = tab;
  window.api.windowFocus();
  const el = document.getElementById('settings');
  el.innerHTML = `
    <div id="settings-panel">
      <nav id="settings-nav">
        <h2>Settings</h2>
        <button class="nav-item" data-tab="general">General</button>
        <button class="nav-item" data-tab="connections">Connections</button>
        <button class="nav-item" data-tab="apps">Apps</button>
        <button class="nav-item" data-tab="layout">Layout &amp; widgets</button>
        <div class="spacer"></div>
        <button class="nav-item" id="settings-restart">↻ Restart Lowdeck</button>
      </nav>
      <div id="settings-main">
        <div id="settings-head"><h1 id="settings-title"></h1><button class="btn" id="settings-close">Close</button></div>
        <div id="settings-body"></div>
      </div>
    </div>`;
  el.classList.remove('hidden');
  el.querySelectorAll('.nav-item[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  el.querySelector('#settings-close').addEventListener('click', closeSettings);
  el.querySelector('#settings-restart').addEventListener('click', () => window.api.appRestart());
  el.addEventListener('mousedown', e => { if (e.target === el) closeSettings(); });
  showTab(tab);
}

function closeSettings() {
  const el = document.getElementById('settings');
  el.classList.add('hidden');
  el.innerHTML = '';
}

function showTab(tab) {
  settingsTab = tab;
  document.querySelectorAll('#settings-nav .nav-item[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const titles = { general: 'General', connections: 'Connections', apps: 'Apps', layout: 'Layout & widgets' };
  document.getElementById('settings-title').textContent = titles[tab];
  const body = document.getElementById('settings-body');
  body.innerHTML = '';
  ({ general: renderGeneral, connections: renderConnections, apps: renderAppsEditor, layout: renderLayoutTab })[tab](body);
}

/* small DOM helper */
function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

/* ── General: screen, start-up, always on top ───────────────────────────── */
async function renderGeneral(body) {
  const g = deckSettings.general;
  const displays = await window.api.getDisplays();
  const chosen = g.display?.id ?? 'auto';

  const screenCard = h(`
    <div class="card">
      <div class="card-head"><h3>Screen</h3><button class="btn small" id="identify">Identify screens</button></div>
      <div class="card-help">Which screen Lowdeck opens on. It fills that screen and moves back there after sleep or if the screen reconnects. <b>Automatic</b> picks a touch screen, or the first screen that isn't your main one.</div>
      <div class="screen-list"></div>
    </div>`);
  const list = screenCard.querySelector('.screen-list');
  const option = (id, title, sub, extra = '') => {
    const on = String(chosen) === String(id);
    const b = h(`<button class="screen-opt ${on ? 'on' : ''}"><span class="radio"></span><span class="screen-text"><b>${title}</b><span>${sub}</span></span>${extra}</button>`);
    return b;
  };
  const autoBtn = option('auto', 'Automatic', 'Touch screen if there is one');
  autoBtn.addEventListener('click', async () => { await saveSettings({ general: { display: { id: 'auto' } } }); renderGeneral(clearBody()); });
  list.appendChild(autoBtn);
  displays.forEach(d => {
    const tags = [d.primary && 'Main screen', d.touch && 'Touch', d.current && 'Lowdeck is here'].filter(Boolean).map(t => `<span class="tag">${t}</span>`).join('');
    const b = option(d.id, `${d.index}. ${esc(d.label)}`, `${d.width} × ${d.height}`, `<span class="tags">${tags}</span>`);
    b.addEventListener('click', async () => {
      await saveSettings({ general: { display: { id: d.id, label: d.label, width: d.width, height: d.height } } });
      renderGeneral(clearBody());
    });
    list.appendChild(b);
  });
  screenCard.querySelector('#identify').addEventListener('click', () => window.api.identifyDisplays());

  const toggle = (key, title, desc) => {
    const row = h(`<div class="w-row"><span class="w-name">${title}</span><span class="w-desc">${desc}</span><button class="switch ${g[key] ? 'on' : ''}"></button></div>`);
    row.querySelector('.switch').addEventListener('click', async e => {
      const v = !deckSettings.general[key];
      await saveSettings({ general: { [key]: v } });
      e.target.classList.toggle('on', v);
    });
    return row;
  };
  const toggles = h(`<div class="w-list"></div>`);
  toggles.append(
    toggle('startWithWindows', 'Start with Windows', 'Open Lowdeck automatically when you sign in'),
    toggle('alwaysOnTop', 'Always on top', 'Keep Lowdeck above other windows on its screen'),
  );
  body.append(screenCard, toggles);
}

function clearBody() { const b = document.getElementById('settings-body'); b.innerHTML = ''; return b; }

/* ── Connections ─────────────────────────────────────────────────────────── */
function renderConnections(body) {
  const sp = deckSettings.spotify, dc = deckSettings.discord, st = deckSettings.steam;

  // Spotify
  const spCard = h(`
    <div class="card">
      <div class="card-head"><h3>Spotify</h3><span class="status ${spotifyAuthed ? 'on' : ''}">${spotifyAuthed ? 'Connected' : 'Not connected'}</span></div>
      <div class="card-help">From your app at developer.spotify.com/dashboard. The redirect URI must also be added to that app's settings. Spotify needs a Premium account for this.</div>
      <div class="card-row">
        <label class="field"><span>Client ID</span><input class="input" id="sp-id" value="${esc(sp.clientId)}" spellcheck="false" /></label>
        <label class="field"><span>Redirect URI</span><input class="input" id="sp-uri" value="${esc(sp.redirectUri)}" spellcheck="false" /></label>
      </div>
      <div class="card-actions"><button class="btn primary" id="sp-connect">${spotifyAuthed ? 'Save & reconnect' : 'Save & connect'}</button><span class="card-note" id="sp-note"></span></div>
    </div>`);
  spCard.querySelector('#sp-connect').addEventListener('click', async () => {
    const note = spCard.querySelector('#sp-note');
    await saveSettings({ spotify: { clientId: spCard.querySelector('#sp-id').value.trim(), redirectUri: spCard.querySelector('#sp-uri').value.trim() } });
    note.className = 'card-note'; note.textContent = 'Finish signing in in your browser…';
    const r = await connectSpotify();
    if (r.ok) { note.className = 'card-note ok'; note.textContent = 'Connected.'; spCard.querySelector('.status').className = 'status on'; spCard.querySelector('.status').textContent = 'Connected'; }
    else note.textContent = 'Couldn\'t connect: ' + (r.error || 'unknown error');
  });

  // Discord
  const dcCard = h(`
    <div class="card">
      <div class="card-head"><h3>Discord</h3><span class="status ${discordState.connected ? 'on' : ''}">${discordState.connected ? 'Connected' : 'Not connected'}</span></div>
      <div class="card-help">From your application at discord.com/developers (OAuth2 page). The Discord app must be running on this PC.</div>
      <div class="card-row">
        <label class="field"><span>Client ID</span><input class="input" id="dc-id" value="${esc(dc.clientId)}" spellcheck="false" /></label>
        <label class="field"><span>Client secret</span><div class="secret"><input class="input" type="password" id="dc-secret" value="${esc(dc.clientSecret)}" spellcheck="false" /><button class="btn small" id="dc-show">Show</button></div></label>
      </div>
      <div class="card-actions"><button class="btn primary" id="dc-save">Save</button><span class="card-note" id="dc-note"></span></div>
    </div>`);
  dcCard.querySelector('#dc-show').addEventListener('click', e => { e.preventDefault(); const i = dcCard.querySelector('#dc-secret'); i.type = i.type === 'password' ? 'text' : 'password'; e.target.textContent = i.type === 'password' ? 'Show' : 'Hide'; });
  dcCard.querySelector('#dc-save').addEventListener('click', async () => {
    await saveSettings({ discord: { clientId: dcCard.querySelector('#dc-id').value.trim(), clientSecret: dcCard.querySelector('#dc-secret').value.trim() } });
    const note = dcCard.querySelector('#dc-note');
    note.innerHTML = 'Saved. Restart Lowdeck to reconnect Discord. <button class="btn small" id="dc-restart">Restart now</button>';
    note.querySelector('#dc-restart').addEventListener('click', () => window.api.appRestart());
  });

  // Steam
  const stCard = h(`
    <div class="card">
      <div class="card-head"><h3>Steam</h3></div>
      <div class="card-help">Your SteamID64 (17 digits, starts with 7656…). It's shown in Steam under your account name → Account details. Games are read from Steam on this PC, so no API key is needed.</div>
      <div class="card-row"><label class="field"><span>Steam ID</span><input class="input" id="st-id" value="${esc(st.steamId)}" spellcheck="false" /></label></div>
      <div class="card-actions"><button class="btn primary" id="st-save">Save</button><span class="card-note" id="st-note"></span></div>
    </div>`);
  stCard.querySelector('#st-save').addEventListener('click', async () => {
    const id = stCard.querySelector('#st-id').value.trim();
    const note = stCard.querySelector('#st-note');
    if (id && !/^7656\d{13}$/.test(id)) { note.className = 'card-note'; note.textContent = 'That doesn\'t look like a SteamID64 (17 digits starting 7656).'; return; }
    await saveSettings({ steam: { steamId: id } });
    note.className = 'card-note ok'; note.textContent = 'Saved.';
    renderGames();
  });

  body.append(spCard, dcCard, stCard);
}

/* ── Apps ────────────────────────────────────────────────────────────────── */
const TYPE_HINT = { url: 'https://example.com', program: 'C:\\Path\\To\\Program.exe', link: 'steam://  discord://  spotify:' };

function renderAppsEditor(body) {
  const apps = clone(deckSettings.apps);
  const intro = h(`<div class="card-help">These are the shortcuts in the Apps widget. Changes save straight away.</div>`);
  const list = h(`<div class="app-list"></div>`);
  const actions = h(`<div class="card-actions"><button class="btn" id="add-site">+ Add website</button><button class="btn" id="add-prog">+ Add program…</button><button class="btn" id="add-link">+ Add app link</button></div>`);

  const commit = async () => { await saveSettings({ apps }); renderApplications(); };

  const draw = () => {
    list.innerHTML = '';
    apps.forEach((a, i) => {
      const type = a.type === 'url' && !/^https?:/i.test(a.target) && /^[a-z][a-z0-9+.-]*:/i.test(a.target) ? 'link' : a.type;
      const icon = appIcon(a);
      const row = h(`
        <div class="app-edit">
          <div class="ico">${icon ? `<img src="${esc(icon)}" />` : `<span>${esc((a.label || '?')[0].toUpperCase())}</span>`}</div>
          <input class="input name" value="${esc(a.label)}" placeholder="Name" />
          <select class="input type">
            <option value="url" ${type === 'url' ? 'selected' : ''}>Website</option>
            <option value="program" ${type === 'program' ? 'selected' : ''}>Program</option>
            <option value="link" ${type === 'link' ? 'selected' : ''}>App link</option>
          </select>
          <div class="target"><input class="input tgt" value="${esc(a.target)}" placeholder="${esc(TYPE_HINT[type])}" spellcheck="false" />${type === 'program' ? '<button class="btn small browse">Browse…</button>' : ''}</div>
          <div class="row-btns">
            <button class="mini up" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button class="mini down" title="Move down" ${i === apps.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="mini del" title="Remove">✕</button>
          </div>
        </div>`);
      const img = row.querySelector('.ico img');
      if (img) img.onerror = () => { img.replaceWith(Object.assign(document.createElement('span'), { textContent: (a.label || '?')[0].toUpperCase() })); };
      row.querySelector('.name').addEventListener('change', e => { a.label = e.target.value.trim() || 'App'; commit(); draw(); });
      row.querySelector('.tgt').addEventListener('change', e => {
        a.target = e.target.value.trim();
        if (a.type !== 'program') a.icon = null;   // website icon is looked up from the address
        if (a.type === 'url' && a.target && !/^[a-z][a-z0-9+.-]*:/i.test(a.target)) a.target = 'https://' + a.target;
        commit(); draw();
      });
      row.querySelector('.type').addEventListener('change', e => {
        const v = e.target.value;
        a.type = v;
        a.icon = null;
        commit(); draw();
      });
      row.querySelector('.browse')?.addEventListener('click', async () => {
        const p = await window.api.pickProgram();
        if (!p) return;
        a.target = p.path; a.icon = p.icon; if (!a.label || a.label === 'New app') a.label = p.label;
        commit(); draw();
      });
      row.querySelector('.up').addEventListener('click', () => { [apps[i - 1], apps[i]] = [apps[i], apps[i - 1]]; commit(); draw(); });
      row.querySelector('.down').addEventListener('click', () => { [apps[i + 1], apps[i]] = [apps[i], apps[i + 1]]; commit(); draw(); });
      row.querySelector('.del').addEventListener('click', () => { apps.splice(i, 1); commit(); draw(); });
      list.appendChild(row);
    });
    if (!apps.length) list.innerHTML = '<div class="card-help">No apps yet.</div>';
  };

  const addRow = (a) => { apps.push(a); draw(); list.lastElementChild?.querySelector(a.target ? '.name' : '.tgt')?.focus(); if (a.target) commit(); };
  actions.querySelector('#add-site').addEventListener('click', () => addRow({ label: 'New app', type: 'url', target: '' }));
  actions.querySelector('#add-link').addEventListener('click', () => addRow({ label: 'New app', type: 'link', target: '' }));
  actions.querySelector('#add-prog').addEventListener('click', async () => {
    const p = await window.api.pickProgram();
    if (p) addRow({ label: p.label, type: 'program', target: p.path, icon: p.icon });
  });

  draw();
  body.append(intro, list, actions);
}

/* ── Layout & widgets ────────────────────────────────────────────────────── */
function renderLayoutTab(body) {
  const layout = clone(deckSettings.layout);
  const where = id => { const c = layout.columns.findIndex(col => col.includes(id)); return c < 0 ? 'Hidden' : `Column ${c + 1}`; };

  const intro = h(`
    <div class="card">
      <div class="card-head"><h3>Arrange the deck</h3></div>
      <div class="card-help">Drag widgets around with the mouse to set the deck up how you like it. Turn a widget off below to hide it.</div>
      <div class="card-actions"><button class="btn primary" id="go-edit">Edit layout</button><button class="btn" id="reset-layout">Reset to default</button></div>
    </div>`);
  intro.querySelector('#go-edit').addEventListener('click', () => { closeSettings(); enterEditMode(); });
  intro.querySelector('#reset-layout').addEventListener('click', async () => { await saveSettings({ layout: clone(DEFAULT_LAYOUT) }); applyLayout(deckSettings.layout); showTab('layout'); });

  const list = h(`<div class="w-list"></div>`);
  Object.entries(WIDGET_INFO).forEach(([id, info]) => {
    const on = !layout.hidden.includes(id);
    const row = h(`
      <div class="w-row">
        <span class="w-name">${info.name}</span><span class="w-desc">${info.desc}</span><span class="w-where">${where(id)}</span>
        <button class="switch ${on ? 'on' : ''}" title="${on ? 'Turn off' : 'Turn on'}"></button>
      </div>`);
    row.querySelector('.switch').addEventListener('click', async () => {
      const l = clone(deckSettings.layout);
      if (l.hidden.includes(id)) {
        l.hidden = l.hidden.filter(x => x !== id);
        const target = l.columns.reduce((best, c, i) => c.length < l.columns[best].length ? i : best, 0);
        l.columns[target].push(id);
      } else {
        l.columns = l.columns.map(c => c.filter(x => x !== id));
        l.hidden.push(id);
      }
      await saveSettings({ layout: l });
      applyLayout(deckSettings.layout);
      showTab('layout');
    });
    list.appendChild(row);
  });

  body.append(intro, list);
}

/* ── Edit-layout mode (mouse drag & drop) ────────────────────────────────── */
let working = null;     // layout being edited
let dragId = null;

function enterEditMode() {
  working = clone(deckSettings.layout);
  document.body.classList.add('editing');
  document.getElementById('edit-bar').classList.remove('hidden');
  closeSearch();
  redrawEdit();
}

function exitEditMode() {
  document.body.classList.remove('editing');
  document.getElementById('edit-bar').classList.add('hidden');
  document.querySelectorAll('.w-edit, .drop-marker').forEach(e => e.remove());
  working = null;
  applyLayout(deckSettings.layout);
}

function removeEverywhere(l, id) {
  l.columns = l.columns.map(c => c.filter(x => x !== id));
  l.hidden = l.hidden.filter(x => x !== id);
}

function redrawEdit() {
  applyLayout(working, { editing: true });
  document.querySelectorAll('.w-edit').forEach(e => e.remove());

  // Overlay on each placed widget
  document.querySelectorAll('#columns .widget').forEach(w => {
    const id = w.dataset.widget;
    const ov = h(`<div class="w-edit" draggable="true"><span class="grip">⋮⋮</span><span class="w-title">${WIDGET_INFO[id].name}</span><button class="mini w-hide" title="Hide">✕</button></div>`);
    ov.addEventListener('dragstart', e => { dragId = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); setTimeout(() => ov.classList.add('dragging'), 0); });
    ov.addEventListener('dragend', () => { dragId = null; ov.classList.remove('dragging'); clearMarkers(); });
    ov.querySelector('.w-hide').addEventListener('click', () => { removeEverywhere(working, id); working.hidden.push(id); redrawEdit(); });
    w.appendChild(ov);
  });

  // Tray of hidden widgets
  const tray = document.getElementById('edit-tray-items');
  tray.innerHTML = working.hidden.length ? '' : '<span class="tray-label" style="letter-spacing:0;text-transform:none;font-weight:400">none</span>';
  working.hidden.forEach(id => {
    const chip = h(`<span class="tray-chip" draggable="true">${WIDGET_INFO[id].name}</span>`);
    chip.addEventListener('dragstart', e => { dragId = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); });
    chip.addEventListener('dragend', () => { dragId = null; clearMarkers(); });
    tray.appendChild(chip);
  });
}

function clearMarkers() {
  document.querySelectorAll('.drop-marker').forEach(m => m.remove());
  document.querySelectorAll('.col.over').forEach(c => c.classList.remove('over'));
  document.getElementById('edit-tray').classList.remove('over');
}

// Where in a column would the dragged widget go? Returns index among the other widgets + marker y.
function dropSlot(col, clientY) {
  const others = [...col.querySelectorAll(':scope > .widget')].filter(w => w.dataset.widget !== dragId);
  const top = col.getBoundingClientRect().top;
  for (let i = 0; i < others.length; i++) {
    const r = others[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return { index: i, y: r.top - top };
  }
  const last = others[others.length - 1];
  return { index: others.length, y: last ? last.getBoundingClientRect().bottom - top : 8 };
}

function initEditDnD() {
  document.querySelectorAll('#columns > .col').forEach((col, ci) => {
    col.addEventListener('dragover', e => {
      if (!working || !dragId) return;
      e.preventDefault();
      clearMarkers();
      col.classList.add('over');
      const { y } = dropSlot(col, e.clientY);
      const m = document.createElement('div');
      m.className = 'drop-marker';
      m.style.top = Math.max(2, y - 2) + 'px';
      col.appendChild(m);
    });
    col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) { col.classList.remove('over'); col.querySelectorAll('.drop-marker').forEach(m => m.remove()); } });
    col.addEventListener('drop', e => {
      if (!working || !dragId) return;
      e.preventDefault();
      const { index } = dropSlot(col, e.clientY);
      const id = dragId;
      removeEverywhere(working, id);
      working.columns[ci].splice(index, 0, id);
      clearMarkers();
      redrawEdit();
    });
  });

  const tray = document.getElementById('edit-tray');
  tray.addEventListener('dragover', e => { if (!working || !dragId) return; e.preventDefault(); clearMarkers(); tray.classList.add('over'); });
  tray.addEventListener('dragleave', () => tray.classList.remove('over'));
  tray.addEventListener('drop', e => {
    if (!working || !dragId) return;
    e.preventDefault();
    const id = dragId;
    removeEverywhere(working, id);
    working.hidden.push(id);
    clearMarkers();
    redrawEdit();
  });

  document.getElementById('edit-done').addEventListener('click', async () => { await saveSettings({ layout: working }); exitEditMode(); });
  document.getElementById('edit-cancel').addEventListener('click', exitEditMode);
  document.getElementById('edit-reset').addEventListener('click', () => { working = clone(DEFAULT_LAYOUT); redrawEdit(); });
}

/* ── Wire up ─────────────────────────────────────────────────────────────── */
document.getElementById('btn-settings').addEventListener('click', () => openSettings());
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (working) exitEditMode();
  else if (!document.getElementById('settings').classList.contains('hidden')) closeSettings();
});
initEditDnD();
