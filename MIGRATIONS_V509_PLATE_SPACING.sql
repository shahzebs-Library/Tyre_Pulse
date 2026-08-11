-- MIGRATIONS_V509_PLATE_SPACING.sql
-- STATUS: APPLIED LIVE 2026-08-11, verified (5 updated, 17 conflicts remain, 0 spacing cases left).
--
-- Of the 22 plates where the master list disagreed with the register, FIVE were not
-- disagreements: strip the spaces and the two strings are the same plate.
--   BH018  "2041  XXB"  vs "2041 XXB"    doubled space
--   PL077  "6957 H X A" vs "6957 HXA"    letters spaced out
--   SL019  "1843ZAA"    vs "1843 ZAA"    no space
--   TM655  "8448 GXA"   vs "8448 G X A"  letters spaced out
--   TM736  "1981  JTA"  vs "1981 JTA"    doubled space
-- Picking between those is formatting, not a decision about which plate a vehicle
-- carries, so they are normalised to the master list's spacing and drop out of the
-- list the owner has to rule on. The guard is exact: the update fires ONLY when the
-- two values are identical once every space is removed, so it can never resolve a
-- real difference by accident.
--
-- THE OTHER 17 ARE UNTOUCHED and remain the owner's call, because each is a claim
-- about reality that the data cannot settle:
--   * MP114 and MP119 hold each other's plates (4205/4206 SXA), and so do TM400 and
--     TM402 (7326/7332 HRA) - a transposition, but on which side is unknowable here
--     and guessing swaps two real vehicles' identities;
--   * nine mixers read AXA on file and JXA in the sheet (TM579/585/588/591/594/595/
--     597/602/604), plus TM412 HRA vs NRA - a systematic letter-group difference
--     that looks like one bulk entry error;
--   * MP049 (4691 KRB vs 3786 AXA) and MT001 (8271 VTA vs 8231 BKB) are entirely
--     different plates;
--   * SL017 is "KAA 4746" against "4746 KAA" - the same characters reversed, which
--     is probably a flipped entry but is a judgement rather than a whitespace fix,
--     so it stays in the list.
--
-- ROLLBACK: update from _bak.vehicle_fleet_plate_v509 (holds id + old_plate).

create schema if not exists _bak;

create table if not exists _bak.vehicle_fleet_plate_v509 as
select v.id, v.asset_no, v.registration_no as old_plate, now() as snapped_at
from public.vehicle_fleet v
join public.ksa_asset_master_upload u on u.asset_no = upper(btrim(v.asset_no))
where v.country='KSA'
  and coalesce(btrim(v.registration_no),'') <> '' and u.plate_no is not null
  and upper(btrim(v.registration_no)) <> upper(btrim(u.plate_no))
  and replace(upper(v.registration_no), ' ', '') = replace(upper(u.plate_no), ' ', '');

update public.vehicle_fleet v
set registration_no = u.plate_no
from public.ksa_asset_master_upload u
where v.country='KSA'
  and u.asset_no = upper(btrim(v.asset_no))
  and coalesce(btrim(v.registration_no),'') <> '' and u.plate_no is not null
  and upper(btrim(v.registration_no)) <> upper(btrim(u.plate_no))
  and replace(upper(v.registration_no), ' ', '') = replace(upper(u.plate_no), ' ', '');
