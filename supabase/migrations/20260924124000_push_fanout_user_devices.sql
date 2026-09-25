-- ============================================================================
-- 20260924124000  Push fan-out over user_devices (every active device, not one)
-- ============================================================================
-- V321 created public.user_devices (one row per device, revoked flag) but every
-- server-side push consumer still read the single profiles.push_token column,
-- which only ever holds the LAST device a person signed in on. A supervisor with
-- a phone and a tablet got pushes on one of them only.
--
-- ONE resolver, public._user_push_tokens(uuid) -> setof text:
--   * every user_devices.push_token for the user with revoked = false, UNION
--   * profiles.push_token (back-compat for devices registered before V321),
--     EXCEPT when that token is registered in user_devices as revoked or as
--     belonging to a DIFFERENT user (the phone changed hands; user_devices is
--     authoritative because register_user_device re-points it on conflict).
--   De-duplicated, blanks dropped.
--
-- Consumers re-pointed (anchored replace of the LIVE pg_get_functiondef, each
-- anchor must match the expected number of times or the migration aborts):
--   consume_event_approval_push, consume_event_assignment_push,
--   consume_event_workflow_notify, consume_event_accident_notify,
--   cron_check_upload_gaps, notify_submission_decision, broadcast_send.
-- Fan-out is by REPEATING the recipient object once per token. The
-- workflow-notify edge function already de-duplicates email addresses and push
-- tokens with a Set, so an email is never sent twice; NO edge redeploy needed.
-- Where a recipients list also drives in-app notifications
-- (consume_event_accident_notify) the insert is made DISTINCT per user.
-- Consequence stated: workflow_notifications.recipient_count now counts
-- recipient entries (devices) for the push-only consumers, not people.
--
-- admin_clear_push_token ALSO revokes the user's user_devices rows now;
-- otherwise "Clear device" in the console would stop nothing once pushes fan
-- out over user_devices.
--
-- broadcast_audience already counted user_devices OR profiles.push_token;
-- register_user_device / revoke_user_device are writers. Both unchanged.
--
-- ROLLBACK: every original definition is saved in _bak.push_fanout_20260924
--   do $$ declare r record; begin for r in select def from _bak.push_fanout_20260924 loop execute r.def; end loop; end $$;
--   drop function public._user_push_tokens(uuid);
-- ============================================================================

create or replace function public._user_push_tokens(p_user uuid)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct s.tok
    from (
      select btrim(d.push_token) as tok
        from public.user_devices d
       where d.user_id = p_user
         and not coalesce(d.revoked, false)
      union
      select btrim(p.push_token)
        from public.profiles p
       where p.id = p_user
         and nullif(btrim(p.push_token), '') is not null
         and not exists (
               select 1 from public.user_devices d2
                where d2.push_token = btrim(p.push_token)
                  and (coalesce(d2.revoked, false) or d2.user_id <> p_user))
    ) s
   where nullif(s.tok, '') is not null
$$;
revoke all on function public._user_push_tokens(uuid) from public;
revoke all on function public._user_push_tokens(uuid) from anon;
revoke all on function public._user_push_tokens(uuid) from authenticated;

create schema if not exists _bak;
create table if not exists _bak.push_fanout_20260924 (fn text primary key, def text not null, saved_at timestamptz default now());

create or replace function pg_temp._patch(p_def text, p_from text, p_to text, p_expect int, p_label text)
returns text language plpgsql as $$
declare n int;
begin
  n := (length(p_def) - length(replace(p_def, p_from, ''))) / greatest(length(p_from), 1);
  if n <> p_expect then
    raise exception 'push fan-out: anchor % matched % time(s), expected %', p_label, n, p_expect;
  end if;
  return replace(p_def, p_from, p_to);
end $$;

do $$
declare
  d text;
  sig text;
begin
  -- 1. approval push -------------------------------------------------------
  sig := 'public.consume_event_approval_push(domain_events)';
  d := pg_get_functiondef(sig::regprocedure);
  insert into _bak.push_fanout_20260924 (fn, def) values (sig, d) on conflict (fn) do nothing;
  d := pg_temp._patch(d, $a$'push_token', p.push_token, 'role', p.role)), '[]'::jsonb)$a$,
                         $a$'push_token', t.tok, 'role', p.role)), '[]'::jsonb)$a$, 1, 'approval.select');
  d := pg_temp._patch(d, E'    INTO v_recipients\n    FROM public.profiles p\n',
                         E'    INTO v_recipients\n    FROM public.profiles p\n    CROSS JOIN LATERAL public._user_push_tokens(p.id) t(tok)\n', 1, 'approval.from');
  d := pg_temp._patch(d, E'     AND p.push_token IS NOT NULL AND btrim(p.push_token) <> \'\'\n', '', 1, 'approval.where');
  execute d;

  -- 2. assignment push -----------------------------------------------------
  sig := 'public.consume_event_assignment_push(domain_events)';
  d := pg_get_functiondef(sig::regprocedure);
  insert into _bak.push_fanout_20260924 (fn, def) values (sig, d) on conflict (fn) do nothing;
  d := pg_temp._patch(d, $a$'push_token', p.push_token, 'role', p.role)), '[]'::jsonb)$a$,
                         $a$'push_token', t.tok, 'role', p.role)), '[]'::jsonb)$a$, 1, 'assignment.select');
  d := pg_temp._patch(d, E'    INTO v_recipients\n    FROM public.profiles p\n',
                         E'    INTO v_recipients\n    FROM public.profiles p\n    CROSS JOIN LATERAL public._user_push_tokens(p.id) t(tok)\n', 1, 'assignment.from');
  d := pg_temp._patch(d, E'     AND p.push_token IS NOT NULL AND btrim(p.push_token) <> \'\'\n', '', 1, 'assignment.where');
  execute d;

  -- 3. workflow notify (3 recipient selects; email recipients kept via LEFT JOIN)
  sig := 'public.consume_event_workflow_notify(domain_events)';
  d := pg_get_functiondef(sig::regprocedure);
  insert into _bak.push_fanout_20260924 (fn, def) values (sig, d) on conflict (fn) do nothing;
  d := pg_temp._patch(d, $a$'push_token', p.push_token, 'phone', NULL$a$,
                         $a$'push_token', t.tok, 'phone', NULL$a$, 3, 'workflow.select');
  d := pg_temp._patch(d, E'            LEFT JOIN auth.users u ON u.id = p.id\n',
                         E'            LEFT JOIN auth.users u ON u.id = p.id\n            LEFT JOIN LATERAL public._user_push_tokens(p.id) t(tok) ON true\n', 3, 'workflow.join');
  execute d;

  -- 4. accident notify (email recipients kept; in-app made DISTINCT per user)
  sig := 'public.consume_event_accident_notify(domain_events)';
  d := pg_get_functiondef(sig::regprocedure);
  insert into _bak.push_fanout_20260924 (fn, def) values (sig, d) on conflict (fn) do nothing;
  d := pg_temp._patch(d, $a$'push_token',p.push_token,'role',p.role$a$,
                         $a$'push_token',t.tok,'role',p.role$a$, 1, 'accident.select');
  d := pg_temp._patch(d, E'  LEFT JOIN auth.users u ON u.id = p.id\n',
                         E'  LEFT JOIN auth.users u ON u.id = p.id\n  LEFT JOIN LATERAL public._user_push_tokens(p.id) t(tok) ON true\n', 1, 'accident.join');
  d := pg_temp._patch(d, $a$SELECT (r->>'user_id')::uuid, v_ntype, v_title, v_body, 'accident', acc.id$a$,
                         $a$SELECT DISTINCT (r->>'user_id')::uuid, v_ntype, v_title, v_body, 'accident', acc.id$a$, 1, 'accident.inapp');
  execute d;

  -- 5. upload gap cron -----------------------------------------------------
  sig := 'public.cron_check_upload_gaps()';
  d := pg_get_functiondef(sig::regprocedure);
  insert into _bak.push_fanout_20260924 (fn, def) values (sig, d) on conflict (fn) do nothing;
  d := pg_temp._patch(d, $a$'push_token', p.push_token, 'role', p.role)), '[]'::jsonb)$a$,
                         $a$'push_token', t.tok, 'role', p.role)), '[]'::jsonb)$a$, 1, 'gaps.select');
  d := pg_temp._patch(d, E'            into v_recipients\n            from public.profiles p\n',
                         E'            into v_recipients\n            from public.profiles p\n            cross join lateral public._user_push_tokens(p.id) t(tok)\n', 1, 'gaps.from');
  d := pg_temp._patch(d, E'             and p.push_token is not null and btrim(p.push_token) <> \'\'\n', '', 1, 'gaps.where');
  execute d;

  -- 6. approval decision (to the requester) -------------------------------
  sig := 'public.notify_submission_decision()';
  d := pg_get_functiondef(sig::regprocedure);
  insert into _bak.push_fanout_20260924 (fn, def) values (sig, d) on conflict (fn) do nothing;
  d := pg_temp._patch(d, $a$SELECT push_token INTO token FROM profiles WHERE id=requestor AND org_id=NEW.organisation_id;$a$,
                         $a$SELECT min(tk) INTO token FROM profiles pr CROSS JOIN LATERAL public._user_push_tokens(pr.id) tk WHERE pr.id=requestor AND pr.org_id=NEW.organisation_id;$a$, 1, 'decision.token');
  d := pg_temp._patch(d, $a$'recipients',jsonb_build_array(jsonb_build_object('user_id',requestor,'push_token',token))),1,'pending');$a$,
                         $a$'recipients',(SELECT jsonb_agg(jsonb_build_object('user_id',requestor,'push_token',tk)) FROM public._user_push_tokens(requestor) tk)),(SELECT count(*)::int FROM public._user_push_tokens(requestor)),'pending');$a$, 1, 'decision.recipients');
  execute d;

  -- 7. broadcast -----------------------------------------------------------
  sig := 'public.broadcast_send(text,text,text,text,text[],text[],text[],boolean)';
  d := pg_get_functiondef(sig::regprocedure);
  insert into _bak.push_fanout_20260924 (fn, def) values (sig, d) on conflict (fn) do nothing;
  d := pg_temp._patch(d, $a$jsonb_build_object('user_id', a.id, 'push_token', a.token))$a$,
                         $a$jsonb_build_object('user_id', a.id, 'push_token', t.tok))$a$, 1, 'broadcast.select');
  d := pg_temp._patch(d, $a$from _bc_aud a where a.token is not null and a.lang = v_lang;$a$,
                         $a$from _bc_aud a cross join lateral public._user_push_tokens(a.id) t(tok) where a.token is not null and a.lang = v_lang;$a$, 1, 'broadcast.from');
  execute d;

  -- 8. console "Clear device" also revokes every user_devices row ---------
  sig := 'public.admin_clear_push_token(uuid)';
  d := pg_get_functiondef(sig::regprocedure);
  insert into _bak.push_fanout_20260924 (fn, def) values (sig, d) on conflict (fn) do nothing;
  d := pg_temp._patch(d, E'   WHERE id = p_user_id;\n',
                         E'   WHERE id = p_user_id;\n  UPDATE public.user_devices\n     SET revoked = true, last_seen_at = now()\n   WHERE user_id = p_user_id AND NOT coalesce(revoked, false);\n', 1, 'clear.revoke');
  execute d;

  -- Guard: no consumer may still read profiles.push_token for a recipient.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('consume_event_approval_push','consume_event_assignment_push','consume_event_workflow_notify',
                         'consume_event_accident_notify','cron_check_upload_gaps','notify_submission_decision','broadcast_send')
       and pg_get_functiondef(p.oid) not like '%_user_push_tokens%') then
    raise exception 'push fan-out: a consumer was not re-pointed';
  end if;
end $$;

revoke all on schema _bak from anon, authenticated;
