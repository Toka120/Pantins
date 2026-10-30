const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lanceur', {
  state: () => ipcRenderer.invoke('state'),
  check: () => ipcRenderer.invoke('check'),
  update: () => ipcRenderer.invoke('update'),
  reinstall: () => ipcRenderer.invoke('reinstall'),
  shortcuts: () => ipcRenderer.invoke('shortcuts'),
  options: o => ipcRenderer.invoke('options', o),
  play: () => ipcRenderer.send('play'),
  minimize: () => ipcRenderer.send('minimize'),
  close: () => ipcRenderer.send('close'),
  onProgress: f => ipcRenderer.on('progress', (_, p) => f(p)),
  onBack: f => ipcRenderer.on('back', () => f())
});
