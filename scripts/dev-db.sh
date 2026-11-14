#!/usr/bin/env bash
# Starts the local PostgreSQL 16 cluster and creates the AgriPilot role and databases. Idempotent.
set -euo pipefail

if ! pg_isready -q -h localhost -p 5432; then
  pg_ctlcluster 16 main start
  for _ in $(seq 1 30); do
    pg_isready -q -h localhost -p 5432 && break
    sleep 1
  done
fi
pg_isready -h localhost -p 5432

psql_admin() { su postgres -c "psql -v ON_ERROR_STOP=1 -tA $*"; }

if [ "$(psql_admin "-c \"SELECT 1 FROM pg_roles WHERE rolname='agripilot'\"")" != "1" ]; then
  psql_admin "-c \"CREATE ROLE agripilot WITH LOGIN SUPERUSER PASSWORD 'agripilot'\""
fi
for db in agripilot agripilot_test; do
  if [ "$(psql_admin "-c \"SELECT 1 FROM pg_database WHERE datname='$db'\"")" != "1" ]; then
    psql_admin "-c \"CREATE DATABASE $db OWNER agripilot\""
  fi
done
echo "Databases ready: agripilot, agripilot_test"
