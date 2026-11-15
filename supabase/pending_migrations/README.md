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

## Tenant isolation drafts TEN-1 to TEN-5 (authored 2026-11-12, NOT applied)

Source: `docs/commercial-readiness/audit/TENANCY_SECURITY.md`. Each file was built from the LIVE
definition (anchored replacement that aborts unless its anchor is found exactly once) and is covered
by a PGlite test that reproduces the exploit on a faithful copy of the live object, then proves the
refusal and the unchanged Company A path:
`node --test --test-concurrency=1 supabase/tests/tenant_isolation_ten*.test.mjs`.
PGlite is not production: every file carries rolled-back VERIFY steps for a DB-authorised session,
and the refusals need a plain Admin in a second organisation, which production does not have, so
confirm them on a branch database.

- `20261113100000_ten1_job_card_conflict_org_guard.sql`: organisation guard on the job card
  conflict update. Safe to apply alone; no confirm-gate words in the file.
- `20261113100500_ten1b_work_orders_per_org_key.sql`: HELD, owner decision. Per-organisation
  work order key. By-number joins to work_orders were not audited; contains one DROP CONSTRAINT.
- `20261113101000_ten2_raw_upload_tables_org_wall.sql`: organisation column and RESTRICTIVE policy on
  the three raw KSA/UAE upload tables and on pending_uploads. Four definer readers of the KSA staging
  table are NOT rewritten.
- `20261113102000_ten3_platform_tables_super_admin_write.sql`: ALTER POLICY on 13 platform tables.
- `20261113103000_ten4_admin_rpcs_same_org.sql`: same-organisation check in two admin RPCs.
- `20261113104000_ten5_subscription_and_plan_write_guard.sql`: OWNER DECISION inside (a customer
  Admin can no longer self-downgrade to trial or free from the Billing page). The file contains the
  word DELETE (trigger event), so the MCP confirm gate will prompt.

Suggested order: ten3, ten4, ten1, ten2, ten5, then ten1b after its join audit.

## SaaS foundation drafts TEN-6 to TEN-9 (authored 2026-11-12, NOT applied)

Source: `docs/commercial-readiness/audit/TENANCY_SECURITY.md` (TEN-6 to TEN-9, section 5) and
`COMMERCIAL_FOUNDATION.md` (CF-01 to CF-08). Plan and client work:
`docs/commercial-readiness/audit/SAAS_IMPLEMENTATION_ROADMAP.md`. Same method as TEN-1 to TEN-5
(anchored replacement on the live body, abort unless the anchor count matches). Tests share
`supabase/tests/fixtures/tenant_saas_harness.mjs`, which holds verbatim copies of 20 live bodies.
These four MUST be applied in file-name order, after TEN-1 to TEN-5:

- `20261113110000_ten6_entitlement_enforcement.sql`: `internal` plan and an explicit subscription
  row for every existing organisation FIRST, then `org_entitled()` consumed by `app_user_can`,
  `enforce_plan_limit` and a seat limit. Ships behind `system_config.entitlement_enforcement = 'off'`.
- `20261113111000_ten7_per_tenant_configuration.sql`: global matrix, alias and settings rows become
  the configuration of the organisation named in `system_config.legacy_config_org` (Company A);
  other tenants get `org_alias_overrides`, own matrix rows and `org_config()`.
- `20261113112000_ten8_company_a_fallback_resolver.sql`: the Company A id leaves all 20 functions
  and the `profiles.org_id` default; PT409 instead of a default when `single_tenant_mode` is off.
  Does NOT flip `single_tenant_mode`.
- `20261113113000_ten9_tenant_lifecycle.sql`: provisioning RPC, invitations, suspension enforced in
  `app_is_active()`, per-organisation identity indexes (global keys kept), purge DRAFT (dry run by
  default, service_role only). Contains a runtime `delete from`, so the MCP confirm gate will prompt.

Not proven by PGlite: the combined run of TEN-1..TEN-9 on one database, RLS cost under load, and the
15 functions that are stand-ins in the harness. Confirm on a branch database first.

## Tyre position service and ERP observation follow-up (2026-11-15)

`supabase/migrations/20261115120000_observation_erp_reconciliation.sql` is APPLIED to production (version
20261115090615). These are FOLLOW-UP drafts on top of it, apply in this order, neither applied anywhere
but the local staging copy:

- `20261116090000_tyre_position_service.sql` : pure functions that resolve an inspection slot id or an
  ERP position code to one canonical wheel on the asset's own layout (SQL mirror of
  `src/lib/tyrePositionService.js`, pinned by `src/test/fixtures/tyrePositionCases.json`). No table.
  Its built-in wheel table is generated from the JS: regenerate with
  `UPDATE_POSITION_FIXTURE=1 npx vitest run src/test/tyrePositionMirror.test.js`.
- `20261116091000_observation_erp_decide_on_position_service.sql` : `create or replace` of the live
  `observation_erp_decide` (same signature and result) on the position service, a read-only
  `observation_erp_evaluate`, and the reader policies the applied migration missed. No table, no removal.
- `20261116091000_observation_erp_decide_ROLLBACK.sql` : the exact live function, to undo the above.

Tests: `node --test supabase/tests/tyre_position_service.test.mjs` (PGlite) and
`python3 supabase/tests/staging/observation_erp_position_tests.py` (local staging copy).
