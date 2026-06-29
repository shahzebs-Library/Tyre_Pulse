# ADR 0001 — Go backend and API boundary

**Status:** Proposed · **Date:** 2026-06-29

## Context
TyrePulse has no application API layer. The React web app (69 files) and the
Expo mobile app (~12 sites) call Supabase directly (`supabase.from/rpc/storage`),
with PostgreSQL RLS as the only authorization boundary. Mobile even chooses the
target table at runtime (`mobile/lib/recordQueue.ts` → `supabase.from(table).insert`).
This couples both clients to the physical schema, prevents server-owned
validation/workflow/idempotency, and makes every business rule live in RLS or
the client. The directive (`Roadmap_latest.Md`) requires a server-authoritative
backend introduced in safe phases without breaking the running apps.

## Decision
Introduce a **Go API** under `/backend` as the single authorization, validation,
and write boundary, exposed as versioned `/api/v1`.

- **HTTP:** Go standard `net/http` + `chi` router. No heavyweight framework.
- **Data:** `pgx/v5` pool with **parameterized queries only**; `sqlc` for
  type-safe query code. Migrations via `goose`, **additive only** in Phase A.
- **Auth (Phase A):** the API verifies the **Supabase-issued JWT** (HS256 via
  `SUPABASE_JWT_SECRET`), extracts `sub`, and loads role/scope from `profiles`.
  Supabase Auth is retained; **Go owns authorization**. The client-supplied role
  is never trusted.
- **Transition:** Phase A — Go connects to the **existing Supabase Postgres**
  with a server-only `DATABASE_URL`; no second source of truth, no table
  renames/drops. Per module: dry-run → reconcile → route clients through Go →
  freeze legacy writes → legacy read-only → deprecate.
- **Boundary rule:** once a module is migrated, its clients lose direct
  business-table access for that module.

## Consequences
**Positive:** one enforcement point; server-side validation, workflow,
idempotency, audit; clients decoupled from schema; clear path off Supabase
(Phase C).
**Negative:** new service to operate/deploy; temporary dual data-access (Go for
migrated modules, Supabase for the rest); added latency hop.
**Neutral:** RLS remains as defense-in-depth during transition.

## Alternatives considered
- **Keep direct Supabase + harden RLS only** — rejected: cannot own
  multi-table transactions, workflow, idempotency, or server validation.
- **Node/NestJS or Next API routes** — rejected: the directive favors Go for a
  long-lived, typed, low-overhead service; team wants a clean API/worker split.
- **Supabase Edge Functions for everything** — rejected: Deno functions suit
  isolated side-effects, not a cohesive domain layer with a connection pool.
- **PostgREST custom layer** — rejected: still schema-coupled, weak for workflow.
