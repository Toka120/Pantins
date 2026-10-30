/* Amorce du lanceur de Pantins.
   Charge la version la plus récente du lanceur : celle téléchargée dans %APPDATA%\Pantins\lanceur si elle est plus récente
   et a déjà démarré correctement, sinon celle livrée avec Pantins.exe. Ce fichier-ci ne se met jamais à jour. */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

app.setName('Pantins');
const HERE = __dirname;
const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return Math.sign(d); } return 0; };
const rd = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const touch = (f, t) => { try { fs.writeFileSync(f, t || ''); } catch (e) {} };

const bundled = (rd(path.join(HERE, 'package.json')) || {}).version || '0.0.0';
const LDIR = path.join(app.getPath('userData'), 'lanceur');
let P = { base: HERE, bundled: HERE, version: bundled, boot: null, dir: LDIR };

const cur = rd(path.join(LDIR, 'current.json'));
if (cur && cur.version && cmp(cur.version, bundled) > 0) {
  const d = path.join(LDIR, cur.version), refuse = path.join(LDIR, 'refuse-' + cur.version), boot = path.join(LDIR, 'demarrage-' + cur.version);
  // le démarrage précédent de cette version n'a jamais affiché sa fenêtre : on la met de côté
  if (fs.existsSync(boot)) { touch(refuse, 'démarrage jamais terminé'); try { fs.unlinkSync(boot); } catch (e) {} }
  if (!fs.existsSync(refuse) && fs.existsSync(path.join(d, 'main.js'))) { touch(boot, String(Date.now())); P = { base: d, bundled: HERE, version: cur.version, boot, dir: LDIR }; }
}
global.PANTINS = P;
try { require(path.join(P.base, 'main.js')); }
catch (e) {
  if (P.base === HERE) throw e;
  touch(path.join(LDIR, 'refuse-' + P.version), String(e && e.stack || e));
  try { fs.unlinkSync(P.boot); } catch (_) {}
  global.PANTINS = { base: HERE, bundled: HERE, version: bundled, boot: null, dir: LDIR };
  require(path.join(HERE, 'main.js'));
}
