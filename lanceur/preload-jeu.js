// Avant que le jeu démarre : on lui transmet les réglages choisis dans le lanceur (Graphismes, Langue).
const { ipcRenderer } = require('electron');
try { const g = ipcRenderer.sendSync('gfx'); if (g) localStorage.setItem('pantins_gfx', JSON.stringify(g)); } catch (e) {}
// la langue : seulement si elle a changé dans le lanceur depuis la dernière fois (sinon on garde celle choisie en jeu)
try { const l = ipcRenderer.sendSync('lang');
  if (l && localStorage.getItem('pantins_lang_lanceur') !== l) { localStorage.setItem('pantins_lang', JSON.stringify(l)); localStorage.setItem('pantins_lang_lanceur', l); } } catch (e) {}
