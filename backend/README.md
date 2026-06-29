# TyrePulse Go API

The server-authoritative backend for TyrePulse. It sits between the web/mobile
clients and PostgreSQL, owns authorization, and exposes a versioned `/api/v1`
surface. This is the **Step 1 foundation** — only platform plumbing and the
first identity endpoint exist; domain modules are added as each is migrated off
direct Supabase access (see `docs/GO_BACKEND_MIGRATION_PLAN.md`).

## Status (Step 1)

- ✅ Config, structured logging, request IDs, graceful shutdown
- ✅ Postgres pool (pgx) — connects to the existing Supabase Postgres in Phase A
- ✅ Supabase JWT verification (HS256) + authenticated `GET /api/v1/me`
- ✅ JSON envelope + structured error model, CORS allow-list, rate limiting
- ✅ Audit + idempotency support tables (additive migration, nothing renamed/dropped)
- ✅ OpenAPI base, unit tests (`go test ./...`), docker-compose dev stack
- ⏳ Domain modules (assets, tyres, inspections, …) — later phases
- ⏳ Storage/queue concrete implementations — interfaces defined, wired later

**Nothing in the existing web/mobile apps is rewired yet.** They continue to
use Supabase directly until each module is cut over.

## Layout

```
backend/
  cmd/api          API server entrypoint
  cmd/worker       background worker (skeleton)
  internal/http    route composition (/api/v1)
  internal/modules identity (more added per migration phase)
  internal/platform config, database, httpserver, auth, authorization,
                   storage, queue, audit, observability
  migrations       goose SQL migrations (additive only in Phase A)
  openapi          OpenAPI 3 contract
```

## Run locally

```bash
cp .env.example .env            # fill DATABASE_URL + SUPABASE_JWT_SECRET
make run                        # or: go run ./cmd/api

# full stack (api + postgres + minio + redis + mailhog):
make docker-up
```

### Endpoints

| Method | Path             | Auth | Purpose                         |
|--------|------------------|------|---------------------------------|
| GET    | `/api/v1/health` | no   | Liveness                        |
| GET    | `/api/v1/readyz` | no   | Readiness (DB ping)             |
| GET    | `/api/v1/me`     | yes  | Authenticated profile (role/scope from DB) |

`me` requires a valid Supabase access token:

```bash
curl -H "Authorization: Bearer <supabase-access-token>" http://localhost:8080/api/v1/me
```

## Test

```bash
make test      # go test ./...
make vet
```

## Security notes

- The API verifies Supabase JWTs and loads role/scope from the database — the
  client-supplied role is never trusted.
- All secrets are server-side env vars. Clients never hold the DB DSN or
  service keys.
- Migrations in Phase A are additive only; no existing table is renamed or
  dropped until a module is fully cut over and reconciled.
