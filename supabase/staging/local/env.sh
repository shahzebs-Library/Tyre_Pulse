#!/usr/bin/env bash
# Shared settings for the local staging cluster. Sourced by start.sh, stop.sh, reset.sh and the test runner.
# Nothing here points at production and no key or password is stored in the repository.
set -euo pipefail
STAGING_ROOT="${STAGING_ROOT:-/tmp/claude-0/-home-user-Tyre-Pulse/f5f47d6f-b333-5be3-b15d-8e39da2bbfea/scratchpad/staging-pg}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
export STAGING_PORT="${STAGING_PORT:-54329}"
export STAGING_DB="${STAGING_DB:-tyrepulse_staging}"
export PGDATA_DIR="$STAGING_ROOT/data"
export STAGING_SOCK="$STAGING_ROOT/sock"
export STAGING_LOG="$STAGING_ROOT/postgres.log"
export STAGING_DSN="host=127.0.0.1 port=$STAGING_PORT dbname=$STAGING_DB user=postgres"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export STAGING_DIR="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$STAGING_DIR/../.." && pwd)"
case "$STAGING_ROOT/" in
  "$REPO_ROOT"/*) echo "Refusing: the cluster must live outside the repository" >&2; exit 1;;
esac
# PostgreSQL refuses to run as root. When root, run server binaries inside a user namespace that maps
# root to the postgres uid (no files change owner, nothing outside the scratch folder is touched).
as_pg() {
  if [ "$(id -u)" = "0" ]; then
    local u g; u="$(id -u postgres 2>/dev/null || echo 102)"; g="$(id -g postgres 2>/dev/null || echo 104)"
    unshare --user --map-user="$u" --map-group="$g" "$@"
  else "$@"; fi
}
psqls() { psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$STAGING_PORT" -U postgres "$@"; }
# A Python that has psycopg2 (pip install psycopg2-binary, or apt install python3-psycopg2).
pick_python() {
  for p in "${STAGING_PYTHON:-}" python3 /usr/bin/python3; do
    [ -n "$p" ] && command -v "$p" >/dev/null 2>&1 && "$p" -c 'import psycopg2' 2>/dev/null && { echo "$p"; return; }
  done
  echo "No Python with psycopg2 found (pip install psycopg2-binary)" >&2; exit 1
}
