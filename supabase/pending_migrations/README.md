# Pending migrations (NOT applied, NOT in the deploy path)

SQL here is kept for reference and tests only. It must never be applied as-is.
`supabase db push` and branch previews read `supabase/migrations/` only.

As of 2026-11-11, five Wave-2 drafts were applied live (they moved to
`supabase/migrations/`): the expense re-upload hash index (`20261112110000`),
guard-runs-last (`20261112112000`), expense country reject_reason
(`20261112114000`), the inspection signer identity view (`20261111120000`) and
stock_status derive (`20261112113000`). The two below remain:

RETIRED 2026-11-12 (owner "reconcile it"): the loop-16 stale-file draft
`20261011140000_workshop_status_stale_conflict.sql` was removed. Its own header
recorded that a parallel session had already applied the equivalent guard live
(`workshop_status_stale_file_guard` = `kept_newer_manual_update` +
`workshop_status_local_day` + `kept_count`, plus `workshop_status_upload_country_scope`).
The live guard enforces the loop-16 rule (a stale/same-day Excel never overwrites
a newer manual update, and a vehicle missing from such a file is not released).
The draft was a DIFFERENT, richer design that copied the July 110000 bodies, so
applying it would have overwritten a working guard with stale code — a regression.
Its per-row `keep_manual`/`take_file` conflict-resolution UI (conflict_details
evidence shown in the Vehicle Update Drawer) is a future ENHANCEMENT, not a bug;
re-author it against the live `workshop_status_confirm_upload` body if that UI is
ever wanted. The reconcile is therefore closed by deletion, not re-application.

- `20261112111000_replace_open_work_orders_rpc.sql` — the function body contains a
  runtime `delete from public.open_work_orders` (an atomic snapshot replace). The
  Supabase MCP's destructive-statement gate prompts a human to confirm any migration
  whose text contains `delete`/`drop`, and that prompt is not reachable from a cloud
  session, so `apply_migration`/`execute_sql` both time out on it. There is no honest
  DROP-free rewrite (the delete is the point). Apply it when the owner can approve the
  confirm prompt. Not urgent: the client (`erpIntake.js replaceOpenWorkOrders`) already
  falls back to a client-side delete+insert while this is unprovisioned.

- `20261110147000_profiles_pii_read.sql` — HELD for the owner's greenlight. Narrowing
  `profiles_select` blanks non-elevated member name reads app-wide (Flutter
  "assigned by <name>", pickers, workforce recommend, broadcast audience) unless a
  PII-free directory view + service-reader repoint land first, which needs browser E2E
  verification. Do not apply without the owner's go-ahead.
