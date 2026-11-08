const crypto = require('crypto');
const http = require('http');
const { shell } = require('electron');

const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-read-recently-played',
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-library-modify',
].join(' ');

let tokens = { accessToken: null, refreshToken: null, expiresAt: 0, scope: '' };
let codeVerifier = null;

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateVerifier() {
  return base64url(crypto.randomBytes(32));
}

function generateChallenge(verifier) {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64url(hash);
}

async function authenticate(clientId, redirectUri) {
  codeVerifier = generateVerifier();
  const challenge = generateChallenge(codeVerifier);
  const state = base64url(crypto.randomBytes(8));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    // Force the consent screen — otherwise Spotify silently re-redirects an
    // already-authorized app without granting newly-added scopes.
    show_dialog: 'true',
  });

  const code = await new Promise((resolve, reject) => {
    const port = new URL(redirectUri).port || 8888;
    const server = http.createServer((req, res) => {
      if (!req.url.startsWith('/callback')) { res.end(); return; }
      const params = new URL(req.url, `http://localhost`).searchParams;
      const code = params.get('code');
      const err  = params.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="background:#1a1a1a;color:#e0e0e0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
          <div style="font-size:48px;margin-bottom:16px">${err ? '✗' : '✓'}</div>
          <h2>${err ? 'Auth failed: ' + err : 'Connected to Spotify!'}</h2>
          <p style="color:#888;margin-top:8px">You can close this tab.</p>
        </div>
      </body></html>`);
      server.close();
      if (err || !code) reject(new Error(err || 'No code'));
      else resolve(code);
    });
    server.on('error', reject);
    server.listen(parseInt(port), () => {
      console.log(`[Spotify] Auth server listening on port ${port}`);
      shell.openExternal(`https://accounts.spotify.com/authorize?${params}`);
    });

    setTimeout(() => { server.close(); reject(new Error('Auth timed out after 2 minutes')); }, 120_000);
  });

  console.log('[Spotify] Got auth code, exchanging for tokens...');
  await exchangeCode(clientId, redirectUri, code);
}

async function exchangeCode(clientId, redirectUri, code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  console.log('[Spotify] Token exchange response:', JSON.stringify(data).substring(0, 120));
  if (!data.access_token) throw new Error(JSON.stringify(data));
  setTokens(data);
}

async function refreshAccessToken(clientId) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: clientId,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Refresh failed: ' + JSON.stringify(data));
  setTokens(data);
  console.log('[Spotify] Token refreshed.');
}

function setTokens(data) {
  tokens.accessToken = data.access_token;
  if (data.refresh_token) tokens.refreshToken = data.refresh_token;
  if (data.scope) tokens.scope = data.scope;
  tokens.expiresAt = Date.now() + (data.expires_in - 60) * 1000;
}

async function ensureToken(clientId) {
  if (Date.now() > tokens.expiresAt && tokens.refreshToken) {
    await refreshAccessToken(clientId);
  }
}

async function apiGet(clientId, endpoint) {
  await ensureToken(clientId);
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (res.status === 204 || res.status === 202) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[Spotify] GET ${endpoint} → ${res.status}`, body);
    throw new Error(`Spotify ${res.status}: ${body}`);
  }
  return res.json();
}

async function apiPost(clientId, endpoint, body = null) {
  await ensureToken(clientId);
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status >= 400) {
    const text = await res.text().catch(() => '');
    console.error(`[Spotify] POST ${endpoint} → ${res.status}`, text.slice(0, 200));
  }
  return res.status;
}

async function apiPut(clientId, endpoint, body = null) {
  await ensureToken(clientId);
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status >= 400) {
    const text = await res.text().catch(() => '');
    console.error(`[Spotify] PUT ${endpoint} → ${res.status}`, text.slice(0, 200));
  }
  return res.status;
}

async function apiDelete(clientId, endpoint) {
  await ensureToken(clientId);
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json' },
  });
  return res.status;
}

function isAuthenticated() { return !!tokens.accessToken; }
function saveTokens() { return { ...tokens }; }
function loadTokens(saved) { if (saved) tokens = { ...tokens, ...saved }; }

// ── Playback that survives "no active device" ─────────────────────────────────
// Starting playback only works on an active Spotify device. If Spotify has gone
// idle (paused for a while / app just opened) the API returns 404, so we pick
// this PC's Spotify app (opening it if needed) and send the play to it directly.
async function pickDevice(clientId, { preferComputer = false } = {}) {
  const d = await apiGet(clientId, '/me/player/devices').catch(() => null);
  const list = (d?.devices || []).filter(x => !x.is_restricted);
  const computer = list.find(x => x.type === 'Computer');
  if (preferComputer && computer) return computer;
  return list.find(x => x.is_active) || computer || list[0] || null;
}

async function playOn(clientId, body) {
  let status = await apiPut(clientId, '/me/player/play', body);
  console.log(`[Spotify] play ${body ? JSON.stringify(body).slice(0, 160) : '(resume)'} → ${status}`);
  if (status !== 404) return status;

  let device = await pickDevice(clientId);
  if (!device) {
    console.log('[Spotify] No device available — opening Spotify');
    shell.openExternal('spotify:');
    for (let i = 0; i < 10 && !device; i++) {
      await new Promise(r => setTimeout(r, 1500));
      device = await pickDevice(clientId);
    }
  }
  if (!device) { console.error('[Spotify] Still no Spotify device to play on'); return 404; }
  console.log(`[Spotify] Playing on device "${device.name}"`);
  status = await apiPut(clientId, `/me/player/play?device_id=${device.id}`, body);
  return status;
}

// Play a song from search. It's played inside its album (so playback carries on
// through the album afterwards, like tapping a song on an album page). Spotify
// sometimes accepts a play request but doesn't act on it, so we check that
// the song actually started and, if not, send it straight to this PC's player.
async function playTrack(clientId, trackUri, albumUri) {
  const body = albumUri ? { context_uri: albumUri, offset: { uri: trackUri } } : { uris: [trackUri] };
  const status = await playOn(clientId, body);
  await new Promise(r => setTimeout(r, 1500));
  const now = await apiGet(clientId, '/me/player').catch(() => null);
  if (now?.item?.uri === trackUri) return status;

  console.warn(`[Spotify] Song didn't start (now playing: ${now?.item?.uri || 'nothing'}) — retrying on this PC`);
  const device = await pickDevice(clientId, { preferComputer: true });
  if (!device) return status;
  const retry = await apiPut(clientId, `/me/player/play?device_id=${device.id}`, { uris: [trackUri] });
  console.log(`[Spotify] retry on "${device.name}" → ${retry}`);
  return retry;
}

// ── Recently played contexts (playlists / albums / artists / Liked Songs) ─────
// Spotify's Home "recents" grid isn't in the Web API, so we rebuild it from
// play history: each recently played track carries the context it was played
// from. De-dupe those in order and look up their names and art.
const contextCache = new Map();   // uri -> { uri, type, name, image } | null (unavailable)

async function describeContext(clientId, uri) {
  if (contextCache.has(uri)) return contextCache.get(uri);
  const parts = uri.split(':');
  let info = null;
  try {
    if (/^spotify:user:[^:]+:collection$/.test(uri)) {
      info = { uri, type: 'liked', name: 'Liked Songs', image: null };
    } else {
      const [, type, id] = parts;
      if (type === 'playlist') {
        const p = await apiGet(clientId, `/playlists/${id}?fields=name,images`);
        info = { uri, type, name: p.name, image: p.images?.[0]?.url || null };
      } else if (type === 'album') {
        const a = await apiGet(clientId, `/albums/${id}`);
        info = { uri, type, name: a.name, sub: a.artists?.map(x => x.name).join(', '), image: a.images?.[0]?.url || null };
      } else if (type === 'artist') {
        const a = await apiGet(clientId, `/artists/${id}`);
        info = { uri, type, name: a.name, image: a.images?.[0]?.url || null };
      }
    }
  } catch (e) {
    // Spotify-made mixes (DJ, Daily Mix…) are blocked for developer apps — skip them.
    console.log(`[Spotify] Can't describe ${uri}: ${e.message.slice(0, 80)}`);
    info = null;
  }
  contextCache.set(uri, info);
  return info;
}

// Spotify only keeps your last 50 songs, so one long album fills it. We add our
// own longer history (everything the deck sees playing, on any device) and then
// pad with your saved playlists so the row is never empty.
let historyFile = null;
let history = [];   // [{ uri, at }]
function setHistoryFile(f) {
  historyFile = f;
  try { history = JSON.parse(require('fs').readFileSync(f, 'utf8')); } catch { history = []; }
}
function recordContext(uri) {
  if (!uri) return;
  const prev = history[0];
  if (prev?.uri === uri) { prev.at = Date.now(); return; }
  history = [{ uri, at: Date.now() }, ...history.filter(h => h.uri !== uri)].slice(0, 40);
  if (historyFile) { try { require('fs').writeFileSync(historyFile, JSON.stringify(history)); } catch {} }
}

async function getRecentContexts(clientId, currentUri, max = 16) {
  const seen = new Map();   // uri -> time
  const add = (uri, at) => { if (uri && !(seen.get(uri) >= at)) seen.set(uri, at); };
  if (currentUri) add(currentUri, Date.now() + 1);
  history.forEach(h => add(h.uri, h.at));
  try {
    const data = await apiGet(clientId, '/me/player/recently-played?limit=50');
    for (const it of data?.items || []) add(it.context?.uri, Date.parse(it.played_at) || 0);
  } catch (e) {
    if (!history.length) throw e;   // nothing to show at all — let the UI explain
  }
  const ordered = [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);

  const out = [];
  for (const u of ordered) {
    const info = await describeContext(clientId, u);
    if (info) out.push(info);
    if (out.length >= max) break;
  }

  // Pad with your own / followed playlists (your library order) if still short.
  if (out.length < max) {
    try {
      const pl = await apiGet(clientId, '/me/playlists?limit=30');
      for (const p of pl?.items || []) {
        if (!p || out.some(o => o.uri === p.uri)) continue;
        const info = { uri: p.uri, type: 'playlist', name: p.name, image: p.images?.[0]?.url || null };
        contextCache.set(p.uri, info);
        out.push(info);
        if (out.length >= max) break;
      }
    } catch {}
  }
  return out;
}

module.exports = {
  authenticate,
  isAuthenticated,
  saveTokens,
  loadTokens,
  getRecentContexts,
  setHistoryFile,
  recordContext,
  hasScope(scope) { return (tokens.scope || '').split(' ').includes(scope); },
  async getCurrentTrack(clientId) { return apiGet(clientId, '/me/player'); },
  async seek(clientId, positionMs)       { return apiPut(clientId, `/me/player/seek?position_ms=${Math.round(positionMs)}`); },
  async shuffle(clientId, state)         { return apiPut(clientId, `/me/player/shuffle?state=${state}`); },
  async getPlaylists(clientId)           { return apiGet(clientId, '/me/playlists?limit=50'); },
  async playContext(clientId, contextUri){ return playOn(clientId, { context_uri: contextUri }); },
  playTrack,
  async queueTrack(clientId, trackUri)   { return apiPost(clientId, `/me/player/queue?uri=${encodeURIComponent(trackUri)}`); },
  // Search caps at 10 results per type since Feb 2026.
  async search(clientId, q) {
    const params = new URLSearchParams({ q, type: 'track,artist,album,playlist', limit: '8' });
    return apiGet(clientId, `/search?${params}`);
  },
  // Like / unlike: Feb 2026 replaced /me/tracks save/check with the generic /me/library (URIs).
  async isTrackSaved(clientId, id) { const r = await apiGet(clientId, `/me/library/contains?uris=spotify:track:${id}`); return Array.isArray(r) ? !!r[0] : false; },
  async saveTrack(clientId, id)    { return apiPut(clientId, `/me/library?uris=spotify:track:${id}`); },
  async removeTrack(clientId, id)  { return apiDelete(clientId, `/me/library?uris=spotify:track:${id}`); },
  async play(clientId)     { return playOn(clientId); },
  async pause(clientId)    { return apiPut(clientId,  '/me/player/pause'); },
  async next(clientId)     { return apiPost(clientId, '/me/player/next'); },
  async previous(clientId) { return apiPost(clientId, '/me/player/previous'); },
};
