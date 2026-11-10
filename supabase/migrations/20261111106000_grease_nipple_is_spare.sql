-- 20261111106000_grease_nipple_is_spare
-- Found checking the 2026-11-10 KSA expense upload. Two KSA item codes were bulk-confirmed
-- (29-30 Jul) as lubricant: 220064-O GREASE NIPPLE 10MM STRAIGHT and 211014-O GREASE NIPPLE 13MM.
-- A grease nipple is a fitting; all other 285 nipple codes in the master are spare_part.
-- 54 lines / SAR 1,144.99 move oil -> spare; country totals unchanged.
-- Re-classification is done by touching each line: classify_parts_consumption is BEFORE
-- INSERT OR UPDATE and re-derives the bucket from the (now corrected) reviewed master.
-- Snapshot: _bak.grease_nipple_20261111 (master rows + line buckets). Undo: restore both.
create table if not exists _bak.grease_nipple_20261111 as
  select 'line'::text kind, p.id, p.tyre_cost, p.spare_cost, p.oil_cost, null::text category
    from public.parts_consumption p
   where p.country = 'KSA' and p.item_code in ('220064-O','211014-O')
  union all
  select 'master', m.id, null, null, null, m.category
    from public.material_master m
   where m.country = 'KSA' and m.item_code in ('220064-O','211014-O');
update public.material_master set category = 'spare_part'
 where country = 'KSA' and item_code in ('220064-O','211014-O') and category = 'lubricant';
update public.parts_consumption set item_code = item_code
 where country = 'KSA' and item_code in ('220064-O','211014-O');
