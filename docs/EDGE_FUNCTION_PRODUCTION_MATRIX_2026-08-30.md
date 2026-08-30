# Edge Function production matrix — 2026-08-30

Project: `jhssdmeruxtrlqnwfksc` (linked production). Secret values were never copied into this report; only names and presence were checked.

| Function | Caller / purpose | Authentication boundary | Configuration | Production |
|---|---|---|---|---|
| `account-recovery` | `src/lib/accountRecovery.js`; recovery and verified contact enrollment | Public recovery is enumeration-safe; contact actions validate the bearer session in-function; gateway JWT off by design | `RECOVERY_HMAC_SECRET`, `RESEND_API_KEY`, `FROM_EMAIL` (or `RECOVERY_EMAIL_FROM`), `APP_URL`; Twilio variables only for SMS | Active, JWT off; OPTIONS 200; missing-input 400; protected status without session 401 |
| `ai-orchestrator` | `src/lib/aiOrchestratorClient.js` | Approved role in shared auth | `ANTHROPIC_API_KEY`; optional `OPENAI_API_KEY`; optional AI limits | Active, JWT off; OPTIONS 200; anonymous POST 401 |
| `chat-ai` | agents, analytics, Ask Data, uploads | Approved Admin/Manager/Director in shared auth | `ANTHROPIC_API_KEY`; optional AI limits | Active, JWT off; OPTIONS 200; anonymous POST 401 |
| `generate-embedding` | `src/lib/embeddingService.js` | Approved Admin/Manager/Director plus gateway JWT | `OPENAI_API_KEY` | Active, JWT on; OPTIONS 200; anonymous POST 401; provider key missing |
| `embed-worker` | Internal cron embedding queue | Shared cron secret stored in deny-all `cron_config` | `OPENAI_API_KEY`; DB `cron_secret` | Active, JWT off; browser OPTIONS intentionally 405; provider key missing; DB secret presence not certified |
| `send-email` | `src/lib/emailService.js`, Inspections | Approved Admin/Manager/Director in shared auth | `RESEND_API_KEY`, `FROM_EMAIL` | Active, JWT off; OPTIONS 200; anonymous POST 401 |
| `send-scheduled-reports` | Scheduled Reports UI and cron | UI path validates approved Manager/Admin/Director; cron path is DB-gated | `RESEND_API_KEY`, `FROM_EMAIL`, `APP_URL`; DB cron secret | Active, JWT on; OPTIONS 200; anonymous POST 401; DB secret presence not certified |
| `billing-checkout` | `src/lib/api/billing.js` | Approved Admin in shared auth | `STRIPE_SECRET_KEY` | Active, JWT off; OPTIONS 200; anonymous POST 401; Stripe key missing, so checkout is intentionally unconfigured |
| `billing-webhook` | Stripe webhook | Stripe signature verification | `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` | Active, JWT off; OPTIONS 405 (correct for server webhook); Stripe signing secret missing |
| `workflow-notify` | DB workflow/cron notification delivery | Constant-time shared-secret check; DB fallback fails closed | `RESEND_API_KEY`, `FROM_EMAIL`; optional Twilio; `WORKFLOW_NOTIFY_SECRET` or DB value | Active, JWT off; OPTIONS 200; DB fallback presence not certified |
| `public-api` | External customer API | Hashed `x-api-key` validated by DB RPC | Built-in Supabase configuration | Active, JWT off; OPTIONS 200; missing API key rejected |
| `sentry-issues` | Admin Console crash workflow | Valid bearer session plus `is_super_admin` | Sentry connection in deny-all `cron_config` | Active, JWT off; OPTIONS 200; anonymous POST 401; DB connection presence not certified |
| `sentry-crash-alert` | Internal Sentry polling cron | Constant-time DB cron-secret check | DB Sentry/cron config; optional `RESEND_API_KEY`, `FROM_EMAIL` | Active, JWT off; browser OPTIONS intentionally 405; DB config presence not certified |

## Production secret-name inventory

Confirmed present: `ANTHROPIC_API_KEY`, `APP_URL`, `FROM_EMAIL`, `RECOVERY_HMAC_SECRET`, `RESEND_API_KEY`, plus Supabase-managed URL/key variables.

Missing and feature-blocking:

- `OPENAI_API_KEY` — embedding generation and embedding worker.
- `STRIPE_SECRET_KEY` — self-service checkout.
- `STRIPE_WEBHOOK_SECRET` — trusted subscription webhook processing.

Optional or DB-backed, not certified in this pass:

- `RECOVERY_EMAIL_FROM` is optional because recovery safely falls back to `FROM_EMAIL`.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` — SMS recovery.
- `TWILIO_WHATSAPP_FROM` — workflow WhatsApp notifications.
- `WORKFLOW_NOTIFY_SECRET` — optional when the deny-all DB fallback exists.
- `ALLOWED_ORIGINS` — optional; the shared production allowlist is used otherwise.
- `OPENAI_API_KEY` is optional for AI chat/orchestration while Anthropic is selected, but mandatory for embeddings.

## Deployment and verification result

All 13 local functions are now active in production. `account-recovery`, previously absent, was deployed during this audit with gateway JWT verification disabled as required by its pre-login recovery flow. Its public endpoint now returns correct CORS headers, rejects malformed recovery requests, and rejects protected contact-status access without a session. No email, SMS, checkout, webhook, cron job, or other destructive/external action was triggered.

The in-app System Health probe list now covers every browser-invoked function, including recovery, orchestration, billing, scheduled reports and Sentry—not only the original chat/email/embedding subset.

Before launch certification, configure the three feature-blocking secrets above, confirm the deny-all `cron_config` entries through a privileged database audit, and run authenticated happy-path tests with dedicated test recipients and Stripe test mode.
