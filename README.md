# Lowdeck

A touchscreen dashboard for a second screen. Put it on a small touch monitor under or beside your main display and you can see what's playing, start music and games, open apps and control Discord without leaving what you're doing. It opens without stealing focus, so tapping it mid-game doesn't pull you out of the game.

Built with Electron for Windows.

## Features

Lowdeck is made of widgets that you arrange across up to three columns:

| Widget | What it does |
|---|---|
| **Now Playing** | Spotify album art, track and artist, seekable progress bar, shuffle / previous / play-pause / next / like. The accent colour follows the album art. |
| **Spotify** | Search (songs, artists, albums, playlists; play or add to queue) and a "Jump back in" grid of recently played playlists, albums, artists and Liked Songs. |
| **Games** | Your recently played Steam games with cover art. Tap to launch. |
| **Clock & Stats** | Time, date and live CPU / RAM / GPU usage. |
| **Apps** | Shortcuts to websites, programs and app links (`steam://`, `discord://`…). |
| **Discord** | Your voice channel, who's in it (highlighted while they talk), mute and deafen. |
| **Volume** | Master volume and a slider for every app playing sound. Off by default. |

**Settings** (⚙ in the title bar):
- **General:** choose which screen Lowdeck opens on (with an "Identify screens" button), start with Windows, always on top.
- **Connections:** Spotify, Discord and Steam.
- **Apps:** add, rename, reorder and remove shortcuts. Website icons are found automatically; programs use their own icon.
- **Layout & widgets:** turn widgets on and off, or click **Edit layout** and drag widgets between columns with the mouse. Drop one on the Hidden tray to hide it. Empty columns collapse and the rest widen.

Lowdeck fills the chosen screen and **scales to fit it**, whether that's a 7" panel, a 1920×720 bar or a full 1080p monitor. It also accounts for Windows display scaling. If it looks too big or small, change **Settings → General → Size**. At sign-in it waits for that screen to come up, and it moves back there after sleep or if the screen is reconnected.

Small screens work best with fewer columns. Use **Layout & widgets** to hide widgets you don't need, and the remaining columns get the space.

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org) 18 or newer
- **Spotify Premium** for the Spotify widgets (Spotify requires Premium for developer apps)
- The Discord desktop app, for the Discord widget
- Steam installed, for the Games widget

## Getting started

```bash
git clone https://github.com/Aplatt04/lowdeck.git
cd lowdeck
npm install
npm start
```

Then open **⚙ Settings**, pick your screen under **General** and fill in **Connections**:

### Spotify
1. Go to the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and create an app.
2. Add `http://127.0.0.1:8888/callback` as a **Redirect URI** and tick **Web API**.
3. Copy the app's **Client ID** into Lowdeck and click **Save & connect**. Sign in when your browser opens.

### Discord
1. Go to the [Discord developer portal](https://discord.com/developers/applications) and create an application.
2. Under **OAuth2**, add the redirect `http://127.0.0.1:8889` and copy the **Client ID** and **Client Secret** into Lowdeck.
3. Restart Lowdeck. Discord will ask you to authorise it the first time.

Voice control uses Discord's RPC voice scopes, which Discord only grants to an application's own developer. That means each person creates their own application.

### Steam
Enter your **SteamID64** (17 digits starting `7656…`; it's shown in Steam under your account name → *Account details*). Games and cover art are read from Steam on your PC, so no API key is needed.

## Installing for everyday use

`npm start` runs Lowdeck from the folder you cloned. To install a copy you can leave running:

1. Double-click **`install.bat`**. It copies Lowdeck to `%LOCALAPPDATA%\Programs\Lowdeck`, adds a **Lowdeck** Start menu shortcut and starts it.
2. In that copy, turn on **Settings → General → Start with Windows**.

Run `install.bat` again whenever you want to update the installed copy. Your settings are kept.

**Working on Lowdeck while using it:** create an empty file called `.dev` in your working folder. That copy then keeps its own settings (in `%APPDATA%\lowdeck-dev`), shows **DEV** in the title bar and can run alongside your installed Lowdeck. On first run it starts with the installed copy's settings and logins.

## Where things are stored

Nothing personal is kept in the project folder. Settings, API keys and logins live in `%APPDATA%\lowdeck\`:

| File | Contents |
|---|---|
| `settings.json` | Connections, apps, layout and general options |
| `tokens.json` | Spotify login |
| `discord-token.json` | Discord login |
| `spotify-history.json`, `steam-names.json` | Caches |

A log is written to `%APPDATA%\lowdeck\logs\lowdeck.log`.

## Project layout

| Path | Purpose |
|---|---|
| `main.js` | Electron main process: window and screen handling, settings, app launching, system stats |
| `preload.js` | The safe `window.api` bridge used by the interface |
| `renderer/` | Interface: `index.html`, `style.css`, `renderer.js` (widgets) and `settings-ui.js` (settings and layout editor) |
| `src/settings.js` | Loads and saves user settings |
| `src/spotify.js` | Spotify Web API (PKCE sign-in, playback, search, recently played) |
| `src/steam.js` | Reads Steam's local play history and cover art |
| `src/discord.js` | Discord RPC voice state, mute and deafen |
| `src/volume.js`, `scripts/volume.ps1` | Per-app volume via Windows Core Audio |

## Notes and limits

- Spotify's 2026 rules for developer apps cap search at 10 results per type. They also block Spotify-made mixes (DJ, Daily Mix), so those don't appear in "Jump back in".
- Spotify's Home screen isn't available through its API. "Jump back in" is built from your recent listening history plus Lowdeck's own history, topped up with your saved playlists.
- If Spotify has gone idle, Lowdeck sends playback to the Spotify app on your PC, opening it if needed.

## Development

```bash
npm run dev   # starts with developer tools open
```

## Licence

[MIT](LICENSE)
