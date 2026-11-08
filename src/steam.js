const fs   = require('fs');
const path = require('path');

const STEAM_ROOTS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  (process.env['PROGRAMFILES(X86)'] || '') + '\\Steam',
  (process.env.PROGRAMFILES || '')         + '\\Steam',
];

function steamRoot() {
  return STEAM_ROOTS.find(p => { try { fs.accessSync(p); return true; } catch { return false; } });
}

// ── VDF text parser ───────────────────────────────────────────────────────────
function parseVdf(text) {
  let i = 0;
  const skip = () => {
    while (i < text.length) {
      if (/\s/.test(text[i])) { i++; continue; }
      if (text[i] === '/' && text[i+1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
      break;
    }
  };
  const readStr = () => {
    skip();
    if (i >= text.length || text[i] !== '"') return null;
    i++;
    let s = '';
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') { i++; s += text[i] === 'n' ? '\n' : text[i] === 't' ? '\t' : text[i]; }
      else s += text[i];
      i++;
    }
    i++;
    return s;
  };
  const readObj = () => {
    skip();
    if (i >= text.length || text[i] !== '{') return {};
    i++;
    const obj = {};
    while (i < text.length) {
      skip();
      if (i >= text.length || text[i] === '}') { i++; break; }
      const key = readStr();
      if (key === null) { i++; continue; }
      skip();
      obj[key] = (text[i] === '{') ? readObj() : (readStr() ?? '');
    }
    return obj;
  };
  const root = {};
  while (i < text.length) {
    skip();
    if (i >= text.length) break;
    const key = readStr();
    if (!key) break;
    skip();
    root[key] = readObj();
  }
  return root;
}

// ── Library paths ─────────────────────────────────────────────────────────────
function getLibraryPaths(root) {
  const paths = [root];
  try {
    const lf = path.join(root, 'steamapps', 'libraryfolders.vdf');
    const vdf = parseVdf(fs.readFileSync(lf, 'utf8'));
    const folders = vdf?.libraryfolders || vdf?.LibraryFolders || {};
    for (const val of Object.values(folders)) {
      if (typeof val === 'object' && val.path) paths.push(val.path);
      else if (typeof val === 'string' && (val.includes('\\') || val.includes('/'))) paths.push(val);
    }
  } catch {}
  return paths;
}

// ── Game name from appmanifest ────────────────────────────────────────────────
function getGameName(libPaths, appid) {
  for (const lib of libPaths) {
    const f = path.join(lib, 'steamapps', `appmanifest_${appid}.acf`);
    try { const m = fs.readFileSync(f, 'utf8').match(/"name"\s+"([^"]+)"/); if (m) return m[1]; } catch {}
  }
  return null;
}

// ── Build game objects from appids ────────────────────────────────────────────
function buildGameList(appids, root) {
  const libPaths = getLibraryPaths(root);
  return appids.map(appid => ({
    appid,
    name:   getGameName(libPaths, appid) || `App ${appid}`,
    target: `steam://rungameid/${appid}`,
    header: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
  }));
}

// ── Collections from cloudstorage JSON (modern Steam) ─────────────────────────
// Steam moved user library collections out of sharedconfig.vdf into a JSON blob.
// It's an array of [key, { value }] pairs; collection entries are keyed
// "user-collections.*" with `value` a JSON string of { name, added:[appids] }.
function readCloudCollection(root, id32, targetName) {
  const file = path.join(root, 'userdata', id32, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const entry of raw) {
      const key = Array.isArray(entry) ? entry[0] : null;
      if (typeof key !== 'string' || !key.startsWith('user-collections.')) continue;
      let col;
      try { col = JSON.parse(entry[1].value); } catch { continue; }
      if (col?.name?.toLowerCase() === targetName && Array.isArray(col.added)) {
        return col.added.map(String);
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.log('[Steam] cloudstorage read failed:', e.message);
  }
  return [];
}

// ── Main: find "Current" collection ──────────────────────────────────────────
async function getCurrentFolder(steamId64) {
  try {
    const root = steamRoot();
    if (!root) { console.error('[Steam] Could not find Steam installation'); return []; }

    const id32  = (BigInt(steamId64) - BigInt('76561197960265728')).toString();

    // ── Strategy 0: modern cloudstorage JSON ──────────────────────────────────
    const cloudIds = readCloudCollection(root, id32, 'current');
    if (cloudIds.length) {
      console.log(`[Steam] Found ${cloudIds.length} games in "Current" (cloudstorage format)`);
      return buildGameList(cloudIds, root);
    }

    const cfgCandidates = [
      path.join(root, 'userdata', id32, '7', 'remote', 'sharedconfig.vdf'),
    ];

    for (const cfgPath of cfgCandidates) {
      if (!fs.existsSync(cfgPath)) { console.log('[Steam] Not found:', cfgPath); continue; }

      const content = fs.readFileSync(cfgPath, 'utf8');
      const vdf     = parseVdf(content);

      // Navigate to Steam config node
      const steamNode =
        vdf?.UserRoamingConfigStore?.Software?.Valve?.Steam ||
        vdf?.UserLocalConfigStore?.Software?.Valve?.Steam   ||
        {};

      // ── Strategy 1: New "UserCollections" format ──────────────────────────
      const collections = steamNode.UserCollections || {};
      for (const col of Object.values(collections)) {
        if (typeof col !== 'object' || !col.name) continue;
        if (col.name.toLowerCase() === 'current') {
          const ids = Object.keys(col.added || {});
          console.log(`[Steam] Found ${ids.length} games in "Current" (UserCollections format)`);
          return buildGameList(ids, root);
        }
      }

      // ── Strategy 2: Old tags format under Apps ─────────────────────────────
      const apps = steamNode.Apps || {};
      const taggedIds = [];
      for (const [appid, data] of Object.entries(apps)) {
        if (!data || typeof data !== 'object' || !data.tags) continue;
        const tagVals = Object.values(data.tags);
        if (tagVals.some(t => typeof t === 'string' && t.toLowerCase() === 'current')) {
          taggedIds.push(appid);
        }
      }
      if (taggedIds.length) {
        console.log(`[Steam] Found ${taggedIds.length} games in "Current" (tags format)`);
        return buildGameList(taggedIds, root);
      }

      // ── Strategy 3: Search entire VDF string for "Current" collection ──────
      // Some Steam versions store a flat collection list at a different path
      const allCollections = findCollectionsDeep(vdf, 'current');
      if (allCollections.length) {
        console.log(`[Steam] Found ${allCollections.length} games in "Current" (deep search)`);
        return buildGameList(allCollections, root);
      }

      console.log('[Steam] Parsed sharedconfig.vdf but no "Current" collection found. Keys at Steam level:', Object.keys(steamNode).join(', '));
    }

    return [];
  } catch (e) {
    console.error('[Steam] getCurrentFolder error:', e.message);
    return [];
  }
}

// Recursively search for a collection named `targetName` and return its app IDs
function findCollectionsDeep(obj, targetName, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return [];
  // Check if this node looks like a collection with a name
  if (obj.name && obj.name.toLowerCase() === targetName && obj.added) {
    return Object.keys(obj.added);
  }
  for (const val of Object.values(obj)) {
    const result = findCollectionsDeep(val, targetName, depth + 1);
    if (result.length) return result;
  }
  return [];
}

// ── Recently played (from Steam's own play history) ──────────────────────────
// localconfig.vdf keeps a LastPlayed timestamp for every app you've launched,
// so this stays current with no collection to maintain and no API key.
let nameCache = null;
let nameCachePath = null;

function loadNameCache() {
  if (nameCache) return nameCache;
  try { nameCache = JSON.parse(fs.readFileSync(nameCachePath, 'utf8')); } catch { nameCache = {}; }
  return nameCache;
}

// Games that aren't installed have no appmanifest — ask the public store API once and cache.
async function lookupStoreName(appid) {
  const cache = loadNameCache();
  if (cache[appid]) return cache[appid];
  try {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic`);
    const data = await res.json();
    const name = data?.[appid]?.data?.name;
    if (name) {
      cache[appid] = name;
      try { fs.writeFileSync(nameCachePath, JSON.stringify(cache), 'utf8'); } catch {}
      return name;
    }
  } catch {}
  return null;
}

// Cover art: Steam's own cached images (always there for games you've played).
// Newer games keep them in a hashed subfolder and no longer have the old CDN
// header.jpg, which is why some tiles were blank.
function findLocalHeader(root, appid) {
  const dir = path.join(root, 'appcache', 'librarycache', String(appid));
  const wanted = ['header.jpg', 'library_header.jpg', 'library_hero.jpg'];
  const found = {};
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && wanted.includes(e.name)) found[e.name] ??= path.join(dir, e.name);
      if (e.isDirectory()) {
        try {
          for (const f of fs.readdirSync(path.join(dir, e.name))) {
            if (wanted.includes(f)) found[f] ??= path.join(dir, e.name, f);
          }
        } catch {}
      }
    }
  } catch { return null; }
  const file = wanted.map(w => found[w]).find(Boolean);
  return file ? require('url').pathToFileURL(file).href : null;
}

async function getRecentGames(steamId64, cacheDir, max = 15) {
  try {
    const root = steamRoot();
    if (!root) { console.error('[Steam] Could not find Steam installation'); return []; }
    if (cacheDir) nameCachePath = path.join(cacheDir, 'steam-names.json');
    const id32 = (BigInt(steamId64) - BigInt('76561197960265728')).toString();
    const file = path.join(root, 'userdata', id32, 'config', 'localconfig.vdf');
    const vdf  = parseVdf(fs.readFileSync(file, 'utf8'));
    // Key casing varies between Steam versions ("Software"/"valve" here), so match case-insensitively.
    const pick = (o, k) => o && Object.entries(o).find(([key]) => key.toLowerCase() === k)?.[1];
    const steamNode = pick(pick(pick(pick(vdf, 'userlocalconfigstore'), 'software'), 'valve'), 'steam') || {};
    const apps = pick(steamNode, 'apps') || {};

    const played = Object.entries(apps)
      .map(([appid, d]) => ({ appid, last: parseInt(d?.LastPlayed || '0', 10) }))
      .filter(a => a.last > 0 && /^\d+$/.test(a.appid))
      .sort((a, b) => b.last - a.last)
      .slice(0, max);

    const libPaths = getLibraryPaths(root);
    const games = [];
    for (const { appid, last } of played) {
      const name = getGameName(libPaths, appid) || await lookupStoreName(appid) || `App ${appid}`;
      games.push({
        appid, name, lastPlayed: last,
        target: `steam://rungameid/${appid}`,
        header: findLocalHeader(root, appid) || `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
        headerFallback: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
      });
    }
    console.log(`[Steam] ${games.length} recently played games`);
    return games;
  } catch (e) {
    console.error('[Steam] getRecentGames error:', e.message);
    return [];
  }
}

module.exports = { getCurrentFolder, getRecentGames };

