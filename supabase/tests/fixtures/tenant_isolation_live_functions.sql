-- Faithful copies of LIVE production function definitions (project jhssdmeruxtrlqnwfksc),
-- read with pg_get_functiondef on 2026-11-12 for the TEN-1..TEN-5 tenant isolation tests.
-- The harness (tenant_isolation_harness.mjs) asserts md5(prosrc) of every function below
-- against the md5 recorded from production, so a transcription slip fails the test run.
-- Do not "tidy" whitespace in this file: the md5 check depends on it.

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_cols()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Nothing privileged changed -> allow (self-service edits, updated_at, etc.)
  if NEW.role            is not distinct from OLD.role
     and NEW.approved    is not distinct from OLD.approved
     and NEW.locked      is not distinct from OLD.locked
     and NEW.is_super_admin is not distinct from OLD.is_super_admin
     and NEW.country     is not distinct from OLD.country
     and NEW.site        is not distinct from OLD.site
     and NEW.org_id      is not distinct from OLD.org_id
     and NEW.organisation_id is not distinct from OLD.organisation_id
     and not (auth.uid() is not null and (
              NEW.sites            is distinct from OLD.sites
           or NEW.countries        is distinct from OLD.countries
           or NEW.web_access       is distinct from OLD.web_access
           or NEW.module_overrides is distinct from OLD.module_overrides
           or NEW.employee_id      is distinct from OLD.employee_id
           or NEW.email            is distinct from OLD.email
           or NEW.username         is distinct from OLD.username)) then
    return NEW;
  end if;

  -- Super admin may change anything.
  if public.is_super_admin() then
    return NEW;
  end if;

  -- Self-service username change (web Settings page). Allowed for the row
  -- owner when it is the ONLY guarded change and the new name is not another
  -- person's employee id (login identifier squatting).
  if public.get_my_role() is distinct from 'Admin'
     and NEW.id = auth.uid()
     and NEW.username is distinct from OLD.username
     and NEW.role            is not distinct from OLD.role
     and NEW.approved        is not distinct from OLD.approved
     and NEW.locked          is not distinct from OLD.locked
     and NEW.is_super_admin  is not distinct from OLD.is_super_admin
     and NEW.country         is not distinct from OLD.country
     and NEW.site            is not distinct from OLD.site
     and NEW.org_id          is not distinct from OLD.org_id
     and NEW.organisation_id is not distinct from OLD.organisation_id
     and NEW.sites            is not distinct from OLD.sites
     and NEW.countries        is not distinct from OLD.countries
     and NEW.web_access       is not distinct from OLD.web_access
     and NEW.module_overrides is not distinct from OLD.module_overrides
     and NEW.employee_id      is not distinct from OLD.employee_id
     and NEW.email            is not distinct from OLD.email then
    if exists (select 1 from public.profiles p
                where p.id <> NEW.id
                  and nullif(btrim(coalesce(p.employee_id, '')), '') is not null
                  and lower(btrim(p.employee_id)) = lower(btrim(coalesce(NEW.username, '')))) then
      raise exception 'That username is already in use.' using errcode = '23505';
    end if;
    return NEW;
  end if;

  -- Only an Admin may change any privileged column at all.
  if public.get_my_role() is distinct from 'Admin' then
    raise exception 'Not authorized to change role, approval, lock, country, site or organisation.'
      using errcode = '42501';
  end if;

  -- A non-super Admin may NEVER grant/revoke super-admin status.
  if NEW.is_super_admin is distinct from OLD.is_super_admin then
    raise exception 'Only a super admin can change super-admin status.'
      using errcode = '42501';
  end if;

  -- A non-super Admin may NEVER move a user between organisations.
  if NEW.org_id is distinct from OLD.org_id
     or NEW.organisation_id is distinct from OLD.organisation_id then
    raise exception 'Only a super admin can change a user''s organisation.'
      using errcode = '42501';
  end if;

  -- A non-super Admin may only manage users within their OWN organisation.
  if OLD.org_id is distinct from public.app_current_org() then
    raise exception 'Not authorized to manage a user in another organisation.'
      using errcode = '42501';
  end if;

  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_user_sites(p_user_id uuid, p_sites text[], p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_clean text[];
BEGIN
  perform set_config('app.access_reason', coalesce(nullif(btrim(coalesce(p_reason, '')), ''), ''), true);
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;

  IF NOT (public.is_super_admin() OR public.get_my_role() = 'Admin') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT upper(btrim(s))) FILTER (WHERE btrim(s) <> ''), NULL)
    INTO v_clean FROM unnest(COALESCE(p_sites, ARRAY[]::text[])) s;
  ALTER TABLE public.profiles DISABLE TRIGGER trg_guard_profile_privileged;
  UPDATE public.profiles SET sites = v_clean WHERE id = p_user_id;
  ALTER TABLE public.profiles ENABLE TRIGGER trg_guard_profile_privileged;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_web_access(p_user_id uuid, p_web boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  if not public._console_ip_allowed() then
    raise exception 'Console access is not allowed from this network' using errcode = '42501';
  end if;

  IF NOT (public.is_super_admin() OR public.get_my_role() = 'Admin') THEN
    RAISE EXCEPTION 'Not authorized to change web access.' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'A target user is required.';
  END IF;
  UPDATE public.profiles SET web_access = COALESCE(p_web, true) WHERE id = p_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_organisation_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if current_user in ('authenticated','anon') and (
    old.settings->'settings' is distinct from new.settings->'settings' or
    old.settings->'app_settings' is distinct from new.settings->'app_settings'
  ) then raise exception 'Use the audited configuration operation.' using errcode='42501'; end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.ensure_org_subscription()
 RETURNS public.org_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid := public.app_current_org();
  v_row public.org_subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.org_subscriptions
   WHERE organisation_id IS NOT DISTINCT FROM v_org ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.org_subscriptions
      (organisation_id, plan_code, status, billing_interval, seats,
       trial_ends_at, current_period_start, current_period_end)
    VALUES (v_org, 'trial', 'trialing', 'monthly', 1,
       now() + interval '14 days', now(), now() + interval '14 days')
    ON CONFLICT (organisation_id) DO NOTHING;
    SELECT * INTO v_row FROM public.org_subscriptions
     WHERE organisation_id IS NOT DISTINCT FROM v_org ORDER BY created_at LIMIT 1;
  END IF;
  RETURN v_row;
END $function$;

CREATE OR REPLACE FUNCTION public.stamp_import_default_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_setting text := nullif(btrim(coalesce(current_setting('tp.import_org', true), '')), '');
  v_org uuid;
begin
  if new.organisation_id is not null then
    return new;
  end if;
  if v_setting is not null then
    begin
      v_org := v_setting::uuid;
    exception when invalid_text_representation then
      raise exception 'tp.import_org is not a valid uuid' using errcode = 'PT409';
    end;
    if not exists (select 1 from public.organisations o where o.id = v_org) then
      raise exception 'tp.import_org does not name an existing organisation' using errcode = 'PT409';
    end if;
    new.organisation_id := v_org;
  elsif coalesce((select value from public.system_config where key = 'single_tenant_mode'), 'false') = 'true' then
    new.organisation_id := '00000000-0000-0000-0000-000000000001'::uuid;
  else
    raise exception 'Import refused: organisation_id is null, tp.import_org is not set and single_tenant_mode is off' using errcode = 'PT409';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.process_stg_job_cards()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  j jsonb := to_jsonb(NEW);
  v_org uuid := coalesce(public.app_current_org(), '00000000-0000-0000-0000-000000000001'::uuid);
  v_country text := public._stg_pick(j, 'country');
  v_jc      text := public._stg_pick(j, 'Job Card No');
  v_prod_out timestamptz; v_ws_in timestamptz; v_ws_out timestamptz;
  v_prod_in timestamptz; v_target timestamptz;
  v_status text; v_type text; v_bd numeric; v_closed boolean;
  v_wait_p numeric; v_wait_m numeric; v_mp_hrs numeric; v_extra jsonb;
begin
  if v_jc is null then return null; end if;
  if public.erp_is_footer(coalesce(public._stg_pick(j,'RFR Number'),'') || ' ' || v_jc) then return null; end if;

  v_prod_out := public.erp_parse_ts(public._stg_pick(j,'Production Out'));
  v_ws_in    := public.erp_parse_ts(public._stg_pick(j,'Workshop In'));
  v_ws_out   := public.erp_parse_ts(public._stg_pick(j,'Workshop Out'));
  v_prod_in  := public.erp_parse_ts(public._stg_pick(j,'Production In'));
  v_target   := public.erp_parse_ts(public._stg_pick(j,'Excepted Job Date/Time'));

  v_status := initcap(coalesce(public._stg_pick(j,'Status'),''));
  if v_status not in ('Open','In Progress','Awaiting Parts','Completed','Closed','Cancelled') then
    v_status := case when v_prod_in is not null or v_ws_out is not null then 'Completed' else 'Open' end;
  end if;

  v_type := lower(coalesce(public._stg_pick(j,'Type'),''));
  v_type := case
    when v_type like '%break%'   then 'Emergency'
    when v_type like '%schedul%' then 'Preventive Maintenance'
    when v_type like '%general%' or v_type like '%repair%' then 'Repair'
    when v_type like '%servic%'  then 'Service'
    when v_type like '%tyre%' or v_type like '%tire%' then 'Tyre Change'
    when v_type like '%inspect%' then 'Inspection'
    else 'Other' end;

  v_closed := (v_prod_in is not null or v_ws_out is not null);
  v_bd     := case when v_closed then public._to_num(public._stg_pick(j,'Total Breakdown hours')) end;
  v_wait_p := case when v_closed then coalesce(
                 public._to_num(public._stg_pick(j,'Waiting Part Hrs')),
                 public._to_num(public._stg_pick(j,'Waiting Parts Hrs'))) end;
  v_wait_m := case when v_closed then coalesce(
                 public._to_num(public._stg_pick(j,'Waiting Manpower Hrs')),
                 public._to_num(public._stg_pick(j,'Waiting Manpower Hours'))) end;
  v_mp_hrs := case when v_closed then coalesce(
                 public._to_num(public._stg_pick(j,'Manpower H')),
                 public._to_num(public._stg_pick(j,'Manpower Hrs'))) end;

  v_extra := jsonb_strip_nulls(jsonb_build_object(
    'erp_reported_cost', jsonb_strip_nulls(jsonb_build_object(
        'spare_parts',  public._to_num(public._stg_pick(j,'Spare Parts')),
        'tyre',         public._to_num(public._stg_pick(j,'Tyre')),
        'oil',          public._to_num(public._stg_pick(j,'Oil')),
        'others',       public._to_num(public._stg_pick(j,'Others')),
        'manpower',     public._to_num(public._stg_pick(j,'Manpower Cost')),
        'total_parts',  public._to_num(public._stg_pick(j,'Total Parts Consumption')),
        'total_repair', public._to_num(public._stg_pick(j,'Total Repair Cost')))),
    'erp_hours', jsonb_strip_nulls(jsonb_build_object(
        'breakdown',        public._to_num(public._stg_pick(j,'Total Breakdown hours')),
        'waiting_parts',    coalesce(public._to_num(public._stg_pick(j,'Waiting Part Hrs')),
                                     public._to_num(public._stg_pick(j,'Waiting Parts Hrs'))),
        'waiting_manpower', coalesce(public._to_num(public._stg_pick(j,'Waiting Manpower Hrs')),
                                     public._to_num(public._stg_pick(j,'Waiting Manpower Hours'))),
        'manpower',         coalesce(public._to_num(public._stg_pick(j,'Manpower H')),
                                     public._to_num(public._stg_pick(j,'Manpower Hrs'))))),
    'raised_by', public._stg_pick(j,'RFR Created By'),
    'raised_at', public._stg_pick(j,'RFR Created Date'),
    'card_by',   public._stg_pick(j,'Job Card Created By'),
    'card_at',   public._stg_pick(j,'Job Card Created Date'),
    'erp_type',            public._stg_pick(j,'Type'),
    'erp_breakdown_hours', public._to_num(public._stg_pick(j,'Total Breakdown hours')),
    'still_open',          not v_closed,
    'mr_no',               public._stg_pick(j,'MR NO'),
    'sco_no',              public._stg_pick(j,'SCO NO'),
    'asset_description',   public._stg_pick(j,'Asset Description'),
    'truck_category',      public._stg_pick(j,'Truck Category'),
    'head_tail',           public._stg_pick(j,'Head/Tail')));

  insert into public.work_orders (
    organisation_id, country, work_order_no, rfr_no, source_row,
    asset_no, plate_no, asset_category, site, work_location, scope,
    status, work_type, description, notes,
    opened_at, started_at, completed_at, target_completion,
    production_out_at, production_in_at,
    breakdown_hours, standard_hours,
    waiting_parts_hours, waiting_manpower_hours, manpower_hours, mr_no, sco_no, asset_description, truck_category, head_tail, custom_data)
  values (
    v_org, v_country, v_jc,
    public._stg_pick(j,'RFR Number'),
    public._stg_pick(j,'#'),
    upper(public._stg_pick(j,'Asset Code')),
    public._stg_pick(j,'Plate No'),
    public._stg_pick(j,'Asset Category'),
    public._stg_pick(j,'Location'),
    public._stg_pick(j,'Work Location'),
    public._stg_pick(j,'Scope'),
    v_status, v_type,
    public._stg_pick(j,'Production Complaint'),
    public._stg_pick(j,'Job Repair Description'),
    coalesce(v_prod_out, v_ws_in, now()), v_ws_in, v_ws_out, v_target,
    v_prod_out, v_prod_in,
    v_bd, public._to_num(public._stg_pick(j,'STD. Hours')),
    v_wait_p, v_wait_m, v_mp_hrs, public._stg_pick(j,'MR NO'), public._stg_pick(j,'SCO NO'), public._stg_pick(j,'Asset Description'), public._stg_pick(j,'Truck Category'), public._stg_pick(j,'Head/Tail'), v_extra)
  on conflict (work_order_no) do update set
    country = excluded.country, rfr_no = excluded.rfr_no, source_row = excluded.source_row,
    asset_no = coalesce(excluded.asset_no, work_orders.asset_no),
    plate_no = coalesce(excluded.plate_no, work_orders.plate_no),
    asset_category = coalesce(excluded.asset_category, work_orders.asset_category),
    site = coalesce(excluded.site, work_orders.site),
    work_location = coalesce(excluded.work_location, work_orders.work_location),
    scope = coalesce(excluded.scope, work_orders.scope),
    status = excluded.status, work_type = excluded.work_type,
    description = coalesce(excluded.description, work_orders.description),
    notes = coalesce(excluded.notes, work_orders.notes),
    opened_at = coalesce(excluded.opened_at, work_orders.opened_at),
    started_at = coalesce(excluded.started_at, work_orders.started_at),
    completed_at = coalesce(excluded.completed_at, work_orders.completed_at),
    target_completion = coalesce(excluded.target_completion, work_orders.target_completion),
    production_out_at = coalesce(excluded.production_out_at, work_orders.production_out_at),
    production_in_at = coalesce(excluded.production_in_at, work_orders.production_in_at),
    breakdown_hours = excluded.breakdown_hours,
    standard_hours = coalesce(excluded.standard_hours, work_orders.standard_hours),
    waiting_parts_hours = excluded.waiting_parts_hours,
    waiting_manpower_hours = excluded.waiting_manpower_hours,
    manpower_hours = excluded.manpower_hours,
    mr_no             = coalesce(excluded.mr_no,             work_orders.mr_no),
    sco_no            = coalesce(excluded.sco_no,            work_orders.sco_no),
    asset_description = coalesce(excluded.asset_description, work_orders.asset_description),
    truck_category    = coalesce(excluded.truck_category,    work_orders.truck_category),
    head_tail         = coalesce(excluded.head_tail,         work_orders.head_tail),
    custom_data = coalesce(work_orders.custom_data,'{}'::jsonb) || excluded.custom_data,
    updated_at = now();

  return null;
end $function$;
