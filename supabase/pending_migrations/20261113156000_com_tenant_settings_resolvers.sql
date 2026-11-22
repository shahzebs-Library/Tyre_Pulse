-- COM-6 (audit MODC-02, MODA-17, MODA-3, MODA-4, MODB-1, MODB-2, MODC-06):
--        per-organisation resolvers for branding, countries and currency, tyre life ceilings,
--        approver roles and accident vocabulary.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from LIVE definitions read with SELECT only
--         (get_report_snapshot, get_workshop_snapshot, get_report_tyre_maintenance,
--         tyre_life_km_cap, tyre_km_life, checklist_is_supervisor, checklist_is_area_manager,
--         decide_inspection_approval, country_currency rows). Not applied to any database.
--         Tested on PGlite only (supabase/tests/commercial_tenant_settings.test.mjs).
--         REQUIRES 20261113150000_com_organisation_settings_foundation.sql first.
--         Design and the list of callers that must switch later:
--         docs/commercial-readiness/audit/TENANT_SETTINGS_DESIGN.md
--
-- ROOT CAUSE
--   Five things are one company's choice but are stored once for the platform or written into
--   code: the company name and logo printed on public boards and labels (public.settings
--   company_name, system_config company_logo); the country and currency list (three countries
--   in the web code); the tyre life ceilings (SQL tyre_life_km_cap and src/lib/tyreKm.js);
--   the role names allowed to sign inspections and checklists (role names that exist only as
--   the current company's custom roles); the accident form vocabulary (the current company's
--   abbreviation as liable party and payer, and two Saudi report types for every country).
--
-- WHAT THIS ADDS (additive only: NOTHING that runs today calls these functions yet)
--   Resolver functions that answer each question for ONE organisation, in this order:
--     1. the organisation's own row in public.organisation_settings;
--     2. for the legacy owner organisation only, the global value its screens edit today
--        (company name and logo), read with the same expression the live functions use;
--     3. a neutral platform default.
--   Values that are hard-coded in code today are SEEDED as the legacy owner organisation's own
--   rows (tyre_life_km_caps, approval_roles, accident_vocabulary, countries), so when a caller
--   is switched to the resolver the current company gets the same answer as today. The PGlite
--   test proves that equality against faithful copies of the live functions.
--
-- RISK TO THE CURRENT COMPANY: NONE at apply time. New functions and up to four new settings
--   rows for the legacy owner organisation. No existing function, view, policy or row is
--   altered, and no screen or function reads the new objects until a later, separately
--   reviewed change switches a caller (each switch is listed with its own risk in the design
--   document; the tyre ceiling switch is the one rated medium).
--
-- VERIFY (after applying; read only)
--   select key from public.organisation_settings
--    where organisation_id = public.legacy_settings_owner_org() order by key;
--     -- accident_vocabulary, approval_roles, countries, tyre_life_km_caps
--   select bool_and(public.tyre_life_km_cap_for(public.legacy_settings_owner_org(), v)
--                   = public.tyre_life_km_cap(v))
--     from (select distinct vehicle_type v from public.vehicle_fleet) s;            -- t
--   select has_function_privilege('authenticated','public.org_public_branding(uuid)','EXECUTE'); -- f
--   select has_function_privilege('authenticated','public.my_org_countries()','EXECUTE');        -- t
--
-- ROLLBACK
--   Remove the functions created below and the four seeded organisation_settings rows of the
--   legacy owner organisation. Nothing else refers to them.

-- ── 1. Public branding (company name and logo on share boards, TV links, QR labels) ───────
create or replace function public.org_public_branding(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_company text;
  v_logo    text;
  v_set     jsonb;
begin
  if p_org is null then
    return jsonb_build_object('company', 'TyrePulse', 'logo', null, 'source', 'none');
  end if;

  if p_org = public.legacy_settings_owner_org() then
    -- Same expressions as the live get_report_snapshot (read 2026-11-12).
    select value::text into v_company from public.settings where key = 'company_name' limit 1;
    v_company := coalesce(nullif(replace(replace(v_company, '"', ''), '\', ''), ''), 'TyrePulse');
    select coalesce(value_text, value::text) into v_logo
      from public.system_config where key = 'company_logo' limit 1;
    v_logo := nullif(replace(replace(coalesce(v_logo, ''), '"', ''), '\', ''), '');
  else
    select nullif(btrim(o.name), ''),
           nullif(btrim(coalesce(o.settings -> 'branding' ->> 'logo_url', o.logo_url, '')), '')
      into v_company, v_logo
      from public.organisations o where o.id = p_org;
    v_company := coalesce(v_company, 'TyrePulse');
  end if;

  v_set := public.org_setting(p_org, 'public_branding');
  if v_set is not null and jsonb_typeof(v_set) = 'object' then
    v_company := coalesce(nullif(btrim(v_set ->> 'company_name'), ''), v_company);
    v_logo    := coalesce(nullif(btrim(v_set ->> 'logo_url'), ''), v_logo);
  end if;

  return jsonb_build_object(
    'company', v_company, 'logo', v_logo,
    'source', case when v_set is not null then 'organisation'
                   when p_org = public.legacy_settings_owner_org() then 'legacy_global'
                   else 'organisation_record' end);
end
$function$;

create or replace function public.my_org_public_branding()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when public.app_is_active()
              then public.org_public_branding(public.app_current_org()) end;
$function$;

-- ── 2. Countries and currency ────────────────────────────────────────────────────────────
-- organisation_settings key 'countries':
--   [{"country":"KSA","currency":"SAR","currency_name":"Saudi Riyal","label":"KSA","is_base":true}, ...]
-- No row: the platform catalogue public.country_currency (what every screen assumes today).
create or replace function public.org_countries(p_org uuid)
returns table (country text, currency text, currency_name text, label text, is_base boolean, sort_order int)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v jsonb := public.org_setting(p_org, 'countries');
begin
  if v is not null and jsonb_typeof(v) = 'array' and jsonb_array_length(v) > 0 then
    return query
      select nullif(btrim(e.item ->> 'country'), ''),
             nullif(btrim(e.item ->> 'currency'), ''),
             nullif(btrim(e.item ->> 'currency_name'), ''),
             coalesce(nullif(btrim(e.item ->> 'label'), ''), nullif(btrim(e.item ->> 'country'), '')),
             coalesce((e.item ->> 'is_base')::boolean, false),
             e.ord::int
        from jsonb_array_elements(v) with ordinality as e(item, ord)
       where nullif(btrim(e.item ->> 'country'), '') is not null
         and nullif(btrim(e.item ->> 'currency'), '') is not null
       order by e.ord;
    return;
  end if;
  return query
    select c.country, c.currency, c.currency_name, c.country, c.is_base,
           (row_number() over (order by c.is_base desc, c.country))::int
      from public.country_currency c
     order by c.is_base desc, c.country;
end
$function$;

create or replace function public.org_currency_for_country(p_org uuid, p_country text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select c.currency from public.org_countries(p_org) c
      where upper(btrim(c.country)) = upper(btrim(coalesce(p_country, ''))) limit 1),
    public.currency_for_country(p_country));
$function$;

create or replace function public.my_org_countries()
returns table (country text, currency text, currency_name text, label text, is_base boolean, sort_order int)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select c.* from public.org_countries(public.app_current_org()) c
   where public.app_is_active();
$function$;

-- ── 3. Tyre life ceilings ────────────────────────────────────────────────────────────────
-- organisation_settings key 'tyre_life_km_caps':
--   {"default_cap_km": 100000, "rules": [{"contains": "MIXER", "cap_km": 80000}, ...]}
-- The FIRST rule whose text is contained in the upper-cased vehicle type wins, as in the live
-- CASE. No row: the existing public.tyre_life_km_cap(vehicle_type), unchanged.
create or replace function public.tyre_life_km_cap_for(p_org uuid, p_vehicle_type text)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v    jsonb := public.org_setting(p_org, 'tyre_life_km_caps');
  v_vt text  := upper(coalesce(p_vehicle_type, ''));
  r    jsonb;
  v_default numeric;
begin
  if v is null or jsonb_typeof(v) <> 'object' then
    return public.tyre_life_km_cap(p_vehicle_type);
  end if;
  if jsonb_typeof(v -> 'rules') = 'array' then
    for r in select e.item from jsonb_array_elements(v -> 'rules') with ordinality as e(item, ord) order by e.ord
    loop
      if nullif(btrim(r ->> 'contains'), '') is not null
         and (r ->> 'cap_km') ~ '^[0-9]+(\.[0-9]+)?$'
         and position(upper(btrim(r ->> 'contains')) in v_vt) > 0 then
        return (r ->> 'cap_km')::numeric;
      end if;
    end loop;
  end if;
  if (v ->> 'default_cap_km') ~ '^[0-9]+(\.[0-9]+)?$' then
    v_default := (v ->> 'default_cap_km')::numeric;
  end if;
  return coalesce(v_default, public.tyre_life_km_cap(p_vehicle_type));
end
$function$;

-- Same km rule as the live public.tyre_km_life (read 2026-11-12), with the ceiling taken from
-- the organisation. Not IMMUTABLE (it reads a table), so it cannot replace tyre_km_life inside
-- an index or a generated column; none exists today (checked in pg_indexes and pg_attrdef).
create or replace function public.tyre_km_life_for(p_org uuid, p_fit numeric, p_rem numeric, p_total numeric, p_vehicle_type text)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when v.km is not null and v.km <= public.tyre_life_km_cap_for(p_org, p_vehicle_type) then v.km end
  from (select case
    when p_fit > 1 and p_rem > p_fit then p_rem - p_fit
    when p_fit > 1 and p_total > 0 then p_total
    when p_fit = 1 then null
    when p_fit = 0 and p_total > 0 then p_total
    when p_fit = 0 and p_rem > 0 then p_rem
    when p_fit is null and p_total > 0 then p_total
  end as km) v
$function$;

create or replace function public.my_tyre_life_km_caps()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when public.app_is_active() then
    coalesce(public.org_setting(public.app_current_org(), 'tyre_life_km_caps'),
             -- the platform default, expressed in the same shape the web mirror will read
             jsonb_build_object('default_cap_km', 100000, 'rules', jsonb_build_array(
               jsonb_build_object('contains', 'MIXER',  'cap_km', 80000),
               jsonb_build_object('contains', 'PUMP',   'cap_km', 56000),
               jsonb_build_object('contains', 'LOADER', 'cap_km', 15000))))
  end;
$function$;

-- ── 4. Approver roles (inspection sign-off, checklist supervisor and final approver) ─────
-- organisation_settings key 'approval_roles':
--   {"inspection_signers": [...], "checklist_supervisors": [...], "checklist_area_managers": [...]}
-- No row or an empty list: the built-in roles every company has.
create or replace function public.org_approval_roles(p_org uuid, p_kind text)
returns text[]
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v     jsonb := public.org_setting(p_org, 'approval_roles');
  v_out text[];
begin
  if p_kind not in ('inspection_signers', 'checklist_supervisors', 'checklist_area_managers') then
    raise exception 'Unknown approval role list %', p_kind using errcode = '22023';
  end if;
  if v is not null and jsonb_typeof(v -> p_kind) = 'array' then
    select array_agg(btrim(x.role) order by x.ord) into v_out
      from jsonb_array_elements_text(v -> p_kind) with ordinality as x(role, ord)
     where btrim(x.role) <> '';
  end if;
  if v_out is null or cardinality(v_out) = 0 then
    v_out := array['Admin', 'Manager', 'Director'];
  end if;
  return v_out;
end
$function$;

-- The test the three live gates would call. Same shape as today:
--   is_super_admin() or get_my_role() = any (<list>)
create or replace function public.my_role_in_approval_list(p_kind text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.is_super_admin()
      or coalesce(public.get_my_role() = any (public.org_approval_roles(public.app_current_org(), p_kind)), false);
$function$;

create or replace function public.my_org_approval_roles()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when public.app_is_active() then jsonb_build_object(
    'inspection_signers',      to_jsonb(public.org_approval_roles(public.app_current_org(), 'inspection_signers')),
    'checklist_supervisors',   to_jsonb(public.org_approval_roles(public.app_current_org(), 'checklist_supervisors')),
    'checklist_area_managers', to_jsonb(public.org_approval_roles(public.app_current_org(), 'checklist_area_managers')))
  end;
$function$;

-- ── 5. Accident vocabulary ───────────────────────────────────────────────────────────────
-- organisation_settings key 'accident_vocabulary':
--   {"own_company_label": "...",            what the form shows for "we are liable / we pay"
--    "legacy_own_company_values": ["..."],  stored values that mean the company itself
--    "internal_workshops": ["..."], "external_workshops": ["..."],
--    "country_packs": {"KSA": ["najm","taqdeer"], "*": [...]}}   extra report fields per country
-- No row: the organisation's own name and no country pack.
create or replace function public.org_accident_vocabulary(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v      jsonb := public.org_setting(p_org, 'accident_vocabulary');
  v_name text;
begin
  select nullif(btrim(o.name), '') into v_name from public.organisations o where o.id = p_org;
  v_name := coalesce(v_name, 'Own company');
  return jsonb_build_object(
           'own_company_code', 'own_company',
           'own_company_label', v_name,
           'legacy_own_company_values', '[]'::jsonb,
           'internal_workshops', jsonb_build_array(v_name || ' Workshop'),
           'external_workshops', '[]'::jsonb,
           'country_packs', '{}'::jsonb)
         || case when v is not null and jsonb_typeof(v) = 'object' then v else '{}'::jsonb end;
end
$function$;

create or replace function public.my_org_accident_vocabulary()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case when public.app_is_active()
              then public.org_accident_vocabulary(public.app_current_org()) end;
$function$;

-- ── Grants: anything that takes an organisation id is internal ───────────────────────────
revoke all on function public.org_public_branding(uuid) from public, anon, authenticated;
revoke all on function public.org_countries(uuid) from public, anon, authenticated;
revoke all on function public.org_currency_for_country(uuid, text) from public, anon, authenticated;
revoke all on function public.tyre_life_km_cap_for(uuid, text) from public, anon, authenticated;
revoke all on function public.tyre_km_life_for(uuid, numeric, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.org_approval_roles(uuid, text) from public, anon, authenticated;
revoke all on function public.org_accident_vocabulary(uuid) from public, anon, authenticated;
revoke all on function public.my_org_public_branding() from public, anon;
revoke all on function public.my_org_countries() from public, anon;
revoke all on function public.my_tyre_life_km_caps() from public, anon;
revoke all on function public.my_role_in_approval_list(text) from public, anon;
revoke all on function public.my_org_approval_roles() from public, anon;
revoke all on function public.my_org_accident_vocabulary() from public, anon;
grant execute on function public.org_public_branding(uuid) to service_role;
grant execute on function public.org_countries(uuid) to service_role;
grant execute on function public.org_currency_for_country(uuid, text) to service_role;
grant execute on function public.tyre_life_km_cap_for(uuid, text) to service_role;
grant execute on function public.tyre_km_life_for(uuid, numeric, numeric, numeric, text) to service_role;
grant execute on function public.org_approval_roles(uuid, text) to service_role;
grant execute on function public.org_accident_vocabulary(uuid) to service_role;
grant execute on function public.my_org_public_branding() to authenticated, service_role;
grant execute on function public.my_org_countries() to authenticated, service_role;
grant execute on function public.my_tyre_life_km_caps() to authenticated, service_role;
grant execute on function public.my_role_in_approval_list(text) to authenticated, service_role;
grant execute on function public.my_org_approval_roles() to authenticated, service_role;
grant execute on function public.my_org_accident_vocabulary() to authenticated, service_role;

-- ── Seed: today's hard-coded values become the legacy owner organisation's own rows ──────
-- Existing rows are never overwritten (on conflict do nothing), so re-running is safe.
insert into public.organisation_settings (organisation_id, key, value, updated_by)
select o.id, s.key, s.value, null
  from public.organisations o
  cross join (values
    -- src/contexts/SettingsContext.jsx:21-23 (order, currency and short label as on screen)
    ('countries', '[
       {"country":"KSA","currency":"SAR","currency_name":"Saudi Riyal","label":"KSA","is_base":true},
       {"country":"UAE","currency":"AED","currency_name":"UAE Dirham","label":"UAE","is_base":false},
       {"country":"Egypt","currency":"EGP","currency_name":"Egyptian Pound","label":"EGY","is_base":false}
     ]'::jsonb),
    -- live public.tyre_life_km_cap and src/lib/tyreKm.js:18-21
    ('tyre_life_km_caps', '{"default_cap_km":100000,"rules":[
       {"contains":"MIXER","cap_km":80000},
       {"contains":"PUMP","cap_km":56000},
       {"contains":"LOADER","cap_km":15000}]}'::jsonb),
    -- live decide_inspection_approval, checklist_is_supervisor, checklist_is_area_manager
    ('approval_roles', '{
       "inspection_signers":["Admin","PMV Manager","Workshop Area Manager","Workshop Maintenance Area Manager","Tyre Data Collector"],
       "checklist_supervisors":["Admin","Maintenance Supervisor","Workshop Supervisor","PMV Manager","Workshop Area Manager","Workshop Maintenance Area Manager","Tyre Data Collector"],
       "checklist_area_managers":["Admin","Director","PMV Manager","Workshop Area Manager","Workshop Maintenance Area Manager"]}'::jsonb),
    -- src/lib/accidentVocab.js:48,50,141-142,161-162. "*" = shown for every country, as today.
    ('accident_vocabulary', '{
       "own_company_label":"GCC",
       "legacy_own_company_values":["GCC"],
       "internal_workshops":["GCC Workshop"],
       "external_workshops":["Vision Workshop"],
       "country_packs":{"*":["najm","taqdeer"]}}'::jsonb)
  ) as s(key, value)
 where o.id = public.legacy_settings_owner_org()
on conflict (organisation_id, key) do nothing;
