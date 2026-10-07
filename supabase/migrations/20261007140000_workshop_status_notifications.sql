-- ============================================================================
-- Workshop Status - notifications (Loop 12)
-- ============================================================================
-- STATUS: NOT APPLIED. Tested in PGlite (supabase/tests/
-- workshop_status_notifications.test.mjs, applied on top of 20261007090000,
-- 20261007100000, 20261007110000, 20261007120000 and 20261007130000). Apply to
-- production only on an explicit owner go-ahead, and only after those five.
--
-- NO NEW NOTIFICATION SYSTEM. Every notice lands in the EXISTING places:
--   * public.notifications - the per-user bell read by the web Notification
--     Center, the mobile inbox and (new) the Workshop Status notifications strip.
--   * public.workflow_notifications - the existing push queue, delivered by the
--     V119 pg_cron deliverer -> workflow-notify edge function, using the
--     pre-rendered push {title, body} that function already supports (same as
--     V486 upload-gap pushes). A processed domain_events row supplies the
--     unique event_id (same as the governed approval notifications).
--     No edge function redeploy is needed. Recipients carry user_id + push
--     token only (never an email address), so no email is sent.
--
-- Owner rule: "if anything we upload they get notification and they update it
-- only". When a daily upload is CONFIRMED, every person responsible for a
-- vehicle in it gets ONE notification for that upload listing the vehicles
-- that need their update today (new / changed called out); people who may
-- assign get the vehicles with nobody responsible; a vehicle that left the
-- file is reported as "released" (never "removed") to its previous
-- responsible person and to assigners.
--
-- Daily scan (pg_cron, hourly; dedupe makes each notice fire at most once):
--   workshop_status_upload_review     upload previewed > 30 min, not confirmed  -> confirmers
--   workshop_status_update_missing    not updated by a person today, after the
--                                     update deadline hour (default 10:00)     -> responsible
--   workshop_status_waiting_long      waiting parts / manpower / approval and
--                                     down >= N days (default 7)              -> responsible
--   workshop_status_long_down         down >= N days, no waiting reason        -> responsible
--   workshop_status_release_today     expected release date = today            -> responsible
--   workshop_status_release_overdue   expected release date passed             -> responsible
--   workshop_status_no_responsible    nobody responsible                       -> assigners
--   workshop_status_missing_eta       no expected release, down >= 3 days      -> responsible
--   workshop_status_ready_release     stage 'Ready for Release'                -> assigners
-- "responsible" falls back to the assigners when the record has nobody
-- responsible or that person can no longer see the vehicle.
--
-- PERMISSION-AWARE RECIPIENTS. A person is notified about a vehicle only when
-- the SAME server decisions that guard the data say they may see it:
-- workshop_status_can('view' | 'update' | 'assign' | 'confirm' |
-- 'view_removed') and the country / site scope readers the RLS policies use
-- (app_sees_all_countries / app_country_scope / app_sees_all_sites /
-- app_site_scope / is_super_admin). They are evaluated FOR EACH CANDIDATE by
-- setting the request JWT subject transaction-locally inside
-- workshop_status_recipient_scope() and restoring it immediately, so there is
-- no second copy of the permission logic to drift. Candidates are approved,
-- unlocked profiles of the record's organisation only (never the
-- non-org-scoped notify_elevated_users). The pre-filter on module_permissions /
-- user_access_grants is a superset only; the final answer is always the real
-- decision function.
--
-- ANTI-SPAM. public.workshop_status_notices remembers (org, user, kind,
-- subject, period). Period is the local day for daily conditions, the expected
-- date for "overdue" (re-arms when somebody changes the date), the upload id
-- for upload notices and 'once' for threshold conditions. A notice that already
-- exists is never sent again; one notification per user per kind per run
-- bundles every vehicle that is new for that user. An upload that already told
-- assigners about unassigned vehicles marks them noticed for the scan too.
--
-- Fail-safe: notification failures never block an upload confirm (the trigger
-- swallows errors and logs nothing back into the business transaction).
--
-- Switches (system_config, read at run time, default on):
--   workshop_status_notifications = 'false'  turns every notice off
--   workshop_status_push          = 'false'  bell only, no push
--   workshop_status_wait_days     (7)  workshop_status_eta_days (3)
--   workshop_status_update_deadline_hour (10)  workshop_status_timezone (Asia/Riyadh)
--
-- Rollback:
--   do $$ begin if to_regclass('cron.job') is not null then
--     perform cron.unschedule('workshop-status-notify'); end if; end $$;
--   drop trigger if exists trg_workshop_status_notify_upload on public.workshop_status_events;
--   drop function public.workshop_status_notify_upload_trg(),
--     public.workshop_status_notify_upload(uuid, jsonb),
--     public.workshop_status_notify_scan(timestamptz),
--     public.workshop_status_notice_send(uuid, uuid, text, text, text, text, uuid, text),
--     public.workshop_status_notice_candidates(uuid),
--     public.workshop_status_recipient_scope(uuid),
--     public.workshop_status_scope_allows(jsonb, text, text),
--     public.workshop_status_wait_category(text, text),
--     public.workshop_status_asset_list(text[]),
--     public.workshop_status_notify_config(text, text);
--   drop table public.workshop_status_notices;
--   delete from public.system_config where key like 'workshop_status_%';
--   (bell rows already delivered stay in notifications - they are the users' own.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Dedupe ledger. Server-only: RLS on with no policy, no client grants.
-- ---------------------------------------------------------------------------
create table if not exists public.workshop_status_notices (
  id               bigint generated always as identity primary key,
  organisation_id  uuid not null,
  user_id          uuid not null,
  kind             text not null,
  subject_id       uuid not null,
  period           text not null,
  created_at       timestamptz not null default now(),
  constraint workshop_status_notices_once unique (organisation_id, user_id, kind, subject_id, period)
);
create index if not exists workshop_status_notices_created_idx
  on public.workshop_status_notices (created_at);
alter table public.workshop_status_notices enable row level security;
revoke all on public.workshop_status_notices from public, anon, authenticated;

-- Default switches (insert-only; an administrator's value is never changed).
do $$
begin
  if to_regclass('public.system_config') is not null then
    insert into public.system_config (key, value) values
      ('workshop_status_notifications', 'true'),
      ('workshop_status_push', 'true'),
      ('workshop_status_wait_days', '7'),
      ('workshop_status_eta_days', '3'),
      ('workshop_status_update_deadline_hour', '10'),
      ('workshop_status_timezone', 'Asia/Riyadh')
    on conflict (key) do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Helpers.
-- ---------------------------------------------------------------------------

-- system_config value as trimmed text, or the default. Never raises (missing
-- table, missing key and jsonb-quoted values all handled).
create or replace function public.workshop_status_notify_config(p_key text, p_default text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  begin
    execute 'select value::text from public.system_config where key = $1' into v using p_key;
  exception when others then
    v := null;
  end;
  v := nullif(btrim(btrim(coalesce(v, '')), '"'), '');
  return coalesce(v, p_default);
end $$;

-- 'parts' | 'manpower' | 'approval' | null, from the controlled vocabulary of
-- workshop_status_manual_vocab (Loop 8). CHANGE BOTH TOGETHER.
create or replace function public.workshop_status_wait_category(p_stage text, p_delay text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_delay in ('Waiting for Spare Parts', 'Spare Parts Not Available', 'MR Pending', 'PO Pending',
                     'Supplier Delivery Pending') or p_stage = 'Waiting for Parts' then 'parts'
    when p_delay in ('Waiting for Manpower', 'Technician Not Available', 'Specialist Technician Required')
         or p_stage = 'Waiting for Manpower' then 'manpower'
    when p_delay in ('Waiting for Approval', 'Waiting for Budget Approval')
         or p_stage = 'Waiting for Approval' then 'approval'
  end
$$;

-- "TM1, TM2, TM3, TM4, TM5 and 3 more".
create or replace function public.workshop_status_asset_list(p_assets text[])
returns text language sql immutable set search_path = public as $$
  select case
    when coalesce(cardinality(p_assets), 0) = 0 then ''
    when cardinality(p_assets) <= 5 then array_to_string(p_assets, ', ')
    else array_to_string(p_assets[1:5], ', ') || ' and ' || (cardinality(p_assets) - 5)::text || ' more'
  end
$$;

-- Mirror of the restrictive country / site RLS policies on workshop_status_*
-- (migration 20261007090000), evaluated against a recipient scope.
create or replace function public.workshop_status_scope_allows(p_scope jsonb, p_country text, p_site text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(
    (p_country is null
       or coalesce((p_scope ->> 'super')::boolean, false)
       or coalesce((p_scope ->> 'all_countries')::boolean, false)
       or lower(btrim(p_country)) in (select jsonb_array_elements_text(coalesce(p_scope -> 'countries', '[]'::jsonb))))
    and
    (p_site is null or btrim(p_site) = ''
       or coalesce((p_scope ->> 'all_sites')::boolean, false)
       or upper(btrim(p_site)) in (select jsonb_array_elements_text(coalesce(p_scope -> 'sites', '[]'::jsonb)))),
    false)
$$;

-- The workshop decisions and data scope of ANOTHER user, answered by the real
-- decision functions. The request JWT subject is set transaction-locally and
-- restored before returning (also on error, by the subtransaction rollback).
-- Internal: no client may call it.
create or replace function public.workshop_status_recipient_scope(p_uid uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_sub text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  v_claims text := coalesce(current_setting('request.jwt.claims', true), '');
  v jsonb;
begin
  if p_uid is null then return null; end if;
  begin
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
    v := jsonb_build_object(
      'user_id', p_uid,
      'view', coalesce(public.workshop_status_can('view'), false),
      'update', coalesce(public.workshop_status_can('update'), false),
      'assign', coalesce(public.workshop_status_can('assign'), false),
      'confirm', coalesce(public.workshop_status_can('confirm'), false),
      'view_removed', coalesce(public.workshop_status_can('view_removed'), false),
      'super', coalesce(public.is_super_admin(), false),
      'all_countries', coalesce(public.app_sees_all_countries(), false),
      'countries', to_jsonb(coalesce(public.app_country_scope(), '{}'::text[])),
      'all_sites', coalesce(public.app_sees_all_sites(), false),
      'sites', to_jsonb(coalesce(public.app_site_scope(), '{}'::text[])));
    perform set_config('request.jwt.claim.sub', v_sub, true);
    perform set_config('request.jwt.claims', v_claims, true);
  exception when others then
    v := null;
  end;
  return v;
end $$;

-- Every approved, unlocked profile of the organisation who may view Workshop
-- Status, with their scope. The pre-filter is a superset of who can pass
-- app_user_can('daily_ops:workshop', 'view'); the real check decides.
create or replace function public.workshop_status_notice_candidates(p_org uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p record;
  v_scope jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  for p in
    select pr.id
      from public.profiles pr
     where (pr.organisation_id = p_org or pr.org_id = p_org)
       and coalesce(pr.approved, false) and not coalesce(pr.locked, false)
       and (coalesce(pr.is_super_admin, false) or pr.role = 'Admin'
            or exists (select 1 from public.module_permissions mp
                        where mp.role = pr.role and mp.module_key = 'daily_ops:workshop' and mp.enabled)
            or exists (select 1 from public.user_access_grants g
                        where g.user_id = pr.id and g.module_key like 'daily_ops:workshop%' and g.effect = 'grant'))
     order by pr.id
  loop
    v_scope := public.workshop_status_recipient_scope(p.id);
    if v_scope is not null and coalesce((v_scope ->> 'view')::boolean, false) then
      v_out := v_out || jsonb_build_array(v_scope);
    end if;
  end loop;
  return v_out;
end $$;

-- One bell row + (when enabled and the person has a device) one push.
-- Dedupe is the caller's job (workshop_status_notices). Never raises.
create or replace function public.workshop_status_notice_send(
  p_org uuid, p_user uuid, p_kind text, p_title text, p_body text,
  p_entity_type text, p_entity_id uuid, p_link text)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  v_tokens jsonb := '[]'::jsonb;
  v_event bigint;
begin
  insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
  values (p_user, p_kind, p_title, p_body, p_entity_type, p_entity_id);

  if public.workshop_status_notify_config('workshop_status_push', 'true') <> 'false' then
    begin
      if to_regprocedure('public._user_push_tokens(uuid)') is not null then
        execute $q$select coalesce(jsonb_agg(jsonb_build_object('user_id', $1, 'push_token', t.tok)), '[]'::jsonb)
                     from public._user_push_tokens($1) as t(tok)$q$
          into v_tokens using p_user;
      else
        select coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'push_token', btrim(p.push_token))), '[]'::jsonb)
          into v_tokens
          from public.profiles p
         where p.id = p_user and nullif(btrim(p.push_token), '') is not null;
      end if;
      if jsonb_array_length(v_tokens) > 0 then
        insert into public.domain_events (event_type, entity_type, entity_id, organisation_id, payload, status, processed_at)
        values ('workshop_status.notice', coalesce(p_entity_type, 'workshop_status'), p_entity_id::text, p_org,
                jsonb_build_object('kind', p_kind, 'user_id', p_user), 'processed', clock_timestamp())
        returning id into v_event;
        insert into public.workflow_notifications
          (event_id, organisation_id, instance_id, event_type, payload, recipient_count, status)
        values (v_event, p_org, null, 'workshop_status.notice',
                jsonb_build_object(
                  'event_type', 'workshop_status.notice',
                  'entity_type', p_entity_type,
                  'entity_id', p_entity_id,
                  'link', p_link,
                  'push', jsonb_build_object('title', p_title, 'body', p_body),
                  'recipients', v_tokens),
                jsonb_array_length(v_tokens), 'pending');
      end if;
    exception when others then
      null; -- the bell row stands; a push failure never undoes it.
    end;
  end if;
  return true;
exception when others then
  return false;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Confirmed upload -> one notification per person for that upload.
-- p_details is the upload_confirmed event's details (record_ids lists).
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_notify_upload(p_upload_id uuid, p_details jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_up public.workshop_status_uploads%rowtype;
  v_new uuid[]; v_upd uuid[]; v_rem uuid[]; v_active uuid[];
  v_cands jsonb;
  c jsonb;
  v_uid uuid;
  v_mine text[]; v_mine_ids uuid[]; v_mine_new int; v_mine_chg int;
  v_un text[]; v_un_ids uuid[];
  v_rel text[]; v_rel_mine text[];
  v_kind text; v_title text; v_body text; v_parts text[];
  v_entity_type text; v_entity uuid; v_link text;
  v_sent int := 0;
begin
  if public.workshop_status_notify_config('workshop_status_notifications', 'true') = 'false' then
    return jsonb_build_object('sent', 0, 'disabled', true);
  end if;
  select * into v_up from public.workshop_status_uploads where id = p_upload_id;
  if not found or v_up.status <> 'confirmed' then return jsonb_build_object('sent', 0); end if;

  v_new := coalesce(array(select jsonb_array_elements_text(p_details -> 'record_ids' -> 'new'))::uuid[], '{}');
  v_upd := coalesce(array(select jsonb_array_elements_text(p_details -> 'record_ids' -> 'updated'))::uuid[], '{}');
  v_rem := coalesce(array(select jsonb_array_elements_text(p_details -> 'record_ids' -> 'removed'))::uuid[], '{}');
  v_active := v_new || v_upd
    || coalesce(array(select jsonb_array_elements_text(p_details -> 'record_ids' -> 'unchanged'))::uuid[], '{}');
  if cardinality(v_active) = 0 and cardinality(v_rem) = 0 then return jsonb_build_object('sent', 0); end if;

  v_cands := public.workshop_status_notice_candidates(v_up.organisation_id);

  for c in select e from jsonb_array_elements(v_cands) e loop
    v_uid := (c ->> 'user_id')::uuid;

    -- Vehicles this person is responsible for and may update.
    select coalesce(array_agg(r.asset_no order by r.asset_no), '{}'),
           coalesce(array_agg(r.id order by r.asset_no), '{}'),
           count(*) filter (where r.id = any (v_new))::int,
           count(*) filter (where r.id = any (v_upd))::int
      into v_mine, v_mine_ids, v_mine_new, v_mine_chg
      from public.workshop_status_records r
     where r.id = any (v_active) and r.current_active and r.deleted_at is null
       and r.responsible_user_id = v_uid
       and coalesce((c ->> 'update')::boolean, false)
       and public.workshop_status_scope_allows(c, r.country, r.site);

    -- Vehicles with nobody responsible, for people who may assign.
    select coalesce(array_agg(r.asset_no order by r.asset_no), '{}'),
           coalesce(array_agg(r.id order by r.asset_no), '{}')
      into v_un, v_un_ids
      from public.workshop_status_records r
     where r.id = any (v_active) and r.current_active and r.deleted_at is null
       and r.responsible_user_id is null
       and coalesce((c ->> 'assign')::boolean, false)
       and public.workshop_status_scope_allows(c, r.country, r.site);

    -- Released (left the file): named only to someone who may see released
    -- vehicles; the previous responsible person, or anyone who may assign.
    select coalesce(array_agg(r.asset_no order by r.asset_no), '{}'),
           coalesce(array_agg(r.asset_no order by r.asset_no)
                      filter (where r.previous_responsible_user_id = v_uid), '{}')
      into v_rel, v_rel_mine
      from public.workshop_status_records r
     where r.id = any (v_rem) and r.deleted_at is null
       and coalesce((c ->> 'view_removed')::boolean, false)
       and (r.previous_responsible_user_id = v_uid or coalesce((c ->> 'assign')::boolean, false))
       and public.workshop_status_scope_allows(c, r.country, r.site);

    if cardinality(v_mine) = 0 and cardinality(v_un) = 0 and cardinality(v_rel) = 0 then continue; end if;

    v_parts := '{}';
    if cardinality(v_mine) > 0 then
      v_kind := 'workshop_status_upload_mine';
      v_title := 'Workshop report ' || coalesce(v_up.country, '') || ': ' || cardinality(v_mine)
                 || case when cardinality(v_mine) = 1 then ' vehicle needs your update today'
                         else ' vehicles need your update today' end;
      v_parts := v_parts || ('Assigned to you: ' || public.workshop_status_asset_list(v_mine)
        || case when v_mine_new + v_mine_chg > 0
                then ' (' || concat_ws(', ',
                       case when v_mine_new > 0 then v_mine_new || ' new' end,
                       case when v_mine_chg > 0 then v_mine_chg || ' changed' end) || ')'
                else '' end || '.');
    elsif cardinality(v_un) > 0 then
      v_kind := 'workshop_status_upload_unassigned';
      v_title := 'Workshop report ' || coalesce(v_up.country, '') || ': ' || cardinality(v_un)
                 || case when cardinality(v_un) = 1 then ' vehicle has no responsible person'
                         else ' vehicles have no responsible person' end;
    else
      v_kind := 'workshop_status_upload_released';
      v_title := 'Workshop report ' || coalesce(v_up.country, '') || ': ' || cardinality(v_rel)
                 || case when cardinality(v_rel) = 1 then ' vehicle released' else ' vehicles released' end;
    end if;
    if cardinality(v_un) > 0 then
      v_parts := v_parts || ('No responsible person: ' || public.workshop_status_asset_list(v_un) || '.');
    end if;
    if cardinality(v_rel) > 0 then
      v_parts := v_parts || ('Released from the daily file: '
        || public.workshop_status_asset_list(case when cardinality(v_rel_mine) > 0 then v_rel_mine else v_rel end) || '.');
    end if;
    v_body := array_to_string(v_parts, ' ');

    -- Deep link: the exact vehicle when there is one, else the filtered list.
    if v_kind = 'workshop_status_upload_mine' and cardinality(v_mine_ids) = 1 then
      v_entity_type := 'workshop_status_record'; v_entity := v_mine_ids[1];
      v_link := '/daily-ops/workshop?record=' || v_mine_ids[1]::text;
    elsif v_kind = 'workshop_status_upload_unassigned' and cardinality(v_un_ids) = 1 then
      v_entity_type := 'workshop_status_record'; v_entity := v_un_ids[1];
      v_link := '/daily-ops/workshop?record=' || v_un_ids[1]::text;
    else
      v_entity_type := 'workshop_status_upload'; v_entity := v_up.id;
      v_link := case v_kind
        when 'workshop_status_upload_mine' then '/daily-ops/workshop?focus=mine'
        when 'workshop_status_upload_unassigned' then '/daily-ops/workshop?focus=unassigned'
        else '/daily-ops/workshop?tab=removed' end;
    end if;

    -- One notice per person per upload. The ledger rows and the bell row
    -- commit together: when the send fails the subtransaction rolls the
    -- ledger back too, so a later run can still tell this person.
    begin
      insert into public.workshop_status_notices (organisation_id, user_id, kind, subject_id, period)
      values (v_up.organisation_id, v_uid, 'workshop_status_upload', v_up.id, 'upload')
      on conflict do nothing;
      if found then
        -- The assigners were just told about these unassigned vehicles: the
        -- scan must not tell them again.
        insert into public.workshop_status_notices (organisation_id, user_id, kind, subject_id, period)
        select v_up.organisation_id, v_uid, 'workshop_status_no_responsible', x, 'once' from unnest(v_un_ids) x
        on conflict do nothing;
        if not public.workshop_status_notice_send(v_up.organisation_id, v_uid, v_kind, v_title, v_body,
                                                  v_entity_type, v_entity, v_link) then
          raise exception 'workshop notice not delivered';
        end if;
        v_sent := v_sent + 1;
      end if;
    exception when others then
      null;
    end;
  end loop;
  return jsonb_build_object('sent', v_sent);
end $$;

create or replace function public.workshop_status_notify_upload_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.workshop_status_notify_upload(NEW.upload_id, NEW.details);
  exception when others then
    null; -- a notification problem must never undo the confirmed upload.
  end;
  return null;
end $$;

drop trigger if exists trg_workshop_status_notify_upload on public.workshop_status_events;
create trigger trg_workshop_status_notify_upload
  after insert on public.workshop_status_events
  for each row when (NEW.event_type = 'upload_confirmed')
  execute function public.workshop_status_notify_upload_trg();

-- ---------------------------------------------------------------------------
-- 4. Threshold scan (pg_cron, hourly). Returns the number of notifications sent.
-- p_now is injectable for tests.
-- ---------------------------------------------------------------------------
create or replace function public.workshop_status_notify_scan(p_now timestamptz default now())
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_tz text := public.workshop_status_notify_config('workshop_status_timezone', 'Asia/Riyadh');
  v_wait int; v_eta int; v_deadline int;
  v_local timestamp; v_today date; v_hour int;
  v_org uuid;
  v_cands jsonb;
  v_new jsonb;
  g record;
  v_title text; v_body text; v_link text; v_entity_type text; v_entity uuid;
  v_sent int := 0;
begin
  if public.workshop_status_notify_config('workshop_status_notifications', 'true') = 'false' then
    return jsonb_build_object('sent', 0, 'disabled', true);
  end if;
  begin v_wait := public.workshop_status_notify_config('workshop_status_wait_days', '7')::int;
  exception when others then v_wait := 7; end;
  begin v_eta := public.workshop_status_notify_config('workshop_status_eta_days', '3')::int;
  exception when others then v_eta := 3; end;
  begin v_deadline := public.workshop_status_notify_config('workshop_status_update_deadline_hour', '10')::int;
  exception when others then v_deadline := 10; end;
  begin v_local := p_now at time zone v_tz;
  exception when others then v_tz := 'Asia/Riyadh'; v_local := p_now at time zone v_tz; end;
  v_today := v_local::date;
  v_hour := extract(hour from v_local)::int;

  for v_org in
    select distinct organisation_id from public.workshop_status_records
     where current_active and deleted_at is null
    union
    select distinct organisation_id from public.workshop_status_uploads
     where status = 'previewed' and uploaded_at < p_now - interval '30 minutes'
  loop
    v_cands := public.workshop_status_notice_candidates(v_org);
    if jsonb_array_length(v_cands) = 0 then continue; end if;

    with cand as (
      select (e ->> 'user_id')::uuid as uid, e as scope from jsonb_array_elements(v_cands) e
    ),
    recs as (
      select r.*,
             coalesce(
               case when r.ooc_since is not null and r.ooc_since <= v_today then v_today - r.ooc_since end,
               case when r.excel_down_days >= 0 then r.excel_down_days end,
               v_today - (r.first_seen_at at time zone v_tz)::date) as days_down,
             public.workshop_status_wait_category(r.current_stage, r.delay_reason) as wait_cat
        from public.workshop_status_records r
       where r.organisation_id = v_org and r.current_active and r.deleted_at is null
    ),
    conds as (
      -- (record, kind, period, audience)
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_update_missing' as kind,
             v_today::text as period, 'responsible' as audience
        from recs
       where v_hour >= v_deadline
         and (last_manual_update_at is null or (last_manual_update_at at time zone v_tz)::date < v_today)
      union all
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_waiting_long', 'once', 'responsible'
        from recs where wait_cat is not null and days_down >= v_wait
      union all
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_long_down', 'once', 'responsible'
        from recs where wait_cat is null and days_down >= v_wait
      union all
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_release_today', v_today::text, 'responsible'
        from recs where expected_release_date = v_today
      union all
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_release_overdue',
             expected_release_date::text, 'responsible'
        from recs where expected_release_date < v_today
      union all
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_no_responsible', 'once', 'assigners'
        from recs where responsible_user_id is null
      union all
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_missing_eta', 'once', 'responsible'
        from recs where expected_release_date is null and nullif(btrim(coalesce(excel_expected_release, '')), '') is null
                    and days_down >= v_eta
      union all
      select id, asset_no, country, site, responsible_user_id, 'workshop_status_ready_release', 'once', 'assigners'
        from recs where current_stage = 'Ready for Release'
    ),
    -- Is the responsible person a valid recipient for this record?
    owner_ok as (
      select cd.*, exists (select 1 from cand x where x.uid = cd.responsible_user_id
                            and public.workshop_status_scope_allows(x.scope, cd.country, cd.site)) as owner_sees
        from conds cd
    ),
    targets as (
      select o.id as subject_id, o.asset_no, o.kind, o.period, o.responsible_user_id as uid
        from owner_ok o where o.audience = 'responsible' and o.owner_sees
      union
      select o.id, o.asset_no, o.kind, o.period, x.uid
        from owner_ok o join cand x
          on coalesce((x.scope ->> 'assign')::boolean, false)
         and public.workshop_status_scope_allows(x.scope, o.country, o.site)
       where o.audience = 'assigners' or not o.owner_sees
      union
      -- Uploads previewed but not confirmed: people who may confirm that country.
      select u.id, null, 'workshop_status_upload_review', 'once', x.uid
        from public.workshop_status_uploads u join cand x
          on coalesce((x.scope ->> 'confirm')::boolean, false)
         and public.workshop_status_scope_allows(x.scope, u.country, null)
       where u.organisation_id = v_org and u.status = 'previewed'
         and u.uploaded_at < p_now - interval '30 minutes'
    ),
    ins as (
      insert into public.workshop_status_notices (organisation_id, user_id, kind, subject_id, period)
      select v_org, t.uid, t.kind, t.subject_id, t.period from targets t
      on conflict do nothing
      returning user_id, kind, subject_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'user_id', g2.user_id, 'kind', g2.kind, 'ids', g2.ids, 'assets', g2.assets)), '[]'::jsonb)
      into v_new
      from (
        select ins.user_id, ins.kind,
               to_jsonb(array_agg(ins.subject_id order by t.asset_no nulls last, ins.subject_id)) as ids,
               to_jsonb(array_remove(array_agg(distinct t.asset_no), null)) as assets
          from ins
          join (select distinct subject_id, kind, asset_no from targets) t
            on t.subject_id = ins.subject_id and t.kind = ins.kind
         group by ins.user_id, ins.kind
      ) g2;

    for g in
      select (e ->> 'user_id')::uuid as uid, e ->> 'kind' as kind,
             array(select jsonb_array_elements_text(e -> 'ids'))::uuid[] as ids,
             array(select jsonb_array_elements_text(e -> 'assets') order by 1) as assets
        from jsonb_array_elements(v_new) e
    loop
      v_title := case g.kind
        when 'workshop_status_upload_review' then 'Workshop upload waiting for confirmation'
        when 'workshop_status_update_missing' then cardinality(g.ids) || ' workshop '
             || case when cardinality(g.ids) = 1 then 'vehicle has' else 'vehicles have' end || ' no update today'
        when 'workshop_status_waiting_long' then cardinality(g.ids) || ' '
             || case when cardinality(g.ids) = 1 then 'vehicle' else 'vehicles' end
             || ' waiting for parts, manpower or approval for ' || v_wait || '+ days'
        when 'workshop_status_long_down' then cardinality(g.ids) || ' '
             || case when cardinality(g.ids) = 1 then 'vehicle' else 'vehicles' end
             || ' down for ' || v_wait || '+ days'
        when 'workshop_status_release_today' then cardinality(g.ids) || ' '
             || case when cardinality(g.ids) = 1 then 'vehicle' else 'vehicles' end || ' expected to be released today'
        when 'workshop_status_release_overdue' then cardinality(g.ids) || ' '
             || case when cardinality(g.ids) = 1 then 'vehicle is' else 'vehicles are' end || ' past the expected release date'
        when 'workshop_status_no_responsible' then cardinality(g.ids) || ' '
             || case when cardinality(g.ids) = 1 then 'vehicle has' else 'vehicles have' end || ' no responsible person'
        when 'workshop_status_missing_eta' then cardinality(g.ids) || ' '
             || case when cardinality(g.ids) = 1 then 'vehicle has' else 'vehicles have' end || ' no expected release date'
        when 'workshop_status_ready_release' then cardinality(g.ids) || ' '
             || case when cardinality(g.ids) = 1 then 'vehicle is' else 'vehicles are' end || ' ready for release'
        else 'Workshop Status' end;
      v_body := case g.kind
        when 'workshop_status_upload_review' then
          'A daily workshop upload was previewed but not confirmed. Review it and confirm or cancel.'
        when 'workshop_status_update_missing' then
          'Update today: ' || public.workshop_status_asset_list(g.assets) || '.'
        else public.workshop_status_asset_list(g.assets) || '.' end;

      if g.kind = 'workshop_status_upload_review' then
        v_entity_type := 'workshop_status_upload'; v_entity := g.ids[1];
        v_link := '/daily-ops/workshop?tab=upload';
      elsif cardinality(g.ids) = 1 then
        v_entity_type := 'workshop_status_record'; v_entity := g.ids[1];
        v_link := '/daily-ops/workshop?record=' || g.ids[1]::text;
      else
        v_entity_type := 'workshop_status'; v_entity := null;
        v_link := '/daily-ops/workshop?focus=' || case g.kind
          when 'workshop_status_update_missing' then 'not_today'
          when 'workshop_status_waiting_long' then 'over7'
          when 'workshop_status_long_down' then 'over7'
          when 'workshop_status_release_today' then 'expected_today'
          when 'workshop_status_no_responsible' then 'unassigned'
          when 'workshop_status_ready_release' then 'ready'
          else 'mine' end;
      end if;

      if public.workshop_status_notice_send(v_org, g.uid, g.kind, v_title, v_body, v_entity_type, v_entity, v_link) then
        v_sent := v_sent + 1;
      else
        -- Not delivered: forget it so the next run tries again.
        delete from public.workshop_status_notices
         where organisation_id = v_org and user_id = g.uid and kind = g.kind and subject_id = any (g.ids)
           and created_at = now(); -- rows written by this transaction only
      end if;
    end loop;
  end loop;

  -- Keep the ledger small: 90 days covers every period above ('once' notices
  -- older than that belong to vehicles long gone from the report).
  -- Measured on the real clock (p_now is a test override).
  delete from public.workshop_status_notices where created_at < now() - interval '90 days' and period <> 'once';

  return jsonb_build_object('sent', v_sent);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Privileges. Every function here is internal (trigger, cron, or called by
-- another SECURITY DEFINER function): no client may execute any of them. The
-- scan runs as the cron owner. Trigger functions get no grants.
-- ---------------------------------------------------------------------------
revoke all on function public.workshop_status_notify_config(text, text) from public, anon, authenticated;
revoke all on function public.workshop_status_wait_category(text, text) from public, anon, authenticated;
revoke all on function public.workshop_status_asset_list(text[]) from public, anon, authenticated;
revoke all on function public.workshop_status_scope_allows(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.workshop_status_recipient_scope(uuid) from public, anon, authenticated;
revoke all on function public.workshop_status_notice_candidates(uuid) from public, anon, authenticated;
revoke all on function public.workshop_status_notice_send(uuid, uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.workshop_status_notify_upload(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.workshop_status_notify_upload_trg() from public, anon, authenticated;
revoke all on function public.workshop_status_notify_scan(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Schedule (skipped where pg_cron is not installed, e.g. the test harness).
-- Hourly at :20; the dedupe ledger keeps every notice to once per period.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('cron.job') is not null then
    perform cron.schedule('workshop-status-notify', '20 * * * *',
      $c$select public.workshop_status_notify_scan()$c$);
  end if;
end $$;
