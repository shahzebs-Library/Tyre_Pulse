-- Follow-up to 20261104090000 (code review on PR #466): reopening a corrective
-- action that is In Progress must also reopen its Action Center item.
-- The action-item guard does not allow in_progress -> open, so the sync sets a
-- transaction-local flag (tp.action_sync) that permits only that one step.
-- PostgREST cannot set this flag (set_config is not an exposed RPC), so the
-- guard is unchanged for every client write.
-- Applied by anchored replacement of the live definitions; aborts if an anchor
-- is not found exactly once.
do $mig$
declare
  d text;
  a1 text := $a$    if not v_allowed then
      raise exception 'Invalid action item transition: % -> %', old.status, new.status$a$;
  b1 text := $b$    if not v_allowed and new.status = 'open'
       and current_setting('tp.action_sync', true) = 'on' then
      v_allowed := true;
    end if;
    if not v_allowed then
      raise exception 'Invalid action item transition: % -> %', old.status, new.status$b$;
  a2 text := $a$    elsif v_target = 'open' and v_item.status in ('resolved', 'dismissed') then
      update public.action_items set status = 'open' where id = v_item.id;
    end if;$a$;
  b2 text := $b$    elsif v_target = 'open' and v_item.status <> 'open' then
      perform set_config('tp.action_sync', 'on', true);
      update public.action_items set status = 'open' where id = v_item.id;
      perform set_config('tp.action_sync', '', true);
    end if;$b$;
begin
  d := pg_get_functiondef('public.action_item_before_write'::regproc);
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 then
    raise exception 'anchor 1 not found exactly once';
  end if;
  execute replace(d, a1, b1);

  d := pg_get_functiondef('public.sync_corrective_to_action_item'::regproc);
  if (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'anchor 2 not found exactly once';
  end if;
  execute replace(d, a2, b2);
end
$mig$;
