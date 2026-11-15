#!/usr/bin/env bash
# Stop the stored-PDF storage test stack (only the processes this stack started).
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
for n in web gateway postgrest storage; do
  f="$PDF_E2E_RUN/$n.pid"
  if [ -f "$f" ]; then pkill -P "$(cat "$f")" 2>/dev/null || true; kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; fi
done
echo "stopped"
