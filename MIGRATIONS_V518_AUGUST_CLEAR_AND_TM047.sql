-- V518 - clear August 2026 KSA expenses for re-upload, and pad TM47 to TM047
-- STATUS: APPLIED LIVE 2026-08-11 (data-only; recorded here for the trail)
--
-- 1. AUGUST 2026 KSA EXPENSE LINES REMOVED, at the owner's request, so a fresh
--    file can be uploaded with nothing to reconcile against.
--      1,034 lines / SAR 206,810.76 (tyre 104,817.12, spare 80,863.33, oil 21,130.31)
--      KSA ledger 40,981,402.97 -> 40,774,592.21 - exactly the amount removed.
--    Full rows in _bak.expense_aug2026_deleted. Undo:
--      insert into parts_consumption select * from _bak.expense_aug2026_deleted;
--    (the classify trigger re-derives the same buckets, so the restore is exact)
--
--    SCOPE IS DELIBERATELY NARROW - EXPENSE LINES, KSA, AUGUST ONLY.
--    August also holds 1,317 KSA job cards, 320 tyre records and 8,452 production
--    rows, and 945 UAE expense lines. Those came from DIFFERENT files (the master
--    sheet, the production upload, the UAE grid), so deleting them would lose
--    data the promised re-upload does not replace. Every one of them was left.
--
--    NOTE: none of the 1,034 rows carried an import_uid (the '#' column was not
--    mapped on those loads), so re-uploading the same file WITHOUT mapping '#'
--    will duplicate again. Map it.
--
-- 2. TM47 -> TM047.
--    The KSA fleet numbers its assets on three digits: 1,019 of 1,030 do, and the
--    only other two-digit codes are the REC and WTP classes, which are their own
--    numbering, not padding errors. TM47 was the single odd one out - Inactive,
--    at JED, carrying ONE 2023 job card (GCKR/JC/0082/0323, "TWO TYRES NEED TO BE
--    CHANGED", KSP-T3) and nothing else. No TM047 existed, so there was no
--    collision and nothing to merge - the code was simply padded in place across
--    vehicle_fleet and work_orders.
--    Snapshot _bak.asset_tm47_rename (2 rows: table, row id, old code).
--
--    NO TRIGGER WAS ADDED to pad codes automatically: REC01 and WTP01 are
--    legitimately two digits, so a blanket pad would corrupt them.

-- 1.
create table _bak.expense_aug2026_deleted as
  select * from public.parts_consumption
   where country = 'KSA'
     and event_date >= date '2026-08-01' and event_date < date '2026-09-01';

delete from public.parts_consumption
 where country = 'KSA'
   and event_date >= date '2026-08-01' and event_date < date '2026-09-01';

-- 2.
create table _bak.asset_tm47_rename as
  select 'vehicle_fleet' src, id::text row_id, asset_no old_code
    from public.vehicle_fleet where asset_no = 'TM47' and country = 'KSA'
  union all
  select 'work_orders', id::text, asset_no
    from public.work_orders where asset_no = 'TM47' and country = 'KSA';

update public.vehicle_fleet set asset_no = 'TM047' where asset_no = 'TM47' and country = 'KSA';
update public.work_orders  set asset_no = 'TM047' where asset_no = 'TM47' and country = 'KSA';
