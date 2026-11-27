-- Driver Concerns (employee grievance), part 2 of 2: the cases, their record,
-- the ladder, deadlines, translations, photos and notifications.
--
-- STATUS: AUTHORED, NOT APPLIED. Apply only on the owner's explicit yes, AFTER
-- 20261127190000_driver_concerns_roles.sql. Verified only as a rolled-back dry
-- run (a single DO block ending in RAISE EXCEPTION) impersonating a real Driver
-- and a real Fleet Supervisor.
--
-- THE FLOW (owner decision 2026-11-27)
--   driver raises (phone) -> Fleet Supervisor pool (Supervisor / Foreman) ->
--   Fleet Incharge -> Manager approves the solution -> the driver sees the
--   outcome in their own language, must confirm "I have seen this", then signs
--   Accept or Not accepted. Not accepted moves the case up one level; at the top
--   it closes as not accepted. Every outcome event records that the driver keeps
--   the right to take the matter to the labour office. Nobody is ever forced.
--
-- SENSITIVE CASES are decided SERVER-side: category 'treatment' (supervisor
-- conduct, harassment / abuse, discrimination, threats) is ALWAYS sensitive, set
-- by the BEFORE INSERT trigger whatever the client sent. A sensitive case is
-- hidden from every pool role (Fleet Supervisor / Foreman / Incharge) and routed
-- to HR; it is visible to HR Officer, Manager, Admin and super admin only.
-- Nobody can lower sensitivity (guard trigger). A handler may RECLASSIFY a case
-- TO sensitive (logged, moves the case to HR). The person named as the subject
-- of a concern (subject_user_id) never sees it and is never notified.
--
-- OBJECTS
--   driver_concerns            one row per case. Clients get SELECT only; every
--                              write is a SECURITY DEFINER RPC below.
--   driver_concern_events      append-only timeline, sha256 chain (prev_hash ->
--                              hash). BEFORE UPDATE/DELETE guard refuses any
--                              change except the retention purge.
--   driver_concern_translations machine translations; original text is never
--                              overwritten. Labelled "machine translation" in UI.
--   driver_concern_reads       who opened a SENSITIVE case, and when.
--   driver_concern_counters    DC-YYYY-#### minted on INSERT (V594 pattern: an
--                              abandoned form never burns a number).
--   driver_concern_notices     dedupe for overdue escalation notices.
--   bucket driver-concerns     private; path <org>/<uploader uid>/<client uuid>/<file>.
--
-- RPCs (all DEFINER, pinned search_path, re-check org / visibility / role in body)
--   driver_concern_raise, driver_concern_command (the one writer) and thin named
--   wrappers: _acknowledge _assign _note _escalate _propose _approve _return
--   _view_outcome _sign _withdraw _reopen _reclassify _link, plus
--   driver_concern_get (logs sensitive reads), driver_concern_add_translation,
--   driver_concern_set_pdf, driver_concern_escalation_scan (cron, commented),
--   driver_concern_purge_closed (written, NOT scheduled).
--   Stale write (version mismatch) and already-decided cases raise PT409, never
--   40001 (PostgREST retries 40001 forever: the 2026-09-26 incident).
--
-- NOTIFICATIONS: in-app + pre-rendered push through workflow_notifications (no
-- edge redeploy). Text is GENERIC ("New driver concern DC-2026-0001"), never the
-- category or the driver's words. Sensitive cases notify HR (and managers on
-- overdue) only.
--
-- NO DROP / DELETE STATEMENTS outside function bodies (MCP approval timeout).
--
-- VERIFY (after apply)
--   select count(*) from pg_class where relname like 'driver_concern%' and relrowsecurity; -- 6
--   select has_function_privilege('anon','public.driver_concern_raise(text,text,text,text,jsonb,uuid,uuid,boolean,boolean,uuid)','EXECUTE'); -- f
--   -- as the Driver: raise one 'pay' and one 'treatment' case, then as the Fleet
--   -- Supervisor: select count(*) ... where sensitive  -> 0
--
-- ROLLBACK (manual, SQL editor): drop the functions listed above, then
--   drop table driver_concern_reads, driver_concern_translations,
--   driver_concern_notices, driver_concern_events, driver_concerns,
--   driver_concern_counters; delete the storage policies driver_concern_photos_*;
--   remove bucket 'driver-concerns' once empty.

begin;

-- ---------------------------------------------------------------------------
-- 0. Vocabulary helpers (mirrored in src/lib/driverConcerns.js - change both)
-- ---------------------------------------------------------------------------
create or replace function private.dc_valid_subtype(p_cat text, p_sub text)
returns boolean language sql immutable set search_path = public as $$
  select case p_cat
    when 'pay'       then p_sub in ('salary_late','salary_short','overtime_unpaid','wrong_deduction','allowance_missing','final_settlement')
    when 'housing'   then p_sub in ('accommodation','food','transport','utilities')
    when 'leave'     then p_sub in ('annual_leave','ticket','emergency_leave','sick_leave')
    when 'documents' then p_sub in ('iqama_expiry','licence_renewal','passport_held','contract_visa','medical_card')
    when 'work'      then p_sub in ('excess_hours','roster','route','workload')
    when 'safety'    then p_sub in ('unsafe_vehicle','unsafe_site','injury','ppe')
    when 'treatment' then p_sub in ('supervisor_conduct','harassment','discrimination','threats')
    when 'other'     then p_sub in ('other')
    else false end
$$;

create or replace function private.dc_level_rank(p_level text)
returns integer language sql immutable set search_path = public as $$
  select case p_level when 'supervisor' then 1 when 'incharge' then 2
                      when 'hr' then 2 when 'manager' then 3 else 99 end
$$;

-- The next rung. Sensitive cases never pass through the pool rungs.
create or replace function private.dc_next_level(p_level text, p_sensitive boolean)
returns text language sql immutable set search_path = public as $$
  select case
    when p_sensitive and p_level = 'hr' then 'manager'
    when p_sensitive then null
    when p_level = 'supervisor' then 'incharge'
    when p_level = 'incharge'   then 'manager'
    else null end
$$;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.driver_concern_counters (
  organisation_id uuid    not null,
  yr              integer not null,
  last_no         integer not null default 0,
  primary key (organisation_id, yr)
);
alter table public.driver_concern_counters enable row level security; -- deny-all

create table if not exists public.driver_concerns (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null,
  case_no               text unique,
  driver_id             uuid not null references public.drivers(id),
  raised_by             uuid default auth.uid(),
  logged_on_behalf_by   uuid,
  entered_verbally      boolean not null default false,
  subject_user_id       uuid,
  category              text not null check (category in ('pay','housing','leave','documents','work','safety','treatment','other')),
  subtype               text not null,
  sensitive             boolean not null default false,
  original_text         text not null check (char_length(btrim(original_text)) between 1 and 4000),
  original_lang         text check (original_lang in ('en','ar','ur','hi','bn','ps','ne','tl')),
  photos                jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 6),
  country               text,
  site                  text,
  level                 text not null default 'supervisor' check (level in ('supervisor','incharge','manager','hr')),
  status                text not null default 'open'
                        check (status in ('open','in_review','proposed','outcome_shared','accepted','not_accepted','withdrawn','closed')),
  assigned_to           uuid,
  ack_due_at            timestamptz,
  due_at                timestamptz,
  acknowledged_at       timestamptz,
  escalation_count      integer not null default 0,
  proposed_solution     text,
  proposed_lang         text,
  proposed_by           uuid,
  proposed_at           timestamptz,
  approved_by           uuid,
  approved_at           timestamptz,
  outcome_text          text,
  outcome_lang          text,
  outcome_seen_at       timestamptz,
  driver_decision       text check (driver_decision in ('accepted','not_accepted')),
  driver_decision_note  text,
  driver_signature      text check (driver_signature is null or char_length(driver_signature) <= 600000),
  signed_at             timestamptz,
  signed_in_person_by   uuid,
  closed_at             timestamptz,
  reopen_deadline       timestamptz,
  reopened_count        integer not null default 0,
  linked_to             uuid references public.driver_concerns(id),
  duplicate_of          uuid references public.driver_concerns(id),
  pdf_path              text,
  pdf_sha256            text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  client_uuid           uuid unique,
  version               integer not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint driver_concerns_subtype_ok check (private.dc_valid_subtype(category, subtype)),
  constraint driver_concerns_treatment_sensitive check (category <> 'treatment' or sensitive),
  constraint driver_concerns_sensitive_level check (not sensitive or level in ('hr','manager'))
);
create index if not exists driver_concerns_org_status_idx on public.driver_concerns (organisation_id, status, due_at);
create index if not exists driver_concerns_driver_idx on public.driver_concerns (driver_id, created_at desc);
create index if not exists driver_concerns_closed_idx on public.driver_concerns (closed_at) where closed_at is not null;

create table if not exists public.driver_concern_events (
  id                bigserial primary key,
  concern_id        uuid not null references public.driver_concerns(id),
  organisation_id   uuid not null,
  seq               integer not null,
  event_type        text not null,
  actor             uuid default auth.uid(),
  actor_role        text,
  from_status       text,
  to_status         text,
  level             text,
  note              text check (note is null or char_length(note) <= 4000),
  note_lang         text,
  visible_to_driver boolean not null default true,
  payload           jsonb not null default '{}'::jsonb,
  prev_hash         text,
  hash              text not null,
  created_at        timestamptz not null default now(),
  unique (concern_id, seq)
);

create table if not exists public.driver_concern_translations (
  id            uuid primary key default gen_random_uuid(),
  concern_id    uuid not null references public.driver_concerns(id),
  source        text not null check (source in ('concern','event','proposal','outcome')),
  source_id     text not null default '',
  target_lang   text not null check (target_lang in ('en','ar','ur','hi','bn','ps','ne','tl')),
  text          text not null check (char_length(text) <= 8000),
  model         text not null,
  model_version text,
  generated_at  timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  unique (concern_id, source, source_id, target_lang)
);

create table if not exists public.driver_concern_reads (
  id         bigserial primary key,
  concern_id uuid not null references public.driver_concerns(id),
  user_id    uuid not null,
  read_at    timestamptz not null default now()
);
create index if not exists driver_concern_reads_idx on public.driver_concern_reads (concern_id, read_at desc);

create table if not exists public.driver_concern_notices (
  concern_id uuid not null references public.driver_concerns(id),
  level      text not null,
  kind       text not null,
  sent_at    timestamptz not null default now(),
  primary key (concern_id, level, kind)
);

-- ---------------------------------------------------------------------------
-- 2. Who may see / act
-- ---------------------------------------------------------------------------
-- A concern_handlers row covering this level and place.
create or replace function private.dc_has_handler_row(p_levels text[], p_country text, p_site text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.concern_handlers h
     where h.user_id = auth.uid() and h.active
       and h.organisation_id = public.app_current_org()
       and h.level = any(p_levels)
       and (h.country is null or p_country is null or upper(h.country) = upper(p_country))
       and (h.site    is null or p_site    is null or upper(h.site)    = upper(p_site)))
$$;

-- The caller's rank for a case at this place. 0 = not a handler.
--   1 Fleet Supervisor / Fleet Foreman    2 Fleet Incharge
--   2 HR Officer (sensitive only)         3 Manager / Director / Admin / super
create or replace function private.dc_my_rank(p_sensitive boolean, p_country text, p_site text)
returns integer language plpgsql stable security definer set search_path = public as $$
declare r text := public.app_role(); v int := 0;
begin
  if auth.uid() is null or not public.is_approved_and_unlocked() then return 0; end if;
  if public.is_super_admin() then return 3; end if;
  if r in ('manager','director','admin')
     or private.dc_has_handler_row(array['manager'], p_country, p_site) then
    v := 3;
  elsif p_sensitive then
    if r = 'hr_officer' or private.dc_has_handler_row(array['hr'], p_country, p_site) then v := 2; end if;
    return v; -- pool roles never act on a sensitive case
  elsif r = 'fleet_incharge' or private.dc_has_handler_row(array['incharge'], p_country, p_site) then
    v := 2;
  elsif r in ('fleet_supervisor','fleet_foreman') or private.dc_has_handler_row(array['supervisor'], p_country, p_site) then
    v := 1;
  end if;
  if v > 0 and v < 3 then
    if public.app_can_see_country(p_country) is false or public.app_can_see_site(p_site) is false then
      return 0;
    end if;
  end if;
  return v;
end $$;

create or replace function private.dc_visible(p_org uuid, p_driver uuid, p_sensitive boolean,
                                              p_country text, p_site text, p_subject uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text;
begin
  if auth.uid() is null then return false; end if;
  if public.is_super_admin() then return true; end if;
  if p_subject is not null and p_subject = auth.uid() then return false; end if;
  if p_org is distinct from public.app_current_org() then return false; end if;
  if not public.is_approved_and_unlocked() then return false; end if;
  if p_driver = any(public.app_my_driver_ids()) then return true; end if;
  r := public.app_role();
  if p_sensitive then
    return r in ('hr_officer','manager','admin')
        or private.dc_has_handler_row(array['hr','manager'], p_country, p_site);
  end if;
  if r = 'hr_officer' or private.dc_my_rank(false, p_country, p_site) > 0 then
    return public.app_can_see_country(p_country) is not false
       and public.app_can_see_site(p_site) is not false;
  end if;
  return false;
end $$;

create or replace function private.dc_is_my_driver(p_driver uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_driver = any(public.app_my_driver_ids())
$$;

-- ---------------------------------------------------------------------------
-- 3. Triggers: case number, sensitivity, append-only events
-- ---------------------------------------------------------------------------
create or replace function private.dc_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_no int; v_yr int := extract(year from now())::int;
begin
  -- Server decides sensitivity: treatment is always sensitive.
  new.sensitive := coalesce(new.sensitive, false) or new.category = 'treatment';
  if new.sensitive then new.level := 'hr'; end if;
  insert into public.driver_concern_counters (organisation_id, yr, last_no)
  values (new.organisation_id, v_yr, 1)
  on conflict (organisation_id, yr) do update set last_no = public.driver_concern_counters.last_no + 1
  returning last_no into v_no;
  new.case_no := 'DC-' || v_yr || '-' || lpad(v_no::text, 4, '0');
  return new;
end $$;

create or replace function private.dc_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.sensitive and not new.sensitive then
    raise exception using errcode = '42501', message = 'A sensitive concern cannot be made non-sensitive';
  end if;
  if old.category = 'treatment' and new.category <> 'treatment' then
    raise exception using errcode = '42501', message = 'A treatment concern cannot change category';
  end if;
  if new.case_no is distinct from old.case_no or new.driver_id is distinct from old.driver_id
     or new.original_text is distinct from old.original_text or new.organisation_id is distinct from old.organisation_id then
    raise exception using errcode = '42501', message = 'The original concern cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger trg_dc_before_insert before insert on public.driver_concerns
  for each row execute function private.dc_before_insert();
create trigger trg_dc_before_update before update on public.driver_concerns
  for each row execute function private.dc_before_update();

create or replace function private.dc_event_chain()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_prev text; v_seq int;
begin
  select e.hash, e.seq into v_prev, v_seq from public.driver_concern_events e
   where e.concern_id = new.concern_id order by e.seq desc limit 1;
  new.seq := coalesce(v_seq, 0) + 1;
  new.prev_hash := v_prev;
  new.created_at := now();
  new.hash := encode(extensions.digest(
      coalesce(v_prev, '') || '|' || new.concern_id || '|' || new.seq || '|' || new.event_type || '|' ||
      coalesce(new.actor::text, '') || '|' || coalesce(new.to_status, '') || '|' ||
      coalesce(new.note, '') || '|' || new.payload::text || '|' || new.created_at::text,
      'sha256'), 'hex');
  return new;
end $$;

create or replace function private.dc_event_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and current_setting('dc.purge', true) = 'on' then return old; end if;
  raise exception using errcode = '42501', message = 'Concern history is append-only';
end $$;

create trigger trg_dc_event_chain before insert on public.driver_concern_events
  for each row execute function private.dc_event_chain();
create trigger trg_dc_event_guard before update or delete on public.driver_concern_events
  for each row execute function private.dc_event_guard();

-- ---------------------------------------------------------------------------
-- 4. RLS: SELECT only for clients
-- ---------------------------------------------------------------------------
alter table public.driver_concerns enable row level security;
alter table public.driver_concern_events enable row level security;
alter table public.driver_concern_translations enable row level security;
alter table public.driver_concern_reads enable row level security;
alter table public.driver_concern_notices enable row level security; -- deny-all

create policy driver_concerns_read on public.driver_concerns for select to authenticated
  using (private.dc_visible(organisation_id, driver_id, sensitive, country, site, subject_user_id));

create policy driver_concern_events_read on public.driver_concern_events for select to authenticated
  using (exists (select 1 from public.driver_concerns c
                  where c.id = concern_id
                    and private.dc_visible(c.organisation_id, c.driver_id, c.sensitive, c.country, c.site, c.subject_user_id)
                    and (visible_to_driver or not private.dc_is_my_driver(c.driver_id))));

create policy driver_concern_translations_read on public.driver_concern_translations for select to authenticated
  using (exists (select 1 from public.driver_concerns c
                  where c.id = concern_id
                    and private.dc_visible(c.organisation_id, c.driver_id, c.sensitive, c.country, c.site, c.subject_user_id)));

create policy driver_concern_reads_read on public.driver_concern_reads for select to authenticated
  using ((select public.is_super_admin()) or (select public.app_role()) in ('admin','manager','hr_officer'));

revoke all on public.driver_concerns, public.driver_concern_events, public.driver_concern_translations,
              public.driver_concern_reads, public.driver_concern_notices, public.driver_concern_counters
  from anon, authenticated;
grant select on public.driver_concerns, public.driver_concern_events,
                public.driver_concern_translations, public.driver_concern_reads to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Settings, recipients, notifications
-- ---------------------------------------------------------------------------
create or replace function private.dc_sla_hours(p_org uuid, p_key text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select (s.sla ->> p_key)::int from public.driver_concern_settings s where s.organisation_id = p_org),
                  case p_key when 'ack' then 24 when 'hr_ack' then 24 when 'supervisor' then 72
                             when 'incharge' then 72 when 'manager' then 120 when 'hr' then 72
                             when 'pay' then 48 when 'safety' then 48 else 72 end)
$$;

-- Sets ack_due_at / due_at for the case entering p_level now.
create or replace function private.dc_set_deadlines(p_id uuid, p_level text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.driver_concerns%rowtype; v_h int;
begin
  select * into c from public.driver_concerns where id = p_id;
  v_h := private.dc_sla_hours(c.organisation_id, p_level);
  if c.category = 'pay' then v_h := least(v_h, private.dc_sla_hours(c.organisation_id, 'pay')); end if;
  if c.category = 'safety' then v_h := least(v_h, private.dc_sla_hours(c.organisation_id, 'safety')); end if;
  update public.driver_concerns
     set ack_due_at = now() + make_interval(hours => private.dc_sla_hours(c.organisation_id,
                              case when p_level = 'hr' then 'hr_ack' else 'ack' end)),
         due_at = now() + make_interval(hours => v_h),
         acknowledged_at = null
   where id = p_id;
end $$;

create or replace function private.dc_recipients(p_id uuid, p_target text)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare c public.driver_concerns%rowtype; v uuid[];
begin
  select * into c from public.driver_concerns where id = p_id;
  if p_target = 'driver' then
    select coalesce(array_agg(l.user_id), '{}') into v from public.driver_account_links l
     where l.driver_id = c.driver_id and l.organisation_id = c.organisation_id;
    return v;
  end if;
  select coalesce(array_agg(distinct p.id), '{}') into v
    from public.profiles p
   where p.org_id = c.organisation_id
     and coalesce(p.approved, true) and not coalesce(p.locked, false)
     and p.id is distinct from c.subject_user_id
     and (
       (p_target = 'supervisor' and not c.sensitive and lower(replace(p.role,' ','_')) in ('fleet_supervisor','fleet_foreman'))
       or (p_target = 'incharge' and not c.sensitive and lower(replace(p.role,' ','_')) = 'fleet_incharge')
       or (p_target = 'manager'  and lower(replace(p.role,' ','_')) = 'manager')
       or (p_target = 'hr'       and lower(replace(p.role,' ','_')) = 'hr_officer')
       or exists (select 1 from public.concern_handlers h
                   where h.user_id = p.id and h.active and h.organisation_id = c.organisation_id
                     and h.level = p_target
                     and (not c.sensitive or h.level in ('hr','manager'))
                     and (h.country is null or c.country is null or upper(h.country) = upper(c.country))
                     and (h.site is null or c.site is null or upper(h.site) = upper(c.site))))
     and (c.country is null or p.country is null or cardinality(p.country) = 0 or c.country = any(p.country))
     and (c.site is null or p.sites is null or 'ALL' = any(p.sites) or '*' = any(p.sites) or upper(c.site) = any(p.sites));
  return v;
end $$;

-- Generic text only. Never the category, never the driver's words.
create or replace function private.dc_notify(p_id uuid, p_kind text, p_users uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare c public.driver_concerns%rowtype; v_lang text; v_rec jsonb; v_event bigint; v_title text; v_body text; n int := 0;
begin
  if p_users is null or cardinality(p_users) = 0 then return 0; end if;
  select * into c from public.driver_concerns where id = p_id;
  insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
  select u, 'driver_concern',
         case p_kind when 'new' then 'New driver concern ' || c.case_no
                     when 'outcome' then 'Your concern ' || c.case_no || ' has an answer'
                     when 'overdue' then 'Driver concern ' || c.case_no || ' is overdue'
                     else 'Driver concern ' || c.case_no || ' was updated' end,
         'Open Tyre Pulse to view it.', 'driver_concern', c.id
    from unnest(p_users) u;
  get diagnostics n = row_count;

  for v_lang in select distinct case when p.language = 'ar' then 'ar' else 'en' end
                  from public.profiles p where p.id = any(p_users) loop
    select jsonb_agg(jsonb_build_object('user_id', p.id, 'push_token', t.tok)) into v_rec
      from public.profiles p cross join lateral public._user_push_tokens(p.id) t(tok)
     where p.id = any(p_users) and (case when p.language = 'ar' then 'ar' else 'en' end) = v_lang;
    continue when v_rec is null;
    if v_lang = 'ar' then
      v_title := case p_kind when 'new' then 'شكوى سائق جديدة ' || c.case_no
                             when 'outcome' then 'تم الرد على شكواك ' || c.case_no
                             when 'overdue' then 'شكوى السائق ' || c.case_no || ' متأخرة'
                             else 'تم تحديث شكوى السائق ' || c.case_no end;
      v_body := 'افتح Tyre Pulse للاطلاع عليها.';
    else
      v_title := case p_kind when 'new' then 'New driver concern ' || c.case_no
                             when 'outcome' then 'Your concern ' || c.case_no || ' has an answer'
                             when 'overdue' then 'Driver concern ' || c.case_no || ' is overdue'
                             else 'Driver concern ' || c.case_no || ' was updated' end;
      v_body := 'Open Tyre Pulse to view it.';
    end if;
    insert into public.domain_events (event_type, entity_type, entity_id, organisation_id, payload, status, processed_at)
    values ('driver_concern.' || p_kind, 'driver_concern', c.id::text, c.organisation_id,
            jsonb_build_object('lang', v_lang), 'processed', now())
    returning id into v_event;
    insert into public.workflow_notifications (event_id, organisation_id, instance_id, event_type, payload, recipient_count, status)
    values (v_event, c.organisation_id, null, 'driver_concern.' || p_kind,
            jsonb_build_object('event_type', 'driver_concern.' || p_kind, 'entity_type', 'driver_concern',
                               'entity_label', c.case_no, 'entity_id', c.id,
                               'push', jsonb_build_object('title', v_title, 'body', v_body),
                               'recipients', v_rec),
            jsonb_array_length(v_rec), 'pending')
    on conflict (event_id) do nothing;
  end loop;
  return n;
end $$;

create or replace function private.dc_log(p_id uuid, p_type text, p_from text, p_to text, p_level text,
                                          p_note text, p_lang text, p_visible boolean, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.driver_concern_events
    (concern_id, organisation_id, seq, event_type, actor, actor_role, from_status, to_status, level,
     note, note_lang, visible_to_driver, payload, hash)
  select p_id, c.organisation_id, 0, p_type, auth.uid(), public.get_my_role(), p_from, p_to, p_level,
         nullif(btrim(p_note), ''), p_lang, coalesce(p_visible, true), coalesce(p_payload, '{}'::jsonb), ''
    from public.driver_concerns c where c.id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Raise
-- ---------------------------------------------------------------------------
create or replace function public.driver_concern_raise(
  p_category text, p_subtype text, p_text text, p_lang text default null,
  p_photos jsonb default '[]'::jsonb, p_client_uuid uuid default null,
  p_driver_id uuid default null, p_on_behalf boolean default false,
  p_verbal boolean default false, p_subject_user uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.app_current_org();
  v_driver uuid; v_id uuid; v_case text; v_row public.drivers%rowtype; v_existing record;
  v_sensitive boolean := (p_category = 'treatment');
  v_photo jsonb;
begin
  if auth.uid() is null or v_org is null or not public.is_approved_and_unlocked() then
    raise exception using errcode = '42501', message = 'Not allowed';
  end if;
  if p_client_uuid is not null then
    select id, case_no into v_existing from public.driver_concerns where client_uuid = p_client_uuid;
    if found then return jsonb_build_object('ok', true, 'id', v_existing.id, 'case_no', v_existing.case_no, 'replayed', true); end if;
  end if;
  if not private.dc_valid_subtype(p_category, p_subtype) then
    raise exception using errcode = '22023', message = 'Choose a category and a type';
  end if;
  if p_text is null or char_length(btrim(p_text)) = 0 then
    raise exception using errcode = '22023', message = 'Describe the concern';
  end if;
  if p_lang is not null and p_lang not in ('en','ar','ur','hi','bn','ps','ne','tl') then p_lang := null; end if;

  if coalesce(p_on_behalf, false) then
    select * into v_row from public.drivers where id = p_driver_id and organisation_id = v_org;
    if not found or private.dc_my_rank(v_sensitive, v_row.country, v_row.site) = 0 and public.app_role() <> 'hr_officer' then
      raise exception using errcode = '42501', message = 'You cannot log a concern for this driver';
    end if;
    v_driver := v_row.id;
  else
    v_driver := coalesce(p_driver_id, (public.app_my_driver_ids())[1]);
    if v_driver is null or not (v_driver = any(public.app_my_driver_ids())) then
      raise exception using errcode = '42501', message = 'Your login is not linked to a driver record';
    end if;
    select * into v_row from public.drivers where id = v_driver;
  end if;

  -- Photos must sit under this org and this uploader.
  for v_photo in select * from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) loop
    if jsonb_typeof(v_photo) <> 'string'
       or split_part(v_photo #>> '{}', '/', 1) <> v_org::text
       or split_part(v_photo #>> '{}', '/', 2) <> auth.uid()::text then
      raise exception using errcode = '22023', message = 'A photo is not in the right place';
    end if;
  end loop;

  insert into public.driver_concerns
    (organisation_id, driver_id, raised_by, logged_on_behalf_by, entered_verbally, subject_user_id,
     category, subtype, sensitive, original_text, original_lang, photos, country, site,
     level, status, client_uuid)
  values
    (v_org, v_driver, auth.uid(),
     case when coalesce(p_on_behalf, false) then auth.uid() end,
     coalesce(p_on_behalf, false) and coalesce(p_verbal, false),
     p_subject_user, p_category, p_subtype, v_sensitive, btrim(p_text), p_lang,
     coalesce(p_photos, '[]'::jsonb),
     coalesce(v_row.country, (select (p.country)[1] from public.profiles p where p.id = auth.uid())),
     coalesce(v_row.site, (select p.site from public.profiles p where p.id = auth.uid())),
     'supervisor', 'open', p_client_uuid)
  returning id, case_no into v_id, v_case;

  perform private.dc_set_deadlines(v_id, (select level from public.driver_concerns where id = v_id));
  perform private.dc_log(v_id, case when coalesce(p_on_behalf, false) then 'raised_on_behalf' else 'raised' end,
                         null, 'open', (select level from public.driver_concerns where id = v_id),
                         null, null, true,
                         jsonb_build_object('entered_verbally', coalesce(p_on_behalf, false) and coalesce(p_verbal, false)));
  perform private.dc_notify(v_id, 'new',
          private.dc_recipients(v_id, (select level from public.driver_concerns where id = v_id)));
  return jsonb_build_object('ok', true, 'id', v_id, 'case_no', v_case);
end $$;

-- ---------------------------------------------------------------------------
-- 7. The one writer
-- ---------------------------------------------------------------------------
create or replace function public.driver_concern_command(
  p_id uuid, p_action text, p_payload jsonb default '{}'::jsonb, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.driver_concerns%rowtype;
  p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_rank int; v_mine boolean; v_next text; v_note text := nullif(btrim(p ->> 'text'), '');
  v_lang text := nullif(p ->> 'lang', '');
  v_terminal boolean; v_target public.driver_concerns%rowtype; v_days int;
begin
  if auth.uid() is null or not public.is_approved_and_unlocked() then
    raise exception using errcode = '42501', message = 'Not allowed';
  end if;
  select * into c from public.driver_concerns where id = p_id for update;
  if not found or not private.dc_visible(c.organisation_id, c.driver_id, c.sensitive, c.country, c.site, c.subject_user_id) then
    raise exception using errcode = '42501', message = 'Concern not found';
  end if;
  if p_expected_version is not null and p_expected_version <> c.version then
    raise exception using errcode = 'PT409', message = 'record_changed';
  end if;
  if v_lang is not null and v_lang not in ('en','ar','ur','hi','bn','ps','ne','tl') then v_lang := null; end if;

  v_mine := private.dc_is_my_driver(c.driver_id);
  v_rank := case when v_mine then 0 else private.dc_my_rank(c.sensitive, c.country, c.site) end;
  if c.subject_user_id = auth.uid() then v_rank := 0; end if;
  v_terminal := c.status in ('accepted','not_accepted','withdrawn','closed');
  v_days := coalesce((select reopen_days from public.driver_concern_settings where organisation_id = c.organisation_id), 14);

  -- A handler acts for a verbally logged case on the driver's behalf at next contact.
  if p_action in ('view_outcome','sign','withdraw') and not v_mine
     and not (c.entered_verbally and v_rank > 0) then
    raise exception using errcode = '42501', message = 'Only the driver can do this';
  end if;
  if p_action in ('acknowledge','assign','escalate','propose','reclassify','link','return')
     and v_rank < least(private.dc_level_rank(c.level), 3) then
    raise exception using errcode = '42501', message = 'You do not handle this concern at its current level';
  end if;
  if p_action in ('approve','return') and v_rank < 3 then
    raise exception using errcode = '42501', message = 'Only a manager approves a solution';
  end if;
  if v_terminal and p_action not in ('note','reopen','link') then
    raise exception using errcode = 'PT409', message = 'already_decided';
  end if;

  case p_action
  when 'acknowledge' then
    if c.acknowledged_at is not null then raise exception using errcode = 'PT409', message = 'already_decided'; end if;
    update public.driver_concerns set acknowledged_at = now(),
           status = case when status = 'open' then 'in_review' else status end where id = p_id;
    perform private.dc_log(p_id, 'acknowledged', c.status, 'in_review', c.level, null, null, true, '{}');
    perform private.dc_notify(p_id, 'update', private.dc_recipients(p_id, 'driver'));

  when 'assign' then
    if not exists (select 1 from public.profiles x where x.id = (p ->> 'user_id')::uuid and x.org_id = c.organisation_id)
       or (p ->> 'user_id')::uuid = c.subject_user_id then
      raise exception using errcode = '22023', message = 'Choose a person in your organisation';
    end if;
    update public.driver_concerns set assigned_to = (p ->> 'user_id')::uuid where id = p_id;
    perform private.dc_log(p_id, 'assigned', c.status, c.status, c.level, null, null, false,
                           jsonb_build_object('assigned_to', p ->> 'user_id'));
    perform private.dc_notify(p_id, 'update', array[(p ->> 'user_id')::uuid]);

  when 'note' then
    if v_note is null then raise exception using errcode = '22023', message = 'Write a note'; end if;
    if not v_mine and v_rank = 0 then raise exception using errcode = '42501', message = 'Not allowed'; end if;
    perform private.dc_log(p_id, 'note', c.status, c.status, c.level, v_note, v_lang,
                           v_mine or coalesce((p ->> 'visible_to_driver')::boolean, false), '{}');
    if v_mine then
      perform private.dc_notify(p_id, 'update', private.dc_recipients(p_id, c.level));
    elsif coalesce((p ->> 'visible_to_driver')::boolean, false) then
      perform private.dc_notify(p_id, 'update', private.dc_recipients(p_id, 'driver'));
    end if;

  when 'escalate' then
    v_next := private.dc_next_level(c.level, c.sensitive);
    if v_next is null then raise exception using errcode = 'PT409', message = 'already_at_top'; end if;
    update public.driver_concerns set level = v_next, status = 'open', assigned_to = null,
           escalation_count = escalation_count + 1 where id = p_id;
    perform private.dc_set_deadlines(p_id, v_next);
    perform private.dc_log(p_id, 'escalated', c.status, 'open', v_next, v_note, v_lang, true, jsonb_build_object('from_level', c.level));
    perform private.dc_notify(p_id, 'new', private.dc_recipients(p_id, v_next));

  when 'propose' then
    if v_note is null then raise exception using errcode = '22023', message = 'Write the proposed solution'; end if;
    if c.status = 'proposed' or c.status = 'outcome_shared' then raise exception using errcode = 'PT409', message = 'already_decided'; end if;
    update public.driver_concerns set status = 'proposed', proposed_solution = v_note, proposed_lang = v_lang,
           proposed_by = auth.uid(), proposed_at = now(),
           due_at = now() + make_interval(hours => private.dc_sla_hours(c.organisation_id, 'manager'))
     where id = p_id;
    perform private.dc_log(p_id, 'proposed', c.status, 'proposed', c.level, v_note, v_lang, false, '{}');
    perform private.dc_notify(p_id, 'update', private.dc_recipients(p_id, 'manager'));

  when 'return' then
    if c.status <> 'proposed' then raise exception using errcode = 'PT409', message = 'already_decided'; end if;
    update public.driver_concerns set status = 'in_review' where id = p_id;
    perform private.dc_set_deadlines(p_id, c.level);
    perform private.dc_log(p_id, 'returned', 'proposed', 'in_review', c.level, v_note, v_lang, false, '{}');

  when 'approve' then
    if c.status <> 'proposed' then raise exception using errcode = 'PT409', message = 'already_decided'; end if;
    update public.driver_concerns set status = 'outcome_shared', approved_by = auth.uid(), approved_at = now(),
           outcome_text = coalesce(v_note, proposed_solution), outcome_lang = coalesce(v_lang, proposed_lang),
           outcome_seen_at = null, due_at = null where id = p_id;
    perform private.dc_log(p_id, 'approved', 'proposed', 'outcome_shared', c.level,
                           coalesce(v_note, c.proposed_solution), coalesce(v_lang, c.proposed_lang), true,
                           jsonb_build_object('labour_office_right', true));
    perform private.dc_notify(p_id, 'outcome', private.dc_recipients(p_id, 'driver'));

  when 'view_outcome' then
    if c.status <> 'outcome_shared' then raise exception using errcode = 'PT409', message = 'already_decided'; end if;
    update public.driver_concerns set outcome_seen_at = coalesce(outcome_seen_at, now()) where id = p_id;
    perform private.dc_log(p_id, case when v_mine then 'outcome_seen' else 'outcome_read_to_driver' end,
                           c.status, c.status, c.level, null, null, true, '{}');

  when 'sign' then
    if c.status <> 'outcome_shared' then raise exception using errcode = 'PT409', message = 'already_decided'; end if;
    if c.outcome_seen_at is null then raise exception using errcode = '22023', message = 'Confirm you have seen the answer first'; end if;
    if (p ->> 'decision') not in ('accepted','not_accepted') then raise exception using errcode = '22023', message = 'Choose Accept or Not accepted'; end if;
    if nullif(p ->> 'signature', '') is null
       or not ((p ->> 'signature') like 'data:image/%' or (p ->> 'signature') like '<svg%') then
      raise exception using errcode = '22023', message = 'Sign before you send';
    end if;
    if p ->> 'decision' = 'accepted' then
      update public.driver_concerns set status = 'accepted', driver_decision = 'accepted',
             driver_decision_note = v_note, driver_signature = p ->> 'signature', signed_at = now(),
             signed_in_person_by = case when v_mine then null else auth.uid() end,
             closed_at = now(), reopen_deadline = now() + make_interval(days => v_days) where id = p_id;
      perform private.dc_log(p_id, 'signed_accepted', c.status, 'accepted', c.level, v_note, v_lang, true,
                             jsonb_build_object('in_person', not v_mine));
    else
      v_next := private.dc_next_level(c.level, c.sensitive);
      if v_next is null then
        update public.driver_concerns set status = 'not_accepted', driver_decision = 'not_accepted',
               driver_decision_note = v_note, driver_signature = p ->> 'signature', signed_at = now(),
               signed_in_person_by = case when v_mine then null else auth.uid() end,
               closed_at = now(), reopen_deadline = now() + make_interval(days => v_days) where id = p_id;
        perform private.dc_log(p_id, 'signed_not_accepted', c.status, 'not_accepted', c.level, v_note, v_lang, true,
                               jsonb_build_object('labour_office_right', true, 'final', true, 'in_person', not v_mine));
      else
        update public.driver_concerns set status = 'open', level = v_next, driver_decision = 'not_accepted',
               driver_decision_note = v_note, driver_signature = p ->> 'signature', signed_at = now(),
               signed_in_person_by = case when v_mine then null else auth.uid() end,
               outcome_text = null, outcome_seen_at = null, proposed_solution = null, assigned_to = null,
               escalation_count = escalation_count + 1 where id = p_id;
        perform private.dc_set_deadlines(p_id, v_next);
        perform private.dc_log(p_id, 'signed_not_accepted', c.status, 'open', v_next, v_note, v_lang, true,
                               jsonb_build_object('labour_office_right', true, 'escalated_to', v_next, 'in_person', not v_mine));
        perform private.dc_notify(p_id, 'new', private.dc_recipients(p_id, v_next));
      end if;
    end if;

  when 'withdraw' then
    update public.driver_concerns set status = 'withdrawn', closed_at = now(), due_at = null where id = p_id;
    perform private.dc_log(p_id, 'withdrawn', c.status, 'withdrawn', c.level, v_note, v_lang, true, '{}');
    perform private.dc_notify(p_id, 'update', private.dc_recipients(p_id, c.level));

  when 'reopen' then
    if not v_mine then raise exception using errcode = '42501', message = 'Only the driver can reopen'; end if;
    if c.status not in ('accepted','not_accepted') or c.reopen_deadline is null or c.reopen_deadline < now() then
      raise exception using errcode = 'PT409', message = 'reopen_window_closed';
    end if;
    if v_note is null then raise exception using errcode = '22023', message = 'Say why you are reopening'; end if;
    update public.driver_concerns set status = 'open', closed_at = null, reopen_deadline = null,
           reopened_count = reopened_count + 1, driver_decision = null, outcome_text = null,
           outcome_seen_at = null, proposed_solution = null where id = p_id;
    perform private.dc_set_deadlines(p_id, c.level);
    perform private.dc_log(p_id, 'reopened', c.status, 'open', c.level, v_note, v_lang, true, '{}');
    perform private.dc_notify(p_id, 'new', private.dc_recipients(p_id, c.level));

  when 'reclassify' then
    if c.sensitive then raise exception using errcode = 'PT409', message = 'already_sensitive'; end if;
    update public.driver_concerns set sensitive = true, level = 'hr', status = 'open', assigned_to = null where id = p_id;
    perform private.dc_set_deadlines(p_id, 'hr');
    perform private.dc_log(p_id, 'reclassified_sensitive', c.status, 'open', 'hr', v_note, v_lang, false,
                           jsonb_build_object('from_level', c.level));
    perform private.dc_notify(p_id, 'new', private.dc_recipients(p_id, 'hr'));

  when 'link' then
    if v_rank = 0 then raise exception using errcode = '42501', message = 'Not allowed'; end if;
    select * into v_target from public.driver_concerns where id = (p ->> 'target_id')::uuid;
    if not found or v_target.id = c.id or v_target.organisation_id <> c.organisation_id
       or not private.dc_visible(v_target.organisation_id, v_target.driver_id, v_target.sensitive, v_target.country, v_target.site, v_target.subject_user_id) then
      raise exception using errcode = '22023', message = 'Choose another concern you can see';
    end if;
    if p ->> 'kind' = 'duplicate' then
      update public.driver_concerns set duplicate_of = v_target.id where id = p_id;
    else
      update public.driver_concerns set linked_to = v_target.id where id = p_id;
    end if;
    perform private.dc_log(p_id, 'linked', c.status, c.status, c.level, v_note, v_lang, false,
                           jsonb_build_object('target', v_target.case_no, 'kind', coalesce(p ->> 'kind', 'related')));
  else
    raise exception using errcode = '22023', message = 'Unknown action';
  end case;

  update public.driver_concerns set version = version + 1 where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id,
                            'version', (select version from public.driver_concerns where id = p_id),
                            'status', (select status from public.driver_concerns where id = p_id));
end $$;

-- Named wrappers (one line each, so every call site reads as what it does).
create or replace function public.driver_concern_acknowledge(p_id uuid, p_version integer default null)
returns jsonb language sql security definer set search_path = public as
$$ select public.driver_concern_command(p_id, 'acknowledge', '{}'::jsonb, p_version) $$;
create or replace function public.driver_concern_assign(p_id uuid, p_user uuid, p_version integer default null)
returns jsonb language sql security definer set search_path = public as
$$ select public.driver_concern_command(p_id, 'assign', jsonb_build_object('user_id', p_user), p_version) $$;
create or replace function public.driver_concern_note(p_id uuid, p_text text, p_lang text default null, p_visible boolean default false)
returns jsonb language sql security definer set search_path = public as
$$ select public.driver_concern_command(p_id, 'note', jsonb_build_object('text', p_text, 'lang', p_lang, 'visible_to_driver', p_visible), null) $$;
create or replace function public.driver_concern_escalate(p_id uuid, p_text text default null, p_version integer default null)
returns jsonb language sql security definer set search_path = public as
$$ select public.driver_concern_command(p_id, 'escalate', jsonb_build_object('text', p_text), p_version) $$;
create or replace function public.driver_concern_propose(p_id uuid, p_text text, p_lang text default null, p_version integer default null)
returns jsonb language sql security definer set search_path = public as
$$ select public.driver_concern_command(p_id, 'propose', jsonb_build_object('text', p_text, 'lang', p_lang), p_version) $$;
create or replace function public.driver_concern_approve(p_id uuid, p_text text default null, p_lang text default null, p_version integer default null)
returns jsonb language sql security definer set search_path = public as
$$ select public.driver_concern_command(p_id, 'approve', jsonb_build_object('text', p_text, 'lang', p_lang), p_version) $$;
create or replace function public.driver_concern_return(p_id uuid, p_text text default null, p_version integer default null)
returns jsonb language sql security definer set search_path = public as
$$ select public.driver_concern_command(p_id, 'return', jsonb_build_object('text', p_text), p_version) $$;
create or replace function public.driver_concern_view_outcome(p_id uuid)
returns jsonb language sql security definer set search_path = public as
$$ select public.driver_concern_command(p_id, 'view_outcome', '{}'::jsonb, null) $$;
create or replace function public.driver_concern_sign(p_id uuid, p_decision text, p_signature text, p_text text default null, p_lang text default null, p_version integer default null)
returns jsonb language sql security definer set search_path = public as
$$ select public.driver_concern_command(p_id, 'sign', jsonb_build_object('decision', p_decision, 'signature', p_signature, 'text', p_text, 'lang', p_lang), p_version) $$;
create or replace function public.driver_concern_withdraw(p_id uuid, p_text text default null)
returns jsonb language sql security definer set search_path = public as
$$ select public.driver_concern_command(p_id, 'withdraw', jsonb_build_object('text', p_text), null) $$;
create or replace function public.driver_concern_reopen(p_id uuid, p_text text, p_lang text default null)
returns jsonb language sql security definer set search_path = public as
$$ select public.driver_concern_command(p_id, 'reopen', jsonb_build_object('text', p_text, 'lang', p_lang), null) $$;
create or replace function public.driver_concern_reclassify(p_id uuid, p_text text default null)
returns jsonb language sql security definer set search_path = public as
$$ select public.driver_concern_command(p_id, 'reclassify', jsonb_build_object('text', p_text), null) $$;
create or replace function public.driver_concern_link(p_id uuid, p_target uuid, p_kind text default 'related', p_text text default null)
returns jsonb language sql security definer set search_path = public as
$$ select public.driver_concern_command(p_id, 'link', jsonb_build_object('target_id', p_target, 'kind', p_kind, 'text', p_text), null) $$;

-- ---------------------------------------------------------------------------
-- 8. Read one case (logs reads of sensitive cases), translations, PDF hash
-- ---------------------------------------------------------------------------
create or replace function public.driver_concern_get(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.driver_concerns%rowtype; v_mine boolean;
begin
  select * into c from public.driver_concerns where id = p_id;
  if not found or not private.dc_visible(c.organisation_id, c.driver_id, c.sensitive, c.country, c.site, c.subject_user_id) then
    raise exception using errcode = '42501', message = 'Concern not found';
  end if;
  v_mine := private.dc_is_my_driver(c.driver_id);
  if c.sensitive and not v_mine then
    insert into public.driver_concern_reads (concern_id, user_id) values (p_id, auth.uid());
  end if;
  return jsonb_build_object(
    'concern', to_jsonb(c) - case when v_mine then array['subject_user_id','proposed_solution','proposed_lang','assigned_to'] else array[]::text[] end,
    'driver_name', (select d.driver_name from public.drivers d where d.id = c.driver_id),
    'my_rank', case when v_mine then 0 else private.dc_my_rank(c.sensitive, c.country, c.site) end,
    'is_driver', v_mine,
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'prev_hash' order by e.seq)
                          from public.driver_concern_events e
                         where e.concern_id = p_id and (e.visible_to_driver or not v_mine)), '[]'::jsonb),
    'translations', coalesce((select jsonb_agg(to_jsonb(t)) from public.driver_concern_translations t
                               where t.concern_id = p_id), '[]'::jsonb),
    'chain_ok', (select coalesce(bool_and(x.ok), true) from (
                   select e.prev_hash is not distinct from lag(e.hash) over (order by e.seq) as ok
                     from public.driver_concern_events e where e.concern_id = p_id) x));
end $$;

create or replace function public.driver_concern_add_translation(
  p_id uuid, p_source text, p_source_id text, p_target_lang text, p_text text,
  p_model text, p_model_version text default null, p_detected_lang text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.driver_concerns%rowtype;
begin
  select * into c from public.driver_concerns where id = p_id;
  if not found or not private.dc_visible(c.organisation_id, c.driver_id, c.sensitive, c.country, c.site, c.subject_user_id) then
    raise exception using errcode = '42501', message = 'Concern not found';
  end if;
  insert into public.driver_concern_translations (concern_id, source, source_id, target_lang, text, model, model_version)
  values (p_id, p_source, coalesce(p_source_id, ''), p_target_lang, p_text, p_model, p_model_version)
  on conflict (concern_id, source, source_id, target_lang)
  do update set text = excluded.text, model = excluded.model, model_version = excluded.model_version, generated_at = now();
  -- The model-detected original language fills a blank only; never overwrites.
  if p_source = 'concern' and c.original_lang is null
     and p_detected_lang in ('en','ar','ur','hi','bn','ps','ne','tl') then
    update public.driver_concerns set original_lang = p_detected_lang where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.driver_concern_set_pdf(p_id uuid, p_sha256 text, p_path text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.driver_concerns%rowtype;
begin
  select * into c from public.driver_concerns where id = p_id for update;
  if not found or private.dc_my_rank(c.sensitive, c.country, c.site) = 0 then
    raise exception using errcode = '42501', message = 'Not allowed';
  end if;
  if c.status not in ('accepted','not_accepted','withdrawn','closed') then
    raise exception using errcode = 'PT409', message = 'not_closed';
  end if;
  update public.driver_concerns set pdf_sha256 = lower(p_sha256), pdf_path = p_path where id = p_id;
  perform private.dc_log(p_id, 'pdf_generated', c.status, c.status, c.level, null, null, false,
                         jsonb_build_object('sha256', lower(p_sha256)));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Overdue escalation scan (cron) and retention purge (NOT scheduled)
-- ---------------------------------------------------------------------------
-- Moves an overdue case one rung up. Never notifies the subject of the
-- concern (dc_recipients excludes them) and a sensitive case only ever goes
-- hr -> manager, never through the pool. A proposal waiting on a manager is
-- not moved; managers get one overdue notice.
create or replace function public.driver_concern_escalation_scan()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_next text; n_moved int := 0; n_notice int := 0;
begin
  for r in select * from public.driver_concerns
            where status in ('open','in_review','proposed')
              and ((due_at is not null and due_at < now())
                   or (acknowledged_at is null and ack_due_at is not null and ack_due_at < now()))
            for update skip locked loop
    if r.status = 'proposed' then
      insert into public.driver_concern_notices (concern_id, level, kind) values (r.id, 'manager', 'approval_overdue')
      on conflict do nothing;
      if found then
        perform private.dc_notify(r.id, 'overdue', private.dc_recipients(r.id, 'manager'));
        n_notice := n_notice + 1;
      end if;
      continue;
    end if;
    v_next := private.dc_next_level(r.level, r.sensitive);
    if v_next is null then
      insert into public.driver_concern_notices (concern_id, level, kind) values (r.id, r.level, 'top_overdue')
      on conflict do nothing;
      if found then
        perform private.dc_notify(r.id, 'overdue', private.dc_recipients(r.id, r.level));
        n_notice := n_notice + 1;
      end if;
      continue;
    end if;
    insert into public.driver_concern_notices (concern_id, level, kind) values (r.id, v_next, 'auto_escalated')
    on conflict do nothing;
    continue when not found;
    update public.driver_concerns set level = v_next, status = 'open', assigned_to = null,
           escalation_count = escalation_count + 1, version = version + 1 where id = r.id;
    perform private.dc_set_deadlines(r.id, v_next);
    perform private.dc_log(r.id, 'auto_escalated', r.status, 'open', v_next, null, null, true,
                           jsonb_build_object('from_level', r.level, 'reason', 'overdue'));
    perform private.dc_notify(r.id, 'overdue', private.dc_recipients(r.id, v_next));
    n_moved := n_moved + 1;
  end loop;
  return jsonb_build_object('ok', true, 'escalated', n_moved, 'notices', n_notice);
end $$;

-- Cron (uncomment on apply, after checking cron.job for a free name):
-- select cron.schedule('driver-concern-escalation', '25 * * * *', $c$select public.driver_concern_escalation_scan()$c$);

-- Retention: closed cases older than retention_years after closing. Open
-- cases are never touched. Written, deliberately NOT scheduled.
create or replace function public.driver_concern_purge_closed(p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  -- Executable by service_role / owner only (grants below); no app user can call it.
  select coalesce(array_agg(c.id), '{}') into v_ids
    from public.driver_concerns c
    join public.driver_concern_settings s on s.organisation_id = c.organisation_id
   where c.status in ('accepted','not_accepted','withdrawn','closed')
     and c.closed_at is not null
     and c.closed_at < now() - make_interval(years => s.retention_years);
  if p_dry_run then return jsonb_build_object('ok', true, 'dry_run', true, 'would_purge', cardinality(v_ids)); end if;
  perform set_config('dc.purge', 'on', true);
  delete from public.driver_concern_reads where concern_id = any(v_ids);
  delete from public.driver_concern_translations where concern_id = any(v_ids);
  delete from public.driver_concern_notices where concern_id = any(v_ids);
  delete from public.driver_concern_events where concern_id = any(v_ids);
  update public.driver_concerns set linked_to = null where linked_to = any(v_ids);
  update public.driver_concerns set duplicate_of = null where duplicate_of = any(v_ids);
  delete from public.driver_concerns where id = any(v_ids);
  return jsonb_build_object('ok', true, 'purged', cardinality(v_ids));
end $$;

-- ---------------------------------------------------------------------------
-- 10. Photos bucket
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-concerns', 'driver-concerns', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create or replace function private.dc_storage_access(p_name text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_approved_and_unlocked() then return false; end if;
  if split_part(p_name, '/', 1) <> coalesce(public.app_current_org()::text, '-') then return false; end if;
  if split_part(p_name, '/', 2) = auth.uid()::text then return true; end if;  -- uploader
  if p_write then return false; end if;
  return exists (select 1 from public.driver_concerns c
                  where c.photos ? p_name
                    and private.dc_visible(c.organisation_id, c.driver_id, c.sensitive, c.country, c.site, c.subject_user_id));
end $$;

create policy driver_concern_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'driver-concerns' and private.dc_storage_access(name, false));
create policy driver_concern_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'driver-concerns' and private.dc_storage_access(name, true));

-- ---------------------------------------------------------------------------
-- 11. Grants (V500 order: grant authenticated + service_role, revoke PUBLIC, then anon)
-- ---------------------------------------------------------------------------
do $g$
declare f text;
begin
  foreach f in array array[
    'public.driver_concern_raise(text,text,text,text,jsonb,uuid,uuid,boolean,boolean,uuid)',
    'public.driver_concern_command(uuid,text,jsonb,integer)',
    'public.driver_concern_acknowledge(uuid,integer)',
    'public.driver_concern_assign(uuid,uuid,integer)',
    'public.driver_concern_note(uuid,text,text,boolean)',
    'public.driver_concern_escalate(uuid,text,integer)',
    'public.driver_concern_propose(uuid,text,text,integer)',
    'public.driver_concern_approve(uuid,text,text,integer)',
    'public.driver_concern_return(uuid,text,integer)',
    'public.driver_concern_view_outcome(uuid)',
    'public.driver_concern_sign(uuid,text,text,text,text,integer)',
    'public.driver_concern_withdraw(uuid,text)',
    'public.driver_concern_reopen(uuid,text,text)',
    'public.driver_concern_reclassify(uuid,text)',
    'public.driver_concern_link(uuid,uuid,text,text)',
    'public.driver_concern_get(uuid)',
    'public.driver_concern_add_translation(uuid,text,text,text,text,text,text,text)',
    'public.driver_concern_set_pdf(uuid,text,text)',
    -- used inside RLS policies, so the caller must be able to execute them
    'private.dc_visible(uuid,uuid,boolean,text,text,uuid)',
    'private.dc_is_my_driver(uuid)',
    'private.dc_storage_access(text,boolean)',
    'private.dc_valid_subtype(text,text)'
  ] loop
    execute format('grant execute on function %s to authenticated, service_role', f);
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
  end loop;
  -- internal helpers and the scheduled jobs: service_role / owner only
  foreach f in array array[
    'public.driver_concern_escalation_scan()',
    'public.driver_concern_purge_closed(boolean)',
    'private.dc_notify(uuid,text,uuid[])',
    'private.dc_recipients(uuid,text)',
    'private.dc_log(uuid,text,text,text,text,text,text,boolean,jsonb)',
    'private.dc_set_deadlines(uuid,text)',
    'private.dc_sla_hours(uuid,text)',
    'private.dc_has_handler_row(text[],text,text)',
    'private.dc_my_rank(boolean,text,text)',
    'private.dc_before_insert()', 'private.dc_before_update()',
    'private.dc_event_chain()', 'private.dc_event_guard()'
  ] loop
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $g$;

commit;
