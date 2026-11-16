-- CUR-1: Managers and Directors can create and edit work orders by default.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE definition of
--         public.app_user_can(text, text) (md5(prosrc) df5b4f662cb0822453a8be753da453db) and the
--         LIVE pg_policies rows of public.work_orders. Not applied to any database. Tested on PGlite
--         only (supabase/tests/current_prod_work_orders_default.test.mjs), against a byte-exact copy
--         of the live function (supabase/tests/fixtures/current_prod_live_functions.sql).
--         NEEDS THE OWNER'S YES: it reverses the 2026-09-30 decision that the job card register is
--         written by Admin only (PROJECT_MEMORY "asset register + job cards writable by ADMIN ONLY").
--         The instruction this implements (2026-11-12): Admin, Manager and Director manage work
--         orders.
--
-- ROOT CAUSE (CONFIRMED by a read-only impersonation of every live Manager, rolled back)
--   work_orders has no role policy for INSERT or UPDATE. The only permissive write policies are
--     work_orders_cap_insert  WITH CHECK app_user_can('work_orders','create')
--     work_orders_cap_update  USING / WITH CHECK app_user_can('work_orders','edit')
--   app_user_can() answers for a non-admin from the organisation's stored capability matrix
--   (organisations.settings -> app_settings ->> permission_overrides) and falls back to FALSE when
--   the matrix says nothing. For the role Manager the answer is false in every organisation:
--     Company A (2 Managers): the matrix holds an explicit work_orders create=false, edit=false.
--     Organisation a50e2d87 (1 Manager): no matrix at all, so the fallback false applies.
--   So "New Work Order", editing a job card, and the Workshop Live Control actions that write the
--   job itself (New Job, move status, priority, Vehicle Off Road, QC pass / fail) are refused for
--   all 3 Managers, while the same screen lets them assign technicians and manage tasks, because
--   wo_assignments, wo_tasks and tech_activity_events are written through app_is_elevated()
--   (admin, manager, director). One module, two rules.
--   Who CAN write work orders today: 2 Admins, 7 Tyre Data Collectors and 1 Data Monitor Officer
--   (their matrix rows say true). No Director account exists.
--
-- THE RULE AFTER THIS MIGRATION
--   The matrix stays the single place the rule is set (Console, Access Control). What changes is
--   the built-in default it starts from:
--     work_orders create and edit default to TRUE for the roles Manager and Director.
--   Precedence is unchanged: Admin / super admin, then a per-user revoke, then the organisation
--   matrix value when it has one, then this built-in default, then a per-user grant. An Admin can
--   still switch it off for Manager in Access Control (an explicit false wins over the default)
--   and can still revoke it for one person.
--   Delete is untouched: Admin only (app_user_can returns false for delete for every non-admin,
--   and admin_only_delete_guard is RESTRICTIVE).
--
--   Two steps, in one transaction:
--   1. app_user_can() reads the built-in default from the new app_role_capability_default() when
--      the organisation matrix has no value for that role, module and capability. One expression
--      changes; every other line of the live function is preserved by an anchored replacement that
--      aborts unless the anchor is found exactly once.
--   2. In organisations whose matrix holds Manager work_orders create or edit = false, those two
--      values are set to true, so the Access Control screen shows what is enforced. The previous
--      settings of every changed organisation are copied to _bak.cur1_org_settings_20261113 first.
--      Export and approve for Manager are left as stored.
--
-- WHO GAINS OR LOSES ACCESS (live counts, 2026-11-12)
--   Gains work order create and edit: 3 Managers (2 in Company A through step 2, 1 in organisation
--     a50e2d87 through step 1). 0 Directors exist; a future Director gets it by default.
--   Loses: nobody. Tyre Data Collector (7) and Data Monitor Officer (1) keep their stored true.
--   No other module, capability or role changes: the default function returns true for exactly
--   (Manager or Director) x work_orders x (create or edit) and false for everything else, which is
--   the fallback the live function already uses.
--   Country and site walls are unchanged (the RESTRICTIVE work_orders_country_write,
--   work_orders_site_write and work_orders_org_isolation policies still apply to these users).
--
-- RISK TO THE CURRENT COMPANY: LOW. Additive for 2 people. app_user_can() is called by the write
--   policies of 11 tables; the changed expression is reached only for non-view capabilities and
--   only alters the result when the matrix has no value, where it now returns true for the four
--   combinations above instead of false.
--
-- VERIFY (rolled back, after applying)
--   begin;
--   select position('app_role_capability_default' in prosrc) > 0 from pg_proc
--    where oid = 'public.app_user_can(text,text)'::regprocedure;                         -- t
--   select public.app_role_capability_default('Manager','work_orders','create'),          -- t
--          public.app_role_capability_default('Director','work_orders','edit'),           -- t
--          public.app_role_capability_default('Manager','work_orders','delete'),          -- f
--          public.app_role_capability_default('Manager','fleet_master','edit'),           -- f
--          public.app_role_capability_default('Tyre Man','work_orders','create');         -- f
--   select has_function_privilege('anon','public.app_role_capability_default(text,text,text)','EXECUTE'),
--          has_function_privilege('authenticated','public.app_role_capability_default(text,text,text)','EXECUTE'); -- f, f
--   -- as each Manager (set request.jwt.claims sub, set local role authenticated):
--   --   select public.app_user_can('work_orders','create'), public.app_user_can('work_orders','edit'),
--   --          public.app_user_can('work_orders','delete'), public.app_user_can('fleet_master','edit');
--   --   expect t, t, f, f
--   -- as a Tyre Man: expect f, f, f, f.  As a Tyre Data Collector: t, t, f (unchanged).
--   select count(*) from _bak.cur1_org_settings_20261113;                                 -- 4 on production today
--   rollback;
--
-- ROLLBACK
--   begin;
--   update public.organisations o set settings = b.settings
--     from _bak.cur1_org_settings_20261113 b where b.id = o.id;
--   -- then re-create public.app_user_can(text,text) from the fixture
--   -- supabase/tests/fixtures/current_prod_live_functions.sql (the live body before this file)
--   -- and remove public.app_role_capability_default(text,text,text).
--   commit;

begin;

-- 1a. The built-in role default for a non-view capability. Deliberately tiny and IMMUTABLE: it is
--     a rule table, not a lookup. Add a row here (and to src/lib/writeAccessRules.js) to give a
--     role a default capability. Role names are profiles.role values, Title Case.
create or replace function public.app_role_capability_default(p_role text, p_key text, p_cap text)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select coalesce(
    p_key = 'work_orders'
    and p_cap in ('create', 'edit')
    and p_role in ('Manager', 'Director'),
    false);
$function$;

comment on function public.app_role_capability_default(text, text, text) is
  'CUR-1: built-in default for a non-view capability when the organisation matrix has no value. '
  'True only for Manager/Director on work_orders create/edit. Read by app_user_can().';

revoke all on function public.app_role_capability_default(text, text, text) from public;
revoke all on function public.app_role_capability_default(text, text, text) from anon;
revoke all on function public.app_role_capability_default(text, text, text) from authenticated;

-- 1b. app_user_can(): swap the hard-coded fallback for the built-in default. Anchored on the live
--     text; aborts unless the anchor occurs exactly once, so a function that has changed since
--     this draft was written is never overwritten with a stale body.
do $do$
declare
  v_def    text := pg_get_functiondef('public.app_user_can(text,text)'::regprocedure);
  v_anchor text := 'v_default := coalesce((v_ov -> v_role -> p_key ->> v_cap)::boolean, false);';
  v_new    text := 'v_default := coalesce((v_ov -> v_role -> p_key ->> v_cap)::boolean, public.app_role_capability_default(v_role, p_key, v_cap));';
  v_hits   integer;
begin
  if position('app_role_capability_default' in v_def) > 0 then
    raise notice 'CUR-1: app_user_can already reads the built-in default; nothing to change.';
    return;
  end if;
  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'CUR-1 aborted: expected the fallback anchor once in app_user_can, found % time(s). Re-author from the live definition.', v_hits;
  end if;
  execute replace(v_def, v_anchor, v_new);
end
$do$;

-- 2. Make the stored matrix say what is now intended, where it says the opposite.
create schema if not exists _bak;

create table if not exists _bak.cur1_org_settings_20261113 as
  select o.id, o.settings, now() as saved_at
    from public.organisations o
   where false;

do $do$
declare
  r        record;
  v_parsed jsonb;
  v_base   text[];
  v_next   jsonb;
  v_n      integer := 0;
begin
  for r in
    select o.id, o.settings
      from public.organisations o
     where jsonb_typeof(o.settings -> 'app_settings' -> 'permission_overrides') = 'string'
  loop
    begin
      v_parsed := (r.settings -> 'app_settings' ->> 'permission_overrides')::jsonb;
    exception when others then
      continue;  -- an unreadable matrix is left alone; app_user_can already treats it as empty
    end;
    v_base := case when v_parsed ? 'overrides'
                   then array['overrides', 'Manager', 'work_orders']
                   else array['Manager', 'work_orders'] end;
    if jsonb_typeof(v_parsed #> v_base) is distinct from 'object' then
      continue;  -- no stored value for Manager work orders: the built-in default now applies
    end if;
    v_next := v_parsed;
    if (v_parsed #>> (v_base || 'create'::text)) = 'false' then
      v_next := jsonb_set(v_next, v_base || 'create'::text, 'true'::jsonb);
    end if;
    if (v_parsed #>> (v_base || 'edit'::text)) = 'false' then
      v_next := jsonb_set(v_next, v_base || 'edit'::text, 'true'::jsonb);
    end if;
    if v_next is not distinct from v_parsed then
      continue;
    end if;
    insert into _bak.cur1_org_settings_20261113 (id, settings, saved_at)
      select r.id, r.settings, now()
       where not exists (select 1 from _bak.cur1_org_settings_20261113 b where b.id = r.id);
    -- The matrix is stored as a JSON string inside jsonb, so it is written back as a string.
    update public.organisations
       set settings = jsonb_set(settings, array['app_settings', 'permission_overrides'], to_jsonb(v_next::text))
     where id = r.id;
    v_n := v_n + 1;
  end loop;
  raise notice 'CUR-1: Manager work order create/edit switched on in % organisation matrix(es).', v_n;
end
$do$;

commit;
