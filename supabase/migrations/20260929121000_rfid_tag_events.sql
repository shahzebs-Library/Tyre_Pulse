-- RFID tag history: one append-only row per change to rfid_tags, written by a
-- trigger so every path (page, import, API) is recorded. Users read only.
create table if not exists public.rfid_tag_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid default public.app_current_org(),
  country text,
  tag_row_id uuid,
  tag_id text,
  action text not null check (action in ('registered','assigned','reassigned','unassigned','retired','reactivated','moved','edited','deleted')),
  from_asset_no text, to_asset_no text,
  from_tyre_serial text, to_tyre_serial text,
  from_status text, to_status text,
  from_site text, to_site text,
  actor_id uuid,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists rfid_tag_events_tag_idx on public.rfid_tag_events (tag_row_id, created_at desc);
create index if not exists rfid_tag_events_org_idx on public.rfid_tag_events (organisation_id, country, created_at desc);

alter table public.rfid_tag_events enable row level security;
revoke all on public.rfid_tag_events from anon;
revoke insert, update, delete on public.rfid_tag_events from authenticated;
grant select on public.rfid_tag_events to authenticated;

create policy rfid_tag_events_org_isolation on public.rfid_tag_events as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
create policy rfid_tag_events_country_isolation on public.rfid_tag_events as restrictive for all to authenticated
  using ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
    or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))));
create policy rfid_tag_events_read on public.rfid_tag_events for select to authenticated
  using ((select public.is_approved_and_unlocked()));

create or replace function public.log_rfid_tag_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action text; v_name text; v_from text; v_to text;
begin
  select coalesce(nullif(btrim(full_name), ''), username) into v_name from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    v_action := 'registered';
    insert into public.rfid_tag_events (organisation_id, country, tag_row_id, tag_id, action,
      to_asset_no, to_tyre_serial, to_status, to_site, actor_id, actor_name)
    values (new.organisation_id, new.country, new.id, new.tag_id, v_action,
      new.asset_no, new.tyre_serial, new.status, new.site, auth.uid(), v_name);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.rfid_tag_events (organisation_id, country, tag_row_id, tag_id, action,
      from_asset_no, from_tyre_serial, from_status, from_site, actor_id, actor_name)
    values (old.organisation_id, old.country, old.id, old.tag_id, 'deleted',
      old.asset_no, old.tyre_serial, old.status, old.site, auth.uid(), v_name);
    return old;
  end if;
  -- UPDATE: ignore scan touches (only last_scanned_at / updated_at moved).
  if new.tag_id is not distinct from old.tag_id and new.asset_no is not distinct from old.asset_no
     and new.tyre_serial is not distinct from old.tyre_serial and new.status is not distinct from old.status
     and new.site is not distinct from old.site and new.notes is not distinct from old.notes then
    return new;
  end if;
  v_from := coalesce(nullif(btrim(old.asset_no), ''), nullif(btrim(old.tyre_serial), ''));
  v_to := coalesce(nullif(btrim(new.asset_no), ''), nullif(btrim(new.tyre_serial), ''));
  if new.status = 'retired' and old.status is distinct from 'retired' then v_action := 'retired';
  elsif old.status = 'retired' and new.status is distinct from 'retired' then v_action := 'reactivated';
  elsif v_from is null and v_to is not null then v_action := 'assigned';
  elsif v_from is not null and v_to is null then v_action := 'unassigned';
  elsif v_from is distinct from v_to then v_action := 'reassigned';
  elsif new.site is distinct from old.site then v_action := 'moved';
  else v_action := 'edited';
  end if;
  insert into public.rfid_tag_events (organisation_id, country, tag_row_id, tag_id, action,
    from_asset_no, to_asset_no, from_tyre_serial, to_tyre_serial, from_status, to_status, from_site, to_site, actor_id, actor_name)
  values (new.organisation_id, new.country, new.id, new.tag_id, v_action,
    old.asset_no, new.asset_no, old.tyre_serial, new.tyre_serial, old.status, new.status, old.site, new.site, auth.uid(), v_name);
  return new;
end $$;
revoke all on function public.log_rfid_tag_event() from public, anon, authenticated;

drop trigger if exists trg_rfid_tag_events on public.rfid_tags;
create trigger trg_rfid_tag_events after insert or update or delete on public.rfid_tags
  for each row execute function public.log_rfid_tag_event();

-- Seed one 'registered' row per existing tag so history is not empty for old tags.
insert into public.rfid_tag_events (organisation_id, country, tag_row_id, tag_id, action, to_asset_no, to_tyre_serial, to_status, to_site, actor_id, created_at)
select t.organisation_id, t.country, t.id, t.tag_id, 'registered', t.asset_no, t.tyre_serial, t.status, t.site, t.created_by, t.created_at
from public.rfid_tags t
where not exists (select 1 from public.rfid_tag_events e where e.tag_row_id = t.id);
