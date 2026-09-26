-- =============================================================================
-- log_client_error(): pre-login / anonymous error reporting into system_logs
-- =============================================================================
-- PURPOSE
--   V281 revoked every anon table grant (deliberate), so an error raised BEFORE
--   sign-in (login page, password reset, public /report and /display boards)
--   could never reach system_logs: logSystemEvent's direct INSERT is refused
--   with 42501 and the failure vanished. This adds ONE narrowly-scoped
--   SECURITY DEFINER RPC that the client falls back to when the direct insert
--   is refused. No table grant is widened.
--
-- ANON ALLOWLIST - INTENTIONAL ADDITION (11th anon-executable DEFINER function)
--   The V500 allowlist was 10 functions (get_email_by_identifier,
--   get_public_config, login_attempt_status, record_login_failure,
--   reset_login_attempts, get_report_snapshot, get_report_tyre_maintenance,
--   get_workshop_snapshot, get_accident_portal_snapshot, get_display_snapshot).
--   log_client_error is added on purpose. Any future "anon DEFINER" sweep must
--   treat it as allowlisted, not as a regression.
--
-- SAFETY PROPERTIES (each enforced server-side, never trusted from the client)
--   * No org spoofing: organisation_id = app_current_org() (NULL for anon);
--     user_id = auth.uid(); user_email is NOT accepted from the caller.
--   * Severity whitelist info|warning|error|critical; anything else -> 'error'.
--     An anonymous caller can never write 'critical' (downgraded to 'error'),
--     so an unauthenticated flood cannot page the owner.
--   * Length caps: message 2000, source 200, module_id 100, reference_id 100,
--     url 1000. detail must be a JSON object <= 4 KB, else replaced by a stub.
--   * Rate limit (per minute): 10 per anonymous IP, 60 across ALL anonymous
--     callers, 30 per signed-in user. Excess calls return false and write
--     nothing. Counters live in client_error_rate (RLS on, no policies, no
--     grants = deny-all for app roles); rows older than 10 minutes are pruned.
--   * search_path pinned to public; VOLATILE (it writes).
--   * Grant order per V500: revoke PUBLIC, then grant anon + authenticated
--     (+ service_role) explicitly.
--
-- VERIFY (rolled back)
--   begin; set local role anon;
--     select public.log_client_error('critical','login','boom');   -- true
--     -- row landed with severity 'error', organisation_id null, user_id null
--     select count(*) from (select public.log_client_error('error','x','m'||g)
--       from generate_series(1,20) g) s;  -- only the first 9 more return true
--   rollback;
--   select has_function_privilege('anon','public.log_client_error(text,text,text,text,jsonb,text,text)','EXECUTE'); -- true
--   select has_table_privilege('anon','public.system_logs','INSERT');     -- false (unchanged)
--
-- ROLLBACK
--   drop function if exists public.log_client_error(text,text,text,text,jsonb,text,text);
--   drop table if exists public.client_error_rate;
-- =============================================================================

create table if not exists public.client_error_rate (
  rkey   text        not null,
  bucket timestamptz not null,
  n      integer     not null default 0,
  primary key (rkey, bucket)
);
create index if not exists client_error_rate_bucket_idx on public.client_error_rate (bucket);
alter table public.client_error_rate enable row level security;
revoke all on table public.client_error_rate from public, anon, authenticated;

create or replace function public.log_client_error(
  p_severity     text,
  p_source       text,
  p_message      text,
  p_module_id    text  default null,
  p_detail       jsonb default null,
  p_reference_id text  default null,
  p_url          text  default null
) returns boolean
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_uid     uuid := auth.uid();
  v_msg     text := left(btrim(coalesce(p_message, '')), 2000);
  v_sev     text := lower(btrim(coalesce(p_severity, 'error')));
  v_detail  jsonb := p_detail;
  v_bucket  timestamptz := date_trunc('minute', now());
  v_ip      text;
  v_key     text;
  v_n       int;
  v_global  int;
begin
  if v_msg = '' then return false; end if;

  if v_sev not in ('info', 'warning', 'error', 'critical') then v_sev := 'error'; end if;
  if v_uid is null and v_sev = 'critical' then v_sev := 'error'; end if;

  if v_detail is not null
     and (jsonb_typeof(v_detail) <> 'object' or pg_column_size(v_detail) > 4096) then
    v_detail := jsonb_build_object('truncated', true);
  end if;

  -- Caller key: the signed-in user, else the client IP the gateway forwarded.
  if v_uid is not null then
    v_key := 'u:' || v_uid::text;
  else
    begin
      select coalesce(nullif(h ->> 'cf-connecting-ip', ''),
                      nullif(btrim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''),
                      nullif(h ->> 'x-real-ip', ''),
                      'unknown')
        into v_ip
        from (select current_setting('request.headers', true)::jsonb as h) s;
    exception when others then
      v_ip := 'unknown';
    end;
    v_key := 'a:' || left(coalesce(v_ip, 'unknown'), 64);
  end if;

  insert into public.client_error_rate as r (rkey, bucket, n) values (v_key, v_bucket, 1)
  on conflict (rkey, bucket) do update set n = r.n + 1
  returning r.n into v_n;

  if v_uid is null then
    insert into public.client_error_rate as r (rkey, bucket, n) values ('a:*', v_bucket, 1)
    on conflict (rkey, bucket) do update set n = r.n + 1
    returning r.n into v_global;
    if v_n > 10 or v_global > 60 then return false; end if;
  elsif v_n > 30 then
    return false;
  end if;

  -- Opportunistic prune; cheap via the bucket index.
  delete from public.client_error_rate where bucket < now() - interval '10 minutes';

  insert into public.system_logs
    (organisation_id, module_id, severity, source, message, detail, reference_id, url, user_id, user_email)
  values
    (public.app_current_org(),
     nullif(left(btrim(coalesce(p_module_id, '')), 100), ''),
     v_sev,
     nullif(left(btrim(coalesce(p_source, '')), 200), ''),
     v_msg,
     coalesce(v_detail, '{}'::jsonb),
     nullif(left(btrim(coalesce(p_reference_id, '')), 100), ''),
     nullif(left(btrim(coalesce(p_url, '')), 1000), ''),
     v_uid,
     null);
  return true;
exception when others then
  -- Error reporting must never itself become an error.
  return false;
end
$function$;

revoke all on function public.log_client_error(text, text, text, text, jsonb, text, text) from public;
grant execute on function public.log_client_error(text, text, text, text, jsonb, text, text) to anon, authenticated, service_role;

comment on function public.log_client_error(text, text, text, text, jsonb, text, text) is
  'Anon+authenticated error sink into system_logs (fallback when the direct insert is refused, e.g. pre-login). '
  'INTENTIONAL 11th anon-executable SECURITY DEFINER function (V500 allowlist addition). '
  'Org from app_current_org(), no caller-supplied email, severity whitelist, length caps, per-minute rate limit.';
