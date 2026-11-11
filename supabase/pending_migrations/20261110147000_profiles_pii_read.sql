-- !!! HELD — NOT APPLIED to live, and intentionally OUT of supabase/migrations/ (parked here). !!!
-- Reason: narrowing profiles_select app-wide removes non-elevated members' read of OTHER staff
-- rows, which blanks name displays (Flutter "assigned by <name>", people pickers, workforce
-- recommend, broadcast audience) unless a PII-free, org-scoped directory + service-layer reader
-- repoints land first AND are UI-verified. Production browser E2E is NOT RUN in this container,
-- so this access-removing change is deferred to a focused, UI-verifiable slice (owner greenlight).
-- The security_invoker=on directory below ALSO does not restore org-wide names to members (it
-- respects the caller's RLS); the complete fix needs a security_invoker=off, org-scoped, PII-free
-- directory (the first sanctioned non-invoker view) + repoints. See LOOP_LOG F-K-04.
--
-- 360 audit fix wave 1 — Loop 9 / F-K-04 part 1 (P1, confirmed).
-- profiles has ONE permissive SELECT policy, profiles_select = ((select auth.role())='authenticated'),
-- so any active authenticated member reads EVERY profile row in the org — including phone, email and
-- push_token of all ~769 staff. A field role (Tyre Man, Driver) can pull the whole staff directory
-- with PII via its own JWT. This restricts the full-row read (with PII) to self + elevated.
--
-- Owner decision #8: restrict phone/email/push_token read to self + elevated now; add a
-- profiles_directory view (names/roles/scope, no PII); DO NOT null profiles.push_token yet
-- (deferred gate H — _user_push_tokens already reads user_devices, confirmed live).
--
-- WHAT THIS DOES:
--   1. Narrow profiles_select USING to: own row OR app_is_elevated() OR is_super_admin()
--      (scope readers wrapped in (select …) for InitPlan). Change via ALTER POLICY (surgical,
--      no drop). After this, a non-elevated member reads only their OWN profile row.
--   2. Create view public.profiles_directory (security_invoker = on) exposing the 10 non-PII
--      columns only (id, full_name, role, country, sites, site, approved, locked, org_id,
--      organisation_id) — NO phone / email / push_token / username / employee_id.
--   3. grant select on the view to authenticated; re-apply reader policies.
--
-- PRE-FLIGHT (database-migration-safety):
--   Data loss      : none. Policy expression change + new view. No DROP TABLE, no row writes.
--   Rename/removal : none (push_token column kept — deferred gate H).
--   CHECK          : none.
--   Locks          : ALTER POLICY / CREATE VIEW take brief catalog locks only.
--   Triggers       : none.
--   RLS            : narrows a permissive SELECT policy; the three restrictive SELECT policies
--                    (anum_reader_select_scope, profiles_active_or_self_read, profiles_org_isolation)
--                    are unchanged and still AND on top.
--   PostgREST      : DDL only.
--
-- LIVE STATE CONFIRMED (read-only, 2026-11-10):
--   * profiles_select  = PERMISSIVE r, roles=PUBLIC, using ((select auth.role())='authenticated').
--   * It is the ONLY permissive SELECT policy on profiles (the rest are insert/update/delete or
--     restrictive). So narrowing it is the single lever.
--   * profiles total 769; Tyre Man 4b760941 is active/KSA/non-super; Manager 34793423 is elevated.
--   * profiles_directory view does not exist yet.
--   * _user_push_tokens(uuid) exists and reads user_devices (register V297 claim holds).
--
-- !!! CONFLICT FLAGGED FOR LEAD / OWNER — READ BEFORE MERGE !!!
--   The FIX_LOOPS Loop 9 acceptance says a non-elevated user should read profiles_directory = 768
--   (the full org directory of names). That is NOT achievable with security_invoker = on AND a
--   narrowed profiles_select: a security_invoker view respects the CALLER's RLS, so a non-elevated
--   member reads profiles_directory = 1 (self), exactly as they read profiles = 1 (self).
--   This migration ships the SAFE, convention-respecting default (security_invoker = on — the
--   project invariant is "0 views not security_invoker") and PROTECTS PII correctly. The trade-off:
--   non-elevated field screens that show OTHER users' names (e.g. Flutter "assigned by <name>")
--   will no longer resolve those names, and the directory does NOT restore them under
--   security_invoker = on. Restoring org-wide name visibility to non-elevated users requires a
--   security_invoker = off directory with an in-view `where organisation_id = (select
--   app_current_org()) or (select is_super_admin())` org scope — which the owner did not authorize
--   and which would be the first non-invoker view. Lead/owner must choose before merge. The
--   service-layer repoints (FIX_LOOPS Loop 9 step 3) are outside DB-1 ownership (see report).

-- (1) Narrow the full-row read to self + elevated + super admin.
alter policy profiles_select on public.profiles
  using (((select auth.uid()) = id)
      or (select app_is_elevated())
      or (select is_super_admin()));

-- (2) Non-PII directory view (names / roles / scope only). security_invoker = on so it respects
--     the caller's org/country RLS and never bypasses isolation. No phone/email/push_token.
drop view if exists public.profiles_directory;
create view public.profiles_directory
  with (security_invoker = on) as
  select id, full_name, role, country, sites, site, approved, locked, org_id, organisation_id
  from public.profiles;

grant select on public.profiles_directory to authenticated;

-- Keep reader-bot coverage current.
select anum_integration.apply_reader_policies();

-- ============================================================================
-- VERIFY (run in a SEPARATE call AFTER apply; rolled back; one user per txn).
--
-- (1) Non-elevated Tyre Man 4b760941 — reads only self:
-- begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub','4b760941-85bc-43c5-ae2f-f881c2911f67','role','authenticated')::text, true);
--   set local role authenticated;
--   select count(*) profiles_rows from public.profiles;             -- EXPECT 1 (self; was 769)
--   select count(*) directory_rows from public.profiles_directory;  -- EXPECT 1 (self, security_invoker)
--   select count(*) foreign_phone from public.profiles
--     where id <> '4b760941-85bc-43c5-ae2f-f881c2911f67' and phone is not null;  -- EXPECT 0
-- rollback;
--   (NB: directory = 1, NOT 768 — see the CONFLICT note above.)
--
-- (2) Elevated Manager 34793423 — unchanged:
-- begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub','34793423-43df-4b6f-9270-9d1e8be6fa30','role','authenticated')::text, true);
--   set local role authenticated;
--   select count(*) profiles_rows from public.profiles;             -- EXPECT 769 (org, unchanged)
-- rollback;
--
-- (3) get_advisors security -> no new ERROR; view is security_invoker (invariant preserved).
-- ============================================================================

-- ============================================================================
-- ROLLBACK:
--   alter policy profiles_select on public.profiles
--     using (((select auth.role()) = 'authenticated'));
--   drop view if exists public.profiles_directory;
--   select anum_integration.apply_reader_policies();
-- ============================================================================
