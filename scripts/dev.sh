#!/usr/bin/env bash
# One-command development start: database, migrations, seed, API (3000) and web (5173).
#   SEED_ADMIN_EMAIL=moi@exemple.com SEED_ADMIN_PASSWORD='un mot de passe long' ./scripts/dev.sh
# Never overwrites an existing backend/.env. Ctrl-C stops both servers.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
ENV_FILE="$BACKEND/.env"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERREUR / ERROR: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null || die "Node.js 22 est requis / Node.js 22 is required (https://nodejs.org)."
command -v npm >/dev/null || die "npm est requis / npm is required."

# --- backend/.env: created once, with fresh random secrets -----------------------------
if [ ! -f "$ENV_FILE" ]; then
  say "Création de backend/.env (secrets aléatoires) / Creating backend/.env with random secrets"
  ENV_FILE="$ENV_FILE" EXAMPLE="$BACKEND/.env.example" node -e '
    const { randomBytes } = require("crypto");
    const { readFileSync, writeFileSync } = require("fs");
    const out = readFileSync(process.env.EXAMPLE, "utf8")
      .replace(/^JWT_SECRET=.*$/m, () => `JWT_SECRET="${randomBytes(48).toString("base64")}"`)
      .replace(/^TOTP_ENC_KEY=.*$/m, () => `TOTP_ENC_KEY="${randomBytes(32).toString("base64")}"`);
    writeFileSync(process.env.ENV_FILE, out, { mode: 0o600, flag: "wx" });
  '
fi

# Value of KEY from backend/.env (quotes stripped); empty if absent.
env_value() {
  { grep -E "^$1=" "$ENV_FILE" || true; } | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

# --- first administrator ---------------------------------------------------------------
SEED_ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-$(env_value SEED_ADMIN_EMAIL)}"
SEED_ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-$(env_value SEED_ADMIN_PASSWORD)}"
if [ -z "$SEED_ADMIN_EMAIL" ] || [ -z "$SEED_ADMIN_PASSWORD" ]; then
  die "SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD (10 caractères minimum) sont requis.
  Définissez-les dans l'environnement ou dans backend/.env, par exemple :
    SEED_ADMIN_EMAIL=moi@exemple.com SEED_ADMIN_PASSWORD='un mot de passe long' ./scripts/dev.sh
  SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min. 10 characters) are required: set them in the
  environment or in backend/.env (see the example above)."
fi

# --- dependencies ----------------------------------------------------------------------
for dir in "$BACKEND" "$FRONTEND"; do
  if [ ! -d "$dir/node_modules" ]; then
    say "npm install ($(basename "$dir"))"
    (cd "$dir" && npm install)
  fi
done

# --- database --------------------------------------------------------------------------
DATABASE_URL="${DATABASE_URL:-$(env_value DATABASE_URL)}"
if [ -z "$DATABASE_URL" ] || ! DATABASE_URL="$DATABASE_URL" node -e 'new URL(process.env.DATABASE_URL)' 2>/dev/null; then
  die "DATABASE_URL est vide ou invalide dans backend/.env / DATABASE_URL is empty or invalid.
  Format attendu / Expected format :
    DATABASE_URL=\"postgresql://agripilot:agripilot@localhost:5432/agripilot\"
  (voir README, section « Base de données »)"
fi
if command -v pg_ctlcluster >/dev/null 2>&1; then
  say "Démarrage de PostgreSQL local / Starting local PostgreSQL (scripts/dev-db.sh)"
  "$ROOT/scripts/dev-db.sh"
else
  say "Vérification de la base de données / Checking the database"
  if ! DATABASE_URL="$DATABASE_URL" node -e '
    const u = new URL(process.env.DATABASE_URL);
    const s = require("net").connect({ host: u.hostname, port: Number(u.port || 5432), timeout: 3000 });
    s.on("connect", () => { s.end(); process.exit(0); });
    s.on("error", () => process.exit(1));
    s.on("timeout", () => process.exit(1));
  '; then
    die "PostgreSQL est injoignable à l'adresse de DATABASE_URL (backend/.env) / PostgreSQL is not reachable.
  Démarrez-le avec Docker / Start one with Docker:
    docker run -d --name agripilot-db -p 5432:5432 \\
      -e POSTGRES_USER=agripilot -e POSTGRES_PASSWORD=agripilot -e POSTGRES_DB=agripilot \\
      -v agripilot-db:/var/lib/postgresql/data postgres:16
  Port 5432 déjà pris ? Utilisez -p 5433:5432 et mettez 5433 dans DATABASE_URL.
  Autres options (Postgres.app, Homebrew, Windows, base hébergée) : README, section « Base de données ».
  Puis relancez ce script / then run this script again."
  fi
fi

say "Migrations / Migrations"
if ! (cd "$BACKEND" && npx prisma migrate deploy); then
  die "Les migrations ont échoué / Migrations failed.
  Cause probable : le rôle, le mot de passe ou la base de DATABASE_URL ne correspondent pas au serveur
  PostgreSQL (erreur « Authentication failed » / « credentials ... are not valid » ou « database does not exist »).
  Corrigez avec psql (adaptez le mot de passe à celui de DATABASE_URL) :
    psql postgres -c \"CREATE ROLE agripilot WITH LOGIN PASSWORD 'agripilot' CREATEDB;\"
    psql postgres -c \"CREATE DATABASE agripilot OWNER agripilot;\"
  Le rôle existe déjà avec un autre mot de passe ?
    psql postgres -c \"ALTER ROLE agripilot WITH LOGIN PASSWORD 'agripilot';\"
  Détails et autres cas (Docker, Windows, base hébergée) : README, sections « Base de données » et « Dépannage »."
fi
say "Administrateur initial / Seeding the first administrator"
(cd "$BACKEND" && SEED_ADMIN_EMAIL="$SEED_ADMIN_EMAIL" SEED_ADMIN_PASSWORD="$SEED_ADMIN_PASSWORD" npx prisma db seed)

# --- servers ---------------------------------------------------------------------------
set -m # each background job gets its own process group, so Ctrl-C can stop whole trees
API_PID=""
WEB_PID=""
stop() {
  trap - INT TERM EXIT
  printf '\n==> Arrêt / Stopping\n'
  for pid in $API_PID $WEB_PID; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap stop INT TERM EXIT

say "API http://localhost:3000 (docs: /api/docs) et web http://localhost:5173"
(cd "$BACKEND" && exec npm run start:dev) &
API_PID=$!
(cd "$FRONTEND" && exec npm run dev) &
WEB_PID=$!
echo "Ouvrez / Open http://localhost:5173 — Ctrl-C pour arrêter / to stop."
# Return as soon as either server dies (bash 3.2 compatible: no `wait -n`); the EXIT trap stops the other.
while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do sleep 1; done
