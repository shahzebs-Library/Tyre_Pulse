-- =============================================================================
-- P0b: workflow-notify true delivery.
-- STATUS: APPLIED LIVE 2026-11-28 (owner OK). Apply only on the owner's OK.
--
-- 1. notify_allowed_emails(): the ONLY answer to "may we email this person".
--    A staff member is emailable only at a REAL, VERIFIED address:
--      profiles.recovery_email when recovery_email_verified_at is set, else the
--      login address when it is not a synthetic @users.tyrepulse.app address and
--      auth.users.email_confirmed_at is set.
--    772 of 776 login addresses are synthetic and can never receive mail;
--    sending to them bounces and hurts the domain's reputation.
--    Executable by service_role only (the edge function), never by clients.
-- 2. deliver_workflow_notifications(): a 2xx from the edge function no longer
--    means "delivered". The function now reports sent/failed/transient totals.
--    sent_total = 0 is NEVER marked delivered; a row where nothing went out but a
--    transient failure happened (429, 5xx, network) is retried with backoff,
--    honouring retry_after_seconds. Nothing deliverable -> 'skipped'; permanent
--    failure only -> 'failed'. Old-format responses (no sent_total) fall back to
--    email + push + whatsapp.
--    A row with a PARTIAL success is not retried (a whole-row retry would
--    duplicate the channels that already went out); its result keeps the detail.
-- Verify (rolled back): see the header of the matching test.
-- Rollback: re-create deliver_workflow_notifications from the V119 body.
-- =============================================================================

create or replace function public.notify_allowed_emails(p_users uuid[])
returns table(user_id uuid, email text)
language sql stable security definer
set search_path to 'public'
as $$
  select p.id,
         lower(btrim(case
           when p.recovery_email_verified_at is not null and nullif(btrim(p.recovery_email),'') is not null
             then p.recovery_email
           else u.email end))
    from public.profiles p
    left join auth.users u on u.id = p.id
   where p.id = any(coalesce(p_users, '{}'::uuid[]))
     and coalesce(p.locked, false) = false
     and (
       (p.recovery_email_verified_at is not null and nullif(btrim(p.recovery_email),'') is not null
        and lower(btrim(p.recovery_email)) !~ '@users\.tyrepulse\.app$')
       or
       (u.email is not null and u.email_confirmed_at is not null
        and lower(btrim(u.email)) !~ '@users\.tyrepulse\.app$')
     )
$$;

grant execute on function public.notify_allowed_emails(uuid[]) to service_role;
revoke execute on function public.notify_allowed_emails(uuid[]) from public;
revoke execute on function public.notify_allowed_emails(uuid[]) from anon;
revoke execute on function public.notify_allowed_emails(uuid[]) from authenticated;

create or replace function public.deliver_workflow_notifications()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d        record;
  r        record;
  v_secret text;
  v_req    bigint;
  v_res    jsonb;
  v_sent   int;
  v_trans  int;
  v_fail   int;
  v_after  int;
  n_sent   int := 0;
  n_done   int := 0;
  n_dead   int := 0;
  n_retry  int := 0;
begin
  for d in
    select wn.id, wn.attempts, wn.request_id
      from public.workflow_notifications wn
     where wn.status = 'pending' and wn.request_id is not null
  loop
    select status_code, content, error_msg into r
      from net._http_response where id = d.request_id;
    if not found then
      continue;
    end if;
    if r.status_code between 200 and 299 then
      begin
        v_res := case when r.content is null then null else (r.content)::jsonb end;
      exception when others then
        v_res := null;
      end;
      v_sent := coalesce(
        (v_res ->> 'sent_total')::int,
        coalesce((v_res ->> 'email')::int, 0) + coalesce((v_res ->> 'push')::int, 0)
          + coalesce((v_res ->> 'whatsapp')::int, 0));
      v_trans := coalesce((v_res ->> 'transient_total')::int, 0);
      v_fail  := coalesce((v_res ->> 'failed_total')::int, 0);
      v_after := coalesce((v_res ->> 'retry_after_seconds')::int, 0);

      if v_sent > 0 then
        update public.workflow_notifications
           set status = 'delivered', delivered_at = now(), response_status = r.status_code,
               result = v_res, last_error = null, request_id = null
         where id = d.id;
        n_done := n_done + 1;
      elsif v_trans > 0 and d.attempts < 6 then
        update public.workflow_notifications
           set response_status = r.status_code, result = v_res, request_id = null,
               last_error = 'transient failure, will retry',
               next_attempt_at = now() + greatest(
                 make_interval(mins => least(power(2, d.attempts)::int, 60)),
                 make_interval(secs => least(v_after, 3600)))
         where id = d.id;
        n_retry := n_retry + 1;
      else
        update public.workflow_notifications
           set status = case when v_fail > 0 or v_trans > 0 then 'failed' else 'skipped' end,
               response_status = r.status_code, result = v_res, request_id = null,
               last_error = case when v_fail > 0 or v_trans > 0 then 'nothing delivered' else null end
         where id = d.id;
        if v_fail > 0 or v_trans > 0 then n_dead := n_dead + 1; end if;
      end if;
    else
      update public.workflow_notifications
         set response_status = r.status_code,
             last_error = left(coalesce(r.error_msg, 'HTTP ' || coalesce(r.status_code::text, '?')), 500),
             request_id = null,
             status = case when d.attempts >= 6 then 'failed' else 'pending' end
       where id = d.id;
      if d.attempts >= 6 then n_dead := n_dead + 1; end if;
    end if;
  end loop;

  select value into v_secret from public.cron_config where name = 'workflow_notify_secret';
  for d in
    select wn.id, wn.payload, wn.attempts
      from public.workflow_notifications wn
     where wn.status = 'pending' and wn.request_id is null
       and wn.next_attempt_at <= now() and wn.attempts < 6
     order by wn.next_attempt_at
     limit 50 for update of wn skip locked
  loop
    v_req := net.http_post(
      url     := 'https://jhssdmeruxtrlqnwfksc.supabase.co/functions/v1/workflow-notify',
      headers := jsonb_strip_nulls(jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', ('Bearer ' || (select value from public.cron_config where name = 'anon_key')),
        'x-workflow-secret', v_secret)),
      body    := d.payload,
      timeout_milliseconds := 15000
    );
    update public.workflow_notifications
       set attempts = d.attempts + 1, request_id = v_req,
           next_attempt_at = now() + make_interval(mins => least(power(2, d.attempts + 1)::int, 60))
     where id = d.id;
    n_sent := n_sent + 1;
  end loop;
  return jsonb_build_object('sent', n_sent, 'delivered', n_done, 'retry', n_retry, 'dead', n_dead);
end;
$function$;
