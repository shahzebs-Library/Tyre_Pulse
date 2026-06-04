-- ============================================================
-- TYREPULSE — MASTER DATA ENGINE
-- Built by Shahzeb Rahman © 2026
--
-- Run in this order in Supabase SQL Editor:
--   1. SUPABASE_SCHEMA.sql
--   2. MIGRATIONS.sql
--   3. BACKEND_RLS.sql
--   4. MIGRATIONS_V2.sql
--   5. MASTER_ENGINE.sql  ← this file
--
-- What this engine provides:
--   • Upload-batch tracking (every record knows which upload created it)
--   • Auto-process trigger  (CPK, country, cost, qty enforced on every insert/update)
--   • Brand alias table      (common misspellings → canonical names)
--   • Master view            (v_tyre_master — clean, enriched, always consistent)
--   • Data quality view      (v_data_quality_issues — flag missing / anomalous records)
--   • Country KPI function   (get_country_kpi() — callable via Supabase RPC)
--   • Duplicate-check helper (check_duplicate_serials())
--   • Performance indexes    (search, filter, CPK-specific)
--   • Backfill pass          (fixes existing records immediately on run)
-- ============================================================


-- ── 1. UPLOAD BATCH TRACKING ─────────────────────────────────
-- Tags every tyre record with its source (manual / upload / api)
-- and the exact upload_history row that created it.

alter table public.tyre_records
  add column if not exists data_source     text  default 'manual'
    check (data_source in ('manual','upload','api')),
  add column if not exists upload_batch_id uuid
    references public.upload_history(id) on delete set null;

-- Extend upload_history with country so stats are filterable
alter table public.upload_history
  add column if not exists country text default 'KSA';


-- ── 2. BRAND ALIAS TABLE ──────────────────────────────────────
-- Maps free-text / misspelled brand names to canonical forms.
-- Add your own rows at any time — they take effect immediately.

create table if not exists public.brand_aliases (
  id         bigserial    primary key,
  alias      text         unique not null,   -- lower-cased, trimmed
  canonical  text         not null,
  created_at timestamptz  default now()
);

insert into public.brand_aliases (alias, canonical) values
  ('bridgestone',   'Bridgestone'), ('bs',          'Bridgestone'),
  ('michelin',      'Michelin'),    ('mich',        'Michelin'),
  ('goodyear',      'Goodyear'),    ('gy',          'Goodyear'),
  ('good year',     'Goodyear'),
  ('continental',   'Continental'), ('conti',       'Continental'),
  ('pirelli',       'Pirelli'),     ('pir',         'Pirelli'),
  ('hankook',       'Hankook'),     ('hk',          'Hankook'),
  ('yokohama',      'Yokohama'),    ('yoko',        'Yokohama'),
  ('toyo',          'Toyo'),
  ('dunlop',        'Dunlop'),
  ('bfgoodrich',    'BFGoodrich'),  ('bf goodrich', 'BFGoodrich'), ('bfg', 'BFGoodrich'),
  ('triangle',      'Triangle'),    ('tri',         'Triangle'),
  ('linglong',      'Linglong'),    ('ll',          'Linglong'),
  ('doublestar',    'Doublestar'),  ('double star', 'Doublestar'),
  ('westlake',      'Westlake'),
  ('gt radial',     'GT Radial'),
  ('warrior',       'Warrior'),
  ('advance',       'Advance'),
  ('boto',          'Boto'),
  ('deruibo',       'Deruibo'),
  ('joyroad',       'Joyroad'),
  ('roadx',         'RoadX'),
  ('sunfull',       'Sunfull'),
  ('techking',      'Techking')
on conflict (alias) do nothing;

-- RLS for brand_aliases (authenticated users can read; admins can write)
alter table public.brand_aliases enable row level security;
create policy "Read brand aliases" on public.brand_aliases
  for select using (auth.role() = 'authenticated');
create policy "Admin write brand aliases" on public.brand_aliases
  for all using (public.get_my_role() = 'Admin');


-- ── 3. HELPER FUNCTIONS ───────────────────────────────────────

-- Returns canonical brand name from alias table, or initcap of raw value
create or replace function public.normalize_brand(raw text)
returns text language sql stable security definer as $$
  select coalesce(
    (select canonical from public.brand_aliases
      where alias = lower(trim(raw)) limit 1),
    initcap(trim(raw))
  )
$$;

-- Collapses extra whitespace and title-cases a site name
create or replace function public.normalize_site(raw text)
returns text language sql immutable security definer as $$
  select initcap(trim(regexp_replace(raw, '\s+', ' ', 'g')))
$$;

-- Null-safe CPK calculation: cost / (km_removal − km_fitment)
create or replace function public.calc_cpk(
  cost   numeric,
  km_fit numeric,
  km_rem numeric
)
returns numeric language sql immutable as $$
  select case
    when km_fit  is not null
     and km_rem  is not null
     and km_rem  >  km_fit
     and cost    is not null
     and cost    >  0
    then round(cost::numeric / (km_rem - km_fit), 4)
    else null
  end
$$;

-- Maps raw country string to one of: KSA | UAE | Egypt
-- Handles common variations so data from different sources unifies cleanly
create or replace function public.normalize_country(raw text)
returns text language sql immutable as $$
  select case upper(trim(raw))
    when 'KSA'                    then 'KSA'
    when 'SA'                     then 'KSA'
    when 'SAUDI'                  then 'KSA'
    when 'SAUDI ARABIA'           then 'KSA'
    when 'UAE'                    then 'UAE'
    when 'AE'                     then 'UAE'
    when 'UNITED ARAB EMIRATES'   then 'UAE'
    when 'DUBAI'                  then 'UAE'
    when 'ABU DHABI'              then 'UAE'
    when 'EGYPT'                  then 'Egypt'
    when 'EG'                     then 'Egypt'
    when 'CAIRO'                  then 'Egypt'
    else 'KSA'                    -- safe fallback
  end
$$;


-- ── 4. MASTER AUTO-PROCESS TRIGGER ────────────────────────────
-- Fires BEFORE INSERT OR UPDATE on tyre_records.
-- Guarantees data quality regardless of whether the insert came
-- from the app, the bulk uploader, a direct SQL import, or an API call.

create or replace function public.tyre_records_master_process()
returns trigger language plpgsql as $$
declare
  v_default_cost numeric;
begin

  -- ── Country: normalise or fall back to region, then 'KSA' ──
  if new.country is null or trim(new.country) = '' then
    new.country := public.normalize_country(coalesce(new.region, 'KSA'));
  else
    new.country := public.normalize_country(new.country);
  end if;

  -- ── Qty: must be at least 1 ─────────────────────────────────
  if new.qty is null or new.qty < 1 then
    new.qty := 1;
  end if;

  -- ── Cost: never null or zero; fall back to global setting ───
  if new.cost_per_tyre is null or new.cost_per_tyre <= 0 then
    select value::numeric into v_default_cost
      from public.settings where key = 'cost_per_tyre' limit 1;
    new.cost_per_tyre := coalesce(v_default_cost, 1200);
  end if;

  -- ── KM sanity: zero means "not provided" ───────────────────
  if new.km_at_fitment = 0 then new.km_at_fitment := null; end if;
  if new.km_at_removal = 0 then new.km_at_removal := null; end if;

  -- ── KM order: swap silently if fitment > removal ───────────
  if new.km_at_fitment is not null
  and new.km_at_removal is not null
  and new.km_at_fitment > new.km_at_removal then
    declare tmp numeric;
    begin
      tmp := new.km_at_fitment;
      new.km_at_fitment := new.km_at_removal;
      new.km_at_removal := tmp;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists tyre_records_master_process_tg on public.tyre_records;
create trigger tyre_records_master_process_tg
  before insert or update on public.tyre_records
  for each row execute function public.tyre_records_master_process();


-- ── 5. MASTER VIEW (v_tyre_master) ────────────────────────────
-- The single clean read surface for all reporting.
-- CPK, total cost, age, and normalised strings are always available.
-- Pages can query this view instead of tyre_records when they need
-- pre-computed fields (e.g. for SQL exports, external BI tools).

create or replace view public.v_tyre_master as
select
  t.id,
  t.sr,
  t.issue_date,
  t.country,
  public.normalize_site(t.site)                                       as site,
  public.normalize_brand(t.brand)                                     as brand,
  t.serial_no,
  t.asset_no,
  t.mis_number,
  t.job_card,
  t.description,
  coalesce(t.remarks_cleaned, t.remarks)                              as remarks,
  t.category,
  t.risk_level,
  t.qty,
  t.cost_per_tyre,
  (t.cost_per_tyre * coalesce(t.qty, 1))                              as total_cost,
  t.km_at_fitment,
  t.km_at_removal,
  public.calc_cpk(t.cost_per_tyre, t.km_at_fitment, t.km_at_removal) as cpk,
  case
    when t.issue_date is not null
    then (current_date - t.issue_date)::integer
    else null
  end                                                                  as age_days,
  t.cleaned,
  t.data_source,
  t.upload_batch_id,
  t.created_at,
  t.uploaded_by
from public.tyre_records t;

grant select on public.v_tyre_master to authenticated;


-- ── 6. DATA QUALITY VIEW (v_data_quality_issues) ──────────────
-- Every record that has at least one quality problem.
-- Drives the Data Cleaning page and helps prioritise remediation.

create or replace view public.v_data_quality_issues as
select
  t.id,
  t.issue_date,
  t.country,
  t.site,
  t.brand,
  t.serial_no,
  t.asset_no,
  t.cost_per_tyre,
  t.km_at_fitment,
  t.km_at_removal,
  t.category,
  t.risk_level,
  t.cleaned,
  -- Individual flags ────────────────────────────────────────────
  (t.brand      is null or trim(t.brand)      = '') as missing_brand,
  (t.site       is null or trim(t.site)       = '') as missing_site,
  (t.asset_no   is null or trim(t.asset_no)   = '') as missing_asset,
  (t.serial_no  is null)                             as missing_serial,
  (t.issue_date is null)                             as missing_date,
  (t.category   is null)                             as missing_category,
  (t.risk_level is null)                             as missing_risk,
  (t.cost_per_tyre > 50000)                          as cost_too_high,
  (t.cost_per_tyre < 100)                            as cost_too_low,
  (t.km_at_removal < t.km_at_fitment
   and t.km_at_fitment is not null
   and t.km_at_removal is not null)                  as km_order_wrong,
  -- Severity score (higher = more issues) ──────────────────────
  (
    (case when t.brand      is null or t.brand      = '' then 1 else 0 end) +
    (case when t.site       is null or t.site       = '' then 1 else 0 end) +
    (case when t.asset_no   is null                      then 1 else 0 end) +
    (case when t.issue_date is null                      then 1 else 0 end) +
    (case when t.category   is null                      then 1 else 0 end) +
    (case when t.risk_level is null                      then 1 else 0 end) +
    (case when t.cost_per_tyre > 50000
           or t.cost_per_tyre < 100                      then 1 else 0 end)
  )::smallint                                         as issue_score
from public.tyre_records t
where
  (t.brand      is null or trim(t.brand)      = '')
  or (t.site    is null or trim(t.site)       = '')
  or (t.issue_date is null)
  or (t.category   is null)
  or (t.risk_level is null)
  or (t.cost_per_tyre > 50000 or t.cost_per_tyre < 100)
  or (t.km_at_removal < t.km_at_fitment
      and t.km_at_fitment is not null
      and t.km_at_removal is not null)
order by issue_score desc, t.created_at desc;

grant select on public.v_data_quality_issues to authenticated;


-- ── 7. COUNTRY KPI FUNCTION ───────────────────────────────────
-- Callable from the app via:  supabase.rpc('get_country_kpi')
-- Returns one row per country with all key metrics.

create or replace function public.get_country_kpi(
  p_country text default null   -- null = all countries
)
returns table (
  country          text,
  total_records    bigint,
  total_cost       numeric,
  avg_cost_tyre    numeric,
  high_risk_count  bigint,
  high_risk_pct    numeric,
  avg_cpk          numeric,
  sites_count      bigint,
  brands_count     bigint,
  latest_date      date,
  open_actions     bigint,
  overdue_actions  bigint
) language sql stable security definer as $$
  select
    t.country,
    count(t.id)                                                   as total_records,
    round(sum(t.cost_per_tyre * coalesce(t.qty,1)), 0)            as total_cost,
    round(avg(t.cost_per_tyre), 0)                                as avg_cost_tyre,
    count(*) filter (
      where t.risk_level in ('High','Critical'))                  as high_risk_count,
    round(
      count(*) filter (where t.risk_level in ('High','Critical'))
      ::numeric / nullif(count(t.id),0) * 100, 1)                as high_risk_pct,
    round(avg(
      public.calc_cpk(t.cost_per_tyre, t.km_at_fitment, t.km_at_removal)
    ) filter (
      where public.calc_cpk(t.cost_per_tyre, t.km_at_fitment, t.km_at_removal)
            is not null), 4)                                      as avg_cpk,
    count(distinct t.site)                                        as sites_count,
    count(distinct t.brand)                                       as brands_count,
    max(t.issue_date)                                             as latest_date,
    (select count(*) from public.corrective_actions a
       where a.status = 'Open'
         and (p_country is null or a.country = t.country))        as open_actions,
    (select count(*) from public.corrective_actions a
       where a.status  != 'Closed'
         and a.due_date < current_date
         and (p_country is null or a.country = t.country))        as overdue_actions
  from public.tyre_records t
  where (p_country is null or t.country = p_country)
  group by t.country
  order by total_records desc
$$;


-- ── 8. DUPLICATE SERIAL CHECK FUNCTION ───────────────────────
-- Used by UploadData before committing a batch to flag existing serials.
-- Call: supabase.rpc('check_duplicate_serials', { serials: ['S001','S002'] })

create or replace function public.check_duplicate_serials(serials text[])
returns table (
  serial_no      text,
  existing_id    uuid,
  existing_date  date,
  existing_site  text,
  existing_brand text
) language sql stable security definer as $$
  select t.serial_no, t.id, t.issue_date, t.site, t.brand
  from public.tyre_records t
  where t.serial_no = any(serials)
  order by t.serial_no, t.issue_date desc
$$;


-- ── 9. ADDITIONAL PERFORMANCE INDEXES ────────────────────────
-- The base schema already has site, asset_no, date, brand, region.
-- These complement them for the new query patterns.

create index if not exists idx_tyre_records_serial
  on public.tyre_records(serial_no) where serial_no is not null;
create index if not exists idx_tyre_records_risk
  on public.tyre_records(risk_level) where risk_level is not null;
create index if not exists idx_tyre_records_category
  on public.tyre_records(category)  where category   is not null;
create index if not exists idx_tyre_records_data_source
  on public.tyre_records(data_source);
create index if not exists idx_tyre_records_upload_batch
  on public.tyre_records(upload_batch_id) where upload_batch_id is not null;
create index if not exists idx_ca_country_status
  on public.corrective_actions(country, status);
create index if not exists idx_ca_due_date
  on public.corrective_actions(due_date) where due_date is not null;
create index if not exists idx_brand_aliases_alias
  on public.brand_aliases(alias);


-- ── 10. BACKFILL PASS ─────────────────────────────────────────
-- Applies the master-engine rules to all pre-existing records.
-- Safe to run multiple times (idempotent).

-- 10a. Normalise country on all existing rows
update public.tyre_records
  set country = public.normalize_country(country)
  where country is not null;

-- 10b. Stamp rows that came from upload_history as 'upload'
update public.tyre_records t
  set data_source = 'upload'
  from public.upload_history uh
  where t.uploaded_by = uh.uploaded_by
    and t.data_source  = 'manual'
    and t.cleaned      is not null
    and t.source_file  is not null;

-- 10c. Fix obviously bad costs
update public.tyre_records
  set cost_per_tyre = 1200
  where cost_per_tyre is null or cost_per_tyre <= 0;

-- 10d. Fix bad qty values
update public.tyre_records
  set qty = 1
  where qty is null or qty < 1;

-- 10e. Zero-km → null
update public.tyre_records
  set km_at_fitment = null where km_at_fitment = 0;
update public.tyre_records
  set km_at_removal = null where km_at_removal = 0;

-- 10f. Swap inverted KM pairs
update public.tyre_records
  set km_at_fitment = km_at_removal,
      km_at_removal = km_at_fitment
  where km_at_fitment is not null
    and km_at_removal is not null
    and km_at_fitment > km_at_removal;


-- ── VERIFY ────────────────────────────────────────────────────
-- Run these after applying to confirm everything is working:
--
--   select country, count(*) from public.tyre_records group by country;
--
--   select * from public.v_tyre_master limit 5;
--
--   select * from public.v_data_quality_issues limit 10;
--
--   select * from public.get_country_kpi();
--
--   select * from public.brand_aliases order by canonical;
--
--   select * from public.check_duplicate_serials(array['YOUR_SERIAL_HERE']);
--
-- ============================================================
