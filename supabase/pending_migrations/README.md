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
- `20261115169000_ten9c_HOLD_per_company_usernames.sql` — new, HOLD. Removes the global username and
  employee id keys. Contains `drop`. Point of no easy return; not part of the sequence proper.

## Closure workflow drafts (2026-11-15, owner decisions; NOT applied)

Apply in this order, each after a rolled-back check on production. Test: `supabase/tests/closure/run_staging.sh`
(local staging only). Report: `docs/commercial-readiness/audit/CLOSURE_ROUND2.md`.

- `20261116100000_clo_corrective_action_review.sql` - per-company review settings (`closure_review_config`),
  review columns on `corrective_actions` (status vocabulary unchanged), append-only
  `corrective_action_review_events`, the submit / review / exception writers and the guard trigger.
- `20261116101000_clo_checklist_acknowledge_exception.sql` - depends on the file above. Adds the
  `acknowledged` checklist outcome, `acknowledge_checklist_faults()`, `v_checklist_fault_compliance`,
  append-only `checklist_decision_events`, and per-company extra final signer roles. Contains one
  `drop constraint` + `add constraint` pair (a CHECK cannot be widened in place), so the MCP confirm
  prompt will appear. The blocking-mark rule (`guard_checklist_approval_stages`) is not touched.

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
