-- "Forgot password" for accounts that cannot receive email.
--
-- STATUS: APPLIED LIVE 2026-11-08 (project jhssdmeruxtrlqnwfksc).
--
-- 773 of 781 accounts sign in with a username whose email is a made-up
-- @users.tyrepulse.app address, and 0 profiles carry a phone number, so
-- neither the email link nor the SMS code can ever reach them. A locked-out
-- worker had no way to even ask. Now:
--   * request_password_reset(identifier) - anonymous, ALWAYS returns
--     {"ok":true} whether or not the account exists (no account guessing),
--     at most one open request per account per hour, and tells the Admins of
--     that account's company (plus super admins) in the app.
--   * The admin sets a new password with the existing admin_set_user_password,
--     which now also closes the person's open requests.
--   * Admins see and dismiss requests (RLS: super admin, or Admin of the same
--     organisation). Nobody can insert directly; only the function writes.

create table if not exists public.password_reset_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  organisation_id uuid,
  status        text not null default 'pending' check (status in ('pending', 'done', 'dismissed')),
  requested_at  timestamptz not null default now(),
  handled_by    uuid,
  handled_at    timestamptz
);
create index if not exists password_reset_requests_open_idx
  on public.password_reset_requests (organisation_id, requested_at desc) where status = 'pending';
create index if not exists password_reset_requests_user_idx on public.password_reset_requests (user_id);

alter table public.password_reset_requests enable row level security;
revoke all on public.password_reset_requests from anon, public;
grant select, update on public.password_reset_requests to authenticated;

create policy password_reset_requests_read on public.password_reset_requests
  for select to authenticated
  using (public.is_super_admin()
         or (lower(coalesce(public.app_role(), '')) = 'admin' and organisation_id = public.app_current_org()));

create policy password_reset_requests_update on public.password_reset_requests
  for update to authenticated
  using (public.is_super_admin()
         or (lower(coalesce(public.app_role(), '')) = 'admin' and organisation_id = public.app_current_org()))
  with check (status in ('pending', 'done', 'dismissed'));

create or replace function public.request_password_reset(p_identifier text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id   text := btrim(coalesce(p_identifier, ''));
  v_user record;
  v_req  uuid;
begin
  -- Same answer for every input: the reply must not say whether an account exists.
  if v_id = '' or length(v_id) > 254 then
    return jsonb_build_object('ok', true);
  end if;

  select p.id, p.full_name, p.username, coalesce(p.organisation_id, p.org_id) as org
    into v_user
    from public.profiles p
    left join auth.users au on au.id = p.id
   where p.approved and not coalesce(p.locked, false)
     and (lower(p.username) = lower(v_id)
          or lower(p.employee_id) = lower(v_id)
          or lower(au.email) = lower(v_id))
   limit 1;

  if v_user.id is null then
    return jsonb_build_object('ok', true);
  end if;

  -- One open request per person per hour stops anyone spamming the admins.
  if exists (select 1 from public.password_reset_requests r
              where r.user_id = v_user.id and r.status = 'pending'
                and r.requested_at > now() - interval '1 hour') then
    return jsonb_build_object('ok', true);
  end if;

  insert into public.password_reset_requests (user_id, organisation_id)
  values (v_user.id, v_user.org)
  returning id into v_req;

  begin
    insert into public.notifications (user_id, type, title, body, entity_type)
    select a.id, 'password_reset_request',
           'Password reset requested',
           coalesce(v_user.full_name, v_user.username, 'A user')
             || coalesce(' (' || v_user.username || ')', '')
             || ' cannot sign in and asked for a new password. Set one in Console > Users.',
           'password_reset_request'
      from public.profiles a
     where a.approved and not coalesce(a.locked, false)
       and (a.is_super_admin
            or (a.role = 'Admin' and coalesce(a.organisation_id, a.org_id) = v_user.org));
  exception when others then null; -- the request is recorded even if the notice fails
  end;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.request_password_reset(text) from public;
grant execute on function public.request_password_reset(text) to anon, authenticated, service_role;

-- Setting a password closes that person's open requests.
create or replace function public.close_password_reset_requests()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.action = 'password_set' and new.target_user is not null then
    update public.password_reset_requests
       set status = 'done', handled_by = new.actor, handled_at = now()
     where user_id = new.target_user and status = 'pending';
  end if;
  return new;
end;
$function$;
revoke all on function public.close_password_reset_requests() from public, anon, authenticated;

create trigger trg_close_password_reset_requests
  after insert on public.access_audit
  for each row execute function public.close_password_reset_requests();
