-- =============================================================================
-- ROLLBACK for 20261122100000_inv_physical_inventory_master.sql   (DRAFT, NOT APPLIED)
--
-- Refuses while physical-inventory evidence, company materials, variants, ERP links,
-- corrections or transfer requests exist, unless the operator has exported them and
-- sets:  set local inv.rollback_discard = 'on';
-- Opening-balance batches created from a session are NOT touched (they belong to the
-- governed opening-balance workflow and may already be posted to the ledger).
-- material_aliases rows that hang on a material / variant are removed only on discard;
-- rows on a country ERP item (the pre-existing shape) are always kept.
-- =============================================================================
begin;

do $$ begin
  if coalesce(current_setting('inv.rollback_discard', true), '') <> 'on' and (
       exists (select 1 from public.physical_inventory_captures) or exists (select 1 from public.physical_inventory_sessions)
    or exists (select 1 from public.material_canonical) or exists (select 1 from public.material_correction_requests)
    or exists (select 1 from public.inventory_transfer_requests)) then
    raise exception 'Physical inventory records exist. Export them, then set inv.rollback_discard = on to roll back.';
  end if;
end $$;

drop view if exists public.v_inv_pi_captures;

do $$ declare f text; begin
  foreach f in array array['inv_material_canonical_propose','inv_material_canonical_decide','inv_material_variant_propose',
    'inv_material_variant_decide','inv_material_link_item','inv_pi_session_start','inv_pi_session_close','inv_pi_capture',
    'inv_pi_photo_attach','inv_pi_capture_map','inv_correction_request','inv_correction_decide','inv_material_search',
    'inv_transfer_request','inv_transfer_request_decide','inv_pi_to_opening_batch','inv_pi_dashboard'] loop
    execute format('drop function if exists public.%I(jsonb)', f);
  end loop;
end $$;

drop table if exists public.material_correction_events;
drop table if exists public.material_correction_requests;
drop table if exists public.inventory_transfer_requests;
drop table if exists public.physical_inventory_photos;
drop table if exists public.physical_inventory_captures;
drop table if exists public.physical_inventory_sessions;

delete from public.material_aliases where item_id is null;
drop index if exists public.material_aliases_identity_uq;
drop index if exists public.material_aliases_canonical_idx;
drop index if exists public.material_aliases_variant_idx;
alter table public.material_aliases drop constraint if exists material_aliases_target_chk;
alter table public.material_aliases drop constraint if exists material_aliases_ref_status_chk;
alter table public.material_aliases drop column if exists canonical_id, drop column if exists variant_id,
  drop column if exists manufacturer, drop column if exists brand, drop column if exists ref_status,
  drop column if exists verified, drop column if exists evidence;
alter table public.material_aliases drop constraint if exists material_aliases_alias_type_check;
do $$ begin
  if exists (select 1 from public.material_aliases where alias_type not in ('oem','alternative','superseded','barcode','erp_legacy')) then
    alter table public.material_aliases add constraint material_aliases_alias_type_check
      check (alias_type in ('oem','alternative','superseded','barcode','erp_legacy')) not valid;
    raise notice 'material_aliases_alias_type_check restored NOT VALID: rows with the new reference types remain.';
  else
    alter table public.material_aliases add constraint material_aliases_alias_type_check
      check (alias_type in ('oem','alternative','superseded','barcode','erp_legacy'));
  end if;
end $$;
alter table public.material_aliases alter column item_id set not null;

drop table if exists public.material_canonical_items;
drop table if exists public.material_variants;
drop table if exists public.material_canonical;

drop function if exists public._inv_pi_dup_candidates(uuid, jsonb, text, uuid);
drop function if exists public._inv_pi_country_item(uuid, text, uuid, uuid);
drop function if exists public._inv_pi_country_item_candidates(uuid, text, uuid, uuid);
drop function if exists public._inv_pi_target_snapshot(text, uuid);
drop function if exists public._inv_pi_evidence_guard();
drop function if exists public._inv_pi_append_only();
drop function if exists public._inv_pi_can_capture();
drop function if exists public._inv_pi_can_master();
drop function if exists public.material_ref_norm(text);

commit;
