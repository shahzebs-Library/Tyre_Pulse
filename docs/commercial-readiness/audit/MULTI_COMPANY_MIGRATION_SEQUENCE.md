# Going multi-company: the ordered migration sequence

Date 2026-11-15. Stream COMMERCIAL2. Every file named here is a draft in `supabase/pending_migrations/`.
**Nothing was applied to production. Single-company mode and plan enforcement stay exactly as they are.**
Run and measured on a local PostgreSQL 16 copy with three synthetic companies (Alpha = stands in for the
current company, Beta, Gamma). Production is PostgreSQL 17.6 and was only read (counts).

## How it was run

`supabase/tests/multi_company_sequence/run_sequence.py` copies the staging baseline, shapes the copy like
production (current company with NO subscription row, 52 vehicles and 9 approved members against trial caps
of 25 and 3, one custom role stored as global matrix rows, made-up sign-in addresses), then applies each
draft in one transaction and compares a 191-fact snapshot of the current company with the baseline.

Production facts the shape mirrors (aggregates read on 2026-11-15): 5 organisations, 0 subscription rows,
1,618 vehicles and 767 approved members in the current company, 1,346 global role rows of which 32 custom
role names, 0 per-company role rows, 0 repeated usernames, 765 of 781 accounts on a made-up address,
0 usernames or employee ids containing a slash, single_tenant_mode = true, none of the draft objects present.

## Result

| # | Draft | Needs | Applied | Current company after the step |
|---|---|---|---|---|
| 1 | 20261113100000 ten1 job card conflict guard | none | pass | unchanged |
| 2 | 20261113100500 ten1b work order key per company | 1 | pass | unchanged |
| 3 | 20261113101000 ten2 raw upload tables wall | none | pass | unchanged |
| 4 | 20261113102000 ten3 platform tables super admin write | none | pass | unchanged |
| 5 | 20261113103000 ten4 admin RPCs same company | none | pass | unchanged |
| 6 | 20261113104000 ten5 subscription write guard | none | pass | unchanged |
| 7 | 20261113110000 ten6 entitlement path (switch OFF) | 6 | pass | unchanged |
| 8 | 20261113111000 ten7 per-company configuration | 7 | pass | unchanged |
| 9 | 20261113112000 ten8 company id resolvers | 8 | pass | unchanged |
| 10 | 20261113113000 ten9 lifecycle, invitations | 9 | pass | unchanged |
| 11 | 20261113114000 ten4b permission map same company | 8 | pass | unchanged |
| 12 | 20261113114500 ten5b organisation plan columns | 6 | pass | unchanged |
| 13 | 20261113115000 ten7b accident mailbox keys | 8 | pass | unchanged |
| 14 | 20261113150000 com settings foundation | none | pass | unchanged |
| 15 | 20261113151000 com accident mail per company | 14 | pass | unchanged |
| 16 | 20261113152000 com elevated notifications scope | none | pass | unchanged |
| 17 | 20261113153000 com alert thresholds scope | none | pass | unchanged |
| 18 | 20261113154000 com scrap mark guard | none | pass | unchanged |
| 19 | 20261113154500 com scrap mark key per company | 18, plus client line `src/lib/api/tyreExchange.js:48` in the same release | pass | unchanged |
| 20 | 20261113155000 com warranty claim number per company | none | pass | unchanged |
| 21 | 20261113156000 com settings resolvers | 14 | pass | unchanged |
| 22 | 20261115160000 ten6b enforcement preflight and guarded switch (new) | 7, 8 | pass | unchanged |
| 23 | 20261115161000 ten7c role matrix readable by own company only (new) | 8 | pass | unchanged |
| 24 | 20261115162000 ten8b invitation preview, company code (new) | 10 | pass | unchanged |
| 25 | 20261115163000 ten9b sign-in resolver with company code (new) | 24, 8 | pass | unchanged |
| 26 | 20261115164000 ten10 company file folders (new) | none | pass | unchanged |
| 27 | 20261115165000 ten11 AI spend and budget per company (new) | 8 | pass | unchanged |
| 28 | 20261115166000 ten12 company administration record (new) | 10, 14 | pass | unchanged |
| 29 | 20261115167000 ten13 company export of own data (new) | 28 | pass | unchanged |
| HOLD | 20261115169000 ten9c per-company usernames (new) | 25 and client work | pass | unchanged |

Steps 14 to 21 (the COM group) were also applied alone on a fresh copy, 8 of 8 pass, so they do not depend on
the TEN group and can ship before it.

30 of 30 applied (29 steps and the HOLD step), 0 failed. 0 steps changed any of the 191 current-company facts.
Round 2 draft tests: 87 of 87 pass. Company isolation and first-use tests (steps 26 to 29 and the whole
sequence): 93 of 93 pass. Status per finding: `TENANCY_STATUS.md`. Isolation suite (`supabase/staging/tests/run_tests.py`, sections A to D)
on the final database: 35 of 35 pass; findings TEN-1 to TEN-5 and TEN-9 not reproduced, TEN-6, TEN-7 and
TEN-8 open only on the two switches that ship off. All of this is synthetic data only.

One visible change for the current company that the snapshot does not cover, intended by TEN-6: its
Billing page will show plan "Internal", active, instead of a made-up trial. The page was not rendered.

## The check after each step

Run on a branch or staging copy as a current-company Admin, Manager and one field role, before and after:

1. `select md5(public.get_user_module_permissions()::text);` identical.
2. Row counts of vehicle_fleet, tyre_records, work_orders, inspections, accidents, parts_consumption identical.
3. An Admin adds a vehicle with site `nhc-st`: stored in the current company, site `NHC`.
4. `select public.get_email_by_identifier('<a field username>');` same address as before.
5. From step 9 on: `select public._legacy_config_org();` is the current company id.
6. From step 7 on: `select value from system_config where key in ('entitlement_enforcement','single_tenant_mode');`
   is `off` and `true`.

The runner automates 1 to 4 for every synthetic user and adds stored-data checksums.

## Switches, in the order they may be turned (each is an owner decision, none is turned by a draft)

| Switch | Turned with | Precondition | Undo |
|---|---|---|---|
| Plan enforcement | `admin_set_entitlement_enforcement(true, reason, accept)` | `entitlement_enforcement_preflight()` shows the current company refused nothing; every other company's refusals reviewed | same function with `false`: immediate, no data change |
| Single-company mode off | update of `system_config.single_tenant_mode` by a super admin | invitation sign-up live in the web and Flutter forms; import runbook sets `tp.import_org`; step 24 applied | set back to `true`: immediate |
| Per-company usernames | the HOLD file | see below | only while no cross-company duplicate exists |

## The point of no easy return

Everything up to step 25, and both switches, can be undone by re-creating a function, relaxing a policy or
setting a row back. No business row is rewritten by any draft (checked by the stored-data checksums).

**The HOLD file is the point of no easy return.** It removes the five keys that keep usernames and employee
ids unique across all companies. From the first moment two companies hold the same name, those keys cannot
be put back until a real person's account is renamed (shown in the run: re-adding the key fails). Do not
apply it until: the sign-in function uses `resolve_sign_in_user`; new-company sign-up builds
`<username>+<company code>@users.tyrepulse.app`; and a sign-in test on web and Flutter passed on a hosted
staging project. Steps 1 to 25 do not need it: until then a second company simply cannot reuse a name
that exists elsewhere (the sign-up is refused and lands nowhere).

## Rollback per group

| Group | Rollback |
|---|---|
| Steps 1 to 21 | as written in each file header (function bodies are kept in `_fn_backup_*` tables by the drafts that patch live bodies) |
| 22 ten6b | disable `trg_guard_entitlement_switch`; revoke execute on the two functions |
| 23 ten7c | `alter policy module_permissions_own_company_read on public.module_permissions using (true);` |
| 24 ten8b | re-run the `_signup_context` body from step 10; revoke `get_invitation_preview` from anon |
| 25 ten9b | re-create the two functions from `public._fn_backup_ten9b` |
| 26 ten10 | `alter policy storage_company_folder_wall on storage.objects using (true) with check (true);` |
| 27 ten11 | the reverse replacement block in its header |
| 28 ten12 | disable the six `trg_org_audit_*` triggers |
| 29 ten13 | revoke execute on the two functions from authenticated |
| HOLD | the five statements in its header, only while no cross-company duplicate exists |

## Not verified

- Production (PostgreSQL 17.6), a hosted Supabase project, PostgREST, real Auth and the edge functions.
- The web, Flutter and Expo clients against the after-state. No client sends `invite_token`,
  `company_code` or a `code/name` identifier yet.
- Timing on production-sized tables. The role matrix policy adds one lookup per query; the sign-in
  resolver adds one array aggregate per sign-in. Neither was timed on real volumes.
- The local runner needs the staging folder from PR #508; it is not in this branch.
