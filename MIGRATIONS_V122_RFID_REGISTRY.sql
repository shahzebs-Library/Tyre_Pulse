-- ============================================================
-- RFID REGISTRY - Advanced Tyre Tracking System
-- Built by Shahzeb Rahman © 2026
-- 
-- This migration adds comprehensive RFID tracking capabilities:
--   • RFID tag lifecycle management (assigned, attached, removed, lost)
--   • RFID read history with location/time tracking
--   • RFID zone/reader management
--   • Automatic alerts for anomalies
--   • Integration with tyre_records and vehicle_fleet
-- ============================================================

-- ── RFID TAGS MASTER TABLE ───────────────────────────────────
-- Stores all RFID tag information and their association with tyres/assets
create table if not exists public.rfid_tags (
    id              uuid    default uuid_generate_v4() primary key,
    tag_uid         text    unique not null,                     -- Raw RFID chip UID (hex/numeric)
    tag_epc         text    unique,                              -- EPC code if available
    tag_type        text    check (tag_type in ('UHF', 'HF', 'NFC', 'Barcode')),
    
    -- Association
    tyre_record_id  uuid    references public.tyre_records(id) on delete set null,
    asset_no        text    references public.vehicle_fleet(asset_no) on delete set null,
    
    -- Status lifecycle
    status          text    default 'available' 
                    check (status in ('available', 'assigned', 'attached', 'removed', 'lost', 'damaged')),
    status_reason   text,                                        -- Reason for status change
    
    -- Physical properties
    manufacturer    text,
    model           text,
    size            text,                                       -- Tag size specification
    read_range_m    numeric(4,1) default 10.0,                  -- Read range in meters
    
    -- Lifecycle tracking
    assigned_at     timestamptz,
    attached_at     timestamptz,
    removed_at      timestamptz,
    last_seen_at    timestamptz,
    
    -- Location history
    last_location   text,                                        -- Last known location/zone
    last_latitude   numeric(10, 8),
    last_longitude  numeric(11, 8),
    
    -- Metadata
    country         text,
    region          text,
    site            text,
    created_by      uuid    references public.profiles(id),
    created_at      timestamptz default now(),
    updated_at      timestamptz default now()
);

-- Indexes for performance
create index if not exists idx_rfid_tags_uid on public.rfid_tags(tag_uid);
create index if not exists idx_rfid_tags_status on public.rfid_tags(status);
create index if not exists idx_rfid_tags_tyre on public.rfid_tags(tyre_record_id);
create index if not exists idx_rfid_tags_asset on public.rfid_tags(asset_no);
create index if not exists idx_rfid_tags_last_seen on public.rfid_tags(last_seen_at desc);
create index if not exists idx_rfid_tags_site on public.rfid_tags(site);

-- ── RFID READ HISTORY ────────────────────────────────────────
-- Every time an RFID tag is scanned/read, record the event
create table if not exists public.rfid_read_events (
    id              uuid    default uuid_generate_v4() primary key,
    tag_id          uuid    references public.rfid_tags(id) on delete cascade,
    tag_uid         text    not null,                            -- Denormalized for fast queries
    reader_id       uuid    references public.rfid_readers(id) on delete set null,
    
    -- Read data
    rssi           smallint,                                   -- Signal strength
    read_count     integer default 1,                           -- Number of reads in burst
    antenna        smallint,                                    -- Which antenna detected
    
    -- Location context
    zone_name      text,                                       -- Zone name at location
    latitude       numeric(10, 8),
    longitude      numeric(11, 8),
    site           text,
    
    -- Timestamps
    read_at        timestamptz default now(),
    created_at     timestamptz default now()
);

create index if not exists idx_rfid_reads_tag on public.rfid_read_events(tag_id);
create index if not exists idx_rfid_reads_tag_uid on public.rfid_read_events(tag_uid);
create index if not exists idx_rfid_reads_reader on public.rfid_read_events(reader_id);
create index if not exists idx_rfid_reads_at on public.rfid_read_events(read_at desc);
create index if not exists idx_rfid_reads_zone on public.rfid_read_events(zone_name);

-- ── RFID READERS/ZOONES MANAGEMENT ────────────────────────────
create table if not exists public.rfid_readers (
    id              uuid    default uuid_generate_v4() primary key,
    reader_uid      text    unique not null,                     -- Hardware UID
    name            text    not null,
    location        text,                                       -- Physical location description
    
    -- Zone mapping
    zone_name       text,                                       -- Logical zone (e.g., "Site A - Tyre Bay")
    zone_type       text check (zone_type in ('entry', 'exit', 'storage', 'workshop', 'vehicle', 'yard')),
    
    -- Coordinates
    latitude        numeric(10, 8),
    longitude       numeric(11, 8),
    
    -- Reader properties
    reader_type     text check (reader_type in ('fixed', 'mobile', 'handheld')),
    status          text default 'active' check (status in ('active', 'inactive', 'maintenance', 'offline')),
    last_heartbeat  timestamptz,
    firmware_version text,
    
    -- Organization
    country         text,
    region          text,
    site            text,
    
    created_by      uuid    references public.profiles(id),
    created_at      timestamptz default now(),
    updated_at      timestamptz default now()
);

create index if not exists idx_rfid_readers_site on public.rfid_readers(site);
create index if not exists idx_rfid_readers_zone on public.rfid_readers(zone_name);
create index if not exists idx_rfid_readers_status on public.rfid_readers(status);
create index if not exists idx_rfid_readers_zone_site on public.rfid_readers(zone_name, site);

-- ── RFID ALERTS & NOTIFICATIONS ───────────────────────────────
create table if not exists public.rfid_alerts (
    id              uuid    default uuid_generate_v4() primary key,
    tag_id          uuid    references public.rfid_tags(id) on delete cascade,
    tag_uid         text    not null,
    
    alert_type      text not null check (
        alert_type in (
            'tag_not_seen',         -- Tag hasn't been seen for threshold
            'zone_violation',       -- Tag in wrong zone
            'duplicate_read',       -- Same tag read by multiple zones simultaneously
            'low_battery',          -- Tag battery low
            'tamper_detected',      -- Tamper evidence detected
            'unauthorized_move',    -- Unauthorized movement
            'lost_tag',             -- Tag marked as lost
            'reader_offline'        -- Reader offline
        )
    ),
    
    severity        text default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
    message         text not null,
    
    -- Context
    current_zone    text,
    expected_zone   text,
    reader_id       uuid references public.rfid_readers(id) on delete set null,
    
    -- Resolution
    resolved_at     timestamptz,
    resolved_by     uuid references public.profiles(id),
    resolution_notes text,
    
    -- Metadata
    country         text,
    region          text,
    site            text,
    created_at      timestamptz default now()
);

create index if not exists idx_rfid_alerts_tag on public.rfid_alerts(tag_id);
create index if not exists idx_rfid_alerts_type on public.rfid_alerts(alert_type);
create index if not exists idx_rfid_alerts_severity on public.rfid_alerts(severity);
create index if not exists idx_rfid_alerts_resolved on public.rfid_alerts(resolved_at);
create index if not exists idx_rfid_alerts_created on public.rfid_alerts(created_at desc);

-- ── RFID ZONE TRANSITIONS ─────────────────────────────────────
-- Track movement of tags between zones
create table if not exists public.rfid_zone_transitions (
    id              uuid    default uuid_generate_v4() primary key,
    tag_id          uuid    references public.rfid_tags(id) on delete cascade,
    tag_uid         text    not null,
    
    from_zone       text,
    to_zone         text,
    
    transition_at   timestamptz default now(),
    duration_secs   integer,                                     -- Time spent in zone
    
    reader_id       uuid references public.rfid_readers(id),
    tyre_record_id  uuid references public.tyre_records(id),
    
    country         text,
    region          text,
    site            text
);

create index if not exists idx_rfid_transitions_tag on public.rfid_zone_transitions(tag_id);
create index if not exists idx_rfid_transitions_at on public.rfid_zone_transitions(transition_at desc);
create index if not exists idx_rfid_transitions_zone on public.rfid_zone_transitions(from_zone, to_zone);

-- ── RFID STATISTICS ─────────────────────────────────────────────
-- Pre-computed statistics for dashboard performance
create table if not exists public.rfid_statistics (
    id              uuid    default uuid_generate_v4() primary key,
    stat_date       date not null,
    
    -- Counts
    total_tags          integer default 0,
    attached_tags       integer default 0,
    available_tags      integer default 0,
    lost_tags           integer default 0,
    damaged_tags        integer default 0,
    
    -- Read statistics
    reads_today         integer default 0,
    unique_tags_read    integer default 0,
    undetected_tags     integer default 0,
    
    -- Movement statistics
    zone_transitions    integer default 0,
    
    -- Organization
    country         text,
    region          text,
    site            text,
    
    unique(stat_date, site, country)
);

create index if not exists idx_rfid_stats_date on public.rfid_statistics(stat_date desc);
create index if not exists idx_rfid_stats_site on public.rfid_statistics(site);

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
alter table public.rfid_tags enable row level security;
alter table public.rfid_read_events enable row level security;
alter table public.rfid_readers enable row level security;
alter table public.rfid_alerts enable row level security;
alter table public.rfid_zone_transitions enable row level security;
alter table public.rfid_statistics enable row level security;

-- Authenticated access policies
create policy "Auth users full access" on public.rfid_tags for all using (auth.role() = 'authenticated');
create policy "Auth users full access" on public.rfid_read_events for all using (auth.role() = 'authenticated');
create policy "Auth users full access" on public.rfid_readers for all using (auth.role() = 'authenticated');
create policy "Auth users full access" on public.rfid_alerts for all using (auth.role() = 'authenticated');
create policy "Auth users full access" on public.rfid_zone_transitions for all using (auth.role() = 'authenticated');
create policy "Auth users full access" on public.rfid_statistics for all using (auth.role() = 'authenticated');

-- ── HELPER FUNCTIONS ───────────────────────────────────────

-- Get current tag status for a tyre
create or replace function public.get_tyre_rfid_status(p_tyre_id uuid)
returns table (
    tag_id uuid,
    tag_uid text,
    status text,
    last_seen timestamptz,
    zone text
) language sql stable security definer as $$
    select t.id, t.tag_uid, t.status, t.last_seen_at, t.last_location
    from public.rfid_tags t
    where t.tyre_record_id = p_tyre_id
$$;

-- Get read history for a tag
create or replace function public.get_rfid_read_history(p_tag_uid text, p_limit integer default 100)
returns table (
    read_at timestamptz,
    zone_name text,
    rssi smallint,
    reader_name text
) language sql stable security definer as $$
    select 
        re.read_at,
        re.zone_name,
        re.rssi,
        rr.name as reader_name
    from public.rfid_read_events re
    left join public.rfid_readers rr on re.reader_id = rr.id
    where re.tag_uid = p_tag_uid
    order by re.read_at desc
    limit p_limit
$$;

-- Get tags needing attention (lost/removed/not seen)
create or replace function public.get_rfid_anomalies(p_site text default null, p_days integer default 30)
returns table (
    tag_id uuid,
    tag_uid text,
    status text,
    last_seen timestamptz,
    days_missing integer,
    tyre_serial text,
    asset_no text
) language sql stable security definer as $$
    select 
        t.id,
        t.tag_uid,
        t.status,
        t.last_seen_at,
        floor(extract(epoch from (now() - t.last_seen_at)) / 86400)::integer as days_missing,
        tr.serial_no as tyre_serial,
        t.asset_no
    from public.rfid_tags t
    left join public.tyre_records tr on t.tyre_record_id = tr.id
    where (p_site is null or t.site = p_site)
      and (t.status in ('lost', 'removed') 
           or (t.status = 'attached' and t.last_seen_at < now() - (p_days || ' days')::interval))
    order by t.last_seen_at nulls first
$$;

-- ── AUTO-UPDATE TRIGGER FOR updated_at ───────────────────────
create or replace function public.update_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists set_updated_at on public.rfid_tags;
create trigger set_updated_at before update on public.rfid_tags 
    for each row execute function public.update_updated_at();

drop trigger if exists set_updated_at on public.rfid_readers;
create trigger set_updated_at before update on public.rfid_readers 
    for each row execute function public.update_updated_at();

-- ── BACKFILL EXISTING SERIAL NUMBERS AS RFID TAGS ───────────
-- For existing tyre records without RFID, create records with their serial_no as tag
insert into public.rfid_tags (tag_uid, tag_type, tyre_record_id, status, site, country, region, created_at)
select 
    serial_no as tag_uid,
    'Barcode' as tag_type,
    id as tyre_record_id,
    'attached' as status,
    site,
    country,
    region,
    now()
from public.tyre_records 
where serial_no is not null
  and not exists (
    select 1 from public.rfid_tags where tag_uid = serial_no
  );

-- ── DEFAULT DATA ─────────────────────────────────────────────
-- Insert default readers for common zones
insert into public.rfid_readers (reader_uid, name, zone_name, zone_type, reader_type, site, country, region)
values 
    ('tyrepulse-entry-gate', 'Main Entry Gate', 'Entry Gate', 'entry', 'fixed', 'Main Site', 'KSA', 'KSA'),
    ('tyrepulse-exit-gate', 'Main Exit Gate', 'Exit Gate', 'exit', 'fixed', 'Main Site', 'KSA', 'KSA'),
    ('tyrepulse-tyre-bay', 'Tyre Storage Bay', 'Tyre Storage', 'storage', 'fixed', 'Main Site', 'KSA', 'KSA'),
    ('tyrepulse-workshop', 'Workshop Zone', 'Workshop', 'workshop', 'fixed', 'Main Site', 'KSA', 'KSA'),
    ('tyrepulse-yard', 'Yard Reader', 'Yard', 'yard', 'mobile', 'Main Site', 'KSA', 'KSA')
on conflict (reader_uid) do nothing;