#!/usr/bin/env bash
# Rebuilds a throwaway Postgres database, applies the Supabase stub + both migrations, runs the behaviour tests.
#
# Either point it at an existing scratch server:   PGHOST=... PGPORT=... PGUSER=postgres tests/sql/run.sh
# or let it start its own (needs postgres binaries and root):  SCRATCH_PG_DIR=/some/dir tests/sql/run.sh
#
# NEVER point this at a real Supabase project: it creates roles and drops the nova_test database.
set -euo pipefail
cd "$(dirname "$0")/../.."

STARTED=""
if [[ -n "${SCRATCH_PG_DIR:-}" ]]; then
  BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
  mkdir -p "$SCRATCH_PG_DIR"; chown postgres:postgres "$SCRATCH_PG_DIR"
  if [[ ! -d "$SCRATCH_PG_DIR/data" ]]; then runuser -u postgres -- "$BIN/initdb" -D "$SCRATCH_PG_DIR/data" -A trust >/dev/null; fi
  rm -f "$SCRATCH_PG_DIR/data/postmaster.pid"
  runuser -u postgres -- "$BIN/pg_ctl" -D "$SCRATCH_PG_DIR/data" -o "-p 54329 -k $SCRATCH_PG_DIR -c listen_addresses=''" -l "$SCRATCH_PG_DIR/log" -w start >/dev/null
  STARTED=1
  export PGHOST="$SCRATCH_PG_DIR" PGPORT=54329 PGUSER=postgres
  trap 'runuser -u postgres -- "$BIN/pg_ctl" -D "$SCRATCH_PG_DIR/data" -m fast stop >/dev/null 2>&1 || true' EXIT
fi

P="psql -q -v ON_ERROR_STOP=1"
$P -d postgres -c "drop database if exists nova_test" >/dev/null 2>&1
$P -d postgres -c "drop role if exists anon" -c "drop role if exists authenticated" -c "drop role if exists service_role" >/dev/null 2>&1 || true
$P -d postgres -c "create database nova_test" >/dev/null

for f in tests/sql/00_supabase_stub.sql supabase/migrations/0001_nova_foundation.PROPOSED.sql supabase/migrations/0002_nova_features.PROPOSED.sql supabase/migrations/0003_nova_memecoin_social.PROPOSED.sql supabase/migrations/0004_nova_media_storage.PROPOSED.sql supabase/migrations/0005_nova_trader_watch.PROPOSED.sql; do
  if ! $P -d nova_test -f "$f" >/dev/null 2>"/tmp/nova_sql_err.$$"; then echo "FAILED to apply $f"; cat "/tmp/nova_sql_err.$$"; rm -f "/tmp/nova_sql_err.$$"; exit 1; fi
done
rm -f "/tmp/nova_sql_err.$$"
echo "migrations applied"
for t in tests/sql/10_rls_tests.sql tests/sql/20_memecoin_tests.sql; do
  echo "--- $t"
  psql -q -d nova_test -f "$t" 2>&1 | sed -n '/===== RESULTS/,$p'
done
