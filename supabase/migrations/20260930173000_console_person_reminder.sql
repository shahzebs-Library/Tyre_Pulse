-- Control Center, User detail: "Send reminder" to one person.
--
-- notifications has no client insert path (notifications_insert_rpc is WITH CHECK
-- false), so a super admin sends a reminder through this DEFINER function. It
-- inserts ONE notification for the person (their app bell and phone list), and
-- writes a console_sessions audit row with the reason. Optionally the same text
-- goes to a named supervisor. Nothing else changes.
--
-- Rollback: drop function if exists public.admin_send_person_reminder(uuid, text, text, text, uuid);

create or replace function public.admin_send_person_reminder(
  p_user uuid, p_title text, p_body text, p_reason text, p_copy_to uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := left(btrim(coalesce(p_title, '')), 120);
  v_body  text := left(btrim(coalesce(p_body, '')), 1000);
  v_sent  integer := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can send a reminder from the console' using errcode = '42501';
  end if;
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'That person could not be found' using errcode = 'P0002';
  end if;
  if length(v_title) < 3 or length(v_body) < 3 then
    raise exception 'Write a short title and message' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Give a short reason for this reminder' using errcode = '22023';
  end if;

  insert into public.notifications(user_id, type, title, body, entity_type, read)
  values (p_user, 'info', v_title, v_body, 'console_reminder', false);
  v_sent := 1;

  if p_copy_to is not null and p_copy_to <> p_user and exists (select 1 from public.profiles where id = p_copy_to) then
    insert into public.notifications(user_id, type, title, body, entity_type, read)
    values (p_copy_to, 'info', 'Copy: ' || v_title, v_body, 'console_reminder', false);
    v_sent := 2;
  end if;

  insert into public.console_sessions(admin_id, action, target_id, target_type, details)
  values (auth.uid(), 'send_person_reminder', p_user, 'user',
          jsonb_build_object('title', v_title, 'reason', left(btrim(p_reason), 500), 'copied', p_copy_to is not null));

  return jsonb_build_object('ok', true, 'sent', v_sent);
end
$$;
revoke all on function public.admin_send_person_reminder(uuid, text, text, text, uuid) from public;
revoke all on function public.admin_send_person_reminder(uuid, text, text, text, uuid) from anon;
grant execute on function public.admin_send_person_reminder(uuid, text, text, text, uuid) to authenticated;
