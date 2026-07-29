-- =====================================================================
-- V420 - REMOVAL_REASON STILL HOLDS A BRAND ON 857 UAE ROWS (brand ALREADY set)
-- STATUS: AUTHORED, NOT YET APPLIED.
-- Needs a Supabase-MCP-authorized session to apply + verify against
-- project jhssdmeruxtrlqnwfksc.
-- V417 and V418 are RESERVED for the accident module (02_DATA_MODEL.sql /
-- 08_ENGINE_SQL_MIRROR.sql), so this migration is V420. RE-CONFIRM the next free
-- migration number at apply time before running.
-- =====================================================================
--
-- STANDING OPEN ITEM 5 (measured live earlier this session):
--   tyre_records holds exactly 857 rows - ALL UAE, org Company A
--   (00000000-0000-0000-0000-000000000001) - where `removal_reason` carries a
--   catalog BRAND value while `brand` is ALREADY populated.
--
-- V403 moved brands OUT of removal_reason only for rows whose `brand` was BLANK
-- (582 rows recovered). These 857 were deliberately left behind because their
-- brand was already correct, so V403 had nothing to recover - but the
-- removal_reason column stays contaminated. Measured example: ROADX was the
-- SECOND most common "reason a tyre was removed" fleet-wide, which is a brand,
-- not a reason.
--
-- This is harmless to reported SPEND (removal_reason is not a money column) but
-- any removal-reason analysis must currently exclude brand values. This
-- migration clears the contamination at the source.
--
-- WHICH VALUES ARE BRANDS IS DECIDED BY EVIDENCE, NOT A HAND-WRITTEN LIST.
-- A value qualifies only if it matches `brain_tokens('tyre_brand')`, the exact
-- catalog the classifier already uses - the same principle as V403 and as
-- V400d's veto reusing `oil_part`. There is NO second brand list to drift out of
-- step with the classifier.
--
-- RADIAL IS DELIBERATELY NOT MOVED / NOT CLEARED, exactly as in V403. It is a
-- tyre CONSTRUCTION type, not a manufacturer; a purely data-driven test could
-- accept it, but clearing a genuine construction descriptor would destroy real
-- information rather than remove a bad value.
--
-- WHAT THIS CHANGES:
--   removal_reason SET NULL on the qualifying rows.
--   `brand` is NOT touched - it is already correct on every one of these rows.
--
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SNAPSHOT the affected rows BEFORE changing anything (reversible).
--    Mirrors V403's _brand_from_removal_reason_v403 snapshot shape; here the
--    recoverable value is old_removal_reason (brand stays put), and old_brand is
--    captured purely as proof that brand was already populated.
-- ---------------------------------------------------------------------
create table if not exists public._removal_reason_cleanup_v420 (
  id uuid primary key,
  country text,
  asset_no text,
  serial_no text,
  old_brand text,
  old_removal_reason text,
  cleared_at timestamptz not null default now()
);

revoke all on public._removal_reason_cleanup_v420 from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Identify + snapshot. A row qualifies only when:
--      country = 'UAE'                                    (the contamination is UAE only)
--      brand is ALREADY non-null / non-blank              (nothing to recover; clear-only)
--      removal_reason is non-null / non-blank
--      normalized removal_reason IS a tyre_brand token    (evidence, not a guess)
--      normalized removal_reason <> 'RADIAL'              (construction type, kept)
--    Normalization matches V403 exactly: lower, strip every non-alphanumeric.
-- ---------------------------------------------------------------------
with catalog as (
  select distinct regexp_replace(lower(tok), '[^a-z0-9]', '', 'g') as b
  from unnest(public.brain_tokens('tyre_brand')) as tok
),
target as (
  select t.id, t.country, t.asset_no, t.serial_no,
         t.brand as old_brand,
         t.removal_reason as old_removal_reason
  from public.tyre_records t
  where t.organisation_id = '00000000-0000-0000-0000-000000000001'
    and t.country = 'UAE'
    and t.brand is not null and btrim(t.brand) <> ''
    and t.removal_reason is not null and btrim(t.removal_reason) <> ''
    and regexp_replace(lower(btrim(t.removal_reason)), '[^a-z0-9]', '', 'g')
        in (select b from catalog)
    and regexp_replace(lower(btrim(t.removal_reason)), '[^a-z0-9]', '', 'g') <> 'radial'
)
insert into public._removal_reason_cleanup_v420
       (id, country, asset_no, serial_no, old_brand, old_removal_reason)
select id, country, asset_no, serial_no, old_brand, old_removal_reason
from target
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. Clear removal_reason on exactly the snapshotted rows. brand untouched.
-- ---------------------------------------------------------------------
update public.tyre_records t
   set removal_reason = null
  from public._removal_reason_cleanup_v420 s
 where t.id = s.id
   and t.organisation_id = '00000000-0000-0000-0000-000000000001';

-- =====================================================================
-- 4. VERIFICATION (expected on live data: 857 rows snapshotted + cleared, UAE
--    only, brand column byte-identical before/after).
-- =====================================================================

-- 4a. How many rows were snapshotted (should be the 857 measured this session).
--     select count(*) as snapshotted from public._removal_reason_cleanup_v420;

-- 4b. Confirm every snapshotted row is UAE and every one already carried a brand.
--     select count(*)                             as total,
--            count(*) filter (where country = 'UAE')            as uae_rows,
--            count(*) filter (where old_brand is not null
--                               and btrim(old_brand) <> '')     as had_brand
--     from public._removal_reason_cleanup_v420;
--     -- expect total = uae_rows = had_brand

-- 4c. Confirm 0 UAE rows still carry a brand in removal_reason after the run.
--     with catalog as (
--       select distinct regexp_replace(lower(tok), '[^a-z0-9]', '', 'g') as b
--       from unnest(public.brain_tokens('tyre_brand')) as tok
--     )
--     select count(*) as uae_brand_in_reason_remaining
--     from public.tyre_records t
--     where t.organisation_id = '00000000-0000-0000-0000-000000000001'
--       and t.country = 'UAE'
--       and t.removal_reason is not null and btrim(t.removal_reason) <> ''
--       and regexp_replace(lower(btrim(t.removal_reason)), '[^a-z0-9]', '', 'g')
--           in (select b from catalog)
--       and regexp_replace(lower(btrim(t.removal_reason)), '[^a-z0-9]', '', 'g') <> 'radial';
--     -- expect 0

-- 4d. Confirm the brand column was NOT touched - every live brand still equals
--     the brand captured in the snapshot.
--     select count(*) as brand_changed
--     from public.tyre_records t
--     join public._removal_reason_cleanup_v420 s on s.id = t.id
--     where t.brand is distinct from s.old_brand;
--     -- expect 0

-- 4e. Confirm genuine (non-brand) removal reasons elsewhere are untouched:
--     KSA / Egypt removal_reason counts should be unchanged by this migration
--     (it only ever writes rows present in the snapshot, all UAE).

-- =====================================================================
-- 5. ROLLBACK / UNDO - re-populate removal_reason from the snapshot.
--     (brand was never changed, so nothing to restore there.)
--
--   update public.tyre_records t
--      set removal_reason = s.old_removal_reason
--     from public._removal_reason_cleanup_v420 s
--    where t.id = s.id
--      and t.organisation_id = '00000000-0000-0000-0000-000000000001';
--
--   -- then, if fully reverting:
--   -- drop table public._removal_reason_cleanup_v420;
-- =====================================================================
