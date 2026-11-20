-- =============================================================================
-- 20261120112000_inv_source_receipt.sql
-- STATUS: AUTHORED, NOT APPLIED. Requires 20261120100000..111000.
-- Rollback: 20261120112000_inv_source_receipt_ROLLBACK.sql
--
-- Closes the client gap recorded in docs/inventory/91 section 9: a serial or
-- lot tracked item on a balance that holds BOTH known-cost and unknown-cost
-- units is refused by _inv_post until the outbound movement names the receipt
-- the units came from (source_receipt_movement_id, specific identification).
-- The ledger already supports that key, but the two client writers that post
-- outbound stock never forwarded it:
--   * _inv_issue (behind inv_issue)                  -> issue
--   * _inv_transfer_dispatch (behind inv_transfer_dispatch) -> transfer_out
-- So such an item could not be issued or dispatched by anyone.
--
-- 1. Both functions are patched IN PLACE from their live definition
--    (pg_get_functiondef + one anchored replace each, aborting unless the anchor
--    occurs exactly once). Nothing is retyped. The original definitions are kept
--    in _bak.inv_112000_snapshot and the rollback executes them verbatim.
--    CREATE OR REPLACE keeps owner, SECURITY DEFINER, search_path and ACL.
-- 2. v_inv_receipt_sources (security_invoker, read-only): candidate receipt
--    movements per balance, mirroring the exact checks _inv_post applies to a
--    named receipt (positive quantity on the same balance, no pending_in_change,
--    not reversed) with the remaining quantity computed the same way. The unit
--    cost is NULL without stock:view_value. Base-table RLS (org, country, site,
--    blind count) applies because the view is security_invoker.
--
-- No balance, movement, cost or approval row is written by this migration.
-- =============================================================================
begin;

create schema if not exists _bak;
create table if not exists _bak.inv_112000_snapshot (
  obj text primary key,
  def text not null,
  captured_at timestamptz not null default now()
);
revoke all on _bak.inv_112000_snapshot from public;

do $$
declare
  v_def text; v_new text; v_anchor text; v_repl text; v_n int; v_md5 text;
  r record;
begin
  -- FINGERPRINT GUARD: md5 of pg_get_functiondef with chr(13) stripped, taken from
  -- the PGlite output of 20261120100000..111000 (the release that creates them).
  for r in select * from (values
    ('public._inv_issue(jsonb)', '761664c25b2a0094e27ee743952090e5',
     $a$'source_doc_type', coalesce(p->>'source_doc_type', 'issue'),$a$,
     $b$'source_doc_type', coalesce(p->>'source_doc_type', 'issue'), 'source_receipt_movement_id', p->>'source_receipt_movement_id',$b$),
    ('public._inv_transfer_dispatch(jsonb)', 'f79392c776f065ea9c8ca0791044984b',
     $a$'reason', 'Dispatch ' || v_t.ref,$a$,
     $b$'reason', 'Dispatch ' || v_t.ref, 'source_receipt_movement_id', l->>'source_receipt_movement_id',$b$)
  ) v(sig, md5, anchor, repl) loop
    if to_regprocedure(r.sig) is null then
      raise exception '112000: % is missing; apply 20261120100000..111000 first.', r.sig;
    end if;
    v_def := pg_get_functiondef(to_regprocedure(r.sig));
    if position('source_receipt_movement_id' in v_def) > 0 then
      raise notice '112000: % already forwards source_receipt_movement_id; left as is.', r.sig;
      continue;
    end if;
    v_md5 := md5(replace(v_def, chr(13), ''));
    if v_md5 <> r.md5 then
      raise exception '112000: % differs from the reviewed definition (md5 % expected %); refusing to patch.',
        r.sig, v_md5, r.md5;
    end if;
    v_n := (length(v_def) - length(replace(v_def, r.anchor, ''))) / length(r.anchor);
    if v_n <> 1 then
      raise exception '112000: anchor found % times in %; refusing to patch.', v_n, r.sig;
    end if;
    insert into _bak.inv_112000_snapshot(obj, def) values (r.sig, v_def)
      on conflict (obj) do nothing;
    v_new := replace(v_def, r.anchor, r.repl);
    execute v_new;
  end loop;
end $$;

create or replace view public.v_inv_receipt_sources with (security_invoker = on) as
with recv as (
  select m.id, m.stock_id, m.item_id, m.movement_type, m.movement_seq, m.posted_at, m.reference_no,
         m.source_doc_type, m.source_doc_id, m.qty_change, m.value_change, m.unvalued_qty_change, m.unit_cost,
         m.currency, m.site, m.country, m.location_id, m.organisation_id
    from public.stock_movements m
   where m.qty_change > 0
     and m.pending_in_change = 0
     and m.stock_id is not null
     and not exists (select 1 from public.stock_movements r where r.reverses_movement_id = m.id)
)
select recv.id as movement_id, recv.stock_id, recv.item_id, mm.item_code, recv.movement_type, recv.movement_seq,
       recv.posted_at, recv.reference_no, recv.source_doc_type, recv.source_doc_id,
       recv.qty_change as received_qty,
       recv.qty_change - coalesce((
         select sum(-x.qty_change) from public.stock_movements x
          where x.source_receipt_movement_id = recv.id
            and not exists (select 1 from public.stock_movements y where y.reverses_movement_id = x.id)), 0) as remaining_qty,
       (recv.value_change is not null and recv.unvalued_qty_change = 0) as cost_known,
       case when (select public.inv_can('view_value')) and recv.value_change is not null and recv.unvalued_qty_change = 0
            then coalesce(recv.unit_cost, round(recv.value_change / recv.qty_change, 4)) end as unit_cost,
       recv.currency, recv.site, recv.country, recv.location_id, recv.organisation_id
  from recv
  left join public.material_master mm on mm.id = recv.item_id;

revoke all on public.v_inv_receipt_sources from anon;
grant select on public.v_inv_receipt_sources to authenticated;

commit;
