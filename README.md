# Pantins

Un jeu de réflexes au théâtre.

Ce dépôt sert à distribuer les mises à jour du jeu au lanceur Windows (`Pantins.exe`) :

- `latest.json` : la dernière version publiée, son empreinte SHA-256 et les notes de mise à jour ;
- `game/pantins.html` : le jeu lui-même, en un seul fichier.

Au démarrage, le lanceur lit `latest.json`. Si une version plus récente existe, il télécharge `game/pantins.html`, vérifie son empreinte, puis lance le jeu. Les sauvegardes restent sur l'ordinateur du joueur.
