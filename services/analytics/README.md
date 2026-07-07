# Tyre Pulse Analytics Service

Python FastAPI microservice implementing the roadmap item **"Python AI & Analytics
Services"**: predictive tyre life, cost forecasting, anomaly detection and
procurement demand forecasting. It reads (never writes) the Supabase Postgres
database used by the main Tyre Pulse app and is deployed independently of the
React/Vite frontend.

## Architecture

```
analytics/
  core/        pure statistics + domain math (no I/O - fully unit-tested)
  db/          asyncpg pool + org-scoped SQL loaders
  api/         FastAPI routers and dependencies
  config.py    pydantic-settings (env-driven, no hardcoded secrets)
  main.py      app factory: JSON logging, timing middleware, RFC 7807 errors
```

Every business query filters by `organisation_id` (multi-tenant isolation) and
every `/v1` request must carry a valid `x-service-key` header (constant-time
compare against `ANALYTICS_SERVICE_KEY`).

Graceful degradation: when a dataset is too small to model (< 5 points), the
service returns a clearly-flagged heuristic estimate (`method` field +
`notes`) instead of an error.

## Endpoints

| Method | Path                  | Purpose |
| ------ | --------------------- | ------- |
| GET    | `/health`             | Liveness + DB reachability + version (unauthenticated) |
| POST   | `/v1/predict/tyre-life` | Per-tyre remaining life (km/days) via linear regression over inspection tread history, plus fleet aggregate |
| POST   | `/v1/forecast/cost`   | Monthly tyre spend forecast (Holt's linear trend) with 95% confidence band |
| POST   | `/v1/detect/anomalies`| Wear-rate, pressure, cost and duplicate-serial anomalies with typed severity |
| POST   | `/v1/forecast/demand` | Projected tyre replacements per month for procurement planning |

All `/v1` bodies require `organisation_id` (UUID). Optional filters: `site`,
`brand`, `position` (where applicable).

### Examples

```bash
BASE=http://localhost:8000
KEY=$ANALYTICS_SERVICE_KEY
ORG=00000000-0000-4000-8000-000000000001

curl -s $BASE/health

curl -s -X POST $BASE/v1/predict/tyre-life \
  -H "content-type: application/json" -H "x-service-key: $KEY" \
  -d '{"organisation_id":"'$ORG'","site":"Riyadh","avg_daily_km":250,"removal_threshold_mm":3}'

curl -s -X POST $BASE/v1/forecast/cost \
  -H "content-type: application/json" -H "x-service-key: $KEY" \
  -d '{"organisation_id":"'$ORG'","months_ahead":6}'

curl -s -X POST $BASE/v1/detect/anomalies \
  -H "content-type: application/json" -H "x-service-key: $KEY" \
  -d '{"organisation_id":"'$ORG'","lookback_days":365,"z_high":3}'

curl -s -X POST $BASE/v1/forecast/demand \
  -H "content-type: application/json" -H "x-service-key: $KEY" \
  -d '{"organisation_id":"'$ORG'","months_ahead":6,"brand":"Michelin"}'
```

Errors are RFC 7807 `application/problem+json` (401 unauthorized, 422
validation with per-field `errors`, 503 database unavailable, 500 internal).

## Environment variables

| Variable                | Required | Description |
| ----------------------- | -------- | ----------- |
| `DATABASE_URL`          | yes      | Supabase Postgres DSN (`postgresql://...?sslmode=require`) |
| `ANALYTICS_SERVICE_KEY` | yes      | Shared secret for `x-service-key` (min 16 chars; `openssl rand -hex 32`) |
| `ALLOWED_ORIGINS`       | no       | Comma-separated CORS origins (leave empty for server-to-server only) |
| `LOG_LEVEL`             | no       | `DEBUG`/`INFO`/`WARNING`/`ERROR` (default `INFO`) |

Tuning (optional): `DB_POOL_MIN_SIZE`, `DB_POOL_MAX_SIZE`,
`DB_COMMAND_TIMEOUT_S`, `DB_STATEMENT_TIMEOUT_MS`, `MAX_ROWS`.

## Local run

```bash
cd services/analytics
python3.12 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env   # then fill in real values
uvicorn analytics.main:app --reload --port 8000
```

Tests (no database needed - the math core is pure and the API tests use an
in-memory repository):

```bash
pytest
```

## Docker

```bash
docker build -t tyre-pulse-analytics .
docker run --rm -p 8000:8000 \
  -e DATABASE_URL='postgresql://...' \
  -e ANALYTICS_SERVICE_KEY='...' \
  tyre-pulse-analytics
```

## Deploy

**Fly.io**

```bash
fly launch --no-deploy            # generates fly.toml from the Dockerfile
fly secrets set DATABASE_URL='postgresql://...' ANALYTICS_SERVICE_KEY='...'
fly deploy
```

**Cloud Run**

```bash
gcloud run deploy tyre-pulse-analytics --source . --region me-central1 \
  --set-secrets DATABASE_URL=tp-db-url:latest,ANALYTICS_SERVICE_KEY=tp-analytics-key:latest \
  --min-instances 0 --max-instances 3
```

Cloud Run injects `PORT`; the container honours it. For Railway/Render, point
the service at this directory's Dockerfile and set the same env vars. Use the
Supabase **pooled** connection string (port 6543, transaction mode) on
scale-to-zero platforms.

## How the frontend calls this service

The frontend follows the existing env-gated client pattern
(`src/lib/apiClient.js` + `VITE_API_BASE_URL`): when the analytics base URL is
unset the UI degrades gracefully and keeps using the local JS engines.

**The browser must never hold `ANALYTICS_SERVICE_KEY`.** Anything shipped in a
Vite bundle is public. The supported call path is:

```
Browser (Supabase JWT)
  -> Supabase Edge Function  (verifies the user's JWT, resolves their
     organisation_id from profiles - never trusting a client-supplied org id -
     and attaches x-service-key from the function's secrets)
    -> this service (validates x-service-key, filters all SQL by organisation_id)
```

Until that edge-function proxy is added, only server-side consumers (edge
functions, scheduled report jobs, the future Go API) should call this service
directly. Do not expose `ANALYTICS_SERVICE_KEY` via any `VITE_*` variable.
