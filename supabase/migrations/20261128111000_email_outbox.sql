-- =============================================================================
-- P1: one email outbox for every system email.
-- STATUS: APPLIED LIVE 2026-11-28 (owner OK). Apply only on the owner's OK.
--
-- WHY A SIBLING TABLE, NOT workflow_notifications:
--   workflow_notifications is one payload fanned out to MANY recipients across
--   push + email + WhatsApp, delivered by ONE pg_net call per row. Email needs
--   one row PER RECIPIENT: its own dedupe key, its own provider message id, its
--   own suppression and bounce state, its own pacing and retry. Retrying a
--   workflow_notifications row because ONE email hit a 429 would resend every
--   push in it. Push keeps using workflow_notifications + the V119 deliverer
--   unchanged; email moves here.
--
-- Security model:
--   * email_outbox / email_suppressions / email_events / email_webhook_replays:
--     RLS on with NO policies and no client grants = deny-all for clients.
--   * enqueue_email / email_outbox_claim / email_outbox_report: SECURITY DEFINER,
--     EXECUTE granted to service_role only (grant first, then revoke PUBLIC, then
--     revoke anon and authenticated by name). In-database callers (trigger and
--     consumer functions) run as the owner and need no grant.
--   * The org is re-derived from the RECIPIENT at enqueue AND re-checked at claim
--     time (a user who left the org, was locked, or lost a verified address is
--     suppressed, never mailed).
--   * Console reads only email_outbox_health(): super admin, counts + masked
--     addresses, no payload.
--   * system_config.email_dispatch_mode defaults to 'dry_run': the dispatcher
--     renders and records but sends NOTHING until an admin sets 'live'.
-- =============================================================================

create table if not exists public.email_outbox (
  id                  bigint generated always as identity primary key,
  organisation_id     uuid,
  event_key           text not null,
  template_key        text not null,
  locale              text not null default 'en' check (locale in ('en','ar')),
  audience            text not null default 'staff' check (audience in ('staff','external','owner')),
  user_id             uuid,
  to_address          text not null,
  entity_type         text,
  entity_id           text,
  data                jsonb not null default '{}'::jsonb,
  dedupe_key          text not null,
  status              text not null default 'pending'
                      check (status in ('pending','sending','sent','failed','suppressed','dead','dry_run')),
  attempts            integer not null default 0,
  next_attempt_at     timestamptz not null default now(),
  locked_at           timestamptz,
  provider            text,
  provider_message_id text,
  last_error          text,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);

create unique index if not exists email_outbox_dedupe_live_uidx
  on public.email_outbox (dedupe_key) where status not in ('failed','dead');
create index if not exists email_outbox_due_idx
  on public.email_outbox (next_attempt_at) where status = 'pending';
create index if not exists email_outbox_provider_msg_idx
  on public.email_outbox (provider_message_id) where provider_message_id is not null;
create index if not exists email_outbox_org_created_idx
  on public.email_outbox (organisation_id, created_at desc);

create table if not exists public.email_suppressions (
  address    text primary key check (address = lower(btrim(address))),
  reason     text not null,
  source     text not null default 'webhook',
  created_at timestamptz not null default now()
);

create table if not exists public.email_events (
  id                  bigint generated always as identity primary key,
  provider            text not null,
  provider_message_id text,
  event_type          text not null,
  address             text,
  payload             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
create index if not exists email_events_msg_idx on public.email_events (provider_message_id);

create table if not exists public.email_webhook_replays (
  message_id  text primary key,
  received_at timestamptz not null default now()
);

alter table public.email_outbox          enable row level security;
alter table public.email_suppressions    enable row level security;
alter table public.email_events          enable row level security;
alter table public.email_webhook_replays enable row level security;
revoke all on public.email_outbox, public.email_suppressions, public.email_events, public.email_webhook_replays from public;
revoke all on public.email_outbox, public.email_suppressions, public.email_events, public.email_webhook_replays from anon;
revoke all on public.email_outbox, public.email_suppressions, public.email_events, public.email_webhook_replays from authenticated;
grant all on public.email_outbox, public.email_suppressions, public.email_events, public.email_webhook_replays to service_role;

insert into public.system_config (key, value)
values ('email_dispatch_mode', 'dry_run')
on conflict (key) do nothing;

insert into public.cron_config (name, value)
values ('email_dispatch_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Address rules (pure + suppression list).
-- ---------------------------------------------------------------------------
create or replace function public.email_address_deliverable(p_address text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select p_address is not null
     and length(btrim(p_address)) between 6 and 254
     and lower(btrim(p_address)) ~ '^[^[:space:]@<>",;]+@[^[:space:]@<>",;]+\.[^[:space:]@<>",;]{2,}$'
     and lower(btrim(p_address)) !~ '@users\.tyrepulse\.app$'
     and position(chr(10) in p_address) = 0 and position(chr(13) in p_address) = 0
     and not exists (select 1 from public.email_suppressions s where s.address = lower(btrim(p_address)))
$$;

create or replace function public.email_mask(p_address text)
returns text
language sql immutable
set search_path to 'public'
as $$
  select case when p_address is null or position('@' in p_address) < 2 then '***'
              else left(p_address, 1) || '***' || substr(p_address, position('@' in p_address)) end
$$;

-- ---------------------------------------------------------------------------
-- enqueue_email: the only way a row enters the outbox.
--   Staff recipient (p_user_id): must be an active member of p_org; the address
--     is their VERIFIED real address (notify_allowed_emails); locale = their
--     profiles.language. Anything else -> rejected (returns null).
--   External recipient (p_address, no user): admin-configured mailbox; must be
--     deliverable. Audience 'external' (templates hide staff-only fields) or
--     'owner' for platform-level events (p_org null: enquiry / sign-up).
-- Returns the outbox id, or null when rejected or already queued (dedupe).
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_email(
  p_org          uuid,
  p_event_key    text,
  p_template_key text,
  p_user_id      uuid,
  p_address      text,
  p_entity_type  text,
  p_entity_id    text,
  p_data         jsonb,
  p_dedupe_key   text,
  p_locale       text default null,
  p_audience     text default null
)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_addr     text;
  v_locale   text;
  v_audience text;
  v_id       bigint;
begin
  if coalesce(btrim(p_event_key), '') = '' or coalesce(btrim(p_template_key), '') = ''
     or coalesce(btrim(p_dedupe_key), '') = '' then
    return null;
  end if;

  if p_user_id is not null then
    select a.email, lower(coalesce(nullif(p.language, ''), 'en'))
      into v_addr, v_locale
      from public.profiles p
      join public.notify_allowed_emails(array[p_user_id]) a on a.user_id = p.id
     where p.id = p_user_id
       and (p_org is null or p.organisation_id = p_org)
       and coalesce(p.approved, true)
       and not coalesce(p.locked, false);
    if v_addr is null then return null; end if;
    v_audience := coalesce(p_audience, 'staff');
  else
    v_addr := lower(btrim(p_address));
    v_locale := lower(coalesce(p_locale, 'en'));
    v_audience := coalesce(p_audience, case when p_org is null then 'owner' else 'external' end);
  end if;

  if not public.email_address_deliverable(v_addr) then return null; end if;
  v_locale := case when v_locale like 'ar%' then 'ar' else 'en' end;
  if v_audience not in ('staff','external','owner') then v_audience := 'external'; end if;

  insert into public.email_outbox (organisation_id, event_key, template_key, locale, audience,
                                   user_id, to_address, entity_type, entity_id, data, dedupe_key)
  values (p_org, left(p_event_key, 80), left(p_template_key, 80), v_locale, v_audience,
          p_user_id, v_addr, left(p_entity_type, 40), left(p_entity_id, 64),
          coalesce(p_data, '{}'::jsonb), left(p_dedupe_key, 300))
  on conflict (dedupe_key) where status not in ('failed','dead') do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- email_outbox_claim: dispatcher claims up to 20 due rows (SKIP LOCKED).
-- Re-checks every staff recipient at SEND time; one that is no longer an active
-- member of the row's org, or no longer has a verified address, or whose address
-- is now suppressed, is marked 'suppressed' and not returned.
-- Rows stuck in 'sending' for 10+ minutes (crashed run) return to pending.
-- ---------------------------------------------------------------------------
create or replace function public.email_outbox_claim(p_limit integer default 20)
returns table (
  id bigint, organisation_id uuid, event_key text, template_key text, locale text,
  audience text, to_address text, entity_type text, entity_id text, data jsonb,
  dedupe_key text, attempts integer
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.email_outbox o
     set status = 'pending', locked_at = null
   where o.status = 'sending' and o.locked_at < now() - interval '10 minutes';

  update public.email_outbox o
     set status = 'suppressed', last_error = 'recipient no longer eligible', locked_at = null
   where o.status = 'pending' and o.next_attempt_at <= now()
     and (
       not public.email_address_deliverable(o.to_address)
       or (o.user_id is not null and not exists (
             select 1
               from public.profiles p
               join public.notify_allowed_emails(array[o.user_id]) a on a.user_id = p.id
              where p.id = o.user_id
                and a.email = o.to_address
                and (o.organisation_id is null or p.organisation_id = o.organisation_id)
                and coalesce(p.approved, true) and not coalesce(p.locked, false)))
     );

  return query
  with due as (
    select o.id
      from public.email_outbox o
     where o.status = 'pending' and o.next_attempt_at <= now()
     order by o.next_attempt_at, o.id
     limit greatest(1, least(coalesce(p_limit, 20), 20))
     for update skip locked
  )
  update public.email_outbox o
     set status = 'sending', locked_at = now(), attempts = o.attempts + 1
    from due
   where o.id = due.id
  returning o.id, o.organisation_id, o.event_key, o.template_key, o.locale, o.audience,
            o.to_address, o.entity_type, o.entity_id, o.data, o.dedupe_key, o.attempts;
end;
$$;

-- ---------------------------------------------------------------------------
-- email_outbox_report: the dispatcher's verdict for one row.
--   sent      -> sent (provider id stored)
--   dry_run   -> dry_run (rendered, nothing sent)
--   transient -> pending with backoff 1, 2, 4 ... 60 min (honours Retry-After);
--                after 8 attempts -> dead
--   permanent -> failed
-- ---------------------------------------------------------------------------
create or replace function public.email_outbox_report(
  p_id            bigint,
  p_outcome       text,
  p_provider      text default null,
  p_provider_id   text default null,
  p_error         text default null,
  p_retry_after   integer default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_attempts int;
begin
  select attempts into v_attempts from public.email_outbox where id = p_id and status = 'sending' for update;
  if not found then return; end if;

  if p_outcome = 'sent' then
    update public.email_outbox
       set status = 'sent', sent_at = now(), provider = p_provider, provider_message_id = p_provider_id,
           last_error = null, locked_at = null
     where id = p_id;
  elsif p_outcome = 'dry_run' then
    update public.email_outbox
       set status = 'dry_run', provider = 'dry_run', last_error = null, locked_at = null
     where id = p_id;
  elsif p_outcome = 'transient' and v_attempts < 8 then
    update public.email_outbox
       set status = 'pending', locked_at = null, provider = p_provider,
           last_error = left(coalesce(p_error, 'transient failure'), 500),
           next_attempt_at = now() + greatest(
             make_interval(mins => least(power(2, greatest(v_attempts - 1, 0))::int, 60)),
             make_interval(secs => least(coalesce(p_retry_after, 0), 3600)))
     where id = p_id;
  else
    update public.email_outbox
       set status = case when p_outcome = 'transient' then 'dead' else 'failed' end,
           locked_at = null, provider = p_provider,
           last_error = left(coalesce(p_error, 'failed'), 500)
     where id = p_id;
  end if;
end;
$$;

create or replace function public.email_dispatch_mode()
returns text
language sql stable security definer
set search_path to 'public'
as $$
  select case when lower(btrim(coalesce((select value from public.system_config where key = 'email_dispatch_mode'), 'dry_run'), '"')) = 'live'
              then 'live' else 'dry_run' end
$$;

-- Console health: super admin only, no payloads, masked addresses.
create or replace function public.email_outbox_health()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'mode', public.email_dispatch_mode(),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (
        select status, count(*) n from public.email_outbox
         where created_at > now() - interval '7 days' group by status) s), '{}'::jsonb),
    'by_event', coalesce((select jsonb_object_agg(event_key, n) from (
        select event_key, count(*) n from public.email_outbox
         where created_at > now() - interval '7 days' group by event_key) s), '{}'::jsonb),
    'oldest_pending_minutes', (select round(extract(epoch from now() - min(created_at)) / 60)
                                 from public.email_outbox where status = 'pending'),
    'suppressed_addresses', (select count(*) from public.email_suppressions),
    'recent_failures', coalesce((select jsonb_agg(jsonb_build_object(
        'at', created_at, 'event', event_key, 'to', public.email_mask(to_address),
        'status', status, 'error', left(last_error, 160)) order by created_at desc)
        from (select * from public.email_outbox where status in ('failed','dead','suppressed')
               order by created_at desc limit 20) f), '[]'::jsonb)
  );
end;
$$;

-- Kick the dispatcher now (pg_net). Called by the minute cron and, best effort,
-- right after an instant email is queued. Never raises.
create or replace function public.email_dispatch_kick()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_secret text;
begin
  select value into v_secret from public.cron_config where name = 'email_dispatch_secret';
  if v_secret is null then return; end if;
  if not exists (select 1 from public.email_outbox where status = 'pending' and next_attempt_at <= now()) then
    return;
  end if;
  perform net.http_post(
    url     := 'https://jhssdmeruxtrlqnwfksc.supabase.co/functions/v1/email-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-email-dispatch-secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000);
exception when others then
  null;
end;
$$;

do $grants$
declare f text;
begin
  foreach f in array array[
    'public.email_address_deliverable(text)',
    'public.enqueue_email(uuid,text,text,uuid,text,text,text,jsonb,text,text,text)',
    'public.email_outbox_claim(integer)',
    'public.email_outbox_report(bigint,text,text,text,text,integer)',
    'public.email_dispatch_mode()',
    'public.email_dispatch_kick()'
  ] loop
    execute format('grant execute on function %s to service_role', f);
    execute format('revoke execute on function %s from public', f);
    execute format('revoke execute on function %s from anon', f);
    execute format('revoke execute on function %s from authenticated', f);
  end loop;
  -- Health is called from the console by a signed-in super admin.
  execute 'grant execute on function public.email_outbox_health() to authenticated';
  execute 'revoke execute on function public.email_outbox_health() from public';
  execute 'revoke execute on function public.email_outbox_health() from anon';
end
$grants$;
