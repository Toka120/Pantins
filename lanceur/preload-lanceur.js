const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lanceur', {
  state: () => ipcRenderer.invoke('state'),
  check: () => ipcRenderer.invoke('check'),
  update: () => ipcRenderer.invoke('update'),
  updateLauncher: () => ipcRenderer.invoke('updateLauncher'),
  reinstall: () => ipcRenderer.invoke('reinstall'),
  shortcuts: () => ipcRenderer.invoke('shortcuts'),
  options: o => ipcRenderer.invoke('options', o),
  devState: () => ipcRenderer.invoke('devState'),
  devSetToken: t => ipcRenderer.invoke('devSetToken', t),
  devClear: () => ipcRenderer.invoke('devClear'),
  devPublish: (t, w) => ipcRenderer.invoke('devPublish', t, w),
  play: () => ipcRenderer.send('play'),
  minimize: () => ipcRenderer.send('minimize'),
  close: () => ipcRenderer.send('close'),
  onProgress: f => ipcRenderer.on('progress', (_, p) => f(p)),
  onBack: f => ipcRenderer.on('back', () => f())
});
