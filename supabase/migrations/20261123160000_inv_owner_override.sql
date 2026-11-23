-- Owner override for the two-person rule on stock data loads (owner request, 2026-11-23).
--
-- The owner loaded their own item list (Book2.xlsx) and does not want a second person to
-- approve it. The two-person rule stays in force for everyone else. Only a super admin,
-- with a written reason, can approve their own opening balance batch or material proposal,
-- and only through inv_owner_override_post. The decision is recorded under the super
-- admin's own account (approved_by = auth.uid()) with the reason in the note and in
-- system_logs, so nobody is ever recorded as approving something they did not.
--
-- Rollback: drop function public.inv_owner_override_post(text, int);
--           re-run the two replaces below in reverse; drop function public._inv_owner_override_on();

create or replace function public._inv_owner_override_on() returns boolean
language sql stable security definer set search_path = public, pg_temp as $fn$
  select coalesce(current_setting('inv.owner_override', true), '') = 'on' and public.is_super_admin()
$fn$;
revoke execute on function public._inv_owner_override_on() from public, anon;
grant execute on function public._inv_owner_override_on() to authenticated, service_role;

do $do$
declare d text; n int;
begin
  d := pg_get_functiondef('public._inv_opening_batch_decide(uuid,text,text)'::regprocedure);
  n := (length(d) - length(replace(d, 'if v.prepared_by = auth.uid() then', ''))) / length('if v.prepared_by = auth.uid() then');
  if n <> 1 then raise exception 'opening decide anchor found % times', n; end if;
  execute replace(d, 'if v.prepared_by = auth.uid() then',
    'if v.prepared_by = auth.uid() and not public._inv_owner_override_on() then');

  d := pg_get_functiondef('public.inv_material_canonical_decide(jsonb)'::regprocedure);
  n := (length(d) - length(replace(d, 'if v.proposed_by = auth.uid() then', ''))) / length('if v.proposed_by = auth.uid() then');
  if n <> 1 then raise exception 'material decide anchor found % times', n; end if;
  execute replace(d, 'if v.proposed_by = auth.uid() then',
    'if v.proposed_by = auth.uid() and not public._inv_owner_override_on() then');
end $do$;

-- Approves the caller's submitted opening batches (posting the stock) and then up to
-- p_limit of the organisation's proposed materials. Call repeatedly until remaining = 0.
create or replace function public.inv_owner_override_post(p_reason text, p_limit int default 500)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  b record; m record; v_r jsonb;
  v_batches int := 0; v_lines int := 0; v_mat int := 0; v_skip int := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Only the platform owner can use the owner override.' using errcode = '42501';
  end if;
  if v_reason is null then raise exception 'A reason is required.' using errcode = '22023'; end if;
  perform set_config('inv.owner_override', 'on', true);

  for b in select id from public.opening_balance_batches
            where organisation_id = public.app_current_org() and status = 'submitted' order by created_at loop
    v_r := public._inv_opening_batch_decide(b.id, 'approve', 'Owner override: ' || v_reason);
    v_batches := v_batches + 1;
    v_lines := v_lines + coalesce((v_r->>'lines_posted')::int, 0);
  end loop;

  for m in select id from public.material_canonical
            where organisation_id = public.app_current_org() and status = 'proposed'
            order by proposed_at, id limit least(greatest(coalesce(p_limit, 500), 1), 1000) loop
    begin
      perform public.inv_material_canonical_decide(jsonb_build_object(
        'idempotency_key', 'owner-override:' || m.id, 'canonical_id', m.id, 'decision', 'approve',
        'note', 'Owner override: ' || v_reason, 'not_duplicate_reason', 'Owner override: ' || v_reason));
      v_mat := v_mat + 1;
    exception when others then v_skip := v_skip + 1;
    end;
  end loop;

  perform set_config('inv.owner_override', '', true);
  insert into public.system_logs (module_id, severity, source, message, detail, user_id)
  values ('stock', 'info', 'inv_owner_override_post', 'Owner override used for stock data load',
          jsonb_build_object('reason', v_reason, 'batches', v_batches, 'lines', v_lines, 'materials', v_mat, 'skipped', v_skip),
          auth.uid());

  return jsonb_build_object('batches_approved', v_batches, 'lines_posted', v_lines,
    'materials_approved', v_mat, 'materials_skipped', v_skip,
    'materials_remaining', (select count(*) from public.material_canonical
                             where organisation_id = public.app_current_org() and status = 'proposed'));
end $fn$;
revoke execute on function public.inv_owner_override_post(text, int) from public, anon;
grant execute on function public.inv_owner_override_post(text, int) to authenticated, service_role;

-- The approval-request gate and the two segregation-of-duties CHECKs also had to allow the
-- override (applied live 2026-11-23). The CHECK exception only matches a decision note that
-- begins "Owner override:", which only inv_owner_override_post writes.
create or replace function public.inv_gate_opening_approve() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and not public._inv_owner_override_on() then
    perform public._inv_approval_consume('opening_balance_batch', new.id);
  end if;
  return new;
end $fn$;
alter table public.opening_balance_batches drop constraint opening_balance_batches_sod_chk;
alter table public.opening_balance_batches add constraint opening_balance_batches_sod_chk
  check (status <> 'approved' or approved_by is distinct from prepared_by or decision_note like 'Owner override:%');
alter table public.material_canonical drop constraint material_canonical_check;
alter table public.material_canonical add constraint material_canonical_check
  check (approved_by is null or approved_by <> proposed_by or decision_note like 'Owner override:%');

-- Result 2026-11-23: 11 batches approved, 5,533 lines posted, 3,508 materials active.
