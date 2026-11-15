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

## Closure workflow drafts (2026-11-15, owner decisions; NOT applied)

Apply in this order, each after a rolled-back check on production. Test: `supabase/tests/closure/run_staging.sh`
(local staging only). Report: `docs/commercial-readiness/audit/CLOSURE_ROUND2.md`.

- `20261116100000_clo_corrective_action_review.sql` - per-company review settings (`closure_review_config`),
  review columns on `corrective_actions` (status vocabulary unchanged), append-only
  `corrective_action_review_events`, the submit / review writers, the exception REQUEST and DECISION
  writers (the person who asks can never decide; no company switch relaxes that) and the guard trigger.
  Round 3 (owner, 2026-11-15): a Tire Planning Engineer may ask for an exception with optional
  evidence (`exception_evidence`, request writer now `(uuid, text, jsonb)`) only inside their company,
  country and sites; whoever ever asked for an exception on an action can never decide it or close
  the action (review approval or direct close), read from the append-only history. Staging T01-T11.
- `20261116101000_clo_checklist_acknowledge_exception.sql` - depends on the file above. Adds the
  `acknowledged` checklist outcome, `acknowledge_checklist_faults()`, `v_checklist_fault_compliance`,
  append-only `checklist_decision_events`, and per-company extra final signer roles. Contains one
  `drop constraint` + `add constraint` pair (a CHECK cannot be widened in place), so the MCP confirm
  prompt will appear. The blocking-mark rule (`guard_checklist_approval_stages`) is not touched.
- `20261116102000_clo_supervisor_actions_visibility.sql` - depends on `20261116100000`. Switches the
  `corrective_actions` module on for Workshop Supervisor and Maintenance Supervisor so a default
  reviewer can open the review screen (browser test defect C1). Two rows, no rights change.
## Work order permissions (draft PR #519, owner decisions 2026-11-15)

AUTHORED, NOT APPLIED. Proven only on a private copy of the local staging database (synthetic
companies) by `supabase/tests/staging_work_order_permissions.sh`. Renumbered on 2026-11-15 from
`20261115160000 / 160500 / 161000` so they no longer share a number with the tenant drafts of PR #518.
Apply in this order, after the web build that carries the matching screens is live:

1. `20261113130000_cur_work_orders_manager_director_default.sql` (PR #511; needed first)
2. `20261115140000_wo_permission_resolver.sql` - rule table `work_order_role_rules` (31 built-in rows),
   `work_order_can`, `work_order_scope`, `work_order_my_access`. Changes no behaviour alone.
3. `20261115140500_wo_policies_and_guards.sql` - policies and guards read the resolver: site and
   assignment scoped rights, closed and approved-cost locks, final closure needs the `close` right.
4. `20261115141000_wo_supervisor_module_visibility.sql` - menu switches: Work Orders and Live Control
   for the supervisor roles, Work Orders (the My Jobs screen) for Tyre Man and the trade roles.
5. `20261115141500_wo_cost_approval_not_collector.sql` - a Tyre Data Collector is no longer an
   eligible approver of work order scope and cost in the approval engine.

None of them rewrites a stored work order, cost or approval. Rollback is in each file's header.

## Multi-company drafts gathered for the full sequence (2026-11-15, stream COMMERCIAL2)

NOT applied. Order, dependencies, the check after each step and the point of no easy return are in
`docs/commercial-readiness/audit/MULTI_COMPANY_MIGRATION_SEQUENCE.md`; the local runner is
`supabase/tests/multi_company_sequence/`.

- `20261113100000` to `20261113115000` (13 files, TEN-1 to TEN-9 with 1b, 4b, 5b, 7b): copied unchanged
  from PR #506.
- `20261113150000` to `20261113156000` (8 files, COM): copied unchanged from PR #510. `154500` must ship
  with the client line `src/lib/api/tyreExchange.js:48`.
- `20261115160000_ten6b_entitlement_switch_preflight.sql` — new. Preflight report and the only supported
  way to turn plan enforcement on; refuses when the current company would be limited.
- `20261115161000_ten7c_role_matrix_own_company_read.sql` — new. A company reads only its own role rows
  and the built-in defaults; `get_org_role_matrix()`; optional seed of own rows.
- `20261115162000_ten8b_invitation_company_code_signup.sql` — new. Invitation preview before sign-in,
  company code, and a code that never grants membership.
- `20261115163000_ten9b_sign_in_company_code.sql` — new. One sign-in resolver; "company code/name";
  the current company keeps signing in with a bare name.
- `20261115164000_ten10_storage_company_folders.sql` : new. A file path that starts with a company id can be
  used only by that company (restrictive policy on `storage.objects`; legacy paths untouched).
- `20261115165000_ten11_ai_spend_per_company.sql` : new. AI month spend and budget per company in
  `ai_orchestrator_reserve_budget`; the current company never gets a company cap. Patches the live function
  body by three anchored replacements. Edge functions chat-ai and ai-tyre-inspection are NOT covered.
- `20261115166000_ten12_company_admin_audit.sql` : new. `org_admin_events` (append-only, written by triggers)
  and `get_org_admin_audit()` for the company Admin. Creates a table, ends with the reader policies call.
- `20261115167000_ten13_company_export_own_data.sql` : new. `org_export_manifest()` and `org_export_page()`:
  a company Admin reads the company's own rows of the export list. Reads only. Purge stays HOLD.
- `20261115169000_ten9c_HOLD_per_company_usernames.sql` — new, HOLD. Removes the global username and
  employee id keys. Contains `drop`. Point of no easy return; not part of the sequence proper.

Status per finding (TEN-1 to TEN-13): `docs/commercial-readiness/audit/TENANCY_STATUS.md`.

## Tyre position service and ERP observation follow-up (2026-11-15)

`supabase/migrations/20261115120000_observation_erp_reconciliation.sql` is APPLIED to production (version
20261115090615). These are FOLLOW-UP drafts on top of it, apply in this order, neither applied anywhere
but the local staging copy:

- `20261116084000_observation_erp_confirm_interim_lock.sql` : interim restriction. Three REVOKE
  statements so no signed-in user can record an ERP job card decision until the corrected function
  is installed. Independent; reversible by three GRANT statements (in its header).
- `20261116085000_tyre_layout_versions_and_position_mappings.sql` : layout history
  (`vehicle_diagram_config_versions`, written by a trigger, append-only) and verified per-layout
  ERP spellings (`tyre_layout_position_mappings`, ships empty). Apply before 090000.
- Order: 084000 (alone, first), then 085000, 090000, 091000 together. Owner's approval pack:
  `docs/commercial-readiness/audit/ERP_FOLLOWUP_APPROVAL_PACK.md`.
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

## Stored report PDFs (2026-11-15)

Drafts for the PDF cache service (`docs/pdf/PDF_ARCHITECTURE_AUDIT.md`, `docs/pdf/PDF_ROLLOUT.md`). None applied
anywhere but the local staging copy. Apply in this order, only on the owner's go-ahead:

- `20261117090000_report_pdf_cache.sql` : private bucket `report-pdfs`, `report_pdf_files`, `report_pdf_events`,
  the `pdf_cache_*` functions and the storage policies. Changes no existing object. Contains `drop policy if
  exists` guards for its own policies, so it needs the SQL editor or the owner present to approve the MCP prompt.
- `20261117091000_report_pdf_autoqueue.sql` : `report_pdf_queue` and an AFTER trigger on `inspections` that
  records a request when a record is completed or approved. Reads only; can never block a save.
- `20261117092000_report_export_jobs_DESIGN.sql` : DESIGN ONLY for a later server ZIP worker. Do not apply.

Tests: `supabase/tests/staging/report_pdf_cache_tests.sh` (local staging), `supabase/tests/report_pdf_cache_key.test.mjs` (PGlite).

## At-risk module fixes, round 2 (ATR, 2026-11-15) - NOT APPLIED

- `20261117100000_atr_user_view_prefs.sql` - creates `user_view_prefs` (personal saved table views; owner-only
  rows inside the owner's company; reader policies applied). Supersedes the never-applied
  `supabase/migrations/20260921090000_user_view_prefs.sql`. No dependency. Tested on local staging.
- `20261117101000_atr_carbon_offsets_blank_is_null.sql` - `carbon_offsets.aed_cost` and `trees_equivalent`
  become nullable with no default, so a blank is stored as "not recorded" and not 0. Contains `drop default` /
  `drop not null` (unavoidable), so the apply prompt needs the owner. No dependency. Tested on local staging.
