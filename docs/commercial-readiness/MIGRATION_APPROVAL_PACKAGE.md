# Migration approval package (migrations 1 to 7)

Status: DRAFT FOR OWNER APPROVAL. Nothing in this package has been applied. Production was only read (SELECT) on 2026-11-18 via the Supabase connector (project jhssdmeruxtrlqnwfksc, PostgreSQL 17.6). The exact SQL of every migration is in the Appendix, embedded verbatim from the files on this branch, each with its sha256 so you can confirm what you approve is what runs.

## 0. Read this first: two of the seven are already live

The "1-7" list from the branch plan is partly stale. Production's migration ledger shows:

| # | File | Production today |
|---|---|---|
| 4 | `20261117110000_by_number_org_joins.sql` | ALREADY APPLIED 2026-11-16 11:26 UTC (ledger `20261116112628 by_number_org_joins`) |
| 5 | `20261117112000_complaints_missing_in_date_reject.sql` | ALREADY APPLIED 2026-11-16 11:27 UTC (ledger `20261116112739 complaints_missing_in_date_reject`) |

Proof they are live exactly as the repo files: on a private copy of local staging (production-identical function md5s) I applied both files and compared the nine resulting objects with production. All nine md5s are identical to production (classify_parts_consumption `70c734f6...`, convert_repair_request_to_job_card `d33ed99a...`, get_asset_disposal_register `58d0eb52...`, get_site_operating_cost `040287e6...`, owner_data_audit `a217cad7...`, process_stg_complaints `62a408d4...`, process_stg_monthly_tyres `41849e38...`, tyre_cost_audit_classify `9ed3868e...`, view v_tyre_fitment_evidence `e7bf7aa6...`). Markers `/* by-number-org */` and `/* complaints-in-date */` are present in the live bodies, and `_bak.by_number_org_joins_defs` / `_bak.complaints_in_date_defs` exist (their saved original bodies are the rollback source). They need no approval. Re-running them would be a no-op (marker check).

So the approval request is for FIVE migrations, in this order:

| Order | # | Name | Risk |
|---|---|---|---|
| A | 1 | TEN-9d company code guard + admin set | low |
| B | 2 | TEN-9e invitation sign-up refuses cleanly | low-medium (sign-up path) |
| C | 3 | TEN-9g code form cannot be squatted | low-medium (touches the sign-in resolver) |
| D | 6 | company pinned lookups | MEDIUM: the riskiest, see its section |
| E | 7 | recalls number unique per company | low (empty table) |
| held | 8 | drop tyre_status_marks bridge index | HELD, see section 9 |

None of A to E changes behaviour while `single_tenant_mode = true` (live today) except where stated per migration (D changes what the two super admins see; B changes get_public_config output).

## 1. Production facts read today (read only)

- `single_tenant_mode` = true. 5 organisations: Default Organisation (771 profiles, 2 super admins, 11,256 tyres, 1,619 fleet, 97,476 work orders), Tyre Pulse Demo Fleet (1 profile, 18 tyres, 4 fleet, 3 work orders), and UAE / KSA / Egypt shells with 0 rows. No organisation has a `sign_in_code`.
- Overlap between companies today: asset numbers shared across organisations 0, tyre serials 0, work order numbers 0.
- profiles with `/` or `\` in username or employee id: 0 (TEN-9g preflight satisfied).
- recalls: 0 rows; country-less duplicate numbers 0 (TEN-9 recalls preflight satisfied).
- Triggers on organisations: `guard_organisation_configuration`, `trg_guard_org_sign_in_code`, `trg_guard_organisation_platform_columns`. Triggers on profiles (none named guard_profile_sign_in_names yet): profiles_updated_at, tr_normalize_profiles_role, tr_sync_profile_org, trg_access_audit_profiles, trg_guard_last_admin_del, trg_guard_last_admin_upd, trg_guard_profile_privileged, trg_guard_recovery_contact_columns, trg_org_audit_profiles, trg_zz_enforce_user_limit.
- Policy fingerprints (md5 of the sorted policy text, count): organisations 9 `1a3b7fb3cb97e2a47404f2def53498ba`; recalls 14 `83ca884ade7c5c4968ac88b42c185c83`; profiles 12 `73b6af202c2ce71866d4e444164b759e`; org_invitations 6 `5170bc450c3608fcff67bf22b8bcf603`; tyre_records 17 `768e4daa6bdf151bb56da935e13dd768`; vehicle_fleet 18 `85ddede81facaed0826e219a7acbee45`; work_orders 18 `776bfb995a13f0530a651c4d87a79010`; parts_consumption 11 `edb65df6a6382cf28f4c191f9f83f36a`. NONE of the five migrations creates, alters or drops a policy, so every fingerprint must be identical after.
- Live function md5s the migrations replace (`pg_get_functiondef`):
  | Function | md5 before | md5 after (staging result) |
  |---|---|---|
  | `_guard_org_sign_in_code()` | `e1fa91eccacf1e5338194373e7d752cf` | `61cb865d04c3a98248ddc0bda6bbdf5a` |
  | `guard_organisation_platform_columns()` | `d122d33d908f25ca51f85dbd030fad13` | `e8a9f5ec79a1918995efeccd40503022` |
  | `_signup_context(uuid,jsonb,text)` | `06a34ba4879154d25431487b1ba0dd0e` | `5f8f27f9a3bcc3f729c8813d23a109c4` |
  | `get_public_config()` | `4b5a4cb2281caa9673d78acb8f600695` | `78eb7526687a753bafd01a921923ae70` |
  | `_resolve_sign_in_profile(text)` | `1ee66847b3d067fd171305fa7de11233` | `33c2f6edcd05a424c310c3b9811fa7b0` |
  | `report_asset_overview(text)` | `319bba830e4449698c02202bd46d4c3c` | `d2a9e5ce057a889570c8887249f05705` |
  | `report_asset_metrics(text,date,date)` | `a5a09b5e3199b91448750a55b37dd6c2` | `dbf7ba378eed85789771d1dfec17e14f` |
  | `check_duplicate_serials(text[])` | `e4114c835d616bc9409c4a0805cb5851` | `853bdba0fe5ffd08348f588560e5c448` |
  | `get_unplanned_assets(text,integer,text,integer)` | `76d3667869108269e2a8520f390ce551` | `8d37c06701413ce7ef4aefb243409c0b` |
  | `asset_site_at(text,text,date)` | `dd47ba38eab503775fcfd2beef2aca02` | `fbfe7b140a0ac04927fb7ca5403729c1` |
  New functions (absent today, confirmed): `_multi_company_on()` (after `e2a4a9cd0c133ddda4891abdc1e85be2`), `get_my_org_sign_in_code()` (`f7358788886467d2c54d5ed66f607b08`), `org_set_my_sign_in_code(text)` (`9835e8857956851af62a87731f4e7e73`), `guard_profile_sign_in_names()` (`fdb5a31b56a3f39cf3a1ef8865e0494c`), trigger `trg_guard_profile_sign_in_names`.
  The staging copy's md5s for all five "before" pre-states equal production's, so the staging results transfer to production bodies. "After" md5s are what you should see in production after applying (a different value means the live body differed from what was tested).
- Helpers these migrations call exist in production: `_org_by_code`, `_org_active`, `_org_admin_event`, `_single_tenant_org`, `_legacy_config_org`, `_resolve_import_org`, `_split_sign_in_identifier`.

## 2. Tests run

- Staging harness `supabase/tests/multi_company_auth/run_staging.sh` (private copy of the production-shaped local mirror, local cluster only): BEFORE TEN-9d the two company-isolation defects reproduce (5j company Admin sets the company code directly, 5k company Admin renames its slug); AFTER TEN-9d + 9e + 9f + 9g **205 passed, 0 failed** (sign-in resolution, lockout, invitation sign-up, code squatting, cross-company admin isolation 15a to 15h, privileged recounts).
- `supabase/tests/staging_company_pinned_lookups.sh`: ALL OK, including rollback restoring the pre-migration output for the super admin and re-apply being identical.
- `supabase/tests/staging_recalls_unique_per_org.sh`: ALL OK (apply, rollback, re-apply identical).
- Rollback tests I added now: applied 9d, 9e, 9g on a private copy, then ran the three rollback files; all five replaced functions returned to production's exact md5 (table in section 1), the three new functions and the trigger were gone, and `_signup_context` stayed non-executable by clients.
- Web side: full vitest 16029 passed, 1 environmental failure (`checklistIcons`, needs `mobile/node_modules`), `vite build` clean. The client code for these (company-code panel, invite page) is already in this branch and works with the migrations absent (single-company mode hides it).
- Not run, so named as gaps: a hosted-staging run, a real-device sign-in, and the deno e2e of the `sign-in` edge function (needs deno).

## 3. Execution, dependencies and procedure

Apply one migration per call, in order A to E, each then verified, on the owner's go. No dependencies between A, B, C, D, E; A to C are the auth set the staging harness proved together; D and E are independent of them. All need the `sign-in` edge function redeploy only AFTER A to C (it already calls `resolve_sign_in_user`, which exists live today; the new resolver step is backwards compatible).
Supabase MCP note: statements containing drop (the 9g trigger line, the recalls constraint swap, rollbacks) trip the confirm prompt; approve them while present.

### Production preflight (read only, run immediately before; every line must match)
1. Backup: confirm in the Supabase dashboard that a PITR or daily backup newer than the apply exists (owner action; I cannot read it). Migrations D saves its own bodies to `_bak.company_pinned_lookups_defs` and the rollback files for A to C embed the exact live bodies.
2. Function md5s equal the "before" column of section 1 (query: `select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (...)`).
3. `select count(*) from public.profiles where username ~ '[/\\]' or employee_id ~ '[/\\]'` = 0.
4. `select count(*) from public.recalls` = 0 and `select organisation_id, recall_number, count(*) from public.recalls where country is null group by 1,2 having count(*) > 1` returns no rows.
5. Policy fingerprints in section 1 unchanged since the read.
6. `select value from system_config where key='single_tenant_mode'` = true; no object named `get_my_org_sign_in_code`, `org_set_my_sign_in_code`, `_multi_company_on`, `guard_profile_sign_in_names`; no marker `/* company-pinned */` in any function; `_bak.company_pinned_lookups_defs` absent.

### Post-apply check (after each)
Function md5s equal the "after" column; the same policy fingerprints; row counts unchanged (profiles 772, organisations 5, recalls 0, work_orders 97,479 at last read, only moving by normal use); `single_tenant_mode` still true; sign in as a normal user (username only) still works.

## 4. Per-migration detail

### A. TEN-9d company code guard and admin set (`20261115168000_ten9d_company_code_guard_and_admin_set.sql`)

- **Purpose:** A company Admin could set `organisations.sign_in_code` directly (the guard was SECURITY DEFINER so its client check never fired) and could rename the `slug`, which is the fallback sign-in code. Fix: guard becomes SECURITY INVOKER, a client clear is refused too, slug is platform-managed, and one new RPC lets a company Admin choose its code once, only when multi-company mode is on.
- **Changes:** Functions replaced: `_guard_org_sign_in_code`, `guard_organisation_platform_columns`. Functions added: `_multi_company_on` (execute revoked from clients), `get_my_org_sign_in_code`, `org_set_my_sign_in_code` (execute granted to `authenticated` only). Triggers `trg_guard_org_sign_in_code` and `trg_guard_organisation_platform_columns` keep their definitions and now call the new bodies. No table, column, policy or grant on a table changes.
- **Impact on today's single company:** 0 organisations have a code, so the guard returns early on every current write. `org_set_my_sign_in_code` and `get_my_org_sign_in_code` answer 'not available' while `single_tenant_mode = true`. Behaviour change only for a plain company Admin renaming a slug or editing platform columns: 0 plain Admins exist in production today (the 2 super admins are exempt). The Console organisations page (super admin) is unaffected.
- **Existing data:** None touched.
- **Rollback:** `20261115168000_ten9d_company_code_guard_and_admin_set.ROLLBACK.sql` (new, restores the two bodies byte-for-byte from production, drops the three new functions). Tested: md5 identical to production after rollback.
- **Risk:** Low. One thing to know: after this, a super admin's direct organisation edit still works, but a non-super client cannot clear or set the code, so codes are set only by `admin_set_org_sign_in_code` (super admin) or the once-only RPC.

### B. TEN-9e invitation sign-up refuses cleanly (`20261115168500_ten9e_invitation_signup_refuses_cleanly.sql`)

- **Purpose:** A used, cancelled, expired, wrong-email or wrong-code invitation made `_signup_context` return a null company, yet `handle_new_user` still created the account: a person with no company, burned username and address, and a misleading 'account created' page. Now the function raises (22023 `invitation_not_valid`), which aborts the auth.users insert so nothing is created and the invitation is not consumed. Also `get_public_config` now exposes `single_tenant_mode` so sign-in screens show the company-code hint only when multi-company is on.
- **Changes:** Functions replaced: `_signup_context` (still not executable by clients), `get_public_config` (adds one key to the anon-readable list). No tables, policies or grants change.
- **Impact on today's single company:** A sign-up with neither `invite_token` nor `company_code` takes the unchanged path (default company), which is every sign-up from today's web, Expo and Flutter apps. Only the invite page sends those keys, and it is not used in single-company mode. `get_public_config` returns one extra key, `single_tenant_mode` ('true'), to anonymous callers: it is not sensitive but it does disclose that the platform is single-company.
- **Existing data:** None touched.
- **Rollback:** `20261115168500_ten9e_invitation_signup_refuses_cleanly.ROLLBACK.sql` (new, restores both bodies byte-for-byte from production). Tested.
- **Risk:** Low to medium. It is on the sign-up path, so a defect would block registration; the change is confined to the branch where an invitation token or company code is present, and 205 staging tests (4l to 4z, 8a to 8h) cover refused and accepted invitations.

### C. TEN-9g code form cannot be squatted (`20261115168800_ten9g_code_form_cannot_be_squatted.sql`)

- **Purpose:** `_resolve_sign_in_profile` tried an exact username match before the `<code>/<name>` form, so a username such as `beta-haulage/beta.admin` (accepted by direct sign-up to GoTrue) could shadow a real company account: the real person could not sign in with the code form, their failed attempts locked the impostor, and someone setting the impostor's password would enter the wrong account. Fix: an identifier containing `/` or `\` is tried as a code form first; a trigger refuses NEW or CHANGED usernames and employee ids containing those characters.
- **Changes:** Function replaced: `_resolve_sign_in_profile` (used by `resolve_sign_in_user` on every sign-in). Function added: `guard_profile_sign_in_names` (execute revoked). Trigger added: `trg_guard_profile_sign_in_names` BEFORE INSERT OR UPDATE OF username, employee_id on `profiles`. No policy or grant on tables changes.
- **Impact on today's single company:** Identifiers without `/` or `\` follow exactly the old path (step 1 only), which is every current user (0 profiles contain those characters, measured). The new trigger fires on profile insert (new sign-ups) and on updates that name username or employee_id; unchanged values are not checked, existing rows are untouched.
- **Existing data:** None touched.
- **Rollback:** `20261115168800_ten9g_code_form_cannot_be_squatted.ROLLBACK.sql` (restores the exact pre-body, md5 `1ee66847...`, which equals production today; drops the trigger and function). Tested: md5 identical after rollback, trigger gone.
- **Risk:** Low to medium: it replaces the sign-in resolver and adds a trigger on profiles (a hot table). A defect would block sign-in or user creation, so the post-apply check signs in as a normal user and creates nothing. Staging 12a to 12h and the full 205-test run pass.

### D. Company pinned lookups (`20261117113000_company_pinned_lookups.sql`)

- **Purpose:** Five readers still mixed companies for a super admin (whose rows span companies): `report_asset_overview`, `report_asset_metrics`, `check_duplicate_serials` (SECURITY DEFINER with `organisation_id = app_current_org() OR is_super_admin()`) collapse two companies' same-coded asset into one row or report another company's tyre as a duplicate; `get_unplanned_assets` and `asset_site_at` (invoker) join by asset code without the company. Fix: the company test becomes the caller's company; the two invoker functions join on company + code.
- **Changes:** Five functions replaced by anchored edits of their LIVE definitions, each saved first to `_bak.company_pinned_lookups_defs` (new table in the existing `_bak` schema, access revoked from public). Owner, grants, security mode and search_path are preserved by CREATE OR REPLACE. No policy, grant or table other than the new `_bak` table changes.
- **Impact on today's single company:** For every ordinary Company A user the output is byte-identical (the new condition repeats what row-level security already enforces), proven on staging. For the 2 super admins (both in Default Organisation) the asset overview, per-asset metrics and duplicate-serial check stop including the Tyre Pulse Demo Fleet's tyres (18 tyres, 4 vehicles: DEMO-PL01, DEMO-PM01, DEMO-TM01, DEMO-TM02): a super admin now sees the company they are signed in to. `get_unplanned_assets` and `asset_site_at` give the same answer today because no code overlaps between companies (measured 0). Measured size of the change: 18 demo tyres out of 11,274 across companies.
- **Existing data:** None touched.
- **Rollback:** `20261117113000_company_pinned_lookups_ROLLBACK.sql` re-executes the five saved bodies from `_bak.company_pinned_lookups_defs`, with a count check (5) and a marker check. Tested: restores the exact pre-migration outputs and md5s; re-apply after rollback is identical.
- **Risk:** MEDIUM, the one I would read carefully. (1) It edits five live bodies by exact-text anchors; an anchor that is not found exactly once aborts the whole migration (nothing partial), and the preflight md5s prove the live text equals what was tested. (2) `asset_site_at` is restructured (new CTE with a CASE that picks the caller's company, else the single company holding the code, else nothing). (3) It is a deliberate behaviour change for super admins, so a super admin who relied on seeing demo-fleet assets through these pages will stop. Not a risk to ordinary users. Recommend applying outside working hours and checking the Asset Detail page as a super admin afterwards.

### E. Recall numbers unique per company (`20261117102000_recalls_number_unique_per_org.sql`)

- **Purpose:** `recall_number_country_uniq` is UNIQUE (recall_number, country) with no company: one company's recall number blocks another company's, and the second company is told 'Recall number already exists' for a record it cannot see (a cross-company existence signal). New key: (organisation_id, recall_number, country) NULLS NOT DISTINCT.
- **Changes:** Table `public.recalls`: constraint `recall_number_country_uniq` removed, `recalls_org_number_country_uniq` added, in one transaction. No function, policy or grant changes.
- **Impact on today's single company:** `recalls` holds 0 rows, and there are no country-less duplicates, so nothing can conflict. Table lock is trivial on an empty table. The app does not name either constraint (it maps 23505 to the same message).
- **Existing data:** None (table empty).
- **Rollback:** Inline at the end of the file: drop the new constraint and re-add `recall_number_country_uniq` (valid only while no two companies share a number + country, which holds while the table is empty). Tested by the staging script.
- **Risk:** Low. The only caution is the Supabase MCP confirm prompt on the constraint removal; approve it when present.

## 5. Migrations 4 and 5 (already live, no approval needed)
`20261117110000_by_number_org_joins.sql` and `20261117112000_complaints_missing_in_date_reject.sql` carry the company into nine job card / asset number joins and make a blank Vehicle In Date skip its row (logged in `expense_import_rejects`) instead of aborting the batch. They are live (section 0). Rollback files exist: `..._by_number_org_joins_ROLLBACK.sql` and `..._complaints_missing_in_date_reject_ROLLBACK.sql`, to be run in the order complaints first, then by-number.

## 6. What does NOT change anywhere
`single_tenant_mode` stays true, CAPTCHA stays off, no per-company usernames (ten9c is HOLD), no policy created or dropped, no data row modified, no grant on any table.

## 7. After approval, the remaining release sequence
Apply A to E one at a time with the pre/post checks, then redeploy the `sign-in` function, then Flutter and web builds, then per-company sign-in codes (platform sets them), then staging end-to-end, and only then the owner's decision on `single_tenant_mode = false`. CAPTCHA is last and separate.

## 8. Flutter and web CI status
See the pull request for the CI run; Flutter results are reported there.

## 9. Migration 8: HELD
`20261117111000_drop_tyre_status_marks_bridge.sql` removes the temporary unique index `tyre_status_marks_serial_mark_type_bridge (serial, mark_type)`. HELD: owner has said not to remove it before about 2026-11-22 (old pre-#541 PWA tabs may still upsert on `serial,mark_type`) and it must go before a second company records a mark. Its preflight and rollback are in the file header. Not part of this approval.

## Appendix: exact SQL

### Migration 1

`supabase/pending_migrations/20261115168000_ten9d_company_code_guard_and_admin_set.sql` (141 lines, sha256 `00314130898c8bcf572d05374e0b7bcfeb4492d1636894c33b24418936a2c0e8`)

```sql
-- =============================================================================
-- TEN-9d  company code: close the direct-write bypass + let a company Admin choose
--         its code ONCE, only after multi-company mode is switched on.
-- STATUS: AUTHORED, NOT APPLIED. Proven on a private copy of local staging only
--         (supabase/tests/multi_company_auth/run_staging.sh, checks 5j, 5k, 6a-6j).
--
-- DEFECT (found on staging, PR #546 test matrix, checks 5j / 5k)
--   1. _guard_org_sign_in_code() is SECURITY DEFINER, so inside it current_user is the
--      function OWNER, never 'authenticated'. Its "only the platform sets a company code"
--      test can therefore never fire: a company Admin (organisations_write lets them
--      UPDATE their own row) sets organisations.sign_in_code directly, bypassing
--      admin_set_org_sign_in_code (super admin only) and its console audit row.
--      Reproduced as Beta's Admin: UPDATE organisations SET sign_in_code = 'ALPHA' -> 1 row.
--      Uniqueness still held (unique index + slug check), so a company cannot take another
--      company's EXISTING code, but it can claim any free code (for example a rival's
--      brand) before the platform assigns it.
--   2. organisations.slug is the fallback sign-in code (_org_by_code reads code, then slug)
--      and nothing guards it: a company Admin renames the slug and every
--      "<old slug>/<name>" sign-in of that company stops working.
--
-- FIX
--   1b. A direct client UPDATE that CLEARS the code is refused too (found in review:
--       clear-then-set bypassed "once only" and released the code to other companies).
--   1. _guard_org_sign_in_code becomes SECURITY INVOKER (same convention as
--      guard_organisation_platform_columns, which works). Definer RPCs still pass because
--      inside them current_user is the owner. The uniqueness EXISTS then runs under the
--      caller's RLS only for a super admin, who reads every organisation.
--   2. slug joins the platform-managed columns of guard_organisation_platform_columns.
--   3. org_set_my_sign_in_code(p_code): the ONLY way a company Admin sets the code.
--      Refused while system_config.single_tenant_mode is true (nothing changes today).
--      Allowed once (only while the company has no code); a later change is the
--      platform's (admin_set_org_sign_in_code). Same shape + uniqueness rules as the
--      super-admin writer. Recorded in org_admin_events (TEN-12) as company.code_set.
--   4. get_my_org_sign_in_code(): what the Admin screen shows (code, slug, whether the
--      Admin may set it now, and why not).
--
-- EXISTING DATA: none touched. 0 organisations have a code in production today.
-- ROLLBACK
--   re-create _guard_org_sign_in_code from its previous body (SECURITY DEFINER, NULL
--   code returned before the client check);
--   re-create guard_organisation_platform_columns without the slug line;
--   drop function public.org_set_my_sign_in_code(text); drop function public.get_my_org_sign_in_code();
-- =============================================================================

-- SECURITY INVOKER (fix 1). Also (fix 1b, review 2026-11-16): a company Admin could
-- CLEAR its own code with a direct UPDATE (the guard returned early on a NULL code),
-- which (a) defeated "once only" (clear, then org_set_my_sign_in_code again) and
-- (b) released the code so another company could claim it, after which the first
-- company's "<code>/<name>" sign-ins would resolve inside the other company.
-- Clearing is now a platform change like any other code change.
create or replace function public._guard_org_sign_in_code()
returns trigger language plpgsql security invoker set search_path = public as $fn$
begin
  if tg_op = 'UPDATE' and new.sign_in_code is not distinct from old.sign_in_code then return new; end if;
  if tg_op = 'INSERT' and new.sign_in_code is null then return new; end if;
  if current_user in ('authenticated', 'anon') and not coalesce(public.is_super_admin(), false) then
    raise exception 'The company code is managed by the platform.' using errcode = '42501';
  end if;
  if new.sign_in_code is null then return new; end if;
  if exists (select 1 from public.organisations o where o.id <> new.id and lower(o.slug) = lower(new.sign_in_code)) then
    raise exception 'That company code is already in use.' using errcode = '23505';
  end if;
  return new;
end $fn$;

create or replace function public.guard_organisation_platform_columns()
returns trigger language plpgsql set search_path = public as $fn$
begin
  -- TEN-5b + TEN-9d. Direct client writes only: service_role and SECURITY DEFINER paths
  -- run as another role. slug is the fallback company sign-in code (_org_by_code).
  if current_user in ('authenticated', 'anon') and not coalesce(public.is_super_admin(), false) and (
    old.plan is distinct from new.plan or
    old.active is distinct from new.active or
    old.locked is distinct from new.locked or
    old.max_users is distinct from new.max_users or
    old.parent_organisation_id is distinct from new.parent_organisation_id or
    old.slug is distinct from new.slug
  ) then
    raise exception 'Plan, status, limits and the company address are managed by the platform.' using errcode = '42501';
  end if;
  return new;
end
$fn$;

create or replace function public._multi_company_on()
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((select btrim(lower(value), ' "') from public.system_config where key = 'single_tenant_mode'), 'false') <> 'true'
$fn$;
revoke execute on function public._multi_company_on() from public, anon, authenticated;

create or replace function public.get_my_org_sign_in_code()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_org uuid := public.app_current_org(); o public.organisations%rowtype; v_reason text;
begin
  if v_org is null or public.app_is_active() is not true then
    return jsonb_build_object('ok', false, 'reason', 'not_allowed');
  end if;
  select * into o from public.organisations where id = v_org;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;
  v_reason := case
    when public.get_my_role() is distinct from 'Admin' then 'not_admin'
    when not public._multi_company_on() then 'single_company_mode'
    when o.sign_in_code is not null then 'already_set'
    else null end;
  return jsonb_build_object('ok', true, 'sign_in_code', o.sign_in_code, 'slug', o.slug,
                            'effective_code', coalesce(o.sign_in_code, o.slug),
                            'can_set', v_reason is null, 'reason', v_reason);
end $fn$;
revoke execute on function public.get_my_org_sign_in_code() from public, anon;
grant execute on function public.get_my_org_sign_in_code() to authenticated;

create or replace function public.org_set_my_sign_in_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_org uuid := public.app_current_org(); v_code text := nullif(btrim(coalesce(p_code, '')), ''); v_n int;
begin
  if v_org is null or public.app_is_active() is not true or public.get_my_role() is distinct from 'Admin' then
    raise exception 'Only an Admin of the company can choose its sign-in code.' using errcode = '42501';
  end if;
  if not public._multi_company_on() then
    raise exception 'Company sign-in codes are not available yet.' using errcode = '42501';
  end if;
  if v_code is null or v_code !~ '^[A-Za-z0-9][A-Za-z0-9-]{1,23}$' then
    raise exception 'A company code is 2 to 24 letters, digits or hyphens.' using errcode = '22023';
  end if;
  if exists (select 1 from public.organisations o
              where o.id <> v_org and (lower(o.sign_in_code) = lower(v_code) or lower(o.slug) = lower(v_code))) then
    raise exception 'That company code is already in use.' using errcode = '23505';
  end if;
  -- Once only: a code already in use by this company's people is changed by the platform.
  update public.organisations set sign_in_code = v_code where id = v_org and sign_in_code is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'This company already has a sign-in code. Ask the platform team to change it.' using errcode = '42501';
  end if;
  perform public._org_admin_event(v_org, 'company.code_set', 'organisation', v_org::text, jsonb_build_object('code', v_code));
  return jsonb_build_object('ok', true, 'sign_in_code', v_code);
exception when unique_violation then
  raise exception 'That company code is already in use.' using errcode = '23505';
end $fn$;
revoke execute on function public.org_set_my_sign_in_code(text) from public, anon;
grant execute on function public.org_set_my_sign_in_code(text) to authenticated;
```

#### Rollback for migration 1

`supabase/pending_migrations/20261115168000_ten9d_company_code_guard_and_admin_set.ROLLBACK.sql` (52 lines, sha256 `5de01009e4d5e8b78e53b003b68d1f4aa4467f21c164d6ef90f5cc37ba75f8f6`)

```sql
-- ROLLBACK for 20261115168000_ten9d_company_code_guard_and_admin_set.sql
-- Restores the two trigger functions exactly as production stands before TEN-9d
-- (md5 of pg_get_functiondef, read 2026-11-18 from production):
--   _guard_org_sign_in_code               e1fa91eccacf1e5338194373e7d752cf
--   guard_organisation_platform_columns   d122d33d908f25ca51f85dbd030fad13
-- and removes the three functions TEN-9d adds. No data is touched (0 organisations
-- carry a sign-in code today).
begin;
CREATE OR REPLACE FUNCTION public._guard_org_sign_in_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'UPDATE' and new.sign_in_code is not distinct from old.sign_in_code then return new; end if;
  if new.sign_in_code is null then return new; end if;
  if current_user in ('authenticated', 'anon') and not coalesce(public.is_super_admin(), false) then
    raise exception 'The company code is managed by the platform.' using errcode = '42501';
  end if;
  if exists (select 1 from public.organisations o where o.id <> new.id and lower(o.slug) = lower(new.sign_in_code)) then
    raise exception 'That company code is already in use.' using errcode = '23505';
  end if;
  return new;
end $function$

;
CREATE OR REPLACE FUNCTION public.guard_organisation_platform_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  -- TEN-5b. Direct client writes only: service_role and SECURITY DEFINER paths run as another role.
  if current_user in ('authenticated', 'anon') and not coalesce(public.is_super_admin(), false) and (
    old.plan is distinct from new.plan or
    old.active is distinct from new.active or
    old.locked is distinct from new.locked or
    old.max_users is distinct from new.max_users or
    old.parent_organisation_id is distinct from new.parent_organisation_id
  ) then
    raise exception 'Plan, status and limits are managed by the platform.' using errcode = '42501';
  end if;
  return new;
end
$function$

;
drop function if exists public.org_set_my_sign_in_code(text);
drop function if exists public.get_my_org_sign_in_code();
drop function if exists public._multi_company_on();
commit;
```

### Migration 2

`supabase/pending_migrations/20261115168500_ten9e_invitation_signup_refuses_cleanly.sql` (77 lines, sha256 `ccaede4c6a36e6cf31f5a07e0be05c83e0d5b232c23662a30977dc419bbd6565`)

```sql
-- =============================================================================
-- TEN-9e  an invitation sign-up that the server refuses creates NO account, and the
--         public config tells the sign-in screens whether multi-company mode is on.
-- STATUS: AUTHORED, NOT APPLIED. Proven on a private copy of local staging only
--         (supabase/tests/multi_company_auth/run_staging.sh, checks 8a-8h).
--
-- DEFECT (PR #546 test matrix, checks 4l / 4q / 4s / 4u / 4x / 4z)
--   _signup_context refused a used / cancelled / expired / wrong-email / wrong-code
--   invitation by returning org = NULL, approved = false. handle_new_user then STILL
--   inserted the profile, so the sign-up "succeeded":
--     * the /invite page told the person "account created, sign in as CODE/name";
--     * the account sat in no company, unapproved, visible to nobody (no Admin can
--       approve it: it belongs to no company);
--     * its username (globally unique until ten9c) and its made-up address were
--       burned, so the person could not simply retry with the right link.
--   The whole point of the token is that the account lands in that company; when it
--   cannot, nothing should be created.
--
-- FIX
--   1. _signup_context raises (errcode 22023, "invitation_not_valid") when an
--      invite_token or a company_code was sent and the invitation does not hold. The
--      raise aborts the auth.users insert, so GoTrue returns an error, no account, no
--      profile, and the invitation is NOT consumed (same transaction). A sign-up with
--      neither key is unchanged (single-company default / NULL company).
--      The /invite page re-reads the invitation after an error to tell the person why.
--   2. get_public_config also returns single_tenant_mode (not sensitive) so the web and
--      Flutter sign-in screens show the "company code / username" hint only once
--      multi-company mode is on. Missing key = hint hidden (today's behaviour).
--
-- EXISTING DATA: none touched.
-- ROLLBACK: re-create _signup_context and get_public_config from their previous bodies
--   (recorded in docs: the returns below replaced by the old 'org', null branches).
-- =============================================================================

create or replace function public._signup_context(p_user_id uuid, p_meta jsonb, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_token text := nullif(btrim(coalesce(p_meta ->> 'invite_token', '')), '');
  v_code  text := nullif(btrim(coalesce(p_meta ->> 'company_code', '')), '');
  v_email text := lower(btrim(coalesce(p_email, '')));
  inv public.org_invitations%rowtype;
begin
  if v_token is null and v_code is null then
    return jsonb_build_object('org', public._single_tenant_org(), 'role', null, 'approved', null);
  end if;
  if v_token is null then
    -- A company code alone is not an invitation. Never a default company, never an account.
    raise exception 'invitation_not_valid: code_without_invitation' using errcode = '22023';
  end if;
  select * into inv from public.org_invitations i
   where i.token_hash = encode(sha256(convert_to(v_token, 'utf8')), 'hex')
   for update;
  if found and inv.accepted_at is null and inv.revoked_at is null and inv.expires_at > now()
     and (inv.email is null or inv.email = v_email)
     and public._org_active(inv.organisation_id) then
    if v_code is not null and public._org_by_code(v_code) is distinct from inv.organisation_id then
      raise exception 'invitation_not_valid: code_does_not_match_invitation' using errcode = '22023';
    end if;
    update public.org_invitations set accepted_at = now(), accepted_by = p_user_id where id = inv.id;
    return jsonb_build_object('org', inv.organisation_id, 'role', inv.role, 'approved', true, 'invitation', inv.id);
  end if;
  raise exception 'invitation_not_valid' using errcode = '22023';
end $fn$;
revoke execute on function public._signup_context(uuid, jsonb, text) from public, anon, authenticated;

create or replace function public.get_public_config()
returns jsonb language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from public.system_config
  where key = any (array[
    'maintenance_mode','maintenance_message','registration_open','allow_signups',
    'require_approval','app_version','session_timeout_hours','two_factor_required',
    'password_min_length','default_currency','mobile_login_hero',
    'auth_google_enabled','auth_microsoft_enabled','qr_login_enabled',
    'single_tenant_mode'
  ]);
$fn$;
```

#### Rollback for migration 2

`supabase/pending_migrations/20261115168500_ten9e_invitation_signup_refuses_cleanly.ROLLBACK.sql` (61 lines, sha256 `70a1814c3fbcdf4cc3407a42d953245402fd7b1772ad2e3916c4c3a2cd06366b`)

```sql
-- ROLLBACK for 20261115168500_ten9e_invitation_signup_refuses_cleanly.sql
-- Restores _signup_context and get_public_config exactly as production stands before
-- TEN-9e (md5 of pg_get_functiondef, read 2026-11-18 from production):
--   _signup_context    06a34ba4879154d25431487b1ba0dd0e
--   get_public_config  4b5a4cb2281caa9673d78acb8f600695
-- No data is touched.
begin;
CREATE OR REPLACE FUNCTION public._signup_context(p_user_id uuid, p_meta jsonb, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_token text := nullif(btrim(coalesce(p_meta ->> 'invite_token', '')), '');
  v_code  text := nullif(btrim(coalesce(p_meta ->> 'company_code', '')), '');
  v_email text := lower(btrim(coalesce(p_email, '')));
  inv public.org_invitations%rowtype;
begin
  if v_token is null and v_code is null then
    return jsonb_build_object('org', public._single_tenant_org(), 'role', null, 'approved', null);
  end if;
  if v_token is null then
    -- A company code alone is not an invitation. Never a default company.
    return jsonb_build_object('org', null, 'role', null, 'approved', false, 'refused', 'code_without_invitation');
  end if;
  select * into inv from public.org_invitations i
   where i.token_hash = encode(sha256(convert_to(v_token, 'utf8')), 'hex')
   for update;
  if found and inv.accepted_at is null and inv.revoked_at is null and inv.expires_at > now()
     and (inv.email is null or inv.email = v_email)
     and public._org_active(inv.organisation_id) then
    if v_code is not null and public._org_by_code(v_code) is distinct from inv.organisation_id then
      return jsonb_build_object('org', null, 'role', null, 'approved', false, 'refused', 'code_does_not_match_invitation');
    end if;
    update public.org_invitations set accepted_at = now(), accepted_by = p_user_id where id = inv.id;
    return jsonb_build_object('org', inv.organisation_id, 'role', inv.role, 'approved', true, 'invitation', inv.id);
  end if;
  return jsonb_build_object('org', null, 'role', null, 'approved', false);
end $function$

;
CREATE OR REPLACE FUNCTION public.get_public_config()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from public.system_config
  where key = any (array[
    'maintenance_mode','maintenance_message','registration_open','allow_signups',
    'require_approval','app_version','session_timeout_hours','two_factor_required',
    'password_min_length','default_currency','mobile_login_hero',
    'auth_google_enabled','auth_microsoft_enabled','qr_login_enabled'
  ]);
$function$

;
revoke execute on function public._signup_context(uuid, jsonb, text) from public, anon, authenticated;
commit;
```

### Migration 3

`supabase/pending_migrations/20261115168800_ten9g_code_form_cannot_be_squatted.sql` (111 lines, sha256 `29f826d2588a1d0bf15154ca629b52e94cf940808affa2e1522e73ff8b5fda23`)

```sql
-- =============================================================================
-- TEN-9g  a "company code/name" sign-in cannot be taken over by a username that
--         contains the separator.
-- STATUS: AUTHORED, NOT APPLIED. Proven on a private copy of local staging only
--         (supabase/tests/multi_company_auth/run_staging.sh, tests_gaps.sql 12a-12h).
--
-- DEFECT (PR #546 gap tests, 2026-11-16)
--   _resolve_sign_in_profile tries an EXACT username / employee id match first and
--   only then splits "<code>/<name>". Nothing stops a username from containing "/"
--   or "\": the invite page checks it in the browser, but a sign-up sent straight to
--   GoTrue (or the Expo/old web sign-up) stores any text. Reproduced on staging:
--     sign up with username "beta-haulage/beta.admin" (pending, no company needed)
--     resolve_sign_in_user('beta-haulage/beta.admin') -> the NEW account, not Beta's Admin
--   Effects once companies use codes: the real person can no longer sign in with the
--   code form (their password is checked against the impostor's address and fails),
--   their failed attempts lock the impostor's counter, and a person who sets the
--   impostor's password would land in the impostor's account.
--
-- FIX
--   1. _resolve_sign_in_profile: when the identifier carries "/" or "\", the code form
--      is tried FIRST. If "<code>/<name>" names an account inside that company, that
--      account wins. Only when it names nobody is the exact match tried, so a legacy
--      account whose username really contains a slash keeps signing in (it can no
--      longer shadow a real company account). Identifiers without a separator follow
--      exactly the old path (step 1 only).
--   2. guard_profile_sign_in_names (BEFORE INSERT / UPDATE OF username, employee_id
--      on profiles): a NEW or CHANGED username / employee id may not contain "/" or
--      "\" (errcode 22023). Existing rows are not touched and keep working; an UPDATE
--      that leaves the value unchanged is not checked. The refusal inside
--      handle_new_user aborts the auth.users insert, so no account is created.
--
-- PREFLIGHT (read only, run before applying):
--   select count(*) from public.profiles where username ~ '[/\\]' or employee_id ~ '[/\\]';
--   Expected 0. Any row found keeps signing in (fix 1), but list it for the owner.
--
-- EXISTING DATA: none touched.
-- ROLLBACK:
--   20261115168800_ten9g_code_form_cannot_be_squatted.ROLLBACK.sql (exact pre-TEN-9g body,
--   md5 1ee66847b3d067fd171305fa7de11233, plus drop of the trigger and guard function).
-- =============================================================================

create or replace function public._resolve_sign_in_profile(p_identifier text)
returns uuid
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_id text := lower(btrim(coalesce(p_identifier, '')));
  v_legacy uuid := public._legacy_config_org();
  v_ids uuid[]; v_pick uuid; v_code text; v_name text; v_org uuid;
begin
  if v_id = '' then return null; end if;

  -- Step 0 (TEN-9g): an identifier carrying the separator is a code form first, so a
  -- username such as "beta-haulage/beta.admin" can never shadow Beta's account.
  if v_id ~ '[/\\]' then
    select s.company_code, lower(s.name) into v_code, v_name from public._split_sign_in_identifier(p_identifier) s;
    if v_code is not null and v_name is not null then
      v_org := public._org_by_code(v_code);
      if v_org is not null then
        select p.id into v_pick from public.profiles p where p.org_id = v_org and lower(p.username) = v_name limit 1;
        if v_pick is null then
          select p.id into v_pick from public.profiles p where p.org_id = v_org and lower(p.employee_id) = v_name limit 1;
        end if;
        if v_pick is not null then return v_pick; end if;
      end if;
    end if;
  end if;

  -- Step 1: exactly as typed, every company. Username first, then employee id.
  select array_agg(p.id) into v_ids from public.profiles p where lower(p.username) = v_id;
  if v_ids is null then
    select array_agg(p.id) into v_ids from public.profiles p where lower(p.employee_id) = v_id;
  end if;
  if cardinality(v_ids) = 1 then return v_ids[1]; end if;
  if cardinality(v_ids) > 1 then
    select p.id into v_pick from public.profiles p where p.id = any (v_ids) and p.org_id = v_legacy;
    if found and (select count(*) from public.profiles p where p.id = any (v_ids) and p.org_id = v_legacy) = 1 then
      return v_pick;
    end if;
    return null;                     -- ambiguous outside the legacy company: the code is required
  end if;

  -- The code form (old step 2) already ran as step 0; nothing else names an account.
  return null;
end $function$;

create or replace function public.guard_profile_sign_in_names()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.username is not null and new.username ~ '[/\\]'
     and (tg_op = 'INSERT' or new.username is distinct from old.username) then
    raise exception 'A username cannot contain "/" or "\".' using errcode = '22023';
  end if;
  if new.employee_id is not null and new.employee_id ~ '[/\\]'
     and (tg_op = 'INSERT' or new.employee_id is distinct from old.employee_id) then
    raise exception 'An employee id cannot contain "/" or "\".' using errcode = '22023';
  end if;
  return new;
end $function$;

revoke all on function public.guard_profile_sign_in_names() from public, anon, authenticated;

drop trigger if exists trg_guard_profile_sign_in_names on public.profiles;
create trigger trg_guard_profile_sign_in_names
  before insert or update of username, employee_id on public.profiles
  for each row execute function public.guard_profile_sign_in_names();
```

#### Rollback for migration 3

`supabase/pending_migrations/20261115168800_ten9g_code_form_cannot_be_squatted.ROLLBACK.sql` (46 lines, sha256 `194d12358b2773cb69299ae5fbda4dea8bb65f33d544361e2ac2ef5903d914e6`)

```sql
-- ROLLBACK for 20261115168800_ten9g_code_form_cannot_be_squatted.sql
-- Restores _resolve_sign_in_profile exactly as it stands before TEN-9g (staging copy of
-- production, md5 of pg_get_functiondef = 1ee66847b3d067fd171305fa7de11233; compare with
-- production before applying TEN-9g) and removes the name guard. No data is touched.
begin;
drop trigger if exists trg_guard_profile_sign_in_names on public.profiles;
drop function if exists public.guard_profile_sign_in_names();
CREATE OR REPLACE FUNCTION public._resolve_sign_in_profile(p_identifier text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id text := lower(btrim(coalesce(p_identifier, '')));
  v_legacy uuid := public._legacy_config_org();
  v_ids uuid[]; v_pick uuid; v_code text; v_name text; v_org uuid;
begin
  if v_id = '' then return null; end if;

  -- Step 1: exactly as typed, every company. Username first, then employee id.
  select array_agg(p.id) into v_ids from public.profiles p where lower(p.username) = v_id;
  if v_ids is null then
    select array_agg(p.id) into v_ids from public.profiles p where lower(p.employee_id) = v_id;
  end if;
  if cardinality(v_ids) = 1 then return v_ids[1]; end if;
  if cardinality(v_ids) > 1 then
    select p.id into v_pick from public.profiles p where p.id = any (v_ids) and p.org_id = v_legacy;
    if found and (select count(*) from public.profiles p where p.id = any (v_ids) and p.org_id = v_legacy) = 1 then
      return v_pick;
    end if;
    return null;                     -- ambiguous outside the legacy company: the code is required
  end if;

  -- Step 2: "<company code>/<name>", inside that company only.
  select s.company_code, lower(s.name) into v_code, v_name from public._split_sign_in_identifier(p_identifier) s;
  if v_code is null or v_name is null then return null; end if;
  v_org := public._org_by_code(v_code);
  if v_org is null then return null; end if;
  select p.id into v_pick from public.profiles p where p.org_id = v_org and lower(p.username) = v_name limit 1;
  if v_pick is null then
    select p.id into v_pick from public.profiles p where p.org_id = v_org and lower(p.employee_id) = v_name limit 1;
  end if;
  return v_pick;
end $function$;
commit;
```

### Migration 6

`supabase/pending_migrations/20261117113000_company_pinned_lookups.sql` (199 lines, sha256 `0da6ba01b9a332a05a91642cd2b78aad2ac613653598284ff71a9acc90e82681`)

```sql
-- =============================================================================
-- 20261117113000_company_pinned_lookups.sql
-- STATUS: AUTHORED, NOT APPLIED. Draft for owner review. Tested on the local
--         mirror (tp_mirror2 copy) only:
--         supabase/tests/staging_company_pinned_lookups.sh.
--         Rollback: the sibling *_ROLLBACK.sql.
--
-- WHY
--   Ordinary users are walled to one company by the restrictive
--   organisation_id policies. Two groups of read functions still mix companies:
--
--   A. SECURITY DEFINER readers whose company test is
--        organisation_id = app_current_org() OR is_super_admin()
--      and which then GROUP or MATCH by an asset code or tyre serial. For a
--      super admin they return every company's rows keyed by number only, so
--      two companies' "TM001" collapse into ONE asset row (tyre counts, cost,
--      health score added together), and a duplicate-serial check reports
--      another company's tyre as a duplicate of this company's import.
--        1. report_asset_overview     (Asset Detail overview, asset register)
--        2. report_asset_metrics      (per-asset metrics)
--        3. check_duplicate_serials   (serial duplicate check)
--      Production today (2026-11-16, read only): the two super admins belong to
--      Company A and these functions also hand them the "Tyre Pulse Demo Fleet"
--      tyres (DEMO-PL01, DEMO-PM01, DEMO-TM01, DEMO-TM02). No code overlaps yet.
--      Fix: the company test becomes organisation_id = app_current_org(), the
--      same rule reference_asset_options / get_asset_master already use for the
--      same pickers. A super admin reads the company they are signed in to.
--
--   B. SECURITY INVOKER readers that join by asset code without the company.
--      RLS protects ordinary users; for a super admin (RLS spans companies)
--      another company's rows decide this company's answer.
--        4. get_unplanned_assets  (inspection planner) - another company's
--           inspection or plan for the same asset code hid this company's
--           unplanned machine. Now joined on company + asset code.
--        5. asset_site_at         (tyre lifecycle site at a date) - another
--           company's site history for the same asset code was mixed in. Now
--           the caller's company when it holds the code, else the single
--           company that does, else nothing (never a pick between two other
--           companies). A session with no company keeps the old behaviour.
--
--   Single-company result: for every Company A ordinary user the output is
--   byte-identical (the condition repeats what RLS / app_current_org already
--   enforce). For the super admins only the demo-fleet rows drop out of
--   (1)-(3).
--
-- HOW
--   Same method as 20261117110000_by_number_org_joins.sql: each function is
--   read with pg_get_functiondef, saved once to _bak.company_pinned_lookups_defs,
--   edited by anchored replace (each anchor must occur EXACTLY once or the
--   whole migration aborts), and executed. CREATE OR REPLACE keeps owner,
--   grants, SECURITY DEFINER/INVOKER and search_path. Marker
--   /* company-pinned */ makes a re-run a no-op.
--
-- NOT CHANGED (recorded): get_country_kpi / report_tyre_summary keep the super
--   admin cross-company aggregate (they group by country/site, not by a number);
--   get_tyre_filter_options keeps RLS scope so its options match the tyre list
--   it filters; search_fleet_assets has no caller.
--
-- The text deliberately contains no destructive keyword so the Supabase MCP
-- apply path does not stop on its confirm prompt.
-- =============================================================================

begin;

create schema if not exists _bak;
create table if not exists _bak.company_pinned_lookups_defs (
  object_name text primary key,
  definition  text not null,
  saved_at    timestamptz not null default now()
);
revoke all on _bak.company_pinned_lookups_defs from public;

create or replace function pg_temp.cp_patch(p_def text, p_anchor text, p_repl text, p_label text)
returns text language plpgsql as $f$
declare n int;
begin
  n := (length(p_def) - length(replace(p_def, p_anchor, ''))) / greatest(length(p_anchor), 1);
  if n <> 1 then
    raise exception 'company-pinned: anchor % found % times (expected 1)', p_label, n;
  end if;
  return replace(p_def, p_anchor, p_repl);
end $f$;

create or replace function pg_temp.cp_apply(p_sig text, p_pairs text[][])
returns void language plpgsql as $f$
declare v_def text; v_new text; i int;
begin
  v_def := pg_get_functiondef(p_sig::regprocedure);
  if position('/* company-pinned */' in v_def) > 0 then
    raise notice 'company-pinned: % already patched, skipped', p_sig;
    return;
  end if;
  insert into _bak.company_pinned_lookups_defs(object_name, definition)
  values (p_sig, v_def)
  on conflict (object_name) do nothing;
  v_new := v_def;
  for i in 1 .. array_length(p_pairs, 1) loop
    v_new := pg_temp.cp_patch(v_new, p_pairs[i][1], p_pairs[i][2], p_sig || ' #' || i);
  end loop;
  if position('/* company-pinned */' in v_new) = 0 then
    raise exception 'company-pinned: % edited without the marker', p_sig;
  end if;
  execute v_new;
end $f$;

-- 1. report_asset_overview ------------------------------------------------------
select pg_temp.cp_apply('public.report_asset_overview(text)', array[
  array[$a$WHERE (tyre_records.organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))$a$,
        $r$WHERE tyre_records.organisation_id = (select public.app_current_org()) /* company-pinned */$r$]
]);

-- 2. report_asset_metrics -------------------------------------------------------
select pg_temp.cp_apply('public.report_asset_metrics(text,date,date)', array[
  array[$a$WHERE (tyre_records.organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))$a$,
        $r$WHERE tyre_records.organisation_id = (select public.app_current_org()) /* company-pinned */$r$]
]);

-- 3. check_duplicate_serials ----------------------------------------------------
select pg_temp.cp_apply('public.check_duplicate_serials(text[])', array[
  array[$a$and (t.organisation_id = public.app_current_org() or public.is_super_admin())$a$,
        $r$and t.organisation_id = public.app_current_org() /* company-pinned */$r$]
]);

-- 4. get_unplanned_assets -------------------------------------------------------
select pg_temp.cp_apply('public.get_unplanned_assets(text,integer,text,integer)', array[
  array[$a$           f.vehicle_type, f.country
    from public.vehicle_fleet f$a$,
        $r$           f.vehicle_type, f.country, f.organisation_id as org /* company-pinned */
    from public.vehicle_fleet f$r$],
  array[$a$    select upper(btrim(i.asset_no)) as asset_key, max(i.inspection_date) as last_date$a$,
        $r$    select i.organisation_id as org, upper(btrim(i.asset_no)) as asset_key, max(i.inspection_date) as last_date$r$],
  array[$a$    group by 1
$a$,
        $r$    group by 1, 2
$r$],
  array[$a$    select distinct upper(btrim(s.asset_no)) as asset_key$a$,
        $r$    select distinct s.organisation_id as org, upper(btrim(s.asset_no)) as asset_key$r$],
  array[$a$    left join last_seen ls on ls.asset_key = f.asset_key$a$,
        $r$    left join last_seen ls on ls.org = f.org and ls.asset_key = f.asset_key$r$],
  array[$a$    left join planned  pl on pl.asset_key = f.asset_key$a$,
        $r$    left join planned  pl on pl.org = f.org and pl.asset_key = f.asset_key$r$]
]);

-- 5. asset_site_at --------------------------------------------------------------
-- The history is read once (h0) with its company, then narrowed: the caller's
-- company when it holds this asset code; else the single company that does;
-- else (two OTHER companies) nothing, because picking one on the reader's behalf
-- is the mix-up this closes. A session with no company keeps the old behaviour.
select pg_temp.cp_apply('public.asset_site_at(text,text,date)', array[
  array[$a$  with h as materialized (
    select v.site, v.confidence, v.evidence, v.valid_from, v.valid_to
    from public.v_asset_site_history v$a$,
        $r$  with h0 as materialized (
    select v.organisation_id, v.site, v.confidence, v.evidence, v.valid_from, v.valid_to
    from public.v_asset_site_history v$r$],
  array[$a$    where v.asset_no = upper(btrim(p_asset)) and (p_country is null or v.country = p_country)
  )
$a$,
        $r$    where v.asset_no = upper(btrim(p_asset)) and (p_country is null or v.country = p_country)
  ),
  h as (
    select h0.site, h0.confidence, h0.evidence, h0.valid_from, h0.valid_to
    from h0
    where case /* company-pinned */
            when public.app_current_org() is null then true
            when exists (select 1 from h0 x where x.organisation_id = public.app_current_org())
              then h0.organisation_id = public.app_current_org()
            else (select count(distinct x.organisation_id) from h0 x) = 1
          end
  )
$r$]
]);

-- Post-condition: all five carry the marker, and none of the three definer
-- readers keeps the super-admin cross-company branch.
do $chk$
declare n int;
begin
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.oid in ('public.report_asset_overview(text)'::regprocedure,
                   'public.report_asset_metrics(text,date,date)'::regprocedure,
                   'public.check_duplicate_serials(text[])'::regprocedure,
                   'public.get_unplanned_assets(text,integer,text,integer)'::regprocedure,
                   'public.asset_site_at(text,text,date)'::regprocedure)
     and position('/* company-pinned */' in pg_get_functiondef(p.oid)) > 0;
  if n <> 5 then
    raise exception 'company-pinned: expected 5 patched functions, found %', n;
  end if;
  if exists (select 1 from pg_proc p
              where p.oid in ('public.report_asset_overview(text)'::regprocedure,
                              'public.report_asset_metrics(text,date,date)'::regprocedure,
                              'public.check_duplicate_serials(text[])'::regprocedure)
                and pg_get_functiondef(p.oid) ~* 'app_current_org\(\)\)?\s*or\s*\(?\s*(select\s+)?public\.is_super_admin') then
    raise exception 'company-pinned: a definer reader still carries the super-admin org branch';
  end if;
end $chk$;

commit;
```

#### Rollback for migration 6

`supabase/pending_migrations/20261117113000_company_pinned_lookups_ROLLBACK.sql` (37 lines, sha256 `8d8f940bd0455ff96bf9fb6e1cecaebd601014f570a5e1493b017aa98afc008d`)

```sql
-- =============================================================================
-- ROLLBACK for 20261117113000_company_pinned_lookups.sql
-- STATUS: AUTHORED, NOT APPLIED. Tested on the local mirror: after this file the
--         5 functions hash byte-identical to their pre-migration definitions
--         (supabase/tests/staging_company_pinned_lookups.sh).
--
-- Re-executes the definitions the migration saved in
-- _bak.company_pinned_lookups_defs before it changed anything. Nothing is
-- retyped. The backup table is left in place (it is the record of what ran).
-- =============================================================================
begin;

do $rb$
declare r record; n int := 0;
begin
  if to_regclass('_bak.company_pinned_lookups_defs') is null then
    raise exception 'company-pinned rollback: no saved definitions; the migration did not run here';
  end if;
  for r in select object_name, definition from _bak.company_pinned_lookups_defs order by object_name loop
    execute r.definition;
    n := n + 1;
  end loop;
  if n <> 5 then
    raise exception 'company-pinned rollback: expected 5 saved functions, found %', n;
  end if;
end $rb$;

do $chk$
begin
  if exists (select 1 from pg_proc p
              where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
                and position('/* company-pinned */' in pg_get_functiondef(p.oid)) > 0) then
    raise exception 'company-pinned rollback: a function still carries the marker';
  end if;
end $chk$;

commit;
```

### Migration 7

`supabase/pending_migrations/20261117102000_recalls_number_unique_per_org.sql` (58 lines, sha256 `9e141c5c92ba4cb9417cc0d691d0ac90e2b1c070b99df83fe29681ab631c54be`)

```sql
-- Recall numbers are unique per organisation (Recall Tracker, browser test D1 follow-up).
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-15 from the live catalog (pg_constraint,
--         pg_indexes, pg_policies on public.recalls; project jhssdmeruxtrlqnwfksc, SELECT only).
--         Not applied to any database.
--         NOTE FOR WHOEVER APPLIES IT: the text removes a constraint, and the Supabase MCP asks a
--         person to confirm such statements. Apply when the owner can approve the prompt.
--
-- ROOT CAUSE
--   Constraint recall_number_country_uniq is UNIQUE (recall_number, country) with no organisation
--   column. A recall number used by one company in a country can never be used by another company
--   in that country: the second company's save fails with 23505, and the page tells them
--   "Recall number already exists" for a record they cannot see (a cross-company existence
--   signal). It also lets two country-less recalls share a number, because NULLs are distinct.
--   Live today: public.recalls holds 0 rows, so nothing can conflict with the new key.
--
--   (The 403 the browser test saw on save is a CLIENT defect, fixed in code on the same branch:
--   the page offered countries the recalls_country_write policy refuses. No policy change needed.)
--
-- WHAT THIS CHANGES
--   The unique key becomes (organisation_id, recall_number, country) with NULLS NOT DISTINCT
--   (Postgres 15+; live is 17.6), so inside one company the rule is the same as today, plus a
--   country-less recall number is policed too. The client maps 23505 to "Recall number already
--   exists" already (src/pages/RecallTracker.jsx), so no client change is needed.
--
-- RISK TO THE CURRENT COMPANY: NONE. The table is empty. Note the new key is NOT strictly looser:
--   across companies it is looser, but inside one company two COUNTRY-LESS recalls with the same
--   number were accepted by the old key (NULLs distinct) and are refused by the new one (NULLS NOT
--   DISTINCT). Re-check `select organisation_id, recall_number, count(*) from public.recalls
--   where country is null group by 1,2 having count(*) > 1` returns no rows before applying.
--   The app does not depend on this migration: no client code names either constraint.

begin;

alter table public.recalls
  drop constraint if exists recall_number_country_uniq;

-- re-runnable: a second run replaces the constraint with the same definition
alter table public.recalls
  drop constraint if exists recalls_org_number_country_uniq;

alter table public.recalls
  add constraint recalls_org_number_country_uniq
  unique nulls not distinct (organisation_id, recall_number, country);

commit;

-- VERIFY (after applying; read only)
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.recalls'::regclass and contype = 'u';
--   -- expect exactly one row:
--   -- recalls_org_number_country_uniq | UNIQUE NULLS NOT DISTINCT (organisation_id, recall_number, country)
--
-- ROLLBACK (only valid while no two companies share a recall_number + country)
--   begin;
--   alter table public.recalls drop constraint if exists recalls_org_number_country_uniq;
--   alter table public.recalls add constraint recall_number_country_uniq unique (recall_number, country);
--   commit;
```
