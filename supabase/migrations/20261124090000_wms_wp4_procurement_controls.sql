-- =====================================================================================================================
-- WMS WP4: procurement controls (requisitions -> purchase orders -> goods receipts)
-- =====================================================================================================================
-- STATUS: APPLIED LIVE 2026-11-24 on the owner's explicit yes, in order 090000, 091000, 130000, 131000,
--   132000, 133000, 120000, 135000 (135000 indexes built CONCURRENTLY first). Verified live: data unchanged,
--   Store Keeper bare receipt and count refused (42501). Recorded in supabase_migrations.
-- Original status: AUTHORED, NOT APPLIED. Needs the owner's explicit yes. Reviewed against the live definitions on
-- 2026-11-24 and proven in rolled-back transactions as real users (see "PROOF" below). Source proposal:
-- docs/warehouse/04_PROCUREMENT_DB_CHANGES.md (items 1-8).
--
-- WHAT EACH PART DOES
--   1. requisitions.item_id -> material_master(id) (ON DELETE SET NULL) + index. The item must belong to the
--      requisition's organisation (and its country when both are set), checked by the guard trigger, because a
--      foreign key check bypasses RLS and would otherwise accept another company's item id.
--   2. trg_guard_requisition_rules (BEFORE INSERT OR UPDATE, all columns):
--        a. the requester cannot approve or reject their own requisition. NO super admin exemption (the proposal
--           had one): measured 2026-11-24, the ONLY two people holding inv_can('procure') are the two super admins,
--           so an exemption would make this control a no-op. Two super admins exist, so each can approve the
--           other's requisitions; nobody is locked out;
--        b. created_by cannot be changed after insert (otherwise 2a is beaten by re-assigning the row first:
--           requisitions_cap_update lets a procure user write any column);
--        c. 'ordered' can only follow 'approved' (live policy let a procure user go submitted -> ordered,
--           skipping the approval entirely, including on their own request). No super admin exemption either;
--        d. the item_id org/country check from part 1.
--      Backend callers with no auth.uid() (service role, cron) are not blocked.
--   3. approved_by_id uuid -> auth.users (ON DELETE SET NULL). stamp_requisition_decision now fires on every
--      INSERT/UPDATE and is the only writer of decided_at / approved_by_id / approved_by: a decision stamps
--      auth.uid() and the approver's profile name (the client-sent name is ignored), a return to draft/submitted
--      clears them, and any other update keeps the previous values (a client cannot rewrite who approved).
--   4. requisitions.currency, derived server side from the country (currency_for_country); null when the country
--      is null or unknown. Never trusted from the client.
--   5. trg_guard_po_delivery_status: 'Delivered' / 'Partial Delivery' cannot be set by hand on a PO that has
--      purchase_order_lines; only _inv_receive_goods may, via a transaction-local flag it sets around its own
--      purchase_orders update and resets straight after.
--   6. _inv_receive_goods (lead acceptance-test defects D1/D2 + the raw check-constraint error):
--        - refuses a receipt against a PO that is not Approved / Ordered / Partial Delivery (D1: a Draft PO was
--          moved Draft -> Partial Delivery by a receipt);
--        - when a PO is named, every line must name its PO line (D2: a free line was accepted on an already
--          Delivered PO, +5, bypassing the ordered-qty check, which only runs with po_line_id);
--        - its final PO status update only touches a PO that is still receivable AND has lines (D2: a zero-line
--          PO was set Delivered by one free line; D1: never move a Draft / Cancelled PO);
--        - received must be > 0 and 0 <= rejected <= received, with a plain message (rejected > received used to
--          surface the raw goods_receipt_lines check-constraint text).
--      Parts 5 and 6 patch the LIVE function body by anchored replacement (5 anchors); each must match exactly
--      once or the migration aborts. Nothing is retyped by hand. A copy of the live body is kept in _bak first.
--   9. trg_guard_po_rules (D5, separation of duties on purchase orders; purchase_orders.created_by has NO default
--      and the web sent it, so it was forgeable):
--        - INSERT by a signed-in user: created_by := auth.uid(), status must be Draft or Submitted, approved_by
--          cleared (a PO cannot be born approved);
--        - created_by is immutable once set (super admin may correct it);
--        - the creator cannot approve their own PO (no super admin exemption, same reasoning as 2a); approval only
--          from Draft / Submitted; approved_by is stamped from the approver's profile and cannot be retyped later;
--        - 'Ordered' only from 'Approved'. Backend callers with no auth.uid() are not blocked.
--   7. generate_po_number becomes SECURITY DEFINER (search_path public, extensions, pg_temp; sequence schema-
--      qualified), requires inv_can('procure'), EXECUTE revoked from PUBLIC/anon, granted to authenticated and
--      service_role. The po_seq grant to authenticated is left in place (tighten it separately once applied).
--   8. purchase_orders.po_select_authenticated: using (true) -> app_is_active(), like its siblings.
--
-- MEASURED LIVE IMPACT (2026-11-24): requisitions 0 rows, purchase_orders 0, purchase_order_lines 0,
-- goods_receipts 1 (not linked to a PO). Only _inv_receive_goods writes purchase_orders inside the database. No stored row
-- can be invalidated by any trigger or check here; the currency backfill touches 0 rows. Today's only effect is on
-- future writes. material_master rows with a null organisation_id: 0.
--
-- CLIENT: src/lib/api/requisitions.js / procurementChain.js feature-detect item_id, approved_by_id and currency
-- (fall back to the base column list when PostgREST reports a missing column), so the web works before and after.
--
-- PROOF (2026-11-24, two runs of this exact body + a test block inside BEGIN ... RAISE EXCEPTION, so everything
-- rolled back; re-checked afterwards: 0 new columns, 0 new triggers, _inv_receive_goods unpatched, 0 rows written).
-- Measured first: only the two super admins hold inv_can('procure'); the Managers (34793423, ecdcdb9e) were given a
-- stock/procure grant INSIDE the test transaction so a non-super approver could be exercised.
--   T1  Manager 34793423 approves own submitted requisition          -> 42501 refused ("cannot approve ... own")
--   T1b same Manager rejects own requisition                          -> 42501 refused
--   T2  same Manager re-assigns created_by to the other Manager       -> 42501 refused
--   T3  other Manager ecdcdb9e marks it ordered straight from submitted -> 22023 refused
--   T4  other Manager approves, sending approved_by='Forged Name'     -> allowed; approved_by_id = ecdcdb9e (auth.uid()),
--                                                                        approved_by = 'Test User' (profile), decided_at set
--   T5  requester then updates approved_by_id/approved_by/decided_at  -> 1 row "updated", all three kept unchanged
--   T6  approved -> ordered with po_ref                               -> allowed; approver kept
--   T7  item_id of another organisation / KSA item on a UAE request   -> 23503 refused; own-org KSA item -> stored,
--                                                                        currency = SAR, client approved_by='Forged' -> null
--   T8  Manager sets Delivered / Partial Delivery on a PO with lines  -> 22023 refused; PO without lines -> allowed
--   T10 owner receives against a Draft PO / a Cancelled PO             -> 22023 refused
--       owner receives the full qty against an Ordered PO              -> GRN posted, PO -> Delivered via the receipt
--                                                                        engine, app.inv_receiving back to 'off'
--   T11 generate_po_number: procure holder -> PO-2026-00004; Store Keeper 69faeb71 (no procure) and a Manager without
--       the grant -> 42501; anon EXECUTE = false; prosecdef = true
--   T12 super admin approving their own requisition                   -> 42501 refused (no exemption, see 2a)
--   Policy 8: qual = (( SELECT app_is_active() AS app_is_active) IS TRUE)
-- Third run (after the lead's D1/D2/D5 report), same rules, rolled back:
--   P0  Manager inserts a PO already 'Approved'                       -> 42501 refused
--   P1  Manager inserts a Submitted PO sending created_by = other Manager, approved_by='Forged'
--                                                                      -> created_by stamped to himself, approved_by null
--   P2  creator approves own PO -> 42501; P3 creator re-assigns created_by -> 42501
--   P4  other Manager: Submitted -> Ordered                           -> 22023 refused
--   P5  other Manager approves (sends approved_by='Forged')           -> allowed, approved_by = 'Test User'
--   P6  creator later retypes approved_by                             -> row updated, approver kept 'Test User'
--   D1  receipt against a Draft PO with a line                        -> 22023 refused, PO still Draft
--   D2a free line (no po_line_id) on an approved PO                    -> 22023 refused
--   D2b free line on a zero-line Ordered PO                            -> 22023 refused, PO still Ordered
--   M   qty_rejected 3 > qty_received 1                               -> 22023 "rejected quantity cannot be ..."
--   OK  1 of 2 received -> Partial Delivery; the other 1 -> Delivered; flag back to 'off';
--       a further 5 against the Delivered PO -> 22023 refused
--   T8  manual Delivered on a PO with lines                           -> 22023 refused
--   Side effect: sequences are not transactional, so the proof consumed po_seq values (last_value 4). Gap only.
--
-- REVIEW FIXES + ROLLED-BACK PROOF, ROUND 2 (2026-11-24). All 8 files applied in order (090000, 091000, 130000,
-- 131000, 132000, 133000, 120000, 135000; the 135000 work_orders index build left out of the run because of its
-- SHARE lock) in ONE implicit transaction through the Supabase CLI, then a test block as real users (claims + role
-- authenticated) ending in RAISE EXCEPTION, so everything rolled back; re-checked afterwards: purchase_orders 0,
-- test suppliers 0, test grants 0, procurement_rfqs and _inv_job_card_resolve absent, purchase_orders.updated_by
-- absent. Users: super admin d2d43a5f (SA), Store Keeper 69faeb71 (SK), Managers 34793423 (M1) / ecdcdb9e (M2);
-- extra stock / fleet grants were given INSIDE the transaction. Script: scratchpad review_round2_proof.sql.
--   Changes here: wrapped in begin/commit; _bak.inv_receive_goods_wp4 is versioned (A14); new server-stamped
--   requisitions.updated_by, purchase_orders.updated_by, purchase_order_lines.created_by (trg_stamp_po_line_creator);
--   a submitted requisition's item / qty / item_id / site / country / est_cost / category / job card are frozen and
--   its last editor cannot decide it (A12); a PO out of Draft/Submitted cannot change supplier, names, currency,
--   country, site, totals (A3); the PO creator, last header editor and anyone who added a line cannot approve (A3).
--   A12.1 M1 edits item of a submitted requisition            -> 22023 refused
--   A12.2 M2 edits its quantity                               -> 22023 refused
--   A12.3 M2 edits notes, then approves                       -> 42501 "You made the last change ..."
--   A12.4 SA approves                                         -> approved, approved_by_id = SA
--   A3.1  M2 adds a PO line, then approves                    -> 42501 "You added a line ..."
--   A3.2  M2 edits PO notes, then approves                    -> 42501 "You made the last change ..."
--   A3.5/6 total / supplier name of an Approved PO changed     -> 22023 refused;  A3.7 notes -> 1 row updated
-- ROUND 3 (2026-11-24, same rolled-back full-chain run, every earlier case re-run unchanged; script
-- scratchpad review_round3_proof.sql):
--   item 2: approved / rejected only from submitted (22023); a signed-in user inserts only draft / submitted (22023)
--   item 4: PO freeze uses coalesce(old.status, '');  item 7: live stamp_requisition_decision() + its trigger saved to
--   versioned _bak.wms_wp4_obj_backup_20261124 while unpatched; the undo runs the newest rows.
--   R3.3b draft requisition edited and set approved in one update -> 22023 "Only a submitted requisition ..."
--   R3.4  requisition inserted as approved                        -> 22023 "A new requisition starts as draft or submitted."
--   R3.9  backup rows: function stamp_requisition_decision, trigger trg_stamp_requisition_decision
-- VERIFY AFTER APPLY
--   select column_name from information_schema.columns where table_schema='public' and table_name='requisitions'
--    and column_name in ('item_id','approved_by_id','currency');                                       -- 3 rows
--   select tgname from pg_trigger where tgrelid='public.requisitions'::regclass and not tgisinternal;   -- has guard
--   select tgname from pg_trigger where tgrelid='public.purchase_orders'::regclass and tgname='trg_guard_po_delivery_status';
--   select prosecdef, proconfig from pg_proc where proname='generate_po_number';                        -- t, pinned
--   select has_function_privilege('anon','public.generate_po_number()','EXECUTE');                       -- false
--   select pg_get_functiondef('public._inv_receive_goods(jsonb)'::regprocedure) like '%app.inv_receiving%'; -- true
--   select qual from pg_policies where policyname='po_select_authenticated';                            -- app_is_active
--   select tgname from pg_trigger where tgname='trg_guard_po_rules';                                    -- 1 row
--   select pg_get_functiondef('public._inv_receive_goods(jsonb)'::regprocedure) like '%choose the PO line%';  -- true
--
-- UNDO (run as one transaction)
--   alter policy po_select_authenticated on public.purchase_orders using (true);
--   create or replace function public.generate_po_number() returns text language plpgsql
--     set search_path = public, extensions as $f$ begin return 'PO-' || to_char(now(), 'YYYY') || '-' ||
--     lpad(nextval('po_seq')::text, 5, '0'); end; $f$;                -- (CREATE OR REPLACE resets SECURITY DEFINER)
--   grant execute on function public.generate_po_number() to public;
--   -- _inv_receive_goods: restore from _bak.inv_receive_goods_wp4 (saved below):
--   --   do $u$ begin execute (select def from _bak.inv_receive_goods_wp4 order by id desc limit 1); end $u$;
--   drop trigger if exists trg_guard_po_rules on public.purchase_orders;
--   drop function if exists public.guard_po_rules();
--   drop trigger if exists trg_guard_po_delivery_status on public.purchase_orders;
--   drop function if exists public.guard_po_delivery_status();
--   drop trigger if exists trg_guard_requisition_rules on public.requisitions;
--   drop function if exists public.guard_requisition_rules();
--   drop trigger if exists trg_stamp_requisition_decision on public.requisitions;
--   do $u$ declare r record; begin      -- newest saved function body, then its trigger (round 3, item 7)
--     for r in select x.def from (select distinct on (obj) obj, def from _bak.wms_wp4_obj_backup_20261124
--                                  order by obj, id desc) x order by (x.obj like 'trigger%') loop
--       execute r.def; end loop;
--   end $u$;
--   alter table public.requisitions drop column if exists currency, drop column if exists approved_by_id,
--     drop column if exists item_id, drop column if exists updated_by;   -- drops requisitions_item_id_idx with it
--   drop trigger if exists trg_stamp_po_line_creator on public.purchase_order_lines;
--   drop function if exists public.stamp_po_line_creator();
--   alter table public.purchase_orders drop column if exists updated_by;
--   alter table public.purchase_order_lines drop column if exists created_by;
-- =====================================================================================================================

begin;

-- ── Rollback copy of the live receipt engine (parts 5 + 6 patch it) ──────────────────────────────────────────────
-- Versioned: one row per apply, taken only while the function is still UNPATCHED, so the newest row is always the
-- body that was live just before the latest real apply (an earlier apply + undo + re-apply cannot leave a stale copy).
create schema if not exists _bak;
revoke all on schema _bak from public, anon, authenticated;
create table if not exists _bak.inv_receive_goods_wp4 (id bigserial primary key, saved_at timestamptz default now(), def text not null);
alter table _bak.inv_receive_goods_wp4 add column if not exists id bigserial;
insert into _bak.inv_receive_goods_wp4(def)
  select d from (select pg_get_functiondef('public._inv_receive_goods(jsonb)'::regprocedure) as d) x
   where position('app.inv_receiving' in x.d) = 0;

-- (round 3, item 7) Versioned rollback copy of the live stamp_requisition_decision() and its trigger, taken only
-- while the function is still the short live version (no approved_by_id), so the newest rows are what was live just
-- before the latest real apply. The undo runs the newest saved rows (function first, then the trigger).
create table if not exists _bak.wms_wp4_obj_backup_20261124 (
  id bigserial primary key, obj text not null, def text not null, saved_at timestamptz not null default now());
revoke all on _bak.wms_wp4_obj_backup_20261124 from public, anon, authenticated;
insert into _bak.wms_wp4_obj_backup_20261124(obj, def)
select x.obj, x.def from (
  select 'function stamp_requisition_decision' as obj, 1 as ord,
         pg_get_functiondef('public.stamp_requisition_decision()'::regprocedure) as def
  union all
  select 'trigger trg_stamp_requisition_decision', 2, pg_get_triggerdef(t.oid) || ';'
    from pg_trigger t where t.tgrelid = 'public.requisitions'::regclass and t.tgname = 'trg_stamp_requisition_decision'
) x
where position('approved_by_id' in pg_get_functiondef('public.stamp_requisition_decision()'::regprocedure)) = 0
order by x.ord;

-- ── 1, 3, 4. Columns ────────────────────────────────────────────────────────────────────────────────────────────
alter table public.requisitions
  add column if not exists item_id uuid references public.material_master(id) on delete set null,
  add column if not exists approved_by_id uuid references auth.users(id) on delete set null,
  add column if not exists currency text;
create index if not exists requisitions_item_id_idx on public.requisitions(item_id);
-- Review A3 / A12: who last edited a requisition / PO header and who added each PO line, stamped server side from
-- auth.uid() (never client written), so the approval checks below can refuse that person.
alter table public.requisitions add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.purchase_orders add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.purchase_order_lines add column if not exists created_by uuid references auth.users(id) on delete set null;
comment on column public.requisitions.updated_by is 'Last person who edited the requisition. Stamped from auth.uid(); that person cannot approve it.';
comment on column public.purchase_orders.updated_by is 'Last person who edited the PO header. Stamped from auth.uid(); that person cannot approve it.';
comment on column public.purchase_order_lines.created_by is 'Who added the line. Stamped from auth.uid(); that person cannot approve the PO.';
comment on column public.requisitions.item_id is 'Material Master item requested; item stays the display text.';
comment on column public.requisitions.approved_by_id is 'Who approved/rejected. Stamped from auth.uid() by trg_stamp_requisition_decision; never client written.';
comment on column public.requisitions.currency is 'Derived from country by trg_stamp_requisition_decision (currency_for_country).';

update public.requisitions r set currency = public.currency_for_country(r.country)
 where r.currency is null and r.country is not null;                                       -- 0 rows today

-- ── 2. Requisition rules ────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.guard_requisition_rules()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_super boolean := coalesce(public.is_super_admin(), false);
begin
  -- d. a requested item must be this company's (and this country's, when both are known)
  if new.item_id is not null and (tg_op = 'INSERT' or new.item_id is distinct from old.item_id) then
    if not exists (select 1 from public.material_master m
                    where m.id = new.item_id
                      and m.organisation_id is not distinct from new.organisation_id
                      and (new.country is null or m.country is null
                           or upper(btrim(m.country)) = upper(btrim(new.country)))) then
      raise exception 'Choose an item from this company''s Material Master.' using errcode = '23503';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if v_uid is not null then
      -- (round 3, item 2) a signed-in user raises a requisition only as draft or submitted
      if coalesce(new.status, 'draft') not in ('draft', 'submitted') then
        raise exception 'A new requisition starts as draft or submitted.' using errcode = '22023';
      end if;
      new.updated_by := v_uid;
    end if;
    return new;
  end if;

  if v_uid is not null then
    -- b. the requester is fixed once raised (a super admin may still correct it)
    if old.created_by is not null and new.created_by is distinct from old.created_by and not v_super then
      raise exception 'The requester of a requisition cannot be changed.' using errcode = '42501';
    end if;
    -- e. (review A12) once submitted, what is asked for is frozen. Return it to draft first (in its own update).
    if coalesce(old.status, 'draft') <> 'draft'
       and ((new.item, new.quantity, new.item_id, new.site, new.country, new.est_cost, new.category,
             to_jsonb(new)->>'job_card_no')
            is distinct from
            (old.item, old.quantity, old.item_id, old.site, old.country, old.est_cost, old.category,
             to_jsonb(old)->>'job_card_no')) then
      raise exception 'A submitted requisition cannot be edited. Return it to draft first, then submit it again.'
        using errcode = '22023';
    end if;
    -- a0. (round 3, item 2) a decision is taken only on a submitted requisition
    if new.status in ('approved', 'rejected') and old.status is distinct from new.status
       and coalesce(old.status, '') <> 'submitted' then
      raise exception 'Only a submitted requisition can be approved or rejected.' using errcode = '22023';
    end if;
    -- a. no self-approval / self-rejection
    if new.status in ('approved', 'rejected') and old.status is distinct from new.status
       and old.created_by = v_uid then
      raise exception 'You cannot approve or reject your own requisition.' using errcode = '42501';
    end if;
    -- a2. (review A12) the last person who edited it cannot decide it either
    if new.status in ('approved', 'rejected') and old.status is distinct from new.status
       and old.updated_by = v_uid then
      raise exception 'You made the last change to this requisition; another person must approve or reject it.'
        using errcode = '42501';
    end if;
    -- c. ordering needs an approval first
    if new.status = 'ordered' and old.status is distinct from 'ordered' and old.status <> 'approved' then
      raise exception 'Only an approved requisition can be marked ordered.' using errcode = '22023';
    end if;
    new.updated_by := v_uid;                               -- server stamp, never client written
  else
    new.updated_by := old.updated_by;
  end if;
  return new;
end $$;
revoke execute on function public.guard_requisition_rules() from public, anon, authenticated;

create or replace trigger trg_guard_requisition_rules
  before insert or update on public.requisitions
  for each row execute function public.guard_requisition_rules();

-- ── 3 + 4. Server-stamped decision + currency (single writer) ───────────────────────────────────────────────────
create or replace function public.stamp_requisition_decision()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_name text;
begin
  new.currency := public.currency_for_country(new.country);

  if tg_op = 'INSERT' or old.status is distinct from new.status then
    if new.status in ('approved', 'rejected') then
      new.decided_at := now();
      if v_uid is not null then
        select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.username), ''))
          into v_name from public.profiles p where p.id = v_uid;
        new.approved_by_id := v_uid;
        new.approved_by := coalesce(v_name, left(v_uid::text, 8));
      end if;
    elsif new.status in ('draft', 'submitted') then
      new.decided_at := null;
      new.approved_by_id := null;
      new.approved_by := null;
    elsif tg_op = 'UPDATE' then          -- e.g. approved -> ordered keeps the decision
      new.decided_at := old.decided_at;
      new.approved_by_id := old.approved_by_id;
      new.approved_by := old.approved_by;
    end if;
  elsif v_uid is not null then           -- no status change: the decision fields are not client editable
    new.decided_at := old.decided_at;
    new.approved_by_id := old.approved_by_id;
    new.approved_by := old.approved_by;
  end if;
  return new;
end $$;
revoke execute on function public.stamp_requisition_decision() from public, anon, authenticated;

create or replace trigger trg_stamp_requisition_decision
  before insert or update on public.requisitions
  for each row execute function public.stamp_requisition_decision();

-- ── 5. Delivery status belongs to the receipt engine ────────────────────────────────────────────────────────────
create or replace function public.guard_po_delivery_status()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status in ('Delivered', 'Partial Delivery') and old.status is distinct from new.status
     and current_setting('app.inv_receiving', true) is distinct from 'on'
     and exists (select 1 from public.purchase_order_lines l where l.po_id = new.id) then
    raise exception 'Delivery status is set by goods receipts for a PO with lines.' using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function public.guard_po_delivery_status() from public, anon, authenticated;

create or replace trigger trg_guard_po_delivery_status
  before update of status on public.purchase_orders
  for each row execute function public.guard_po_delivery_status();

-- ── 5 + 6. Patch the live receipt engine (anchored, abort unless each anchor occurs exactly once) ────────────────
do $patch$
declare
  src text := pg_get_functiondef('public._inv_receive_goods(jsonb)'::regprocedure);
  a1 text := $a$raise exception 'Purchase order not found.' using errcode = 'P0002';$a$;
  r1 text := $a$raise exception 'Purchase order not found.' using errcode = 'P0002';
  elsif nullif(p->>'po_id', '') is not null and not exists (select 1 from public.purchase_orders po
       where po.id = (p->>'po_id')::uuid and po.organisation_id = v_org
         and po.status in ('Approved', 'Ordered', 'Partial Delivery')) then
    raise exception 'Goods can only be received against an approved or ordered PO.' using errcode = '22023';$a$;
  a2 text := $a$update public.purchase_orders po set status = case$a$;
  r2 text := $a$perform set_config('app.inv_receiving', 'on', true);
    update public.purchase_orders po set status = case$a$;
  a3 text := $a$return jsonb_build_object('grn_id', v_grn.id, 'grn_no', v_grn.grn_no, 'lines', v_n);$a$;
  a4 text := $a$v_rejected := coalesce(nullif(l->>'qty_rejected', '')::numeric, 0);$a$;
  r4 text := $a$v_rejected := coalesce(nullif(l->>'qty_rejected', '')::numeric, 0);
    if coalesce(nullif(l->>'qty_received', '')::numeric, 0) <= 0 then
      raise exception 'Line %: enter a received quantity above zero.', v_n using errcode = '22023';
    end if;
    if v_rejected < 0 or v_rejected > (l->>'qty_received')::numeric then
      raise exception 'Line %: rejected quantity cannot be negative or more than the quantity received.', v_n using errcode = '22023';
    end if;
    if v_grn.po_id is not null and nullif(l->>'po_line_id', '') is null then
      raise exception 'Line %: choose the PO line being received. Items not on the PO need their own receipt.', v_n using errcode = '22023';
    end if;$a$;
  a5 text := $a$where id = v_grn.po_id;$a$;
  r5 text := $a$where id = v_grn.po_id and po.status in ('Approved', 'Ordered', 'Partial Delivery')
       and exists (select 1 from public.purchase_order_lines y where y.po_id = po.id);$a$;
  r3 text := $a$perform set_config('app.inv_receiving', 'off', true);
  return jsonb_build_object('grn_id', v_grn.id, 'grn_no', v_grn.grn_no, 'lines', v_n);$a$;
  n int;
begin
  if position('app.inv_receiving' in src) > 0 then
    raise notice '_inv_receive_goods already patched; skipping';
    return;
  end if;
  n := (length(src) - length(replace(src, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'WP4 anchor 1 matched % times (expected 1)', n; end if;
  n := (length(src) - length(replace(src, a2, ''))) / length(a2);
  if n <> 1 then raise exception 'WP4 anchor 2 matched % times (expected 1)', n; end if;
  n := (length(src) - length(replace(src, a3, ''))) / length(a3);
  if n <> 1 then raise exception 'WP4 anchor 3 matched % times (expected 1)', n; end if;
  n := (length(src) - length(replace(src, a4, ''))) / length(a4);
  if n <> 1 then raise exception 'WP4 anchor 4 matched % times (expected 1)', n; end if;
  n := (length(src) - length(replace(src, a5, ''))) / length(a5);
  if n <> 1 then raise exception 'WP4 anchor 5 matched % times (expected 1)', n; end if;
  src := replace(replace(replace(replace(replace(src, a1, r1), a2, r2), a3, r3), a4, r4), a5, r5);
  execute src;   -- CREATE OR REPLACE keeps SECURITY DEFINER, search_path and grants
end $patch$;

-- ── 9. Purchase order separation of duties (D5) ─────────────────────────────────────────────────────────────────
create or replace function public.guard_po_rules()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_super boolean := coalesce(public.is_super_admin(), false); v_name text;
begin
  if v_uid is null then return new; end if;              -- service role / cron / receipt-engine internals
  if tg_op = 'INSERT' then
    new.created_by := v_uid;                              -- purchase_orders.created_by has no default; never trust it
    new.updated_by := v_uid;
    if coalesce(new.status, 'Draft') not in ('Draft', 'Submitted') then
      raise exception 'A new purchase order starts as Draft or Submitted.' using errcode = '42501';
    end if;
    new.approved_by := null;
    return new;
  end if;
  if old.created_by is not null and new.created_by is distinct from old.created_by and not v_super then
    raise exception 'The creator of a purchase order cannot be changed.' using errcode = '42501';
  end if;
  -- (review A3) once a PO leaves Draft / Submitted its supplier, money, currency and place are frozen; the
  -- workflow may still move its status and add notes.
  if coalesce(old.status, '') not in ('Draft', 'Submitted')
     and ((new.supplier_id, new.supplier_name, new.vendor_name, new.currency, new.country, new.site,
           new.total_amount, new.subtotal, new.tax_amount, new.organisation_id)
          is distinct from
          (old.supplier_id, old.supplier_name, old.vendor_name, old.currency, old.country, old.site,
           old.total_amount, old.subtotal, old.tax_amount, old.organisation_id)) then
    raise exception 'This purchase order is approved or placed: its supplier, currency, site and value can no longer change. Cancel it and raise a new one.'
      using errcode = '22023';
  end if;
  if new.status is distinct from old.status then
    if new.status = 'Approved' then
      if old.created_by = v_uid then
        raise exception 'You cannot approve a purchase order you created.' using errcode = '42501';
      end if;
      -- (review A3) nor one you last edited, nor one you added a line to
      if old.updated_by = v_uid then
        raise exception 'You made the last change to this purchase order; another person must approve it.' using errcode = '42501';
      end if;
      if exists (select 1 from public.purchase_order_lines l where l.po_id = old.id and l.created_by = v_uid) then
        raise exception 'You added a line to this purchase order; another person must approve it.' using errcode = '42501';
      end if;
      if old.status not in ('Draft', 'Submitted') then
        raise exception 'Only a Draft or Submitted purchase order can be approved.' using errcode = '22023';
      end if;
      select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.username), ''))
        into v_name from public.profiles p where p.id = v_uid;
      new.approved_by := left(coalesce(v_name, left(v_uid::text, 8)), 100);
      new.updated_by := v_uid;
      return new;
    elsif new.status = 'Ordered' and old.status <> 'Approved' then
      raise exception 'Only an approved purchase order can be marked ordered.' using errcode = '22023';
    end if;
  end if;
  new.approved_by := old.approved_by;                     -- the approver is stamped, never typed
  new.updated_by := v_uid;                                -- (review A3) last editor, server stamped
  return new;
end $$;
revoke execute on function public.guard_po_rules() from public, anon, authenticated;
create or replace trigger trg_guard_po_rules
  before insert or update on public.purchase_orders
  for each row execute function public.guard_po_rules();

-- (review A3) who added each PO line, server stamped (lines are written only by SECURITY DEFINER functions, which
-- run with the caller's auth.uid(), so the stamp is the real person).
create or replace function public.stamp_po_line_creator()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
revoke execute on function public.stamp_po_line_creator() from public, anon, authenticated;
create or replace trigger trg_stamp_po_line_creator
  before insert or update on public.purchase_order_lines
  for each row execute function public.stamp_po_line_creator();

-- ── 7. PO numbers ───────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.generate_po_number()
returns text language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if not coalesce(public.inv_can('procure'), false) then
    raise exception 'Stock permission "procure" is required.' using errcode = '42501';
  end if;
  return 'PO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.po_seq')::text, 5, '0');
end $$;
revoke execute on function public.generate_po_number() from public, anon;
grant execute on function public.generate_po_number() to authenticated, service_role;

-- ── 8. PO read policy aligned with its siblings ─────────────────────────────────────────────────────────────────
alter policy po_select_authenticated on public.purchase_orders using ((select public.app_is_active()) is true);

commit;
