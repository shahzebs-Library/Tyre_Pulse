# 18 - Tenant Isolation Review

| Field | Value |
|---|---|
| Deliverable | 18 of 29 |
| Date | 2026-11-10 |
| Status | Partly built. The database tenant wall is real and enforced (RESTRICTIVE org policies on 254 tables, only a super admin crosses). It has never been exercised by two live tenants with real data: 768 of 769 profiles and all real data sit in one organisation. Gaps: a few tables with no org predicate, super-admin reads unbounded by support sessions, background jobs that process all tenants, audit country attribution pending. |
| Evidence | Live read-only queries 2026-11-10 (marked live). Code: `src/lib/supabase.js`, `src/lib/api/supportSessions.js`, `src/lib/api/_client.js` (`applyCountry`, `applyCountries`), migrations V306, V307, V311, V314, V396, V542, V545 to V576, V579, V580, V318. History from PROJECT_MEMORY.md. |
| Related docs | [06 Hierarchy](06-organization-hierarchy-model.md), [07 Access](07-master-access-control.md), [17 Security](17-security-audit.md) |

## 1. The isolation model in one picture

```
org wall      organisation_id = app_current_org()  OR is_super_admin()      RESTRICTIVE, every command
  country     country is null OR country in my scope OR super admin          RESTRICTIVE, select + V542 writes
    site      site is null OR site in my sites ('ALL' = all) OR Admin/super  RESTRICTIVE select (+ writes V542)
      role    permissive policies + app_user_can(module, cap)                  OR-ed grants
```

- `app_current_org()` = `select org_id from profiles where id = auth.uid()` (live definition). `profiles.org_id`
  and `organisation_id` are kept equal by trigger `tr_sync_profile_org` (V311); live: 0 mismatches.
- Scope readers are zero-argument and wrapped `(select ...)` so they run once per query (V396).
- A row with NULL country or NULL site is visible to everyone inside the org, by design.
- New business rows get `organisation_id` from `app_current_org()` defaults; service-role and dashboard CSV
  imports are stamped by `trg_stamp_import_default_org` (V290, Company A constant - single-tenant
  assumption, must become per-context before a second tenant uses the dashboard importer).

## 2. Live inventory

| Measure | Value (live) |
|---|---|
| Organisations | 5: Default Organisation (768 profiles, 1,618 fleet, 11,392 tyres), Tyre Pulse Demo Fleet (1 profile, 4 fleet, 18 tyres), and three empty country orgs (UAE, Egypt, KSA: 0 members, 0 rows) |
| Tables with `organisation_id` | 362 |
| Tables with an `app_current_org` policy | 334 |
| Tables with `organisation_id` but no org predicate | 28 (below) |
| Org isolation policies (named) | 254 tables |
| Country isolation | 213 tables |
| Site isolation | 62 tables |
| Profiles with NULL org | 0 |

The 28 tables without an org predicate, by how they are actually protected:

| Protection | Tables |
|---|---|
| Super admin only | `admin_row_changes`, `dup_resolve_archive`, `push_delivery_receipts`, `reclassify_log` |
| Own rows only (`user_id = auth.uid()`) | `ai_conversations`, `ai_usage_log` |
| Parent-record EXISTS (inherits parent RLS) | `warranty_claim_events` |
| Scoped function | `approval_execution_requests` (`approval_workflow_visible`) |
| Uploader or elevated role, NO org term | `pending_uploads` (latent cross-tenant for elevated users) |
| Any elevated role, NO org term | 12 country staging tables `stg_assets_*`, `stg_complaints_*`, `stg_monthly_tyres_*`, `stg_open_wo_*` (_ksa, _uae, _egypt). Empty by design (BEFORE INSERT pipes return NULL), so latent. |
| No permissive policy = deny-all | counters, `stg_monthly_tyres_audit`, `checklist_template_revisions`, `workshop_status_notices`, `_current_km_snapshot_v407` |

## 3. Boundary by layer

| Layer | State | Notes |
|---|---|---|
| Database tables | Built | RESTRICTIVE org wall; V306/V314 removed the plain-Admin bypass so only super admin crosses. |
| Writes | Built | V542 FOR ALL with WITH CHECK; org defaults on insert. |
| SECURITY DEFINER functions | Built, by convention | RLS never runs inside them (owner has BYPASSRLS; V580). V548, V551, V570 added org re-checks; functions that took an org id argument were revoked from `authenticated` (V378 lesson). Proven cases fixed: `get_console_users` returned 38 profiles across orgs with emails; `get_console_stats` / `count_records_with_extra_fields` returned one identical payload to every user; `consume_event_accident_notify` was forgeable by a Tyre Man. |
| Views | Built | 0 owner-rights views (V543 fixed two that leaked 249 and 6,220 rows to an Egypt-only director). |
| Storage | Built | Private buckets; 31 policies; vehicle photo paths `<org>/<COUNTRY>/<ASSET>/...`; photo delete requires `storage_object_in_my_org` (V314). The UPDATE policy on the vehicle-photo bucket has no org check (memory open item; path prefix prevents cross-org overwrite in practice). |
| Edge functions | Built | Self-validate JWT, resolve org from the caller; service-role functions (send-scheduled-reports, tenant-export) scope by org explicitly. A null-org report schedule used to digest across tenants; all 7 schedules were backfilled to an org (memory 2026-09-13). |
| Public share links | Built | Anon RPCs (`get_report_snapshot`, `get_workshop_snapshot`, `get_accident_portal_snapshot`, `get_display_snapshot`) derive org from the token row; no table granted to anon. |
| Caches | Built | `brain_cache` keyed by org; `ai_response_cache` and `document_chunks` not client-readable (20260930120000, was cross-tenant). |
| Background jobs (pg_cron) | Partly | Jobs run as owner across all orgs (backup, due alerts, upload gap, SLA scans). Each consumer is responsible for org scoping; `notify_elevated_users()` is NOT org scoped (V486b avoided it for upload gaps; other callers remain). |
| Reporting and exports | Partly | Reads go through RLS; tenant export (`tenant-export` edge fn) safelists 37 tables per org. |
| Platform support access | Partly | `support_sessions` + `start_support_session` (V318) record and audit, but `app_current_org()` does not consult them: a super admin reads every org at all times. 0 sessions live. |
| Audit log | Partly | `audit_log_v2` has a correct org wall (column `org_id`, IS NOT DISTINCT FROM). Country is NULL on 571,989 of 578,281 rows, so a country-scoped admin reads other countries' audit payloads (V579, 31,618 rows measured 2026-08-17). Fix hides history; owner decision pending. |

## 4. Known history worth keeping

- 9 KSA users were once in the wrong org and saw zero data; moved into Company A (2026-07-14).
- The Egypt Director (only user outside Company A) was deleted on owner instruction (2026-09-25); the Egypt
  org is now empty. Tenant-wall tests now rely on the Demo Fleet org (1 user, 4 vehicles, 18 tyres).
- `is_admin_or_above()` compares lowercase to Title Case and is false for everyone; repairing it would open a
  cross-tenant hole on `accident_audit_log`. It is load-bearing by accident and must NOT be "fixed"
  (memory 2026-08-16); dependent policies were retargeted to `is_super_admin()`.
- `app_can_see_country()` returns a definite false with no JWT since V558; older rules telling backend callers
  to use `is not false` are stale.

## 5. Isolation test matrix

Run each as an impersonated user in a ROLLED-BACK transaction (`set local role authenticated` +
`request.jwt.claims`), counting with a privileged reader in the same transaction for writes (a blocked write and
an invisible write both read as 0 from inside the session). One user per transaction (STABLE scope readers
cache within a statement).

| # | Actor | Action | Expected | Covers |
|---|---|---|---|---|
| T1 | Demo Fleet Admin | select `vehicle_fleet`, `tyre_records`, `work_orders`, `parts_consumption` | Only Demo rows (4 / 18 / ...) | org wall reads |
| T2 | Demo Fleet Admin | insert `tyre_records` with `organisation_id` = Company A | Refused | org WITH CHECK |
| T3 | Demo Fleet Admin | update a Company A row by id | 0 rows, privileged recount unchanged | org UPDATE |
| T4 | Demo Fleet Admin | call every `get_*` / `report_*` RPC with no args and with country args | Demo data only, md5 differs from super admin | definer org re-checks |
| T5 | Demo Fleet Admin | `get_console_users`, `admin_*` RPCs | 42501 | console functions |
| T6 | KSA-only Manager | select UAE rows on 213 country tables | 0 | country reads |
| T7 | KSA-only Manager | insert UAE row | Refused (V542) | country writes |
| T8 | KSA-only Manager | RPCs with `p_country='UAE'` and with NULL/'All' | Own country only | definer country paths (V545, V549) |
| T9 | User narrowed to `sites={NHC}` | select DIRIYAH rows; RPCs with p_site and with NULL | 0 / own site | site reads + definer site paths (all-sites path is the known open item) |
| T10 | Blank-scope user | any scoped table | 0 rows | V309 |
| T11 | anon | every public table, every anon RPC with junk token | Permission denied / `{ok:false}` | anon lockdown |
| T12 | Company A Admin | set own `is_super_admin`, move user to another org | Refused | V307 |
| T13 | Company A Admin | demote last active admin | Refused | V308 |
| T14 | Demo Fleet user | storage: read/overwrite/delete an object under Company A prefix | Refused | storage policies |
| T15 | Super admin without support session | read Demo org | Allowed today (gap); after fix: refused without session | support sessions |
| T16 | Demo Fleet user | open a Company A share token | Shows Company A board only (token is the authority), cannot pivot to other data | share links |
| T17 | cron / service role | each scheduled job | Writes carry the source row's org; notifications reach only same-org users | background workers |
| T18 | KSA-scoped Admin | read `audit_log_v2` payloads naming UAE | Today visible (V579 gap) | audit attribution |

Pass criteria: every expected result met, plus a regression test per finding in `supabase/tests` (PGlite) or
`src/test`. Automate T1 to T14 as a SQL script that loops users and tables and diffs counts.

## 6. Recommendations

1. Add an org predicate to `pending_uploads` and the 12 country staging tables.
2. Make `app_current_org()` honour an active support session for super admins, and require one to read a
   tenant other than the platform org.
3. Replace the Company A constant in `stamp_import_default_org` before onboarding a second tenant.
4. Make `notify_elevated_users()` org scoped (one signature change, update callers).
5. Decide V579: attribute audit country (hides history from country-scoped admins) or accept.
6. Close the all-sites path in the nine site-aware definer functions (unreachable today, 0 narrowed users).
7. Seed a second realistic tenant in a branch database and run the matrix in CI.

## Open decisions for the owner

- Apply V579 audit country attribution (a KSA-scoped admin loses about 40k rows of history, per memory)?
- Should super admins need a support session to view a tenant?
- When will a second real company be onboarded (drives items 2, 3, 4)?

## Next actions

1. Phase 1, S: org predicate on `pending_uploads` and staging tables; regression tests.
2. Phase 1, M: implement T1 to T14 as a rerunnable SQL harness; run against the Demo Fleet org.
3. Phase 3, M: support-session retargeting; per-context import stamping; org-scoped `notify_elevated_users`.
4. Phase 3, S: decide and apply (or close) V579.
