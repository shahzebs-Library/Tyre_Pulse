-- Sign-in pages rebuilt to the owner's two mockups (user login + admin console).
--
-- 1. get_public_config gains three pre-auth switches:
--      auth_google_enabled, auth_microsoft_enabled  - the buttons render only when
--        the provider is switched on (set after the provider is configured in
--        Supabase Auth). Unset = hidden, so there is never a dead button.
--      qr_login_enabled - the QR panel renders only when on. Off until a Flutter
--        build that can scan it is on testers' phones.
-- 2. get_login_showcase(): anon-readable AGGREGATE COUNTS ONLY for the sign-in
--    hero (vehicles, active, in workshop, sites, users, countries). No names, no
--    rows, no money. Org = the platform's main tenant (the single-tenant default
--    used by handle_new_user / V290).
-- Old rows are pruned by the qr-login edge function (service role).
-- 3. QR sign-in: the browser asks for a one-time code, a signed-in phone approves
--    it, the browser redeems it through the qr-login edge function. Secrets are
--    stored hashed, expire after 2 minutes and work once. The table has RLS on
--    and no policies: only these DEFINER functions touch it.
--
-- Rollback: restore get_public_config's previous key list; drop the functions
-- get_login_showcase, qr_login_start, qr_login_status, qr_login_approve and the
-- table qr_login_requests.

create or replace function public.get_public_config()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from public.system_config
  where key = any (array[
    'maintenance_mode','maintenance_message','registration_open','allow_signups',
    'require_approval','app_version','session_timeout_hours','two_factor_required',
    'password_min_length','default_currency','mobile_login_hero',
    'auth_google_enabled','auth_microsoft_enabled','qr_login_enabled'
  ]);
$function$;

create or replace function public.get_login_showcase()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v jsonb;
begin
  select jsonb_build_object(
    'vehicles',        (select count(*) from public.vehicle_fleet f where f.organisation_id = v_org),
    'active_vehicles', (select count(*) from public.vehicle_fleet f where f.organisation_id = v_org and lower(coalesce(f.status,'')) = 'active'),
    'in_workshop',     (select count(distinct w.asset_no) from public.work_orders w
                          where w.organisation_id = v_org
                            and w.production_out_at is not null and w.production_in_at is null
                            and w.opened_at > now() - interval '120 days'),
    'sites',           (select count(*) from public.sites s where s.organisation_id = v_org),
    'users',           (select count(*) from public.profiles p where p.approved is true and coalesce(p.locked,false) = false),
    'countries',       (select coalesce(jsonb_agg(distinct f.country order by f.country), '[]'::jsonb)
                          from public.vehicle_fleet f where f.organisation_id = v_org and f.country is not null),
    'generated_at',    now()
  ) into v;
  return v;
end
$$;

revoke all on function public.get_login_showcase() from public;
grant execute on function public.get_login_showcase() to anon, authenticated;

create table if not exists public.qr_login_requests (
  id           uuid primary key default gen_random_uuid(),
  secret_hash  text not null,
  status       text not null default 'pending' check (status in ('pending','approved','consumed','expired','denied')),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '2 minutes',
  approved_by  uuid,  -- no FK to auth.users: creating one needs a lock on a busy auth table; the edge function re-checks the user
  approved_at  timestamptz,
  consumed_at  timestamptz,
  user_agent   text
);
alter table public.qr_login_requests enable row level security;
revoke all on public.qr_login_requests from anon, authenticated;
create index if not exists qr_login_requests_created_idx on public.qr_login_requests (created_at);

create or replace function public.qr_login_start(p_user_agent text default null)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_secret text := encode(gen_random_bytes(24), 'hex');
  v_id uuid;
  v_recent int;
begin
  if coalesce((select btrim(value, '"') from public.system_config where key = 'qr_login_enabled'), 'false') <> 'true' then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  select count(*) into v_recent from public.qr_login_requests where created_at > now() - interval '1 minute';
  if v_recent > 300 then
    return jsonb_build_object('ok', false, 'reason', 'busy');
  end if;
  insert into public.qr_login_requests (secret_hash, user_agent)
  values (encode(digest(v_secret, 'sha256'), 'hex'), left(p_user_agent, 300))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'secret', v_secret,
    'expires_at', now() + interval '2 minutes');
end
$$;

create or replace function public.qr_login_status(p_id uuid, p_secret text)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'extensions'
as $$
declare r public.qr_login_requests;
begin
  select * into r from public.qr_login_requests
   where id = p_id and secret_hash = encode(digest(coalesce(p_secret,''), 'sha256'), 'hex');
  if not found then return jsonb_build_object('status', 'invalid'); end if;
  if r.status = 'pending' and r.expires_at < now() then
    update public.qr_login_requests set status = 'expired' where id = r.id;
    return jsonb_build_object('status', 'expired');
  end if;
  return jsonb_build_object('status', r.status);
end
$$;

-- Called by a SIGNED-IN phone after scanning. The phone holds the secret from
-- the QR, so a code seen over someone's shoulder still needs that person's
-- unlocked, approved phone session to be approved.
create or replace function public.qr_login_approve(p_id uuid, p_secret text, p_approve boolean default true)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'extensions'
as $$
declare r public.qr_login_requests;
begin
  if auth.uid() is null or not public.is_approved_and_unlocked() then
    raise exception 'Sign in on the phone first' using errcode = '42501';
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
  update public.qr_login_requests
     set status = case when p_approve then 'approved' else 'denied' end,
         approved_by = case when p_approve then auth.uid() end,
         approved_at = now(),
         -- give the browser a short window to redeem after approval
         expires_at = now() + interval '2 minutes'
   where id = r.id;
  return jsonb_build_object('ok', true, 'status', case when p_approve then 'approved' else 'denied' end);
end
$$;

revoke all on function public.qr_login_start(text) from public;
revoke all on function public.qr_login_status(uuid, text) from public;
revoke all on function public.qr_login_approve(uuid, text, boolean) from public;
grant execute on function public.qr_login_start(text) to anon, authenticated;
grant execute on function public.qr_login_status(uuid, text) to anon, authenticated;
grant execute on function public.qr_login_approve(uuid, text, boolean) to authenticated;
revoke execute on function public.qr_login_approve(uuid, text, boolean) from anon;
