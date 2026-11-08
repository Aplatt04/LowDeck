const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('api', {
  launch:             (t)       => ipcRenderer.invoke('launch', t),
  setZoom:            (f)       => webFrame.setZoomFactor(f),
  getZoom:            ()        => webFrame.getZoomFactor(),
  launchApp:          (a)       => ipcRenderer.invoke('launch-app', a),

  getSettings:        ()        => ipcRenderer.invoke('get-settings'),
  saveSettings:       (patch)   => ipcRenderer.invoke('save-settings', patch),
  appRestart:         ()        => ipcRenderer.invoke('app-restart'),
  pickProgram:        ()        => ipcRenderer.invoke('pick-program'),
  getDisplays:        ()        => ipcRenderer.invoke('get-displays'),
  appInfo:            ()        => ipcRenderer.invoke('app-info'),
  openDataFolder:     ()        => ipcRenderer.invoke('open-data-folder'),
  identifyDisplays:   ()        => ipcRenderer.invoke('identify-displays'),

  windowMinimize:     ()        => ipcRenderer.invoke('window-minimize'),
  windowClose:        ()        => ipcRenderer.invoke('window-close'),
  windowFocus:        ()        => ipcRenderer.invoke('window-focus'),

  spotifyAuth:        ()        => ipcRenderer.invoke('spotify-auth'),
  spotifyIsAuthed:    ()        => ipcRenderer.invoke('spotify-is-authed'),
  spotifyCurrent:     ()        => ipcRenderer.invoke('spotify-current'),
  spotifyPlay:        ()        => ipcRenderer.invoke('spotify-play'),
  spotifyPause:       ()        => ipcRenderer.invoke('spotify-pause'),
  spotifyNext:        ()        => ipcRenderer.invoke('spotify-next'),
  spotifyPrevious:    ()        => ipcRenderer.invoke('spotify-previous'),
  spotifySeek:        (ms)      => ipcRenderer.invoke('spotify-seek', ms),
  spotifyShuffle:     (state)   => ipcRenderer.invoke('spotify-shuffle', state),
  spotifyPlaylists:   ()        => ipcRenderer.invoke('spotify-playlists'),
  spotifyPlayContext: (uri)     => ipcRenderer.invoke('spotify-play-context', uri),
  spotifyPlayTrack:   (uri, album) => ipcRenderer.invoke('spotify-play-track', uri, album),
  spotifyQueueTrack:  (uri)     => ipcRenderer.invoke('spotify-queue-track', uri),
  spotifySearch:      (q)       => ipcRenderer.invoke('spotify-search', q),
  spotifyRecent:      (cur)     => ipcRenderer.invoke('spotify-recent', cur),
  spotifyIsSaved:     (id)      => ipcRenderer.invoke('spotify-is-saved', id),
  spotifySaveTrack:   (id)      => ipcRenderer.invoke('spotify-save-track', id),
  spotifyRemoveTrack: (id)      => ipcRenderer.invoke('spotify-remove-track', id),


  volumeList:         ()        => ipcRenderer.invoke('volume-list'),
  volumeGetMaster:    ()        => ipcRenderer.invoke('volume-get-master'),
  volumeSetMaster:    (v)       => ipcRenderer.invoke('volume-set-master', v),
  volumeSetSession:   (p, v)    => ipcRenderer.invoke('volume-set-session', p, v),

  getSystemStats:     ()        => ipcRenderer.invoke('get-system-stats'),
  steamCurrent:       ()        => ipcRenderer.invoke('steam-current'),
  steamRecent:        ()        => ipcRenderer.invoke('steam-recent'),

  discordGetState:    ()        => ipcRenderer.invoke('discord-get-state'),
  discordSetMute:     (m)       => ipcRenderer.invoke('discord-set-mute', m),
  discordSetDeaf:     (d)       => ipcRenderer.invoke('discord-set-deaf', d),
  onDiscordUpdate:    (fn)      => ipcRenderer.on('discord-update', (_e, s) => fn(s)),
});
