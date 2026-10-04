-- 20260930181000_webhook_delivery_admin.sql
-- STATUS: applied live 30 Sep 2026 (Control Center, Trust area, API Monitor).
--
-- Webhook delivery log + Resend for the console API Monitor. Super admin only.
--   admin_list_webhooks()                      subscriptions with delivery counts
--                                              (URL reduced to its host; the
--                                              signing secret is never returned)
--   admin_list_webhook_deliveries(limit,status) newest first, across companies
--   admin_resend_webhook_delivery(id, reason)  puts ONE delivery back in the
--                                              queue for one more try, audited
--
-- Resend does not switch a webhook on. deliver_pending_webhooks() only sends for
-- an ACTIVE subscription, so a delivery resent while its webhook is off waits
-- until the webhook is turned back on. The RPC returns will_send so the page
-- can say so. attempts is capped at 5 so the worker (which stops at 6) makes
-- exactly one more try, and the old last_error stays until that try answers.
--
-- Pre-flight: additive (three new functions), no table change, no row touched
-- except the one delivery a super admin resends. Audit: console_sessions via
-- log_console_event semantics (inserted directly, action webhook_resend).
-- Rollback: drop the three functions.

create or replace function public.admin_list_webhooks()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'host', nullif(substring(s.url from '^[a-z]+://([^/?#]+)'), ''),
      'event_types', s.event_types,
      'active', s.active,
      'consecutive_failures', s.consecutive_failures,
      'disabled_reason', s.disabled_reason,
      'last_success_at', s.last_success_at,
      'last_failure_at', s.last_failure_at,
      'created_at', s.created_at,
      'organisation_id', s.organisation_id,
      'organisation_name', (select o.name from public.organisations o where o.id = s.organisation_id),
      'delivered', (select count(*) from public.webhook_deliveries d where d.subscription_id = s.id and d.status = 'delivered'),
      'pending', (select count(*) from public.webhook_deliveries d where d.subscription_id = s.id and d.status = 'pending'),
      'failed', (select count(*) from public.webhook_deliveries d where d.subscription_id = s.id and d.status = 'failed')
    ) order by s.created_at desc)
    from public.webhook_subscriptions s), '[]'::jsonb);
end
$$;

create or replace function public.admin_list_webhook_deliveries(p_limit integer default 50, p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 500));
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.webhook_deliveries d where p_status is null or d.status = p_status),
    'rows', coalesce((
      select jsonb_agg(x order by (x->>'id')::bigint desc) from (
        select jsonb_build_object(
          'id', d.id,
          'subscription_id', d.subscription_id,
          'subscription_name', s.name,
          'subscription_active', s.active,
          'event_type', d.event_type,
          'status', d.status,
          'attempts', d.attempts,
          'response_status', d.response_status,
          'last_error', left(d.last_error, 200),
          'created_at', d.created_at,
          'next_attempt_at', d.next_attempt_at,
          'delivered_at', d.delivered_at
        ) as x
          from public.webhook_deliveries d
          left join public.webhook_subscriptions s on s.id = d.subscription_id
         where p_status is null or d.status = p_status
         order by d.id desc
         limit v_limit) q), '[]'::jsonb));
end
$$;

create or replace function public.admin_resend_webhook_delivery(p_id bigint, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.webhook_deliveries%rowtype;
  v_active boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'A reason is required to resend a delivery.' using errcode = '22023';
  end if;
  select * into v_row from public.webhook_deliveries where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.status = 'delivered' then
    return jsonb_build_object('ok', false, 'reason', 'already_delivered');
  end if;
  if v_row.request_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'in_flight');
  end if;
  select active into v_active from public.webhook_subscriptions where id = v_row.subscription_id;

  update public.webhook_deliveries
     set status = 'pending',
         attempts = least(attempts, 5),
         next_attempt_at = now()
   where id = p_id;

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), 'webhook_resend', null, 'webhook_delivery',
          jsonb_build_object('delivery_id', p_id, 'subscription_id', v_row.subscription_id,
                             'previous_status', v_row.status, 'previous_attempts', v_row.attempts,
                             'webhook_active', coalesce(v_active, false), 'reason', left(v_reason, 500)));

  return jsonb_build_object('ok', true, 'will_send', coalesce(v_active, false),
                            'previous_status', v_row.status);
end
$$;

revoke all on function public.admin_list_webhooks() from public;
revoke all on function public.admin_list_webhooks() from anon;
grant execute on function public.admin_list_webhooks() to authenticated;
revoke all on function public.admin_list_webhook_deliveries(integer, text) from public;
revoke all on function public.admin_list_webhook_deliveries(integer, text) from anon;
grant execute on function public.admin_list_webhook_deliveries(integer, text) to authenticated;
revoke all on function public.admin_resend_webhook_delivery(bigint, text) from public;
revoke all on function public.admin_resend_webhook_delivery(bigint, text) from anon;
grant execute on function public.admin_resend_webhook_delivery(bigint, text) to authenticated;
