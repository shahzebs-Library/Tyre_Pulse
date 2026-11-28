-- =============================================================================
-- P2: per-organisation email settings, and accident email through the outbox.
-- STATUS: AUTHORED, NOT APPLIED. Apply AFTER 20261128110000 and 20261128111000.
--
-- * email_event_settings: one row per (organisation, email type). Who gets each
--   email: roles, named users, external addresses (max 10). RESTRICTIVE org
--   isolation; read by the org's Admin (or super admin); written ONLY through
--   set_email_event_setting(), which validates and writes a history row.
-- * Accident To/CC moves out of global system_config: this migration COPIES the
--   current accident mailbox config (accident_mail_config, which already reads
--   the org setting or the legacy global rows) into each organisation's
--   settings. Nothing is deleted; the old keys stay readable.
-- * consume_event_accident_notify: in-app notifications unchanged; push still
--   goes through workflow_notifications but WITHOUT email; email now goes
--   through enqueue_email (verified addresses only, per-recipient dedupe,
--   branded template) and the dispatcher is kicked straight away.
-- * email_webhook_record: Resend webhook writes (service_role only).
-- =============================================================================

create table if not exists public.email_event_settings (
  organisation_id    uuid not null,
  event_key          text not null,
  enabled            boolean not null default true,
  recipient_roles    text[] not null default '{}',
  recipient_user_ids uuid[] not null default '{}',
  external_addresses text[] not null default '{}' check (coalesce(array_length(external_addresses, 1), 0) <= 10),
  include_assignee   boolean not null default true,
  updated_by         uuid,
  updated_at         timestamptz not null default now(),
  primary key (organisation_id, event_key)
);

create table if not exists public.email_event_settings_history (
  id              bigint generated always as identity primary key,
  organisation_id uuid not null,
  event_key       text not null,
  old_value       jsonb,
  new_value       jsonb not null,
  changed_by      uuid,
  changed_at      timestamptz not null default now()
);
create index if not exists email_event_settings_history_org_idx
  on public.email_event_settings_history (organisation_id, changed_at desc);

alter table public.email_event_settings enable row level security;
alter table public.email_event_settings_history enable row level security;
revoke all on public.email_event_settings, public.email_event_settings_history from public;
revoke all on public.email_event_settings, public.email_event_settings_history from anon;
revoke all on public.email_event_settings, public.email_event_settings_history from authenticated;
grant select on public.email_event_settings, public.email_event_settings_history to authenticated;
grant all on public.email_event_settings, public.email_event_settings_history to service_role;

-- Policies created only when missing (no DROP in migrations).
do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='email_event_settings' and policyname='email_event_settings_org_isolation') then
    create policy email_event_settings_org_isolation on public.email_event_settings
      as restrictive for all to authenticated
      using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
      with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='email_event_settings' and policyname='email_event_settings_admin_read') then
    create policy email_event_settings_admin_read on public.email_event_settings
      for select to authenticated
      using ((select public.app_role()) = 'admin' or (select public.is_super_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='email_event_settings_history' and policyname='email_event_settings_history_org_isolation') then
    create policy email_event_settings_history_org_isolation on public.email_event_settings_history
      as restrictive for all to authenticated
      using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
      with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='email_event_settings_history' and policyname='email_event_settings_history_admin_read') then
    create policy email_event_settings_history_admin_read on public.email_event_settings_history
      for select to authenticated
      using ((select public.app_role()) = 'admin' or (select public.is_super_admin()));
  end if;
end
$pol$;

-- The catalogue of email types an organisation can configure, with defaults.
-- accident.* default roles are empty on purpose: the accident routing rules
-- already decide WHO, settings add named people and external mailboxes on top.
create or replace function public.email_event_catalog()
returns table (event_key text, default_roles text[], assignee_based boolean, optional boolean)
language sql immutable
set search_path to 'public'
as $$
  values
    ('accident.reported'::text,   '{}'::text[],                 false, false),
    ('accident.update',           '{}'::text[],                 false, false),
    ('accident.escalation',       '{}'::text[],                 false, false),
    ('assignment.new',            '{}'::text[],                 true,  false),
    ('user.signup_pending',       array['Admin']::text[],       false, false),
    ('digest.daily',              array['Admin','Manager']::text[], false, true)
$$;

-- Who gets one email type in one organisation, scoped to the record's site and
-- country like the accident routing (a site-bound person only gets their site).
-- Returns staff user ids (enqueue_email decides if they have a usable address)
-- and external addresses. p_extra_roles lets a caller add routing-rule roles.
create or replace function public.email_event_recipients(
  p_org uuid, p_event_key text, p_site text default null, p_country text default null,
  p_extra_roles text[] default '{}'
)
returns table (user_id uuid, address text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  s       public.email_event_settings%rowtype;
  v_roles text[];
  v_found boolean;
  v_users uuid[];
begin
  select * into s from public.email_event_settings
   where organisation_id = p_org and event_key = p_event_key;
  v_found := found;
  if v_found and not s.enabled then
    return;
  end if;
  v_users := case when v_found then s.recipient_user_ids else '{}'::uuid[] end;
  v_roles := coalesce(case when v_found then s.recipient_roles end,
                      (select c.default_roles from public.email_event_catalog() c where c.event_key = p_event_key),
                      '{}') || coalesce(p_extra_roles, '{}');

  return query
  select distinct p.id, null::text
    from public.profiles p
   where p.organisation_id = p_org
     and coalesce(p.approved, true) and not coalesce(p.locked, false)
     and (
       (p.role = any(v_roles)
        and (p_site is null or p.site is null or btrim(p.site) = '' or upper(p.site) = upper(p_site)
             or upper(p_site) = any(select upper(x) from unnest(coalesce(p.sites, '{}'::text[])) x)
             or 'ALL' = any(coalesce(p.sites, '{}'::text[])))
        and (p_country is null or coalesce(array_length(p.country, 1), 0) = 0 or p_country = any(p.country)))
       or p.id = any(v_users)
     );

  if v_found then
    return query select null::uuid, lower(btrim(a)) from unnest(s.external_addresses) a
                  where public.email_address_deliverable(a);
  end if;
end;
$$;

-- Read: the catalogue merged with this organisation's saved rows. Admin only.
create or replace function public.get_email_event_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_org uuid := public.app_current_org();
begin
  if v_org is null or not (public.app_role() = 'admin' or public.is_super_admin()) then
    raise exception 'Only an administrator can view email settings' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'event_key', c.event_key,
      'optional', c.optional,
      'assignee_based', c.assignee_based,
      'configured', s.event_key is not null,
      'enabled', coalesce(s.enabled, true),
      'recipient_roles', coalesce(s.recipient_roles, c.default_roles),
      'recipient_user_ids', coalesce(s.recipient_user_ids, '{}'::uuid[]),
      'external_addresses', coalesce(s.external_addresses, '{}'::text[]),
      'include_assignee', coalesce(s.include_assignee, true),
      'updated_at', s.updated_at) order by c.event_key)
      from public.email_event_catalog() c
      left join public.email_event_settings s on s.organisation_id = v_org and s.event_key = c.event_key), '[]'::jsonb);
end;
$$;

create or replace function public.set_email_event_setting(
  p_event_key text, p_enabled boolean, p_roles text[], p_user_ids uuid[], p_external text[],
  p_include_assignee boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org   uuid := public.app_current_org();
  v_old   jsonb;
  v_ext   text[];
  v_roles text[];
  v_users uuid[];
  v_bad   text;
  v_new   jsonb;
begin
  if v_org is null or not (public.app_role() = 'admin' or public.is_super_admin()) then
    raise exception 'Only an administrator can change email settings' using errcode = '42501';
  end if;
  if not exists (select 1 from public.email_event_catalog() c where c.event_key = p_event_key) then
    raise exception 'Unknown email type' using errcode = '22023';
  end if;

  select array_agg(distinct btrim(r)) into v_roles
    from unnest(coalesce(p_roles, '{}')) r where btrim(r) <> '';
  if exists (select 1 from unnest(coalesce(v_roles, '{}')) r where r !~ '^[A-Za-z][A-Za-z &/-]{1,48}$') then
    raise exception 'A role name is not valid' using errcode = '22023';
  end if;

  select array_agg(distinct u) into v_users from unnest(coalesce(p_user_ids, '{}')) u where u is not null;
  if exists (select 1 from unnest(coalesce(v_users, '{}')) u
              where not exists (select 1 from public.profiles p where p.id = u and p.organisation_id = v_org)) then
    raise exception 'A selected person is not in your organisation' using errcode = '22023';
  end if;

  select array_agg(distinct lower(btrim(a))) into v_ext
    from unnest(coalesce(p_external, '{}')) a where btrim(a) <> '';
  if coalesce(array_length(v_ext, 1), 0) > 10 then
    raise exception 'At most 10 external addresses per email type' using errcode = '22023';
  end if;
  select a into v_bad from unnest(coalesce(v_ext, '{}')) a
   where not public.email_address_deliverable(a) limit 1;
  if v_bad is not null then
    raise exception 'This address cannot receive email: %', public.email_mask(v_bad) using errcode = '22023';
  end if;

  select to_jsonb(s) - 'organisation_id' into v_old
    from public.email_event_settings s where s.organisation_id = v_org and s.event_key = p_event_key;

  insert into public.email_event_settings as s (organisation_id, event_key, enabled, recipient_roles,
         recipient_user_ids, external_addresses, include_assignee, updated_by, updated_at)
  values (v_org, p_event_key, coalesce(p_enabled, true), coalesce(v_roles, '{}'), coalesce(v_users, '{}'),
          coalesce(v_ext, '{}'), coalesce(p_include_assignee, true), auth.uid(), now())
  on conflict (organisation_id, event_key) do update
     set enabled = excluded.enabled, recipient_roles = excluded.recipient_roles,
         recipient_user_ids = excluded.recipient_user_ids, external_addresses = excluded.external_addresses,
         include_assignee = excluded.include_assignee, updated_by = excluded.updated_by, updated_at = now();

  select to_jsonb(s) - 'organisation_id' into v_new
    from public.email_event_settings s where s.organisation_id = v_org and s.event_key = p_event_key;
  insert into public.email_event_settings_history (organisation_id, event_key, old_value, new_value, changed_by)
  values (v_org, p_event_key, v_old, v_new, auth.uid());
  return v_new;
end;
$$;

-- Admin "send a test": queues one 'test' email to the caller's own verified
-- address. Returns false when the caller has no verified real address.
create or replace function public.send_test_email()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id bigint;
begin
  if not (public.app_role() = 'admin' or public.is_super_admin()) then
    raise exception 'Only an administrator can send a test email' using errcode = '42501';
  end if;
  v_id := public.enqueue_email(public.app_current_org(), 'test', 'test', auth.uid(), null, 'settings', null,
                               '{}'::jsonb, 'test:' || auth.uid() || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
  if v_id is not null then perform public.email_dispatch_kick(); end if;
  return v_id is not null;
end;
$$;

-- Resend webhook (service role). Bounce / complaint -> suppression.
create or replace function public.email_webhook_record(
  p_message_id text, p_type text, p_provider_message_id text, p_address text, p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.email_webhook_replays (message_id) values (left(p_message_id, 200))
  on conflict (message_id) do nothing;
  if not found then return 'replay'; end if;

  insert into public.email_events (provider, provider_message_id, event_type, address, payload)
  values ('resend', left(p_provider_message_id, 200), left(p_type, 60), lower(btrim(p_address)), coalesce(p_payload, '{}'::jsonb));

  if p_type in ('email.bounced', 'email.complained') and p_address is not null and position('@' in p_address) > 1 then
    insert into public.email_suppressions (address, reason, source)
    values (lower(btrim(p_address)), case when p_type = 'email.bounced' then 'bounce' else 'complaint' end, 'resend-webhook')
    on conflict (address) do nothing;
  end if;
  return 'ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- Copy the accident mailbox (To + CC) into per-org settings. Copies only; the
-- global system_config rows are left in place.
-- ---------------------------------------------------------------------------
do $copy$
declare
  o     record;
  cfg   record;
  v_ext text[];
  k     text;
begin
  for o in select id from public.organisations loop
    select * into cfg from public.accident_mail_config(o.id) limit 1;
    if cfg.source is null or cfg.source = 'none' then continue; end if;
    select array_agg(distinct lower(btrim(x))) into v_ext
      from regexp_split_to_table(btrim(coalesce(cfg.email_to, ''), '"') || ',' || btrim(coalesce(cfg.email_cc, ''), '"'), '[,;\s]+') x
     where btrim(x) <> '' and public.email_address_deliverable(btrim(x));
    v_ext := v_ext[1:10];
    foreach k in array array['accident.reported', 'accident.update', 'accident.escalation'] loop
      insert into public.email_event_settings (organisation_id, event_key, enabled, external_addresses)
      values (o.id, k, lower(btrim(coalesce(cfg.emails_enabled, 'false'), '"')) in ('true','1','on','yes'), coalesce(v_ext, '{}'))
      on conflict (organisation_id, event_key) do nothing;
    end loop;
  end loop;
end
$copy$;

-- ---------------------------------------------------------------------------
-- consume_event_accident_notify: identical to the live body up to the email
-- branch. Push now goes without any email; email goes through the outbox.
-- ---------------------------------------------------------------------------
create or replace function public.consume_event_accident_notify(ev public.domain_events)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  acc          public.accidents%rowtype;
  v_key        text;
  v_depts      text[];
  v_to         text[];
  v_cc         text[];
  v_esc        text[];
  v_all        text[];
  v_dept       text;
  v_recipients jsonb := '[]'::jsonb;
  v_title      text;
  v_body       text;
  v_ntype      text;
  v_escalate   boolean;
  v_cfg        boolean := false;
  v_push       jsonb;
  v_tpl        text;
  v_set_key    text;
  v_data       jsonb;
  v_prefix     text;
  v_queued     int := 0;
  r            record;
begin
  if ev.event_type not like 'accident.%' then return; end if;
  begin
    select * into acc from public.accidents where id = ev.entity_id::uuid;
  exception when others then return; end;
  if acc.id is null then return; end if;

  v_escalate := ev.event_type in ('accident.vor_sla_breach','accident.overdue');

  if ev.event_type = 'accident.reported' then
    v_key := case when acc.severity in ('severe','fatal') or acc.injuries then 'critical' else 'reported' end;
  elsif ev.event_type = 'accident.stage_changed' then
    v_key := case acc.workflow_stage
      when 'workshop_assessment' then 'workshop_assessed'
      when 'repair_approval'     then 'repair_approval'
      when 'insurance_claim'     then 'claim_submitted'
      when 'final_inspection'    then 'final_inspection_pending'
      when 'vehicle_release'     then 'released'
      when 'closed'              then 'closed'
      else null end;
  elsif ev.event_type = 'accident.claim_changed' then
    v_key := case acc.claim_status
      when 'filed' then 'claim_submitted' when 'approved' then 'claim_approved'
      when 'settled' then 'claim_approved' when 'rejected' then 'claim_rejected' else null end;
  elsif ev.event_type = 'accident.vor_sla_breach' then
    v_key := 'vor_sla_breach';
  elsif ev.event_type = 'accident.overdue' then
    v_key := 'overdue';
  else
    v_key := null;
  end if;

  with m as (
    select rr.departments, rr.to_roles, rr.cc_roles, rr.escalate_roles
    from public.accident_routing_rules rr
    where rr.organisation_id = acc.organisation_id and rr.active
      and (rr.event_key is null or rr.event_key = ev.event_type)
      and (coalesce(array_length(rr.match_severities,1),0)=0 or acc.severity = any(rr.match_severities))
      and (coalesce(array_length(rr.match_types,1),0)=0 or acc.accident_type = any(rr.match_types))
      and (coalesce(array_length(rr.match_sites,1),0)=0 or acc.site = any(rr.match_sites))
      and (coalesce(array_length(rr.match_countries,1),0)=0 or acc.country = any(rr.match_countries))
      and (rr.min_cost is null or coalesce(acc.estimated_damage_cost,acc.final_amount,acc.repair_cost,0) >= rr.min_cost)
      and (not rr.require_injury or acc.injuries)
      and (not rr.require_vor or acc.vor)
      and (not rr.require_third_party or acc.third_party_involved)
  )
  select
    coalesce((select array_agg(distinct d) from m, unnest(m.departments) d),'{}'),
    coalesce((select array_agg(distinct d) from m, unnest(m.to_roles) d),'{}'),
    coalesce((select array_agg(distinct d) from m, unnest(m.cc_roles) d),'{}'),
    coalesce((select array_agg(distinct d) from m, unnest(m.escalate_roles) d),'{}')
  into v_depts, v_to, v_cc, v_esc;

  if coalesce(array_length(v_to,1),0)=0 then v_to := array['Admin','Manager','Director']; end if;
  if v_escalate then
    v_all := (select array_agg(distinct x) from unnest(v_to || v_cc || coalesce(v_esc,'{}')) x);
  else
    v_all := (select array_agg(distinct x) from unnest(v_to || v_cc) x);
  end if;
  v_dept := nullif(array_to_string(v_depts, ', '), '');
  if v_dept is null then v_dept := coalesce(acc.department,'Operations'); end if;

  select coalesce(jsonb_agg(jsonb_build_object('user_id',p.id,'push_token',t.tok,'role',p.role)),'[]'::jsonb)
    into v_recipients
  from public.profiles p
  left join lateral public._user_push_tokens(p.id) t(tok) on true
  where p.organisation_id = acc.organisation_id
    and coalesce(p.locked,false)=false and (p.approved is null or p.approved = true)
    and p.role = any(v_all)
    and (p.site is null or btrim(p.site)='' or upper(p.site)=upper(coalesce(acc.site,''))
         or upper(coalesce(acc.site,'')) = any(select upper(x) from unnest(coalesce(p.sites,'{}'::text[])) x))
    and (coalesce(array_length(p.country,1),0)=0 or acc.country is null or acc.country = any(p.country));
  v_cfg := public.accident_notify_configured(acc.organisation_id, ev.event_type);
  v_recipients := coalesce((select jsonb_agg(x) from jsonb_array_elements(v_recipients) x
                             where not public._accident_is_test_profile((x->>'user_id')::uuid)), '[]'::jsonb);

  v_ntype := case when v_key in ('critical','vor_sla_breach','overdue') then 'warning'
                  when ev.event_type='accident.stage_changed' and acc.workflow_stage='closed' then 'success'
                  else 'accident' end;
  v_title := case ev.event_type
    when 'accident.reported' then 'New accident '||coalesce(acc.reference_no,'')||' ('||public.accident_severity_label(acc.severity)||')'
    when 'accident.stage_changed' then 'Accident '||coalesce(acc.reference_no,'')||' -> '||public.accident_stage_label(acc.workflow_stage)
    when 'accident.claim_changed' then 'Claim '||coalesce(acc.claim_status,'')||' - '||coalesce(acc.reference_no,'')
    when 'accident.vor_changed' then case when acc.vor then 'Vehicle OFF ROAD - '||coalesce(acc.reference_no,'') else 'Vehicle back on road - '||coalesce(acc.reference_no,'') end
    when 'accident.vor_sla_breach' then 'VOR SLA BREACH - '||coalesce(acc.reference_no,'')
    when 'accident.overdue' then 'OVERDUE - '||coalesce(acc.reference_no,'')
    else 'Accident '||coalesce(acc.reference_no,'') end;
  v_body := coalesce(acc.asset_no,'')||' at '||coalesce(acc.site,'')||' | '
            ||public.accident_stage_label(acc.workflow_stage)||' | Action: '||public.accident_pending_action(acc.workflow_stage);

  -- In-app notifications: always, to the role-resolved recipients (unchanged).
  if not v_cfg and jsonb_array_length(v_recipients) > 0 then
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id, dedupe_key)
    select distinct (r2->>'user_id')::uuid, v_ntype, v_title, v_body, 'accident', acc.id,
           public.accident_notify_dedupe_key(ev.event_type, acc.id::text, (r2->>'user_id')::uuid, v_title, ev.created_at)
    from jsonb_array_elements(v_recipients) r2
    on conflict (dedupe_key) do nothing;
  end if;

  if v_key is null then return; end if;

  -- Push: unchanged channel, but the payload carries NO email any more.
  v_push := coalesce((select jsonb_agg(jsonb_build_object('user_id', x->>'user_id', 'push_token', x->>'push_token', 'role', x->>'role'))
                        from jsonb_array_elements(v_recipients) x
                       where nullif(x->>'push_token','') is not null and not v_cfg), '[]'::jsonb);
  if jsonb_array_length(v_push) > 0 then
    insert into public.workflow_notifications
      (event_id, organisation_id, instance_id, event_type, payload, recipient_count, status)
    values
      (ev.id, acc.organisation_id, null, ev.event_type,
       jsonb_build_object('event_type',ev.event_type,'channel','accident','entity_id',acc.id::text,'entity_type','accident',
         'push', jsonb_build_object('title',v_title,'body',v_body),
         'recipients', v_push),
       0, 'pending')
    on conflict (event_id) do nothing;
  end if;

  -- Email: through the outbox.
  v_tpl := case when ev.event_type = 'accident.reported' then 'accident.reported'
                when v_escalate then 'accident.escalation'
                else 'accident.update' end;
  v_set_key := v_tpl;
  -- Org has no row for this type yet: fall back to the old master switch.
  if not exists (select 1 from public.email_event_settings s where s.organisation_id = acc.organisation_id and s.event_key = v_set_key)
     and lower(btrim(coalesce((select m.emails_enabled from public.accident_mail_config(acc.organisation_id) m), 'false'), '"'))
         not in ('true','1','on','yes') then
    return;
  end if;
  v_prefix := btrim(btrim(coalesce((select m.subject_prefix from public.accident_mail_config(acc.organisation_id) m), ''), '"'));

  v_data := jsonb_build_object(
    'reference_no', acc.reference_no, 'asset_no', acc.asset_no, 'site', acc.site,
    'severity', acc.severity, 'stage', acc.workflow_stage, 'incident_date', acc.incident_date,
    'driver_name', acc.driver_name, 'description', left(coalesce(acc.description, ''), 600),
    'action', public.accident_pending_action(acc.workflow_stage),
    'reason', case when ev.event_type = 'accident.vor_sla_breach' then 'vor_sla_breach' else 'overdue' end,
    'department', v_dept, 'subject_prefix', nullif(v_prefix, ''));

  for r in
    select distinct e.user_id, e.address
      from public.email_event_recipients(acc.organisation_id, v_set_key, acc.site, acc.country,
                                         case when v_cfg then '{}'::text[] else v_all end) e
  loop
    if r.user_id is not null and public._accident_is_test_profile(r.user_id) then continue; end if;
    if public.enqueue_email(acc.organisation_id, ev.event_type, v_tpl, r.user_id, r.address, 'accident', acc.id::text,
                            v_data, 'accident:' || ev.id || ':' || coalesce(r.user_id::text, r.address)) is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;
  if v_queued > 0 then perform public.email_dispatch_kick(); end if;
end;
$function$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.email_event_recipients(uuid,text,text,text,text[])',
    'public.email_webhook_record(text,text,text,text,jsonb)'
  ] loop
    execute format('grant execute on function %s to service_role', f);
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
    execute format('revoke execute on function %s from authenticated', f);
  end loop;
  foreach f in array array[
    'public.get_email_event_settings()',
    'public.set_email_event_setting(text,boolean,text[],uuid[],text[],boolean)',
    'public.send_test_email()'
  ] loop
    execute format('grant execute on function %s to authenticated', f);
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
  end loop;
  execute 'revoke execute on function public.consume_event_accident_notify(public.domain_events) from public';
  execute 'revoke execute on function public.consume_event_accident_notify(public.domain_events) from anon';
  execute 'revoke execute on function public.consume_event_accident_notify(public.domain_events) from authenticated';
end
$grants$;
