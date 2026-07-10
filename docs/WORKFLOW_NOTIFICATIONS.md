# Workflow Notifications (Phase 3 — external channel fan-out)

The Approval & Workflow Engine already writes **in-app** notifications
(`notifications` table, via V97 `notify_role_in_org` and V117 `workflow_act`).
This phase adds the **three external channels** — Email, Push, WhatsApp — driven
off the same `workflow.*` domain events, with **zero client involvement**.

```
workflow_act (V117)                          workflow-notify (edge fn)
  └─ emit_domain_event('workflow.*')            ├─ Email    → Resend
        │                                        ├─ Push     → Expo Push API
        ▼   (V96 process_domain_events, 1/min)   └─ WhatsApp → Twilio Messages
  consume_event_workflow_notify (V119)                 ▲
        └─ resolve recipients + enqueue ────────────┐  │  POST + x-workflow-secret
              public.workflow_notifications         │  │
                    │                               │  │
                    ▼   (deliver_workflow_notifications, pg_cron 1/min)
              net.http_post ──────────────────────┘──┘
```

## Channels

| Channel  | Provider        | Gating env (edge function)                                  | No-op when unset |
|----------|-----------------|-------------------------------------------------------------|------------------|
| Email    | Resend          | `RESEND_API_KEY`, `FROM_EMAIL`                              | yes              |
| Push     | Expo Push API   | *(none — anonymous send)*; gated on recipients' `push_token`| yes              |
| WhatsApp | Twilio Messages | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | yes         |

Each channel is **independent**: if its env is missing, or it errors, the other
channels still fire. The function returns a per-channel summary:

```json
{ "email": 2, "push": 1, "whatsapp": 0, "skipped": ["whatsapp: Twilio env not configured"] }
```

## Edge function: `workflow-notify`

- **Path:** `supabase/functions/workflow-notify/index.ts`
- **Auth:** deployed with `--no-verify-jwt` (server-invoked by Postgres/pg_net,
  no end-user JWT). The trust boundary is the shared-secret header
  **`x-workflow-secret`**, compared to `WORKFLOW_NOTIFY_SECRET` *when that env is
  set*. Leave the env unset only in local/dev.
- **Request body** (POST JSON):

  ```jsonc
  {
    "event_type": "workflow.step_advanced",   // | approved | rejected | returned
    "instance_id": "…uuid…",
    "definition_name": "Tyre Replacement",
    "entity_type": "vehicle",
    "entity_label": "ABC-123",
    "step_name": "Inspector Review",
    "comment": "optional",
    "recipients": [
      { "user_id": "…", "email": "a@b.com", "push_token": "ExponentPushToken[…]", "phone": "+9665…", "role": "inspector" }
    ]
  }
  ```

- **WhatsApp copy:** `"{entity_label} {definition_name} is awaiting your approval
  at step {step_name}."` (varies per event type).

## Required env / secrets

### Edge function secrets (`supabase secrets set`)

| Secret                   | Purpose                                                        |
|--------------------------|---------------------------------------------------------------|
| `WORKFLOW_NOTIFY_SECRET` | **Must equal** `cron_config.workflow_notify_secret` in the DB. |
| `RESEND_API_KEY`         | Resend API key (email). Optional.                             |
| `FROM_EMAIL`             | Verified sender (default `reports@tyrepulse.app`).           |
| `TWILIO_ACCOUNT_SID`     | Twilio account SID (WhatsApp). Optional.                     |
| `TWILIO_AUTH_TOKEN`      | Twilio auth token. Optional.                                 |
| `TWILIO_WHATSAPP_FROM`   | Twilio WhatsApp sender, e.g. `whatsapp:+14155238886`.        |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` are injected automatically (used by
`_shared/auth.ts` CORS).

### Database secret

`MIGRATIONS_V119_WORKFLOW_NOTIFY.sql` auto-seeds a random
`cron_config('workflow_notify_secret')` (private, service-role-only table from
V61). **Set the edge function's `WORKFLOW_NOTIFY_SECRET` to the same value:**

```bash
# read the seeded DB secret (psql / SQL editor)
SELECT value FROM public.cron_config WHERE name = 'workflow_notify_secret';

# mirror it into the function
supabase secrets set WORKFLOW_NOTIFY_SECRET=<that-value>
```

Rotate by updating **both** in lock-step.

## Deploy steps

```bash
# 1. Apply the migration (after V118) — via Supabase SQL editor or MCP apply_migration.
#    Registers the consumer + queue table + pg_cron job 'deliver-workflow-notifications'.

# 2. Deploy the edge function (JWT verification OFF — server-invoked).
supabase functions deploy workflow-notify --no-verify-jwt

# 3. Set secrets (WhatsApp/Email optional; secret gate required for prod).
supabase secrets set \
  WORKFLOW_NOTIFY_SECRET=<= cron_config.workflow_notify_secret> \
  RESEND_API_KEY=<resend_key> \
  FROM_EMAIL=reports@tyrepulse.app \
  TWILIO_ACCOUNT_SID=<sid> \
  TWILIO_AUTH_TOKEN=<token> \
  TWILIO_WHATSAPP_FROM=whatsapp:+1XXXXXXXXXX
```

## How the cron delivery works

1. **Emit** — `workflow_act` (V117) emits `workflow.step_advanced` / `approved` /
   `rejected` / `returned` domain events.
2. **Consume** — `process_domain_events` (V96, every minute) dispatches each
   event to `consume_event_workflow_notify` (V119), which resolves recipients:
   - `step_advanced` → the newly-opened step's assignee: the specific
     `approver_user_id`, else all approved + unlocked users in the org whose
     normalised role matches `approver_role` (same rule as `notify_role_in_org`).
   - `approved` / `rejected` / `returned` → the initiator (`started_by`).
   Email is pulled from `auth.users`; `push_token` from `profiles`. It inserts
   **one** row into `public.workflow_notifications` (unique on `event_id`, so
   at-least-once event replays are absorbed). Rows with no reachable recipient
   are stored as `skipped`.
3. **Deliver** — `deliver_workflow_notifications` (pg_cron
   `deliver-workflow-notifications`, every minute), mirroring the V99 webhook
   deliverer:
   - reconciles the previous attempt's `net._http_response` (2xx → `delivered`
     and stores the function's `{email,push,whatsapp,skipped}` summary);
   - POSTs due rows to the function URL via `net.http_post` with the
     `x-workflow-secret` header (anon bearer only satisfies the gateway);
   - retries with `2^n`-minute backoff, up to 6 attempts, then `failed`.

Delivery history is readable by elevated users in their org
(`workflow_notifications`, RLS-guarded) for dashboards/debugging.

## Notes

- **Additive & reversible.** No existing table, function, or migration is
  modified. Rollback block is in the migration header.
- **`phone` is currently always `NULL`** at enqueue time — `profiles` has no
  phone column yet. WhatsApp is wired end-to-end and will light up automatically
  once a phone source is added to the recipient resolution in
  `consume_event_workflow_notify` (single query change) and Twilio env is set.
- **In-app is unchanged** — this only adds external channels; no duplication.
