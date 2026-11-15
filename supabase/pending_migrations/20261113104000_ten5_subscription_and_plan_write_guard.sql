-- TEN-5: a customer Admin can no longer grant itself a plan, extend its trial or unlock itself.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from LIVE pg_policies and the LIVE definition
--         of public.guard_organisation_configuration() (md5(prosrc) f287c8a7c2b3a02a53dedd36368b04df).
--         Not applied to any database. Tested on PGlite only
--         (supabase/tests/tenant_isolation_ten5.test.mjs).
--         NOTE FOR WHOEVER APPLIES IT: the text below contains the words DELETE and "drop"
--         (trigger events and this note), so the Supabase MCP destructive-statement gate will ask
--         a human to confirm. Nothing here removes data or objects.
--
-- WHAT IT FIXES
--   1. org_subscriptions_admin_write is FOR ALL for the organisation's own Admin. One REST call
--      sets plan_code = 'enterprise', status = 'active', or pushes current_period_end and
--      trial_ends_at forward for ever. The only check is in browser code (src/lib/api/billing.js).
--   2. organisations_write lets the same Admin update its own organisations row, including
--      plan, active, locked, max_users and parent_organisation_id (un-suspend itself, raise its
--      own user cap), and delete the row.
--
--   After this migration, for a direct client write (current_user authenticated or anon) by
--   someone who is not a super admin:
--     org_subscriptions  INSERT refused, DELETE refused, UPDATE allowed ONLY when nothing but
--                        cancel_at_period_end changes (the customer may still ask to cancel or
--                        undo a cancellation).
--     organisations      UPDATE of plan / active / locked / max_users / parent_organisation_id
--                        refused; DELETE refused by a RESTRICTIVE policy. Name, branding, country
--                        and the other columns stay editable by the company's Admin.
--   Not affected, by construction: the Stripe webhook (service_role), SECURITY DEFINER RPCs such
--   as ensure_org_subscription, create_workspace_owner, holding_link_subsidiary and
--   admin_archive_empty_org (inside them current_user is the function owner), and a super admin
--   in the console (ConsoleOrganisations.jsx writes plan and locked directly; still allowed).
--
-- OWNER DECISION NEEDED (behaviour change for FUTURE customers, none for Company A today)
--   src/lib/api/billing.js changePlan() lets an Admin move its own subscription to the 'trial' or
--   'free' plan with status 'trialing' and a fresh one-month period. That is a self-service
--   trial reset, which is exactly what this finding is about, so it is REFUSED (42501) after
--   this migration. The Billing page "downgrade to free / trial" action will show an error for
--   a customer Admin until a server-side RPC with the intended rules replaces it
--   (suggested: request_plan_downgrade() that sets cancel_at_period_end and never restarts a
--   trial). setCancelAtPeriodEnd() keeps working. Decide before the first paying tenant.
--
-- KNOWN GAP, CLOSED BY TEN-5b (20261113114500_ten5b_organisation_plan_columns_trigger.sql)
--   The live trigger on organisations is BEFORE UPDATE OF settings, so the plan-column check this
--   file adds to guard_organisation_configuration() runs only when the statement also names
--   settings. Measured on PostgreSQL 16 staging with this file alone: a company Admin still set
--   plan = enterprise and max_users = 9999 on its own row. Apply TEN-5b together with this file.
--
-- WHAT IT DOES NOT FIX
--   subscription_plans prices are closed by TEN-3, not here. Entitlements are still not ENFORCED
--   anywhere that matters (TEN-6). enforce_plan_limit and get_subscription_overview unchanged.
--
-- RISK TO THE CURRENT COMPANY (Company A; 2 super admins, 0 plain Admins): NONE EXPECTED.
--   org_subscriptions has 0 rows and no plain Admin exists. Both Company A admins are super
--   admins and keep every write, provided their session is MFA-complete when they have a
--   verified factor (is_super_admin() is false at aal1 with a verified factor; the app and the
--   console already require that).
--
-- VERIFY (rolled back, after applying):
--   begin;
--   select tgname, tgenabled from pg_trigger
--    where tgrelid = 'public.org_subscriptions'::regclass and tgname = 'trg_guard_org_subscription_writes'; -- 1 row, O
--   select position('TEN-5' in prosrc) > 0 from pg_proc
--    where oid = 'public.guard_organisation_configuration()'::regprocedure;                              -- t
--   select has_function_privilege('authenticated', 'public.guard_org_subscription_writes()', 'EXECUTE'),
--          has_function_privilege('anon', 'public.guard_org_subscription_writes()', 'EXECUTE');          -- f, f
--   -- impersonate a Company A super admin: update public.organisations set max_users = max_users
--   --   + 1 where id = '00000000-0000-0000-0000-000000000001' returning max_users;  (allowed)
--   --   select * from public.ensure_org_subscription();                              (a trial row appears)
--   -- impersonate the demo Manager: the same organisations update writes 0 rows (policy), as today.
--   -- the refusal for a plain Admin needs an account type production does not have: confirm on
--   --   a branch database (42501 on plan_code, status, locked; cancel_at_period_end accepted).
--   rollback;
--   Also send one Stripe test event through billing-webhook on the branch and confirm the
--   subscription row is written (service_role path).
--
-- ROLLBACK:
--   alter table public.org_subscriptions disable trigger trg_guard_org_subscription_writes;
--   alter policy organisations_platform_removal on public.organisations using (true);
--   re-create guard_organisation_configuration() from the text captured before applying.
-- ---------------------------------------------------------------------------------------------

-- 1. org_subscriptions: column-level guard for direct client writes -----------------------------
create or replace function public.guard_org_subscription_writes()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
begin
  -- Direct client writes only. The webhook (service_role) and SECURITY DEFINER RPCs run as
  -- another role and are not restricted here.
  if current_user not in ('authenticated', 'anon') or coalesce(public.is_super_admin(), false) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    raise exception 'Subscriptions are created by the platform.' using errcode = '42501';
  elsif tg_op = 'DELETE' then
    raise exception 'Subscriptions are managed by the platform.' using errcode = '42501';
  end if;

  -- UPDATE: the customer may only ask to cancel at period end, or undo that.
  if (to_jsonb(new) - 'cancel_at_period_end' - 'updated_at')
     is distinct from (to_jsonb(old) - 'cancel_at_period_end' - 'updated_at') then
    raise exception 'Plan, status, seats and billing period are managed by the platform.' using errcode = '42501';
  end if;
  return new;
end
$fn$;

-- A trigger function needs no EXECUTE grant; nobody should be able to call it directly.
revoke all on function public.guard_org_subscription_writes() from public;
revoke all on function public.guard_org_subscription_writes() from anon;
revoke all on function public.guard_org_subscription_writes() from authenticated;
grant execute on function public.guard_org_subscription_writes() to service_role;

do $mig$
declare
  v_def    text;
  v_hits   integer;
  v_anchor constant text :=
    E'  ) then raise exception ''Use the audited configuration operation.'' using errcode=''42501''; end if;\n';
  v_new    constant text := v_anchor
    || E'  -- TEN-5: plan, status and limits change only for a super admin (or a server-side path).\n'
    || E'  if current_user in (''authenticated'',''anon'') and not coalesce(public.is_super_admin(), false) and (\n'
    || E'    old.plan is distinct from new.plan or\n'
    || E'    old.active is distinct from new.active or\n'
    || E'    old.locked is distinct from new.locked or\n'
    || E'    old.max_users is distinct from new.max_users or\n'
    || E'    old.parent_organisation_id is distinct from new.parent_organisation_id\n'
    || E'  ) then raise exception ''Plan, status and limits are managed by the platform.'' using errcode=''42501''; end if;\n';
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.org_subscriptions'::regclass and tgname = 'trg_guard_org_subscription_writes') then
    create trigger trg_guard_org_subscription_writes
      before insert or update or delete on public.org_subscriptions
      for each row execute function public.guard_org_subscription_writes();
  end if;

  -- 2. organisations: extend the existing BEFORE UPDATE guard ---------------------------------
  select replace(pg_get_functiondef('public.guard_organisation_configuration()'::regprocedure), E'\r\n', E'\n')
    into v_def;
  if position('TEN-5' in v_def) > 0 then
    raise notice 'TEN-5: guard_organisation_configuration already extended, skipped';
  else
    v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
    if v_hits <> 1 then
      raise exception 'TEN-5 aborted: anchor found % time(s) in guard_organisation_configuration, expected 1. Re-author this migration.', v_hits;
    end if;
    execute replace(v_def, v_anchor, v_new);
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.organisations'::regclass
                    and tgfoid = 'public.guard_organisation_configuration()'::regprocedure and tgenabled = 'O') then
    raise exception 'TEN-5 aborted: organisations has no enabled guard_organisation_configuration trigger';
  end if;

  -- 3. organisations: only a super admin removes an organisation row -------------------------
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'organisations' and policyname = 'organisations_platform_removal') then
    create policy organisations_platform_removal on public.organisations as restrictive for delete to authenticated
      using ((select public.is_super_admin()));
  end if;
end
$mig$;
