#!/usr/bin/env bash
# Start the local browser test stack: database copy -> PostgREST -> gateway (auth shim + proxy) -> built web app.
# Usage: e2e/staging/start.sh [--rebuild-db] [--skip-build]
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
REBUILD=0; SKIPBUILD=0
for a in "$@"; do case "$a" in --rebuild-db) REBUILD=1;; --skip-build) SKIPBUILD=1;; esac; done
mkdir -p "$E2E_RUN/logs"
[ -x "$POSTGREST_BIN" ] || { echo "PostgREST binary not found at $POSTGREST_BIN (see README)" >&2; exit 1; }

# 1. A COPY of the staging database. The staging database itself is never changed.
exists="$(psqle -At -d postgres -c "select 1 from pg_database where datname='$E2E_DB'")"
if [ "$REBUILD" = 1 ] && [ "$exists" = 1 ]; then
  psqle -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='$E2E_DB'" >/dev/null
  psqle -d postgres -c "drop database $E2E_DB"; exists=""
fi
if [ "$exists" != 1 ]; then
  psqle -d postgres -c "create database $E2E_DB template $E2E_TEMPLATE_DB"
  ids="$(sed "s/.*/'&'/" "$E2E_DIR/modules_r1.txt" | paste -sd, -)"
  psqle -d "$E2E_DB" -c "update public.modules set status='live' where module_id in ($ids)"
  psqle -d "$E2E_DB" -f "$E2E_DIR/harness.sql"
fi

# 2. Secrets for this run only (kept outside the repository).
if [ ! -f "$E2E_RUN/jwt_secret" ]; then (umask 077; head -c 48 /dev/urandom | base64 | tr -d '\n/+=' > "$E2E_RUN/jwt_secret"); fi
SECRET="$(cat "$E2E_RUN/jwt_secret")"
ANON_KEY="$(E2E_JWT_SECRET="$SECRET" node "$E2E_DIR/mint_anon.mjs")"
echo "$ANON_KEY" > "$E2E_RUN/anon_key"

# 3. PostgREST against the copy.
cat > "$E2E_RUN/postgrest.conf" <<CONF
db-uri = "postgres://authenticator@$PGHOST_E2E:$PGPORT_E2E/$E2E_DB"
db-schemas = "public"
db-extra-search-path = "public, extensions"
db-anon-role = "anon"
db-max-rows = 1000
db-pre-request = "anum_integration.pre_request"
jwt-secret = "$SECRET"
jwt-aud = "authenticated"
server-host = "127.0.0.1"
server-port = $PGRST_PORT
CONF
chmod 600 "$E2E_RUN/postgrest.conf"
"$E2E_DIR/stop.sh" >/dev/null 2>&1 || true
nohup "$POSTGREST_BIN" "$E2E_RUN/postgrest.conf" > "$E2E_RUN/logs/postgrest.log" 2>&1 & echo $! > "$E2E_RUN/postgrest.pid"

# 4. Gateway: /rest/v1 -> PostgREST, /auth/v1 -> local sign-in shim, the rest honest 501.
E2E_JWT_SECRET="$SECRET" E2E_ANON_KEY="$ANON_KEY" nohup node "$E2E_DIR/gateway.mjs" > "$E2E_RUN/logs/gateway.log" 2>&1 & echo $! > "$E2E_RUN/gateway.pid"

# 5. Build the real web app against the gateway and serve the build.
if [ "$SKIPBUILD" != 1 ] || [ ! -f "$E2E_RUN/dist/index.html" ]; then
  ( cd "$REPO_ROOT" && VITE_SUPABASE_URL="http://127.0.0.1:$GATEWAY_PORT" VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
      VITE_SENTRY_DSN= VITE_POSTHOG_KEY= VITE_TURNSTILE_SITE_KEY= \
      npx vite build --outDir "$E2E_RUN/dist" --emptyOutDir > "$E2E_RUN/logs/build.log" 2>&1 )
fi
E2E_DIST="$E2E_RUN/dist" nohup node "$E2E_DIR/serve_dist.mjs" > "$E2E_RUN/logs/web.log" 2>&1 & echo $! > "$E2E_RUN/web.pid"

for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$GATEWAY_PORT/rest/v1/" -H "apikey: $ANON_KEY" >/dev/null 2>&1 \
     && curl -fsS "http://127.0.0.1:$WEB_PORT/" >/dev/null 2>&1; then
    echo "Stack is up: web http://127.0.0.1:$WEB_PORT  api http://127.0.0.1:$GATEWAY_PORT  db $E2E_DB"; exit 0; fi
  sleep 0.5
done
echo "Stack did not come up. See $E2E_RUN/logs" >&2; exit 1
