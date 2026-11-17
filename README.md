# AgriPilot — Ferme avicole & porcine

AgriPilot est une application web de gestion d'exploitation agricole (élevage avicole et porcin) :
suivi des bâtiments, des lots, des stocks, des ventes et de la rentabilité, avec plusieurs fermes,
douze rôles utilisateurs, double authentification et journal d'audit, puis production, stocks, santé, ventes,
finance, personnel, tâches, équipements, rapports et étiquettes QR. L'interface est en français, les montants en FCFA.
Le mode d'emploi pour le personnel de la ferme est dans [`docs/guide-utilisateur.md`](docs/guide-utilisateur.md).

- `backend/` : API REST NestJS + Prisma 7 + PostgreSQL 16 (préfixe `/api`, documentation Swagger sur `/api/docs`).
- `frontend/` : application monopage React 19 + Vite + Tailwind 4.

> English readers: this is a farm-management web app (NestJS API + React SPA). The sections below are in French;
> commands are copy-paste ready. All five delivery slices are complete (see « État d'avancement »); a French
> operator's guide for farm staff is in [`docs/guide-utilisateur.md`](docs/guide-utilisateur.md).

## Prérequis

- Node.js 22 et npm
- PostgreSQL 16 (en local, ou via Docker)
- Docker avec Docker Compose v2 (uniquement pour le démarrage « Docker »)
- Pour les tests de bout en bout : Playwright et Chromium (voir [Tests](#tests))

## Démarrage rapide (développement)

### Linux / macOS

```bash
git clone <url-du-dépôt> agripilot && cd agripilot
SEED_ADMIN_EMAIL=moi@exemple.com SEED_ADMIN_PASSWORD='un mot de passe long' ./scripts/dev.sh
```

Le script `scripts/dev.sh` :

1. crée `backend/.env` à partir de `backend/.env.example` s'il n'existe pas, avec des `JWT_SECRET` et
   `TOTP_ENC_KEY` aléatoires (un `.env` existant n'est jamais modifié) ;
2. exige `SEED_ADMIN_EMAIL` et `SEED_ADMIN_PASSWORD` (10 caractères minimum), depuis l'environnement ou depuis
   `backend/.env`, et s'arrête avec un message clair s'ils manquent ;
3. lance `npm install` dans `backend/` et `frontend/` si `node_modules` manque ;
4. vérifie que PostgreSQL répond (sur la machine de développement Debian du projet, il démarre le cluster local
   avec `scripts/dev-db.sh`) ; sinon il affiche la commande Docker pour en lancer un ;
5. applique les migrations (`prisma migrate deploy`), crée l'administrateur initial (seed), puis démarre
   l'API sur <http://localhost:3000> et l'application sur <http://localhost:5173>. `Ctrl-C` arrête les deux.

Pour charger en plus la ferme de démonstration (voir [Démonstration](#démonstration--ferme-kpalimé)) :

```bash
SEED_ADMIN_EMAIL=moi@exemple.com SEED_ADMIN_PASSWORD='un mot de passe long' \
  DEMO_PASSWORD='un autre mot de passe long' ./scripts/dev.sh --demo
```

Le script ne crée pas le rôle ni la base PostgreSQL hors de la machine Debian du projet : voir
[Base de données](#base-de-données) ci-dessous si PostgreSQL n'est pas encore prêt. Compatible avec le
bash 3.2 livré avec macOS.

### Windows (VS Code) : étapes manuelles, deux terminaux

Le script `dev.sh` est un script Bash. Sous Windows, suivez ces étapes (PowerShell ou terminal VS Code).
Si vous utilisez WSL ou Git Bash, `./scripts/dev.sh` fonctionne tel quel.

1. Démarrez PostgreSQL (par exemple avec la commande `docker run` ci-dessus, ou une installation locale
   avec un rôle `agripilot` et une base `agripilot`).
2. Terminal 1, API :

   ```powershell
   cd backend
   copy .env.example .env
   # Éditez .env : JWT_SECRET (32 caractères aléatoires minimum), TOTP_ENC_KEY (32 octets en base64),
   # SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD. Pour générer les secrets :
   #   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
   #   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   npm install
   npx prisma migrate deploy
   npx prisma db seed
   npm run start:dev
   ```

3. Terminal 2, application web :

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

4. Ouvrez <http://localhost:5173>.

## Base de données

`DATABASE_URL` (dans `backend/.env`) doit désigner un rôle, un mot de passe et une base qui **existent** sur votre
serveur. Par défaut : `postgresql://agripilot:agripilot@localhost:5432/agripilot`. Choisissez **une** des voies
suivantes, puis lancez `./scripts/dev.sh` (ou `npx prisma migrate deploy`).

### macOS : Postgres.app ou Homebrew

```bash
# Homebrew (une fois) : brew install postgresql@16 && brew services start postgresql@16
psql postgres -c "CREATE ROLE agripilot WITH LOGIN PASSWORD 'agripilot' CREATEDB;"
psql postgres -c "CREATE DATABASE agripilot OWNER agripilot;"
```

Le rôle existe déjà (erreur « role already exists ») avec un autre mot de passe ? Alignez-le :

```bash
psql postgres -c "ALTER ROLE agripilot WITH LOGIN PASSWORD 'agripilot';"
```

Avec Postgres.app, le binaire `psql` est dans `/Applications/Postgres.app/Contents/Versions/latest/bin`
(ajoutez-le au `PATH` ou utilisez le bouton « psql » de l'application).

### Docker

```bash
docker run -d --name agripilot-db -p 5432:5432 \
  -e POSTGRES_USER=agripilot -e POSTGRES_PASSWORD=agripilot -e POSTGRES_DB=agripilot \
  -v agripilot-db:/var/lib/postgresql/data postgres:16
```

Le port 5432 est déjà pris (PostgreSQL local, Postgres.app…) ? Publiez sur 5433 et adaptez `DATABASE_URL` :

```bash
docker run -d --name agripilot-db -p 5433:5432 \
  -e POSTGRES_USER=agripilot -e POSTGRES_PASSWORD=agripilot -e POSTGRES_DB=agripilot \
  -v agripilot-db:/var/lib/postgresql/data postgres:16
# backend/.env :
# DATABASE_URL="postgresql://agripilot:agripilot@localhost:5433/agripilot"
```

### Windows

Avec `psql` (ou l'outil de requêtes de pgAdmin, connecté en tant que `postgres`), exécutez le même SQL :

```sql
CREATE ROLE agripilot WITH LOGIN PASSWORD 'agripilot' CREATEDB;
CREATE DATABASE agripilot OWNER agripilot;
-- rôle déjà existant : ALTER ROLE agripilot WITH LOGIN PASSWORD 'agripilot';
```

### Base hébergée (Neon, Supabase…)

Collez la chaîne de connexion fournie par le service dans `DATABASE_URL` et gardez `?sslmode=require` si le
fournisseur l'indique, par exemple :

```
DATABASE_URL="postgresql://utilisateur:mot_de_passe@hote.exemple.com/nom_base?sslmode=require"
```

Le pilote `pg` utilisé par l'API accepte `sslmode=require` (vérifié ici contre un PostgreSQL local avec TLS : connexion
chiffrée établie). Non vérifié contre Neon/Supabase eux-mêmes ni avec la CLI Prisma sur ces services. Préférez une
connexion directe (non « poolée ») pour `prisma migrate deploy` si le fournisseur en propose une.

## Première connexion et double authentification

1. Ouvrez <http://localhost:5173> et connectez-vous avec `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
2. Le compte initial est `SUPER_ADMIN`. La double authentification est **obligatoire** pour les rôles
   `SUPER_ADMIN`, `PROPRIETAIRE`, `DIRECTEUR_FERME` et `COMPTABLE` : à la première connexion, l'application
   affiche « Activer la double authentification ». Scannez le QR code (ou saisissez la clé) dans une
   application d'authentification (Google Authenticator, Authy, 2FAS…), entrez le code à 6 chiffres, puis
   **conservez les 8 codes de secours** affichés une seule fois : chacun ne sert qu'une fois.
3. Aux connexions suivantes, l'application demande le code à 6 chiffres (ou un code de secours).
4. Les autres rôles (par exemple `AUDITEUR`, `RESP_AVICOLE`) peuvent activer la 2FA depuis « Mon compte »
   mais n'y sont pas forcés.
5. Cinq échecs de connexion consécutifs verrouillent le compte 15 minutes.

Créez ensuite les fermes, sites, bâtiments et utilisateurs depuis le menu Administration
(`/admin/fermes`, `/m/batiments`, `/admin/utilisateurs`).

## Démarrage avec Docker

> **Non vérifié ici** : le démon Docker n'était pas disponible dans l'environnement de développement de ce
> dépôt. `docker compose config` valide le fichier, mais les images (`backend/Dockerfile`,
> `frontend/Dockerfile`) n'ont **pas été construites** ici. Les étapes de build (`npm ci`, `npm run build`,
> `prisma migrate deploy`, démarrage de `node dist/main`) ont été exécutées à la main, hors conteneur.
> Faites un premier essai sur une machine de test avant toute mise en production.

```bash
cp .env.example .env
# Éditez .env : POSTGRES_PASSWORD, JWT_SECRET, TOTP_ENC_KEY, WEB_ORIGIN, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
#   openssl rand -base64 48   # JWT_SECRET
#   openssl rand -base64 32   # TOTP_ENC_KEY
docker compose up -d --build
docker compose run --rm api npx prisma db seed   # une seule fois : crée l'administrateur initial
```

L'application est servie sur <http://localhost:8080> (nginx : application, proxy `/api` vers l'API, repli SPA,
en-têtes de sécurité, gzip). `docker compose` refuse de démarrer, avec un message explicite, si une variable
obligatoire manque : il n'existe aucune valeur secrète par défaut. Le seed n'est jamais automatique.

Points d'attention :

- `WEB_ORIGIN` doit être l'adresse exacte saisie dans le navigateur (CORS), par exemple `https://ferme.exemple.com`.
- L'API tourne en `NODE_ENV=production` : le cookie de session (`ap_refresh`) est `Secure`. Chrome et Firefox
  l'acceptent sur `http://localhost` ; **Safari non** (la connexion semble réussir puis la session est perdue).
  Pour un essai local avec Docker, utilisez Chrome ou Firefox, ou mettez HTTPS devant. Pour tout autre accès
  (autre machine, nom de domaine) il faut un proxy HTTPS (Caddy, Traefik, nginx + Let's
  Encrypt…) devant le port 8080. L'API tourne avec `TRUST_PROXY=1` pour que la limitation de débit voie la
  vraie adresse IP du client derrière nginx. Si un autre proxy inverse (Caddy, Traefik…) se trouve devant le
  conteneur `web`, mettez `TRUST_PROXY=2` dans le `.env` racine (un proxy de plus dans la chaîne).
- Pas de caractères `@ : / ?` dans `POSTGRES_PASSWORD` (il est inséré dans l'URL de connexion).
- Volumes : `agripilot_db-data` (base) et `agripilot_api-uploads` (fichiers téléversés, `/app/uploads`).
- Commandes utiles : `docker compose logs -f api`, `docker compose ps`, `docker compose down` (conserve les volumes).
- Étiquettes QR : renseignez `APP_URL` (adresse publique, par exemple `https://ferme.exemple.com`) avant d'imprimer : les QR encodent cette
  adresse ; un QR imprimé avec une mauvaise adresse est à réimprimer.
- Démonstration : voir [Démonstration](#démonstration--ferme-kpalimé) (`docker compose run --rm api node dist-demo/prisma/demo/seed-demo.js`).

## Démonstration : « Ferme Kpalimé »

Un jeu de données complet (bâtiments, lots, ponte, porcs, stocks, achats, santé, clients, factures, finance, personnel,
tâches, équipements) permet de visiter chaque écran. Il est chargé **par l'API elle-même** (mêmes règles, mêmes registres,
même journal d'audit que la saisie à la main), pas par du SQL.

```bash
cd backend
npx prisma migrate deploy && npx prisma db seed          # base prête et administrateur initial
SEED_ADMIN_EMAIL=moi@exemple.com DEMO_PASSWORD='10 caractères minimum' npm run seed:demo   # environ 5 secondes
```

- `SEED_ADMIN_EMAIL` doit être l'administrateur créé par `prisma db seed` ; `DEMO_PASSWORD` est le mot de passe commun des comptes.
- Avec `scripts/dev.sh` : `DEMO_PASSWORD='…' ./scripts/dev.sh --demo`. Avec Docker :
  `docker compose run --rm -e ALLOW_DEMO_SEED=1 -e DEMO_PASSWORD='…' api node dist-demo/prisma/demo/seed-demo.js`
  (l'API Docker tourne en production, d'où `ALLOW_DEMO_SEED=1`).
- **Comptes** : un par rôle, `<rôle>@kpalime.demo`, tous avec `DEMO_PASSWORD` : `super.admin`, `proprietaire`, `directeur.ferme`,
  `resp.avicole`, `resp.porcin`, `veterinaire`, `resp.stock`, `comptable`, `commercial`, `agent.elevage`, `magasinier`, `auditeur`.
  Les quatre rôles à double authentification obligatoire (Super admin, Propriétaire, Directeur, Comptable) l'activent à leur première
  connexion. « Kodjo A. » est lié au compte `agent.elevage`, « Dr Koffi » au compte `veterinaire` (voir leurs tâches).
- **Une seule fois** : relancer la commande ne change rien (« Données de démonstration déjà chargées ») ; sur une ferme qui contient déjà des
  données sans le marqueur de démo, elle refuse. En développement, `npm run demo:reset` remet la base à zéro puis recharge
  (refusé en production).
- **Production** : la commande est refusée quand `NODE_ENV=production`, sauf `ALLOW_DEMO_SEED=1`.
- **Avertissement** : la démo crée **un second Super administrateur** (`super.admin@kpalime.demo`) et 11 autres comptes dont le mot de passe est
  partagé. Ne la chargez **jamais** sur une installation réelle ; si elle l'a été, supprimez ces 12 comptes (Administration > Utilisateurs)
  avant tout usage réel.
- Les dates sont relatives au jour du chargement (les dates de la maquette sont avancées du nombre de jours écoulés depuis le
  2026-11-14), donc les alertes, les jours de stock et les créances se lisent comme sur la maquette. Écarts avec la maquette, listés en tête de
  `backend/prisma/demo/seed-demo.ts` : « Vaccination à venir » remplace « Vaccination en retard » ; les alertes sont plus nombreuses que les 14
  de la maquette (des données ont été ajoutées pour que chaque règle et chaque écran aient du contenu) ; « Rentabilité du mois » montre le
  mois courant ; le solde d'Agro Provende SA est 0.

## Dépannage

| Symptôme | Cause et remède |
|---|---|
| Le seed affiche `SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set` | Renseignez ces deux variables dans `backend/.env` (mot de passe de 10 caractères minimum) ou passez-les devant la commande, puis relancez. |
| `Authentication failed … the provided database credentials for agripilot are not valid` (P1000) | Le rôle ou le mot de passe de `DATABASE_URL` ne correspond pas au serveur PostgreSQL. Créez/alignez le rôle : voir [Base de données](#base-de-données) (`CREATE ROLE …` ou `ALTER ROLE agripilot WITH LOGIN PASSWORD '…'`). `database "agripilot" does not exist` : `CREATE DATABASE agripilot OWNER agripilot;`. |
| La page de connexion affiche « Le serveur est injoignable… » (ou une erreur 502) | L'API n'est pas démarrée ou s'est arrêtée au démarrage. Regardez le terminal de l'API et ouvrez <http://localhost:3000/api/health> : la réponse attendue est `{"status":"ok","db":"up"}`. |
| L'API refuse de démarrer : `JWT_SECRET`, `TOTP_ENC_KEY` ou `WEB_ORIGIN` | `JWT_SECRET` : 32 caractères minimum, pas la valeur d'exemple (`openssl rand -base64 48`). `TOTP_ENC_KEY` : 32 octets en base64 ou hexadécimal (`openssl rand -base64 32`). `WEB_ORIGIN` : obligatoire, par exemple `http://localhost:5173`. `scripts/dev.sh` les génère à la création de `backend/.env`. |
| La première connexion impose une configuration de la 2FA | Normal pour `SUPER_ADMIN` : installez une application d'authentification (Google Authenticator, Authy, 2FAS…), scannez le QR code, saisissez le code et conservez les codes de secours (chacun ne sert qu'une fois). |
| `EADDRINUSE` / port 3000 ou 5173 déjà utilisé | Arrêtez l'autre processus ou changez `PORT` (API) / lancez `npm run dev -- --port …` (web, et `VITE_API_TARGET` si l'API change de port). |

## Variables d'environnement

### `backend/.env` (développement ; modèle : `backend/.env.example`)

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | oui | URL PostgreSQL, ex. `postgresql://agripilot:agripilot@localhost:5432/agripilot` |
| `JWT_SECRET` | oui | Signature des jetons d'accès, 32 caractères minimum (l'API refuse de démarrer sinon) |
| `TOTP_ENC_KEY` | oui | Clé de chiffrement des secrets 2FA : 32 octets en base64 ou hexadécimal |
| `WEB_ORIGIN` | oui | Origine autorisée par CORS, ex. `http://localhost:5173` |
| `PORT` | non | Port de l'API (3000 par défaut) |
| `APP_URL` | non | Adresse publique de l'application, encodée dans les QR (`{APP_URL}/q/{type}/{id}`) ; `WEB_ORIGIN` par défaut. Une adresse absolue `http(s)://…` sans chemin |
| `UPLOAD_DIR` | non | Dossier des fichiers téléversés (photos de preuve des tâches) ; `uploads` sous le dossier de l'API par défaut, `/app/uploads` (volume `api-uploads`) avec Docker |
| `ENABLE_API_DOCS` | non | Swagger (`/api/docs`) est servi hors production ; en production il reste fermé sauf si la valeur est exactement `true` |
| `TRUST_PROXY` | non | Nombre de proxys (`1`), `true`… derrière nginx, pour la limitation de débit |
| `SEED_ADMIN_EMAIL` | pour le seed | E-mail de l'administrateur initial (utilisé par `prisma db seed` et `seed:demo`) |
| `SEED_ADMIN_PASSWORD` | pour le seed | Mot de passe initial, 10 caractères minimum |
| `DEMO_PASSWORD` | pour la démo | Mot de passe des 12 comptes de démonstration, 10 caractères minimum ; lu dans l'environnement, jamais écrit ni journalisé |
| `ALLOW_DEMO_SEED` | non | `1` pour autoriser la démo quand `NODE_ENV=production` (installation d'évaluation) |

### `.env` à la racine (Docker ; modèle : `.env.example`)

| Variable | Obligatoire | Rôle |
|---|---|---|
| `POSTGRES_PASSWORD` | oui | Mot de passe du rôle PostgreSQL `agripilot` |
| `JWT_SECRET` | oui | Voir ci-dessus |
| `TOTP_ENC_KEY` | oui | Voir ci-dessus |
| `WEB_ORIGIN` | oui | Adresse publique de l'application, ex. `http://localhost:8080` |
| `TRUST_PROXY` | non | Nombre de proxys devant l'API : `1` par défaut (nginx du conteneur `web`), `2` si un autre proxy inverse (Caddy, Traefik…) est devant `web` |
| `APP_URL` | non | Adresse encodée dans les QR (par défaut `WEB_ORIGIN`) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | pour le seed | Utilisés uniquement par `docker compose run --rm api npx prisma db seed` (et la démo) |
| `DEMO_PASSWORD`, `ALLOW_DEMO_SEED` | pour la démo | Voir [Démonstration](#démonstration--ferme-kpalimé) ; l'API Docker tourne en production, donc `ALLOW_DEMO_SEED=1` est nécessaire |

### Autres

| Variable | Où | Rôle |
|---|---|---|
| `VITE_API_URL` | build du frontend | Préfixe de l'API (`/api` par défaut) |
| `VITE_API_TARGET` | `vite` (dev) | Cible du proxy `/api` (`http://localhost:3000` par défaut) |
| `E2E_CHROMIUM_PATH` | tests e2e | Chemin d'un Chromium à utiliser à la place de celui de Playwright |
| `E2E_DATABASE_URL` | tests e2e | URL de la base e2e (son nom doit rester `agripilot_e2e`) |

**Gardez `TOTP_ENC_KEY` avec vos sauvegardes** : sans elle, les secrets 2FA stockés en base ne sont plus
déchiffrables et les utilisateurs devront refaire la configuration de la 2FA.

## Tests

Les tests d'API ont besoin de PostgreSQL avec les bases `agripilot_test` (tests backend) et `agripilot_e2e`
(tests de bout en bout). Sur la machine de développement Debian du projet, `scripts/dev-db.sh` démarre le
cluster et crée le rôle et les trois bases. Ailleurs, créez-les : `createdb -h localhost -U agripilot agripilot_test`
(idem `agripilot_e2e`).

| Quoi | Commande |
|---|---|
| Backend, unitaires | `cd backend && npm test` |
| Backend, intégration API (base `agripilot_test`, via `backend/.env.test`) | `cd backend && npm run test:e2e` |
| Frontend, unitaires | `cd frontend && npm test` |
| Frontend, build de production | `cd frontend && npm run build` |
| Bout en bout (navigateur ; Node ≥ 22.18) | `cd frontend && npm run e2e` |
| Démo (dans la suite d'intégration backend) | `cd backend && npm run test:e2e -- demo-seed` |

`npm run e2e` n'utilise jamais la base de développement : il réinitialise la base `agripilot_e2e`
(migrations + seed de comptes jetables), compile et lance l'API sur le port 3100 (avec `NODE_ENV=test`, ce qui
désactive la limitation de débit de connexion) et Vite sur le port 5273, exécute les scénarios Playwright, puis
arrête les serveurs. Il régénère aussi les captures de `docs/reference/built/`. Il requiert le paquet
`playwright` (cherché dans le projet, puis dans l'installation globale `npm root -g`), Chromium et **Node 22.18 ou plus récent** (exécution directe du TypeScript) ; `E2E_CHROMIUM_PATH` permet d'en indiquer un.
`E2E_DATABASE_URL` remplace l'URL de la base e2e (le nom de la base doit rester `agripilot_e2e`).

Sur une machine de développement ordinaire, installez Playwright une seule fois (sans toucher à `package.json`) :

```bash
cd frontend
npm install --no-save playwright
npx playwright install chromium
npm run e2e
```
Les scénarios sont écrits avec `node:test` et `playwright` (pas `@playwright/test`).

Scénarios : connexion et 2FA obligatoire (`auth.spec.ts`), site et bâtiments, droits de l'auditeur et
journal d'audit (`batiments.spec.ts`), comparaison de rendu avec la référence et responsive mobile
(`visual.spec.ts`), parcours de production de bout en bout (`production.spec.ts`), parcours logistique : achats,
stocks, inventaire, santé et alertes, un rôle par étape (`logistics.spec.ts`, `npm run e2e -- logistics`), parcours commercial :
devis, facture, paiements, avoir, remboursement, finance, rentabilité et alertes de créance (`commerce.spec.ts`,
`npm run e2e -- commerce` ; il couvre aussi une vente datée avant un traitement, l'annulation d'une facture issue d'un devis
et l'impression de la facture par un Commercial et un Comptable). parcours opérations : employés et présences, préremplissage des salaires, tâche créée, démarrée, terminée avec photo, rouverte, tâche
récurrente, « Mes tâches », équipement, panne, intervention corrective et dépense « Entretien » en finance, rapports (synthèse, mensuel,
sanitaire, zootechnique, CSV et Excel), QR (fenêtre, planche d'étiquettes, `/q/lot/{id}`, QR inconnu), masquage des alertes et droits par rôle
(`operations.spec.ts`, `npm run e2e -- operations`). Les specs commerce, logistique et opérations tournent avant le spec de rendu : ils partagent la même organisation, donc les articles, fournisseurs et clients de
référence (« Aliment ponte », « Agro Provende SA », « Restaurant Le Palmier »…) sont créés une seule fois, par celui qui passe le premier.
`npm run e2e -- --serve` laisse seulement les serveurs e2e démarrés ; `npm run e2e -- production` n'exécute que les
specs dont le nom contient le mot donné (erreur s'il n'y en a aucune).

Le lanceur donne 10 minutes à chaque fichier de scénarios (`--test-timeout=600000`) : un scénario de bout en bout est un
seul parcours de nombreuses étapes, et node:test applique ce délai au fichier entier.

Précondition : la date du serveur est postérieure au 2026-10-22, car les lignes de référence des captures sont
datées d'octobre 2026 (aucune date future n'est acceptée). Le parcours commercial date sa facture échue de la veille : il
tourne tous les jours, et le premier jour d'un mois il en tient compte (la veille est dans le mois précédent, donc hors des
chiffres du mois en cours). Les captures de `docs/reference/built/` peuvent différer
d'un jour à l'autre par un seul nombre (« Dépassée depuis N j » de l'alerte de mise bas) ; la date de l'acte de santé
planifié et les mouvements de consommation de stock (jours de stock) sont calculés par rapport au jour d'exécution.

État vérifié en fin de tranche 5 (Linux, PostgreSQL 16 local) : frontend `tsc -b` propre, 45 fichiers et 775 tests unitaires, build de production
réussi ; navigateur : `npm run e2e` complet, 83 scénarios sur 83 (auth, bâtiments, commerce, logistique, opérations, production, rendu), sans
relance ni scénario ignoré. Les suites du backend sont comptées dans `docs/superpowers/plans/2026-11-17-slice-5-carryover.md`.
Les étapes d'installation de ce fichier (migrations, seed, démonstration, `dev.sh` et son option `--demo`) ont été exécutées ici ; ne l'ont **pas** été :
Docker (pas de démon), un vrai Mac, Windows, une base hébergée.

## Sauvegarde et restauration

Trois choses à sauvegarder ensemble : la base PostgreSQL (toutes les données), le dossier des fichiers téléversés
(`UPLOAD_DIR` ; les photos de preuve des tâches) et `TOTP_ENC_KEY` (sans elle, les secrets 2FA ne se déchiffrent plus). Une base restaurée
sans ses fichiers garde des tâches dont la photo n'est plus lisible.


### Installation locale

```bash
# Sauvegarde (format custom, compressé)
pg_dump -Fc -h localhost -U agripilot -d agripilot -f agripilot-$(date +%Y%m%d).dump

# Restauration dans une base vide (ou existante : --clean supprime d'abord les objets)
pg_restore --clean --if-exists --no-owner -h localhost -U agripilot -d agripilot agripilot-20261114.dump
```

### Docker

```bash
# Sauvegarde
docker compose exec -T db pg_dump -U agripilot -Fc agripilot > agripilot-$(date +%Y%m%d).dump

# Restauration (arrêter l'API pendant l'opération)
docker compose stop api web
docker compose exec -T db pg_restore -U agripilot -d agripilot --clean --if-exists --no-owner < agripilot-20261114.dump
docker compose start api web

# Fichiers téléversés (volume api-uploads)
docker run --rm -v agripilot_api-uploads:/data -v "$PWD":/backup alpine tar czf /backup/uploads.tgz -C /data .
# Restauration des fichiers
docker run --rm -v agripilot_api-uploads:/data -v "$PWD":/backup alpine tar xzf /backup/uploads.tgz -C /data
```

Le nom du volume est préfixé par le nom du projet Compose, `agripilot` (`name:` dans `docker-compose.yml` ; `docker volume ls` pour le vérifier).
Testez régulièrement une restauration sur une base de test.

## Structure du dépôt

```
backend/            API NestJS (src/), schéma et migrations Prisma (prisma/), tests d'intégration (test/)
  src/access/         rôles, permissions, garde d'accès, périmètre par ferme (en-tête X-Farm-Id)
  src/auth/           connexion, jetons, 2FA TOTP, codes de secours
  src/admin/          fermes, sites, bâtiments, zones, utilisateurs, paramètres
  src/audit/          journal d'audit
  src/listing/        pagination, tri, export CSV/XLSX
  src/dashboard/      tableau de bord et alertes (règles, masquage par utilisateur)
  src/personnel/      employés, présences, aperçu de la paie
  src/tasks/          tâches, récurrence, photo de preuve
  src/equipment/      équipements, interventions, pannes, dépense d'entretien
  src/reports/        rapports (synthèse, périodiques, sanitaire, zootechnique), CSV et Excel
  src/qr/             QR (lot, animal, bâtiment, article, équipement) et données d'étiquettes
  prisma/demo/        jeu de démonstration « Ferme Kpalimé » (`npm run seed:demo`)
  Dockerfile
frontend/           application React (src/), nginx.conf, Dockerfile
  e2e/                tests de bout en bout Playwright et leur lanceur (run.ts)
scripts/            dev.sh (tout démarrer, `--demo` pour la démo), dev-db.sh (PostgreSQL local Debian)
docs/
  reference/          captures de référence (screens/), textes et styles de la maquette
  reference/built/    captures de CETTE version, régénérées par `npm run e2e`
  guide-utilisateur.md  mode d'emploi en français pour le personnel de la ferme
  superpowers/        spécification et plan de livraison
docker-compose.yml  db + api + web
.env.example        variables du démarrage Docker
```

`docs/reference/` contient les captures de la maquette d'origine ; `docs/reference/built/` contient les
captures de l'application construite, à comparer côte à côte (`home.png`, `m_batiments.png`, `shell.png`).

## État d'avancement

Livraison en cinq tranches, **toutes terminées** ; chacune s'est terminée par une application qui tourne et est testée.

**Tranche 1 — Fondations : terminée.**

- Authentification : connexion, jetons d'accès courts (15 min, en mémoire) et jeton de rafraîchissement
  rotatif (cookie httpOnly), verrouillage après 5 échecs, réinitialisation du mot de passe par lien.
- Double authentification TOTP avec codes de secours, obligatoire pour les rôles sensibles.
- Douze rôles et droits par module, cloisonnement par ferme (`X-Farm-Id`), sélecteur de ferme.
- Administration : fermes, sites, bâtiments, zones, utilisateurs, paramètres.
- Journal d'audit filtrable, export CSV/XLSX des listes.
- Interface : coque (barre latérale, recherche de module, tiroir mobile), système de design de la maquette,
  composant de page de module piloté par configuration, tableau de bord et alertes alimentés par l'API,
  rendu responsive.
- Tests : unitaires et d'intégration backend, unitaires frontend, bout en bout Playwright, captures comparées.

**Tranche 2 — Production : terminée.**

- Lots avicoles (chair, pondeuses, poussins, reproducteurs) : effectifs, mortalité cumulée et taux, pesées, GMD et
  indice de consommation, transfert entre bâtiments, clôture et réouverture ; l'effectif et l'occupation d'un
  bâtiment sont toujours des sommes de mouvements, jamais des champs saisis.
- Ponte et œufs : production journalière, taux de ponte et de casse ; incubation avec mirage, éclosion (qui crée le
  lot de poussins) et échec.
- Cheptel porcin : animaux individuels (truies, verrats, cochettes) et lots de porcelets ou d'engraissement dans une
  même liste, pesées, sorties, fiche de l'animal avec son historique de reproduction.
- Reproduction : saillie ou IA, mise bas prévue à la date de saillie + 114 jours (réglable), mise bas (qui crée le
  lot de porcelets), sevrage, échec, chaleurs.
- Alimentation et eau : aliments et formules (pourcentages totalisant 100 %, coût au kg), distributions par lot ou
  bâtiment avec leur coût, eau du jour enregistrée avec la distribution.
- Tableau de bord et alertes alimentés par ces données : volailles vivantes, porcs, œufs du dernier jour, taux de ponte
  et de mortalité, aliment et eau, alertes « Mortalité élevée », « Mise bas » et consommation anormale.
- Tests : bout en bout Playwright du parcours de production (lot, mortalité, ponte, saillie, mise bas, distribution,
  droits d'un agent d'élevage, audit) et captures des écrans comparées à la maquette (`docs/reference/built/`).

**Tranche 3 — Stocks, achats, santé : terminée.**

- Stocks : articles (aliments, médicaments, vaccins, matériel, consommables) avec seuils par ferme, niveaux `ok` /
  `faible` / `critique`, jours de stock, lots avec date de péremption, coût moyen pondéré. Une quantité n'est jamais
  saisie : c'est la somme des mouvements (entrées, sorties, ajustements) ; une sortie qui rendrait le stock négatif est
  refusée. Une sortie prise sur plusieurs lots reste une seule opération (la corriger ou la supprimer agit sur
  l'ensemble).
- Inventaires : un brouillon de comptage, enregistré puis validé ; la feuille propose chaque article actif avec sa
  quantité théorique à la date de l'inventaire (pas celle d'aujourd'hui) ; la validation enregistre les écarts comme
  ajustements. Un inventaire validé ferme le passé de l'article compté : tout mouvement, toute correction de
  distribution, d'acte de santé ou réception antérieurs à cette date sont refusés (« Un inventaire validé le … verrouille
  les mouvements antérieurs de … »). Les corrections se font donc avant la validation ; seule la correction du prix
  d'une entrée antérieure reste possible (l'inventaire fixe les quantités, pas les valeurs).
- Alimentation : une distribution consomme le stock de l'aliment lié ; son coût est toujours celui du registre de stock
  (il suit une entrée antidatée à un autre prix ou sa suppression). Changer l'unité ou la catégorie d'un article lié à
  un aliment est refusé.
- Fournisseurs et achats : demande → validation → commande (bon de commande imprimable) → réception → paiement, ou
  annulation avant la réception. La réception entre en stock (lot, péremption) ; on ne peut pas recevoir plus que la
  quantité commandée. Le solde d'un fournisseur est la somme de ses achats reçus moins les paiements.
- Santé et biosécurité : vaccinations, traitements, désinfections et diagnostics (planifiés, réalisés, en retard), plans
  vaccinaux appliqués à un lot, délais d'attente affichés sur le lot et l'animal, quarantaines, incidents, relevés de
  biosécurité. Un acte réalisé avec un produit en stock en retire la quantité du stock. Un plan dont toutes les étapes
  ont été annulées peut être appliqué de nouveau au lot. Le réglage « alerte biosécurité » n'existe plus.
- Alertes du tableau de bord : « Stock faible / critique », produits périmés ou bientôt périmés, « Vaccination en
  retard / à venir », traitements et désinfections en retard.
- Tests : parcours bout en bout Playwright `frontend/e2e/logistics.spec.ts` (`npm run e2e -- logistics` : demande,
  validation, commande, réception, stock, distribution, inventaire, vaccination avec lot de produit, délai d'attente,
  alertes, droits du comptable) et captures de Stocks, Fournisseurs, Achats et Santé comparées à la maquette
  (`docs/reference/built/`), vérifiées aussi sur un écran de 375 px : feuille d'inventaire
  (`m_stocks_inventaire_375.png`), détail d'un achat (`achat_detail_375.png`), réception (`achat_reception_375.png`),
  formulaire d'acte de santé (`sante_acte_375.png`), réception et plan vaccinal en dialogue large à 1440 px
  (`achat_reception_1440.png`, `sante_plan_1440.png`) et bon de commande à l'impression
  (`bon_de_commande_impression_375.png`).
- Écarts assumés avec la maquette, dans les données de test : les jours de stock et la vaccination planifiée sont
  datés par rapport au jour d'exécution (la date de la maquette est passée) ; le solde d'Agro Provende SA est 0 (le
  solde ne compte que les achats reçus) ; les numéros DA-0089, BC-0141 et BC-0142 sont obtenus en avançant le compteur
  de numérotation.

À savoir après une mise à jour : la tranche 3 ajoute plusieurs migrations de base de données. Après avoir récupéré le
code, lancez `npx prisma migrate deploy` dans `backend/` (ou `./scripts/dev.sh`).

Qui peut faire quoi sur les achats et les stocks :

| Action | Rôles |
|---|---|
| Créer, corriger ou supprimer une demande d'achat (tant qu'elle est en « Demande ») | Responsable stock, Directeur de ferme, Super administrateur |
| Valider, commander, annuler, enregistrer ou supprimer un paiement | Directeur de ferme, Propriétaire, Super administrateur |
| Réceptionner une commande | Magasinier, Responsable stock, Directeur de ferme, Super administrateur |
| Enregistrer un mouvement de stock, compter un inventaire | Magasinier, Responsable stock, Directeur de ferme, Super administrateur |
| Valider un inventaire | Responsable stock, Directeur de ferme, Super administrateur (pas le Magasinier) |
| Créer ou modifier un article, ses seuils, un fournisseur | Responsable stock, Directeur de ferme, Super administrateur |
| Lire les achats et les fournisseurs | Comptable, Auditeur, Propriétaire et les rôles ci-dessus (sans bouton d'action quand le droit d'écrire manque) |

Le Comptable lit les achats mais ne paie pas les fournisseurs : le paiement reste réservé au Directeur et au Propriétaire (décision du propriétaire).

**Tranche 4 — Clients, ventes et finance : terminée.**

- Clients (par organisation), devis (brouillon, envoyé, accepté, refusé, facturé, expiré), factures (brouillon, émise,
  partielle, soldée, annulée), paiements numérotés `RC-NNNN`, avoirs `AV-NNNN` avec ou sans retour des marchandises,
  remboursements, bon de livraison et reçu à imprimer ; numéros `DV-`, `FA-` (attribué à l'émission, sans trou), `AV-`,
  `RC-`. Pas de TVA, pas de remise.
- Finance : dépenses et recettes (saisies à la main ou dérivées des achats reçus, des lots achetés, des factures et des
  avoirs), synthèse par activité et par catégorie, rentabilité par lot, carte « Rentabilité du mois » et graphique
  « Recettes vs dépenses » du tableau de bord, créances clients, alerte « Créance FA-… » quand l'échéance est dépassée.
- Tests : parcours de bout en bout `commerce.spec.ts` (un rôle par étape, chiffres calculés) ; captures de Clients, Ventes et
  Finance comparées à la maquette (`m_clients.png`, `m_ventes.png`, `m_finance.png`, `finance_synthese.png`, `alertes.png`,
  `rapports.png`) et vérifiées à 375 px (`facture_formulaire_375.png`, `vente_detail_375.png`, `avoir_dialogue_375.png`,
  `finance_ecritures_375.png`, `finance_synthese_375.png`) ainsi qu'à l'impression (facture, bon de livraison, reçu, avoir, devis,
  aussi pour un Comptable : `*_impression_comptable.png`) ; la page d'une facture (cinq tuiles, dont « Échéance », et la pastille
  « Échue ») est mesurée à 1440, 1024 et 375 px (`vente_detail_1440.png`, `vente_detail_1024.png`, `vente_detail_375.png`).
- Écarts assumés avec la maquette : la tuile « Total enregistrements » de Finance n'est pas 5 (les écritures dérivées des
  factures et de l'achat reçu s'ajoutent aux cinq saisies) et la liste s'ouvre sur le mois en cours (la capture règle la
  période sur octobre) ; les chiffres du tableau de bord suivent le mois civil en cours, pas ceux de la maquette ; FA-0309
  vend 12 000 œufs, donc des jours de ponte supplémentaires sont créés pour LP-2026-03 (la tuile de « Ponte & œufs » diffère) ;
  les données de référence contiennent elles-mêmes la double saisie des vaccins (l'achat reçu BC-0141 et la saisie manuelle
  « Vaccins & médicaments », 120 000 FCFA chacun) : les dépenses d'octobre valent donc 2 955 000 FCFA (et non 2 835 000) et
  l'activité « Général » −1 255 000 FCFA ; le « reste dû » d'une facture échue reste jaune comme dans la maquette.

À savoir après une mise à jour : la tranche 4 ajoute des migrations de base de données (clients, devis, factures, paiements,
avoirs, finance). Après avoir récupéré le code, lancez `npx prisma migrate deploy` dans `backend/` (ou `./scripts/dev.sh`).

Qui peut faire quoi sur les ventes et la finance :

| Action | Rôles |
|---|---|
| Créer, modifier ou supprimer un client | Commercial, Super administrateur |
| Créer, envoyer, faire accepter un devis ; créer, corriger ou supprimer un brouillon de facture | Commercial, Super administrateur |
| Émettre une facture (avec paiement comptant éventuel), encaisser, supprimer un paiement, rembourser | Commercial, Comptable, Super administrateur |
| Émettre un avoir, annuler une facture émise (sans paiement ni avoir) | Comptable, Propriétaire, Super administrateur |
| Saisir, corriger ou supprimer une dépense ou une recette manuelle ; l'attribuer à un lot | Comptable, Super administrateur |
| Lire la finance, la synthèse et la rentabilité par lot | Comptable, Propriétaire, Directeur de ferme, Auditeur, Super administrateur |
| Lire les clients, les factures, les devis et les avoirs | Commercial, Comptable, Propriétaire, Directeur de ferme, Auditeur, Super administrateur |

Les règles à connaître :

- Un brouillon (facture ou devis) ne touche à rien : ni lot, ni œufs, ni stock. L'émission d'une facture sort les animaux du
  lot (effectif), les œufs du solde d'œufs du lot et les articles du stock ; l'annulation remet tout.
- Un lot, un animal ou des œufs en délai d'attente (après un traitement) ne peuvent pas être vendus quand la date de la vente
  tombe dans la période : du jour du traitement jusqu'au dernier jour du délai, ces deux jours compris ; il n'y a pas de
  dérogation. Une vente datée avant le traitement reste possible.
- Un inventaire validé ferme le passé de l'article : une vente de cet article antérieure à l'inventaire est refusée.
- On ne peut pas vendre plus que l'effectif vivant du lot : « Effectif insuffisant ». Un lot de stock périmé est refusé à la
  vente, comme à la sortie de stock.
- Un avoir se fait par quantité de ligne, avec ou sans retour des marchandises ; il est définitif. Un animal suivi
  individuellement ne peut pas être retourné au lot ; un retour dans un lot clôturé est refusé ; des marchandises périmées ne
  reviennent pas en stock (faites un avoir sans retour). Des marchandises rendues par un avoir rentrent en stock au coût
  constaté à la date de l'avoir : une correction ou une entrée antidatée faite ensuite ne les revalorise pas. Seuls les avoirs
  avec retour réduisent la quantité vendue d'un lot (et ses kilos) ; sans retour, ils réduisent seulement les recettes.
- Annuler une facture faite à partir d'un devis rend le devis facturable de nouveau (il revient à « Accepté » s'il l'avait été,
  sinon à « Envoyé ») ; la facture annulée n'y est plus rattachée. Un devis en brouillon dont la date de validité est dépassée
  ne peut pas être envoyé (« La date de validité est dépassée »).
- L'unité d'une ligne d'article est celle de l'article lui-même : elle ne se choisit pas. Seules les lignes d'œufs ont une
  unité (plateau ou œuf) ; une unité sur une ligne de lot, d'animal ou de prestation est refusée.
- Une dépense saisie à la main et attribuée à un lot est comptée dans la colonne « Autres » de ce lot, quelle que soit sa
  catégorie (même « Aliment » ou « Santé ») : l'aliment et la santé d'un lot sont les seules consommations du stock.
- La synthèse, la liste des écritures et la rentabilité par lot partagent une même période, toujours avec les deux dates (par
  défaut, du 1er du mois à aujourd'hui) : effacer une date est refusé (« Indiquez les deux dates »). Sans dates, l'API
  répondrait pour toute la vie de la ferme ; la fiche d'un lot affiche d'ailleurs ses chiffres depuis son entrée.
- Les feuilles imprimées lisent l'identité légale (nom, adresse, NIF, RCCM), l'échéance par défaut et le nombre d'œufs par
  plateau par une route ouverte à tout utilisateur connecté, qui ne rend que ces champs : un Commercial ou un Comptable
  imprime donc une facture complète sans avoir le droit de lire les paramètres.
- L'échéance d'une facture est sa date plus 15 jours (réglage « Échéance des factures (jours) »), sauf si elle est saisie ; le formulaire
  affiche la date par défaut, et une facture échue avec un reste dû déclenche l'alerte « Créance FA-… ».
- Le « Prix d'achat » d'un lot est le total payé pour le lot (pas un prix unitaire) : il est enregistré comme une dépense
  « Animaux » à la date d'entrée du lot, et c'est le « Coût des animaux » de sa rentabilité.
- Une vente saisie à la main dans les mouvements d'effectif (événement « Vente ») reste possible mais ne crée pas de
  recette : seules les factures en créent.
- Le « coût / kg » d'un lot reste vide tant que chaque vente du lot n'a pas son poids saisi sur la facture.
- Le « reste dû » d'un client est la somme de ce qu'il doit ; ce que la ferme lui doit après un avoir sur une facture déjà payée
  s'affiche à part : « À rembourser ».
- Les écritures manuelles côtoient les écritures dérivées : saisir à la main un achat déjà reçu le compte deux fois, c'est à
  l'utilisateur d'y veiller. Une entrée de stock saisie à la main avec le motif « Achat », hors du circuit d'achat, n'arrive
  jamais en finance.
- La « Marge » de la ferme (recettes − dépenses de la période) et la « Marge du lot » de la rentabilité par lot (recettes du lot −
  ce qu'il a consommé) sont deux vues différentes : leurs sommes ne sont pas censées concorder.

Pour les développeurs : les chiffres de la finance (écritures, synthèse, rentabilité, tableau de bord) viennent d'une vue SQL,
`FinanceLedgerView`, créée par une migration et absente du schéma Prisma (rien n'y écrit). Une migration qui renomme, change
le type ou supprime une colonne lue par cette vue (achats, lots, factures, avoirs, clients, écritures) doit d'abord supprimer la
vue (`DROP VIEW`), modifier la table, puis recréer la vue avec le même texte. La convention est rappelée dans l'en-tête de
`backend/prisma/schema.prisma`, et un test (`finance-ledger.spec.ts`) relit la dernière migration qui définit la vue.

**Tranche 5 — Personnel, tâches, équipements, rapports, alertes, QR, démonstration : terminée.**

- Personnel : employés (poste, contrat, salaire, lien facultatif avec un compte utilisateur) et feuille de présence du jour. Aucun moteur de
  paie : l'aperçu « Salaires du mois » additionne les salaires mensuels des employés en poste dans le mois (sans prorata) et préremplit
  l'écriture manuelle « Salaires » du Comptable ; il avertit si une écriture existe déjà. Rien n'est enregistré automatiquement.
- Tâches : titre, responsable, échéance, heure, priorité, lot, bâtiment ou équipement concerné ; `À faire`, `En cours`, `Terminée`, et retour
  par `Rouvrir`. Récurrence (tous les jours, chaque semaine, chaque mois) : terminer une tâche crée l'occurrence suivante, sans planificateur ;
  la rouvrir la supprime si personne n'y a touché. Une photo de preuve facultative (JPEG, PNG ou WebP, 5 Mo au plus) se joint à la fin. « Mes tâches »
  filtre les tâches de l'employé lié au compte connecté.
- Équipements : couveuses, pompes, groupes, ventilateurs… avec emplacement (site ou bâtiment), état `Bon`, `À surveiller` ou `En panne`, prochaine
  maintenance, interventions préventives et correctives (coût, fournisseur, prochaine date), pannes déclarées, réforme (onglet « Réformés »), fiche
  équipement et fiche bâtiment.
- Rapports : synthèse, quotidien, hebdomadaire, mensuel, annuel, sanitaire, zootechnique ; CSV, Excel et « Imprimer / PDF ».
- Alertes : toutes les règles du cahier (mortalité, mise bas, stocks, santé, tâche en retard, maintenance due, équipement en panne, créance) ;
  chaque utilisateur peut « Masquer l'alerte » pour 7 jours (réglable) ou jusqu'à ce qu'elle s'aggrave, et « Afficher les alertes masquées ».
- QR : lot, animal, bâtiment, article de stock (médicaments compris), équipement ; fenêtre « QR code », planche A4 d'étiquettes, page `/q/{type}/{id}`
  et page `/scan` (caméra du navigateur si elle sait lire les QR, sinon l'appareil photo du téléphone).
- Exports CSV et Excel de toutes les listes ; démonstration « Ferme Kpalimé » (voir plus haut) ; mode d'emploi `docs/guide-utilisateur.md`.
- Tests : `operations.spec.ts` (parcours décrit plus haut) et captures `m_taches.png`, `m_equipements.png`, `personnel.png`, `alertes.png`,
  `alertes_masquee.png`, `home.png`, `rapports.png`, `rapport_mensuel_impression.png`, `audit.png`, `batiment_detail_1440.png`, `etiquettes_qr.png`,
  `taches_375.png`, `equipement_detail_375.png` et `qr_dialogue_375.png` dans `docs/reference/built/`.
- Écarts assumés avec la maquette : les tâches s'affichent par échéance puis priorité (la maquette suit l'ordre de saisie) et portent des icônes
  d'avancement (Démarrer, Terminer, Rouvrir) ; pas d'icône QR sur les tâches (ni sur les employés ni sur les documents) ; la page Équipements a les
  onglets « Interventions » et « Réformés », des icônes d'action et l'icône QR ; les alertes sont classées par niveau (urgentes d'abord) puis par
  règle, avec une icône « Masquer » ; « Vaccination à venir » remplace « Vaccination en retard » ; la page Rapports a un bouton « Excel » en plus de
  « CSV » et « Imprimer / PDF » ; pas de bouton « Réinitialiser les données » sur le journal d'audit (il est immuable ; la remise à zéro des
  données de démonstration est la commande `npm run demo:reset`, en développement) ; la maintenance de la « Pompe forage » est datée dans le futur
  (la date de la maquette est passée) ; « Rentabilité du mois » suit le mois courant.

À savoir après une mise à jour : la tranche 5 ajoute des migrations (personnel, tâches, équipements, acquittement des alertes). Après avoir
récupéré le code, lancez `npx prisma migrate deploy` dans `backend/` (ou `./scripts/dev.sh`). Pensez au dossier des fichiers téléversés
(`UPLOAD_DIR`, volume `api-uploads`) dans vos sauvegardes.

### Qui peut faire quoi : personnel, tâches, équipements, rapports, QR, alertes

| Action | Rôles |
|---|---|
| Créer, modifier, supprimer un employé ; voir les salaires | Directeur, Super admin (salaires : tout rôle qui lit la finance) |
| Saisir ou corriger la feuille de présence | Responsable avicole, Responsable porcin, Directeur, Super admin |
| Lire les employés et les présences | Propriétaire, Comptable, Auditeur et les rôles ci-dessus |
| Créer, modifier, supprimer une tâche | Responsable avicole, Responsable porcin, Directeur, Super admin |
| Démarrer, terminer, rouvrir une tâche | Les rôles ci-dessus ; Agent, Vétérinaire, Responsable stock, Magasinier : **seulement leurs propres tâches** (employé lié à leur compte) |
| Voir les tâches | Tous ces rôles et Propriétaire, Auditeur ; pas le Commercial ni le Comptable |
| Déclarer une panne | Agent, Responsable avicole, Responsable porcin, Directeur, Super admin |
| Créer ou modifier un équipement, enregistrer une intervention, réformer | Directeur, Super admin |
| Lire les équipements | Les rôles ci-dessus, Propriétaire, Auditeur |
| Lire les rapports | Tous sauf l'Agent et le Magasinier ; chaque section selon le droit de lecture du module (la finance exige `finance:read`) |
| Masquer une alerte | Tout utilisateur, pour lui seul |
| Ouvrir un QR | Tout utilisateur connecté qui lit le module de l'objet et qui est affecté à la ferme (sinon : « QR code inconnu ou inaccessible ») |

### Droits par rôle et par module

`L` lire, `C` saisir (opérations du jour : mortalité, ponte, distribution, présence, panne…), `M` modifier les fiches de référence (lots, articles,
équipements, employés…), `S` supprimer, `V` valider (achats, avoirs, annulation d'une facture). `·` : aucun droit. Une saisie du jour se corrige
ou se supprime avec le droit `C` ; une fiche de référence demande `M`. Ce tableau est celui du code (`backend/src/access/permissions.ts`, fonction
`permissionsFor`).

| Module | Super admin | Propriétaire | Directeur | Resp. avicole | Resp. porcin | Vétérinaire | Resp. stock | Comptable | Commercial | Agent | Magasinier | Auditeur |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tableau de bord | LCMSV | L | L | L | L | L | L | L | L | L | L | L |
| Alertes | LCMSV | L | L | L | L | L | L | L | L | L | L | L |
| Rapports | LCMSV | LCMSV | L | L | L | L | L | L | L | · | · | L |
| Bâtiments | LCMSV | L | LCMSV | L | L | L | · | · | · | L | · | L |
| Fermes & sites | LCMSV | L | · | · | · | · | · | · | · | · | · | L |
| Utilisateurs | LCMSV | L | · | · | · | · | · | · | · | · | · | L |
| Paramètres | LCMSV | L | · | · | · | · | · | · | · | · | · | L |
| Lots avicoles | LCMSV | L | LCMSV | LCMS | · | L | · | · | L | LC | · | L |
| Ponte & œufs | LCMSV | L | LCMSV | LCMS | · | L | · | · | · | LC | · | L |
| Cheptel porcin | LCMSV | L | LCMSV | · | LCMS | L | · | · | L | LC | · | L |
| Reproduction | LCMSV | L | LCMSV | · | LCMS | L | · | · | · | · | · | L |
| Alimentation & eau | LCMSV | L | LCMSV | LCMS | LCMS | L | L | · | · | LC | · | L |
| Santé & biosécurité | LCMSV | L | LCMSV | LCMS | LCMS | LCMS | · | · | · | LC | · | L |
| Stocks | LCMSV | L | LCMSV | L | L | L | LCMSV | · | L | · | LC | L |
| Fournisseurs | LCMSV | L | LCMSV | · | · | · | LCMS | L | · | · | L | L |
| Achats | LCMSV | LV | LCMSV | · | · | · | LCM | L | · | · | LM | L |
| Clients | LCMSV | L | L | · | · | · | · | L | LCMS | · | · | L |
| Ventes | LCMSV | LV | L | · | · | · | · | LMV | LCMS | · | · | L |
| Finance (dépenses & recettes) | LCMSV | L | L | · | · | · | · | LCMS | · | · | · | L |
| Tâches | LCMSV | L | LCMSV | LCMS | LCMS | LM | LM | · | · | LM | LM | L |
| Équipements | LCMSV | L | LCMSV | LC | LC | · | · | · | · | LC | · | L |
| Personnel (employés, présences) | LCMSV | L | LCMSV | LC | LC | · | · | L | · | · | · | L |
| Journal d'audit | L | L | L | · | · | · | · | · | · | · | · | L |

Seul le Super administrateur écrit dans Fermes & sites, Utilisateurs et Paramètres ; le Propriétaire et l'Auditeur y lisent. Le journal d'audit est
en lecture seule pour tous.

### Règles à connaître (tranche 5)

- **Argent et `finance:read`** : le salaire d'un employé, le coût d'une intervention, le coût de maintenance d'un équipement, le coût d'une
  distribution d'aliment, le prix d'achat d'un lot et toute section financière d'un rapport ou d'un export n'existent que pour un rôle qui lit
  la finance (Directeur, Propriétaire, Comptable, Auditeur, Super admin). Pour les autres, l'API répond `null` : la colonne ou la carte n'apparaît pas.
- **Dépense d'entretien** : le coût d'une intervention devient automatiquement une dépense « Entretien » dans Dépenses & recettes
  (« Maintenance {équipement} — {description} »), activité du bâtiment de l'équipement (Général sinon). Elle n'est pas modifiable à cet endroit : corrigez
  l'intervention. Ne la saisissez pas à la main (double compte). Ce n'est jamais un coût de lot.
- **Équipement en panne** : on ne passe `En panne` qu'en déclarant une panne, et on n'en sort que par une intervention corrective qui la répare. Un
  équipement ayant une tâche ouverte ne peut pas être réformé ; un équipement avec historique se réforme, ne se supprime pas.
- **Maintenance due** : quand la prochaine maintenance est échue (ou arrive dans le nombre de jours du réglage « Préavis de maintenance (jours) »,
  0 par défaut) ; pas d'alerte « Maintenance due » pour un équipement en panne. La prochaine maintenance est celle de la dernière intervention, sinon sa
  date plus l'intervalle de l'équipement, sinon la date saisie à la création.
- **Alertes** : les urgentes d'abord, puis par règle (stocks, production, santé, tâches, équipements, ventes), puis par date. Masquer une alerte la cache
  pour le seul utilisateur, pendant « Masquage des alertes (jours) » (7 par défaut) ou jusqu'à ce que son niveau empire. La pastille et le tableau de
  bord comptent les alertes visibles de l'utilisateur ; les rapports comptent toutes les alertes ouvertes (le chiffre d'un rapport peut donc dépasser la pastille).
- **Rapports** : semaine du lundi au dimanche, mois et année civils, période coupée à aujourd'hui ; les effectifs sont ceux « au » dernier jour,
  les niveaux de stock sont ceux d'aujourd'hui (il n'y a pas d'historique de stock) et le rapport le dit. Pas de validation de rapport : ils sont calculés.
  Un rapport sans aucune section visible pour le rôle est refusé (403) ; le sanitaire et le zootechnique n'affichent que les sections permises.
- **Exports** : CSV avec point-virgule, **virgule décimale** (Excel en français lit les nombres) et protection contre l'injection de formules ; Excel
  avec des nombres natifs. Les rapports se téléchargent sous le nom `rapport-{type}-{début}_{fin}.csv` ou `.xlsx`.
- **QR** : un QR encode seulement `{APP_URL}/q/{type}/{id}` ; il faut un compte, l'affectation à la ferme et le droit de lecture du module. Le même
  « QR code inconnu ou inaccessible » répond pour un objet absent et pour un objet interdit. Planche A4 de 3 × 8 étiquettes de 63,5 × 33,9 mm, 60 étiquettes
  au plus par impression ; d'autres formats d'étiquettes demandent d'ajuster l'échelle d'impression. Pas de QR sur les tâches, les employés ni les
  documents commerciaux.
- **Tâches** : la photo de preuve se lit avec le droit de lecture des tâches de la ferme (jamais par un lien public). Une tâche terminée ne se modifie
  ni ne se supprime : rouvrez-la d'abord. Un employé « parti » ou une date d'embauche qui laisserait une tâche ouverte hors de ses dates est refusé.

## Limites connues et décisions ouvertes

Ce qui n'est **pas** fait, par choix de périmètre :

- Application mobile native, mode hors ligne et synchronisation ; prévisions par IA et capteurs (phases ultérieures du cahier).
- Notifications par e-mail, SMS, WhatsApp ou push ; rapports planifiés ou envoyés par courriel.
- Moteur de paie (impôts, CNSS, bulletins, prorata selon les présences), pointeuse, soldes de congés, géolocalisation.
- Module général de pièces jointes (seule la photo de preuve d'une tâche existe), PDF généré par le serveur (les feuilles s'impriment depuis le
  navigateur), lecture des QR par la caméra sur les navigateurs sans `BarcodeDetector` (le lien reste utilisable avec l'appareil photo du téléphone).
- Amortissement des équipements, pièces détachées en stock liées aux interventions, plans de maintenance multiples, ordres de travail.
- Rôles modifiables ou personnalisés, plusieurs langues ou devises, sauvegardes automatiques (voir [Sauvegarde](#sauvegarde-et-restauration)).
- Avances, listes de prix, soldes de crédit des clients.
- Ce qui est vérifié ou non : le démon Docker n'était pas disponible, donc les images Docker n'ont pas été construites ici (voir l'avertissement de la
  section Docker) ; `scripts/dev.sh` n'a pas été essayé sur un vrai Mac, ni les étapes manuelles Windows ; Neon et Supabase n'ont pas été essayés.

Limites décidées (comportements connus, documentés plutôt que corrigés) :

- Les coûts unitaires et la valeur du stock restent visibles pour tout rôle qui lit les stocks (Magasinier, Commercial, Responsables, Vétérinaire) :
  seuls les coûts d'aliment par lot, le prix d'achat d'un lot, les salaires et les coûts de maintenance sont réservés à `finance:read`.
- L'activité d'une dépense d'entretien passée suit le **bâtiment actuel** de l'équipement : déplacer un équipement déplace ses anciennes dépenses.
- Les actes de santé annulés sont exclus des comptes « en retard » d'une période passée (l'annulation n'est pas datée).
- Un acte de santé saisi après coup avec une date antérieure à une vente déjà facturée ne signale pas cette vente (le délai d'attente bloque les
  ventes futures seulement).
- L'Agent d'élevage garde tous les droits de saisie du jour sur la Santé, y compris annuler un acte planifié par le vétérinaire.
- Une série de tâches récurrentes abandonnée ne se termine qu'en mettant sa dernière occurrence sur « Aucune » récurrence ; les tâches récurrentes
  ne se créent pas toutes seules (c'est la fin d'une occurrence qui crée la suivante).
- Le paiement des fournisseurs reste réservé au Directeur et au Propriétaire (le Comptable lit les achats).
- « Mes tâches » n'existe que pour un compte lié à un employé : un employé journalier sans compte est assignable, mais c'est un responsable
  qui avance ses tâches à sa place.
- Les décisions ouvertes restantes des tranches 1 à 5 sont reprises dans le fichier de report du projet
  (`docs/superpowers/plans/2026-11-17-slice-5-carryover.md`, rédigé à la clôture).

