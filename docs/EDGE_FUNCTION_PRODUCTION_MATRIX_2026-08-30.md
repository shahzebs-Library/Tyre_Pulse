# Edge Function production matrix — 2026-08-30

Project: `jhssdmeruxtrlqnwfksc` (linked production). Secret values were never copied into this report; only names and presence were checked.

| Function | Caller / purpose | Authentication boundary | Configuration | Production |
|---|---|---|---|---|
| `account-recovery` | `src/lib/accountRecovery.js`; recovery and verified contact enrollment | Public recovery is enumeration-safe; contact actions validate the bearer session in-function; gateway JWT off by design | `RECOVERY_HMAC_SECRET`, `RESEND_API_KEY`, `FROM_EMAIL` (or `RECOVERY_EMAIL_FROM`), `APP_URL`; Twilio variables only for SMS | Active, JWT off; OPTIONS 200; missing-input 400; protected status without session 401 |
| `ai-orchestrator` | `src/lib/aiOrchestratorClient.js` | Approved role in shared auth | `ANTHROPIC_API_KEY`; optional `OPENAI_API_KEY`; optional AI limits | Active, JWT off; OPTIONS 200; anonymous POST 401 |
| `chat-ai` | agents, analytics, Ask Data, uploads | Approved Admin/Manager/Director in shared auth | `ANTHROPIC_API_KEY`; optional AI limits | Active, JWT off; OPTIONS 200; anonymous POST 401 |
| `generate-embedding` | `src/lib/embeddingService.js` | Approved Admin/Manager/Director plus gateway JWT | `OPENAI_API_KEY` | Active, JWT on; OPTIONS 200; anonymous POST 401; provider key missing |
| `embed-worker` | Internal cron embedding queue | Shared cron secret stored in deny-all `cron_config` | `OPENAI_API_KEY`; DB `cron_secret` | Active, JWT off; anonymous POST 401; DB secret confirmed; provider key missing |
| `send-email` | `src/lib/emailService.js`, Inspections | Approved Admin/Manager/Director in shared auth | `RESEND_API_KEY`, `FROM_EMAIL` | Active, JWT off; OPTIONS 200; anonymous POST 401 |
| `send-scheduled-reports` | Scheduled Reports UI and cron | UI path validates approved Manager/Admin/Director; cron path is DB-gated | `RESEND_API_KEY`, `FROM_EMAIL`, `APP_URL`; DB cron secret | Active, JWT on; OPTIONS 200; anonymous POST 401; DB secret confirmed |
| `billing-checkout` | `src/lib/api/billing.js` | Approved Admin in shared auth | `STRIPE_SECRET_KEY` | Active, JWT off; OPTIONS 200; anonymous POST 401; Stripe key missing, so checkout is intentionally unconfigured |
| `billing-webhook` | Stripe webhook | Stripe signature verification | `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` | Active, JWT off; OPTIONS 405 (correct for server webhook); Stripe signing secret missing |
| `workflow-notify` | DB workflow/cron notification delivery | Constant-time shared-secret check; DB fallback fails closed | `RESEND_API_KEY`, `FROM_EMAIL`; optional Twilio; `WORKFLOW_NOTIFY_SECRET` or DB value | Active, JWT off; anonymous POST 401; DB fallback confirmed |
| `public-api` | External customer API | Hashed `x-api-key` validated by DB RPC | Built-in Supabase configuration | Active, JWT off; OPTIONS 200; missing API key rejected |
| `sentry-issues` | Admin Console crash workflow | Valid bearer session plus `is_super_admin` | Sentry connection in deny-all `cron_config` | Active, JWT off; OPTIONS 200; anonymous POST 401; token, org and region confirmed |
| `sentry-crash-alert` | Internal Sentry polling cron | Constant-time DB cron-secret check | DB Sentry/cron config; optional `RESEND_API_KEY`, `FROM_EMAIL` | Active, JWT off; anonymous POST 401; cron, token, org, region and enabled setting confirmed |

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

Before launch certification, configure the three feature-blocking secrets above and run authenticated happy-path tests with dedicated test recipients and Stripe test mode.

## Follow-up live readiness audit

The privileged production audit confirmed that `cron_secret`,
`workflow_notify_secret`, `sentry_auth_token`, `sentry_org`,
`sentry_region_url`, and `sentry_alerts_enabled` are present without copying
their values. `sentry_project` is blank, but neither Sentry Edge Function uses
that setting: both query the configured organization and accept a project
filter at request time. No `sentry_alert_email` row is present, so fatal issues
can still be recorded in `system_logs`, but email escalation has no recipient.

All 13 cron jobs are active. The most recent 100 retained `pg_net` responses
were HTTP 200. The audit found that `process-domain-events` had failed its last
20 runs because `prevent_audit_mutation()` blocked the dispatcher from updating
event status. Migration `20260830190620` replaced that blanket trigger with a
narrow guard: event identity and payload remain immutable and deletes remain
blocked, while delivery state may advance. The next production run succeeded
and drained the pending queue from 110 events to zero.

Safe anonymous production probes returned 401 for every custom-auth or cron
endpoint tested. `public-api` rejected the wrong HTTP method with 405, and the
unsigned billing webhook returned 503 because its signing secret is not yet
configured. No request reached Stripe, OpenAI, Resend, or Sentry during these
probes.

Checkout redirects have also been hardened and deployed: success and
cancellation URLs now derive from operator-controlled `APP_URL`, never the
caller-controlled `Origin` header.

Two launch checks still need real provider test mode and cannot be certified by
anonymous probes. Stripe webhook retries need an end-to-end idempotency test;
the current checkout-completed handler derives a subscription period locally,
so the test must prove retries cannot move that period and that Stripe remains
the authoritative billing state. Browser crash capture also requires confirming
`VITE_SENTRY_DSN` in the production frontend environment; it was not present in
the audited local environment. These checks must use dedicated test accounts,
not production customer transactions.
