-- 20261112107000_ai_cost_review_fixes.sql
-- STATUS: APPLIED LIVE 2026-11-10 via Supabase MCP apply_migration (fixes for Codex review on PR #484).
--
-- Three defects in the 2026-11-12 batch, all confirmed against the live database:
--
-- 1. ai_orchestrator_settle_budget wrote ai_token_logs.total_tokens, which is GENERATED ALWAYS
--    (prompt_tokens + completion_tokens). Every settlement would have failed, leaving reservations
--    'reserved' forever and charging the worst-case estimate against the monthly cap.
--    Verified: 0 reservations existed when this was fixed, so nothing was stranded.
--
-- 2. Tyre cost audit apply could be aimed at another tenant's tyre. tcaf_insert let an elevated user
--    insert a finding already marked 'approved' with any tyre_id, and tyre_cost_audit_apply
--    (SECURITY DEFINER) updated tyre_records by id without checking that tyre's organisation or
--    country. Fixes: inserts must be 'proposed' and undecided; apply now requires the target tyre and
--    the source line to belong to the finding's organisation and country, and the caller must be able
--    to see that country.
--
-- 3. Knowledge base: chunk rows skipped the lifecycle guard, so an approved document's content could
--    be changed by editing, adding or deleting its chunks without a new approved version. Chunk writes
--    by a signed-in user are now refused while the parent is approved (or superseded/expired);
--    a draft parent's chunks stay writable. Service role (embed-worker) is unaffected.
--
-- ROLLBACK: re-apply the function bodies and policy from 20261112100000/103000/106000.

-- 1 ─────────────────────────────────────────────────────────────────────────
create or replace function public.ai_orchestrator_settle_budget(
  p_attempt uuid, p_outcome text, p_actual_usd numeric, p_cost_known boolean,
  p_model text, p_prompt_tokens integer, p_completion_tokens integer,
  p_http_status integer, p_error text, p_latency_ms integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.ai_budget_reservations; v_log uuid; v_status text; v_cost numeric;
begin
 if p_attempt is null or p_outcome is null or p_outcome not in ('success', 'error', 'released') then
  return jsonb_build_object('ok', false, 'reason', 'Invalid settle request');
 end if;
 if p_actual_usd is not null and p_actual_usd < 0 then
  return jsonb_build_object('ok', false, 'reason', 'Invalid cost');
 end if;
 select * into v_row from public.ai_budget_reservations where id = p_attempt for update;
 if not found then
  return jsonb_build_object('ok', false, 'reason', 'Unknown attempt');
 end if;
 if v_row.status <> 'reserved' then
  return jsonb_build_object('ok', true, 'already', true, 'state', v_row.status, 'token_log_id', v_row.token_log_id);
 end if;
 if p_outcome = 'released' then
  update public.ai_budget_reservations
     set status = 'released', actual_usd = 0, settled_at = now(), error = left(p_error, 500)
   where id = p_attempt;
  return jsonb_build_object('ok', true, 'already', false, 'state', 'released');
 end if;
 if p_outcome = 'success' or coalesce(p_cost_known, false) then
  v_status := 'settled'; v_cost := coalesce(p_actual_usd, 0);
 else
  v_status := 'unknown'; v_cost := null;
 end if;
 -- total_tokens is GENERATED ALWAYS: never supply it.
 insert into public.ai_token_logs (user_id, organisation_id, model, feature, prompt_tokens, completion_tokens,
   cost_usd, status, http_status, error, latency_ms)
 values (v_row.user_id, v_row.organisation_id, coalesce(nullif(p_model, ''), 'unknown'), v_row.feature,
   greatest(coalesce(p_prompt_tokens, 0), 0), greatest(coalesce(p_completion_tokens, 0), 0),
   v_cost, case when p_outcome = 'success' then 'success' else 'error' end, p_http_status,
   case when v_status = 'unknown'
        then left(coalesce(p_error, 'AI request failed') || ' (cost unknown, reservation kept)', 500)
        else left(p_error, 500) end,
   p_latency_ms)
 returning id into v_log;
 update public.ai_budget_reservations
    set status = v_status, actual_usd = p_actual_usd, token_log_id = v_log, settled_at = now(),
        error = left(p_error, 500)
  where id = p_attempt;
 return jsonb_build_object('ok', true, 'already', false, 'state', v_status, 'token_log_id', v_log);
end $$;
revoke all on function public.ai_orchestrator_settle_budget(uuid, text, numeric, boolean, text, integer, integer, integer, text, integer) from public, anon, authenticated;
grant execute on function public.ai_orchestrator_settle_budget(uuid, text, numeric, boolean, text, integer, integer, integer, text, integer) to service_role;

-- 2 ─────────────────────────────────────────────────────────────────────────
drop policy if exists tcaf_insert on public.tyre_cost_audit_findings;
create policy tcaf_insert on public.tyre_cost_audit_findings for insert to authenticated
  with check (((select public.app_is_elevated()) or (select public.is_super_admin()))
    and status = 'proposed' and decided_by is null and decided_at is null
    and applied_batch is null and applied_at is null);

create or replace function public.tyre_cost_audit_apply(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_batch uuid := gen_random_uuid(); v_n int; v_km_before numeric; v_km_after numeric;
begin
  if not (public.app_role() in ('admin') or public.is_super_admin()) then
    raise exception 'Only an Admin can apply financial corrections' using errcode = '42501';
  end if;
  select coalesce(sum(coalesce(t.km_at_fitment,0) + coalesce(t.km_at_removal,0) + coalesce(t.total_km,0)), 0) into v_km_before
  from public.tyre_records t join public.tyre_cost_audit_findings f on f.tyre_id = t.id
  where f.id = any(p_ids);

  with todo as (
    select f.id fid, f.tyre_id, f.class, f.original_cost, f.proposed_cost
    from public.tyre_cost_audit_findings f
    join public.tyre_records tr on tr.id = f.tyre_id
    where f.id = any(p_ids) and f.status = 'approved'
      and (f.organisation_id = public.app_current_org() or public.is_super_admin())
      -- the target tyre must belong to the finding's own tenant and country, visible to the caller
      and tr.organisation_id = f.organisation_id
      and tr.country is not distinct from f.country
      and (tr.country is null or public.app_can_see_country(tr.country) is not false)
      and (
        (f.class in ('exact_match', 'same_month_item_match') and exists (
          select 1 from public.parts_consumption p
          where p.id::text = f.source_line_id
            and p.organisation_id = f.organisation_id and p.country = f.country
            and p.qty_n > 0 and p.line_cost > 0
            and round(p.line_cost / p.qty_n, 2) = f.proposed_cost
            and to_char(p.event_date, 'YYYY-MM') = f.month
            and upper(regexp_replace(coalesce(p.item_code,''), '\s+', '', 'g')) = coalesce(f.item_code, '')
            and public.tyre_cost_line_kind(p.item_description) = 'tyre'))
        or (f.class = 'priced_estimate_not_verified' and exists (
          select 1 from public.tyre_price_backfill_log l
          where l.tyre_id = f.tyre_id and l.source = 'comparable' and l.new_cost = f.original_cost)))
    for update of f),
  upd as (
    update public.tyre_records t
       set cost_per_tyre = case when d.class = 'priced_estimate_not_verified' then null else d.proposed_cost end
      from todo d
     where t.id = d.tyre_id
       and t.cost_per_tyre is not distinct from d.original_cost
       and (d.class = 'priced_estimate_not_verified' or (d.proposed_cost > 0 and coalesce(t.cost_per_tyre, 0) <= 0))
    returning t.id, d.fid, d.original_cost, t.cost_per_tyre new_cost, t.country, t.serial_no, d.class),
  log as (
    insert into public.tyre_cost_corrections (organisation_id, batch_id, tyre_id, country, serial_no, old_cost, new_cost, reason, created_by)
    select public.app_current_org(), v_batch, u.id, u.country, u.serial_no, u.original_cost, u.new_cost,
           case when u.class = 'priced_estimate_not_verified' then 'cost_audit_estimate_reverted_to_pending' else 'cost_audit_' || u.class end,
           auth.uid()
    from upd u returning tyre_id)
  update public.tyre_cost_audit_findings f set status = 'applied', applied_batch = v_batch, applied_at = now()
  from upd u where f.id = u.fid;
  get diagnostics v_n = row_count;

  select coalesce(sum(coalesce(t.km_at_fitment,0) + coalesce(t.km_at_removal,0) + coalesce(t.total_km,0)), 0) into v_km_after
  from public.tyre_records t join public.tyre_cost_audit_findings f on f.tyre_id = t.id where f.id = any(p_ids);
  if v_km_after <> v_km_before then
    raise exception 'Kilometres changed during a price correction; nothing was applied' using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true, 'applied', v_n, 'batch', v_batch, 'undo', 'select public.tyre_cost_correction_undo(''' || v_batch || ''')');
end $$;
revoke all on function public.tyre_cost_audit_apply(uuid[]) from public, anon;
grant execute on function public.tyre_cost_audit_apply(uuid[]) to authenticated;

-- 3 ─────────────────────────────────────────────────────────────────────────
create or replace function public.kb_lifecycle_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_old text := case when tg_op = 'UPDATE' then old.status else null end;
  v_parent_status text;
begin
  if new.chunk_of is not null then
    -- A signed-in user may only write chunks of a draft parent. Approved content changes need a new version.
    if v_uid is not null then
      select status into v_parent_status from public.knowledge_documents where id = new.chunk_of;
      if v_parent_status is distinct from 'draft' then
        raise exception 'The parent document is %; upload a new version instead of editing its content', coalesce(v_parent_status, 'missing')
          using errcode = '22023';
      end if;
      if tg_op = 'UPDATE' and old.chunk_of is distinct from new.chunk_of then
        select status into v_parent_status from public.knowledge_documents where id = old.chunk_of;
        if v_parent_status is distinct from 'draft' then
          raise exception 'A chunk cannot be moved out of a % document', coalesce(v_parent_status, 'missing') using errcode = '22023';
        end if;
      end if;
    end if;
    new.status := 'draft';
    new.approved_by := null; new.approved_at := null;
    return new;
  end if;
  if v_uid is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.approved_by := null; new.approved_at := null;
    new.withdrawn_by := null; new.withdrawn_at := null;
    return new;
  end if;
  if new.status is not distinct from v_old then
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
    new.withdrawn_by := old.withdrawn_by; new.withdrawn_at := old.withdrawn_at;
    if v_old = 'approved' and (
         new.content is distinct from old.content
      or new.title is distinct from old.title
      or new.version is distinct from old.version
      or new.effective_from is distinct from old.effective_from
      or new.chunk_count is distinct from old.chunk_count) then
      raise exception 'An approved document cannot be edited. Upload a new version that supersedes it.'
        using errcode = '22023';
    end if;
    return new;
  end if;
  if not (
       (v_old = 'draft'    and new.status in ('approved','withdrawn'))
    or (v_old = 'approved' and new.status in ('superseded','expired','withdrawn'))
    or (v_old = 'expired'  and new.status = 'withdrawn')
  ) then
    raise exception 'Document status cannot change from % to %', v_old, new.status
      using errcode = '22023';
  end if;
  if not public.kb_is_approver() then
    raise exception 'Only an Admin, Manager or Director can change a document''s status'
      using errcode = '42501';
  end if;
  if new.status = 'approved' then
    if old.created_by is not null and old.created_by = v_uid then
      raise exception 'The person who uploaded a document cannot approve it'
        using errcode = '42501';
    end if;
    if coalesce(new.chunk_count, 0) = 0 and coalesce(btrim(new.content), '') = '' then
      raise exception 'A document with no content cannot be approved' using errcode = '22023';
    end if;
    new.approved_by := v_uid;
    new.approved_at := now();
    if new.effective_from is null then new.effective_from := current_date; end if;
  elsif new.status = 'withdrawn' then
    new.withdrawn_by := v_uid;
    new.withdrawn_at := now();
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  else
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
  end if;
  return new;
end;
$$;
revoke all on function public.kb_lifecycle_guard() from public, anon, authenticated;

-- Deleting a chunk of an approved document changes its content too.
create or replace function public.kb_chunk_delete_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_parent_status text;
begin
  if old.chunk_of is not null and auth.uid() is not null then
    select status into v_parent_status from public.knowledge_documents where id = old.chunk_of;
    if v_parent_status in ('approved', 'superseded', 'expired') then
      raise exception 'A chunk of a % document cannot be deleted', v_parent_status using errcode = '22023';
    end if;
  end if;
  return old;
end;
$$;
revoke all on function public.kb_chunk_delete_guard() from public, anon, authenticated;
drop trigger if exists trg_kb_chunk_delete_guard on public.knowledge_documents;
create trigger trg_kb_chunk_delete_guard
  before delete on public.knowledge_documents
  for each row execute function public.kb_chunk_delete_guard();
