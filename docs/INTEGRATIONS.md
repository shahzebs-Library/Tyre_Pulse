# Integrations

External services and edge functions TyrePulse depends on, and how secrets are
handled.

_Last updated: 2026-07-03 · Supabase project `jhssdmeruxtrlqnwfksc`._

---

## Supabase (core platform)

- **Postgres + RLS** — primary database; every business table is org/country
  scoped. Client uses the public URL + anon key only (RLS is the authority).
- **Auth** — Supabase Auth issues the JWT; role/scope resolved from `profiles`.
- **Storage** — private buckets (accident photos, import files, attachments);
  access via short-lived **signed URLs** only. No public buckets for business
  data.

Client config (public, safe to ship): `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY` (web); `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY` (mobile).

## Edge functions

All authenticated via `_shared/auth.ts:requireApprovedRole`. Secrets live only
in the edge runtime — never in the web/mobile bundle.

| Function                 | verify_jwt | Purpose                                                    | Secrets |
|--------------------------|-----------|------------------------------------------------------------|---------|
| `chat-ai`                | (custom)  | AI assistant; model server-locked, rate-limited, cached, usage-logged to `ai_usage_log` | AI provider key |
| `generate-embedding`     | yes       | Vector embeddings for RAG/knowledge base                   | AI provider key |
| `send-email`             | yes       | Transactional email                                        | `RESEND_API_KEY` |
| `send-scheduled-reports` | yes       | Renders + emails scheduled reports; writes `report_send_log` | `RESEND_API_KEY` |

### AI

- Model identifier is **server-locked** in `chat-ai` — the client cannot change
  the model.
- Cost controls: per-model `cost_usd` logged to `ai_usage_log`; optional
  response cache (`ai_response_cache`); per-user rate limit → 429 when over cap.
- Follows the RAG standard: retrieve relevant context, never dump full datasets
  into prompts.

### Email / scheduled reports

- Recurring delivery is driven by `report_schedules` + `pg_cron` + `pg_net`
  calling `send-scheduled-reports`, which renders the branded report and emails
  recipients via Resend, logging each attempt to `report_send_log` (surfaced in
  the Report Center → Delivery History).
- **Owner action required**: set the `RESEND_API_KEY` edge-function secret for
  emails to actually send.

## ERP / GPS (read-oriented)

- **ERP sync** is read-only unless explicitly enabled; imported data flows
  through the Data Intake Center (staging → validate → approve → commit), never
  a direct browser write to live tables.
- GPS/telematics feeds are ingested through the same intake adapters.

## Secret handling rules

- Only the **public** Supabase URL + anon key appear in `VITE_*` / `EXPO_PUBLIC_*`.
- AI, Resend, and any service-role keys are **server-side only** (edge function
  secrets). A startup guard checks no privileged secret leaked into the client
  bundle.
- The mobile anon key should live in EAS Secrets (owner action:
  `eas secret:create`).

## CI / deployment

- CI (`.github/workflows/ci.yml`) runs the full gate on every push:
  `npm run test:run` · `npx vite build` · mobile typecheck.
- Web deploys as a PWA (service worker precache of shell/icons/fonts only —
  never authed REST/auth/storage responses; caches cleared on logout).
