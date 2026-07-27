-- V373 - classification brain: make it fast, make it provable, fix what a
-- full-table check against every stored bucket exposed.
--
-- Applied live 2026-07-27 in six steps (v373a..v373f). This file is the record.
--
-- WHY
-- V371 stamped classified_by / classify_confidence on new rows but left all
-- 216,792 existing rows NULL, so no historical figure could be traced to the
-- evidence that produced it. Backfilling that meant running the brain over every
-- row, which is how the speed problem and three real defects were found.
--
-- WHAT IT COST BEFORE: brain_classify measured at ~4.1 ms per line, because it
-- runs about thirty whole-word regex probes. It is the per-row hot path on every
-- import, so a 100k-row upload spent ~7 minutes classifying. AFTER: 0.22 ms per
-- line, ~22 seconds for the same upload. 18.4x, measured on 5,000 live rows
-- (20,430 ms -> 1,109 ms).
--
-- WHAT MOVED: 3,419 lines changed bucket. Every country TOTAL is unchanged -
-- Egypt 79,341,428 / KSA 40,608,350 / UAE 18,493,541 - so no money was created
-- or lost, only filed correctly. Pre-change buckets are kept in
-- _bucket_snapshot_20260727 (deny-all) so this is reversible.
--
-- =========================================================================
-- V373a. The seven brain_* functions are pure string logic but were left
-- PARALLEL UNSAFE (the default), which blocks any parallel plan over
-- parts_consumption. They take no locks, touch no tables and read no settings.
-- =========================================================================
alter function public.brain_tokens(text)                        parallel safe;
alter function public.brain_has_word(text, text)                parallel safe;
alter function public.brain_has_any_word(text, text[])          parallel safe;
alter function public.brain_has_tyre_size(text)                 parallel safe;
alter function public.brain_is_lubricant(text)                  parallel safe;
alter function public.brain_code_category(text)                 parallel safe;
alter function public.brain_classify(text, text, text, boolean) parallel safe;

-- =========================================================================
-- V373b. Classification cache.
--
-- The live table holds 216,792 rows across only 22,128 distinct
-- (country, item code, description) combinations - a repetition factor of 9.8.
-- Re-importing a file that was already loaded repeats it exactly. The cache is
-- keyed on EVERY input that can change the answer, so it cannot serve a stale
-- verdict:
--   organisation_id  - one tenant must never read another tenant's item text
--   country          - the same item code means different things per country
--   item code + description hash
--   reviewed         - a human decision in material_master, '' when none
--   jobcard          - whether a tyre was fitted on this job card
--   rules_version    - bumped whenever the brain's logic changes
--
-- BUMP public.brain_rules_version() IN THE SAME MIGRATION AS ANY CHANGE TO A
-- brain_* FUNCTION. That is what retires every cached answer; forgetting it is
-- the only way this cache can go stale.
-- =========================================================================
create or replace function public.brain_rules_version()
returns int language sql immutable parallel safe as $$ select 3 $$;

comment on function public.brain_rules_version() is
  'Cache generation for brain_cache. Increment on ANY change to a brain_* function.';

create table if not exists public.brain_cache (
  organisation_id uuid    not null default public.app_current_org(),
  country         text    not null,
  item_code       text    not null,
  desc_hash       text    not null,
  reviewed        text    not null,
  jobcard         boolean not null,
  rules_version   int     not null,
  bucket          text    not null,
  decided_by      text    not null,
  confidence      numeric not null,
  item_desc       text,
  created_at      timestamptz not null default now(),
  primary key (organisation_id, country, item_code, desc_hash, reviewed, jobcard, rules_version)
);

alter table public.brain_cache enable row level security;

drop policy if exists brain_cache_org_isolation on public.brain_cache;
create policy brain_cache_org_isolation on public.brain_cache
  as restrictive for all to authenticated
  using  (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));

drop policy if exists brain_cache_read on public.brain_cache;
create policy brain_cache_read on public.brain_cache
  for select to authenticated using ((select public.app_is_active()));

revoke all on public.brain_cache from anon;
grant select on public.brain_cache to authenticated;

-- Cached front door. SECURITY DEFINER so the import trigger can write the cache
-- entry regardless of the caller's grants; it stamps the org it is passed, so a
-- row can never be written into another tenant.
create or replace function public.brain_classify_cached(
  p_org uuid, p_country text, p_item_code text, p_desc text,
  p_reviewed text, p_jobcard boolean)
returns table (bucket text, decided_by text, confidence numeric)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_code text := upper(btrim(coalesce(p_item_code, '')));
  v_hash text := md5(upper(btrim(coalesce(p_desc, ''))));
  v_rev  text := coalesce(p_reviewed, '');
  v_jc   boolean := coalesce(p_jobcard, false);
  v_ver  int := public.brain_rules_version();
begin
  select c.bucket, c.decided_by, c.confidence into bucket, decided_by, confidence
    from public.brain_cache c
   where c.organisation_id = p_org and c.country = p_country
     and c.item_code = v_code and c.desc_hash = v_hash
     and c.reviewed = v_rev and c.jobcard = v_jc and c.rules_version = v_ver;
  if found then return next; return; end if;

  select b.bucket, b.decided_by, b.confidence into bucket, decided_by, confidence
    from public.brain_classify(p_item_code, p_desc, nullif(v_rev, ''), v_jc) b;

  insert into public.brain_cache (organisation_id, country, item_code, desc_hash,
                                  reviewed, jobcard, rules_version,
                                  bucket, decided_by, confidence, item_desc)
  values (p_org, p_country, v_code, v_hash, v_rev, v_jc, v_ver,
          bucket, decided_by, confidence, left(coalesce(p_desc, ''), 300))
  on conflict do nothing;

  return next;
end $$;

revoke all on function public.brain_classify_cached(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.brain_classify_cached(uuid, text, text, text, text, boolean) to authenticated;

-- =========================================================================
-- V373c. The import trigger now goes through the cache. Identical evidence,
-- identical precedence, identical answer - only the repeated derivation is
-- skipped. See the live function for the full body; the only line that changed
-- from V371 is the brain call:
--     select * into v_brain
--       from public.brain_classify_cached(v_org, NEW.country, NEW.item_code,
--                                         NEW.item_description, v_reviewed, v_jobcard);
--
-- NOTE FOR ANYONE TOUCHING parts_consumption: trg_classify_parts_consumption is
-- BEFORE INSERT **OR UPDATE**. Updating ANY column re-runs classification and can
-- re-bucket the row. That is intended for a correction pass and a trap for
-- anything else - it is how the Egypt re-bucketing below actually happened.
-- =========================================================================

-- =========================================================================
-- V373d / V373e. Three defects the full-table check exposed, all live.
--
-- 1. COOLANT went to the spare default. That would have moved KSA's 622 coolant
--    lines OUT of oil while Egypt's OL- code range kept its 113 IN. The stored
--    data was already consistent - every coolant line in all three countries was
--    booked as oil - so the engine was about to introduce an inconsistency the
--    data did not have. 'cooliant' is the Egypt export's own spelling, matched
--    verbatim. A COOLANT FILTER or COOLANT LINE stays a part, because the
--    oil_part tokens are tested first.
-- 2. A bare "number W number" was read as a viscosity grade, so
--    "REAR U BOLT 6W 24*92*500" and "LED LIGHT 50 W 60*60" put 64 lines of bolts
--    and lamps into oil. Spacing cannot separate them from a real grade, because
--    "Shell Spirax S2 A 85 W - 140" is genuine. What separates them is what
--    FOLLOWS: a dimension continues into another measurement (* or x), a grade
--    does not.
-- 3. 'lubricant' is matched whole-word, so it never reached "LUBRICATING OIL".
--    AdBlue / diesel exhaust fluid is a dosed consumable already booked as oil.
--
-- These mirror LUBRICANT_TOKENS / isLubricant / hasViscosityGrade in
-- src/lib/classificationBrain.js. CHANGE BOTH, and add the failing row to
-- src/test/classificationBrain.test.js first.
-- =========================================================================
create or replace function public.brain_tokens(p_kind text)
returns text[] language sql immutable parallel safe set search_path to 'public' as $function$
  select case p_kind
    when 'accessory' then array[
      'patch','patches','valve','glue','cement','fender','flap','inflat','gauge','soap',
      'chalk','rim','wheel nut','wheel bolt','wheel stud','wheel clamp','wheel set',
      'balanc','weight','spanner','remover','tool','paste','marker','protector','foam',
      'puncture','nozzle','welding machine','wheel barrow','kilomitter','spill',
      'inner tube','tube and flap','tube flap','spacer ring','spider hub','repair kit']
    when 'lubricant' then array[
      'engine oil','gear oil','hydraulic oil','compressor oil','transmission oil',
      'brake oil','brake fluid','atf','grease','lubricant','delvac','rimula','voyager',
      'gear fluid','hydraulic fluid',
      'coolant','cooliant','antifreeze','anti freeze','radiator fluid',
      'lubricating','adblue','ad blue','diesel exhaust fluid','def fluid']
    when 'oil_part' then array[
      'filter','seal','gasket','pump','cooler','line','hose','pipe','gauge','sensor',
      'switch','cap','tank','strainer','separator','baffle','injection']
    when 'tyre_brand' then array[
      'roadx','longmarch','long march','rockholder','roadwest','mac royal','drive master',
      'drivemaster','cachland','taiho','v-glory','v glory','fortune','allround','tanova',
      'bossway','ecostar','transking','transtone','double star','wildpeak','priny',
      'roadking','firemax','montana','maxam','tracmax','trackmax','skyfire','sky fire',
      'infinity','tegrys','ericle','zeetex','prille','techking','blackhawk','doublecoin',
      'double coin','westlake','westlike','jinyu','triangle','advance','nison','century',
      'wellplus','formula','aosen','gold dove','superway','kunlun','fulda','rock buster',
      'diamond back','aget','allianz','firestone','bridgestone','michelin','goodyear',
      'dunlop','hankook','kumho','yokohama','pirelli','continental','apollo','mrf','ceat',
      'bkt','otani','annaite','sailun','windforce','joyroad','roadlux','chaoyang','mitas',
      'alliance','itr','tvs','linglong','aeolus']
    else array[]::text[] end;
$function$;

create or replace function public.brain_is_lubricant(p_text text)
returns boolean language sql immutable parallel safe set search_path to 'public' as $function$
  select case
    when public.brain_has_any_word(p_text, public.brain_tokens('oil_part')) then false
    when public.brain_has_any_word(p_text, public.brain_tokens('lubricant')) then true
    -- real grade only: reject a run that continues into another dimension
    else coalesce(p_text,'') ~* '\y\d{1,2}\s?w\s?[-\s]?\s?\d{2,3}\y(?!\s*[*x]\s*\d)'
  end;
$function$;

delete from public.brain_cache where rules_version < public.brain_rules_version();

-- =========================================================================
-- V373f. Rollback artifact, locked down. Pre-change buckets for all 216,792
-- lines. Deny-all - RLS on with no policy and no grants - so it is not a second
-- copy of tenant cost data on the API surface. Drop it once the new buckets have
-- been accepted.
-- =========================================================================
-- create table public._bucket_snapshot_20260727 as
--   select id, country, cost_category, tyre_cost, spare_cost, oil_cost, line_cost,
--          classified_by, classify_confidence from public.parts_consumption;
alter table public._bucket_snapshot_20260727 enable row level security;
revoke all on public._bucket_snapshot_20260727 from anon, authenticated, public;
comment on table public._bucket_snapshot_20260727 is
  'Pre-V373 cost buckets for parts_consumption. Rollback artifact, deny-all. Drop when no longer needed.';

-- =========================================================================
-- RESULT, verified live
--
--            tyre         spare        oil          total        (total unchanged)
-- Egypt   16,718,706   43,099,318   19,523,404   79,341,428   EGP
-- KSA     11,297,676   23,987,502    5,323,172   40,608,350   SAR
-- UAE      6,148,661   10,424,299    1,920,582   18,493,541   AED
--
-- Provenance now on 216,792 / 216,792 rows:
--   default               131,901  conf 0.30   (no evidence beyond the fallback)
--   code-range             37,796  conf 0.95
--   description-lubricant  21,177  conf 0.90
--   accessory              13,680  conf 0.90
--   reviewed-master         8,702  conf 1.00   (a human decided)
--   description-tyre        3,536  conf 0.85
--
-- The 131,901 'default' lines are the honest measure of how much of this spend
-- nothing but the fallback explains. Reviewing those item codes in Material
-- Master is what shrinks that number.
-- =========================================================================
