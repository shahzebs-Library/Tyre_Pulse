#!/usr/bin/env bash
# Start the stored-PDF test stack:
#   database copy (+ the PDF drafts) -> REAL Supabase Storage API (file backend) -> PostgREST
#   -> gateway (sign-in shim + proxies) -> production build of the web app.
# Usage: e2e/pdf-storage/start.sh [--rebuild-db] [--skip-build]
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
REBUILD=0; SKIPBUILD=0
for a in "$@"; do case "$a" in --rebuild-db) REBUILD=1;; --skip-build) SKIPBUILD=1;; esac; done
mkdir -p "$PDF_E2E_RUN/logs" "$PDF_E2E_RUN/files"
[ -x "$POSTGREST_BIN" ] || { echo "PostgREST binary not found" >&2; exit 1; }
[ -x "$STORAGE_API_SRC/node_modules/.bin/tsx" ] || { echo "Storage API checkout without node_modules (see README)" >&2; exit 1; }
"$PDF_E2E_DIR/stop.sh" >/dev/null 2>&1 || true
DRAFTS=(20261117090000_report_pdf_cache 20261117091000_report_pdf_autoqueue 20261117093000_report_pdf_retention_bulk)

# Secrets for this run only (kept outside the repository).
if [ ! -f "$PDF_E2E_RUN/jwt_secret" ]; then (umask 077; head -c 48 /dev/urandom | base64 | tr -d '\n/+=' > "$PDF_E2E_RUN/jwt_secret"); fi
SECRET="$(cat "$PDF_E2E_RUN/jwt_secret")"
ANON_KEY="$(E2E_JWT_SECRET="$SECRET" node "$PDF_E2E_DIR/mint.mjs" anon)"; echo "$ANON_KEY" > "$PDF_E2E_RUN/anon_key"
SERVICE_KEY="$(E2E_JWT_SECRET="$SECRET" node "$PDF_E2E_DIR/mint.mjs" service_role)"
(umask 077; echo "$SERVICE_KEY" > "$PDF_E2E_RUN/service_key")

start_storage() {
  ( cd "$STORAGE_API_SRC" && env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy \
      NODE_ENV=development SERVER_HOST=127.0.0.1 SERVER_PORT="$STORAGE_PORT" SERVER_ADMIN_PORT="$((STORAGE_PORT + 1))" \
      AUTH_JWT_SECRET="$SECRET" AUTH_JWT_ALGORITHM=HS256 ANON_KEY="$ANON_KEY" SERVICE_KEY="$SERVICE_KEY" \
      DATABASE_URL="postgresql://postgres@$PGHOST_E2E:$PGPORT_E2E/$PDF_E2E_DB" DATABASE_MAX_CONNECTIONS=6 \
      DB_INSTALL_ROLES=false DB_SUPER_USER=postgres TENANT_ID=local REGION=local \
      STORAGE_BACKEND=file STORAGE_FILE_BACKEND_PATH="$PDF_E2E_RUN/files" FILE_STORAGE_BACKEND_PATH="$PDF_E2E_RUN/files" \
      STORAGE_S3_BUCKET=local GLOBAL_S3_BUCKET=local UPLOAD_FILE_SIZE_LIMIT=52428800 UPLOAD_FILE_SIZE_LIMIT_STANDARD=52428800 \
      UPLOAD_SIGNED_URL_EXPIRATION_TIME=120 PG_QUEUE_ENABLE=false IMAGE_TRANSFORMATION_ENABLED=false \
      S3_PROTOCOL_ACCESS_KEY_ID=local S3_PROTOCOL_ACCESS_KEY_SECRET=local TUS_URL_PATH=/upload/resumable \
      nohup node_modules/.bin/tsx src/start/server.ts > "$PDF_E2E_RUN/logs/storage.log" 2>&1 & echo $! > "$PDF_E2E_RUN/storage.pid" )
  for i in $(seq 1 80); do curl -fsS "http://127.0.0.1:$STORAGE_PORT/status" >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "Storage API did not start. See $PDF_E2E_RUN/logs/storage.log" >&2; exit 1
}

# 1. A COPY of the staging database with the drafts applied. The staging database is never changed.
exists="$(psqle -At -d postgres -c "select 1 from pg_database where datname='$PDF_E2E_DB'")"
if [ "$REBUILD" = 1 ] && [ "$exists" = 1 ]; then
  psqle -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='$PDF_E2E_DB'" >/dev/null
  psqle -d postgres -c "drop database $PDF_E2E_DB"; exists=""
fi
if [ "$exists" != 1 ]; then
  rm -rf "$PDF_E2E_RUN/files"; mkdir -p "$PDF_E2E_RUN/files"
  psqle -d postgres -c "create database $PDF_E2E_DB template $PDF_E2E_TEMPLATE_DB"
  # live in production, newer than the staging baseline (the observation report reads it)
  psqle -d "$PDF_E2E_DB" -1 -f "$PDF_E2E_REPO/supabase/migrations/20261115120000_observation_erp_reconciliation.sql" >/dev/null 2>&1 || true
  # The staging baseline carries a stand-in for the storage schema (two bare tables). Replace it with
  # the schema the REAL Storage API creates for itself, then put the production storage policies back.
  psqle -d "$PDF_E2E_DB" -At -c "select format('create policy %I on storage.%I as %s for %s to %s %s %s;', policyname, tablename, permissive, cmd,
      array_to_string(roles, ','), case when qual is not null then 'using (' || qual || ')' else '' end,
      case when with_check is not null then 'with check (' || with_check || ')' else '' end) from pg_policies where schemaname = 'storage'" > "$PDF_E2E_RUN/storage_policies.sql"
  psqle -d "$PDF_E2E_DB" -At -F $'\t' -c "select id, coalesce(file_size_limit::text, 'null') from storage.buckets" > "$PDF_E2E_RUN/buckets.tsv"
  psqle -d "$PDF_E2E_DB" -c "drop schema storage cascade" -c "create schema storage" \
    -c "grant usage on schema storage to anon, authenticated, service_role" \
    -c "alter default privileges in schema storage grant all on tables to postgres, anon, authenticated, service_role" \
    -c "alter default privileges in schema storage grant all on functions to postgres, anon, authenticated, service_role" \
    -c "alter default privileges in schema storage grant all on sequences to postgres, anon, authenticated, service_role" >/dev/null 2>&1
  start_storage      # runs the Storage API's own migrations
  while IFS=$'\t' read -r id lim; do
    psqle -d "$PDF_E2E_DB" -c "insert into storage.buckets (id, name, public, file_size_limit) values ('$id', '$id', false, $lim) on conflict (id) do nothing"
  done < "$PDF_E2E_RUN/buckets.tsv"
  psqle -d "$PDF_E2E_DB" -f "$PDF_E2E_RUN/storage_policies.sql" >/dev/null
  for f in "${DRAFTS[@]}"; do psqle -d "$PDF_E2E_DB" -1 -f "$PDF_E2E_REPO/supabase/pending_migrations/$f.sql" >/dev/null 2>&1; done
  psqle -d "$PDF_E2E_DB" -f "$PDF_E2E_DIR/harness.sql"
else
  start_storage
fi

# 2. PostgREST against the copy.
cat > "$PDF_E2E_RUN/postgrest.conf" <<CONF
db-uri = "postgres://authenticator@$PGHOST_E2E:$PGPORT_E2E/$PDF_E2E_DB"
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
chmod 600 "$PDF_E2E_RUN/postgrest.conf"
nohup "$POSTGREST_BIN" "$PDF_E2E_RUN/postgrest.conf" > "$PDF_E2E_RUN/logs/postgrest.log" 2>&1 & echo $! > "$PDF_E2E_RUN/postgrest.pid"

# 3. Gateway: /rest/v1 -> PostgREST, /storage/v1 -> Storage API, /auth/v1 -> local sign-in shim.
E2E_JWT_SECRET="$SECRET" E2E_DB="$PDF_E2E_DB" nohup node "$PDF_E2E_DIR/gateway.mjs" > "$PDF_E2E_RUN/logs/gateway.log" 2>&1 & echo $! > "$PDF_E2E_RUN/gateway.pid"

# 4. Build the real web app against the gateway and serve the build.
if [ "$SKIPBUILD" != 1 ] || [ ! -f "$PDF_E2E_RUN/dist/index.html" ]; then
  ( cd "$PDF_E2E_REPO" && VITE_SUPABASE_URL="http://127.0.0.1:$GATEWAY_PORT" VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
      VITE_SENTRY_DSN= VITE_POSTHOG_KEY= VITE_TURNSTILE_SITE_KEY= \
      npx vite build --outDir "$PDF_E2E_RUN/dist" --emptyOutDir > "$PDF_E2E_RUN/logs/build.log" 2>&1 )
fi
E2E_DIST="$PDF_E2E_RUN/dist" nohup node "$PDF_E2E_DIR/serve_dist.mjs" > "$PDF_E2E_RUN/logs/web.log" 2>&1 & echo $! > "$PDF_E2E_RUN/web.pid"

for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$GATEWAY_PORT/rest/v1/" -H "apikey: $ANON_KEY" >/dev/null 2>&1 \
     && curl -fsS "http://127.0.0.1:$GATEWAY_PORT/storage/v1/status" >/dev/null 2>&1 \
     && curl -fsS "http://127.0.0.1:$WEB_PORT/" >/dev/null 2>&1; then
    echo "Stack is up: web http://127.0.0.1:$WEB_PORT  api http://127.0.0.1:$GATEWAY_PORT  db $PDF_E2E_DB"; exit 0; fi
  sleep 0.5
done
echo "Stack did not come up. See $PDF_E2E_RUN/logs" >&2; exit 1
