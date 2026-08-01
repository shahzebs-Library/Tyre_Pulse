-- =====================================================================================
-- V436 - Repair KSA accident and inspection links without rewriting asset history.
--
-- Asset numbers may legitimately appear in more than one country over time. Only a
-- unique KSA fleet match is used here; historical sites and cross-country records stay
-- unchanged.
-- =====================================================================================

-- Move imported inspections into the organisation that owns their unique KSA fleet
-- record. Normalise only the asset spelling so "TM 423" links to "TM423".
alter table public.inspections disable trigger trg_lock_inspection_content;

with ksa_fleet_candidates as (
  select
    regexp_replace(lower(trim(asset_no)), '[^a-z0-9]', '', 'g') as asset_key,
    min(asset_no) as canonical_asset_no,
    min(organisation_id::text)::uuid as organisation_id,
    count(*) as candidate_count
  from public.vehicle_fleet
  where upper(trim(coalesce(country, ''))) = 'KSA'
    and nullif(regexp_replace(lower(trim(asset_no)), '[^a-z0-9]', '', 'g'), '') is not null
  group by regexp_replace(lower(trim(asset_no)), '[^a-z0-9]', '', 'g')
), unique_ksa_fleet as (
  select asset_key, canonical_asset_no, organisation_id
  from ksa_fleet_candidates
  where candidate_count = 1
)
update public.inspections i
set organisation_id = f.organisation_id,
    country = 'KSA',
    region = case
      when i.region is null or trim(i.region) = '' then 'KSA'
      else i.region
    end,
    asset_no = f.canonical_asset_no
from unique_ksa_fleet f
where regexp_replace(lower(trim(i.asset_no)), '[^a-z0-9]', '', 'g') = f.asset_key
  and (
    i.organisation_id is distinct from f.organisation_id
    or upper(trim(coalesce(i.country, ''))) <> 'KSA'
    or i.asset_no is distinct from f.canonical_asset_no
  );

alter table public.inspections enable trigger trg_lock_inspection_content;

-- Every current accident record belongs to KSA. Link it only when there is exactly one
-- KSA vehicle candidate in the same organisation, so UAE/Egypt history remains valid.
with ksa_fleet_candidates as (
  select
    organisation_id,
    regexp_replace(lower(trim(asset_no)), '[^a-z0-9]', '', 'g') as asset_key,
    min(id::text)::uuid as fleet_id,
    count(*) as candidate_count
  from public.vehicle_fleet
  where upper(trim(coalesce(country, ''))) = 'KSA'
    and nullif(regexp_replace(lower(trim(asset_no)), '[^a-z0-9]', '', 'g'), '') is not null
  group by organisation_id,
           regexp_replace(lower(trim(asset_no)), '[^a-z0-9]', '', 'g')
), unique_ksa_fleet as (
  select organisation_id, asset_key, fleet_id
  from ksa_fleet_candidates
  where candidate_count = 1
)
update public.accidents a
set country = 'KSA',
    vehicle_id = f.fleet_id
from unique_ksa_fleet f
where f.organisation_id = a.organisation_id
  and f.asset_key = regexp_replace(lower(trim(a.asset_no)), '[^a-z0-9]', '', 'g')
  and (
    upper(trim(coalesce(a.country, ''))) <> 'KSA'
    or a.vehicle_id is distinct from f.fleet_id
  );

-- Keep denormalised accident child metadata aligned with the corrected parent rows.
do $$
declare
  v_table_name text;
begin
  for v_table_name in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name like 'accident_%'
      and c.column_name in ('accident_id', 'country')
    group by c.table_name
    having count(distinct c.column_name) = 2
  loop
    execute format(
      'update public.%I child
          set country = parent.country
         from public.accidents parent
        where child.accident_id = parent.id
          and child.country is distinct from parent.country',
      v_table_name
    );
  end loop;
end;
$$;

-- Verification:
-- select country, count(*) from public.accidents group by country;
-- select count(*) from public.accidents where vehicle_id is null;
-- select country, count(*) from public.inspections group by country;
-- select count(*) from public.inspections i where not exists (
--   select 1 from public.vehicle_fleet f
--   where f.organisation_id = i.organisation_id
--     and upper(trim(f.country)) = upper(trim(i.country))
--     and regexp_replace(lower(trim(f.asset_no)), '[^a-z0-9]', '', 'g')
--       = regexp_replace(lower(trim(i.asset_no)), '[^a-z0-9]', '', 'g')
-- );
