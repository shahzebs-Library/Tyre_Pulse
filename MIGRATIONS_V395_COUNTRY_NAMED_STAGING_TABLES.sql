-- V395: a staging table per country, so the country can never be forgotten.
--
-- APPLIED LIVE 2026-07-28 as v395_country_named_staging_tables.
--
-- THE PROBLEM. The expense pipes were already named per country
-- (expenses_ksa / expenses_uae / expenses_egypt) and that is the pattern that
-- works: you pick the table and the country is decided. Every other staging
-- table was shared, with a `country` COLUMN the uploader had to remember to add
-- to the CSV and fill correctly on every row. Forget it and the rows land with
-- no country, which is how data becomes invisible to a country-scoped user.
--
-- So the expense pattern is extended to the rest. `stg_job_cards_ksa` has the
-- same columns as `stg_job_cards` minus `country`: import the export exactly as
-- the ERP produced it, into the table named for the country, and nothing else
-- has to be right.
--
-- 21 tables generated: 7 staging tables x KSA / UAE / Egypt.
--   stg_job_cards, stg_monthly_tyres, stg_assets, stg_complaints,
--   stg_open_wo, stg_wo_lines, stg_tyre_brand
--
-- HOW IT WORKS. Each country table is a pure pipe, exactly like the base
-- staging tables: the trigger stamps the country, inserts into the shared
-- staging table (which fires that table's existing processing trigger), and
-- returns NULL so the country table stays empty. There is NO second copy of any
-- processing logic - the shared tables and their triggers are untouched, and
-- everything still runs in one place. The base tables also still work exactly
-- as before for anything already pointed at them.
--
-- VERIFIED LIVE (each rolled back):
--   stg_job_cards_uae   -> work_orders country UAE, Break Down mapped to
--                          Emergency, both staging tables left at 0 rows
--   stg_job_cards_egypt -> country Egypt, Schedule mapped to Preventive
--                          Maintenance
--   stg_monthly_tyres_ksa -> tyre_records country KSA
--   so the country argument is per table and not cross-wired.
--
-- REGENERATING. If a base staging table gains a column, re-run the DO block
-- below; it drops and recreates the country tables from the current shape. They
-- hold no data of their own, so recreating them loses nothing.
--
-- NOT DONE: production_logs has no staging table at all (m3 is entered on the
-- Cost Intelligence page or loaded via /erp-import), so it has no country
-- sibling here. Adding one is a separate piece of work, not a rename.
-- (function + generator body below, as applied)
create or replace function public._stg_country_pipe()
returns trigger language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_country text := TG_ARGV[0];
  v_target  text := TG_ARGV[1];
  v_row     jsonb;
begin
  -- Drop the identity/timestamp of the country table and let the base table
  -- generate its own, then set the country this table exists to represent.
  v_row := (to_jsonb(NEW) - 'id' - 'created_at') || jsonb_build_object('country', v_country);
  execute format(
    'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)',
    v_target, v_target) using v_row;
  return null;   -- pure pipe: the country table never keeps a row
end $fn$;

comment on function public._stg_country_pipe() is
  'Stamps the country a staging table is named for and forwards the row to the shared staging table, whose own trigger does the real work. Returns NULL so the country table stays empty.';

-- generate one table per (staging table, country)
do $gen$
declare
  v_base    text;
  v_country text;
  v_suffix  text;
  v_tbl     text;
  v_bases   text[] := array[
    'stg_job_cards', 'stg_monthly_tyres', 'stg_assets',
    'stg_complaints', 'stg_open_wo', 'stg_wo_lines', 'stg_tyre_brand'];
  v_pairs   text[][] := array[['KSA','ksa'], ['UAE','uae'], ['Egypt','egypt']];
  i int;
begin
  foreach v_base in array v_bases loop
    if to_regclass('public.' || v_base) is null then
      raise notice 'skipping %, it does not exist', v_base;
      continue;
    end if;

    for i in 1 .. array_length(v_pairs, 1) loop
      v_country := v_pairs[i][1];
      v_suffix  := v_pairs[i][2];
      v_tbl     := v_base || '_' || v_suffix;

      execute format('drop table if exists public.%I cascade', v_tbl);
      execute format(
        'create table public.%I (like public.%I including defaults)', v_tbl, v_base);
      -- the whole point: no country column to fill in
      execute format('alter table public.%I drop column if exists country', v_tbl);

      execute format(
        'create trigger trg_pipe before insert on public.%I
           for each row execute function public._stg_country_pipe(%L, %L)',
        v_tbl, v_country, v_base);

      -- Same boundary as every other staging table: org isolation plus an
      -- elevated-user write. A staging table is a loading dock, not a store.
      execute format('alter table public.%I enable row level security', v_tbl);
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated
           using (true) with check (true)',
        v_tbl || '_org', v_tbl);
      execute format(
        'create policy %I on public.%I for insert to authenticated
           with check (public.app_is_elevated())',
        v_tbl || '_write', v_tbl);
      execute format(
        'create policy %I on public.%I for select to authenticated
           using (public.app_is_elevated())',
        v_tbl || '_read', v_tbl);

      execute format('revoke all on public.%I from anon', v_tbl);
      execute format('grant select, insert on public.%I to authenticated', v_tbl);

      execute format(
        'comment on table public.%I is %L', v_tbl,
        format('Upload %s files for %s here. Same columns as %s but with no country column - the country is this table. Rows do not stay: they are forwarded to %s and processed immediately.',
               v_base, v_country, v_base, v_base));
    end loop;
  end loop;
end $gen$;
