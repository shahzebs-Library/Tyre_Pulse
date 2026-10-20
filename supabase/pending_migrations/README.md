# Pending migrations (NOT applied, NOT in the deploy path)

SQL here is kept for reference and tests only. It must never be applied as-is.
`supabase db push` and branch previews read `supabase/migrations/` only.

- `20261011140000_workshop_status_stale_conflict.sql` copies the July 110000
  stage/confirm bodies and would overwrite the live `kept_newer_manual_update`
  rule and the country-scope check applied by a parallel session. Reconcile
  against the live function bodies first, then move it back with a new timestamp.
