-- A support note saved together with a status change stays internal.
-- STATUS: APPLIED live 2026-10-04. At apply time 0 status events carried a note, so nothing had leaked.
-- Before: set_user_issue_status stored p_note ON the 'status' event. The 20260930215000 policy hides only
-- 'comment' events from the reporter, so the reporter could read that note through the API.
-- After: the status event never carries a note; the note is written as its own 'comment' event, which the
-- existing restrictive policy already hides. Existing status-event notes are moved the same way.
-- Rollback: re-apply the 20260930150000 body of set_user_issue_status (status insert with note), and
--   update user_issue_events s set note = c.note from user_issue_events c where ... (notes are kept, only moved).
do $mig$
declare
  v_def text;
  v_old text := $o$  if v_st is distinct from v.status then
    insert into public.user_issue_events (issue_id, organisation_id, actor_id, event_type, from_value, to_value, note)
    values (v.id, v.organisation_id, v_uid, 'status', v.status, v_st, v_note);
  elsif v_note is not null then
    insert into public.user_issue_events (issue_id, organisation_id, actor_id, event_type, note)
    values (v.id, v.organisation_id, v_uid, 'comment', v_note);
  end if;$o$;
  v_new text := $n$  if v_st is distinct from v.status then
    insert into public.user_issue_events (issue_id, organisation_id, actor_id, event_type, from_value, to_value)
    values (v.id, v.organisation_id, v_uid, 'status', v.status, v_st);
  end if;
  if v_note is not null then
    insert into public.user_issue_events (issue_id, organisation_id, actor_id, event_type, note)
    values (v.id, v.organisation_id, v_uid, 'comment', v_note);
  end if;$n$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_user_issue_status';
  if v_def is null or (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'set_user_issue_status anchor not found exactly once';
  end if;
  execute replace(v_def, v_old, v_new);
end $mig$;

insert into public.user_issue_events (issue_id, organisation_id, actor_id, event_type, note, created_at)
select issue_id, organisation_id, actor_id, 'comment', note, created_at
  from public.user_issue_events
 where event_type = 'status' and note is not null;
update public.user_issue_events set note = null where event_type = 'status' and note is not null;
