# TyrePulse — Target Architecture

> **Status:** Step 0 design. The destination for the phased migration in
> `docs/GO_BACKEND_MIGRATION_PLAN.md`. Current state is in
> `docs/ARCHITECTURE_CURRENT_STATE.md`.

## 1. Goal
Move from a **direct-Supabase** model (clients talk straight to Postgres via the
SDK, RLS as the only boundary) to a **server-authoritative** model where a **Go
API** owns authorization, validation, workflow, idempotency, and audit — without
breaking the running web/mobile apps. Migration is module-by-module; Supabase
remains for not-yet-migrated modules during transition.

## 2. Topology

```
        ┌──────────────┐        ┌──────────────────┐
        │  Web (React) │        │ Mobile (Expo RN) │
        └──────┬───────┘        └─────────┬────────┘
               │  HTTPS  Bearer Supabase JWT (Phase A)
               └───────────────┬──────────┘
                               ▼
                     ┌───────────────────┐
                     │     Go API        │   /api/v1
                     │  (cmd/api)        │   authz · validation · workflow
                     └───┬───────┬───────┘   idempotency · audit
                         │       │
        ┌────────────────┘       └──────────────┬───────────────┐
        ▼                                        ▼               ▼
 ┌─────────────┐                         ┌─────────────┐  ┌────────────┐
 │ PostgreSQL  │                         │ Private S3/ │  │   Redis    │
 │ (Phase A:   │                         │ MinIO       │  │ cache/queue│
 │  Supabase)  │                         │ (signed URL)│  └─────┬──────┘
 └─────────────┘                         └─────────────┘        ▼
                                                          ┌────────────┐
                                                          │ Worker     │
                                                          │ (cmd/worker)│  reports, imports, embeddings
                                                          └────────────┘
```

Supabase Auth (GoTrue) keeps **issuing** JWTs in Phase A; the Go API **verifies**
them and owns authorization. Edge Functions (`chat-ai`, `send-email`,
`generate-embedding`) continue until their work moves behind the API/worker.

## 3. Backend module boundaries (`/backend`)

**Platform** (`internal/platform/`): `config`, `database` (pgx pool),
`httpserver` (envelope/errors/middleware), `auth` (JWT verify), `authorization`
(role+scope), `storage` (provider iface), `queue` (job iface), `audit`
(append-only), `observability` (slog + request ids).

**Domain modules** (`internal/modules/`), added per phase:
`identity`, `organisation`, `assets`, `tyres`, `inspections`, `workorders`,
`inventory`, `accidents`, `uploads`, `imports`, `reports`, `notifications`,
`integrations`.

Each module owns its routes, service logic, and repository; cross-module work
goes through service interfaces, never another module's tables.

## 4. Canonical multi-tenant model
See `docs/ADR/0002`. Hierarchy:

```
Organisation → Country → Project → Site → Asset
   → Tyre · Inspection · WorkOrder · Accident · Cost · StockMovement
```

Every business row: `id`, `organisation_id`, scope ids, `created_at/updated_at`,
`created_by/updated_by`, soft-delete/lifecycle, `version` (optimistic
concurrency). Authorization enforced server-side (RBAC + scope); RLS retained as
defense-in-depth.

## 5. Request lifecycle (write)
1. Client sends `POST /api/v1/...` with `Authorization: Bearer <jwt>`,
   `Idempotency-Key`, `X-Request-Id`.
2. Middleware: request-id → recover → access-log → CORS → rate-limit → **verify
   JWT** → load principal.
3. Handler: load profile **role/scope from DB**; authorize (RBAC + scope);
   validate payload; check idempotency key.
4. Service: execute within a DB transaction (multi-table writes are atomic);
   write **audit event**; bump `version`.
5. Respond with the `{data,error,meta}` envelope; store the idempotent result.

## 6. Storage & jobs
- **Files:** never public. API authorizes, then issues short-lived signed URLs
  (ADR 0003); metadata in DB.
- **Background work:** large report/PDF/Excel generation, imports, embeddings
  move to the worker via Redis-backed jobs; the web app requests a report and
  downloads it when ready (off the request path).

## 7. Security posture
Secrets server-side only; clients hold no DB DSN/service keys. JWT verified
every request; role never trusted from the client. Audit is immutable. CORS
allow-list, per-IP + per-user rate limits, structured errors that never leak
internals. See `docs/SECURITY_RISK_REGISTER.md`.

## 8. Transition & coexistence
Phase A keeps Supabase Postgres + Auth; the Go API runs beside the apps. For
each migrated module, clients switch to the API and legacy direct writes are
frozen, then the legacy table goes read-only, then deprecated after
reconciliation. Phase C moves Postgres + storage off Supabase behind the same
interfaces. Detailed order: `docs/GO_BACKEND_MIGRATION_PLAN.md`.
