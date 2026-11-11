# Pending migrations (NOT applied, NOT in the deploy path)

SQL here is kept for reference and tests only. It must never be applied as-is.
`supabase db push` and branch previews read `supabase/migrations/` only.

As of 2026-11-11, five Wave-2 drafts were applied live (they moved to
`supabase/migrations/`): the expense re-upload hash index (`20261112110000`),
guard-runs-last (`20261112112000`), expense country reject_reason
(`20261112114000`), the inspection signer identity view (`20261111120000`) and
stock_status derive (`20261112113000`). The three below remain:

- `20261112111000_replace_open_work_orders_rpc.sql` — the function body contains a
  runtime `delete from public.open_work_orders` (an atomic snapshot replace). The
  Supabase MCP's destructive-statement gate prompts a human to confirm any migration
  whose text contains `delete`/`drop`, and that prompt is not reachable from a cloud
  session, so `apply_migration`/`execute_sql` both time out on it. There is no honest
  DROP-free rewrite (the delete is the point). Apply it when the owner can approve the
  confirm prompt. Not urgent: the client (`erpIntake.js replaceOpenWorkOrders`) already
  falls back to a client-side delete+insert while this is unprovisioned.

- `20261011140000_workshop_status_stale_conflict.sql` copies the July 110000
  stage/confirm bodies and would overwrite the live `kept_newer_manual_update`
  rule and the country-scope check applied by a parallel session. Reconcile
  against the live function bodies first, then move it back with a new timestamp.

- `20261110147000_profiles_pii_read.sql` — HELD for the owner's greenlight. Narrowing
  `profiles_select` blanks non-elevated member name reads app-wide (Flutter
  "assigned by <name>", pickers, workforce recommend, broadcast audience) unless a
  PII-free directory view + service-reader repoint land first, which needs browser E2E
  verification. Do not apply without the owner's go-ahead.
