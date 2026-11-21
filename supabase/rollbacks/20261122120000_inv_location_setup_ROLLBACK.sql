-- ROLLBACK for 20261122120000_inv_location_setup.sql (pending, not applied).
-- Removes the bulk writer only. Locations already created with it stay; they
-- are ordinary inventory_locations rows (deactivate them through the screen).
begin;
drop function if exists public.inv_location_bulk_create(jsonb);
commit;
