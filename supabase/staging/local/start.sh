#!/usr/bin/env bash
# Start (and on first run create) the throwaway local staging cluster, then load prerequisites,
# the baseline and (unless SKIP_SEED=1) the synthetic seed.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
mkdir -p "$STAGING_ROOT" "$STAGING_SOCK"
fresh=0
if [ ! -s "$PGDATA_DIR/PG_VERSION" ]; then
  as_pg "$PGBIN/initdb" -D "$PGDATA_DIR" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
  cat >> "$PGDATA_DIR/postgresql.conf" <<CONF
port = $STAGING_PORT
listen_addresses = '127.0.0.1'
unix_socket_directories = ''
fsync = off
synchronous_commit = off
full_page_writes = off
max_connections = 40
shared_buffers = 128MB
CONF
  fresh=1
fi
if ! as_pg "$PGBIN/pg_ctl" -D "$PGDATA_DIR" status >/dev/null 2>&1; then
  as_pg "$PGBIN/pg_ctl" -D "$PGDATA_DIR" -l "$STAGING_LOG" -o "-c unix_socket_directories=" -w start >/dev/null
fi
if [ "$fresh" = "1" ] || ! psqls -d postgres -Atc "select 1 from pg_database where datname='$STAGING_DB'" | grep -q 1; then
  psqls -d postgres -c "create database $STAGING_DB"
  PY="$(pick_python)"
  psqls -d "$STAGING_DB" -v DBNAME="$STAGING_DB" -f "$STAGING_DIR/local/prereq.sql"
  "$PY" "$STAGING_DIR/tools/load_baseline.py" --dsn "$STAGING_DSN" --baseline "$STAGING_DIR/baseline" \
        --report "$STAGING_ROOT/load_report.json"
  "$PY" "$STAGING_DIR/tools/verify_baseline.py" --dsn "$STAGING_DSN" --baseline "$STAGING_DIR/baseline" \
        --report "$STAGING_ROOT/verify_report.json"
  if [ "${SKIP_SEED:-0}" != "1" ] && [ -f "$STAGING_DIR/seed/run_seed.sh" ]; then
    "$STAGING_DIR/seed/run_seed.sh"
  fi
fi
echo "Staging database ready: $STAGING_DSN"
