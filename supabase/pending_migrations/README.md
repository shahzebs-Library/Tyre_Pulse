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

- `20261112198000_backup_snapshot_retention_14_days.sql` — APPLIED 2026-11-12, moved to migrations/.
  Shortens nightly snapshot retention from 30 to 14 days (`backups.snapshot_tables` is
  456 MB). The next nightly run after applying removes 16 nights of snapshots, which is
  a removal of stored data, so it is not applied unattended. It frees disk only; no
  measured query gets faster from it.

## Engineering accuracy drafts (PR #513) - executed on local staging, NOT applied to production

Apply in this order. Each saves the definition it replaces to `_bak.fn_defs_eng_20261113` and aborts if an
anchor is not found exactly once. No draft changes a stored business row (hash proven on staging); 120000
writes metric registry text only. Staging proof: `supabase/tests/staging/eng_round2_staging.mjs` (23 tests).

1. `20261113120000_eng1_cost_per_km_named_metrics.sql` - named cost per km metrics; km total withheld.
2. `20261113121000_eng2_running_life_baseline_km_rule.sql` - expected life baseline by the km rule.
3. `20261113122000_eng3_calc_cpk_km_rule.sql` - `calc_cpk` refuses placeholder fitments (needs nothing else).
4. `20261113123000_eng4_unit_rule_road_vehicles.sql` - road vehicles with a plant word are km.
5. `20261113124000_eng5_warranty_spelling_and_tyre_spend_kinds.sql` - warranty spellings, tyre spend by kind.
6. `20261113125000_eng6_vehicle_km_ignores_placeholder_odometer.sql` - vehicle km ignores the placeholder
   odometer 1 (round 2 defect R2-D1). Raises cost per vehicle km about 5% KSA and 8% UAE: tell users first.

120000 and 125000 both change what "cost per vehicle km" shows; apply them together.
