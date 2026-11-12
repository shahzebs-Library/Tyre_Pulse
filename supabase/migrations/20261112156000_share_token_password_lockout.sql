-- Share-token boards: wrong passwords are counted and the link locks for a while.
--
-- FINDING: API-6 (P2)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12 (apply_migration
--   returned success: table + helper created, all five functions rebuilt - the
--   block aborts unless each anchor matched exactly once).
--   RUNTIME VERIFICATION NOT YET RUN: the verification transaction tripped the
--   deployment tool's confirmation prompt (it contained an UPDATE with no WHERE
--   on the new counter table) and the tool was then unavailable for the rest of
--   the session. Run the VERIFY block at the foot before relying on this.
--
-- WHAT WAS WRONG (function source, confirmed live)
--   get_report_snapshot, get_report_tyre_maintenance, get_workshop_snapshot
--   (report_shares), get_display_snapshot (display_tokens) and
--   get_accident_portal_snapshot (accident_portal_shares) are anon-callable and
--   compared the password with a bare crypt() - no counter, no lock. With a
--   leaked link the optional password could be guessed without limit, and every
--   guess cost one bcrypt on the database.
--
-- WHAT THIS DOES
--   1. New deny-all table share_password_attempts (kind, share_id) -> failed
--      count, window start, locked_until. RLS on, no policy, no grant to anon /
--      authenticated: only the SECURITY DEFINER snapshot functions touch it.
--   2. New helper share_password_ok(kind, share_id, password, hash):
--        - link locked            -> false, WITHOUT running bcrypt
--        - blank password         -> false, not counted (the viewer's first call
--                                     is always blank, to learn a password is needed)
--        - correct password       -> true, counter cleared
--        - wrong password         -> false, counted; the 10th failure inside 15
--                                     minutes locks the link for 15 minutes
--      Not executable by public / anon / authenticated.
--   3. The five functions call the helper where they called crypt(). Each is
--      rebuilt from its LIVE definition by ONE anchored replacement that must
--      match exactly once. The three report_shares functions share one counter
--      per link (kind 'report').
--   Replies are unchanged: a refused attempt - wrong OR locked - still returns
--   the same "password" reply the viewers already handle (reason 'password';
--   display: error 'invalid_password'), so nothing new is revealed about a token
--   and no client needs a change. Links without a password behave exactly as
--   before (the helper is not reached).
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Data loss: none. One new empty table; five CREATE OR REPLACE.
-- Live links at apply time: report_shares 2 active (no password), so no live
--   link changes behaviour today.
-- Writes inside an anon call: the functions are VOLATILE and already update
--   view_count, so a counter write is the same class of write. A refused call
--   RETURNS (does not raise), so the counter row is committed.
-- SECURITY DEFINER: helper pins search_path = public, extensions (pgcrypto
--   lives in extensions), revoked from public / anon / authenticated.
-- New table: ends with anum_integration.apply_reader_policies().
-- PostgREST: no new error code is raised.
-- Trade-off (stated, not hidden): someone holding a link can lock its password
--   prompt for 15 minutes at a time by sending 10 wrong passwords. During the
--   lock the right password is also refused.
-- Client behaviour that changes: after 10 wrong passwords within 15 minutes a
--   protected link answers "wrong password" to everything for 15 minutes.
-- Rollback: at the foot.

create table if not exists public.share_password_attempts (
  kind              text        not null,
  share_id          uuid        not null,
  failed_count      integer     not null default 0,
  window_started_at timestamptz not null default now(),
  last_failed_at    timestamptz,
  locked_until      timestamptz,
  primary key (kind, share_id)
);
alter table public.share_password_attempts enable row level security;
revoke all on public.share_password_attempts from public, anon, authenticated;
comment on table public.share_password_attempts is
  'API-6: failed password attempts per share link. Deny-all; written only by share_password_ok() inside the token snapshot functions.';

create or replace function public.share_password_ok(
  p_kind text, p_share_id uuid, p_password text, p_hash text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  r         public.share_password_attempts%rowtype;
  v_max     constant integer  := 10;
  v_window  constant interval := interval '15 minutes';
  v_lock    constant interval := interval '15 minutes';
begin
  if p_hash is null then
    return true;
  end if;
  if p_share_id is null or p_password is null or btrim(p_password) = '' then
    return false;
  end if;

  select * into r
    from public.share_password_attempts
   where kind = p_kind and share_id = p_share_id;

  if r.locked_until is not null and r.locked_until > now() then
    return false;
  end if;

  if crypt(p_password, p_hash) = p_hash then
    if r.share_id is not null and (r.failed_count > 0 or r.locked_until is not null) then
      update public.share_password_attempts
         set failed_count = 0, locked_until = null, window_started_at = now()
       where kind = p_kind and share_id = p_share_id;
    end if;
    return true;
  end if;

  insert into public.share_password_attempts as a
         (kind, share_id, failed_count, window_started_at, last_failed_at)
  values (p_kind, p_share_id, 1, now(), now())
  on conflict (kind, share_id) do update
     set failed_count = case when a.window_started_at < now() - v_window then 1
                             else a.failed_count + 1 end,
         window_started_at = case when a.window_started_at < now() - v_window then now()
                                  else a.window_started_at end,
         last_failed_at = now(),
         locked_until = case
           when (case when a.window_started_at < now() - v_window then 1
                      else a.failed_count + 1 end) >= v_max
           then now() + v_lock else null end;
  return false;
end
$function$;

revoke execute on function public.share_password_ok(text, uuid, text, text) from public, anon, authenticated;

do $mig$
declare
  r      record;
  v_def  text;
  v_old  text;
  v_new  text;
begin
  for r in
    select * from (values
      ('public.get_report_snapshot(text,text,text,text,text,text)',         'report',          't'),
      ('public.get_report_tyre_maintenance(text,text,text,text,text,text)', 'report',          't'),
      ('public.get_workshop_snapshot(text,text)',                           'report',          't'),
      ('public.get_display_snapshot(text,text)',                            'display',         't'),
      ('public.get_accident_portal_snapshot(text,text)',                    'accident_portal', 'v_share')
    ) as x(sig, kind, var)
  loop
    select pg_get_functiondef(r.sig::regprocedure) into v_def;
    v_old := format('crypt(p_password, %s.password_hash) <> %s.password_hash', r.var, r.var);
    v_new := format('not public.share_password_ok(%L, %s.id, p_password, %s.password_hash)', r.kind, r.var, r.var);
    if position('share_password_ok' in v_def) > 0 then
      raise exception '%: already converted', r.sig;
    end if;
    if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
      raise exception '%: anchor not found exactly once', r.sig;
    end if;
    execute replace(v_def, v_old, v_new);
  end loop;
end
$mig$;

select anum_integration.apply_reader_policies();

-- ------------------------------------------------------------------------ VERIFY
-- NOT YET RUN (see STATUS). To run: one rolled-back transaction, role anon, on
-- throw-away token rows created inside it (report_shares with and without a
-- password_hash, display_tokens with one). Expected:
--   report link WITHOUT a password: get_report_snapshot            -> ok:true (unchanged)
--   the 2 live report links (no password)                          -> ok:true (unchanged)
--   report link WITH a password:
--     blank password                                               -> reason 'password', nothing counted
--     9 wrong passwords                                            -> 'password' x9, failed_count 9, not locked
--     correct password                                             -> ok:true, counter back to 0
--     10 wrong passwords                                           -> locked_until set (+15 min)
--     correct password while locked                                -> reason 'password' (refused)
--     same link through get_workshop_snapshot while locked         -> reason 'password' (shared counter)
--     lock expired (set locked_until in the past WHERE share_id = the probe), correct pw -> ok:true
--   display token: wrong password -> error 'invalid_password', counted; right -> ok
--   unknown token                                                  -> 'invalid' / 'invalid_token' as before, nothing counted
--   has_function_privilege('anon' | 'authenticated', share_password_ok) -> false
--   select count(*) from share_password_attempts as anon           -> 42501
--
-- ---------------------------------------------------------------------- ROLLBACK
-- In each of the five functions put the crypt() comparison back in place of the
-- share_password_ok(...) call (reverse of the replacement above), then (owner,
-- SQL editor) remove function share_password_ok and table share_password_attempts.
