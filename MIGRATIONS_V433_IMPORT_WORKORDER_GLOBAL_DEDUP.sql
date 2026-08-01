-- =====================================================================================
-- V433 - Data Intake: work-order live dedup must mirror the live uniqueness rule.
--
-- work_orders.work_order_no is globally unique in the live table. The Data Intake
-- preview checked country + work_order_no, so a job card already present under
-- another country looked insertable, then failed during commit with a unique
-- violation. For workorder only, return the global work_order_no key.
-- =====================================================================================

create or replace function public.import_existing_keys(p_module text, p_country text)
returns setof text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_org    uuid := public.app_current_org();
  v_target text := public.import_target_table(p_module);
  v_key    text;
  v_guard  text;
  v_country_predicate text := '($2 is null or country is not distinct from $2)';
begin
  if v_target is null then return; end if;

  if p_module = 'fleet' then
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(asset_no,'''')))';
  elsif p_module = 'tyre' then
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(serial_no,'''')))';
  elsif p_module = 'stock' then
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(site,''''))) '
          || '|| chr(1) || lower(btrim(coalesce(description,'''')))';
  elsif p_module = 'accident' then
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || '
          || 'lower(btrim(coalesce(nullif(btrim(coalesce(insurance_claim_no,'''')),''''), police_report_no, '''')))';
  elsif p_module = 'inspection' then
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(asset_no,''''))) '
          || '|| chr(1) || lower(btrim(coalesce(inspection_type,''''))) '
          || '|| chr(1) || lower(btrim(coalesce(inspection_date::text,''''))) '
          || '|| chr(1) || lower(btrim(coalesce(inspector,'''')))';
  elsif p_module = 'workorder' then
    v_key := 'lower(btrim(coalesce(work_order_no,'''')))';
    v_country_predicate := 'true';
  elsif p_module = 'warranty' then
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(serial_number,''''))) '
          || '|| chr(1) || lower(btrim(coalesce(claim_no,'''')))';
  elsif p_module = 'gatepass' then
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(asset_no,''''))) '
          || '|| chr(1) || lower(btrim(coalesce(pass_date::text,'''')))';
  elsif p_module = 'supplier' then
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || '
          || 'lower(btrim(coalesce(nullif(btrim(coalesce(supplier_code,'''')),''''), supplier_name, '''')))';
  elsif p_module = 'driver' then
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(driver_id,'''')))';
  else
    return;
  end if;

  if p_module = 'stock' then
    v_guard := '(btrim(coalesce(site,'''')) <> '''' or btrim(coalesce(description,'''')) <> '''')';
  elsif p_module = 'tyre' then
    v_guard := 'btrim(coalesce(serial_no,'''')) <> ''''';
  elsif p_module = 'accident' then
    v_guard := '(btrim(coalesce(insurance_claim_no,'''')) <> '''' or btrim(coalesce(police_report_no,'''')) <> '''')';
  elsif p_module = 'workorder' then
    v_guard := 'btrim(coalesce(work_order_no,'''')) <> ''''';
  elsif p_module = 'warranty' then
    v_guard := 'btrim(coalesce(serial_number,'''')) <> ''''';
  elsif p_module = 'supplier' then
    v_guard := '(btrim(coalesce(supplier_code,'''')) <> '''' or btrim(coalesce(supplier_name,'''')) <> '''')';
  elsif p_module = 'driver' then
    v_guard := 'btrim(coalesce(driver_id,'''')) <> ''''';
  else
    v_guard := 'btrim(coalesce(asset_no,'''')) <> ''''';
  end if;

  return query execute format(
    $q$
      select distinct %s as k
      from public.%I
      where (organisation_id is null or organisation_id = $1)
        and %s
        and %s
    $q$, v_key, v_target, v_country_predicate, v_guard)
  using v_org, p_country;
end
$fn$;

grant execute on function public.import_existing_keys(text, text) to authenticated;
revoke execute on function public.import_existing_keys(text, text) from public, anon;

comment on function public.import_existing_keys(text, text) is
  'V433: workorder returns global work_order_no keys because work_orders.work_order_no is globally unique; other modules remain country-scoped.';

create or replace function public.import_merge_key(p_module text, p_d jsonb)
returns text
language plpgsql
immutable
as $$
declare
  c   text := lower(btrim(coalesce(p_d ->> 'country', '')));
  id1 text;
  id2 text;
begin
  case p_module
    when 'workorder' then
      id1 := lower(btrim(coalesce(p_d ->> 'work_order_no', '')));
      if id1 = '' then return null; end if;
      return id1;

    when 'accident' then
      id1 := lower(btrim(coalesce(
               nullif(btrim(coalesce(p_d ->> 'insurance_claim_no', '')), ''),
               p_d ->> 'police_report_no', '')));
      if id1 = '' then return null; end if;
      return c || chr(1) || id1;

    when 'warranty' then
      id1 := lower(btrim(coalesce(p_d ->> 'serial_number', '')));
      id2 := lower(btrim(coalesce(p_d ->> 'claim_no', '')));
      if id2 = '' and id1 = '' then return null; end if;
      return c || chr(1) || id1 || chr(1) || id2;

    else
      return null;
  end case;
end
$$;

grant execute on function public.import_merge_key(text, jsonb) to authenticated;
revoke execute on function public.import_merge_key(text, jsonb) from public, anon;

comment on function public.import_merge_key(text, jsonb) is
  'V433: workorder merge key is global work_order_no; accident and warranty remain country-scoped.';
