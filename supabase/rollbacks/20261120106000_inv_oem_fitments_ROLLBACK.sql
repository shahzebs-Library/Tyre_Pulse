-- ROLLBACK of 20261120106000_inv_oem_fitments.sql (run after the 107000 rollback).
-- Refuses to discard compatibility records unless `set local inv.rollback_discard = 'on'`
-- is set in the same transaction (export them first).
begin;
do $$ begin
  if coalesce(current_setting('inv.rollback_discard', true), '') <> 'on'
     and (exists (select 1 from public.oem_part_references) or exists (select 1 from public.equipment_fitments)) then
    raise exception 'Compatibility records exist; export them, then set inv.rollback_discard = on to roll back.';
  end if;
end $$;
drop view if exists public.v_validated_compatibility;
drop function if exists public.inv_compat_decide(text, uuid, text, text);
drop function if exists public.inv_compat_propose(jsonb);
drop table if exists public.equipment_fitments;
drop table if exists public.oem_part_references;
commit;
