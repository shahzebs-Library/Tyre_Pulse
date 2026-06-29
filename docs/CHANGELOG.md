# Changelog

All notable changes to TyrePulse are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/); the project uses date-based
entries on the active development branch.

## [Unreleased]

### Added — Go backend migration, Step 0 + Step 1
- **Architecture docs (`docs/`)**: `ARCHITECTURE_CURRENT_STATE.md`,
  `TARGET_ARCHITECTURE.md`, `GO_BACKEND_MIGRATION_PLAN.md`,
  `LEGACY_DATA_MAPPING.md`, `SECURITY_RISK_REGISTER.md`,
  `API_CONTRACT_STRATEGY.md`, and ADRs `0001`–`0004`.
- **Go API foundation (`/backend`)**: config, pgx pool, structured logging +
  request ids, JSON envelope/error model, CORS + rate-limit + recover + access
  log middleware, Supabase JWT verification, `GET /api/v1/health`, `/readyz`,
  `/me`; `cmd/worker` skeleton; OpenAPI 3 contract; unit tests (JWT,
  authorization, routes).
- **Additive migrations** (goose): `api_audit_events` (immutable audit),
  `idempotency_keys` (safe mobile write retries). No existing table changed.
- **DevOps**: `Dockerfile` (distroless), `docker-compose.dev.yml`
  (api+postgres+minio+redis+mailhog), `.env.example`, `Makefile`.
- **Client foundations (unwired)**: `src/lib/apiClient.js`,
  `mobile/lib/apiClient.ts`, `mobile/lib/offlineCommands.ts`; `API_BASE_URL` in
  both `.env.example` files.

> Step 1 rewires nothing — the web and mobile apps continue to use Supabase
> directly. Module cutovers begin in Step 2.

### Added — production-readiness (earlier on this branch)
- Warranty claims, recalls, tyre specifications, tyre rotations, inspection
  schedules, supplier ratings/contracts, and budget planning **persisted to
  Supabase** (previously browser `localStorage` or schema-broken).
- `StockReplenishment` schema fix + real `purchase_orders` creation.

### Fixed
- `DowntimeTracker`/`FuelEfficiency`/`PerformanceBenchmark`: derive from real
  data / label estimates honestly (removed fabricated metrics).
- Mobile `overview` and `alerts`: error/empty states; alerts acknowledge flow.

### Security
- AI model locked server-side; per-user AI rate limiting + response cache +
  usage logging.
- Account lockout/approval enforced on mobile + realtime.
- Accident photos moved to a private bucket (signed URLs); photo upload
  extension/size validation.
- Idle-timeout hardened (in-memory, not `localStorage`); generic auth errors;
  bulk-upload server-side validation.

### Known / open
- Supabase anon key still in `mobile/app.json` + `eas.json` → move to EAS
  Secrets (`eas secret:create`).
- See `docs/SECURITY_RISK_REGISTER.md` for the full open-risk list.
