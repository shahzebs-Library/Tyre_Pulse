-- ============================================================================
-- QR sign-in hardening (security review 2026-10-04). Feature stays OFF
-- (system_config.qr_login_enabled unset); these close the gaps BEFORE it is on.
--
-- 1. Two secrets. The QR carries only the SCAN secret (used by the phone to
--    approve). The BROWSER secret never leaves the browser that started the
--    request; qr_login_status and the qr-login edge function require it. A
--    photographed / screen-shared QR can no longer be redeemed by an observer.
-- 2. Number matching. The web page shows 2 digits; the phone must pick them
--    from 3 options (qr_login_peek) before approve succeeds. The phone also
--    sees the requesting browser, IP and age. Stops "scan this to verify"
--    QR-jacking.
-- 3. Administrator and super-admin accounts cannot approve a QR sign-in.
-- 4. Per-IP start limit (10/min) instead of one global counter; pg_cron purge
--    of old rows; rows kept 30 days as the audit trail (approver, IPs, UA).
-- 5. get_login_showcase users count scoped to the showcase org.
-- 6. Revoke stray write grants / anon execute flagged by the console review.
-- Rollback: re-apply 20261004121000 function bodies; drop the new columns.
-- ============================================================================

alter table public.qr_login_requests
  add column if not exists browser_hash text,
  add column if not exists match_code   text,
  add column if not exists start_ip     text,
  add column if not exists redeem_ip    text;

create index if not exists qr_login_requests_ip_idx on public.qr_login_requests (start_ip, created_at);

create or replace function public._qr_client_ip()
returns text language sql stable set search_path to 'public' as $$
  select nullif(btrim(split_part(coalesce(
    nullif(current_setting('request.headers', true), '')::json->>'cf-connecting-ip',
    nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for',
    nullif(current_setting('request.headers', true), '')::json->>'x-real-ip', ''), ',', 1)), '')
$$;
revoke all on function public._qr_client_ip() from public, anon, authenticated;

create or replace function public.qr_login_start(p_user_agent text default null)
returns jsonb language plpgsql volatile security definer
set search_path to 'public', 'extensions' as $$
declare
  v_scan    text := encode(gen_random_bytes(24), 'hex');
  v_browser text := encode(gen_random_bytes(24), 'hex');
  v_match   text := (10 + floor(random() * 90))::int::text;
  v_ip      text := public._qr_client_ip();
  v_id uuid;
begin
  if coalesce((select btrim(value, '"') from public.system_config where key = 'qr_login_enabled'), 'false') <> 'true' then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  if v_ip is not null and (select count(*) from public.qr_login_requests
       where start_ip = v_ip and created_at > now() - interval '1 minute') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  if (select count(*) from public.qr_login_requests where created_at > now() - interval '1 minute') > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  insert into public.qr_login_requests (secret_hash, browser_hash, match_code, start_ip, user_agent)
  values (encode(digest(v_scan, 'sha256'), 'hex'), encode(digest(v_browser, 'sha256'), 'hex'),
          v_match, v_ip, left(p_user_agent, 300))
  returning id into v_id;
  -- 'secret' = scan secret (goes in the QR). 'browser_secret' stays in the page.
  return jsonb_build_object('ok', true, 'id', v_id, 'secret', v_scan, 'browser_secret', v_browser,
    'match_code', v_match, 'expires_at', now() + interval '2 minutes');
end $$;

-- Browser-only: needs the browser secret, never the scan secret.
create or replace function public.qr_login_status(p_id uuid, p_secret text)
returns jsonb language plpgsql volatile security definer
set search_path to 'public', 'extensions' as $$
declare r public.qr_login_requests;
begin
  select * into r from public.qr_login_requests
   where id = p_id and browser_hash is not null
     and browser_hash = encode(digest(coalesce(p_secret,''), 'sha256'), 'hex');
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if r.status in ('pending','approved') and r.expires_at < now() then
    update public.qr_login_requests set status = 'expired' where id = r.id;
    return jsonb_build_object('status', 'expired');
  end if;
  return jsonb_build_object('status', r.status);
end $$;

-- Phone-only: what is being approved, plus 3 number options.
create or replace function public.qr_login_peek(p_id uuid, p_secret text)
returns jsonb language plpgsql volatile security definer
set search_path to 'public', 'extensions' as $$
declare r public.qr_login_requests; o1 text; o2 text;
begin
  if auth.uid() is null or not public.is_approved_and_unlocked() then
    raise exception 'Sign in on the phone first' using errcode = '42501';
  end if;
  select * into r from public.qr_login_requests
   where id = p_id and secret_hash = encode(digest(coalesce(p_secret,''), 'sha256'), 'hex');
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if r.status <> 'pending' or r.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', case when r.status = 'pending' then 'expired' else r.status end);
  end if;
  loop o1 := (10 + floor(random() * 90))::int::text; exit when o1 <> r.match_code; end loop;
  loop o2 := (10 + floor(random() * 90))::int::text; exit when o2 <> r.match_code and o2 <> o1; end loop;
  return jsonb_build_object('ok', true,
    'user_agent', r.user_agent, 'ip', r.start_ip,
    'age_seconds', greatest(0, extract(epoch from now() - r.created_at))::int,
    'options', (select jsonb_agg(x order by random()) from unnest(array[r.match_code, o1, o2]) x));
end $$;

-- Old 3-arg signature retired (renamed + revoked, not dropped) so PostgREST has one approve.
alter function public.qr_login_approve(uuid, text, boolean) rename to qr_login_approve_v1_retired;
revoke all on function public.qr_login_approve_v1_retired(uuid, text, boolean) from public, anon, authenticated;
create or replace function public.qr_login_approve(p_id uuid, p_secret text, p_approve boolean default true, p_match text default null)
returns jsonb language plpgsql volatile security definer
set search_path to 'public', 'extensions' as $$
declare r public.qr_login_requests;
begin
  if auth.uid() is null or not public.is_approved_and_unlocked() then
    raise exception 'Sign in on the phone first' using errcode = '42501';
  end if;
  if p_approve and (public.is_super_admin() or lower(coalesce(public.app_role(), '')) = 'admin') then
    return jsonb_build_object('ok', false, 'reason', 'admin');
  end if;
  select * into r from public.qr_login_requests
   where id = p_id and secret_hash = encode(digest(coalesce(p_secret,''), 'sha256'), 'hex')
   for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', r.status); end if;
  if r.expires_at < now() then
    update public.qr_login_requests set status = 'expired' where id = r.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if p_approve and (r.match_code is null or coalesce(btrim(p_match), '') <> r.match_code) then
    -- One wrong pick kills the code, so the 1-in-3 guess cannot be retried.
    update public.qr_login_requests set status = 'denied', approved_at = now() where id = r.id;
    return jsonb_build_object('ok', false, 'reason', 'mismatch');
  end if;
  update public.qr_login_requests
     set status = case when p_approve then 'approved' else 'denied' end,
         approved_by = case when p_approve then auth.uid() end,
         approved_at = now(),
         expires_at = now() + interval '2 minutes'
   where id = r.id;
  return jsonb_build_object('ok', true, 'status', case when p_approve then 'approved' else 'denied' end);
end $$;

revoke all on function public.qr_login_start(text) from public;
revoke all on function public.qr_login_status(uuid, text) from public;
revoke all on function public.qr_login_peek(uuid, text) from public, anon;
revoke all on function public.qr_login_approve(uuid, text, boolean, text) from public, anon;
grant execute on function public.qr_login_start(text) to anon, authenticated;
grant execute on function public.qr_login_status(uuid, text) to anon, authenticated;
grant execute on function public.qr_login_peek(uuid, text) to authenticated;
grant execute on function public.qr_login_approve(uuid, text, boolean, text) to authenticated;

-- Purge: unconsumed codes after 1 hour, consumed (audit) rows after 30 days.
-- (applied live as a separate migration: qr_login_purge_job)
create or replace function public.qr_login_purge()
returns void language sql volatile security definer set search_path to 'public' as $$
  delete from public.qr_login_requests
   where (status <> 'consumed' and created_at < now() - interval '1 hour')
      or created_at < now() - interval '30 days';
$$;
revoke all on function public.qr_login_purge() from public, anon, authenticated;
select cron.schedule('qr-login-purge', '*/15 * * * *', 'select public.qr_login_purge()');

-- Console review leftovers.
revoke insert, update, delete on public.alert_inbox_state, public.error_group_state from authenticated;
grant execute on function public.mask_email_for_console(text) to authenticated, service_role;
revoke execute on function public.mask_email_for_console(text) from public, anon;
grant execute on function public.system_log_group_key(text, text, text) to authenticated, service_role;
revoke execute on function public.system_log_group_key(text, text, text) from public, anon;

-- 5. Showcase user count scoped to the showcase org (applied live as login_showcase_users_org_scope).
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.get_login_showcase()'::regprocedure);
  n := replace(d, 'from public.profiles p where p.approved is true', 'from public.profiles p where p.organisation_id = v_org and p.approved is true');
  if n <> d then execute n; end if;
end $$;
