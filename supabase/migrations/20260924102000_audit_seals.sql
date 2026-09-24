-- =============================================================================
-- 20260924102000_audit_seals.sql
-- TAMPER-EVIDENT AUDIT LOGS (daily seals) + full audit export
-- SOC 2 CC7.2 / ISO 27001 A.8.15
--
-- STATUS: APPLIED LIVE 2026-09-24 (project jhssdmeruxtrlqnwfksc) via Supabase MCP.
--         Backfill run afterwards with repeated `select public.cron_seal_audit(<n>)`
--         calls (see VERIFICATION below).
--
-- DESIGN
--   * NO per-row hash-chain trigger on audit_log_v2. That table takes ~30,000
--     inserts per ERP import; a serialised per-row chain would add lock contention
--     and cost to the hottest write path. Instead each CLOSED UTC day is sealed once.
--   * digest       = sha256( string_agg( sha256(row_to_json(t)::text) ORDER BY ts, id ) )
--                    over every row of that UTC day for the source.
--   * chain_digest = sha256( coalesce(prev_digest,'GENESIS') || digest ), where
--                    prev_digest = chain_digest of the previous sealed day of that source.
--     Rewriting any sealed day, or any seal row, breaks every later chain link.
--   * Empty days are sealed too (row_count 0, digest of ''), so deleting a whole
--     day of rows is detected as well.
--   * Retention (audit-log-retention cron, audit_retention_days = 365) deletes old
--     rows. A day whose count dropped and lies inside the retention window is
--     reported as 'purged_by_retention', never as tampering.
--   * Today is never sealed. cron 'audit-seal-daily' runs 00:45 UTC, before the
--     01:15 retention purge.
--
-- CAVEAT: any deliberate, approved rewrite of historic audit rows (for example the
--   pending V579 country attribution on audit_log_v2) WILL show as a mismatch for
--   every affected day. That is the control working. Such a change must be recorded
--   as an approved change, not hidden by re-sealing.
--
-- SECURITY
--   * audit_seals: RLS on, super-admin SELECT only, no client write policy/grant.
--   * All functions SECURITY DEFINER, search_path = public, extensions.
--   * admin_* functions refuse non-super-admins with errcode 42501.
--   * cron_seal_audit / seal_audit_day / _audit_day_digest are revoked from
--     PUBLIC, anon and authenticated (server side only).
--
-- VERIFICATION (2026-09-24, live):
--   * Backfill: cron_seal_audit(10) + (40) + (400) = 229 days sealed.
--     audit_log_v2 83 days (2026-07-03..2026-09-23, 542,719 rows);
--     access_audit 71 days (2026-07-15..2026-09-23, 3,573 rows);
--     console_sessions 75 days (2026-07-11..2026-09-23, 208 rows).
--     Exactly one genesis seal (prev_digest null) per source.
--   * admin_verify_audit_seals as the super admin: 83/71/75 days, all 'match'.
--   * Tamper test (rolled back): UPDATE of the oldest access_audit row (day
--     2026-07-15) -> that day only returned digest_match=false, match=false,
--     status 'mismatch', rows 1018/1018; other 70 days match.
--   * Seal tamper test (rolled back): overwriting the digest of console_sessions
--     2026-08-01 -> chain_ok=false, 'mismatch' on that day.
--   * Real Manager impersonated (request.jwt.claims + role authenticated):
--     admin_verify_audit_seals refused with 42501; audit_seals select = 0 rows.
--   * EXECUTE: _audit_day_digest / seal_audit_day / cron_seal_audit false for
--     anon AND authenticated; admin_* false for anon, true for authenticated.
--   * Export: admin_export_audit_count('access_audit',2026-07-15,2026-07-15) = 1018
--     and admin_export_audit(...,5000,0) returned 1018 rows.
--   * cron.job 'audit-seal-daily' = '45 0 * * *'.
--
-- ROLLBACK
--   select cron.unschedule('audit-seal-daily');
--   drop function if exists public.admin_export_audit(text,date,date,int,int);
--   drop function if exists public.admin_export_audit_count(text,date,date);
--   drop function if exists public.admin_verify_audit_seals(text,date,date);
--   drop function if exists public.cron_seal_audit(int);
--   drop function if exists public.seal_audit_day(text,date);
--   drop function if exists public._audit_day_digest(text,date);
--   drop table if exists public.audit_seals;
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.audit_seals (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('audit_log_v2','access_audit','console_sessions')),
  day          date not null,
  row_count    bigint not null,
  digest       text not null,
  prev_digest  text,
  chain_digest text not null,
  sealed_at    timestamptz not null default now(),
  unique (source, day)
);

alter table public.audit_seals enable row level security;
revoke all on public.audit_seals from public, anon, authenticated;
grant select on public.audit_seals to authenticated;
drop policy if exists audit_seals_super_read on public.audit_seals;
create policy audit_seals_super_read on public.audit_seals
  for select to authenticated using ((select public.is_super_admin()));

-- ---------------------------------------------------------------------------
-- Core: row count + digest of one UTC day for one source.
-- ---------------------------------------------------------------------------
create or replace function public._audit_day_digest(p_source text, p_day date,
  out row_count bigint, out digest text)
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_from timestamptz := (p_day::timestamp at time zone 'UTC');
  v_to   timestamptz := ((p_day + 1)::timestamp at time zone 'UTC');
  v_agg  text;
begin
  if p_source = 'audit_log_v2' then
    select count(*), string_agg(encode(extensions.digest(row_to_json(t)::text, 'sha256'), 'hex'), '' order by t.created_at, t.id)
      into row_count, v_agg
      from public.audit_log_v2 t where t.created_at >= v_from and t.created_at < v_to;
  elsif p_source = 'access_audit' then
    select count(*), string_agg(encode(extensions.digest(row_to_json(t)::text, 'sha256'), 'hex'), '' order by t.at, t.id)
      into row_count, v_agg
      from public.access_audit t where t.at >= v_from and t.at < v_to;
  elsif p_source = 'console_sessions' then
    select count(*), string_agg(encode(extensions.digest(row_to_json(t)::text, 'sha256'), 'hex'), '' order by t.created_at, t.id)
      into row_count, v_agg
      from public.console_sessions t where t.created_at >= v_from and t.created_at < v_to;
  else
    raise exception 'Unknown audit source' using errcode = '22023';
  end if;
  digest := encode(extensions.digest(coalesce(v_agg, ''), 'sha256'), 'hex');
end $$;

-- ---------------------------------------------------------------------------
-- Seal one closed day. Refuses today/future and out-of-order sealing so the
-- chain stays linear.
-- ---------------------------------------------------------------------------
create or replace function public.seal_audit_day(p_source text, p_day date)
returns public.audit_seals
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_prev  text;
  v_cnt   bigint;
  v_dig   text;
  v_row   public.audit_seals;
begin
  if p_day is null or p_day >= v_today then
    raise exception 'Only a closed day (before today, UTC) can be sealed' using errcode = '22023';
  end if;
  select * into v_row from public.audit_seals where source = p_source and day = p_day;
  if found then return v_row; end if;
  if exists (select 1 from public.audit_seals where source = p_source and day > p_day) then
    raise exception 'A later day is already sealed; seals must be created in day order' using errcode = '22023';
  end if;
  select chain_digest into v_prev from public.audit_seals
   where source = p_source and day < p_day order by day desc limit 1;
  select d.row_count, d.digest into v_cnt, v_dig from public._audit_day_digest(p_source, p_day) d;
  insert into public.audit_seals (source, day, row_count, digest, prev_digest, chain_digest)
  values (p_source, p_day, v_cnt, v_dig, v_prev,
          encode(extensions.digest(coalesce(v_prev, 'GENESIS') || v_dig, 'sha256'), 'hex'))
  returning * into v_row;
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Seal every unsealed closed day up to yesterday for all three sources.
-- p_max_days bounds the work per call (used for the initial backfill).
-- ---------------------------------------------------------------------------
create or replace function public.cron_seal_audit(p_max_days int default 400)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_src   text;
  v_start date;
  v_last  date;
  v_min   date;
  v_day   date;
  v_done  int := 0;
  v_out   jsonb := '{}'::jsonb;
  v_n     int;
begin
  foreach v_src in array array['audit_log_v2','access_audit','console_sessions'] loop
    v_n := 0;
    select max(day) into v_last from public.audit_seals where source = v_src;
    if v_last is null then
      if v_src = 'audit_log_v2' then
        select (min(created_at) at time zone 'UTC')::date into v_min from public.audit_log_v2;
      elsif v_src = 'access_audit' then
        select (min(at) at time zone 'UTC')::date into v_min from public.access_audit;
      else
        select (min(created_at) at time zone 'UTC')::date into v_min from public.console_sessions;
      end if;
      v_start := v_min;
    else
      v_start := v_last + 1;
    end if;
    if v_start is not null then
      v_day := v_start;
      while v_day < v_today and v_done < p_max_days loop
        perform public.seal_audit_day(v_src, v_day);
        v_day := v_day + 1; v_done := v_done + 1; v_n := v_n + 1;
      end loop;
    end if;
    v_out := v_out || jsonb_build_object(v_src, v_n);
  end loop;
  if v_done > 0 then
    begin
      insert into public.system_logs (module_id, severity, source, message, detail)
      values ('audit_integrity', 'info', 'cron_seal_audit', 'Audit days sealed', v_out);
    exception when others then null;
    end;
  end if;
  return v_out || jsonb_build_object('total', v_done);
end $$;

-- ---------------------------------------------------------------------------
-- Verify: recompute each sealed day and the chain.
-- ---------------------------------------------------------------------------
create or replace function public.admin_verify_audit_seals(p_source text, p_from date default null, p_to date default null)
returns table (day date, row_count_then bigint, row_count_now bigint,
               digest_match boolean, chain_ok boolean, match boolean, status text)
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  r        record;
  v_cnt    bigint;
  v_dig    text;
  v_prevc  text := null;
  v_first  boolean := true;
  v_ret    int;
  v_cutoff date;
  v_chain  boolean;
begin
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'Only a super admin can verify audit seals' using errcode = '42501';
  end if;
  if p_source not in ('audit_log_v2','access_audit','console_sessions') then
    raise exception 'Unknown audit source' using errcode = '22023';
  end if;
  begin
    select nullif(regexp_replace(value::text, '[^0-9]', '', 'g'), '')::int into v_ret
      from public.system_config where key = 'audit_retention_days';
  exception when others then v_ret := null;
  end;
  -- Retention purges rows older than now() - N days, so the boundary day can be
  -- partially purged: anything on or before that day is in the retention zone.
  v_cutoff := case when coalesce(v_ret, 0) > 0
                   then ((now() - make_interval(days => v_ret)) at time zone 'UTC')::date
                   else null end;

  for r in select s.* from public.audit_seals s where s.source = p_source order by s.day loop
    -- chain is always checked from the first seal so a broken earlier link is seen
    v_chain := (r.prev_digest is not distinct from v_prevc)
           and r.chain_digest = encode(extensions.digest(coalesce(r.prev_digest,'GENESIS') || r.digest, 'sha256'), 'hex');
    v_prevc := r.chain_digest;
    v_first := false;
    if (p_from is not null and r.day < p_from) or (p_to is not null and r.day > p_to) then
      continue;
    end if;
    select d.row_count, d.digest into v_cnt, v_dig from public._audit_day_digest(p_source, r.day) d;
    day := r.day;
    row_count_then := r.row_count;
    row_count_now := v_cnt;
    digest_match := (v_dig = r.digest);
    chain_ok := v_chain;
    if digest_match and chain_ok then
      match := true; status := 'match';
    elsif chain_ok and v_cutoff is not null and r.day <= v_cutoff and v_cnt < r.row_count then
      match := true; status := 'purged_by_retention';
    else
      match := false; status := 'mismatch';
    end if;
    return next;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Export: count first, then paged rows ordered (ts, id).
-- ---------------------------------------------------------------------------
create or replace function public.admin_export_audit_count(p_source text, p_from date default null, p_to date default null)
returns bigint
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_from timestamptz := case when p_from is null then '-infinity'::timestamptz else (p_from::timestamp at time zone 'UTC') end;
  v_to   timestamptz := case when p_to   is null then  'infinity'::timestamptz else ((p_to + 1)::timestamp at time zone 'UTC') end;
  v_n bigint;
begin
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'Only a super admin can export audit logs' using errcode = '42501';
  end if;
  if p_source = 'audit_log_v2' then
    select count(*) into v_n from public.audit_log_v2 where created_at >= v_from and created_at < v_to;
  elsif p_source = 'access_audit' then
    select count(*) into v_n from public.access_audit where at >= v_from and at < v_to;
  elsif p_source = 'console_sessions' then
    select count(*) into v_n from public.console_sessions where created_at >= v_from and created_at < v_to;
  else
    raise exception 'Unknown audit source' using errcode = '22023';
  end if;
  return v_n;
end $$;

create or replace function public.admin_export_audit(p_source text, p_from date default null, p_to date default null,
  p_limit int default 1000, p_offset int default 0)
returns table (ts timestamptz, id uuid, data jsonb)
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_from timestamptz := case when p_from is null then '-infinity'::timestamptz else (p_from::timestamp at time zone 'UTC') end;
  v_to   timestamptz := case when p_to   is null then  'infinity'::timestamptz else ((p_to + 1)::timestamp at time zone 'UTC') end;
  v_lim  int := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_off  int := greatest(coalesce(p_offset, 0), 0);
begin
  if not coalesce(public.is_super_admin(), false) then
    raise exception 'Only a super admin can export audit logs' using errcode = '42501';
  end if;
  if p_source = 'audit_log_v2' then
    return query select t.created_at, t.id, to_jsonb(t) from public.audit_log_v2 t
      where t.created_at >= v_from and t.created_at < v_to order by t.created_at, t.id limit v_lim offset v_off;
  elsif p_source = 'access_audit' then
    return query select t.at, t.id, to_jsonb(t) from public.access_audit t
      where t.at >= v_from and t.at < v_to order by t.at, t.id limit v_lim offset v_off;
  elsif p_source = 'console_sessions' then
    return query select t.created_at, t.id, to_jsonb(t) from public.console_sessions t
      where t.created_at >= v_from and t.created_at < v_to order by t.created_at, t.id limit v_lim offset v_off;
  else
    raise exception 'Unknown audit source' using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Grants (V500 order: revoke PUBLIC, then anon by name; grant authenticated only
-- to the admin_* entry points).
-- ---------------------------------------------------------------------------
revoke all on function public._audit_day_digest(text,date) from public;
revoke all on function public._audit_day_digest(text,date) from anon, authenticated;
revoke all on function public.seal_audit_day(text,date) from public;
revoke all on function public.seal_audit_day(text,date) from anon, authenticated;
revoke all on function public.cron_seal_audit(int) from public;
revoke all on function public.cron_seal_audit(int) from anon, authenticated;

revoke all on function public.admin_verify_audit_seals(text,date,date) from public;
revoke all on function public.admin_verify_audit_seals(text,date,date) from anon;
grant execute on function public.admin_verify_audit_seals(text,date,date) to authenticated, service_role;
revoke all on function public.admin_export_audit_count(text,date,date) from public;
revoke all on function public.admin_export_audit_count(text,date,date) from anon;
grant execute on function public.admin_export_audit_count(text,date,date) to authenticated, service_role;
revoke all on function public.admin_export_audit(text,date,date,int,int) from public;
revoke all on function public.admin_export_audit(text,date,date,int,int) from anon;
grant execute on function public.admin_export_audit(text,date,date,int,int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Schedule: 00:45 UTC daily (before audit-log-retention at 01:15).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'audit-seal-daily') then
    perform cron.unschedule('audit-seal-daily');
  end if;
  perform cron.schedule('audit-seal-daily', '45 0 * * *', 'select public.cron_seal_audit(400)');
end $$;
