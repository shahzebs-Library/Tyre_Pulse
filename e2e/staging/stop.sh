#!/usr/bin/env bash
# Stop PostgREST, the gateway and the static web server. The database copy is kept.
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
for n in postgrest gateway web; do
  f="$E2E_RUN/$n.pid"
  if [ -f "$f" ]; then kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; fi
done
echo "stopped"
