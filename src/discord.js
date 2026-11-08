const http = require('http');
const fs   = require('fs');
const path = require('path');

let DiscordRPC;
try { DiscordRPC = require('discord-rpc'); } catch {}
let _shell;
try { ({ shell: _shell } = require('electron')); } catch {}

const REDIRECT_PORT = 8889;
const REDIRECT_URI  = `http://127.0.0.1:${REDIRECT_PORT}`;
let TOKEN_FILE      = path.join(__dirname, '..', 'discord-token.json');   // set to the app's data folder by main.js
function setTokenFile(f) { TOKEN_FILE = f; }

// Voice read/write are "approved partners only" scopes, but the application
// owner can always grant them to their own app. Reading the selected voice
// channel + members needs rpc.voice.read; mute/deafen needs rpc.voice.write.
const SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write'];

let client      = null;
let isConnected = false;
let state = { connected: false, voiceChannel: null, voiceUsers: [], mute: false, deaf: false };
const listeners = new Set();

function emit() { listeners.forEach(fn => { try { fn({ ...state }); } catch {} }); }
function onUpdate(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function getState() { return { ...state }; }

// ── Token persistence ─────────────────────────────────────────────────────────
function loadSavedToken() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; }
}
function saveToken(data) {
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      scope:         data.scope || '',
      expires_at:    Date.now() + (data.expires_in - 60) * 1000,
    }), 'utf8');
  } catch {}
}

// ── OAuth helpers ─────────────────────────────────────────────────────────────
async function exchangeCode(code, clientId, clientSecret) {
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  saveToken(data);
  return data.access_token;
}

async function doRefresh(clientId, clientSecret, refreshToken) {
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      grant_type: 'refresh_token', refresh_token: refreshToken,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Refresh failed');
  saveToken(data);
  return data.access_token;
}

async function browserAuth(clientId, clientSecret) {
  console.log('[Discord] Opening browser for authorization…');
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url  = new URL(req.url, 'http://localhost');
      const code = url.searchParams.get('code');
      const err  = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="background:#1a1a1a;color:#e0e0e0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
          <div style="font-size:48px;margin-bottom:16px">${err ? '✗' : '✓'}</div>
          <h2>${err ? 'Discord auth failed: ' + err : 'Discord connected!'}</h2>
          <p style="color:#888;margin-top:8px">You can close this tab.</p>
        </div></body></html>`);
      server.close();
      if (err || !code) reject(new Error(err || 'No code'));
      else resolve(code);
    });
    server.on('error', reject);
    server.listen(REDIRECT_PORT, () => {
      const authUrl = new URL('https://discord.com/oauth2/authorize');
      authUrl.searchParams.set('client_id',     clientId);
      authUrl.searchParams.set('redirect_uri',  REDIRECT_URI);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope',         SCOPES.join(' '));
      _shell.openExternal(authUrl.toString());
    });
    setTimeout(() => { server.close(); reject(new Error('Auth timed out')); }, 120_000);
  });
  return exchangeCode(code, clientId, clientSecret);
}

function hasRequiredScopes(saved) {
  const granted = (saved?.scope || '').split(' ').filter(Boolean);
  return SCOPES.every(s => granted.includes(s));
}

async function getAccessToken(clientId, clientSecret) {
  const saved = loadSavedToken();
  // A token minted before voice scopes were requested can't read/write voice —
  // refreshing keeps the old scopes, so re-authorize from scratch.
  if (saved && !hasRequiredScopes(saved)) {
    console.log('[Discord] Saved token missing voice scopes — re-authorizing…');
    return browserAuth(clientId, clientSecret);
  }
  if (saved?.access_token && saved.expires_at > Date.now()) {
    console.log('[Discord] Using saved token');
    return saved.access_token;
  }
  if (saved?.refresh_token) {
    try {
      console.log('[Discord] Refreshing token…');
      return await doRefresh(clientId, clientSecret, saved.refresh_token);
    } catch (e) {
      console.warn('[Discord] Refresh failed, re-authing:', e.message);
    }
  }
  return browserAuth(clientId, clientSecret);
}

// ── Main connect ──────────────────────────────────────────────────────────────
async function connect(clientId, clientSecret) {
  if (!DiscordRPC || !clientId || !clientSecret) {
    if (!clientSecret) console.warn('[Discord] No client secret set — add it in Settings → Connections');
    return;
  }
  if (isConnected) return;

  try {
    const accessToken = await getAccessToken(clientId, clientSecret);

    client = new DiscordRPC.Client({ transport: 'ipc' });

    client.on('ready', async () => {
      console.log('[Discord] Connected as', client.user?.username);
      isConnected = true;
      state.connected = true;

      // Check current voice channel
      await checkVoiceChannel();

      // Seed mute/deaf from Discord's current voice settings
      try {
        const vs = await client.getVoiceSettings();
        state.mute = !!vs.mute; state.deaf = !!vs.deaf;
      } catch (e) { console.error('[Discord] getVoiceSettings error:', e.message); }

      // Keep mute/deaf in sync when changed anywhere (incl. inside Discord itself)
      try {
        await client.subscribe('VOICE_SETTINGS_UPDATE');
        client.on('VOICE_SETTINGS_UPDATE', (s) => {
          state.mute = !!s.mute; state.deaf = !!s.deaf; emit();
        });
      } catch (e) { console.error('[Discord] VOICE_SETTINGS_UPDATE subscribe error:', e.message); }

      // Subscribe to channel changes
      try { await client.subscribe('VOICE_CHANNEL_SELECT'); } catch (e) {
        console.error('[Discord] VOICE_CHANNEL_SELECT subscribe error:', e.message);
      }

      client.on('VOICE_CHANNEL_SELECT', async ({ channel_id }) => {
        if (!channel_id) { state.voiceChannel = null; state.voiceUsers = []; emit(); return; }
        try {
          const ch = await client.getChannel(channel_id);
          if (ch) await handleChannelJoin(ch);
        } catch (e) { console.error('[Discord] getChannel error:', e.message); }
      });

      // Poll every 5s as a fallback (catches joins that happen before/during startup)
      const pollInterval = setInterval(async () => {
        if (!isConnected) { clearInterval(pollInterval); return; }
        await checkVoiceChannel();
      }, 5000);

      emit();
    });

    client.on('disconnected', () => {
      console.log('[Discord] Disconnected — retrying in 15s');
      isConnected = false;
      state = { connected: false, voiceChannel: null, voiceUsers: [], mute: false, deaf: false };
      speakingChannel = null; speakingHandlers = false;
      emit();
      setTimeout(() => { isConnected = false; connect(clientId, clientSecret); }, 15000);
    });

    // Pass accessToken directly — bypasses discord-rpc's browser auth flow entirely.
    // `scopes` MUST be present or login() short-circuits, emits 'ready', and never
    // calls authenticate(accessToken) — leaving the RPC socket unauthenticated.
    await client.login({ clientId, accessToken, scopes: SCOPES });

  } catch (e) {
    console.error('[Discord] Connect error:', e.message);
    setTimeout(() => { isConnected = false; connect(clientId, clientSecret); }, 15000);
  }
}

async function checkVoiceChannel() {
  try {
    // discord-rpc@4 has no getSelectedVoiceChannel() helper — call the RPC
    // command directly. Returns the channel (with voice_states) or null.
    const ch = await client.request('GET_SELECTED_VOICE_CHANNEL');
    const desc = ch ? `${channelDisplayName(ch)} (type ${ch.type})` : 'none';
    if (desc !== lastChannelLog) { console.log('[Discord] voice channel:', desc); lastChannelLog = desc; }
    if (ch) {
      await handleChannelJoin(ch);
    } else if (state.voiceChannel) {
      state.voiceChannel = null;
      state.voiceUsers = [];
      emit();
    }
  } catch (e) {
    console.error('[Discord] getSelectedVoiceChannel error:', e.message);
  }
}

// Guild voice channels have a name; DM / group calls don't — derive one from
// the other participants so 1-1 and group calls are still detected.
function channelDisplayName(channel) {
  if (channel.name) return channel.name;
  const selfId = client?.user?.id;
  const others = (channel.voice_states || [])
    .filter(vs => vs.user?.id && vs.user.id !== selfId)
    .map(vs => vs.nick || vs.user?.username)
    .filter(Boolean);
  return others.length ? others.join(', ') : 'Voice Call';
}

let lastChannelLog = null;
let speakingChannel = null;      // channel we're subscribed to for speaking events
let speakingHandlers = false;    // listeners are added once per client, not per poll

async function handleChannelJoin(channel) {
  state.voiceChannel = channelDisplayName(channel);
  state.voiceUsers = (channel.voice_states || []).map(vs => ({
    id:       vs.user.id,
    name:     vs.nick || vs.user.username,
    avatar:   vs.user.avatar
      ? `https://cdn.discordapp.com/avatars/${vs.user.id}/${vs.user.avatar}.png?size=128`
      : null,
    mute:     !!(vs.voice_state?.mute || vs.voice_state?.self_mute),
    deaf:     !!(vs.voice_state?.deaf || vs.voice_state?.self_deaf),
    speaking: !!state.voiceUsers.find(u => u.id === vs.user.id)?.speaking,
  }));

  try {
    if (!speakingHandlers) {
      speakingHandlers = true;
      client.on('SPEAKING_START', ({ user_id }) => {
        const u = state.voiceUsers.find(x => x.id === user_id);
        if (u) { u.speaking = true; emit(); }
      });
      client.on('SPEAKING_STOP', ({ user_id }) => {
        const u = state.voiceUsers.find(x => x.id === user_id);
        if (u) { u.speaking = false; emit(); }
      });
    }
    if (speakingChannel !== channel.id) {
      speakingChannel = channel.id;
      await client.subscribe('SPEAKING_START', { channel_id: channel.id });
      await client.subscribe('SPEAKING_STOP',  { channel_id: channel.id });
    }
  } catch {}

  emit();
}

async function setMute(muted) {
  try {
    if (client) await client.setVoiceSettings({ mute: muted });
    state.mute = muted; emit();
  } catch (e) { console.error('[Discord] setMute:', e.message); }
}

async function setDeaf(deafened) {
  try {
    if (client) await client.setVoiceSettings({ deaf: deafened });
    state.deaf = deafened; emit();
  } catch (e) { console.error('[Discord] setDeaf:', e.message); }
}

module.exports = { connect, onUpdate, setMute, setDeaf, getState, setTokenFile };
