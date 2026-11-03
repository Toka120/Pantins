/* Lanceur de Pantins : vérifie les mises à jour sur GitHub, les installe, puis ouvre le jeu. */
const { app, BrowserWindow, ipcMain, protocol, net, shell, Menu, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');


const UPDATE_BASE = process.env.PANTINS_UPDATE_BASE || 'https://raw.githubusercontent.com/Toka120/Pantins/main/';
// chargé par amorce.js : BASE = dossier de cette version du lanceur, BUNDLED = dossier livré avec Pantins.exe
const P = global.PANTINS || { base: __dirname, bundled: __dirname, version: JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version, boot: null, dir: null };
const BASE = P.base, BUNDLED = P.bundled, LAUNCHER_VERSION = P.version;

app.setName('Pantins');
if (process.platform === 'win32') app.setAppUserModelId('fr.toka120.pantins');   // même identifiant que les raccourcis
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// une adresse fixe pour le jeu : ses sauvegardes survivent à toutes les mises à jour
protocol.registerSchemesAsPrivileged([{ scheme: 'pantins', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const BUNDLED_DIR = path.join(BUNDLED, 'jeu');
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
const DEF_OPT = { gfx: 'haut', fullscreen: true, auto: true, lang: null };
const LANGS = ['fr','en','es','de','it','ar'];
const options = () => Object.assign({}, DEF_OPT, readJSON(OPT_FILE, {}));
const saveOptions = o => { try { fs.writeFileSync(OPT_FILE, JSON.stringify(Object.assign(options(), o))); } catch (e) {} };

async function fetchTimeout(url, ms){
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await net.fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { signal: ctl.signal, cache: 'no-store' }); }
  finally { clearTimeout(t); }
}
let LATEST = null;
// les infos du dev : un fichier texte du dépôt, gardé en copie pour le jeu hors ligne
/* ---------------- le mode développeur : écrire les infos du dev depuis le lanceur ----------------
   La clé GitHub (un jeton à accès limité au dépôt) reste sur ce PC, chiffrée par Windows. Les joueurs n'en ont pas. */
const GH_API = process.env.PANTINS_GH_API || 'https://api.github.com', GH_REPO = 'Toka120/Pantins', INFOS_PATH = 'infos-du-dev.md';
const devFile = () => path.join(DATA, 'dev.bin');
function devToken(){ try { const b = fs.readFileSync(devFile()); if (b[0] === 0x7b) return JSON.parse(b.toString()).t; return safeStorage.decryptString(b); } catch (e) { return null; } }
function devSave(t){ if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(devFile(), safeStorage.encryptString(t)); else fs.writeFileSync(devFile(), JSON.stringify({ t })); }
async function gh(method, p, token, body){
  const r = await net.fetch(GH_API + p, { method, cache: 'no-store', headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Pantins-lanceur', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { ok: r.ok, status: r.status, j };
}
const ghMsg = (r) => r.status === 401 ? 'La clé est refusée (expirée ou mal copiée).' : r.status === 403 ? 'La clé n\'a pas le droit d\'écrire dans le dépôt Pantins.' : r.status === 404 ? 'Dépôt introuvable avec cette clé : vérifie qu\'elle donne accès à Toka120/Pantins.' : r.status === 409 ? 'Le fichier a changé entre-temps : réessaie.' : 'GitHub a répondu ' + r.status + (r.j && r.j.message ? ' (' + r.j.message + ')' : '') + '.';
async function devCheck(token){
  const r = await gh('GET', '/repos/' + GH_REPO, token);
  if (!r.ok) return { ok: false, err: ghMsg(r) };
  if (!r.j || !r.j.permissions || !r.j.permissions.push) return { ok: false, err: 'Cette clé peut lire le dépôt mais pas y écrire. Donne-lui « Contents : Read and write ».' };
  return { ok: true, repo: r.j.full_name };
}
async function devRead(token){
  const r = await gh('GET', '/repos/' + GH_REPO + '/contents/' + INFOS_PATH + '?ref=main', token);
  if (r.status === 404) return { text: '', sha: null };
  if (!r.ok) throw new Error(ghMsg(r));
  return { text: Buffer.from(r.j.content || '', 'base64').toString('utf8'), sha: r.j.sha };
}
async function devPublish(text, what){
  const token = devToken(); if (!token) throw new Error('Le mode développeur n\'est pas activé.');
  for (let k = 0; k < 2; k++) {
    const cur = await devRead(token);
    const r = await gh('PUT', '/repos/' + GH_REPO + '/contents/' + INFOS_PATH, token, { message: 'Infos du dev : ' + (what || 'mise à jour'), content: Buffer.from(text, 'utf8').toString('base64'), branch: 'main', ...(cur.sha ? { sha: cur.sha } : {}) });
    if (r.ok) { try { fs.writeFileSync(path.join(DATA, 'infos-du-dev.md'), text); } catch (e) {} journal('infos du dev publiées : ' + (what || '')); return { ok: true }; }
    if (r.status !== 409 && r.status !== 422) throw new Error(ghMsg(r));
  }
  throw new Error('Le fichier a changé entre-temps : réessaie.');
}
async function infosDev(){
  const f = path.join(DATA, 'infos-du-dev.md');
  const tk = devToken(); if (tk) { try { const d = await devRead(tk); try { fs.writeFileSync(f, d.text); } catch (e) {} return d.text; } catch (e) {} }   // le dev lit la version fraîche, sans le cache de GitHub
  try { const r = await fetchTimeout(UPDATE_BASE + 'infos-du-dev.md', 9000); if (r.ok) { const t = await r.text(); try { fs.writeFileSync(f, t); } catch (e) {} return t; } } catch (e) {}
  try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; }
}
async function check(){
  const inst = installed(), infos = await infosDev();
  try {
    const r = await fetchTimeout(UPDATE_BASE + 'latest.json', 9000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    LATEST = await r.json();
    const L = LATEST.lanceur, ldir = P.dir || path.join(DATA, 'lanceur');
    const lnew = !!(L && L.version && cmp(L.version, LAUNCHER_VERSION) > 0 && !fs.existsSync(path.join(ldir, 'refuse-' + L.version)));
    return { online: true, installed: inst.version, latest: LATEST.version, size: LATEST.size,
             available: cmp(LATEST.version, inst.version) > 0, notes: LATEST.notes || inst.notes,
             launcherUpdate: lnew ? L.version : null, launcherSize: lnew ? L.files.reduce((t, f) => t + (f.size || 0), 0) : 0, infos };
  } catch (e) {
    return { online: false, installed: inst.version, available: false, notes: inst.notes, error: String(e.message || e), infos };
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

/* Mise à jour du lanceur lui-même : ses fichiers (quelques centaines de Ko) vont dans %APPDATA%\Pantins\lanceur\<version>,
   puis le lanceur redémarre ; amorce.js charge alors la nouvelle version. */
async function updateLauncher(win){
  const L = LATEST && LATEST.lanceur; if (!L) throw new Error('Aucune mise à jour du lanceur');
  const ldir = P.dir || path.join(DATA, 'lanceur'), dst = path.join(ldir, L.version), tmp = dst + '.part';
  fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
  const total = L.files.reduce((t, f) => t + (f.size || 0), 0); let got = 0;
  for (const f of L.files) {
    if (!/^[\w.-]+$/.test(f.name)) throw new Error('Nom de fichier refusé : ' + f.name);
    const r = await fetchTimeout(UPDATE_BASE + (L.path || 'lanceur/') + f.name, 60000);
    if (!r.ok) throw new Error('Téléchargement refusé (HTTP ' + r.status + ')');
    const buf = Buffer.from(await r.arrayBuffer());
    if (crypto.createHash('sha256').update(buf).digest('hex') !== f.sha256) throw new Error('Un fichier reçu est abîmé. Réessaie dans un instant.');
    fs.writeFileSync(path.join(tmp, f.name), buf); got += buf.length;
    if (!win.isDestroyed()) win.webContents.send('progress', { got, total });
  }
  fs.rmSync(dst, { recursive: true, force: true }); fs.renameSync(tmp, dst);
  fs.writeFileSync(path.join(ldir, 'current.json'), JSON.stringify({ version: L.version }));
  journal('lanceur mis à jour : ' + LAUNCHER_VERSION + ' → ' + L.version);
  setTimeout(() => { if (!process.env.PANTINS_NO_RELAUNCH) app.relaunch(); app.exit(0); }, 600);
  return { version: L.version };
}
// une fois la fenêtre affichée, cette version du lanceur est validée ; on range les anciennes
function launcherBootOk(){
  if (P.boot) { try { fs.unlinkSync(P.boot); } catch (e) {} }
  const ldir = P.dir; if (!ldir || !fs.existsSync(ldir)) return;
  for (const n of fs.readdirSync(ldir)) {
    if (/^\d+\.\d+\.\d+(\.part)?$/.test(n) && n !== LAUNCHER_VERSION) { try { fs.rmSync(path.join(ldir, n), { recursive: true, force: true }); } catch (e) {} }
  }
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
  const link = { target: exe, cwd: dir, description: 'Pantins, un jeu de réflexes au théâtre', icon: path.join(BUNDLED, fs.existsSync(path.join(BUNDLED, 'icone.ico')) ? 'icone.ico' : 'icone.png'), iconIndex: 0, appUserModelId: APP_ID };
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
    backgroundColor: '#0b0807', title: 'Pantins', show: false, icon: path.join(BASE, 'icone.png'),
    webPreferences: { preload: path.join(BASE, 'preload-lanceur.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  launcher.once('ready-to-show', () => { launcher.show(); launcherBootOk(); });
  launcher.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  launcher.loadFile(path.join(BASE, 'lanceur.html'));
}
// ---- Discord : « Joue à Pantins » sur le profil des joueurs (Rich Presence), sans bibliothèque ----
// On parle directement à l'application Discord ouverte sur le PC (tube local discord-ipc-N). Si Discord est fermé : rien.
const DISCORD_ID = '1567307303651381248', DISCORD_URL = 'https://github.com/Toka120/Pantins';
const DTR = {
  menu: {fr:'Dans le lanceur', en:'In the launcher', es:'En el lanzador', de:'Im Launcher', it:'Nel launcher', ar:'في المشغّل'},
  jeu:  {fr:'Au théâtre', en:'At the theatre', es:'En el teatro', de:'Im Theater', it:'A teatro', ar:'في المسرح'},
  btn:  {fr:'Télécharger Pantins', en:'Get Pantins', es:'Descargar Pantins', de:'Pantins holen', it:'Scarica Pantins', ar:'نزّل Pantins'} };
const Discord = { sock: null, ready: false, want: null, t0: Date.now(), retry: null, buf: Buffer.alloc(0),
  pipe(i){ if (process.platform === 'win32') return '\\\\?\\pipe\\discord-ipc-' + i;
    return path.join(process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp', 'discord-ipc-' + i); },
  send(op, obj){ if (!this.sock) return; const d = Buffer.from(JSON.stringify(obj)), h = Buffer.alloc(8); h.writeInt32LE(op, 0); h.writeInt32LE(d.length, 4); try { this.sock.write(Buffer.concat([h, d])); } catch (e) {} },
  connect(i = 0){
    if (this.sock) return; if (i > 9) { this.later(); return; }
    const s = require('net').createConnection(this.pipe(i));
    s.once('error', () => { s.destroy(); this.connect(i + 1); });
    s.once('connect', () => { this.sock = s; s.removeAllListeners('error'); s.on('error', () => {});
      s.on('close', () => { this.sock = null; this.ready = false; this.buf = Buffer.alloc(0); this.later(); });
      s.on('data', b => this.data(b)); this.send(0, { v: 1, client_id: DISCORD_ID }); });
  },
  later(){ clearTimeout(this.retry); this.retry = setTimeout(() => this.connect(0), 30000); },
  data(b){ this.buf = Buffer.concat([this.buf, b]);
    while (this.buf.length >= 8) { const op = this.buf.readInt32LE(0), n = this.buf.readInt32LE(4); if (this.buf.length < 8 + n) break;
      let m = {}; try { m = JSON.parse(this.buf.slice(8, 8 + n).toString()); } catch (e) {} this.buf = this.buf.slice(8 + n);
      if (op === 1 && m.evt === 'READY') { this.ready = true; this.apply(); }
      else if (op === 1 && m.evt === 'ERROR') journal('discord : ' + JSON.stringify(m.data || m));
      else if (op === 2) { try { this.sock.destroy(); } catch (e) {} }
      else if (op === 3) this.send(4, m); } },
  set(where, restart){ if (restart) this.t0 = Date.now(); this.want = where; this.apply(); },
  apply(){ if (!this.ready || !this.want) return; const L = options().lang || 'fr', T = k => DTR[k][L] || DTR[k].fr;
    this.send(1, { cmd: 'SET_ACTIVITY', nonce: String(Date.now()), args: { pid: process.pid, activity: {
      details: T(this.want), timestamps: { start: Math.floor(this.t0 / 1000) },
      assets: this.want === 'jeu' ? { large_image: 'theatre', large_text: T('jeu'), small_image: 'logo', small_text: 'Pantins' } : { large_image: 'logo', large_text: 'Pantins' }, buttons: [{ label: T('btn'), url: DISCORD_URL }] } } }); }
};
function play(){
  if (game) { game.focus(); return; }
  const o = options();
  game = new BrowserWindow({ width: 1280, height: 720, minWidth: 800, minHeight: 450, backgroundColor: '#000000', title: 'Pantins', icon: path.join(BASE, 'icone.png'),
    autoHideMenuBar: true, show: false, fullscreen: !!o.fullscreen,
    webPreferences: { preload: path.join(BASE, 'preload-jeu.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  game.setMenu(null);
  game.once('ready-to-show', () => { if (!o.fullscreen) game.maximize(); game.show(); launcher && launcher.hide(); });
  game.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { game.setFullScreen(!game.isFullScreen()); e.preventDefault(); } });
  game.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let closing = false;
  game.on('close', e => {   // on garde le réglage graphique choisi en jeu
    if (closing) return; e.preventDefault(); closing = true;
    game.webContents.executeJavaScript("[localStorage.getItem('pantins_gfx'),localStorage.getItem('pantins_lang')]").then(([v, l]) => {
      try { const g = JSON.parse(v); if (['bas','moyen','haut'].includes(g)) saveOptions({ gfx: g }); } catch (_) {}
      try { const L = JSON.parse(l); if (LANGS.includes(L)) saveOptions({ lang: L }); } catch (_) {} })   // et la langue choisie en jeu
      .catch(() => {}).finally(() => game.destroy());
  });
  game.on('closed', () => { game = null; Discord.set('menu', true); if (launcher && !launcher.isDestroyed()) { launcher.show(); launcher.webContents.send('back'); } });
  game.loadURL('pantins://jeu/index.html');
  Discord.set('jeu', true);
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
  ipcMain.handle('updateLauncher', e => updateLauncher(BrowserWindow.fromWebContents(e.sender)));
  ipcMain.handle('reinstall', async () => { try { fs.rmSync(GAME_DIR, { recursive: true, force: true }); } catch (e) {} return check(); });
  ipcMain.handle('options', (e, o) => { saveOptions(o); Discord.apply(); return options(); });
  ipcMain.handle('devState', () => ({ on: !!devToken() }));
  ipcMain.handle('devSetToken', async (e, t) => { t = String(t || '').trim(); if (!t) return { ok: false, err: 'Colle d\'abord ta clé.' };
    try { const c = await devCheck(t); if (c.ok) devSave(t); return c; } catch (err) { return { ok: false, err: 'Pas de connexion avec GitHub.' }; } });
  ipcMain.handle('devClear', () => { try { fs.rmSync(devFile(), { force: true }); } catch (e) {} return { on: false }; });
  ipcMain.handle('devPublish', async (e, text, what) => { try { return await devPublish(String(text), String(what || '')); } catch (err) { return { ok: false, err: String(err.message || err) }; } });
  ipcMain.on('play', () => play());
  ipcMain.on('minimize', () => launcher && launcher.minimize());
  ipcMain.on('close', () => app.quit());
  ipcMain.on('gfx', e => { e.returnValue = options().gfx; });
  ipcMain.on('lang', e => { e.returnValue = options().lang || null; });
  try { ensureShortcuts(options(), false); } catch (e) { journal('raccourcis : ' + (e.stack || e)); }
  createLauncher(); Discord.set('menu'); Discord.connect();
});
app.on('window-all-closed', () => app.quit());
