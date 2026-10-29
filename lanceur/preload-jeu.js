// Avant que le jeu démarre : on lui transmet le réglage Graphismes choisi dans le lanceur.
const { ipcRenderer } = require('electron');
try { const g = ipcRenderer.sendSync('gfx'); if (g) localStorage.setItem('pantins_gfx', JSON.stringify(g)); } catch (e) {}
