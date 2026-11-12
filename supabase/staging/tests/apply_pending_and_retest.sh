#!/usr/bin/env bash
# Copy the local staging database, apply the drafted fixes from supabase/pending_migrations
# (timestamp 20261113100000 and later) to the COPY in order, then rerun the isolation tests on it.
# The original staging database stays untouched as the before-state. Nothing here touches production.
source "$(dirname "${BASH_SOURCE[0]}")/../local/env.sh"
PY="$(pick_python)"
AFTER_DB="${STAGING_DB}_after"
PENDING="$STAGING_DIR/../pending_migrations"
OUT="${1:-$STAGING_ROOT/pending_apply_report.txt}"
psqls -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$STAGING_DB','$AFTER_DB') and pid <> pg_backend_pid()" >/dev/null
psqls -d postgres -c "drop database if exists $AFTER_DB"
psqls -d postgres -c "create database $AFTER_DB template $STAGING_DB"
: > "$OUT"
ok=0; bad=0
for f in $(ls "$PENDING"/*.sql | sort); do
  b="$(basename "$f")"
  [ "${b%%_*}" -ge 20261113100000 ] 2>/dev/null || continue
  if err="$(psql -X -q -v ON_ERROR_STOP=1 -1 -h 127.0.0.1 -p "$STAGING_PORT" -U postgres -d "$AFTER_DB" -f "$f" 2>&1 >/dev/null)"; then
    echo "APPLIED  $b" >> "$OUT"; ok=$((ok+1))
  else
    echo "FAILED   $b :: $(echo "$err" | grep -m1 -E 'ERROR|FATAL' | cut -c1-260)" >> "$OUT"; bad=$((bad+1))
  fi
done
echo "pending migrations applied to $AFTER_DB: $ok ok, $bad failed (details: $OUT)"
"$PY" "$STAGING_DIR/tests/run_tests.py" --dsn "host=127.0.0.1 port=$STAGING_PORT dbname=$AFTER_DB user=postgres" \
      --label after --json "$STAGING_ROOT/tests_after.json" || true
