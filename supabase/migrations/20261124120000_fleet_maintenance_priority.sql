-- =============================================================================
-- Fleet maintenance priority (owner's criticality matrix, P1 to P6)
-- STATUS: APPLIED LIVE 2026-11-24 on the owner's explicit yes, in order 090000, 091000, 130000, 131000,
--   132000, 133000, 120000, 135000 (135000 indexes built CONCURRENTLY first). Verified live: data unchanged,
--   Store Keeper bare receipt and count refused (42501). Recorded in supabase_migrations.
-- Original status: NOT APPLIED. Written for review only. Do not apply without the
--         owner's explicit OK.
-- =============================================================================
--
-- What it does
--   1. vehicle_fleet gains:
--        maintenance_priority     smallint, 1..6 (check)
--        priority_override_reason text      (set = a person chose the priority)
--        priority_overridden_by   uuid      (who set the override)
--        priority_overridden_at   timestamptz
--   2. public.fleet_priority_for(vehicle_type, asset_no) -> smallint, IMMUTABLE.
--      MIRRORS src/lib/assetPriority.js priorityFor() derivation EXACTLY.
--      Change both together.
--        type first (normalized: upper, separators collapsed), then the asset
--        code prefix (leading letters) when the type is blank, else 6.
--   3. BEFORE INSERT OR UPDATE trigger trg_zz_fleet_maintenance_priority sets
--      maintenance_priority from the function unless priority_override_reason
--      is set (non-blank). The zz_ prefix is load-bearing: triggers fire in name
--      order, and this one must run AFTER trg_normalize_vehicle_type /
--      the asset_no normaliser so it reads the canonical values.
--   4. Backfill every row that has no override.
--   5. Index (organisation_id, maintenance_priority).
--
-- Client: the web register works with OR without these columns. Until this is
-- applied the server filter (buildPriorityFilter) derives the priority from
-- vehicle_type + asset_no; once the column exists the filter also ORs on the
-- stored maintenance_priority, so a manual override is found by the filter too.
--
-- Review fix (2026-11-24): the asset-prefix extraction used pg_catalog.substring(x FROM y), which does not parse
-- (the FROM form cannot be schema-qualified); it is now pg_catalog.substring(x, y), the same POSIX-regex match.
-- Review A25 (2026-11-24): setting, changing or removing an override needs
-- stock:engineering_approve, an Admin / Manager role or the super admin (checked in
-- the trigger, 42501). Backend writers (no auth.uid()) are not blocked.
--
-- Cost note: the backfill UPDATE touches ~1,6xx vehicle_fleet rows and fires
-- that table's existing triggers (audit, sync) once per row.
--
-- REVIEW FIXES + ROLLED-BACK PROOF, ROUND 2 (2026-11-24). All 8 files applied in order (090000, 091000, 130000,
-- 131000, 132000, 133000, 120000, 135000; the 135000 work_orders index build left out of the run because of its
-- SHARE lock) in ONE implicit transaction through the Supabase CLI, then a test block as real users (claims + role
-- authenticated) ending in RAISE EXCEPTION, so everything rolled back; re-checked afterwards: purchase_orders 0,
-- test suppliers 0, test grants 0, procurement_rfqs and _inv_job_card_resolve absent, purchase_orders.updated_by
-- absent. Users: super admin d2d43a5f (SA), Store Keeper 69faeb71 (SK), Managers 34793423 (M1) / ecdcdb9e (M2);
-- extra stock / fleet grants were given INSIDE the transaction. Script: scratchpad review_round2_proof.sql.
--   A25.0 SA sets an override -> 1 row, P2;  A25.1 SK (fleet_master edit granted, no engineering_approve) changes it
--   -> 42501;  A25.2 M1 Manager (fleet_master edit granted) -> 1 row, P1. The file did not parse before this round
--   (pg_catalog.substring ... FROM ...); it now compiles and the backfill ran inside the rolled-back run.
-- PARITY CHECK (run after apply; expect 0 rows):
--   select f.id, f.vehicle_type, f.asset_no, f.maintenance_priority,
--          public.fleet_priority_for(f.vehicle_type, f.asset_no) as derived
--   from public.vehicle_fleet f
--   where f.priority_override_reason is null
--     and f.maintenance_priority is distinct from public.fleet_priority_for(f.vehicle_type, f.asset_no);
--
-- Distribution check:
--   select maintenance_priority, count(*) from public.vehicle_fleet group by 1 order by 1;
--
-- ROLLBACK:
--   drop trigger if exists trg_zz_fleet_maintenance_priority on public.vehicle_fleet;
--   drop function if exists public.fleet_maintenance_priority_tg();
--   drop function if exists public.fleet_priority_for(text, text);
--   drop index if exists public.vehicle_fleet_org_priority_idx;
--   alter table public.vehicle_fleet
--     drop column if exists priority_overridden_at,
--     drop column if exists priority_overridden_by,
--     drop column if exists priority_override_reason,
--     drop column if exists maintenance_priority;
-- =============================================================================

begin;

alter table public.vehicle_fleet
  add column if not exists maintenance_priority smallint,
  add column if not exists priority_override_reason text,
  add column if not exists priority_overridden_by uuid,
  add column if not exists priority_overridden_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'vehicle_fleet_maintenance_priority_chk'
      and conrelid = 'public.vehicle_fleet'::regclass
  ) then
    alter table public.vehicle_fleet
      add constraint vehicle_fleet_maintenance_priority_chk
      check (maintenance_priority is null or maintenance_priority between 1 and 6);
  end if;
end $$;

comment on column public.vehicle_fleet.maintenance_priority is
  'Maintenance priority P1..P6 (owner criticality matrix). Derived by fleet_priority_for() unless priority_override_reason is set.';
comment on column public.vehicle_fleet.priority_override_reason is
  'When non-blank, maintenance_priority was chosen by a person and the trigger leaves it alone.';

-- Mirror of src/lib/assetPriority.js. Keep both lists identical.
create or replace function public.fleet_priority_for(p_vehicle_type text, p_asset_no text)
returns smallint
language sql
immutable
parallel safe
set search_path = ''
as $$
  with n as (
    select
      pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.upper(coalesce(p_vehicle_type, '')), '[[:space:]_-]+', ' ', 'g')) as ty,
      coalesce(pg_catalog.substring(pg_catalog.upper(pg_catalog.btrim(coalesce(p_asset_no, ''), E' \t\r\n')), '^[A-Z]+'), '') as pre
  )
  select (case
    -- 1. vehicle type
    when ty = 'WHEEL LOADER' then 1
    when ty in ('BT PLANT', 'BATCHING PLANT', 'ICE PLANT', 'CHILLER', 'RECLAIMER') then 2
    when ty in ('PUMPS', 'SPIDER PUMP', 'PLACING BOOM', 'STATIONARY PUMP', 'LINE PUMP', 'CONCRETE PUMP') then 3
    when ty = 'GENERATOR' then 4
    when ty in ('TR MIXER', 'TRANSIT MIXER') then 5
    when ty <> '' then 6
    -- 2. blank type: asset code prefix
    when pre = 'WL' then 1
    when pre in ('BP', 'IP', 'REC') then 2
    when pre in ('MP', 'SP', 'LP', 'PB', 'HD') then 3
    when pre = 'GN' then 4
    when pre in ('TM', 'DT') then 5
    -- 3. default
    else 6
  end)::smallint
  from n
$$;

revoke all on function public.fleet_priority_for(text, text) from public, anon;
grant execute on function public.fleet_priority_for(text, text) to authenticated, service_role;

create or replace function public.fleet_maintenance_priority_tg()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- (review A25) setting, changing or removing a manual override is an engineering decision: it needs
  -- stock:engineering_approve, or an Admin / Manager role, or the super admin. Backend writers (no auth.uid(),
  -- e.g. this migration's backfill or an import) are not blocked.
  if auth.uid() is not null
     and (case when tg_op = 'INSERT'
               then nullif(pg_catalog.btrim(coalesce(new.priority_override_reason, '')), '') is not null
               else (nullif(pg_catalog.btrim(coalesce(new.priority_override_reason, '')), '')
                       is distinct from nullif(pg_catalog.btrim(coalesce(old.priority_override_reason, '')), ''))
                    or (nullif(pg_catalog.btrim(coalesce(new.priority_override_reason, '')), '') is not null
                        and new.maintenance_priority is distinct from old.maintenance_priority)
          end)
     and not (coalesce(public.is_super_admin(), false)
              or pg_catalog.lower(coalesce(public.get_my_role(), '')) in ('admin', 'manager')
              or coalesce(public.inv_can('engineering_approve'), false)) then
    raise exception 'Overriding a maintenance priority needs engineering approval rights or an Admin or Manager role.'
      using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(coalesce(new.priority_override_reason, '')), '') is null then
    new.priority_override_reason := null;
    new.priority_overridden_by := null;
    new.priority_overridden_at := null;
    new.maintenance_priority := public.fleet_priority_for(new.vehicle_type, new.asset_no);
  else
    -- Manual override: keep the chosen priority (fall back to the derived one
    -- when none was given) and stamp who and when on any change.
    if new.maintenance_priority is null then
      new.maintenance_priority := public.fleet_priority_for(new.vehicle_type, new.asset_no);
    end if;
    if tg_op = 'INSERT'
       or new.priority_override_reason is distinct from old.priority_override_reason
       or new.maintenance_priority is distinct from old.maintenance_priority then
      new.priority_overridden_by := coalesce(auth.uid(), new.priority_overridden_by);
      new.priority_overridden_at := now();
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.fleet_maintenance_priority_tg() from public, anon, authenticated;

drop trigger if exists trg_zz_fleet_maintenance_priority on public.vehicle_fleet;
create trigger trg_zz_fleet_maintenance_priority
  before insert or update on public.vehicle_fleet
  for each row execute function public.fleet_maintenance_priority_tg();

-- Backfill (rows without an override). Only rows whose value would change.
update public.vehicle_fleet f
   set maintenance_priority = public.fleet_priority_for(f.vehicle_type, f.asset_no)
 where f.priority_override_reason is null
   and f.maintenance_priority is distinct from public.fleet_priority_for(f.vehicle_type, f.asset_no);

create index if not exists vehicle_fleet_org_priority_idx
  on public.vehicle_fleet (organisation_id, maintenance_priority);

commit;
