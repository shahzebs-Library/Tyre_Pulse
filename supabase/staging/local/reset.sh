#!/usr/bin/env bash
# Destroy the local staging cluster completely and rebuild it from prereq + baseline + seed.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
"$STAGING_DIR/local/stop.sh" >/dev/null 2>&1 || true
case "$PGDATA_DIR" in */staging-pg/data) rm -rf "$PGDATA_DIR" "$STAGING_SOCK" "$STAGING_LOG";; *) echo "Unexpected data dir, not removing: $PGDATA_DIR" >&2; exit 1;; esac
exec "$STAGING_DIR/local/start.sh"
