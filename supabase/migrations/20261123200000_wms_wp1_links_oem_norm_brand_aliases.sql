-- WMS WP1 + two small data fixes. Owner approved 2026-11-23 (all three items).
--
-- 1. Link Material Master (material_canonical, company SKU) to the ERP item master
--    (material_master) for KSA, by exact item code. 3,508 one-to-one matches, no
--    item or SKU matches twice, same organisation. UAE shares 726 of the codes but a
--    code means a different item per country, so UAE is NOT linked.
--    Undo: delete from public.material_canonical_items where note like 'WP1 exact item-code match%';
-- 2. oem_part_references.oem_part_no_normalized was never filled by inv_compat_propose,
--    so the live unique index could not stop duplicate links. A trigger now fills it
--    with the same rule oem_parts_entries uses (uppercase, letters and digits only).
--    Undo: drop trigger trg_oem_ref_normalize on public.oem_part_references; drop function public._oem_ref_normalize();
-- 3. Brand spellings carried in the tyre brand list: Westlike -> Westlake, Ericle -> Eracle.
--    Undo: delete from public.brand_aliases where alias in ('westlike','ericle');

insert into public.material_canonical_items (organisation_id, country, canonical_id, item_id, linked_by, note)
select c.organisation_id, mm.country, c.id, mm.id,
       'd2d43a5f-0906-4f7a-9577-e36d89164914'::uuid,
       'WP1 exact item-code match (KSA), owner-approved 2026-11-23'
from public.material_canonical c
join public.material_master mm
  on upper(btrim(mm.item_code)) = upper(btrim(c.company_sku))
 and mm.organisation_id = c.organisation_id
 and mm.country = 'KSA'
where c.status = 'active'
on conflict (item_id) do nothing;

create or replace function public._oem_ref_normalize() returns trigger
language plpgsql set search_path = public, pg_temp as $fn$
begin
  new.oem_part_no_normalized := nullif(upper(regexp_replace(coalesce(new.oem_part_no, ''), '[^A-Za-z0-9]', '', 'g')), '');
  return new;
end $fn$;
revoke execute on function public._oem_ref_normalize() from public, anon, authenticated;

create trigger trg_oem_ref_normalize before insert or update of oem_part_no on public.oem_part_references
  for each row execute function public._oem_ref_normalize();

insert into public.brand_aliases (alias, canonical) values ('westlike', 'Westlake'), ('ericle', 'Eracle')
on conflict (alias) do nothing;
