-- =============================================================================
-- 20260924117000_access_policies.sql
-- Access Policies: (1) a console IP allowlist, (2) SSO enforcement per org.
--
-- STATUS: APPLIED LIVE 2026-09-25 (project jhssdmeruxtrlqnwfksc) via Supabase MCP
--         apply_migration 'access_policies'. Body below is exactly what was applied.
--         console_ip_allowlist_enabled is left 'false' (OFF). No org has SSO
--         enforcement on (there are 0 sso_connections and 0 auth.sso_providers).
--
-- WHAT IT DOES
--   1. console_ip_allowlist: CIDR entries (label, cidr, active, created_by).
--      RLS on, super-admin SELECT only, NO client write grant: every write goes
--      through the SECURITY DEFINER RPCs below.
--   2. system_config 'console_ip_allowlist_enabled' seeded 'false'. A guard
--      trigger refuses any direct write that changes it; only
--      admin_set_console_ip_allowlist() may flip it.
--   3. console_check_access(): the console calls this after a super admin signs
--      in. Reads the caller IP from the request headers PostgREST exposes:
--        cf-connecting-ip  (set by Cloudflare in front of Supabase; the client
--                           cannot forge it)  ->  x-forwarded-for FIRST hop  ->
--        x-real-ip.
--      NOTE: the first x-forwarded-for hop is only trustworthy when an edge
--      proxy REPLACES the header. If the edge APPENDS, a client can prepend its
--      own value. That is why cf-connecting-ip is preferred when present.
--      Disabled -> allowed. Enabled and IP unknown -> refused. Enabled and no
--      active entry covers the IP -> refused.
--   4. SSO enforcement REUSES sso_connections.enforce_sso (V200). An org
--      "requires SSO" for an email domain when an ACTIVE connection in that org
--      has enforce_sso = true and lists the domain. sso_password_login_check()
--      is called by the main-app sign-in right after a password sign-in
--      succeeds; when it says no, the app signs the session out.
--
-- WHY THE SSO CHECK IS AUTHENTICATED, NOT ANON
--   A pre-auth (anon) "does this identifier need SSO?" RPC is an account
--   enumeration oracle: it tells a stranger that an address exists and which
--   org it belongs to. Checking AFTER the password has been proven means the
--   answer is only ever given to the account holder. So nothing here is
--   granted to anon.
--
-- LOCKOUT SAFETY
--   * IP allowlist: enabling is refused unless the caller's CURRENT IP is known
--     and covered by an active entry. Deactivating or deleting an entry is
--     refused while the allowlist is on if it would leave the caller's own IP
--     uncovered. The client FAILS OPEN on an RPC error (a bug can never lock
--     the owner out); the server itself is strict.
--   * SSO: turning it on for an org is refused unless that org has at least one
--     ACTIVE connection with domains AND every such domain is registered in
--     Supabase Auth (auth.sso_domains). Otherwise nobody in that org could sign
--     in at all. Super admins are ALWAYS exempt (break-glass).
--
-- BREAK-GLASS (locked out of the console by the IP policy):
--   From the Supabase SQL editor (runs as postgres, bypasses the console):
--     select set_config('app.access_policy_rpc', 'on', true);
--     update public.system_config set value = 'false'
--      where key = 'console_ip_allowlist_enabled';
--   (run both lines in ONE execution so the setting is still in force.)
--   Or with the Supabase CLI:
--     npx supabase db query --linked --project-ref jhssdmeruxtrlqnwfksc \
--       "select set_config('app.access_policy_rpc','on',true); update public.system_config set value='false' where key='console_ip_allowlist_enabled';"
--   To lift SSO enforcement for an org the same way:
--     update public.sso_connections set enforce_sso = false where organisation_id = '<org>';
--
-- ENFORCEMENT GAPS (stated, not hidden)
--   * The IP allowlist gates the CONSOLE UI only. A super admin's JWT can still
--     reach PostgREST/RPCs directly from any IP; RLS is not IP-aware.
--     [2026-09-25: the console WRITE RPCs are now gated server-side by
--     20260924126000_console_ip_server_enforcement.sql; reads are not.]
--   * SSO enforcement is app-level: a client calling supabase-js
--     signInWithPassword directly still obtains a session. [2026-09-25: the
--     Expo mobile app now calls sso_password_login_check after sign-in, code
--     only, awaiting an EAS build; the Flutter app does not yet.]
--   * Real SSO sign-in needs an IdP registered in Supabase Auth (Management
--     API). 0 providers are registered today.
--
-- VERIFY (rolled-back, impersonating the super admin d2d43a5f-...):
--   select set_config('request.jwt.claims','{"sub":"d2d43a5f-0906-4f7a-9577-e36d89164914","role":"authenticated"}',true);
--   select set_config('request.headers','{"x-forwarded-for":"203.0.113.9, 10.0.0.1"}',true);
--   set local role authenticated;
--   select console_check_access();                              -- allowed, reason disabled
--   select admin_set_console_ip_allowlist(true,'test');          -- refused, IP not covered
--   select admin_ip_allowlist_add('office','203.0.113.0/24');
--   select admin_set_console_ip_allowlist(true,'test');          -- ok
--   select console_check_access();                              -- allowed, reason matched
--   select set_config('request.headers','{"x-forwarded-for":"198.51.100.4"}',true);
--   select console_check_access();                              -- refused, not_listed
--   -- as a non-super: every admin_* RPC raises 42501
--
-- ROLLBACK
--   drop trigger if exists trg_guard_access_policy_config on public.system_config;
--   drop function if exists public.guard_access_policy_config();
--   drop function if exists public.admin_get_access_policies();
--   drop function if exists public.admin_set_sso_required(uuid, boolean, text);
--   drop function if exists public.sso_password_login_check();
--   drop function if exists public._sso_enforced_domains(uuid);
--   drop function if exists public.admin_set_console_ip_allowlist(boolean, text);
--   drop function if exists public.admin_ip_allowlist_delete(uuid);
--   drop function if exists public.admin_ip_allowlist_set_active(uuid, boolean);
--   drop function if exists public.admin_ip_allowlist_add(text, text);
--   drop function if exists public.console_check_access();
--   drop function if exists public._ip_covered(inet);
--   drop function if exists public._ip_allowlist_on();
--   drop function if exists public._request_client_ip();
--   drop function if exists public._access_policy_audit(text, uuid, text, jsonb);
--   drop table if exists public.console_ip_allowlist;
--   select set_config('app.access_policy_rpc','on',true);
--   delete from public.system_config where key = 'console_ip_allowlist_enabled';
-- =============================================================================

-- ── 1. table ─────────────────────────────────────────────────────────────────
create table if not exists public.console_ip_allowlist (
  id          uuid primary key default gen_random_uuid(),
  label       text not null check (char_length(btrim(label)) between 1 and 120),
  cidr        cidr not null,
  active      boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint console_ip_allowlist_cidr_uq unique (cidr)
);
create index if not exists console_ip_allowlist_active_idx
  on public.console_ip_allowlist (active);

alter table public.console_ip_allowlist enable row level security;
drop policy if exists console_ip_allowlist_super_select on public.console_ip_allowlist;
create policy console_ip_allowlist_super_select on public.console_ip_allowlist
  for select to authenticated using ((select public.is_super_admin()));
revoke all on public.console_ip_allowlist from public, anon, authenticated;
grant select on public.console_ip_allowlist to authenticated;

-- ── 2. config key + guard ────────────────────────────────────────────────────
create or replace function public.guard_access_policy_config()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rpc boolean := coalesce(current_setting('app.access_policy_rpc', true), '') = 'on';
        v_cur text;
begin
  if v_rpc then return coalesce(NEW, OLD); end if;
  if TG_OP = 'DELETE' then
    if OLD.key = 'console_ip_allowlist_enabled' then
      raise exception 'The console IP allowlist can only be changed from Console, Access Policies.' using errcode = '42501';
    end if;
    return OLD;
  end if;
  if TG_OP = 'INSERT' then
    if NEW.key = 'console_ip_allowlist_enabled' then
      select value into v_cur from public.system_config where key = 'console_ip_allowlist_enabled';
      -- the System Configuration page upserts every loaded key: an unchanged value passes
      if v_cur is null or v_cur is distinct from NEW.value then
        raise exception 'The console IP allowlist can only be changed from Console, Access Policies.' using errcode = '42501';
      end if;
    end if;
    return NEW;
  end if;
  if (OLD.key = 'console_ip_allowlist_enabled' or NEW.key = 'console_ip_allowlist_enabled')
     and (NEW.key is distinct from OLD.key or NEW.value is distinct from OLD.value) then
    raise exception 'The console IP allowlist can only be changed from Console, Access Policies.' using errcode = '42501';
  end if;
  return NEW;
end $$;
revoke all on function public.guard_access_policy_config() from public, anon, authenticated;

drop trigger if exists trg_guard_access_policy_config on public.system_config;
create trigger trg_guard_access_policy_config
  before insert or update or delete on public.system_config
  for each row execute function public.guard_access_policy_config();

select set_config('app.access_policy_rpc', 'on', true);
insert into public.system_config (key, value, category, description)
values ('console_ip_allowlist_enabled', 'false', 'security',
        'Only allow the super-admin console from listed IP ranges. Change it from Console, Access Policies.')
on conflict (key) do nothing;
select set_config('app.access_policy_rpc', '', true);

-- ── 3. helpers (not executable by any client role) ───────────────────────────
create or replace function public._access_policy_audit(p_action text, p_target uuid, p_type text, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.console_sessions (admin_id, action, target_id, target_type, details, ip_address)
  values (auth.uid(), p_action, p_target, p_type, coalesce(p_details, '{}'::jsonb), public._request_client_ip());
end $$;

create or replace function public._request_client_ip()
returns inet language plpgsql stable security definer set search_path = public as $$
declare h json; v text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then return null;
  end;
  if h is null then return null; end if;
  v := nullif(btrim(h->>'cf-connecting-ip'), '');
  if v is null then v := nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''); end if;
  if v is null then v := nullif(btrim(h->>'x-real-ip'), ''); end if;
  if v is null then return null; end if;
  begin
    return host(v::inet)::inet;
  exception when others then return null;
  end;
end $$;

create or replace function public._ip_allowlist_on()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select lower(btrim(value, ' "')) from public.system_config
                    where key = 'console_ip_allowlist_enabled'), 'false') = 'true'
$$;

create or replace function public._ip_covered(p_ip inet)
returns boolean language sql stable security definer set search_path = public as $$
  select p_ip is not null and exists (
    select 1 from public.console_ip_allowlist a
     where a.active and family(a.cidr) = family(p_ip) and p_ip <<= a.cidr)
$$;

revoke all on function public._access_policy_audit(text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public._request_client_ip() from public, anon, authenticated;
revoke all on function public._ip_allowlist_on() from public, anon, authenticated;
revoke all on function public._ip_covered(inet) from public, anon, authenticated;

-- ── 4. the console check ─────────────────────────────────────────────────────
create or replace function public.console_check_access()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ip inet := public._request_client_ip();
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if not public._ip_allowlist_on() then
    return jsonb_build_object('allowed', true, 'enabled', false, 'reason', 'disabled', 'ip', host(v_ip));
  end if;
  if v_ip is null then
    return jsonb_build_object('allowed', false, 'enabled', true, 'reason', 'ip_unknown', 'ip', null);
  end if;
  if public._ip_covered(v_ip) then
    return jsonb_build_object('allowed', true, 'enabled', true, 'reason', 'matched', 'ip', host(v_ip));
  end if;
  return jsonb_build_object('allowed', false, 'enabled', true, 'reason', 'not_listed', 'ip', host(v_ip));
end $$;

-- ── 5. allowlist writes ──────────────────────────────────────────────────────
create or replace function public.admin_ip_allowlist_add(p_label text, p_cidr text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cidr cidr; v_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_label, ''))) not between 1 and 120 then
    raise exception 'Give the range a label of 1 to 120 characters.' using errcode = '22023';
  end if;
  begin
    -- normalise: '10.0.0.5/24' -> 10.0.0.0/24, a bare address -> /32 or /128
    v_cidr := network(btrim(p_cidr)::inet)::cidr;
  exception when others then
    raise exception 'That is not a valid IP address or CIDR range.' using errcode = '22023';
  end;
  if masklen(v_cidr) = 0 then
    raise exception 'A /0 range allows every address. Turn the allowlist off instead.' using errcode = '22023';
  end if;
  if exists (select 1 from public.console_ip_allowlist where cidr = v_cidr) then
    raise exception 'That range is already on the list.' using errcode = '22023';
  end if;
  insert into public.console_ip_allowlist (label, cidr) values (btrim(p_label), v_cidr) returning id into v_id;
  perform public._access_policy_audit('ip_allowlist_add', v_id, 'console_ip_allowlist',
    jsonb_build_object('label', btrim(p_label), 'cidr', v_cidr::text));
  return v_id;
end $$;

create or replace function public.admin_ip_allowlist_set_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_row public.console_ip_allowlist; v_ip inet := public._request_client_ip();
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  select * into v_row from public.console_ip_allowlist where id = p_id for update;
  if not found then raise exception 'That range no longer exists.' using errcode = '22023'; end if;
  update public.console_ip_allowlist set active = coalesce(p_active, false), updated_at = now() where id = p_id;
  if public._ip_allowlist_on() and not public._ip_covered(v_ip) then
    raise exception 'That would lock you out: your current IP would no longer be covered. Add a range for it first, or turn the allowlist off.'
      using errcode = '22023';
  end if;
  perform public._access_policy_audit(case when p_active then 'ip_allowlist_activate' else 'ip_allowlist_deactivate' end,
    p_id, 'console_ip_allowlist', jsonb_build_object('label', v_row.label, 'cidr', v_row.cidr::text));
end $$;

create or replace function public.admin_ip_allowlist_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_row public.console_ip_allowlist; v_ip inet := public._request_client_ip();
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  delete from public.console_ip_allowlist where id = p_id returning * into v_row;
  if v_row.id is null then raise exception 'That range no longer exists.' using errcode = '22023'; end if;
  if public._ip_allowlist_on() and not public._ip_covered(v_ip) then
    raise exception 'That would lock you out: your current IP would no longer be covered. Add a range for it first, or turn the allowlist off.'
      using errcode = '22023';
  end if;
  perform public._access_policy_audit('ip_allowlist_delete', p_id, 'console_ip_allowlist',
    jsonb_build_object('label', v_row.label, 'cidr', v_row.cidr::text));
end $$;

create or replace function public.admin_set_console_ip_allowlist(p_enabled boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ip inet := public._request_client_ip(); v_was boolean := public._ip_allowlist_on();
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  if coalesce(p_enabled, false) then
    if v_ip is null then
      raise exception 'Your current IP cannot be read, so turning this on could lock you out. It has not been turned on.' using errcode = '22023';
    end if;
    if not public._ip_covered(v_ip) then
      raise exception 'Your current IP (%) is not covered by an active range. Add it first, or you would lock yourself out.', host(v_ip)
        using errcode = '22023';
    end if;
  end if;
  perform set_config('app.access_policy_rpc', 'on', true);
  update public.system_config set value = case when p_enabled then 'true' else 'false' end,
         updated_at = now(), updated_by = auth.uid()
   where key = 'console_ip_allowlist_enabled';
  if not found then
    insert into public.system_config (key, value, category, description)
    values ('console_ip_allowlist_enabled', case when p_enabled then 'true' else 'false' end, 'security',
            'Only allow the super-admin console from listed IP ranges. Change it from Console, Access Policies.');
  end if;
  perform set_config('app.access_policy_rpc', '', true);
  perform public._access_policy_audit(case when p_enabled then 'ip_allowlist_enable' else 'ip_allowlist_disable' end,
    null, 'system_config', jsonb_build_object('was', v_was, 'now', coalesce(p_enabled, false), 'reason', btrim(p_reason)));
  return jsonb_build_object('enabled', coalesce(p_enabled, false), 'ip', host(v_ip));
end $$;

-- ── 6. SSO enforcement ───────────────────────────────────────────────────────
create or replace function public._sso_enforced_domains(p_org uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct d), '{}'::text[]) from (
    select lower(btrim(x)) d
      from public.sso_connections c, unnest(string_to_array(coalesce(c.domains, ''), ',')) x
     where c.organisation_id = p_org and c.status = 'active' and c.enforce_sso
  ) s where d <> ''
$$;
revoke all on function public._sso_enforced_domains(uuid) from public, anon, authenticated;

-- Called by the main-app sign-in AFTER a password sign-in succeeded. Returns
-- only {allowed, reason}. Super admins are always exempt (break-glass).
create or replace function public.sso_password_login_check()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare v_uid uuid := auth.uid(); v_org uuid; v_email text; v_dom text; v_amr jsonb;
begin
  if v_uid is null then return jsonb_build_object('allowed', true, 'reason', 'no_session'); end if;
  if public.is_super_admin() then return jsonb_build_object('allowed', true, 'reason', 'super_admin_exempt'); end if;
  v_amr := coalesce(auth.jwt()->'amr', '[]'::jsonb);
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_amr) = 'array' then v_amr else '[]'::jsonb end) e
              where coalesce(e->>'method', '') like 'sso%') then
    return jsonb_build_object('allowed', true, 'reason', 'sso_session');
  end if;
  select coalesce(p.organisation_id, p.org_id) into v_org from public.profiles p where p.id = v_uid;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  v_dom := nullif(split_part(coalesce(v_email, ''), '@', 2), '');
  if v_org is null or v_dom is null then return jsonb_build_object('allowed', true, 'reason', 'not_applicable'); end if;
  if v_dom = any(public._sso_enforced_domains(v_org)) then
    return jsonb_build_object('allowed', false, 'reason', 'sso_required');
  end if;
  return jsonb_build_object('allowed', true, 'reason', 'not_required');
end $$;

create or replace function public.admin_set_sso_required(p_org uuid, p_required boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_doms text[]; v_missing text[]; v_n int;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organisations where id = p_org) then
    raise exception 'That organisation does not exist.' using errcode = '22023';
  end if;
  if coalesce(p_required, false) then
    select coalesce(array_agg(distinct d), '{}') into v_doms from (
      select lower(btrim(x)) d from public.sso_connections c, unnest(string_to_array(coalesce(c.domains, ''), ',')) x
       where c.organisation_id = p_org and c.status = 'active') s where d <> '';
    if cardinality(v_doms) = 0 then
      raise exception 'This organisation has no active SSO connection with email domains. Requiring SSO now would lock everyone out.'
        using errcode = '22023';
    end if;
    select coalesce(array_agg(d), '{}') into v_missing from unnest(v_doms) d
     where not exists (select 1 from auth.sso_domains sd where lower(sd.domain) = d);
    if cardinality(v_missing) > 0 then
      raise exception 'These domains are not registered with Supabase Auth, so nobody could sign in with SSO: %', array_to_string(v_missing, ', ')
        using errcode = '22023';
    end if;
    update public.sso_connections set enforce_sso = true
     where organisation_id = p_org and status = 'active';
  else
    update public.sso_connections set enforce_sso = false where organisation_id = p_org;
  end if;
  get diagnostics v_n = row_count;
  perform public._access_policy_audit(case when p_required then 'sso_required_on' else 'sso_required_off' end,
    p_org, 'organisation', jsonb_build_object('connections', v_n, 'reason', btrim(p_reason)));
  return jsonb_build_object('org', p_org, 'required', coalesce(p_required, false), 'connections', v_n);
end $$;

-- ── 7. read model for the console page ───────────────────────────────────────
create or replace function public.admin_get_access_policies()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare v_ip inet := public._request_client_ip(); v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Permission denied: super admin required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'ip', jsonb_build_object(
      'enabled', public._ip_allowlist_on(),
      'caller_ip', host(v_ip),
      'caller_covered', public._ip_covered(v_ip),
      'entries', coalesce((select jsonb_agg(jsonb_build_object(
          'id', a.id, 'label', a.label, 'cidr', a.cidr::text, 'active', a.active,
          'created_at', a.created_at,
          'created_by_name', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = a.created_by),
          'covers_caller', v_ip is not null and family(a.cidr) = family(v_ip) and v_ip <<= a.cidr)
          order by a.created_at) from public.console_ip_allowlist a), '[]'::jsonb)),
    'sso', jsonb_build_object(
      'registered_providers', (select count(*) from auth.sso_providers),
      'registered_domains', coalesce((select jsonb_agg(lower(domain) order by domain) from auth.sso_domains), '[]'::jsonb),
      'orgs', coalesce((select jsonb_agg(o order by o->>'name') from (
        select jsonb_build_object(
          'id', g.id, 'name', g.name,
          'connections', (select count(*) from public.sso_connections c where c.organisation_id = g.id),
          'active_connections', (select count(*) from public.sso_connections c where c.organisation_id = g.id and c.status = 'active'),
          'active_domains', coalesce((select jsonb_agg(distinct lower(btrim(x)))
              from public.sso_connections c, unnest(string_to_array(coalesce(c.domains, ''), ',')) x
             where c.organisation_id = g.id and c.status = 'active' and btrim(x) <> ''), '[]'::jsonb),
          'enforced_domains', to_jsonb(public._sso_enforced_domains(g.id)),
          'required', cardinality(public._sso_enforced_domains(g.id)) > 0,
          'affected_users', (select count(*) from public.profiles p join auth.users u on u.id = p.id
              where coalesce(p.organisation_id, p.org_id) = g.id and not coalesce(p.is_super_admin, false)
                and lower(split_part(u.email, '@', 2)) = any(public._sso_enforced_domains(g.id)))
        ) o from public.organisations g) s), '[]'::jsonb))
  ) into v;
  return v;
end $$;

-- ── 8. grants ────────────────────────────────────────────────────────────────
do $$ declare f text; begin
  foreach f in array array[
    'public.console_check_access()',
    'public.admin_ip_allowlist_add(text, text)',
    'public.admin_ip_allowlist_set_active(uuid, boolean)',
    'public.admin_ip_allowlist_delete(uuid)',
    'public.admin_set_console_ip_allowlist(boolean, text)',
    'public.sso_password_login_check()',
    'public.admin_set_sso_required(uuid, boolean, text)',
    'public.admin_get_access_policies()'] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
