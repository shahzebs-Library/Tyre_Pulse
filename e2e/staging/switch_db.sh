#!/usr/bin/env bash
# Point the running test stack's PostgREST at another database COPY (same JWT secret, gateway and web build).
# Used by the rollout rehearsal (specs/rollout_states.cjs) to test one web build against several database states.
# Usage: e2e/staging/switch_db.sh <database>
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
DB="${1:?database name}"
[ "$(psqle -At -d postgres -c "select 1 from pg_database where datname='$DB'")" = 1 ] || { echo "no database $DB" >&2; exit 1; }
sed -i "s#^db-uri = .*#db-uri = \"postgres://authenticator@$PGHOST_E2E:$PGPORT_E2E/$DB\"#" "$E2E_RUN/postgrest.conf"
[ -f "$E2E_RUN/postgrest.pid" ] && kill "$(cat "$E2E_RUN/postgrest.pid")" 2>/dev/null || true
sleep 1
nohup "$POSTGREST_BIN" "$E2E_RUN/postgrest.conf" > "$E2E_RUN/logs/postgrest.log" 2>&1 & echo $! > "$E2E_RUN/postgrest.pid"
ANON_KEY="$(cat "$E2E_RUN/anon_key")"
for i in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$GATEWAY_PORT/rest/v1/" -H "apikey: $ANON_KEY" >/dev/null 2>&1 && { echo "PostgREST now serves $DB"; exit 0; }
  sleep 0.5
done
echo "PostgREST did not come up on $DB" >&2; exit 1
