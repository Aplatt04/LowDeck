const { app, BrowserWindow, ipcMain, shell, screen, dialog } = require('electron');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const { exec, spawn } = require('child_process');
const spotify = require('./src/spotify');
const volume  = require('./src/volume');
const discord = require('./src/discord');
const steam   = require('./src/steam');
const settingsStore = require('./src/settings');

const USER_DATA   = app.getPath('userData');            // %APPDATA%\lowdeck
const TOKENS_PATH = path.join(USER_DATA, 'tokens.json');

// ── Log file (logs/lowdeck.log next to the app) ──────────────────────────────
const LOG_PATH = path.join(__dirname, 'logs', 'lowdeck.log');
try { fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true }); } catch {}
try { if (fs.statSync(LOG_PATH).size > 1_000_000) fs.renameSync(LOG_PATH, LOG_PATH + '.old'); } catch {}
for (const level of ['log', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    const line = args.map(a => typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(' ');
    try { fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${level.toUpperCase()} ${line}\n`); } catch {}
  };
}

// ── One-time move of data from before the app was renamed ─────────────────────
// Keeps your settings, Spotify login and Discord login after the rename.
(function migrateOldData() {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    const oldDir = path.join(app.getPath('appData'), 'digital-stream-deck');
    if (fs.existsSync(path.join(USER_DATA, 'settings.json')) || !fs.existsSync(oldDir)) return;
    for (const f of ['settings.json', 'tokens.json', 'spotify-history.json', 'steam-names.json']) {
      const src = path.join(oldDir, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(USER_DATA, f));
    }
    const oldDiscord = path.join(__dirname, 'discord-token.json');
    if (fs.existsSync(oldDiscord)) fs.copyFileSync(oldDiscord, path.join(USER_DATA, 'discord-token.json'));
    console.log('[Lowdeck] Moved settings over from the previous app folder');
  } catch (e) { console.error('[Lowdeck] Migration failed:', e.message); }
})();

// Older installs kept keys in config.json — read it once if it's still there.
let legacyConfig = {};
try { legacyConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch {}

// Everything the user can change lives in settings.json (edited from the ⚙ panel).
const settings = settingsStore.load(USER_DATA, legacyConfig);
const config = { spotify: settings.spotify, discord: settings.discord, steam: settings.steam };
discord.setTokenFile(path.join(USER_DATA, 'discord-token.json'));

let win;

function loadSavedTokens() {
  try {
    if (fs.existsSync(TOKENS_PATH)) {
      spotify.loadTokens(JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')));
    }
  } catch {}
}

function persistTokens() {
  try { fs.writeFileSync(TOKENS_PATH, JSON.stringify(spotify.saveTokens()), 'utf8'); } catch {}
}

// ── Which screen Lowdeck opens on ─────────────────────────────────────────────
// Settings → General → Screen. "auto" picks a touch screen, else the first
// screen that isn't your main one. A chosen screen is remembered by id, name and
// size, so it's still found if Windows renumbers screens after a reboot.
function describeDisplay(d, i) {
  return {
    id: d.id, index: i + 1,
    label: d.label || `Screen ${i + 1}`,
    width: d.size.width, height: d.size.height,
    primary: d.id === screen.getPrimaryDisplay().id,
    touch: d.touchSupport === 'available',
  };
}

function findTargetDisplay() {
  const all = screen.getAllDisplays();
  const pick = settings.general.display;
  if (pick && pick.id !== 'auto') {
    return all.find(d => d.id === pick.id)
        || (pick.label && all.find(d => d.label === pick.label && d.size.width === pick.width && d.size.height === pick.height))
        || all.find(d => d.size.width === pick.width && d.size.height === pick.height);
  }
  const primaryId = screen.getPrimaryDisplay().id;
  return all.find(d => d.touchSupport === 'available' && d.id !== primaryId)
      || all.find(d => d.touchSupport === 'available')
      || (all.length > 1 ? all.find(d => d.id !== primaryId) : undefined);
}

// Fill the chosen screen. Returns false if that screen isn't connected (yet).
function placeOnTargetDisplay() {
  if (!win || win.isDestroyed()) return false;
  const d = findTargetDisplay();
  if (!d) return false;
  if (win.isMinimized()) win.restore();
  win.setBounds({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height });
  if (!win.isVisible()) win.showInactive();   // show without taking focus from a game
  return true;
}

// Older installs found the screen by its size (config.json "window") — turn that into a saved choice.
function migrateDisplayChoice() {
  const w = legacyConfig.window;
  if (!w || settings.general.display?.id !== 'auto' || settings.general.displayMigrated) return;
  const i = screen.getAllDisplays().findIndex(d => d.size.width === w.width && d.size.height === w.height);
  if (i < 0) return;
  const d = screen.getAllDisplays()[i];
  const info = describeDisplay(d, i);
  settingsStore.update({ general: { display: { id: d.id, label: info.label, width: info.width, height: info.height }, displayMigrated: true } });
}

function applyStartWithWindows() {
  const args = app.isPackaged ? [] : [path.resolve(__dirname)];
  try { app.setLoginItemSettings({ openAtLogin: !!settings.general.startWithWindows, path: process.execPath, args }); }
  catch (e) { console.error('[Lowdeck] Start-with-Windows failed:', e.message); }
}

function createWindow() {
  const target = findTargetDisplay() || screen.getPrimaryDisplay();
  win = new BrowserWindow({
    x: target.bounds.x,
    y: target.bounds.y,
    width: target.bounds.width, height: target.bounds.height,
    alwaysOnTop: settings.general.alwaysOnTop,
    title: 'Lowdeck',
    show: false,
    frame: false,
    resizable: true,
    skipTaskbar: false,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.once('ready-to-show', () => {
    if (placeOnTargetDisplay()) return;
    // Screen not up yet (typical at login): keep checking for up to 90s.
    console.warn('[Window] Chosen screen not found yet - waiting for it');
    const started = Date.now();
    const timer = setInterval(() => {
      if (placeOnTargetDisplay()) { clearInterval(timer); return; }
      if (Date.now() - started > 90000) {
        clearInterval(timer);
        console.warn('[Window] Chosen screen never appeared - showing on the main screen');
        if (win && !win.isDestroyed()) win.showInactive();
      }
    }, 2000);
  });
}

// Screens coming and going (sleep/wake, cable re-plugs, resolution changes):
// put Lowdeck back on its screen.
function watchDisplays() {
  let pending;
  const replace = () => { clearTimeout(pending); pending = setTimeout(placeOnTargetDisplay, 1500); };
  screen.on('display-added', replace);
  screen.on('display-removed', replace);
  screen.on('display-metrics-changed', replace);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { placeOnTargetDisplay(); win.showInactive(); }
  });
}

// ── IPC: Config ──────────────────────────────────────────────────────────────
// ── IPC: Screens ─────────────────────────────────────────────────────────────
ipcMain.handle('get-displays', () => {
  const current = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()).id : null;
  return screen.getAllDisplays().map((d, i) => ({ ...describeDisplay(d, i), current: d.id === current }));
});

// Briefly show a big number on every screen so you can tell them apart.
ipcMain.handle('identify-displays', () => {
  screen.getAllDisplays().forEach((d, i) => {
    const w = new BrowserWindow({
      x: d.bounds.x + Math.round(d.bounds.width / 2) - 110, y: d.bounds.y + Math.round(d.bounds.height / 2) - 110,
      width: 220, height: 220, frame: false, transparent: true, alwaysOnTop: true, focusable: false, skipTaskbar: true, show: false,
    });
    w.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:rgba(15,15,15,.92);color:#fff;font:700 120px Segoe UI,sans-serif;border-radius:24px">${i + 1}</body>`));
    w.once('ready-to-show', () => w.showInactive());
    setTimeout(() => { if (!w.isDestroyed()) w.close(); }, 2500);
  });
});

// ── IPC: Settings ────────────────────────────────────────────────────────────
ipcMain.handle('get-settings',  () => settingsStore.get());
ipcMain.handle('save-settings', (_, patch) => {
  const s = settingsStore.update(patch);
  if (patch.general) {
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!s.general.alwaysOnTop);
    if ('startWithWindows' in patch.general) applyStartWithWindows();
    if (patch.general.display) placeOnTargetDisplay();
  }
  return s;
});
ipcMain.handle('app-restart',   () => { app.relaunch(); app.exit(0); });

// Choose a program for an app shortcut; returns its path, a name and its icon.
ipcMain.handle('pick-program', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a program',
    properties: ['openFile'],
    filters: [{ name: 'Programs & shortcuts', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  let icon = null;
  try { icon = (await app.getFileIcon(file, { size: 'large' })).toDataURL(); } catch {}
  return { path: file, label: path.basename(file, path.extname(file)), icon };
});

// Open an app shortcut: websites / app links (steam://, discord://) or a program.
ipcMain.handle('launch-app', async (_, a) => {
  try {
    if (a.type === 'program' && path.isAbsolute(a.target)) {
      const err = await shell.openPath(a.target);
      return err ? { ok: false, error: err } : { ok: true };
    }
    if (a.type === 'url' && !/^[a-z][a-z0-9+\-.]*:/i.test(a.target)) {
      await shell.openExternal('https://' + a.target);
      return { ok: true };
    }
    return await launchTarget(a.target);
  } catch (e) { return { ok: false, error: e.message }; }
});

// ── IPC: Window controls ─────────────────────────────────────────────────────
ipcMain.handle('window-minimize', () => win?.minimize());
ipcMain.handle('window-close',    () => win?.close());
// Search needs keyboard focus on the deck (it normally opens without stealing focus).
ipcMain.handle('window-focus',    () => { if (win && !win.isDestroyed()) win.focus(); });

// ── IPC: App launching ───────────────────────────────────────────────────────
const LOCAL   = process.env.LOCALAPPDATA || '';
const PROG    = process.env.PROGRAMFILES  || 'C:\\Program Files';
const PROG86  = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

const APP_PATHS = {
  edge:     [`${PROG}\\Microsoft\\Edge\\Application\\msedge.exe`, `${PROG86}\\Microsoft\\Edge\\Application\\msedge.exe`],
  vscode:   [`${LOCAL}\\Programs\\Microsoft VS Code\\Code.exe`, `${PROG}\\Microsoft VS Code\\Code.exe`],
  obs:      [`${PROG}\\obs-studio\\bin\\64bit\\obs64.exe`, `${PROG86}\\obs-studio\\bin\\64bit\\obs64.exe`],
  explorer: ['explorer.exe'],
  taskmgr:  ['taskmgr.exe'],
  rundll32: ['rundll32.exe'],
};

function findExe(candidates) {
  for (const p of candidates) {
    try { fs.accessSync(p); return p; } catch {}
  }
  return null;
}

ipcMain.handle('launch', async (_, target) => launchTarget(target));

async function launchTarget(target) {
  try {
    if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(target)) {
      await shell.openExternal(target);
      return { ok: true };
    }
    // Special: split args like "rundll32.exe user32.dll,LockWorkStation"
    const parts = target.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);
    const candidates = APP_PATHS[cmd] || [`${cmd}.exe`, cmd];
    const exe = findExe(candidates);
    if (exe) {
      spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
    } else {
      exec(`start "" ${target}`, { shell: true });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── IPC: Spotify ─────────────────────────────────────────────────────────────
ipcMain.handle('spotify-auth', async () => {
  try {
    console.log('[Spotify] Starting auth...');
    await spotify.authenticate(config.spotify.clientId, config.spotify.redirectUri);
    persistTokens();
    console.log('[Spotify] Auth complete.');
    return { ok: true };
  } catch (e) {
    console.error('[Spotify] Auth failed:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('spotify-is-authed',  () => spotify.isAuthenticated());
ipcMain.handle('spotify-play',         async () => { try { return await spotify.play(config.spotify.clientId); } catch (e) { console.error('[Spotify] play failed:', e.message); return null; } });
ipcMain.handle('spotify-pause',        async () => spotify.pause(config.spotify.clientId));
ipcMain.handle('spotify-next',         async () => spotify.next(config.spotify.clientId));
ipcMain.handle('spotify-previous',     async () => spotify.previous(config.spotify.clientId));
ipcMain.handle('spotify-shuffle',      async (_, state) => spotify.shuffle(config.spotify.clientId, state));
ipcMain.handle('spotify-playlists',    async () => { try { return await spotify.getPlaylists(config.spotify.clientId); } catch { return null; } });
ipcMain.handle('spotify-play-context', async (_, uri) => { try { return await spotify.playContext(config.spotify.clientId, uri); } catch (e) { console.error('[Spotify] play context failed:', e.message); return null; } });
ipcMain.handle('spotify-play-track',   async (_, uri, albumUri) => { try { return await spotify.playTrack(config.spotify.clientId, uri, albumUri); } catch (e) { console.error('[Spotify] play track failed:', e.message); return null; } });
ipcMain.handle('spotify-queue-track',  async (_, uri) => { try { return await spotify.queueTrack(config.spotify.clientId, uri); } catch { return null; } });
ipcMain.handle('spotify-search', async (_, q) => {
  try { return await spotify.search(config.spotify.clientId, q); }
  catch (e) { return { _error: e.message }; }
});
ipcMain.handle('spotify-recent', async (_, currentUri) => {
  try { return { items: await spotify.getRecentContexts(config.spotify.clientId, currentUri) }; }
  catch (e) {
    // Tokens from before this feature lack the recently-played scope.
    const needsReconnect = /\b(401|403)\b/.test(e.message);
    return { _error: e.message, needsReconnect };
  }
});

ipcMain.handle('spotify-seek', async (_, ms) => {
  try { return await spotify.seek(config.spotify.clientId, ms); } catch (e) { return null; }
});

ipcMain.handle('spotify-is-saved',   async (_, id) => { try { return await spotify.isTrackSaved(config.spotify.clientId, id); } catch { return false; } });
ipcMain.handle('spotify-save-track', async (_, id) => { try { return await spotify.saveTrack(config.spotify.clientId, id); } catch { return null; } });
ipcMain.handle('spotify-remove-track', async (_, id) => { try { return await spotify.removeTrack(config.spotify.clientId, id); } catch { return null; } });

ipcMain.handle('spotify-current', async () => {
  try {
    const data = await spotify.getCurrentTrack(config.spotify.clientId);
    spotify.recordContext(data?.context?.uri);   // build our own "recently played" history
    return data;
  } catch (e) {
    return { _error: e.message };
  }
});

// ── IPC: Volume ──────────────────────────────────────────────────────────────
ipcMain.handle('volume-list',        async ()       => volume.listSessions());
ipcMain.handle('volume-get-master',  async ()       => volume.getMasterVolume());
ipcMain.handle('volume-set-master',  async (_, v)   => volume.setMasterVolume(v));
ipcMain.handle('volume-set-session', async (_, p, v)=> volume.setSessionVolume(p, v));

// ── IPC: System stats ────────────────────────────────────────────────────────
let lastCpuSample = os.cpus();
let gpuCache = { value: null, time: 0 };

function getCpuUsage() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  cpus.forEach((cpu, i) => {
    const prev = lastCpuSample[i] || cpu;
    for (const t in cpu.times) total += cpu.times[t] - (prev.times[t] || 0);
    idle += cpu.times.idle - (prev.times.idle || 0);
  });
  lastCpuSample = cpus;
  return total > 0 ? Math.max(0, (1 - idle / total) * 100) : 0;
}

function getGpuUsage() {
  if (Date.now() - gpuCache.time < 4000) return Promise.resolve(gpuCache.value);
  return new Promise(resolve => {
    const cmd = `powershell -NoProfile -NonInteractive -Command "try { $c=(Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -EA Stop).CounterSamples | Where-Object {$_.Status -eq 0} | Measure-Object CookedValue -Sum; [math]::Round([math]::Min($c.Sum,100),1) } catch { -1 }"`;
    exec(cmd, { timeout: 4000 }, (err, stdout) => {
      const v = parseFloat(stdout.trim());
      const val = (!err && !isNaN(v) && v >= 0) ? v : null;
      gpuCache = { value: val, time: Date.now() };
      resolve(val);
    });
  });
}

ipcMain.handle('get-system-stats', async () => {
  const cpu = getCpuUsage();
  const gpu = await getGpuUsage();
  const total = os.totalmem();
  const used  = total - os.freemem();
  return {
    cpu,
    gpu,
    ramPct:  (used / total) * 100,
    ramUsed: (used / 1024 ** 3).toFixed(1),
    ramTotal:(total / 1024 ** 3).toFixed(0),
  };
});

// ── IPC: Steam current folder ────────────────────────────────────────────────
ipcMain.handle('steam-current', async () => {
  const { steamId } = config.steam || {};
  if (!steamId) return [];
  return steam.getCurrentFolder(steamId);
});

ipcMain.handle('steam-recent', async () => {
  const { steamId } = config.steam || {};
  if (!steamId) return [];
  return steam.getRecentGames(steamId, app.getPath('userData'));
});

// ── IPC: Discord ─────────────────────────────────────────────────────────────
ipcMain.handle('discord-get-state', () => discord.getState());
ipcMain.handle('discord-set-mute',  async (_, m) => discord.setMute(m));
ipcMain.handle('discord-set-deaf',  async (_, d) => discord.setDeaf(d));

discord.onUpdate(state => {
  if (win?.webContents) {
    win.webContents.send('discord-update', state);
  }
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  loadSavedTokens();
  migrateDisplayChoice();
  spotify.setHistoryFile(path.join(app.getPath('userData'), 'spotify-history.json'));
  createWindow();
  watchDisplays();
  if (settings.general.startWithWindows) applyStartWithWindows();   // keeps the path current if the folder moves
  if (config.discord?.clientId && config.discord?.clientSecret) {
    discord.connect(config.discord.clientId, config.discord.clientSecret);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
