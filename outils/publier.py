"""Publie une nouvelle version pour le lanceur.

Nouvelle version du jeu :
  python outils/publier.py jeu chemin/vers/pantins.html 1.0.3 --cats maps,bugs --bug "Un bug corrigé." --bug "Un autre."

Nouvelle version du lanceur (après avoir changé la version dans lanceur/package.json) :
  python outils/publier.py lanceur --bug "Un bug du lanceur corrigé."

Catégories possibles : maps, armes, bugs. Seuls les bugs sont détaillés aux joueurs.
Ensuite : git add -A && git commit && git push. Les lanceurs installés voient la mise à jour au prochain contrôle.
"""
import argparse, datetime, hashlib, json, shutil, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
LANCEUR = ROOT / 'lanceur'
# fichiers téléchargés par les lanceurs déjà installés (amorce.js reste celui livré avec Pantins.exe)
LANCEUR_FICHIERS = ['main.js', 'lanceur.html', 'preload-lanceur.js', 'preload-jeu.js', 'icone.png', 'package.json']


def manifeste_lanceur():
    version = json.loads((LANCEUR / 'package.json').read_text('utf-8'))['version']
    files = []
    for n in LANCEUR_FICHIERS:
        b = (LANCEUR / n).read_bytes()
        files.append({'name': n, 'sha256': hashlib.sha256(b).hexdigest(), 'size': len(b)})
    return {'version': version, 'path': 'lanceur/', 'files': files}


ap = argparse.ArgumentParser()
sub = ap.add_subparsers(dest='quoi', required=True)
j = sub.add_parser('jeu')
j.add_argument('fichier'); j.add_argument('version')
j.add_argument('--cats', default='bugs'); j.add_argument('--bug', action='append', default=[])
j.add_argument('--date', default=datetime.date.today().isoformat())
l = sub.add_parser('lanceur')
l.add_argument('--cats', default='bugs'); l.add_argument('--bug', action='append', default=[])
l.add_argument('--date', default=datetime.date.today().isoformat())
a = ap.parse_args()

old = ROOT / 'latest.json'
latest = json.loads(old.read_text('utf-8'))
if a.quoi == 'jeu':
    dst = ROOT / 'game' / 'pantins.html'
    dst.parent.mkdir(exist_ok=True)
    shutil.copyfile(a.fichier, dst)
    data = dst.read_bytes()
    cats = [c.strip() for c in a.cats.split(',') if c.strip()]
    assert all(c in ('maps', 'armes', 'bugs') for c in cats), cats
    notes = [n for n in latest.get('notes', []) if n.get('lanceur') or n['version'] != a.version]
    notes.insert(0, {'version': a.version, 'date': a.date, 'cats': cats, 'bugs': a.bug})
    latest.update({'version': a.version, 'date': a.date, 'file': 'game/pantins.html',
                   'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data), 'notes': notes})
    print('Jeu', a.version, 'prêt :', len(data), 'octets')
latest['lanceur'] = manifeste_lanceur()
if a.quoi == 'lanceur':
    v = latest['lanceur']['version']
    cats = [c.strip() for c in a.cats.split(',') if c.strip()]
    assert all(c in ('maps', 'armes', 'bugs') for c in cats), cats
    notes = [n for n in latest.get('notes', []) if not (n.get('lanceur') and n['version'] == v)]
    notes.insert(0, {'version': v, 'date': a.date, 'lanceur': True, 'cats': cats, 'bugs': a.bug})
    latest['notes'] = notes
print('Lanceur', latest['lanceur']['version'])
old.write_text(json.dumps(latest, ensure_ascii=False, indent=2), 'utf-8')
