-- =====================================================================================
-- V432 - Accident closure hard-stop.
--
-- The V398 stage ledger records skipped stages, but intentionally did not block a direct
-- jump to closed. This migration makes the current live legacy closure path enforceable:
-- only approve_accident_closure() may transition a case into closed.
-- =====================================================================================

create or replace function public.accident_prevent_direct_close()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_new_closed boolean;
  v_old_closed boolean;
  v_closure_token text;
begin
  v_new_closed :=
       lower(coalesce(NEW.closure_status, '')) = 'closed'
    or lower(coalesce(NEW.workflow_stage, '')) = 'closed'
    or (
      lower(coalesce(NEW.status, '')) = 'closed'
      and lower(coalesce(NEW.workflow_stage, '')) <> 'cancelled'
    );

  v_old_closed :=
       lower(coalesce(OLD.closure_status, '')) = 'closed'
    or lower(coalesce(OLD.workflow_stage, '')) = 'closed'
    or (
      lower(coalesce(OLD.status, '')) = 'closed'
      and lower(coalesce(OLD.workflow_stage, '')) <> 'cancelled'
    );

  if v_new_closed and not v_old_closed then
    v_closure_token := current_setting('app.accident_closure_approved', true);
    if v_closure_token is distinct from NEW.id::text then
      raise exception 'Accident closure requires approval through approve_accident_closure()'
        using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_accident_enforce_direct_close_guard on public.accidents;
create trigger trg_accident_enforce_direct_close_guard
before update on public.accidents
for each row
execute function public.accident_prevent_direct_close();

create or replace function public.approve_accident_closure(p_accident_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_requester uuid;
  v_updated integer;
begin
  if not public.is_elevated_user() then
    raise exception 'Only Admin, Manager or Director can approve closures';
  end if;

  select coalesce(full_name, username, 'Approver')
    into v_name
    from public.profiles
   where id = auth.uid();

  select close_requested_by
    into v_requester
    from public.accidents
   where id = p_accident_id;

  perform set_config('app.accident_closure_approved', p_accident_id::text, true);

  update public.accidents
     set closure_status = 'closed',
         status = 'closed',
         workflow_stage = 'closed',
         closure_approved_by = auth.uid(),
         closure_approved_at = now()
   where id = p_accident_id
     and closure_status = 'pending_closure';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Accident closure is not pending approval';
  end if;

  insert into public.accident_remarks (accident_id, author_id, author_name, remark, remark_type)
  values (p_accident_id, auth.uid(), v_name, 'Closure approved', 'closure_approved');

  if v_requester is not null and v_requester <> auth.uid() then
    insert into public.notifications (user_id, type, title, body, entity_type, entity_id)
    values (
      v_requester,
      'closure_approved',
      'Closure approved',
      'Your accident closure was approved by ' || v_name || '.',
      'accident',
      p_accident_id
    );
  end if;
end;
$$;

grant execute on function public.approve_accident_closure(uuid) to authenticated;
revoke execute on function public.approve_accident_closure(uuid) from public, anon;
revoke execute on function public.accident_prevent_direct_close() from public, anon, authenticated;
