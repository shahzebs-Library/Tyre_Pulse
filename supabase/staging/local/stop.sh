#!/usr/bin/env bash
# Stop the local staging cluster. Data stays on disk until reset.sh.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
if [ -s "$PGDATA_DIR/postmaster.pid" ]; then
  as_pg "$PGBIN/pg_ctl" -D "$PGDATA_DIR" -m fast -w stop >/dev/null 2>&1 || kill -INT "$(head -1 "$PGDATA_DIR/postmaster.pid")" 2>/dev/null || true
fi
echo "Staging cluster stopped"
