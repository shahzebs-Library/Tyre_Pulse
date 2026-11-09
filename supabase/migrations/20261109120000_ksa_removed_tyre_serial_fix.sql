-- =====================================================================
-- 20261109120000  KSA removed-tyre serial fix + placeholder serials are weak
-- STATUS: APPLIED LIVE 2026-11-09 (owner chose "fix serials and prices").
-- =====================================================================
-- Problem: the ksa_tyre_load_v432 import read the ERP tyre-change row's
-- mislabelled "remove_date / remove_KM" columns (which hold the OLD tyre's
-- fitment) as a fitment of the NEW serial. Each change therefore produced two
-- rows with the NEW serial on the same wheel: one for the old tyre's life
-- (fitted earlier, removed on the change day, carrying the job card + price)
-- and one for the new tyre (fitted on the change day at the same km, no price).
-- Consumption reported these as 1,573 "same-vehicle refits".
-- Proven on job card GCKR/JC/1806/0326 (TM621 LHRO 31-03-26): srno YMT87479 on,
-- old_serialno YMT55578 off.
--
-- Fix (1,599 pairs; 6 ambiguous/chained pairs left untouched):
--   old row: serial := ERP old_serialno when the file names exactly one (18),
--            else NULL (1,581, "serial not recorded"); price cleared; previous
--            serial kept in extra_fields.serial_fix_20261109.
--   new row: takes the purchase price (1,555 rows, SAR 1,820,562.12, total
--            unchanged) and the job card when it had none.
-- km_at_fitment / km_at_removal verified unchanged on every row.
-- Pair detection: same org/country/serial/asset/position, old.removal_date =
-- new.issue_date AND old.km_at_removal = new.km_at_fitment.
--
-- Also: tyre_serial_is_strong() now requires a digit, so placeholder text
-- ("NO SERIAL", "NOT CLEAR", "#NAME?", "NEW TYRE") is never one physical tyre.
-- JS mirror: src/lib/tyreLifetime.js isStrongSerial - change both.
--
-- Backup + undo:
--   _bak.ksa_old_tyre_fix_20261109 (old_row, new_row, before values)
--   update tyre_records e set serial_no=b.old_serial_before, cost_per_tyre=b.old_cost_before,
--     extra_fields=b.old_extra_before from _bak.ksa_old_tyre_fix_20261109 b where e.id=b.old_row;
--   update tyre_records f set cost_per_tyre=b.new_cost_before, job_card=b.new_jc_before
--     from _bak.ksa_old_tyre_fix_20261109 b where f.id=b.new_row;
-- =====================================================================

CREATE OR REPLACE FUNCTION public.tyre_serial_is_strong(p_serial text)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  select coalesce(
    length(btrim(p_serial)) >= 6
    and upper(btrim(p_serial)) ~ '[0-9]'
    and upper(btrim(p_serial)) !~ '^(DOT|NULL|N/?A|-)'
    and upper(btrim(p_serial)) !~ '^[0-9]{3}/'
    and upper(btrim(p_serial)) !~ '[0-9]{2,3}/[0-9]{2}\s*R'
    and upper(btrim(p_serial)) !~ 'E\+[0-9]+$', false)
$function$;

-- The data repair itself was executed once against the live database (see the
-- header). It is not replayed here because its pair detection depends on the
-- pre-fix state of tyre_records.
