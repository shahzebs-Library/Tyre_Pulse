-- 20261004101000_trust_alert_decisions.sql
-- STATUS: APPLIED LIVE 2026-10-04 via execute_sql in parts (apply_migration timed out on the
-- destructive-statement confirm), recorded in schema_migrations as 20261004101000. Verified by
-- impersonation, rolled back: super admin reopen OK, 2-char reason refused, direct insert into
-- trust_alert_events refused, Manager refused (42501). anon has no EXECUTE / SELECT.
--
-- Data Trust Alerts: every acknowledge / resolve / reopen now carries a reason
-- and lands in an append-only timeline, so "who closed this and why" can be
-- answered. Additive only:
--   * trust_alerts += resolution_note, resolved_by, resolved_at
--   * trust_alert_events (append-only, written only by the DEFINER function)
--   * decide_trust_alert(p_id, p_status, p_note) - Admin or super admin only,
--     reason required (3+ chars), org-scoped. The old ack_trust_alert stays.
-- Rollback: drop function public.decide_trust_alert(bigint,text,text);
--           drop table public.trust_alert_events;
--           alter table public.trust_alerts drop column resolution_note,
--             drop column resolved_by, drop column resolved_at;

alter table public.trust_alerts
  add column if not exists resolution_note text,
  add column if not exists resolved_by uuid,
  add column if not exists resolved_at timestamptz;

create table if not exists public.trust_alert_events (
  id bigint generated always as identity primary key,
  alert_id bigint not null references public.trust_alerts(id) on delete cascade,
  organisation_id uuid not null,
  from_status text,
  to_status text not null check (to_status in ('open','ack','resolved')),
  note text not null,
  actor uuid default auth.uid(),
  at timestamptz not null default now()
);
create index if not exists trust_alert_events_alert_idx on public.trust_alert_events (alert_id, at desc);
alter table public.trust_alert_events enable row level security;

drop policy if exists trust_alert_events_org on public.trust_alert_events;
create policy trust_alert_events_org on public.trust_alert_events as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (false);
drop policy if exists trust_alert_events_read on public.trust_alert_events;
create policy trust_alert_events_read on public.trust_alert_events for select to authenticated
  using ((select public.is_super_admin()) or lower(coalesce((select public.app_role()), '')) = 'admin');

revoke all on public.trust_alert_events from anon;
revoke insert, update, delete, truncate on public.trust_alert_events from authenticated;
grant select on public.trust_alert_events to authenticated;

create or replace function public.decide_trust_alert(p_id bigint, p_status text, p_note text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_from text;
  v_alert_org uuid;
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not (public.is_super_admin() or lower(coalesce(public.app_role(), '')) = 'admin') then
    raise exception 'Only an Admin or super admin can decide a trust alert' using errcode = '42501';
  end if;
  if p_status not in ('open','ack','resolved') then
    raise exception 'Unknown alert status' using errcode = '22023';
  end if;
  if length(v_note) < 3 then
    raise exception 'A reason of at least 3 characters is required' using errcode = '22023';
  end if;

  select status, organisation_id into v_from, v_alert_org
    from public.trust_alerts where id = p_id for update;
  if not found or (v_alert_org is distinct from v_org and not public.is_super_admin()) then
    raise exception 'Alert not found' using errcode = 'P0002';
  end if;
  if v_from = p_status then
    raise exception 'The alert is already in that state' using errcode = '22023';
  end if;

  update public.trust_alerts
     set status = p_status,
         acked_by = case when p_status = 'ack' then auth.uid() else acked_by end,
         acked_at = case when p_status = 'ack' then now() else acked_at end,
         resolved_by = case when p_status = 'resolved' then auth.uid() when p_status = 'open' then null else resolved_by end,
         resolved_at = case when p_status = 'resolved' then now() when p_status = 'open' then null else resolved_at end,
         resolution_note = left(v_note, 1000)
   where id = p_id;

  insert into public.trust_alert_events (alert_id, organisation_id, from_status, to_status, note, actor)
  values (p_id, v_alert_org, v_from, p_status, left(v_note, 1000), auth.uid());

  return json_build_object('ok', true, 'id', p_id, 'from', v_from, 'status', p_status);
end $$;

revoke all on function public.decide_trust_alert(bigint, text, text) from public;
revoke all on function public.decide_trust_alert(bigint, text, text) from anon;
grant execute on function public.decide_trust_alert(bigint, text, text) to authenticated;
