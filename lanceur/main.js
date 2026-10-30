/* Lanceur de Pantins : vérifie les mises à jour sur GitHub, les installe, puis ouvre le jeu. */
const { app, BrowserWindow, ipcMain, protocol, net, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');


const UPDATE_BASE = process.env.PANTINS_UPDATE_BASE || 'https://raw.githubusercontent.com/Toka120/Pantins/main/';
const LAUNCHER_VERSION = app.getVersion();

app.setName('Pantins');
if (process.platform === 'win32') app.setAppUserModelId('fr.toka120.pantins');   // même identifiant que les raccourcis
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// une adresse fixe pour le jeu : ses sauvegardes survivent à toutes les mises à jour
protocol.registerSchemesAsPrivileged([{ scheme: 'pantins', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const BUNDLED_DIR = path.join(__dirname, 'jeu');
let DATA, GAME_DIR, OPT_FILE;
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return Math.sign(d); } return 0; };

function installed(){
  const bundled = readJSON(path.join(BUNDLED_DIR, 'bundled.json'), { version: '0.0.0', notes: [] });
  const local = readJSON(path.join(GAME_DIR, 'installed.json'), null);
  if (local && fs.existsSync(path.join(GAME_DIR, 'pantins.html')) && cmp(local.version, bundled.version) >= 0)
    return { version: local.version, notes: local.notes || [], file: path.join(GAME_DIR, 'pantins.html') };
  return { version: bundled.version, notes: bundled.notes || [], file: path.join(BUNDLED_DIR, 'pantins.html') };
}
const DEF_OPT = { gfx: 'haut', fullscreen: true, auto: true };
const options = () => Object.assign({}, DEF_OPT, readJSON(OPT_FILE, {}));
const saveOptions = o => { try { fs.writeFileSync(OPT_FILE, JSON.stringify(Object.assign(options(), o))); } catch (e) {} };

async function fetchTimeout(url, ms){
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await net.fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { signal: ctl.signal, cache: 'no-store' }); }
  finally { clearTimeout(t); }
}
let LATEST = null;
async function check(){
  const inst = installed();
  try {
    const r = await fetchTimeout(UPDATE_BASE + 'latest.json', 9000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    LATEST = await r.json();
    return { online: true, installed: inst.version, latest: LATEST.version, size: LATEST.size,
             available: cmp(LATEST.version, inst.version) > 0, notes: LATEST.notes || inst.notes };
  } catch (e) {
    return { online: false, installed: inst.version, available: false, notes: inst.notes, error: String(e.message || e) };
  }
}
async function update(win){
  if (!LATEST) throw new Error('Aucune mise à jour connue');
  const r = await fetchTimeout(UPDATE_BASE + LATEST.file, 120000);
  if (!r.ok) throw new Error('Téléchargement refusé (HTTP ' + r.status + ')');
  const total = LATEST.size || +r.headers.get('content-length') || 0, chunks = []; let got = 0;
  const reader = r.body.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(Buffer.from(value)); got += value.length;
    if (!win.isDestroyed()) win.webContents.send('progress', { got, total }); }
  const buf = Buffer.concat(chunks);
  const sum = crypto.createHash('sha256').update(buf).digest('hex');
  if (sum !== LATEST.sha256) throw new Error('Le fichier reçu est abîmé. Réessaie dans un instant.');
  fs.mkdirSync(GAME_DIR, { recursive: true });
  const cur = path.join(GAME_DIR, 'pantins.html'), tmp = cur + '.part';
  fs.writeFileSync(tmp, buf);
  if (fs.existsSync(cur)) fs.copyFileSync(cur, path.join(GAME_DIR, 'pantins.prev.html'));
  fs.renameSync(tmp, cur);
  fs.writeFileSync(path.join(GAME_DIR, 'installed.json'), JSON.stringify({ version: LATEST.version, notes: LATEST.notes || [], sha256: sum }));
  return { installed: LATEST.version };
}

/* Raccourcis Windows : Bureau (créé une seule fois) et menu Démarrer (toujours tenu à jour).
   Un raccourci lance Pantins.exe dans son dossier complet, là où sont ses fichiers. */
const APP_ID = 'fr.toka120.pantins';
const inZip = exe => /\\Temp\\[^\\]*\.zip\\|\\Temp\\Temp\d+_|\\Temp\\7z[A-Za-z0-9]+\\/i.test(exe);
function journal(msg){ try { fs.appendFileSync(path.join(DATA, 'journal.txt'), new Date().toISOString() + ' ' + msg + '\n'); } catch (e) {} }
// écrit un raccourci : d'abord par Electron, sinon par PowerShell (WScript.Shell)
function writeLink(file, link){
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch (e) {}
  let ok = false;
  try { ok = shell.writeShortcutLink(file, fs.existsSync(file) ? 'replace' : 'create', link); } catch (e) { journal('Electron : ' + e.message); }
  if (!ok) {
    const q = t => "'" + String(t).replace(/'/g, "''") + "'";
    const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut(${q(file)});$s.TargetPath=${q(link.target)};$s.WorkingDirectory=${q(link.cwd)};$s.IconLocation=${q(link.icon + ',0')};$s.Description=${q(link.description)};$s.Save()`;
    try { require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 15000 }); ok = fs.existsSync(file); }
    catch (e) { journal('PowerShell : ' + e.message); }
  }
  journal((ok ? 'raccourci OK ' : 'raccourci ÉCHEC ') + file);
  return ok;
}
function ensureShortcuts(o, force){
  const exe = process.execPath, dir = path.dirname(exe), res = { start: false, desk: false, skipped: null };
  if (process.platform !== 'win32') { res.skipped = 'windows'; return res; }
  if (!app.isPackaged) { res.skipped = 'dev'; return res; }
  if (inZip(exe)) { res.skipped = 'zip'; journal('lancé depuis le zip : ' + exe); return res; }
  const link = { target: exe, cwd: dir, description: 'Pantins, un jeu de réflexes au théâtre', icon: path.join(__dirname, 'icone.ico'), iconIndex: 0, appUserModelId: APP_ID };
  const put = file => {
    let cur = null; try { cur = shell.readShortcutLink(file); } catch (e) {}
    if (!force && cur && path.resolve(cur.target).toLowerCase() === exe.toLowerCase()) return true;
    return writeLink(file, link);
  };
  let start, desk;
  try { start = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Pantins.lnk'); } catch (e) { journal('appData : ' + e.message); }
  try { desk = path.join(app.getPath('desktop'), 'Pantins.lnk'); } catch (e) { journal('desktop : ' + e.message); }
  if (start) res.start = put(start);
  // le raccourci du Bureau : créé au premier lancement ; ensuite seulement réparé s'il existe (si le joueur l'a supprimé, on le laisse)
  if (desk) {
    if (force || !o.deskDone) { res.desk = put(desk); if (res.desk) saveOptions({ deskDone: true }); }
    else res.desk = fs.existsSync(desk) ? put(desk) : null;
  }
  journal('lanceur ' + LAUNCHER_VERSION + ' · ' + exe + ' · menu ' + res.start + ' · bureau ' + res.desk);
  return res;
}

let launcher = null, game = null;
function createLauncher(){
  launcher = new BrowserWindow({ width: 980, height: 600, minWidth: 760, minHeight: 520, frame: false, resizable: true,
    backgroundColor: '#0b0807', title: 'Pantins', show: false, icon: path.join(__dirname, 'icone.png'),
    webPreferences: { preload: path.join(__dirname, 'preload-lanceur.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  launcher.once('ready-to-show', () => launcher.show());
  launcher.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  launcher.loadFile(path.join(__dirname, 'lanceur.html'));
}
function play(){
  if (game) { game.focus(); return; }
  const o = options();
  game = new BrowserWindow({ width: 1280, height: 720, minWidth: 800, minHeight: 450, backgroundColor: '#000000', title: 'Pantins', icon: path.join(__dirname, 'icone.png'),
    autoHideMenuBar: true, show: false, fullscreen: !!o.fullscreen,
    webPreferences: { preload: path.join(__dirname, 'preload-jeu.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  game.setMenu(null);
  game.once('ready-to-show', () => { if (!o.fullscreen) game.maximize(); game.show(); launcher && launcher.hide(); });
  game.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { game.setFullScreen(!game.isFullScreen()); e.preventDefault(); } });
  game.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let closing = false;
  game.on('close', e => {   // on garde le réglage graphique choisi en jeu
    if (closing) return; e.preventDefault(); closing = true;
    game.webContents.executeJavaScript("localStorage.getItem('pantins_gfx')").then(v => { try { const g = JSON.parse(v); if (['bas','moyen','haut'].includes(g)) saveOptions({ gfx: g }); } catch (_) {} })
      .catch(() => {}).finally(() => game.destroy());
  });
  game.on('closed', () => { game = null; if (launcher && !launcher.isDestroyed()) { launcher.show(); launcher.webContents.send('back'); } });
  game.loadURL('pantins://jeu/index.html');
}

app.whenReady().then(() => {
  DATA = app.getPath('userData'); GAME_DIR = path.join(DATA, 'jeu'); OPT_FILE = path.join(DATA, 'options.json');
  Menu.setApplicationMenu(null);
  protocol.handle('pantins', req => {
    const u = new URL(req.url);
    if (u.pathname === '/' || u.pathname === '/index.html')
      return new Response(fs.readFileSync(installed().file), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    return new Response('', { status: 404 });
  });
  ipcMain.handle('state', () => ({ inZip: process.platform === 'win32' && inZip(process.execPath), options: options(), launcher: LAUNCHER_VERSION, installed: installed().version, notes: installed().notes }));
  ipcMain.handle('check', () => check());
  ipcMain.handle('shortcuts', () => { try { return ensureShortcuts(options(), true); } catch (e) { journal('raccourcis : ' + (e.stack || e)); return { error: String(e.message || e) }; } });
  ipcMain.handle('update', e => update(BrowserWindow.fromWebContents(e.sender)));
  ipcMain.handle('reinstall', async () => { try { fs.rmSync(GAME_DIR, { recursive: true, force: true }); } catch (e) {} return check(); });
  ipcMain.handle('options', (e, o) => { saveOptions(o); return options(); });
  ipcMain.on('play', () => play());
  ipcMain.on('minimize', () => launcher && launcher.minimize());
  ipcMain.on('close', () => app.quit());
  ipcMain.on('gfx', e => { e.returnValue = options().gfx; });
  try { ensureShortcuts(options(), false); } catch (e) { journal('raccourcis : ' + (e.stack || e)); }
  createLauncher();
});
app.on('window-all-closed', () => app.quit());
