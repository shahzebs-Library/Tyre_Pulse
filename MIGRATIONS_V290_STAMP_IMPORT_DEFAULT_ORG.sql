-- V290: Make Supabase dashboard CSV imports visible in the app.
--
-- The Supabase Table Editor "Import data from CSV" flow runs as an admin role
-- with no profile row, so the column default `app_current_org()` resolves to
-- NULL and the imported rows are hidden by the org-isolation RLS ("uploaded but
-- nothing shows"). This BEFORE INSERT trigger fills the single tenant org
-- (Company A) ONLY when organisation_id arrives NULL, so authenticated inserts
-- (which already carry app_current_org()) are completely untouched.
--
-- Single-org deployment assumption: every row and user currently lives in
-- Company A (00000000-0000-0000-0000-000000000001). If a second tenant is ever
-- added, replace the constant with a per-context resolver before their staff use
-- the dashboard importer.
--
-- Applied live via Supabase MCP (project jhssdmeruxtrlqnwfksc). Next free V291.

create or replace function public.stamp_import_default_org()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organisation_id is null then
    new.organisation_id := '00000000-0000-0000-0000-000000000001'::uuid;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'vehicle_fleet','tyre_records','stock_records','accidents','inspections',
    'work_orders','warranty_claims','gate_passes','suppliers','drivers'
  ]
  loop
    execute format('drop trigger if exists trg_stamp_import_default_org on public.%I', t);
    execute format(
      'create trigger trg_stamp_import_default_org before insert on public.%I
         for each row execute function public.stamp_import_default_org()', t);
  end loop;
end $$;

-- Rollback:
--   do $$ declare t text; begin
--     foreach t in array array['vehicle_fleet','tyre_records','stock_records',
--       'accidents','inspections','work_orders','warranty_claims','gate_passes',
--       'suppliers','drivers']
--     loop execute format('drop trigger if exists trg_stamp_import_default_org on public.%I', t); end loop;
--   end $$;
--   drop function if exists public.stamp_import_default_org();
