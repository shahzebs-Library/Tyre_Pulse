-- =============================================================================
-- TEN-11: AI month spend and the AI month budget are counted per company.
-- STATUS: AUTHORED, NOT APPLIED. Draft for review. Run only on the local staging copy.
--
-- WHAT WAS MEASURED (local staging copy, 2026-11-15)
--   ai_orchestrator_reserve_budget() compares the platform setting ai_monthly_budget_usd
--   with ai_month_spend_usd(), which sums EVERY company's spend. With a budget of 10 USD
--   and 9.99 USD spent by company B, a request of company A was refused "Monthly AI
--   budget reached". One company can use up another company's AI.
--   (Usage rows themselves are already walled: ai_token_logs, ai_budgets, ai_models,
--   ai_prompts, ai_feedback carry a restrictive company policy; proven by the tests.)
--
-- WHAT IT ADDS
--   ai_month_spend_usd_for_org(org, unknown_job_usd)  same arithmetic as
--     ai_month_spend_usd(), for one company. Rows with no company count for the legacy
--     (current) company only, so its figure is what the platform figure is today.
--   ai_org_month_limit_usd(org)  the company's own month cap:
--       legacy (current) company  -> NULL: no company cap, EXPLICITLY grandfathered.
--       any other company         -> subscription_plans.features ->> 'ai_monthly_budget_usd'
--                                    of its plan, else system_config
--                                    'ai_default_company_budget_usd', else NULL.
--     Both sources are writable by a super admin only (TEN-3, TEN-5): a customer Admin
--     cannot raise the company's own cap.
--   ai_orchestrator_reserve_budget()  patched in place from its LIVE definition (three
--     anchored replacements, each must match exactly once or the migration aborts):
--     spend = the calling company's spend; limit = the lower of the platform ceiling and
--     the company cap; a company cap of 0 means AI is not in the plan. Signature and result shape unchanged. No edge redeploy needed.
--
-- CURRENT COMPANY: unchanged while it is the only company spending (its spend is the
--   platform spend). With other companies present its budget is no longer consumed by
--   them. It never gets a company cap.
--
-- NOT COVERED (stated): chat-ai and ai-tyre-inspection compute their own month figure in
--   the edge function across all companies, and ai_tyre_daily_budget is one row per day
--   for the platform. Those need edge function changes and a redeploy (not done here).
--
-- APPLY ORDER: after 20261113111000 (TEN-7, _legacy_config_org).
--
-- VERIFY (begin; ... rollback;)
--   select public.ai_month_spend_usd_for_org('<org>'::uuid);  select public.ai_org_month_limit_usd('<org>'::uuid);
--
-- ROLLBACK  (run as one statement; the reverse of the three replacements)
--   do $r$ declare d text := pg_get_functiondef('public.ai_orchestrator_reserve_budget(uuid,uuid,uuid,numeric,text)'::regprocedure);
--   begin
--     d := replace(d, 'v_spent := public.ai_month_spend_usd_for_org(p_org, p_estimate);', 'v_spent := public.ai_month_spend_usd(p_estimate);');
--     d := regexp_replace(d, ' v_cap := public\.ai_org_month_limit_usd\(p_org\);.*?v_limit := v_cap; end if;\n', '');
--     d := replace(d, 'v_spent numeric; v_cap numeric;', 'v_spent numeric;');
--     execute d;
--   end $r$;
-- =============================================================================

do $$ begin
  if to_regprocedure('public._legacy_config_org()') is null then
    raise exception 'TEN-11 needs TEN-7 applied first. Nothing applied.';
  end if;
end $$;

create or replace function public.ai_month_spend_usd_for_org(p_org uuid, p_unknown_job_usd numeric default 0.01)
returns numeric language plpgsql stable security definer set search_path = pg_catalog, public as $fn$
declare v_since timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
        v_legacy boolean := p_org is not distinct from public._legacy_config_org();
        v_bad integer; v_other numeric; v_tyre numeric; v_orch numeric;
begin
 if p_org is null then return public.ai_month_spend_usd(p_unknown_job_usd); end if;
 select count(*) into v_bad from public.ai_token_logs
  where created_at >= v_since and cost_usd < 0
    and (organisation_id = p_org or (organisation_id is null and v_legacy));
 if v_bad > 0 then return null; end if;
 select coalesce(sum(cost_usd), 0) into v_other from public.ai_token_logs
  where created_at >= v_since and coalesce(feature, '') <> 'ai_tyre_inspection' and cost_usd is not null
    and (organisation_id = p_org or (organisation_id is null and v_legacy));
 select coalesce(sum(
          (case
             when provider_called_at >= v_since then coalesce(cost_usd, reserved_usd, p_unknown_job_usd)
             when provider_called_at is null and reserved_usd is not null and budget_settled_at is null then reserved_usd
             else 0 end) + coalesce(prior_billed_usd, 0)), 0)
   into v_tyre from public.ai_tyre_inspection_jobs
  where (provider_called_at >= v_since or last_retry_at >= v_since
         or (provider_called_at is null and reserved_usd is not null and budget_settled_at is null))
    and (organisation_id = p_org or (organisation_id is null and v_legacy));
 select coalesce(sum(case status
          when 'reserved' then reserved_usd
          when 'unknown'  then greatest(reserved_usd, coalesce(actual_usd, 0))
          else 0 end), 0)
   into v_orch from public.ai_budget_reservations
  where created_at >= v_since and status in ('reserved', 'unknown')
    and (organisation_id = p_org or (organisation_id is null and v_legacy));
 return v_other + v_tyre + v_orch;
end $fn$;
revoke execute on function public.ai_month_spend_usd_for_org(uuid, numeric) from public;
revoke execute on function public.ai_month_spend_usd_for_org(uuid, numeric) from anon;
revoke execute on function public.ai_month_spend_usd_for_org(uuid, numeric) from authenticated;
grant execute on function public.ai_month_spend_usd_for_org(uuid, numeric) to service_role;

create or replace function public.ai_org_month_limit_usd(p_org uuid)
returns numeric language plpgsql stable security definer set search_path = pg_catalog, public as $fn$
declare v text; v_n numeric;
begin
  -- The current company keeps an unrestricted internal entitlement: never a company cap.
  if p_org is null or p_org is not distinct from public._legacy_config_org() then return null; end if;
  select sp.features ->> 'ai_monthly_budget_usd' into v
    from public.org_subscriptions s join public.subscription_plans sp on sp.code = s.plan_code
   where s.organisation_id = p_org
   order by s.created_at desc limit 1;
  if nullif(btrim(coalesce(v, '')), '') is null then
    select nullif(btrim(value, ' "'), '') into v from public.system_config where key = 'ai_default_company_budget_usd';
  end if;
  if v is null then return null; end if;
  begin v_n := v::numeric; exception when others then return 0; end;   -- unreadable cap fails closed
  if v_n < 0 then return 0; end if;
  return v_n;
end $fn$;
revoke execute on function public.ai_org_month_limit_usd(uuid) from public;
revoke execute on function public.ai_org_month_limit_usd(uuid) from anon;
revoke execute on function public.ai_org_month_limit_usd(uuid) from authenticated;
grant execute on function public.ai_org_month_limit_usd(uuid) to service_role;

do $$
declare
  v_def text := pg_get_functiondef('public.ai_orchestrator_reserve_budget(uuid,uuid,uuid,numeric,text)'::regprocedure);
  a1 text := 'v_spent := public.ai_month_spend_usd(p_estimate);';
  a2 text := E' perform pg_advisory_xact_lock(hashtext(''ai_tyre_month_budget''));';
  a3 text := 'v_spent numeric;';
  a text; v_n int;
begin
  if position('ai_month_spend_usd_for_org' in v_def) > 0 then return; end if;   -- already patched
  foreach a in array array[a1, a2, a3] loop
    v_n := (length(v_def) - length(replace(v_def, a, ''))) / length(a);
    if v_n <> 1 then
      raise exception 'TEN-11: anchor "%" found % times in ai_orchestrator_reserve_budget, expected 1. Nothing applied.', a, v_n;
    end if;
  end loop;
  v_def := replace(v_def, a1, 'v_spent := public.ai_month_spend_usd_for_org(p_org, p_estimate);');
  v_def := replace(v_def, a2,
     E' v_cap := public.ai_org_month_limit_usd(p_org);\n'
     || E' if v_cap is not null and v_cap <= 0 then\n  return jsonb_build_object(''ok'', false, ''state'', ''reached'', ''limit_usd'', 0, ''reason'', ''AI is not included in the plan of this company'');\n end if;\n'
     || E' if v_cap is not null and (v_limit = 0 or v_cap < v_limit) then v_limit := v_cap; end if;\n' || a2);
  v_def := replace(v_def, 'v_spent numeric;', 'v_spent numeric; v_cap numeric;');
  execute v_def;
end $$;
