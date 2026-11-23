-- Approve or reject many proposed materials in one action (owner request, 2026-11-23).
--
-- Loading an item list (for example 3,510 items from Book2.xlsx) creates one
-- proposal per item, and the review screen could only decide them one at a time.
-- This decides up to 500 per call.
--
-- Every item still goes through public.inv_material_canonical_decide, so ALL of its
-- rules hold, item by item:
--   * the proposer can never approve their own proposal (two-person rule);
--   * a rejection needs a note;
--   * an item with possible duplicates needs a not_duplicate_reason to be approved;
--   * only items still 'proposed' can be decided, within the caller's organisation.
-- An item that fails a rule is skipped and reported with the reason; the rest go
-- through. Each item runs in its own sub-transaction, so one failure undoes nothing else.
--
-- Payload: { idempotency_key, decision: 'approve'|'reject', ids?: uuid[],
--            search?: text, limit?: int (1..500, default 500), note?, not_duplicate_reason? }
-- With no ids it takes the oldest proposed items (optionally matching search on
-- description / company_sku), so pressing it repeatedly works through the queue.
--
-- Rollback: drop function public.inv_material_canonical_decide_bulk(jsonb);

create or replace function public.inv_material_canonical_decide_bulk(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_key text := nullif(btrim(coalesce(p_payload->>'idempotency_key', '')), '');
  v_dec text := p_payload->>'decision';
  v_limit int := least(greatest(coalesce((p_payload->>'limit')::int, 500), 1), 500);
  v_search text := nullif(btrim(coalesce(p_payload->>'search', '')), '');
  v_ids uuid[];
  v_id uuid;
  v_ok int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_reason text;
begin
  if not public.is_approved_and_unlocked() or public.app_current_org() is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if not public._inv_pi_can_master() then
    raise exception 'Master-data approval needs stock:engineering_approve or an elevated role.' using errcode = '42501';
  end if;
  if v_key is null then raise exception 'idempotency_key is required in p_payload.' using errcode = '22023'; end if;
  if v_dec not in ('approve', 'reject') then raise exception 'Decision must be approve or reject.' using errcode = '22023'; end if;
  if v_dec = 'reject' and nullif(btrim(p_payload->>'note'), '') is null then
    raise exception 'A rejection needs a note.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_payload->'ids') = 'array' then
    select array_agg(x::uuid) into v_ids
      from (select jsonb_array_elements_text(p_payload->'ids') x limit 500) s;
  else
    select array_agg(id) into v_ids from (
      select c.id from public.material_canonical c
       where c.organisation_id = public.app_current_org() and c.status = 'proposed'
         and c.proposed_by is distinct from auth.uid()
         and (v_search is null or c.description ilike '%' || v_search || '%' or c.company_sku ilike '%' || v_search || '%')
       order by c.proposed_at, c.id
       limit v_limit) s;
  end if;

  foreach v_id in array coalesce(v_ids, '{}'::uuid[]) loop
    begin
      perform public.inv_material_canonical_decide(jsonb_build_object(
        'idempotency_key', v_key || ':' || v_id,
        'canonical_id', v_id,
        'decision', v_dec,
        'note', p_payload->>'note',
        'not_duplicate_reason', p_payload->>'not_duplicate_reason'));
      v_ok := v_ok + 1;
    exception when others then
      get stacked diagnostics v_reason = message_text;
      if jsonb_array_length(v_skipped) < 50 then
        v_skipped := v_skipped || jsonb_build_object('id', v_id, 'reason', v_reason);
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'decision', v_dec,
    'requested', coalesce(array_length(v_ids, 1), 0),
    'done', v_ok,
    'skipped', coalesce(array_length(v_ids, 1), 0) - v_ok,
    'skipped_detail', v_skipped,
    'remaining_proposed', (select count(*) from public.material_canonical
                            where organisation_id = public.app_current_org() and status = 'proposed'));
end $fn$;

grant execute on function public.inv_material_canonical_decide_bulk(jsonb) to authenticated, service_role;
revoke execute on function public.inv_material_canonical_decide_bulk(jsonb) from public;
revoke execute on function public.inv_material_canonical_decide_bulk(jsonb) from anon;
