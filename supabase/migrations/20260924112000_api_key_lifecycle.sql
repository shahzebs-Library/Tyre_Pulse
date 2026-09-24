-- ============================================================================
-- 20260924112000_api_key_lifecycle.sql
-- Super-admin API key lifecycle for /console/api-keys.
--
-- STATUS: APPLIED LIVE 2026-09-24 (project jhssdmeruxtrlqnwfksc), verified
--         in a rolled-back transaction (see VERIFY).
--
-- EXTENDS the existing V99 key system (public.api_keys + create_api_key +
-- api_key_authenticate + api_key_usage). No parallel key table is created.
-- developer_api_keys (V194) is a metadata-only registry that public-api never
-- reads, so it is deliberately NOT touched here.
--
-- What this adds:
--   1. api_keys.revoked_at / revoked_by / revoke_reason (nullable, additive).
--      The owner-side revoke_api_key() keeps working unchanged.
--   2. admin_list_api_keys()                  every org, prefix only, never
--      key_hash; usage = api_key_usage for the LAST HOUR ONLY, because
--      api_key_authenticate() prunes that table to one hour on every call.
--      There is no per-request log, so no longer usage history exists.
--   3. admin_revoke_api_key(id, reason)       reason required; audited.
--   4. admin_set_api_key_expiry(id, ts)       set / extend / clear; audited.
--   5. system_config 'api_key_max_age_days'   OPTIONAL policy, read-only
--      finding only. Nothing is ever auto-revoked.
-- Audit: every write lands in BOTH console_sessions and access_audit
-- (entity 'api_key', before/after + reason).
-- All three RPCs: SECURITY DEFINER, search_path public, in-body
-- is_super_admin() raising 42501; EXECUTE revoked from PUBLIC then anon,
-- granted to authenticated.
--
-- VERIFY (rolled back, as super admin d2d43a5f-...):
--   insert a probe key -> admin_list_api_keys contains it with no key_hash;
--   admin_set_api_key_expiry(probe, now()+30d) ok; past date refused;
--   admin_revoke_api_key(probe, '') refused; with reason -> active=false,
--   revoke_reason set; console_sessions + access_audit rows written;
--   as a non-super user every RPC raises 42501. ROLLBACK.
--
-- ROLLBACK:
--   drop function public.admin_list_api_keys();
--   drop function public.admin_revoke_api_key(uuid, text);
--   drop function public.admin_set_api_key_expiry(uuid, timestamptz);
--   alter table public.api_keys drop column revoked_at,
--     drop column revoked_by, drop column revoke_reason;
--   delete from public.system_config where key = 'api_key_max_age_days';
-- ============================================================================

alter table public.api_keys
  add column if not exists revoked_at    timestamptz,
  add column if not exists revoked_by    uuid,
  add column if not exists revoke_reason text;

insert into public.system_config (key, value, description, category)
values ('api_key_max_age_days', '365',
        'Optional policy: API keys older than this many days (or with no expiry) are reported as a finding on the console API Keys page. Nothing is auto-revoked. 0 disables the finding.',
        'security')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- list
create or replace function public.admin_list_api_keys()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_keys   jsonb;
  v_series jsonb;
  v_max    int;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;

  select nullif(btrim(value, ' "'), '')::int into v_max
    from public.system_config
   where key = 'api_key_max_age_days'
     and btrim(value, ' "') ~ '^[0-9]+$';

  select coalesce(jsonb_agg(row_to_json(k)::jsonb order by k.created_at desc), '[]'::jsonb)
    into v_keys
  from (
    select a.id, a.name, a.key_prefix, a.scopes, a.active, a.rate_per_minute,
           a.organisation_id, o.name as organisation_name,
           a.created_by, coalesce(cp.full_name, cp.email) as created_by_name,
           a.created_at, a.last_used_at, a.expires_at,
           a.revoked_at, a.revoked_by, coalesce(rp.full_name, rp.email) as revoked_by_name,
           a.revoke_reason,
           coalesce((select sum(u.count) from public.api_key_usage u
                      where u.key_id = a.id
                        and u.minute >= now() - interval '1 hour'), 0)::int as requests_last_hour
      from public.api_keys a
      left join public.organisations o on o.id = a.organisation_id
      left join public.profiles cp on cp.id = a.created_by
      left join public.profiles rp on rp.id = a.revoked_by
  ) k;

  select coalesce(jsonb_agg(jsonb_build_object('minute', s.minute, 'count', s.cnt) order by s.minute), '[]'::jsonb)
    into v_series
  from (select minute, sum(count)::int as cnt
          from public.api_key_usage
         where minute >= now() - interval '1 hour'
         group by minute) s;

  return jsonb_build_object(
    'keys', v_keys,
    'usage_last_hour', v_series,
    'usage_window', 'last_hour',
    'max_age_days', v_max,
    'generated_at', now()
  );
end $$;

-- ---------------------------------------------------------------- revoke
create or replace function public.admin_revoke_api_key(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.api_keys%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_email  text;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'A revoke reason of at least 5 characters is required' using errcode = '22023';
  end if;

  select * into v_before from public.api_keys where id = p_id for update;
  if not found then
    raise exception 'API key not found' using errcode = 'P0002';
  end if;
  if not v_before.active then
    return jsonb_build_object('ok', false, 'reason', 'already_revoked');
  end if;

  update public.api_keys
     set active = false, revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = left(v_reason, 500)
   where id = p_id;

  select email into v_email from public.profiles where id = auth.uid();

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), 'api_key_revoke', p_id, 'api_key',
          jsonb_build_object('name', v_before.name, 'prefix', v_before.key_prefix,
                             'organisation_id', v_before.organisation_id,
                             'reason', left(v_reason, 500)));

  insert into public.access_audit (actor, actor_email, action, entity, before, after, reason)
  values (auth.uid(), v_email, 'api_key_revoke', 'api_key',
          jsonb_build_object('id', p_id, 'prefix', v_before.key_prefix, 'active', true,
                             'organisation_id', v_before.organisation_id),
          jsonb_build_object('id', p_id, 'prefix', v_before.key_prefix, 'active', false),
          left(v_reason, 500));

  return jsonb_build_object('ok', true, 'id', p_id);
end $$;

-- ---------------------------------------------------------------- expiry
create or replace function public.admin_set_api_key_expiry(p_id uuid, p_expires_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.api_keys%rowtype;
  v_email  text;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Expiry must be in the future (revoke the key instead)' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at > now() + interval '5 years' then
    raise exception 'Expiry cannot be more than 5 years ahead' using errcode = '22023';
  end if;

  select * into v_before from public.api_keys where id = p_id for update;
  if not found then
    raise exception 'API key not found' using errcode = 'P0002';
  end if;
  if not v_before.active then
    raise exception 'A revoked key cannot be given a new expiry' using errcode = '22023';
  end if;

  update public.api_keys set expires_at = p_expires_at where id = p_id;

  select email into v_email from public.profiles where id = auth.uid();

  insert into public.console_sessions (admin_id, action, target_id, target_type, details)
  values (auth.uid(), 'api_key_set_expiry', p_id, 'api_key',
          jsonb_build_object('name', v_before.name, 'prefix', v_before.key_prefix,
                             'from', v_before.expires_at, 'to', p_expires_at));

  insert into public.access_audit (actor, actor_email, action, entity, before, after, reason)
  values (auth.uid(), v_email, 'api_key_set_expiry', 'api_key',
          jsonb_build_object('id', p_id, 'prefix', v_before.key_prefix, 'expires_at', v_before.expires_at),
          jsonb_build_object('id', p_id, 'prefix', v_before.key_prefix, 'expires_at', p_expires_at),
          null);

  return jsonb_build_object('ok', true, 'id', p_id, 'expires_at', p_expires_at);
end $$;

revoke all on function public.admin_list_api_keys() from public;
revoke all on function public.admin_revoke_api_key(uuid, text) from public;
revoke all on function public.admin_set_api_key_expiry(uuid, timestamptz) from public;
revoke all on function public.admin_list_api_keys() from anon;
revoke all on function public.admin_revoke_api_key(uuid, text) from anon;
revoke all on function public.admin_set_api_key_expiry(uuid, timestamptz) from anon;
grant execute on function public.admin_list_api_keys() to authenticated, service_role;
grant execute on function public.admin_revoke_api_key(uuid, text) to authenticated, service_role;
grant execute on function public.admin_set_api_key_expiry(uuid, timestamptz) to authenticated, service_role;
