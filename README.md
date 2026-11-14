# AgriPilot — Ferme avicole & porcine

AgriPilot est une application web de gestion d'exploitation agricole (élevage avicole et porcin) :
suivi des bâtiments, des lots, des stocks, des ventes et de la rentabilité, avec plusieurs fermes,
douze rôles utilisateurs, double authentification et journal d'audit. L'interface est en français,
les montants en FCFA.

- `backend/` : API REST NestJS + Prisma 7 + PostgreSQL 16 (préfixe `/api`, documentation Swagger sur `/api/docs`).
- `frontend/` : application monopage React 19 + Vite + Tailwind 4.

> English readers: this is a farm-management web app (NestJS API + React SPA). The sections below are in French;
> commands are copy-paste ready. Slice 1 (foundation) is complete.

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
  vraie adresse IP du client derrière nginx.
- Pas de caractères `@ : / ?` dans `POSTGRES_PASSWORD` (il est inséré dans l'URL de connexion).
- Volumes : `db-data` (base) et `api-uploads` (fichiers téléversés, `/app/uploads`).
- Commandes utiles : `docker compose logs -f api`, `docker compose down` (conserve les volumes).

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
| `TRUST_PROXY` | non | Nombre de proxys (`1`), `true`… derrière nginx, pour la limitation de débit |
| `SEED_ADMIN_EMAIL` | pour le seed | E-mail de l'administrateur initial (utilisé par `prisma db seed`) |
| `SEED_ADMIN_PASSWORD` | pour le seed | Mot de passe initial, 10 caractères minimum |

### `.env` à la racine (Docker ; modèle : `.env.example`)

| Variable | Obligatoire | Rôle |
|---|---|---|
| `POSTGRES_PASSWORD` | oui | Mot de passe du rôle PostgreSQL `agripilot` |
| `JWT_SECRET` | oui | Voir ci-dessus |
| `TOTP_ENC_KEY` | oui | Voir ci-dessus |
| `WEB_ORIGIN` | oui | Adresse publique de l'application, ex. `http://localhost:8080` |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | pour le seed | Utilisés uniquement par `docker compose run --rm api npx prisma db seed` |

### Autres

| Variable | Où | Rôle |
|---|---|---|
| `VITE_API_URL` | build du frontend | Préfixe de l'API (`/api` par défaut) |
| `VITE_API_TARGET` | `vite` (dev) | Cible du proxy `/api` (`http://localhost:3000` par défaut) |
| `E2E_CHROMIUM_PATH` | tests e2e | Chemin d'un Chromium à utiliser à la place de celui de Playwright |

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

`npm run e2e` n'utilise jamais la base de développement : il réinitialise la base `agripilot_e2e`
(migrations + seed de comptes jetables), compile et lance l'API sur le port 3100 (avec `NODE_ENV=test`, ce qui
désactive la limitation de débit de connexion) et Vite sur le port 5273, exécute les scénarios Playwright, puis
arrête les serveurs. Il régénère aussi les captures de `docs/reference/built/`. Il requiert le paquet
`playwright` (installation globale ou locale), Chromium et **Node 22.18 ou plus récent** (exécution directe du TypeScript) ; `E2E_CHROMIUM_PATH` permet d'en indiquer un.
Les scénarios sont écrits avec `node:test` et `playwright` (pas `@playwright/test`).

Scénarios : connexion et 2FA obligatoire (`auth.spec.ts`), site et bâtiments, droits de l'auditeur et
journal d'audit (`batiments.spec.ts`), comparaison de rendu avec la référence et responsive mobile
(`visual.spec.ts`). `npm run e2e -- --serve` laisse seulement les serveurs e2e démarrés.

## Sauvegarde et restauration

La base PostgreSQL contient toutes les données ; sauvegardez-la régulièrement, avec `TOTP_ENC_KEY`.

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
docker run --rm -v gestiondeferme_api-uploads:/data -v "$PWD":/backup alpine tar czf /backup/uploads.tgz -C /data .
```

Le nom du volume est préfixé par le nom du dossier du projet (`docker volume ls` pour le vérifier).
Testez régulièrement une restauration sur une base de test.

## Structure du dépôt

```
backend/            API NestJS (src/), schéma et migrations Prisma (prisma/), tests d'intégration (test/)
  src/access/         rôles, permissions, garde d'accès, périmètre par ferme (en-tête X-Farm-Id)
  src/auth/           connexion, jetons, 2FA TOTP, codes de secours
  src/admin/          fermes, sites, bâtiments, zones, utilisateurs, paramètres
  src/audit/          journal d'audit
  src/listing/        pagination, tri, export CSV/XLSX
  src/dashboard/      tableau de bord et alertes
  Dockerfile
frontend/           application React (src/), nginx.conf, Dockerfile
  e2e/                tests de bout en bout Playwright et leur lanceur (run.ts)
scripts/            dev.sh (tout démarrer), dev-db.sh (PostgreSQL local Debian)
docs/
  reference/          captures de référence (screens/), textes et styles de la maquette
  reference/built/    captures de CETTE version, régénérées par `npm run e2e`
  superpowers/        spécification et plan de livraison
docker-compose.yml  db + api + web
.env.example        variables du démarrage Docker
```

`docs/reference/` contient les captures de la maquette d'origine ; `docs/reference/built/` contient les
captures de l'application construite, à comparer côte à côte (`home.png`, `m_batiments.png`, `shell.png`).

## État d'avancement

Livraison en cinq tranches ; chacune se termine par une application qui tourne et est testée.

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

**À venir**

2. Production : lots avicoles, pesées, ponte, incubation, cheptel porcin, reproduction, alimentation et eau.
3. Santé et biosécurité, stocks et inventaires, fournisseurs et achats.
4. Clients et ventes (devis → paiement), finance et rentabilité.
5. Personnel et tâches, équipements et maintenance, rapports, alertes, QR, exports, jeu de données de
   démonstration (« Ferme Kpalimé »), documentation.

Les modules des tranches 2 à 5 apparaissent dans le menu avec la mention « Module en cours de construction » tant qu'ils
ne sont pas livrés.
