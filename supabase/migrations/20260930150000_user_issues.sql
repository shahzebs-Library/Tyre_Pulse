-- Problem Tracking, Phase 0 (attribution) + Phase 1 ("Report a problem").
-- Applied live via Supabase MCP on project jhssdmeruxtrlqnwfksc.
--
-- Phase 0: system_logs gains platform / app_version / device / screen /
-- error_fingerprint (all nullable, additive) so an error can be attributed to a
-- surface, a build and a screen, and grouped by fingerprint. log_client_error
-- (the pre-login fallback) accepts the same fields as trailing DEFAULT NULL args.
--
-- Phase 1: user_issues (one row per report) + user_issue_events (append-only
-- history). Writes go ONLY through SECURITY DEFINER RPCs that stamp reporter,
-- org, country, site and time on the server. Authenticated clients get SELECT
-- only. anon gets nothing.
--
-- Rollback:
--   drop function if exists public.submit_user_issue(text,text,text,text,text,text,text,text,text);
--   drop function if exists public.set_user_issue_status(uuid,text,text,text);
--   drop function if exists public.assign_user_issue(uuid,uuid);
--   drop function if exists public.comment_user_issue(uuid,text);
--   drop function if exists public.get_user_issue_logs(uuid);
--   drop function if exists public._user_issue_admin();
--   drop table if exists public.user_issue_events; drop table if exists public.user_issues;
--   alter table public.system_logs drop column platform, drop column app_version,
--     drop column device, drop column screen, drop column error_fingerprint;
--   (then recreate log_client_error with its original 7 args)

-- ── Phase 0: attribution columns ────────────────────────────────────────────
alter table public.system_logs
  add column if not exists platform text,
  add column if not exists app_version text,
  add column if not exists device text,
  add column if not exists screen text,
  add column if not exists error_fingerprint text;

create index if not exists system_logs_fingerprint_created_idx
  on public.system_logs (error_fingerprint, created_at desc)
  where error_fingerprint is not null;

create index if not exists system_logs_user_created_idx
  on public.system_logs (user_id, created_at desc)
  where user_id is not null;

drop function if exists public.log_client_error(text, text, text, text, jsonb, text, text);

create or replace function public.log_client_error(
  p_severity text, p_source text, p_message text,
  p_module_id text default null, p_detail jsonb default null,
  p_reference_id text default null, p_url text default null,
  p_platform text default null, p_app_version text default null,
  p_device text default null, p_screen text default null,
  p_fingerprint text default null)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_msg     text := left(btrim(coalesce(p_message, '')), 2000);
  v_sev     text := lower(btrim(coalesce(p_severity, 'error')));
  v_detail  jsonb := p_detail;
  v_bucket  timestamptz := date_trunc('minute', now());
  v_ip      text;
  v_key     text;
  v_n       int;
  v_global  int;
begin
  if v_msg = '' then return false; end if;

  if v_sev not in ('info', 'warning', 'error', 'critical') then v_sev := 'error'; end if;
  if v_uid is null and v_sev = 'critical' then v_sev := 'error'; end if;

  if v_detail is not null
     and (jsonb_typeof(v_detail) <> 'object' or pg_column_size(v_detail) > 4096) then
    v_detail := jsonb_build_object('truncated', true);
  end if;

  if v_uid is not null then
    v_key := 'u:' || v_uid::text;
  else
    begin
      select coalesce(nullif(h ->> 'cf-connecting-ip', ''),
                      nullif(btrim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''),
                      nullif(h ->> 'x-real-ip', ''),
                      'unknown')
        into v_ip
        from (select current_setting('request.headers', true)::jsonb as h) s;
    exception when others then
      v_ip := 'unknown';
    end;
    v_key := 'a:' || left(coalesce(v_ip, 'unknown'), 64);
  end if;

  insert into public.client_error_rate as r (rkey, bucket, n) values (v_key, v_bucket, 1)
  on conflict (rkey, bucket) do update set n = r.n + 1
  returning r.n into v_n;

  if v_uid is null then
    insert into public.client_error_rate as r (rkey, bucket, n) values ('a:*', v_bucket, 1)
    on conflict (rkey, bucket) do update set n = r.n + 1
    returning r.n into v_global;
    if v_n > 10 or v_global > 60 then return false; end if;
  elsif v_n > 30 then
    return false;
  end if;

  delete from public.client_error_rate where bucket < now() - interval '10 minutes';

  insert into public.system_logs
    (organisation_id, module_id, severity, source, message, detail, reference_id, url, user_id, user_email,
     platform, app_version, device, screen, error_fingerprint)
  values
    (public.app_current_org(),
     nullif(left(btrim(coalesce(p_module_id, '')), 100), ''),
     v_sev,
     nullif(left(btrim(coalesce(p_source, '')), 200), ''),
     v_msg,
     coalesce(v_detail, '{}'::jsonb),
     nullif(left(btrim(coalesce(p_reference_id, '')), 100), ''),
     nullif(left(btrim(coalesce(p_url, '')), 1000), ''),
     v_uid,
     null,
     case when lower(btrim(coalesce(p_platform, ''))) in ('web', 'flutter', 'expo')
          then lower(btrim(p_platform)) end,
     nullif(left(btrim(coalesce(p_app_version, '')), 40), ''),
     nullif(left(btrim(coalesce(p_device, '')), 200), ''),
     nullif(left(btrim(coalesce(p_screen, '')), 300), ''),
     nullif(left(btrim(coalesce(p_fingerprint, '')), 300), ''));
  return true;
exception when others then
  return false;
end
$function$;

revoke all on function public.log_client_error(text,text,text,text,jsonb,text,text,text,text,text,text,text) from public;
grant execute on function public.log_client_error(text,text,text,text,jsonb,text,text,text,text,text,text,text)
  to anon, authenticated, service_role;

-- ── Phase 1: tables ─────────────────────────────────────────────────────────
create table if not exists public.user_issues (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null,
  country           text,
  site              text,
  reporter_id       uuid references public.profiles(id) on delete set null,
  platform          text not null default 'web' check (platform in ('web', 'flutter', 'expo')),
  app_version       text check (app_version is null or length(app_version) <= 40),
  device            text check (device is null or length(device) <= 200),
  os                text check (os is null or length(os) <= 120),
  page_or_screen    text check (page_or_screen is null or length(page_or_screen) <= 300),
  description       text not null check (length(description) between 5 and 2000),
  category          text not null check (category in ('bug', 'data_wrong', 'slow', 'access', 'other')),
  severity          text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  reference_id      text check (reference_id is null or length(reference_id) <= 100),
  screenshot_path   text,
  linked_log_ids    uuid[] not null default '{}',
  linked_sentry_ids text[] not null default '{}',
  status            text not null default 'new'
                    check (status in ('new', 'triaged', 'in_progress', 'waiting_user', 'fixed', 'closed', 'wont_fix')),
  assignee_id       uuid references public.profiles(id) on delete set null,
  fixed_in_version  text check (fixed_in_version is null or length(fixed_in_version) <= 40),
  sla_due_at        timestamptz,
  first_response_at timestamptz,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists user_issues_org_created_idx on public.user_issues (organisation_id, created_at desc);
create index if not exists user_issues_reporter_idx on public.user_issues (reporter_id, created_at desc);
create index if not exists user_issues_status_idx on public.user_issues (status, created_at desc);
create index if not exists user_issues_assignee_idx on public.user_issues (assignee_id) where assignee_id is not null;

create table if not exists public.user_issue_events (
  id              uuid primary key default gen_random_uuid(),
  issue_id        uuid not null references public.user_issues(id) on delete cascade,
  organisation_id uuid not null,
  actor_id        uuid references public.profiles(id) on delete set null,
  event_type      text not null check (event_type in ('created', 'status', 'assign', 'fixed_version', 'comment')),
  from_value      text,
  to_value        text,
  note            text check (note is null or length(note) <= 2000),
  created_at      timestamptz not null default now()
);

create index if not exists user_issue_events_issue_idx on public.user_issue_events (issue_id, created_at);
create index if not exists user_issue_events_actor_idx on public.user_issue_events (actor_id) where actor_id is not null;

-- ── Access helper ───────────────────────────────────────────────────────────
create or replace function public._user_issue_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $$
  select public.is_super_admin()
      or (coalesce(public.app_role(), '') = 'admin' and coalesce(public.app_is_active(), false));
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.user_issues enable row level security;
alter table public.user_issue_events enable row level security;

drop policy if exists user_issues_org_isolation on public.user_issues;
create policy user_issues_org_isolation on public.user_issues
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));

drop policy if exists user_issues_select on public.user_issues;
create policy user_issues_select on public.user_issues
  for select to authenticated
  using (reporter_id = (select auth.uid()) or (select public._user_issue_admin()));

drop policy if exists user_issue_events_org_isolation on public.user_issue_events;
create policy user_issue_events_org_isolation on public.user_issue_events
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));

drop policy if exists user_issue_events_select on public.user_issue_events;
create policy user_issue_events_select on public.user_issue_events
  for select to authenticated
  using (exists (select 1 from public.user_issues i where i.id = user_issue_events.issue_id));

revoke all on public.user_issues from public, anon, authenticated;
revoke all on public.user_issue_events from public, anon, authenticated;
grant select on public.user_issues to authenticated;
grant select on public.user_issue_events to authenticated;
grant all on public.user_issues, public.user_issue_events to service_role;

-- Events are append-only for everyone, including privileged roles.
create or replace function public._user_issue_events_immutable()
 returns trigger language plpgsql set search_path to 'public'
as $$
begin
  raise exception 'Problem history cannot be changed' using errcode = '42501';
end $$;

drop trigger if exists trg_user_issue_events_immutable on public.user_issue_events;
create trigger trg_user_issue_events_immutable
  before update on public.user_issue_events
  for each row execute function public._user_issue_events_immutable();

-- ── submit_user_issue ───────────────────────────────────────────────────────
create or replace function public.submit_user_issue(
  p_description text,
  p_category text,
  p_severity text default 'medium',
  p_platform text default 'web',
  p_app_version text default null,
  p_device text default null,
  p_os text default null,
  p_page text default null,
  p_reference_id text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v_uid   uuid := auth.uid();
  v_prof  public.profiles%rowtype;
  v_org   uuid;
  v_desc  text := btrim(coalesce(p_description, ''));
  v_cat   text := lower(btrim(coalesce(p_category, '')));
  v_sev   text := lower(btrim(coalesce(p_severity, 'medium')));
  v_plat  text := lower(btrim(coalesce(p_platform, 'web')));
  v_ref   text := nullif(left(btrim(coalesce(p_reference_id, '')), 100), '');
  v_logs  uuid[];
  v_recent int;
  v_id    uuid;
  v_due   timestamptz;
begin
  if v_uid is null then
    raise exception 'Please sign in to report a problem' using errcode = '42501';
  end if;
  select * into v_prof from public.profiles where id = v_uid;
  if not found or coalesce(v_prof.locked, false) then
    raise exception 'Your account cannot report problems' using errcode = '42501';
  end if;
  v_org := coalesce(v_prof.org_id, v_prof.organisation_id);
  if v_org is null then
    raise exception 'Your account is not linked to a company' using errcode = '42501';
  end if;

  if length(v_desc) < 5 then
    raise exception 'Please describe the problem in a few words' using errcode = '22023';
  end if;
  if length(v_desc) > 2000 then
    raise exception 'The description is too long (2000 characters at most)' using errcode = '22023';
  end if;
  if v_cat not in ('bug', 'data_wrong', 'slow', 'access', 'other') then
    raise exception 'Unknown problem type' using errcode = '22023';
  end if;
  if v_sev not in ('low', 'medium', 'high', 'critical') then v_sev := 'medium'; end if;
  if v_plat not in ('web', 'flutter', 'expo') then v_plat := 'web'; end if;

  select count(*) into v_recent from public.user_issues
   where reporter_id = v_uid and created_at > now() - interval '1 hour';
  if v_recent >= 20 then
    raise exception 'Too many reports in the last hour. Please try again later' using errcode = '54000';
  end if;

  -- The caller's own recent error logs (last 30 minutes, newest 10), plus the
  -- log carrying the quoted reference id when there is one (last 24 hours).
  select coalesce(array_agg(id), '{}') into v_logs from (
    select id from public.system_logs
     where user_id = v_uid
       and (created_at > now() - interval '30 minutes'
            or (v_ref is not null and reference_id = v_ref and created_at > now() - interval '24 hours'))
     order by created_at desc
     limit 10) s;

  v_due := now() + case v_sev
    when 'critical' then interval '4 hours'
    when 'high' then interval '1 day'
    else interval '5 days' end;

  insert into public.user_issues
    (organisation_id, country, site, reporter_id, platform, app_version, device, os, page_or_screen,
     description, category, severity, reference_id, linked_log_ids, sla_due_at)
  values
    (v_org,
     case when v_prof.country is not null and array_length(v_prof.country, 1) = 1 then v_prof.country[1] end,
     nullif(btrim(coalesce(v_prof.site, '')), ''),
     v_uid, v_plat,
     nullif(left(btrim(coalesce(p_app_version, '')), 40), ''),
     nullif(left(btrim(coalesce(p_device, '')), 200), ''),
     nullif(left(btrim(coalesce(p_os, '')), 120), ''),
     nullif(left(btrim(coalesce(p_page, '')), 300), ''),
     v_desc, v_cat, v_sev, v_ref, v_logs, v_due)
  returning id into v_id;

  insert into public.user_issue_events (issue_id, organisation_id, actor_id, event_type, to_value)
  values (v_id, v_org, v_uid, 'created', 'new');

  return jsonb_build_object('ok', true, 'id', v_id, 'linked_logs', coalesce(array_length(v_logs, 1), 0));
end $$;

-- ── Admin actions ───────────────────────────────────────────────────────────
create or replace function public._user_issue_for_admin(p_id uuid)
 returns public.user_issues
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare v public.user_issues%rowtype;
begin
  if not public._user_issue_admin() then
    raise exception 'Only an administrator can manage reported problems' using errcode = '42501';
  end if;
  select * into v from public.user_issues where id = p_id for update;
  if not found then
    raise exception 'Problem report not found' using errcode = 'P0002';
  end if;
  if not public.is_super_admin() and v.organisation_id is distinct from public.app_current_org() then
    raise exception 'Problem report not found' using errcode = 'P0002';
  end if;
  return v;
end $$;

create or replace function public.set_user_issue_status(
  p_id uuid, p_status text, p_fixed_in_version text default null, p_note text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v       public.user_issues%rowtype;
  v_uid   uuid := auth.uid();
  v_st    text := lower(btrim(coalesce(p_status, '')));
  v_ver   text := nullif(left(btrim(coalesce(p_fixed_in_version, '')), 40), '');
  v_note  text := nullif(left(btrim(coalesce(p_note, '')), 2000), '');
  v_notified boolean := false;
begin
  v := public._user_issue_for_admin(p_id);
  if v_st not in ('new', 'triaged', 'in_progress', 'waiting_user', 'fixed', 'closed', 'wont_fix') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  if v_st = 'fixed' and coalesce(v_ver, v.fixed_in_version) is null then
    raise exception 'Say which app version has the fix' using errcode = '22023';
  end if;

  update public.user_issues set
    status = v_st,
    fixed_in_version = coalesce(v_ver, fixed_in_version),
    first_response_at = coalesce(first_response_at, now()),
    resolved_at = case when v_st in ('fixed', 'closed', 'wont_fix') then coalesce(resolved_at, now()) else null end,
    updated_at = now()
  where id = v.id;

  if v_st is distinct from v.status then
    insert into public.user_issue_events (issue_id, organisation_id, actor_id, event_type, from_value, to_value, note)
    values (v.id, v.organisation_id, v_uid, 'status', v.status, v_st, v_note);
  elsif v_note is not null then
    insert into public.user_issue_events (issue_id, organisation_id, actor_id, event_type, note)
    values (v.id, v.organisation_id, v_uid, 'comment', v_note);
  end if;
  if v_ver is not null and v_ver is distinct from v.fixed_in_version then
    insert into public.user_issue_events (issue_id, organisation_id, actor_id, event_type, from_value, to_value)
    values (v.id, v.organisation_id, v_uid, 'fixed_version', v.fixed_in_version, v_ver);
  end if;

  if v_st = 'fixed' and v.status is distinct from 'fixed' and v.reporter_id is not null then
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    values (v.reporter_id, 'success', 'Your problem was fixed',
            'Your problem was fixed in version ' || coalesce(v_ver, v.fixed_in_version)
              || '. Please update the app to get the fix.',
            'user_issue', v.id);
    v_notified := true;
  end if;

  return jsonb_build_object('ok', true, 'status', v_st, 'notified', v_notified);
end $$;

create or replace function public.assign_user_issue(p_id uuid, p_assignee_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v     public.user_issues%rowtype;
  v_uid uuid := auth.uid();
  v_ok  boolean;
begin
  v := public._user_issue_for_admin(p_id);
  if p_assignee_id is not null then
    select (coalesce(is_super_admin, false)
            or (role = 'Admin' and coalesce(org_id, organisation_id) = v.organisation_id))
           and not coalesce(locked, false)
      into v_ok from public.profiles where id = p_assignee_id;
    if not coalesce(v_ok, false) then
      raise exception 'Only an administrator of this company can own a problem' using errcode = '22023';
    end if;
  end if;
  if p_assignee_id is not distinct from v.assignee_id then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  update public.user_issues set
    assignee_id = p_assignee_id,
    first_response_at = coalesce(first_response_at, now()),
    status = case when status = 'new' and p_assignee_id is not null then 'triaged' else status end,
    updated_at = now()
  where id = v.id;
  insert into public.user_issue_events (issue_id, organisation_id, actor_id, event_type, from_value, to_value)
  values (v.id, v.organisation_id, v_uid, 'assign', v.assignee_id::text, p_assignee_id::text);
  if v.status = 'new' and p_assignee_id is not null then
    insert into public.user_issue_events (issue_id, organisation_id, actor_id, event_type, from_value, to_value)
    values (v.id, v.organisation_id, v_uid, 'status', 'new', 'triaged');
  end if;
  return jsonb_build_object('ok', true, 'changed', true);
end $$;

create or replace function public.comment_user_issue(p_id uuid, p_note text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $$
declare
  v      public.user_issues%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  v := public._user_issue_for_admin(p_id);
  if v_note = '' then
    raise exception 'Write a note first' using errcode = '22023';
  end if;
  insert into public.user_issue_events (issue_id, organisation_id, actor_id, event_type, note)
  values (v.id, v.organisation_id, auth.uid(), 'comment', left(v_note, 2000));
  update public.user_issues set first_response_at = coalesce(first_response_at, now()), updated_at = now()
   where id = v.id;
  return jsonb_build_object('ok', true);
end $$;

-- The logs attached to a report. system_logs RLS does not let a super admin read
-- another company's logs, so the linked rows are served here, admin gated.
create or replace function public.get_user_issue_logs(p_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $$
declare
  v public.user_issues%rowtype;
  v_out jsonb;
begin
  if not public._user_issue_admin() then
    raise exception 'Only an administrator can read linked errors' using errcode = '42501';
  end if;
  select * into v from public.user_issues where id = p_id;
  if not found or (not public.is_super_admin() and v.organisation_id is distinct from public.app_current_org()) then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'created_at', l.created_at, 'severity', l.severity, 'source', l.source,
           'message', left(l.message, 500), 'reference_id', l.reference_id, 'url', l.url,
           'screen', l.screen, 'platform', l.platform, 'app_version', l.app_version,
           'error_fingerprint', l.error_fingerprint) order by l.created_at desc), '[]'::jsonb)
    into v_out
    from public.system_logs l
   where l.id = any (v.linked_log_ids);
  return v_out;
end $$;

-- ── Grants: revoke PUBLIC first (it carries the default grant), then anon ──
do $$
declare f text;
begin
  foreach f in array array[
    'public._user_issue_admin()',
    'public._user_issue_for_admin(uuid)',
    'public.submit_user_issue(text,text,text,text,text,text,text,text,text)',
    'public.set_user_issue_status(uuid,text,text,text)',
    'public.assign_user_issue(uuid,uuid)',
    'public.comment_user_issue(uuid,text)',
    'public.get_user_issue_logs(uuid)',
    'public._user_issue_events_immutable()'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
  end loop;
end $$;

grant execute on function public._user_issue_admin() to authenticated, service_role;
grant execute on function public.submit_user_issue(text,text,text,text,text,text,text,text,text) to authenticated, service_role;
grant execute on function public.set_user_issue_status(uuid,text,text,text) to authenticated, service_role;
grant execute on function public.assign_user_issue(uuid,uuid) to authenticated, service_role;
grant execute on function public.comment_user_issue(uuid,text) to authenticated, service_role;
grant execute on function public.get_user_issue_logs(uuid) to authenticated, service_role;

-- Supabase default privileges grant EXECUTE to authenticated directly at CREATE
-- time, so the internal helpers need an explicit revoke from authenticated too
-- (applied live as migration user_issues_internal_grants).
revoke all on function public._user_issue_for_admin(uuid) from authenticated;
revoke all on function public._user_issue_events_immutable() from authenticated;

-- VERIFIED live 2026-09-30 by impersonation, rolled back:
--   Tyre Man A submits (1 own log attached), reads own 1 + 1 event; short text and
--   unknown category refused; direct INSERT refused; A cannot change status.
--   Tyre Man B reads A's issue 0 and events 0. Super admin reads 1, linked logs 1,
--   assign ok, fixed without version refused, fixed 2.1.1 ok, reporter notified 1,
--   6 history rows, history UPDATE refused. anon: no EXECUTE on the new RPCs and no
--   SELECT on the tables.
