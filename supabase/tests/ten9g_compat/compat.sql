-- TEN-9g compatibility probe (read only): the answer of every sign-in entry point for a
-- set of identifiers. Run on production-shaped state BEFORE TEN-9g and AFTER, then diff.
-- Identifiers WITHOUT '/' or '\' must produce byte-identical rows. Rows that contain a
-- separator are listed separately (they are the only ones allowed to differ).
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create temp table ids(id text, grp text);
insert into ids
select v, 'plain' from (
  select username v from public.profiles where username is not null
  union select employee_id from public.profiles where employee_id is not null
  union select upper(username) from public.profiles where username is not null
  union select ' ' || username || ' ' from public.profiles where username is not null
  union select 'Mixed' || username from public.profiles where username is not null
  union select email from public.profiles where email is not null
  union select x from unnest(array['', ' ', 'nobody', 'no.such.user', '%', '_', '*', 'a%', 'u_er', 'admin', 'ADMIN', '12345', 'ali@x.com', 'a''b', 'x y']) x
) s where v !~ '[/\\]';
insert into ids
select v, 'sep' from (
  select 'default/' || username v from public.profiles where username is not null
  union select 'nope/' || username from public.profiles where username is not null
  union select '/' || username from public.profiles where username is not null
  union select username || '/' from public.profiles where username is not null
  union select x from unnest(array['/', '\', 'a/b/c', 'a\b', 'beta-haulage/beta.admin', ' / ']) x
) s;
select grp, id,
       coalesce(public._resolve_sign_in_profile(id)::text, '-') as resolved,
       coalesce(public._login_attempt_key(id), '-') as lock_key,
       coalesce(public.get_email_by_identifier(id), '-') as email,
       coalesce(public.login_attempt_status(id)::text, '-') as status
from ids order by grp, id;
