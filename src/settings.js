// User settings: connections, app shortcuts and widget layout.
// Stored in the app's own data folder (%APPDATA%\lowdeck\settings.json), never in
// the project folder, so your API keys can't end up in git.
// Older installs: first run copies connection details over from config.json.
const fs   = require('fs');
const path = require('path');

const WIDGETS = ['nowplaying', 'spotify', 'games', 'clock', 'apps', 'discord', 'volume'];

const DEFAULT_LAYOUT = {
  columns: [['nowplaying'], ['games', 'spotify'], ['clock', 'apps', 'discord']],
  hidden: ['volume'],
};

const fav = domain => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
const DEFAULT_APPS = [
  { label: 'YouTube', type: 'url',  target: 'https://www.youtube.com',        icon: fav('youtube.com') },
  { label: 'Netflix', type: 'url',  target: 'https://www.netflix.com/browse', icon: fav('netflix.com') },
  { label: 'Twitch',  type: 'url',  target: 'https://www.twitch.tv',          icon: fav('twitch.tv') },
  { label: 'Discord', type: 'link', target: 'discord://',                     icon: fav('discord.com') },
  { label: 'Steam',   type: 'link', target: 'steam://',                       icon: fav('store.steampowered.com') },
];

let file = null;
let settings = null;

const uid = () => Math.random().toString(36).slice(2, 10);

// Every widget appears exactly once: in a column or in `hidden`.
function normaliseLayout(layout) {
  const cols = [0, 1, 2].map(i => (layout?.columns?.[i] || []).filter(w => WIDGETS.includes(w)));
  const seen = new Set();
  const columns = cols.map(c => c.filter(w => !seen.has(w) && seen.add(w)));
  const hidden = (layout?.hidden || []).filter(w => WIDGETS.includes(w) && !seen.has(w) && seen.add(w));
  WIDGETS.forEach(w => { if (!seen.has(w)) hidden.push(w); });   // widgets added in an update start switched off
  return { columns, hidden };
}

function load(userDataDir, legacy = {}) {
  file = path.join(userDataDir, 'settings.json');
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  settings = {
    spotify: { clientId: '', redirectUri: 'http://127.0.0.1:8888/callback', ...(legacy.spotify || {}), ...(saved?.spotify || {}) },
    discord: { clientId: '', clientSecret: '', ...(legacy.discord || {}), ...(saved?.discord || {}) },
    steam:   { steamId: legacy.steam?.steamId || '', ...(saved?.steam || {}) },
    general: { display: { id: 'auto' }, alwaysOnTop: legacy.window?.alwaysOnTop ?? true, startWithWindows: false, uiScale: 1, ...(saved?.general || {}) },
    apps:    (saved?.apps || DEFAULT_APPS).map(a => ({ id: a.id || uid(), ...a })),
    layout:  normaliseLayout(saved?.layout || DEFAULT_LAYOUT),
  };
  if (!saved) persist();
  return settings;
}

function persist() {
  try { fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8'); }
  catch (e) { console.error('[Settings] save failed:', e.message); }
}

// Merge a partial update. Objects are updated in place so code holding
// references (config.spotify etc.) sees the new values.
function update(patch) {
  for (const key of ['spotify', 'discord', 'steam', 'general']) {
    if (patch[key]) Object.assign(settings[key], patch[key]);
  }
  if (patch.apps)   settings.apps   = patch.apps.map(a => ({ id: a.id || uid(), ...a }));
  if (patch.layout) settings.layout = normaliseLayout(patch.layout);
  persist();
  return settings;
}

module.exports = { load, update, get: () => settings, WIDGETS, DEFAULT_LAYOUT };
