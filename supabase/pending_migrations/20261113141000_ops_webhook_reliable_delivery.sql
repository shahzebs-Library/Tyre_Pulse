-- OPS-2 (MODC-74): reliable outbound webhook delivery.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE definitions of
--         public.deliver_pending_webhooks(), public.consume_event_webhooks(domain_events),
--         public.admin_resend_webhook_delivery(bigint, text) and the live columns,
--         constraints, indexes and policies of webhook_subscriptions and
--         webhook_deliveries. Not applied to any database. No delivery was triggered.
--         Tested on PGlite only (supabase/tests/ops_webhook_delivery.test.mjs), with
--         pg_net replaced by a stub.
--         NOTE FOR WHOEVER APPLIES IT: this text contains the words "drop" and
--         "delete" (in comments and the rollback note), so the Supabase MCP
--         destructive-statement gate will ask a human to confirm. Nothing here
--         removes data or objects.
--
-- ROOT CAUSE OF "0 delivered, 9 pending since July, 3 failed" (CONFIRMED, read only)
--   The delivery engine itself ran: cron job 5 (deliver-webhooks, every minute)
--   has succeeded on every run, and it did send. What happened:
--   1. Both webhook subscriptions that ever existed (created 2026-07-09 and
--      2026-07-11, both in the current company) point at the ROOT of this
--      product's own website (host contains "tyrepulse", no path). A static
--      website answers a POST with HTTP 405 Method Not Allowed. Every one of the
--      44 attempts got 405. They were test subscriptions, not real receivers.
--   2. After 20 consecutive failures each subscription was auto-disabled
--      ("Auto-disabled after 20 consecutive failures"). Nobody was told: the
--      worker writes no log, no notification and no alert.
--   3. The worker only sends rows whose subscription is ACTIVE, and has no rule
--      for rows that can never be sent. The 9 rows queued just before the
--      auto-disable have sat in status 'pending' since 2026-07-10 and 2026-07-14.
--      3 rows reached 6 attempts and are 'failed'.
--   So: no customer endpoint has ever been registered, and the queue has no
--   expiry, no dead-letter reason and no failure reporting. Nothing was lost.
--
-- OTHER DEFECTS FOUND WHILE READING THE WORKER (INFERRED from the code)
--   a. A response row that pg_net has already purged (it keeps about 6 hours)
--      leaves the delivery "in flight" for ever: the loop does CONTINUE when the
--      response is not found and nothing ever times the request out.
--   b. net.http_post() raising (for example a malformed URL) aborts the WHOLE
--      run, so one bad subscription blocks every company's deliveries.
--   c. The signature covers the body only, so a captured request can be
--      replayed at any later time.
--   d. The only URL rule is "starts with https://": a subscription may point at
--      localhost, a private address or a cloud metadata address.
--   e. LIMIT 50 ordered by time across ALL companies: one company with a large
--      backlog delays every other company.
--   f. A delivery row may carry an organisation different from its
--      subscription's and is sent anyway (the column is nullable, nothing checks).
--
-- WHAT THIS CHANGES
--   Tables (additive columns only, all with defaults; no existing value changes):
--     webhook_deliveries: max_attempts (8), last_attempt_at, dead_at, dead_reason
--     webhook_subscriptions: disabled_at
--   Dead-letter state: status 'failed' IS the dead-letter state (the Integrations
--     page and the console already show and filter it). It now always carries
--     dead_at and dead_reason. No CHECK constraint changes.
--   deliver_pending_webhooks() rewritten (same name, same cron job, same return type):
--     1. Expire: a pending delivery that could not be sent for 72 hours (its
--        webhook is switched off, or its organisation does not match) becomes
--        dead-letter with the reason.
--     2. Collect: 2xx = delivered. Anything else, a timeout, or no response
--        recorded within 15 minutes = one failed attempt.
--     3. Retry with backoff: 2, 4, 8, 16, 32, 60, 60 minutes plus up to 20
--        percent jitter, up to max_attempts (8, about three hours). HTTP 410
--        (Gone) is final at once.
--     4. Send: at most 20 per organisation and 100 per run, each in its own
--        guarded block so one bad row cannot stop the run.
--     5. Signed payloads: the existing X-TyrePulse-Signature header (HMAC-SHA256
--        of the raw body) is kept, and X-TyrePulse-Signature-V2
--        "t=<unix seconds>,v1=<hex>" is added, where v1 = HMAC-SHA256 of
--        "<t>.<raw body>" with the subscription secret. Receivers should verify
--        V2 and reject a timestamp older than five minutes. Also sent:
--        X-TyrePulse-Delivery (delivery id, use it to ignore duplicates),
--        X-TyrePulse-Attempt and X-TyrePulse-Timestamp.
--     6. Per-organisation scoping: a row is sent only when its organisation
--        equals its subscription's organisation.
--     7. Failure reporting: every dead-letter and every auto-disable writes a
--        row to system_logs (module_id 'integrations', source 'webhooks',
--        organisation stamped, no URL and no secret in the text), at most one
--        per subscription and kind per hour.
--   webhook_url_is_safe(text): https only, no credentials in the URL, no
--     localhost, no private, link-local or metadata addresses, no .local or
--     .internal names. Enforced on INSERT and on a URL change by a trigger, and
--     again at send time. It cannot resolve DNS, so a public name that points
--     at a private address is NOT caught (stated limit).
--   Re-enabling a subscription (active false to true) clears its failure
--     counter and disabled reason, so it is not disabled again by old failures.
--   webhook_send_test(subscription_id): the company's own Admin, Manager or
--     Director queues ONE test event ("webhook.test", one attempt, at most one
--     per minute per webhook) so a new endpoint is proven before real events
--     depend on it. This would have shown the HTTP 405 in July within a minute.
--   webhook_retry_delivery(delivery_id): the company's own elevated user puts
--     one dead-letter delivery of their own company back for one more attempt.
--
-- EFFECT ON THE CURRENT COMPANY WHEN APPLIED
--   First cron run after applying: the 9 rows stranded since July become
--   'failed' with dead_reason "Not delivered within 72 hours ..." and one
--   warning row per subscription is written to system_logs. The two disabled
--   test subscriptions stay disabled. Nothing is sent (both are inactive).
--   No other table is touched.
-- RISK TO THE CURRENT COMPANY: low. No active subscription exists, so no
--   delivery behaviour in use changes. The worker keeps its name, schedule and
--   grants.
--
-- VERIFY (read only, after applying)
--   select status, count(*), max(dead_reason) from public.webhook_deliveries group by 1;
--     -- expect: failed 12 (3 old with no reason, 9 with the 72 hour reason), pending 0
--   select public.webhook_url_is_safe('https://hooks.example.com/x'),      -- t
--          public.webhook_url_is_safe('http://hooks.example.com/x'),       -- f
--          public.webhook_url_is_safe('https://127.0.0.1/x'),              -- f
--          public.webhook_url_is_safe('https://169.254.169.254/latest');   -- f
--   select has_function_privilege('anon', 'public.deliver_pending_webhooks()', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.deliver_pending_webhooks()', 'EXECUTE'),
--          has_function_privilege('anon', 'public.webhook_send_test(uuid)', 'EXECUTE');
--     -- expect f, f, f
--   select source, severity, count(*) from public.system_logs where source = 'webhooks' group by 1, 2;
--   End to end proof (owner decision, sends ONE real request): create a webhook
--   to a receiver you control, press "Send test", confirm 200 and that the V2
--   signature verifies with the shown secret.
--
-- ROLLBACK
--   Re-create public.deliver_pending_webhooks() from the body recorded in
--   docs/commercial-readiness/audit/CURRENT_PRODUCTION_FIXES_B.md (section 2,
--   "previous worker"), then:
--     drop trigger if exists trg_webhook_subscription_guard on public.webhook_subscriptions;
--     drop function if exists public.webhook_subscription_guard();
--     drop function if exists public.webhook_send_test(uuid);
--     drop function if exists public.webhook_retry_delivery(bigint);
--     drop function if exists public._webhook_log(uuid, text, text, text, jsonb);
--     drop function if exists public._webhook_backoff(integer);
--     drop function if exists public.webhook_url_is_safe(text);
--     drop sequence if exists public.webhook_test_event_seq;
--   The added columns are harmless and may stay.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.webhook_deliveries
  add column if not exists max_attempts    integer not null default 8,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists dead_at         timestamptz,
  add column if not exists dead_reason     text;

alter table public.webhook_subscriptions
  add column if not exists disabled_at timestamptz;

create sequence if not exists public.webhook_test_event_seq;
revoke all on sequence public.webhook_test_event_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. URL safety
-- ---------------------------------------------------------------------------
create or replace function public.webhook_url_is_safe(p_url text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_url  text := btrim(coalesce(p_url, ''));
  v_auth text;
  v_host text;
begin
  if v_url !~* '^https://' then return false; end if;
  if v_url ~ '[[:space:]]' then return false; end if;
  -- authority = everything between "https://" and the first / ? or #
  v_auth := substring(v_url from '^[hH][tT][tT][pP][sS]://([^/?#]*)');
  if v_auth is null or v_auth = '' then return false; end if;
  -- credentials in the URL are never allowed
  if position('@' in v_auth) > 0 then return false; end if;
  -- IPv6 literals are refused outright (no safe public use for a webhook)
  if left(v_auth, 1) = '[' then return false; end if;
  v_host := lower(split_part(v_auth, ':', 1));
  if v_host = '' then return false; end if;
  if v_host = 'localhost' or v_host like '%.localhost' then return false; end if;
  if v_host like '%.local' or v_host like '%.internal' or v_host like '%.lan' then return false; end if;
  -- a bare name with no dot is an internal name
  if position('.' in v_host) = 0 then return false; end if;
  -- IPv4 literals: refuse every private, loopback, link-local and unspecified range
  if v_host ~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' then
    if v_host ~ '^(0|10|127)\.' then return false; end if;
    if v_host ~ '^169\.254\.' then return false; end if;
    if v_host ~ '^192\.168\.' then return false; end if;
    if v_host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.' then return false; end if;
    if v_host ~ '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.' then return false; end if;
  end if;
  return true;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- Minutes to wait after the Nth failed attempt: 2, 4, 8, 16, 32, 60, 60 ...
create or replace function public._webhook_backoff(p_attempts integer)
returns interval
language sql
immutable
set search_path = public
as $$
  select make_interval(mins => least(power(2, greatest(coalesce(p_attempts, 1), 1))::int, 60));
$$;

-- Failure reporting. Never raises (reporting must not break delivery) and
-- writes at most one row per fingerprint per hour. No URL, no secret.
create or replace function public._webhook_log(
  p_org uuid, p_severity text, p_fingerprint text, p_message text, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.system_logs l
              where l.error_fingerprint = p_fingerprint
                and l.created_at > now() - interval '1 hour') then
    return;
  end if;
  insert into public.system_logs (organisation_id, module_id, severity, source, message, detail, error_fingerprint)
  values (p_org, 'integrations', p_severity, 'webhooks', left(p_message, 500), coalesce(p_detail, '{}'::jsonb), p_fingerprint);
exception when others then
  null;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Subscription guard: safe URL on write, clean slate on re-enable
-- ---------------------------------------------------------------------------
create or replace function public.webhook_subscription_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.url is distinct from old.url then
    if not public.webhook_url_is_safe(new.url) then
      raise exception 'This webhook address is not allowed. Use a public https address (no localhost, private network or internal names).'
        using errcode = '22023';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.active and not old.active then
      new.consecutive_failures := 0;
      new.disabled_reason := null;
      new.disabled_at := null;
    elsif old.active and not new.active and new.disabled_at is null then
      new.disabled_at := now();
    end if;
  end if;
  return new;
end
$$;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_webhook_subscription_guard'
                    and tgrelid = 'public.webhook_subscriptions'::regclass) then
    create trigger trg_webhook_subscription_guard
      before insert or update on public.webhook_subscriptions
      for each row execute function public.webhook_subscription_guard();
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. The worker
-- ---------------------------------------------------------------------------
create or replace function public.deliver_pending_webhooks()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d         record;
  r         record;
  v_found   boolean;
  v_code    integer;
  v_err     text;
  v_final   boolean;
  v_disable boolean;
  v_body    text;
  v_ts      text;
  v_req     bigint;
  n_sent    int := 0;
  n_done    int := 0;
  n_dead    int := 0;
  n_retry   int := 0;
  n_expired int := 0;
begin
  -- 1. EXPIRE: pending rows that could not be sent for 72 hours.
  for d in
    select wd.id, wd.subscription_id, wd.organisation_id, s.organisation_id as sub_org, s.active
      from public.webhook_deliveries wd
      join public.webhook_subscriptions s on s.id = wd.subscription_id
     where wd.status = 'pending' and wd.request_id is null
       and wd.created_at < now() - interval '72 hours'
     order by wd.id
     limit 500
     for update of wd skip locked
  loop
    update public.webhook_deliveries
       set status = 'failed', dead_at = now(),
           dead_reason = case
             when d.organisation_id is distinct from d.sub_org
               then 'Not sent: the delivery and its webhook belong to different organisations.'
             when not d.active
               then 'Not delivered within 72 hours because the webhook was switched off.'
             else 'Not delivered within 72 hours.' end
     where id = d.id;
    n_expired := n_expired + 1;
    perform public._webhook_log(d.sub_org, 'warning', 'webhook:expired:' || d.subscription_id,
      'Webhook deliveries expired without being sent. Open API and Webhooks, check the webhook and retry the deliveries if they are still wanted.',
      jsonb_build_object('subscription_id', d.subscription_id, 'first_delivery_id', d.id));
  end loop;

  -- 2. COLLECT: results of requests that are in flight.
  for d in
    select wd.id, wd.subscription_id, wd.attempts, wd.max_attempts, wd.request_id, wd.last_attempt_at,
           s.organisation_id as sub_org
      from public.webhook_deliveries wd
      join public.webhook_subscriptions s on s.id = wd.subscription_id
     where wd.status = 'pending' and wd.request_id is not null
     order by wd.id
     for update of wd skip locked
  loop
    select status_code, error_msg, coalesce(timed_out, false) as timed_out
      into r from net._http_response where id = d.request_id;
    v_found := found;
    if not v_found then
      -- No answer yet. Give it 15 minutes (the request timeout is 10 seconds
      -- and pg_net keeps answers for hours), then count it as a failed attempt.
      if coalesce(d.last_attempt_at, now()) > now() - interval '15 minutes' then
        continue;
      end if;
      v_code := null;
      v_err  := 'No response was recorded for this attempt.';
    else
      v_code := r.status_code;
      v_err  := case when r.timed_out then 'The receiver did not answer within 10 seconds.'
                     else coalesce(nullif(r.error_msg, ''), 'HTTP ' || coalesce(r.status_code::text, '?')) end;
    end if;

    if v_found and v_code between 200 and 299 then
      update public.webhook_deliveries
         set status = 'delivered', delivered_at = now(), response_status = v_code,
             last_error = null, request_id = null, dead_at = null, dead_reason = null
       where id = d.id;
      update public.webhook_subscriptions
         set last_success_at = now(), consecutive_failures = 0
       where id = d.subscription_id;
      n_done := n_done + 1;
      continue;
    end if;

    -- A failed attempt. 410 Gone means the receiver has retired the address.
    v_final := d.attempts >= d.max_attempts or v_code = 410;
    update public.webhook_deliveries
       set response_status = v_code,
           last_error = left(v_err, 500),
           request_id = null,
           status = case when v_final then 'failed' else 'pending' end,
           dead_at = case when v_final then now() end,
           dead_reason = case
             when v_code = 410 then 'The receiver answered 410 Gone, so it will not be retried.'
             when v_final then 'Gave up after ' || d.attempts || ' attempts. Last answer: ' || left(v_err, 200)
           end,
           next_attempt_at = case when v_final then next_attempt_at
             else now() + public._webhook_backoff(d.attempts) * (1 + random() * 0.2) end
     where id = d.id;

    update public.webhook_subscriptions s
       set last_failure_at = now(),
           consecutive_failures = s.consecutive_failures + 1,
           active = case when s.consecutive_failures + 1 >= 20 or v_code = 410 then false else s.active end,
           disabled_reason = case
             when v_code = 410 then 'Switched off: the receiver answered 410 Gone'
             when s.consecutive_failures + 1 >= 20 then 'Auto-disabled after 20 consecutive failures'
             else s.disabled_reason end,
           disabled_at = case when (s.consecutive_failures + 1 >= 20 or v_code = 410) and s.active then now() else s.disabled_at end
     where s.id = d.subscription_id
     returning (not s.active and s.disabled_at = now()) into v_disable;

    if v_final then
      n_dead := n_dead + 1;
      perform public._webhook_log(d.sub_org, 'error', 'webhook:dead:' || d.subscription_id,
        'A webhook delivery could not be delivered and was moved to failed. Open API and Webhooks to see the receiver answer and retry.',
        jsonb_build_object('subscription_id', d.subscription_id, 'delivery_id', d.id,
                           'attempts', d.attempts, 'response_status', v_code, 'last_error', left(v_err, 200)));
    else
      n_retry := n_retry + 1;
    end if;
    if coalesce(v_disable, false) then
      perform public._webhook_log(d.sub_org, 'error', 'webhook:disabled:' || d.subscription_id,
        'A webhook was switched off automatically because its receiver keeps failing. Events for it are no longer queued. Fix the receiver, then switch the webhook back on in API and Webhooks.',
        jsonb_build_object('subscription_id', d.subscription_id, 'response_status', v_code, 'last_error', left(v_err, 200)));
    end if;
  end loop;

  -- 3. SEND: due rows, at most 20 per organisation and 100 per run.
  for d in
    select wd.id, wd.payload, wd.attempts, wd.max_attempts, wd.event_type, wd.subscription_id,
           s.url, s.secret, s.organisation_id as sub_org
      from public.webhook_deliveries wd
      join public.webhook_subscriptions s on s.id = wd.subscription_id
     where wd.id in (
             select q.id from (
               select w2.id,
                      row_number() over (partition by w2.organisation_id order by w2.next_attempt_at, w2.id) as rn
                 from public.webhook_deliveries w2
                where w2.status = 'pending' and w2.request_id is null and w2.next_attempt_at <= now()
             ) q where q.rn <= 20)
       and wd.status = 'pending' and wd.request_id is null
       and wd.next_attempt_at <= now()
       and wd.attempts < wd.max_attempts
       and s.active
       and s.organisation_id is not distinct from wd.organisation_id
     order by wd.next_attempt_at, wd.id
     limit 100
     for update of wd skip locked
  loop
    begin
      if not public.webhook_url_is_safe(d.url) then
        update public.webhook_deliveries
           set status = 'failed', dead_at = now(), last_error = 'Blocked address',
               dead_reason = 'Not sent: the webhook address is not a public https address.'
         where id = d.id;
        n_dead := n_dead + 1;
        perform public._webhook_log(d.sub_org, 'error', 'webhook:blocked:' || d.subscription_id,
          'A webhook delivery was not sent because the webhook address is not a public https address.',
          jsonb_build_object('subscription_id', d.subscription_id, 'delivery_id', d.id));
        continue;
      end if;

      -- pg_net sends the jsonb body as its text form, so sign exactly that text.
      v_body := d.payload::text;
      v_ts   := floor(extract(epoch from clock_timestamp()))::bigint::text;
      v_req := net.http_post(
        url     := d.url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'User-Agent', 'TyrePulse-Webhooks/1.1',
          'X-TyrePulse-Event', d.event_type,
          'X-TyrePulse-Delivery', d.id::text,
          'X-TyrePulse-Attempt', (d.attempts + 1)::text,
          'X-TyrePulse-Timestamp', v_ts,
          'X-TyrePulse-Signature', 'sha256=' || encode(hmac(v_body, d.secret, 'sha256'), 'hex'),
          'X-TyrePulse-Signature-V2', 't=' || v_ts || ',v1=' || encode(hmac(v_ts || '.' || v_body, d.secret, 'sha256'), 'hex')),
        body    := d.payload,
        timeout_milliseconds := 10000
      );
      update public.webhook_deliveries
         set attempts = d.attempts + 1, request_id = v_req, last_attempt_at = now()
       where id = d.id;
      n_sent := n_sent + 1;
    exception when others then
      -- The request could not even be queued. Count it as a failed attempt so
      -- one bad row never stops the run for every other organisation.
      v_final := d.attempts + 1 >= d.max_attempts;
      update public.webhook_deliveries
         set attempts = d.attempts + 1, last_attempt_at = now(), request_id = null,
             last_error = left('Could not send: ' || sqlerrm, 500),
             status = case when v_final then 'failed' else 'pending' end,
             dead_at = case when v_final then now() end,
             dead_reason = case when v_final then 'Gave up after ' || (d.attempts + 1) || ' attempts. The request could not be sent.' end,
             next_attempt_at = now() + public._webhook_backoff(d.attempts + 1)
       where id = d.id;
      if v_final then
        n_dead := n_dead + 1;
        perform public._webhook_log(d.sub_org, 'error', 'webhook:dead:' || d.subscription_id,
          'A webhook delivery could not be sent and was moved to failed.',
          jsonb_build_object('subscription_id', d.subscription_id, 'delivery_id', d.id, 'attempts', d.attempts + 1));
      else
        n_retry := n_retry + 1;
      end if;
    end;
  end loop;

  return jsonb_build_object('sent', n_sent, 'delivered', n_done, 'dead', n_dead,
                            'retrying', n_retry, 'expired', n_expired);
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Customer-facing RPCs (own organisation only)
-- ---------------------------------------------------------------------------
create or replace function public.webhook_send_test(p_subscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s    public.webhook_subscriptions%rowtype;
  v_ev bigint;
  v_id bigint;
begin
  if not coalesce(public.is_elevated_user(), false) then
    raise exception 'You do not have permission to test a webhook.' using errcode = '42501';
  end if;
  select * into s from public.webhook_subscriptions
   where id = p_subscription_id and organisation_id = public.app_current_org();
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if not s.active then
    return jsonb_build_object('ok', false, 'reason', 'webhook_inactive');
  end if;
  if exists (select 1 from public.webhook_deliveries d
              where d.subscription_id = s.id and d.event_type = 'webhook.test'
                and d.created_at > now() - interval '1 minute') then
    return jsonb_build_object('ok', false, 'reason', 'too_soon');
  end if;
  -- Test events use negative ids so they can never collide with a real event.
  v_ev := -nextval('public.webhook_test_event_seq');
  insert into public.webhook_deliveries
    (subscription_id, event_id, organisation_id, event_type, payload, max_attempts)
  values (s.id, v_ev, s.organisation_id, 'webhook.test',
          jsonb_build_object('id', v_ev, 'type', 'webhook.test', 'entity_type', 'webhook',
            'entity_id', s.id, 'created_at', now(),
            'data', jsonb_build_object('message', 'Test event from Tyre Pulse. No business data is included.')),
          1)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'delivery_id', v_id);
end
$$;

create or replace function public.webhook_retry_delivery(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.webhook_deliveries%rowtype;
  v_active boolean;
begin
  if not coalesce(public.is_elevated_user(), false) then
    raise exception 'You do not have permission to retry a delivery.' using errcode = '42501';
  end if;
  select d.* into v_row
    from public.webhook_deliveries d
    join public.webhook_subscriptions s on s.id = d.subscription_id
   where d.id = p_id
     and d.organisation_id = public.app_current_org()
     and s.organisation_id = public.app_current_org()
   for update of d;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.status <> 'failed' then
    return jsonb_build_object('ok', false, 'reason', case when v_row.status = 'delivered' then 'already_delivered' else 'still_pending' end);
  end if;
  select active into v_active from public.webhook_subscriptions where id = v_row.subscription_id;
  if not coalesce(v_active, false) then
    return jsonb_build_object('ok', false, 'reason', 'webhook_inactive');
  end if;
  -- Exactly one more attempt.
  update public.webhook_deliveries
     set status = 'pending', request_id = null, next_attempt_at = now(),
         max_attempts = attempts + 1, dead_at = null, dead_reason = null
   where id = p_id;
  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants. The worker and helpers are for cron (owner) only.
-- ---------------------------------------------------------------------------
revoke all on function public.deliver_pending_webhooks() from public, anon, authenticated;
revoke all on function public._webhook_log(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public._webhook_backoff(integer) from public, anon, authenticated;
revoke all on function public.webhook_subscription_guard() from public, anon, authenticated;
revoke all on function public.webhook_send_test(uuid) from public, anon;
revoke all on function public.webhook_retry_delivery(bigint) from public, anon;
grant execute on function public.webhook_send_test(uuid) to authenticated;
grant execute on function public.webhook_retry_delivery(bigint) to authenticated;
grant execute on function public.webhook_url_is_safe(text) to authenticated;

comment on column public.webhook_deliveries.dead_reason is
  'Why a delivery ended in status failed (the dead-letter state). Null on rows that failed before 2026-11.';
