-- =============================================================================
-- V491 - Operational status on the fleet register + a breakdown register
-- STATUS: APPLIED LIVE on project jhssdmeruxtrlqnwfksc (2026-08-13), verified.
--
-- WHY
-- The owner's monthly asset sheet has always carried three tabs: a master asset
-- list, a breakdown list, and a planned-scrap list. Only the master list ever
-- reached the system. So the register could say a machine existed, but not
-- whether it was running, broken down, standing idle, on its way to another
-- site, or already earmarked for scrap - and nothing at all about WHAT was
-- wrong with a machine that was down, or how long it had been down.
--
-- THE DISTINCTION THAT MAKES THIS WORTH A COLUMN
-- `vehicle_fleet.status` answers "is this machine part of the current fleet"
-- (Active / Inactive / Retired / Transferred - see V508). `ops_status` answers
-- "what is it doing today". They are genuinely different: a machine can be
-- Active and broken down, or Active and already proposed for scrap. Collapsing
-- them would hide whichever question you were actually asking, so the sheet's
-- operational word gets its own column and the register's own status is left
-- exactly as it was.
--
-- WHAT WAS NEARLY BUILT AND WAS NOT
-- A disposal table. `asset_disposals` and the /asset-disposals page ALREADY
-- EXIST (37 rows). The planned-scrap tab is loaded into that table as an
-- enrichment of the rows already there, never as a second register.
--
-- ROLLBACK
--   drop table if exists public.asset_breakdowns;
--   alter table public.vehicle_fleet
--     drop column if exists ops_status, drop column if exists ops_status_note,
--     drop column if exists ops_status_at, drop column if exists capacity,
--     drop column if exists engine_no;
-- =============================================================================

alter table public.vehicle_fleet
  add column if not exists ops_status      text,
  add column if not exists ops_status_note text,
  add column if not exists ops_status_at   timestamptz,
  -- Two facts the register has never carried and the sheet always has: what the
  -- machine's rated output is (13CBM, 62 MTR, 550 kw, 240 m3/hr) and its engine
  -- number, which is the only identity a generator or a chiller has.
  add column if not exists capacity        text,
  add column if not exists engine_no       text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicle_fleet_ops_status_check') then
    alter table public.vehicle_fleet
      add constraint vehicle_fleet_ops_status_check
      check (ops_status is null or ops_status in
        ('running','breakdown','idle','planned_scrap','reallocation','yard','other'));
  end if;
end $$;

create index if not exists vehicle_fleet_ops_status_idx
  on public.vehicle_fleet (organisation_id, country, ops_status)
  where ops_status is not null;

-- -----------------------------------------------------------------------------
-- The breakdown register.
--
-- A breakdown is OPEN until somebody records that the machine came back.
-- Nothing closes it automatically - in particular the expected return date
-- passing does NOT close it, because a promise that slipped is precisely the
-- case this register exists to surface.
-- -----------------------------------------------------------------------------
create table if not exists public.asset_breakdowns (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null default public.app_current_org(),
  country             text,
  asset_no            text not null,
  site                text,
  reported_on         date not null default current_date,
  details             text,
  breakdown_days      integer,
  expected_return     date,
  returned_to_service boolean not null default false,
  returned_on         date,
  -- The sheet's own two tokens. Kept verbatim so a re-upload matches, and
  -- rendered as words ("In-house workshop" / "Outside workshop") in the UI.
  repair_location     text check (repair_location is null or repair_location in ('In','Out')),
  remark              text,
  source_file         text,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One OPEN breakdown per machine. A machine that is down cannot be down twice,
-- and pressing the button again must not create a second row - but a CLOSED
-- breakdown is deliberately not covered, because the same machine genuinely can
-- break down again, and a plain unique constraint would silently suppress the
-- recurrence, which is the more dangerous failure.
create unique index if not exists asset_breakdowns_open_uidx
  on public.asset_breakdowns (organisation_id, coalesce(country,''), asset_no)
  where returned_to_service = false;

create index if not exists asset_breakdowns_lookup_idx
  on public.asset_breakdowns (organisation_id, country, reported_on desc);

alter table public.asset_breakdowns enable row level security;

drop policy if exists asset_breakdowns_org_isolation on public.asset_breakdowns;
create policy asset_breakdowns_org_isolation on public.asset_breakdowns
  as restrictive for all to authenticated
  using  (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));

drop policy if exists asset_breakdowns_country_isolation on public.asset_breakdowns;
create policy asset_breakdowns_country_isolation on public.asset_breakdowns
  as restrictive for select to authenticated
  using (public.app_can_see_country(country));

drop policy if exists asset_breakdowns_read on public.asset_breakdowns;
create policy asset_breakdowns_read on public.asset_breakdowns
  for select to authenticated using (public.app_is_active());

drop policy if exists asset_breakdowns_write on public.asset_breakdowns;
create policy asset_breakdowns_write on public.asset_breakdowns
  for all to authenticated
  using  (public.app_is_elevated())
  with check (public.app_is_elevated());

-- Site spellings canonicalise the same way as everywhere else. The trigger is
-- named trg_zz_ so it sorts LAST: V524 recorded that triggers fire in NAME
-- order, and a normaliser that runs before another trigger writes the column is
-- a normaliser that does nothing.
drop trigger if exists trg_zz_normalize_site on public.asset_breakdowns;
create trigger trg_zz_normalize_site
  before insert or update on public.asset_breakdowns
  for each row execute function public.normalize_site();
