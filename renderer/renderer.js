/* ── State ──────────────────────────────────────────────────────────────────── */
let spotifyAuthed     = false;
let isPlaying         = false;
let isShuffling       = false;
let currentDurationMs = 0;
let currentContextUri = null;
let currentTrackId    = null;
let isLiked           = false;
let discordState  = {};
let fadeTimer     = null;

const FAVICON = domain => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
let deckSettings = null;
let appInfo = { version: '', dev: false };   // connections, apps and layout (see settings-ui.js)

/* ── Boot ───────────────────────────────────────────────────────────────────── */
async function init() {
  deckSettings = await window.api.getSettings();
  appInfo = await window.api.appInfo();
  if (appInfo.dev) { document.getElementById('drag-grip').innerHTML = 'LOWDECK <span class="dev-badge">DEV</span>'; document.title = 'Lowdeck (dev)'; }
  applyLayout(deckSettings.layout);
  initScaling();
  spotifyAuthed = await window.api.spotifyIsAuthed();
  updateAuthButton();
  if (spotifyAuthed) startSpotifyPoll();
  bindControls();
  renderApplications();
  renderGames();
  renderLibrary();
  startClock();
  startSystemStats();
  initDiscord();
  initVolume();
  initTitlebarFade();
}

/* ── Layout: place widgets into the three columns ──────────────────────────── */
function applyLayout(layout, { editing = false } = {}) {
  const store = document.getElementById('widget-store');
  const cols = [...document.querySelectorAll('#columns > .col')];
  const widget = id => store.querySelector(`[data-widget="${id}"]`) || document.querySelector(`#columns [data-widget="${id}"]`);
  const search = document.getElementById('search-panel');
  store.appendChild(search);

  // Park everything, then place in order
  document.querySelectorAll('#columns .widget').forEach(w => store.appendChild(w));
  layout.columns.forEach((ids, i) => ids.forEach(id => { const w = widget(id); if (w) cols[i].appendChild(w); }));

  // Search covers whichever column holds the Spotify widget
  const spotifyCol = document.querySelector('#columns [data-widget="spotify"]')?.parentElement;
  if (spotifyCol) spotifyCol.appendChild(search); else search.classList.add('hidden');

  // Empty columns collapse (but stay as drop zones while editing)
  const visible = cols.filter(c => editing || c.querySelector('.widget'));
  cols.forEach(c => c.classList.toggle('hidden', !visible.includes(c)));
  document.getElementById('columns').style.gridTemplateColumns = `repeat(${visible.length || 1}, 1fr)`;
  if (!editing && typeof updateScale === 'function') updateScale();
}

/* ── Scaling: fit the interface to any screen ─────────────────────────────── */
// Lowdeck is designed at 720px tall with columns at least ~520px wide. We zoom
// the whole page so it always has at least that much room: bigger screens get
// everything larger, smaller ones get it smaller, and nothing gets squashed.
// Settings → General → Size multiplies the result.
const DESIGN_HEIGHT = 720, COLUMN_WIDTH = 520;
let currentZoom = 1;
function updateScale() {
  // Window size before zoom (innerWidth/Height are already divided by the zoom)
  const w = window.innerWidth * currentZoom, h = window.innerHeight * currentZoom;
  const cols = Math.max(1, document.querySelectorAll('#columns > .col:not(.hidden)').length);
  const auto = Math.min(h / DESIGN_HEIGHT, w / (cols * COLUMN_WIDTH));
  const user = Number(deckSettings?.general?.uiScale) || 1;
  const z = Math.max(0.4, Math.min(3, auto * user));
  if (Math.abs(z - currentZoom) < 0.005) return;
  currentZoom = z;
  window.api.setZoom(z);
}
function initScaling() {
  currentZoom = window.api.getZoom?.() || 1;   // Chromium can restore a zoom from last time
  let t = null;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { updateScale(); updateMarquee(); }, 100); });
  updateScale();
}

/* ── Titlebar auto-hide ─────────────────────────────────────────────────────── */
function initTitlebarFade() {
  const ctrl = document.getElementById('titlebar-controls');
  const reset = () => { ctrl.classList.remove('faded'); clearTimeout(fadeTimer); fadeTimer = setTimeout(() => ctrl.classList.add('faded'), 4000); };
  document.addEventListener('mousemove', reset);
  reset();
}

/* ── Clock ──────────────────────────────────────────────────────────────────── */
function startClock() {
  const tick = () => {
    const n = new Date();
    document.getElementById('sys-time').textContent = `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
    document.getElementById('sys-date').textContent = n.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  };
  tick(); setInterval(tick, 1000);
}

/* ── System Stats ───────────────────────────────────────────────────────────── */
function startSystemStats() {
  const update = async () => {
    const s = await window.api.getSystemStats();
    if (!s) return;
    setStat('cpu', s.cpu, `${Math.round(s.cpu)}%`);
    setStat('ram', s.ramPct, `${s.ramUsed} GB`);
    const gpuWrap = document.getElementById('gpu-wrap');
    if (s.gpu !== null && s.gpu !== undefined) { gpuWrap.style.display = ''; setStat('gpu', s.gpu, `${Math.round(s.gpu)}%`); }
    else gpuWrap.style.display = 'none';
  };
  update(); setInterval(update, 3000);
}

function setStat(id, pct, label) {
  const fill = document.getElementById(id + '-fill');
  fill.style.width = Math.min(pct, 100) + '%';
  fill.style.background = pct > 85 ? '#ef4444' : pct > 65 ? '#f59e0b' : 'rgb(var(--accent))';
  document.getElementById(id + '-pct').textContent = label;
}

/* ── Popup System ───────────────────────────────────────────────────────────── */
function bindControls() {
  document.getElementById('games-refresh').addEventListener('click', renderGames);
  document.getElementById('library-refresh').addEventListener('click', renderLibrary);

  // Spotify search
  document.getElementById('search-open').addEventListener('click', openSearch);
  document.getElementById('search-close').addEventListener('click', closeSearch);
  document.getElementById('search-clear').addEventListener('click', () => { const i = document.getElementById('search-input'); i.value = ''; onSearchInput(); i.focus(); });
  document.getElementById('search-input').addEventListener('input', onSearchInput);
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSearch();
    if (e.key === 'Enter') { clearTimeout(searchTimer); const q = e.target.value.trim(); if (q) runSearch(q); }
  });

  // Spotify
  document.getElementById('btn-shuffle').addEventListener('click', async () => {
    isShuffling = !isShuffling;
    document.getElementById('btn-shuffle').classList.toggle('shuffling', isShuffling);
    await window.api.spotifyShuffle(isShuffling);
  });
  document.getElementById('btn-like').addEventListener('click', toggleLike);

  document.getElementById('btn-prev').addEventListener('click', async () => { flashCtrl('btn-prev'); await window.api.spotifyPrevious(); setTimeout(pollSpotify, 500); });
  document.getElementById('btn-playpause').addEventListener('click', async () => { if (isPlaying) await window.api.spotifyPause(); else await window.api.spotifyPlay(); setTimeout(pollSpotify, 300); });
  document.getElementById('btn-next').addEventListener('click', async () => { flashCtrl('btn-next'); await window.api.spotifyNext(); setTimeout(pollSpotify, 500); });
  document.getElementById('spotify-progress-bar').addEventListener('click', async (e) => {
    if (!spotifyAuthed || !currentDurationMs) return;
    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ms = Math.round(pct * currentDurationMs);
    document.getElementById('spotify-progress-fill').style.width = (pct * 100) + '%';
    await window.api.spotifySeek(ms);
    setTimeout(pollSpotify, 600);
  });

  document.getElementById('spotify-auth-btn').addEventListener('click', async () => {
    await connectSpotify();
  });

  // Window
  document.getElementById('btn-minimize').addEventListener('click', () => window.api.windowMinimize());
  document.getElementById('btn-close').addEventListener('click',    () => window.api.windowClose());

  // Discord
  document.getElementById('btn-mute').addEventListener('click', async () => window.api.discordSetMute(!discordState.mute));
  document.getElementById('btn-deaf').addEventListener('click', async () => window.api.discordSetDeaf(!discordState.deaf));
}

async function connectSpotify() {
  const r = await window.api.spotifyAuth();
  if (r.ok) { spotifyAuthed = true; updateAuthButton(); startSpotifyPoll(); renderLibrary(); }
  return r;
}

/* Applications */
function renderApplications() {
  const row = document.getElementById('apps-row');
  row.innerHTML = '';
  const apps = deckSettings?.apps || [];
  if (!apps.length) { row.innerHTML = '<div class="section-empty">No apps yet — add some in ⚙ Settings.</div>'; return; }
  apps.forEach(a => row.appendChild(buildAppTile(a)));
}

/* Games — Steam recently played, newest first, horizontal scroll row */
async function renderGames() {
  const row = document.getElementById('games-row');
  row.innerHTML = '<div class="section-empty">Loading…</div>';
  const games = await window.api.steamRecent();
  row.innerHTML = '';
  if (!games.length) {
    row.innerHTML = '<div class="section-empty">No recently played Steam games found.</div>';
    return;
  }
  games.forEach(g => {
    const tile = document.createElement('button');
    tile.className = 'game-tile';
    tile.innerHTML = `<img alt="" /><span class="tile-name">${esc(g.name)}</span>`;
    const img = tile.querySelector('img');
    img.onerror = () => {
      if (g.headerFallback && img.src !== g.headerFallback) img.src = g.headerFallback;
      else img.style.display = 'none';
    };
    img.src = g.header;
    tile.addEventListener('click', () => { tile.classList.add('flash'); setTimeout(() => tile.classList.remove('flash'), 300); window.api.launch(g.target); });
    row.appendChild(tile);
  });
}

/* Spotify — recently played playlists / albums / artists (like Spotify's Home grid) */
let libraryContextUri = undefined;   // context the row was last built around
async function renderLibrary() {
  const row = document.getElementById('library-grid');
  if (!spotifyAuthed) {
    row.innerHTML = '<div class="section-empty">Connect Spotify (left panel) to see what you\'ve been playing.</div>';
    return;
  }
  libraryContextUri = currentContextUri;
  if (!row.children.length || row.querySelector('.section-empty')) row.innerHTML = '<div class="section-empty">Loading…</div>';
  const data = await window.api.spotifyRecent(currentContextUri);
  if (data?._error) {
    row.innerHTML = data.needsReconnect
      ? '<div class="section-empty">Spotify needs one more permission for recently played.<br>Tap <b>Connected</b> (left panel) to reconnect.</div>'
      : '<div class="section-empty">Couldn\'t load recently played.</div>';
    return;
  }
  row.innerHTML = '';
  if (!data.items.length) { row.innerHTML = '<div class="section-empty">Nothing played recently.</div>'; return; }
  data.items.slice(0, 14).forEach(c => row.appendChild(buildGridTile(c, () => playContext(c.uri))));
  markPlayingTiles();
}

// Wide "Jump back in" tile — small art + name, like Spotify's Home grid
const EQ = '<span class="eq"><i></i><i></i><i></i></span>';
function buildGridTile(c, onTap) {
  const tile = document.createElement('button');
  tile.className = 'grid-tile' + (c.type === 'artist' ? ' artist' : '');
  tile.dataset.uri = c.uri;
  const art = c.type === 'liked'
    ? '<div class="liked-art"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></div>'
    : `<img src="${c.image || ''}" alt="" onerror="this.style.opacity=0.2" />`;
  tile.innerHTML = `${art}<span class="grid-name">${esc(c.name)}</span>${EQ}`;
  tile.addEventListener('click', () => { tile.classList.add('flash'); setTimeout(() => tile.classList.remove('flash'), 300); onTap(); });
  return tile;
}

const TYPE_LABEL = { playlist: 'Playlist', album: 'Album', artist: 'Artist', liked: 'Playlist' };
function buildMediaTile(c, onTap) {
  const tile = document.createElement('button');
  tile.className = 'lib-tile' + (c.type === 'artist' ? ' artist' : '');
  tile.dataset.uri = c.uri;
  const art = c.type === 'liked'
    ? '<div class="liked-art"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></div>'
    : `<img src="${c.image || ''}" alt="" onerror="this.style.opacity=0.2" />`;
  const sub = c.sub ? `${TYPE_LABEL[c.type] || ''} · ${esc(c.sub)}` : (TYPE_LABEL[c.type] || '');
  tile.innerHTML = `${art}<span class="lib-name">${esc(c.name)}</span><span class="lib-sub">${sub}</span>`;
  tile.addEventListener('click', () => { tile.classList.add('flash'); setTimeout(() => tile.classList.remove('flash'), 300); onTap(); });
  return tile;
}

async function playContext(uri) {
  await window.api.spotifyPlayContext(uri);
  currentContextUri = uri;
  markPlayingTiles();
  setTimeout(pollSpotify, 600);
}

function markPlayingTiles() {
  document.querySelectorAll('[data-uri]').forEach(t => t.classList.toggle('playing', t.dataset.uri === currentContextUri));
  document.querySelectorAll('.grid-tile.playing').forEach(t => t.classList.toggle('paused', !isPlaying));
}

// When you switch to a playlist/album the row doesn't know yet, rebuild it so it moves to the front.
let libraryRefreshTimer = null;
function onContextChanged() {
  markPlayingTiles();
  if (!currentContextUri || currentContextUri === libraryContextUri) return;
  if (document.querySelector('#library-grid [data-uri]')?.dataset.uri === currentContextUri) return;
  clearTimeout(libraryRefreshTimer);
  libraryRefreshTimer = setTimeout(renderLibrary, 1500);
}

/* ── Spotify search ─────────────────────────────────────────────────────────── */
let searchTimer = null;
let searchSeq = 0;

function openSearch() {
  document.getElementById('search-panel').classList.remove('hidden');
  window.api.windowFocus();
  const input = document.getElementById('search-input');
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

function closeSearch() {
  document.getElementById('search-panel').classList.add('hidden');
  document.getElementById('search-input').blur();
}

function onSearchInput() {
  clearTimeout(searchTimer);
  const q = document.getElementById('search-input').value.trim();
  if (q.length < 2) {
    searchSeq++;
    document.getElementById('search-results').innerHTML = '<div class="section-empty">Type to search songs, artists, albums and playlists.</div>';
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 350);
}

async function runSearch(q) {
  if (!spotifyAuthed) { document.getElementById('search-results').innerHTML = '<div class="section-empty">Connect Spotify first.</div>'; return; }
  const seq = ++searchSeq;
  const data = await window.api.spotifySearch(q);
  if (seq !== searchSeq) return;   // a newer search has started
  const out = document.getElementById('search-results');
  out.innerHTML = '';
  if (!data || data._error) { out.innerHTML = '<div class="section-empty">Search failed — try again.</div>'; return; }

  const tracks    = (data.tracks?.items    || []).filter(Boolean);
  const artists   = (data.artists?.items   || []).filter(Boolean);
  const albums    = (data.albums?.items    || []).filter(Boolean);
  const playlists = (data.playlists?.items || []).filter(Boolean);
  if (!tracks.length && !artists.length && !albums.length && !playlists.length) {
    out.innerHTML = `<div class="section-empty">No results for “${esc(q)}”.</div>`; return;
  }

  if (tracks.length) {
    out.appendChild(sectionHead('Songs'));
    const list = document.createElement('div');
    list.className = 'song-list';
    tracks.forEach(t => list.appendChild(buildSongRow(t)));
    out.appendChild(list);
  }
  const rows = [
    ['Artists',   artists.map(a => ({ uri: a.uri, type: 'artist', name: a.name, image: a.images?.[0]?.url }))],
    ['Albums',    albums.map(a => ({ uri: a.uri, type: 'album', name: a.name, sub: a.artists?.map(x => x.name).join(', '), image: a.images?.[0]?.url }))],
    ['Playlists', playlists.map(p => ({ uri: p.uri, type: 'playlist', name: p.name, image: p.images?.[0]?.url }))],
  ];
  rows.forEach(([title, items]) => {
    if (!items.length) return;
    out.appendChild(sectionHead(title));
    const row = document.createElement('div');
    row.className = 'hscroll';
    items.forEach(c => row.appendChild(buildMediaTile(c, () => { playContext(c.uri); closeSearch(); })));
    out.appendChild(row);
  });
  out.scrollTop = 0;
  markPlayingTiles();
}

function sectionHead(title) {
  const h = document.createElement('div');
  h.className = 'search-head';
  h.textContent = title;
  return h;
}

function buildSongRow(t) {
  const row = document.createElement('div');
  row.className = 'song-row';
  const img = t.album?.images?.[2]?.url || t.album?.images?.[0]?.url || '';
  row.innerHTML = `
    <button class="song-main">
      <img src="${img}" alt="" onerror="this.style.opacity=0.2" />
      <span class="song-text"><span class="song-name">${esc(t.name)}</span><span class="song-artist">${esc(t.artists.map(a => a.name).join(', '))}</span></span>
      <span class="song-dur">${fmtMs(t.duration_ms)}</span>
    </button>
    <button class="song-queue" title="Add to queue">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 6h12M3 12h12M3 18h7M18 13v8M14 17h8"/></svg>
    </button>`;
  row.querySelector('.song-main').addEventListener('click', async () => {
    row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 300);
    closeSearch();
    await window.api.spotifyPlayTrack(t.uri, t.album?.uri);
    setTimeout(pollSpotify, 600);
  });
  const q = row.querySelector('.song-queue');
  q.addEventListener('click', async () => {
    await window.api.spotifyQueueTrack(t.uri);
    q.classList.add('done');
    q.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>';
  });
  return row;
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch])); }

function appIcon(a) {
  if (a.icon) return a.icon;
  try { const u = new URL(a.target); if (/^https?:$/.test(u.protocol)) return FAVICON(u.hostname); } catch {}
  return null;
}

function buildAppTile(a) {
  const tile = document.createElement('button');
  tile.className = 'app-tile';
  tile.title = a.label;
  const icon = appIcon(a);
  tile.innerHTML = (icon ? `<img src="${esc(icon)}" alt="" />` : `<span class="app-letter">${esc((a.label || '?')[0].toUpperCase())}</span>`)
    + `<span class="tile-label">${esc(a.label)}</span>`;
  const img = tile.querySelector('img');
  if (img) img.onerror = () => { img.replaceWith(Object.assign(document.createElement('span'), { className: 'app-letter', textContent: (a.label || '?')[0].toUpperCase() })); };
  tile.addEventListener('click', () => {
    tile.classList.add('flash'); setTimeout(() => tile.classList.remove('flash'), 300);
    window.api.launchApp(a);
  });
  return tile;
}



/* ── Spotify ────────────────────────────────────────────────────────────────── */
let spotifyPollTimer = null;
function startSpotifyPoll() { pollSpotify(); if (!spotifyPollTimer) spotifyPollTimer = setInterval(pollSpotify, 2000); }

async function pollSpotify() {
  if (!spotifyAuthed) return;
  const data = await window.api.spotifyCurrent();
  if (data?._error) return;
  renderSpotifyWidget(data);
}

function renderSpotifyWidget(data) {
  const trackEl = document.getElementById('spotify-track-text');
  const artistEl = document.getElementById('spotify-artist');
  const artEl = document.getElementById('spotify-art');
  const fill = document.getElementById('spotify-progress-fill');

  if (!data?.item) {
    trackEl.textContent = 'Nothing playing'; artistEl.textContent = '—';
    trackEl.classList.remove('scrolling'); artEl.dataset.src = '';
    document.getElementById('spotify-elapsed').textContent = '0:00';
    document.getElementById('spotify-duration').textContent = '0:00';
    currentDurationMs = 0;
    artEl.classList.remove('loaded'); setPlayIcon(false); fill.style.width = '0%';
    isPlaying = false; resetAccent();
    currentTrackId = null; setLikeButton(false, false); return;
  }

  const track = data.item;
  isPlaying   = data.is_playing;
  setPlayIcon(isPlaying);
  document.querySelectorAll('.grid-tile.playing').forEach(t => t.classList.toggle('paused', !isPlaying));

  // Refresh the like state only when the track actually changes
  if (track.id && track.id !== currentTrackId) {
    currentTrackId = track.id;
    refreshLikeState(track.id);
  }

  if (data.shuffle_state !== undefined && data.shuffle_state !== isShuffling) {
    isShuffling = data.shuffle_state;
    document.getElementById('btn-shuffle').classList.toggle('shuffling', isShuffling);
  }
  const newContext = data.context?.uri || null;
  if (newContext !== currentContextUri) { currentContextUri = newContext; onContextChanged(); }

  if (trackEl.textContent !== track.name) {
    trackEl.textContent = track.name;
    requestAnimationFrame(updateMarquee);
  }

  artistEl.textContent = track.artists.map(a => a.name).join(', ');
  currentDurationMs = track.duration_ms;
  fill.style.width = (data.progress_ms / track.duration_ms * 100) + '%';
  document.getElementById('spotify-elapsed').textContent  = fmtMs(data.progress_ms);
  document.getElementById('spotify-duration').textContent = fmtMs(track.duration_ms);

  const imgUrl = track.album?.images?.[1]?.url || track.album?.images?.[0]?.url;
  if (imgUrl && artEl.dataset.src !== imgUrl) {
    artEl.dataset.src = imgUrl;
    artEl.crossOrigin = 'anonymous';
    artEl.src = imgUrl;
    artEl.onload = () => { artEl.classList.add('loaded'); extractAccent(artEl); };
    artEl.onerror = () => artEl.classList.remove('loaded');
  }
}

// Long track names scroll; re-checked when the window or scale changes
function updateMarquee() {
  const trackEl = document.getElementById('spotify-track-text');
  trackEl.classList.remove('scrolling');
  const wrap = trackEl.parentElement;
  if (trackEl.scrollWidth > wrap.clientWidth + 4) {
    trackEl.style.setProperty('--scroll-dist', (wrap.clientWidth - trackEl.scrollWidth) + 'px');
    trackEl.classList.add('scrolling');
  }
}

function setPlayIcon(playing) {
  document.getElementById('icon-play').style.display  = playing ? 'none' : '';
  document.getElementById('icon-pause').style.display = playing ? '' : 'none';
}

function fmtMs(ms) { const s = Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
function flashCtrl(id) { const el = document.getElementById(id); el.classList.add('active'); setTimeout(() => el.classList.remove('active'), 220); }
function updateAuthButton() {
  const btn = document.getElementById('spotify-auth-btn');
  if (spotifyAuthed) { btn.textContent = '● Connected'; btn.classList.add('connected'); }
  else               { btn.textContent = 'Connect';     btn.classList.remove('connected'); }
}

/* ── Colour extraction ──────────────────────────────────────────────────────── */
function extractAccent(imgEl) {
  try {
    const canvas = document.getElementById('color-canvas');
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, 40, 40);
    const { data } = ctx.getImageData(0, 0, 40, 40);
    const buckets = {};
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = rgbToHsl(data[i], data[i+1], data[i+2]);
      if (s < 0.25 || l < 0.12 || l > 0.88) continue;
      const bk = Math.floor(h / 20);
      if (!buckets[bk]) buckets[bk] = { r:0, g:0, b:0, w:0 };
      const w = s * (1 - Math.abs(l - 0.5) * 1.8);
      buckets[bk].r += data[i]*w; buckets[bk].g += data[i+1]*w; buckets[bk].b += data[i+2]*w; buckets[bk].w += w;
    }
    let best = null, bw = 0;
    Object.values(buckets).forEach(bk => { if (bk.w > bw) { bw = bk.w; best = bk; } });
    if (!best || bw < 5) return;
    applyAccent(Math.round(best.r/best.w), Math.round(best.g/best.w), Math.round(best.b/best.w));
  } catch {}
}
function rgbToHsl(r,g,b) {
  r/=255;g/=255;b/=255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b);let h,s,l=(max+min)/2;
  if(max===min){h=s=0;}else{const d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);switch(max){case r:h=((g-b)/d+(g<b?6:0))/6;break;case g:h=((b-r)/d+2)/6;break;case b:h=((r-g)/d+4)/6;break;}}
  return[h*360,s,l];
}
function applyAccent(r,g,b) { document.documentElement.style.setProperty('--accent',`${r},${g},${b}`); document.getElementById('spotify-art-wrap').classList.add('has-color'); }
function resetAccent() { document.documentElement.style.setProperty('--accent','59,130,246'); document.getElementById('spotify-art-wrap').classList.remove('has-color'); }

/* ── Discord ────────────────────────────────────────────────────────────────── */
async function initDiscord() {
  discordState = await window.api.discordGetState();
  renderDiscord();
  window.api.onDiscordUpdate(state => { discordState = state; renderDiscord(); });
}

function renderDiscord() {
  const connected = discordState.connected;
  const inVoice = connected && discordState.voiceChannel;
  const idle = document.getElementById('discord-idle');

  document.getElementById('discord-users').classList.toggle('hidden', !inVoice);
  // Mute/deafen stay available whenever Discord is connected, in a call or not.
  document.getElementById('discord-actions').classList.toggle('hidden', !connected);
  document.getElementById('discord-panel').classList.toggle('in-call', !!inVoice);

  if (!connected) {
    document.getElementById('discord-channel-name').textContent = 'Discord';
    idle.textContent = 'Not connected'; idle.classList.remove('hidden');
    return;
  }

  document.getElementById('discord-channel-name').textContent = inVoice ? discordState.voiceChannel : 'Discord';
  const users = discordState.voiceUsers || [];
  idle.textContent = inVoice ? `${users.length} in voice` : 'Not in a voice channel';

  const mute = document.getElementById('btn-mute'), deaf = document.getElementById('btn-deaf');
  mute.classList.toggle('active', !!discordState.mute); mute.title = discordState.mute ? 'Unmute' : 'Mute';
  deaf.classList.toggle('active', !!discordState.deaf); deaf.title = discordState.deaf ? 'Undeafen' : 'Deafen';

  if (!inVoice) return;
  const usersEl = document.getElementById('discord-users');
  usersEl.innerHTML = '';
  users.forEach(u => {
    const chip = document.createElement('div');
    chip.className = 'discord-user' + (u.speaking ? ' speaking' : '');
    const icons = [u.mute && '🔇', u.deaf && '🎧'].filter(Boolean).join('');
    chip.innerHTML = `<div class="discord-avatar">${u.avatar ? `<img src="${u.avatar}" />` : esc(u.name[0].toUpperCase())}</div><span class="discord-username">${esc(u.name)}</span>${icons ? `<span class="discord-icons">${icons}</span>` : ''}`;
    usersEl.appendChild(chip);
  });
}

/* ── Volume mixer ───────────────────────────────────────────────────────────── */
// Master volume plus one slider per app that's making sound. Only refreshes
// while the Volume widget is on the deck, and never while you're dragging.
let volumeDragging = false;
function initVolume() {
  const refresh = async () => {
    if (volumeDragging || !document.querySelector('#columns [data-widget="volume"]')) return;
    const [master, sessions] = await Promise.all([window.api.volumeGetMaster(), window.api.volumeList()]);
    renderVolume(master, sessions);
  };
  refresh();
  setInterval(refresh, 5000);
  document.getElementById('volume-list').addEventListener('pointerdown', () => { volumeDragging = true; });
  window.addEventListener('pointerup', () => { volumeDragging = false; });
}

function renderVolume(master, sessions) {
  const list = document.getElementById('volume-list');
  // One row per app (an app can have several audio sessions); skip system sounds
  const apps = new Map();
  (sessions || []).forEach(s => {
    if (!s.pid) return;
    const key = (s.name || s.displayName || '').toLowerCase();
    if (!key) return;
    const a = apps.get(key) || { name: s.displayName && !/^@/.test(s.displayName) ? s.displayName : s.name, pids: [], volume: s.volume };
    a.pids.push(s.pid); apps.set(key, a);
  });
  // Three sliders at most so each is easy to hit: Master, then Spotify and
  // Discord if they're open, then whatever else is playing (usually your game).
  const PRIORITY = ['spotify', 'discord'];
  const rank = a => { const i = PRIORITY.indexOf(a.key); return i < 0 ? PRIORITY.length : i; };
  const appRows = [...apps.entries()].map(([key, a]) => ({ key, ...a })).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 2);
  const rows = [{ name: 'Master', master: true, volume: master }, ...appRows];
  list.innerHTML = '';
  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'vol-row' + (r.master ? ' master' : '');
    row.innerHTML = `<span class="vol-name">${esc(r.name)}</span><input type="range" min="0" max="100" value="${Math.round((r.volume ?? 1) * 100)}" /><span class="vol-pct">${Math.round((r.volume ?? 1) * 100)}</span>`;
    const input = row.querySelector('input'), pct = row.querySelector('.vol-pct');
    let t = null;
    const send = () => {
      const v = input.value / 100;
      if (r.master) window.api.volumeSetMaster(v);
      else r.pids.forEach(pid => window.api.volumeSetSession(pid, v));
    };
    input.addEventListener('input', () => { pct.textContent = input.value; clearTimeout(t); t = setTimeout(send, 400); });
    input.addEventListener('change', () => { clearTimeout(t); send(); });
    list.appendChild(row);
  });
}

/* ── Spotify Like / Unlike ──────────────────────────────────────────────────── */
function setLikeButton(liked, enabled) {
  isLiked = liked;
  const btn = document.getElementById('btn-like');
  btn.classList.toggle('liked', liked);
  btn.disabled = !enabled;
  btn.title = !enabled ? 'Like / Unlike' : liked ? 'Remove from Liked Songs' : 'Add to Liked Songs';
}

async function refreshLikeState(id) {
  const saved = await window.api.spotifyIsSaved(id);
  // Ignore if the track changed while we were waiting
  if (id !== currentTrackId) return;
  setLikeButton(!!saved, true);
}

async function toggleLike() {
  if (!currentTrackId) return;
  const next = !isLiked;
  setLikeButton(next, true); // optimistic
  if (next) await window.api.spotifySaveTrack(currentTrackId);
  else      await window.api.spotifyRemoveTrack(currentTrackId);
}

/* ── Go ─────────────────────────────────────────────────────────────────────── */
init();
