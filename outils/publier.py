"""Publie une nouvelle version du jeu pour le lanceur.

Exemple :
  python outils/publier.py chemin/vers/pantins.html 1.0.1 --cats maps,bugs --bug "Un bug corrigé." --bug "Un autre."

Catégories possibles : maps, armes, bugs. Seuls les bugs sont détaillés aux joueurs.
Ensuite : git add -A && git commit && git push.
"""
import argparse, datetime, hashlib, json, shutil, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument('jeu')
ap.add_argument('version')
ap.add_argument('--cats', default='bugs')
ap.add_argument('--bug', action='append', default=[])
ap.add_argument('--date', default=datetime.date.today().isoformat())
a = ap.parse_args()

dst = ROOT / 'game' / 'pantins.html'
dst.parent.mkdir(exist_ok=True)
shutil.copyfile(a.jeu, dst)
data = dst.read_bytes()

old = ROOT / 'latest.json'
latest = json.loads(old.read_text('utf-8')) if old.exists() else {'notes': []}
cats = [c.strip() for c in a.cats.split(',') if c.strip()]
assert all(c in ('maps', 'armes', 'bugs') for c in cats), cats
notes = [n for n in latest.get('notes', []) if n['version'] != a.version]
notes.insert(0, {'version': a.version, 'date': a.date, 'cats': cats, 'bugs': a.bug})
latest = {'version': a.version, 'date': a.date, 'file': 'game/pantins.html',
          'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data), 'notes': notes}
old.write_text(json.dumps(latest, ensure_ascii=False, indent=2), 'utf-8')
print('Version', a.version, 'prête :', len(data), 'octets')
