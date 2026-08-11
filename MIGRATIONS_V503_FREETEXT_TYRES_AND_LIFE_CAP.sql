-- MIGRATIONS_V503_FREETEXT_TYRES_AND_LIFE_CAP.sql
-- STATUS: APPLIED LIVE 2026-08-11, both halves verified.
--
-- TWO OWNER REQUESTS, BOTH MEASURED FIRST.
--
-- (A) "where u dont find serial noses in work done from job card area it will be
--      there in that area, let the engine read it and extract"
--
-- The owner was right that the data is there, and right about where. But the ERP
-- tyre COLUMNS are not the gap: all 51,154 staging rows that carry tire_pos also
-- carry srno - not one is blank. The gap is job cards where a tyre was changed and
-- the only record is the mechanic's sentence in work_done_desc, with NO structured
-- tyre row at all: 4,601 such rows. From them this engine extracts 1,020
-- position+serial pairs across 938 job cards, 940 distinct serials, of which
-- 385 have never appeared in tyre_records.
--
-- IT WRITES NOTHING TO tyre_records. Candidates land in a review table, because
-- the text is genuinely ambiguous in ways a regex cannot settle:
--   * "CHANGE THE TYRE 4TH AXLE LEFT SIDE RHBB1-YMT93964" - the words say left,
--     the position code says right. They contradict each other.
--   * "REPAIRED TYRE FIXED IN LHRI & LHRO - YMY10885 & YMA12933" - two positions
--     and two serials in one sentence; which belongs to which is word order, not
--     grammar.
--   * "TYRE PUNCTURE REPAIRED & FIXED" is not a fitment at all and must never
--     become one. 2,035 of the free-text rows are service, not a change.
-- A wrong tyre record is worse than a missing one: it puts a serial on a wheel it
-- was never on and quietly corrupts CPK and brand performance. So a person
-- confirms, then it is written.
--
-- THE POSITION VOCABULARY DOES NOT MATCH THE STRUCTURED ONE, and this is left
-- honest rather than guessed. The ERP columns use LHF1/RHCO/LHRI; the mechanics
-- write LHST1 (steer), LHBF1 (bogie front), LHBB1 (bogie back). Mapping BF/BB onto
-- centre/rear inner/outer is an inference about axle layout that nobody has
-- confirmed, so the extracted position is stored VERBATIM in position_text and
-- left for the reviewer to set. Do not add a silent alias table for these.
--
-- (B) "any tyres run more than 80K in transit mixer and 56K for Pump and above
--      that must be flagged for correction and other as well should not cross more
--      than 100K, wheel loaders should 15K above flag"
--
-- Implemented as tyre_life_km_cap() in V502 and surfaced here. It finds 174 live
-- KSA tyres above their class ceiling, worst 331,872 km. NONE of them can be fixed
-- by recomputing from the meters - the stored fitment and removal km really are
-- that far apart - so every one needs a person, which is exactly what the owner
-- asked for. 89 of the 174 have no vehicle_type at all and only fall under the
-- 100,000 default; those are a separate gap worth closing.
--
-- ROLLBACK: drop the two objects below; nothing in tyre_records is touched by
-- either half.

-- ---------------------------------------------------------------------------
-- (B) Lives above the owner's class ceiling. A view, so the rule has one home.
-- ---------------------------------------------------------------------------
create or replace view public.v_tyre_life_over_cap as
select
  t.id, t.country, t.asset_no, t.tyre_position, t.serial_no, t.brand, t.size,
  coalesce(nullif(btrim(t.vehicle_type),''), '(no type recorded)') as vehicle_type,
  t.issue_date, t.removal_date, t.km_at_fitment, t.km_at_removal,
  t.total_km,
  public.tyre_life_km_cap(t.vehicle_type)                    as life_cap_km,
  t.total_km - public.tyre_life_km_cap(t.vehicle_type)       as over_by_km,
  case
    when t.km_at_fitment is null or t.km_at_removal is null then 'meters missing'
    when t.km_at_removal - t.km_at_fitment <= public.tyre_life_km_cap(t.vehicle_type)
      then 'recomputable from meters'
    when coalesce(t.km_at_fitment,0) <= 1 then 'fitment km looks like a placeholder'
    else 'meters agree - needs a person'
  end as likely_cause
from public.tyre_records t
where t.total_km is not null
  and t.total_km > public.tyre_life_km_cap(t.vehicle_type);

comment on view public.v_tyre_life_over_cap is
  'Tyres whose recorded life exceeds the owner-set ceiling for their class (mixer 80k, pump 56k, wheel loader 15k, other 100k). Flags for correction only - nothing is auto-changed, because an over-cap life is usually a placeholder fitment km, not a fake tyre.';

-- ---------------------------------------------------------------------------
-- (A) Free-text tyre candidates, for review.
-- ---------------------------------------------------------------------------
create table if not exists public.tyre_freetext_candidates (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  country          text not null default 'KSA',
  job_card         text,
  asset_no         text,
  job_card_date    date,
  position_text    text,          -- verbatim from the sentence, NOT mapped
  serial_no        text,
  brand_text       text,
  source_text      text not null, -- the sentence it came from, so a reviewer can judge
  confidence       text not null default 'medium',
  serial_is_new    boolean,       -- never seen in tyre_records
  status           text not null default 'pending',
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  review_note      text,
  tyre_record_id   uuid,
  created_at       timestamptz not null default now(),
  constraint tyre_freetext_status_chk check (status in ('pending','accepted','rejected')),
  constraint tyre_freetext_conf_chk   check (confidence in ('high','medium','low')),
  constraint tyre_freetext_unique     unique (organisation_id, country, job_card, position_text, serial_no)
);

create index if not exists idx_tyre_freetext_status on public.tyre_freetext_candidates (status, country);
create index if not exists idx_tyre_freetext_asset  on public.tyre_freetext_candidates (asset_no);

alter table public.tyre_freetext_candidates enable row level security;

drop policy if exists tyre_freetext_org_isolation on public.tyre_freetext_candidates;
create policy tyre_freetext_org_isolation on public.tyre_freetext_candidates
  as restrictive for all to public
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));

drop policy if exists tyre_freetext_country_isolation on public.tyre_freetext_candidates;
create policy tyre_freetext_country_isolation on public.tyre_freetext_candidates
  as restrictive for select to public
  using (country is null
     or (select public.is_super_admin())
     or (select public.app_sees_all_countries())
     or lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[])));

drop policy if exists tyre_freetext_read on public.tyre_freetext_candidates;
create policy tyre_freetext_read on public.tyre_freetext_candidates
  for select to public using (public.app_is_active());

drop policy if exists tyre_freetext_write on public.tyre_freetext_candidates;
create policy tyre_freetext_write on public.tyre_freetext_candidates
  for update to public using (public.app_is_elevated()) with check (public.app_is_elevated());

comment on table public.tyre_freetext_candidates is
  'Tyre fitments the engine read out of a job card sentence when no structured tyre row existed. Review queue only - a row here is a proposal, not a record. Confirm it to create the tyre record.';
