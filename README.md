# IndoTrip Crew (Cloud)

Application collaborative pour organiser un voyage (idees, votes live, itineraire auto) utilisable depuis iPhone/Android/desktop.

## Ce que fait l'app

- Proposer des idees (lieux, activites, villes, iles)
- Voter a 3 niveaux: `✅ Je veux` / `🤷 Pourquoi pas` / `❌ Non`
- Synchronisation temps reel entre les 3 membres
- Generation automatique d'itineraire par zones geographiques
- PWA installable sur iPhone (Safari > Partager > Sur l'ecran d'accueil)

## Deployment cloud recommande (sans laisser ton ordinateur allume)

### Option A (recommandee): GitHub + Render

Cette option heberge l'app sur un vrai serveur cloud.

1. Cree un repo GitHub vide (par exemple `indotrip-crew`).
2. Uploade ce dossier dans le repo (web GitHub: `Add file` > `Upload files`).
3. Va sur [Render](https://render.com/) et connecte ton GitHub.
4. Clique `New` > `Blueprint` puis choisis ce repo.
5. Render detecte automatiquement `render.yaml`.
6. Clique `Apply` pour lancer le deploy.
7. A la fin, tu obtiens une URL publique du type:
   `https://indotrip-crew.onrender.com`

Tu peux ensuite partager cette URL avec tes 2 amis.

### Important sur la persistance

Le `render.yaml` est configure avec un disque persistant (`/var/data`) pour garder les idees/votes meme apres redemarrage.

## Utilisation

1. Ouvre l'URL publique.
2. Cree le voyage (14 jours) avec ton prenom.
3. Copie le lien et envoie-le a tes amis.
4. Chacun rejoint avec son prenom.
5. Ajoutez les idees et votez en direct.
6. Cliquez `Generer automatiquement` pour obtenir le plan.

## Lancement local (optionnel)

```bash
npm start
```

Puis ouvrir `http://localhost:3000`.

## Stack

- Node.js natif (serveur HTTP + SSE)
- Frontend vanilla JS/CSS (mobile-first)
- Stockage JSON cote serveur
- PWA (manifest + service worker)
