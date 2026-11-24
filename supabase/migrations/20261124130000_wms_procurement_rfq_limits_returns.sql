-- =====================================================================================================================
-- WMS procurement depth: approved suppliers, RFQ + quotation comparison, PO approval limits, emergency purchases,
-- receipt rejection reasons, supplier returns, three-way match net of returns, backorder + supplier performance views
-- =====================================================================================================================
-- STATUS: NOT APPLIED. Needs the owner's explicit yes. REQUIRES 20261124090000 (WP4 procurement controls) applied
-- first: this file patches WP4's guard_po_rules and aborts if it is missing.
--
-- AUDIT FIRST (live, read-only, 2026-11-24). Already working, NOT rebuilt here:
--   * Three-way match: supplier_invoices / supplier_invoice_lines + inv_supplier_invoice_create / _match (20261120103000)
--     compare invoice qty vs accepted GRN qty (net of earlier invoices) and invoice price vs PO price (tolerance %, same
--     currency). Only change below: accepted qty is now NET of supplier returns (part 6).
--   * Consignment / supplier-owned stock: goods_receipt_lines.ownership + owner_supplier_id, _inv_receive_goods refuses
--     consignment without an active consignment agreement, posts movement 'consignment_receipt'; inv_valuation_summary
--     values owned stock only and reports consignment separately (agreed price). Nothing to add in the database.
--   * Rejected quantity never enters stock: _inv_receive_goods posts qty_received - qty_rejected only.
--   * Approval-limit engine for inventory approvals (inventory_approval_limits + _inv_approval_extra_block, 113000):
--     reused here for purchase orders (entity_type 'purchase_order') instead of a second limits table.
--   * marketplace_rfqs is the marketplace module (product listings), not a purchasing RFQ: not reused.
--
-- WHAT THIS FILE ADDS
--   1. Approved supplier list: suppliers.approved_for_purchasing (+ approval_note, approved_by_id, approved_at). Only
--      inv_supplier_set_approval may change them (trigger keeps them otherwise; the live suppliers_active_user_update
--      policy lets any active user update a supplier row). The person who added the supplier cannot approve it.
--      suppliers.created_by is stamped from auth.uid() on insert and is immutable (it had no default and was client
--      written, so the separation check would have been forgeable).
--   2. RFQ: procurement_rfqs / _rfq_lines / _rfq_invites / procurement_quotes / _quote_lines (writes only through the
--      SECURITY DEFINER RPCs below; RLS read like every inventory table). inv_rfq_create, inv_rfq_quote_record,
--      inv_rfq_award, inv_rfq_cancel. Quotes only from approved, active suppliers. Each quote has ONE currency;
--      totals are never added across currencies. Awarding a quote that is not the lowest same-currency full quote
--      (or when quotes are in more than one currency) needs a written reason. The award creates a Draft PO through
--      the existing PO path (generate_po_number + _inv_po_add_line), so WP4's separation of duties still applies.
--   3. PO approval limits: inventory_approval_limits accepts entity_type 'purchase_order'; inv_approver_roles lists
--      who may hold a PO limit (so inv_approval_limit_upsert can set one). trg_po_controls refuses a PO approval
--      (status -> Approved) when limits exist for the company and the approver's role has none, or the PO value is
--      above it, in another currency, or unknown (an unpriced line). No limit rows = no threshold (today).
--      approved_by_id / approved_at are stamped from auth.uid() and are not client editable.
--      Admin screen (owner decision A, 2026-11-24): limits are set per role + currency through the EXISTING admin RPC
--      inv_approval_limit_upsert (super admin / Admin only, checked in the database). SAR, AED and EGP are separate rows
--      (country KSA / UAE / Egypt); "remove" = active false. When a PO has no country, a row in the PO's currency applies.
--   4. Emergency purchase (owner decision C, 2026-11-24): purchase_orders.is_emergency + a STRUCTURED justification
--      checked by the trigger (_po_emergency_normalise): category (breakdown / safety / production_stoppage /
--      customer_commitment / other + note), affected asset and/or job card (resolved and checked against vehicle_fleet /
--      work_orders in the PO's company and country by _po_emergency_link; a job card for another asset is refused),
--      impact of waiting (downtime hours or text), why the normal route could not be used (emergency_reason, >= 30 chars),
--      estimated value + currency (same currency as the PO, never converted), supplier, optional attachment path;
--      requested-by is stamped server side (emergency_declared_by + emergency_requested_by_name).
--      An emergency PO may go Draft/Submitted -> Ordered before approval (WP4 guard_po_rules patched by one anchored
--      replacement); it is then received normally and MUST be approved after the fact with inv_po_emergency_approve
--      (a second person, same limits). The flag cannot change after the PO leaves Draft/Submitted.
--   5. Receipt rejections: goods_receipt_lines.rejection_code (damaged / wrong_part / quality / expired / other).
--      A rejected quantity now needs a reason; the code is read from the reason text ("damaged: ..."). A short
--      delivery (less arrived than ordered) is not a rejection: it stays outstanding on the PO line (backorder view).
--   6. Supplier returns: supplier_returns / supplier_return_lines + inv_supplier_return. Return rejected goods (no stock
--      movement: they never entered stock) or accepted defective goods (posts a 'supplier_return' ledger movement
--      through _inv_post, credit at the GRN unit cost; refused if the stock is no longer there). Never more than was
--      received (rejected or accepted) minus earlier returns. Returning accepted goods reopens the PO line
--      (accepted -1, rejected +1) so the replacement shows as outstanding; the three-way match nets returns out.
--   7. Views (security_invoker, so RLS applies): v_po_backorders (ordered / received / accepted / rejected / returned
--      / outstanding per PO line, overdue days) and v_supplier_delivery_performance (on-time %, late, open overdue,
--      short and split deliveries, reject %, returned qty; null rates when nothing is measurable).
--
-- MEASURED LIVE IMPACT (2026-11-24): suppliers 0, purchase_orders 0, purchase_order_lines 0, requisitions 0,
-- supplier_invoices 0, goods_receipts 1 / goods_receipt_lines 6 (no PO), inventory_approval_limits 0. No stored row is
-- invalidated; every new column is nullable or defaulted; today's effect is on future writes only.
--
-- PROOF (2026-11-24, live project, ONE transaction: begin; WP4 20261124090000; this file; test block ending in RAISE
-- EXCEPTION, so everything rolled back. Re-checked afterwards: suppliers 0, purchase_orders 0, procurement_rfqs absent,
-- purchase_orders.is_emergency absent, guard_po_rules absent; only po_seq advanced (6), as sequences are not
-- transactional. Managers 34793423 (M1) and ecdcdb9e (M2) got stock procure+receive grants INSIDE the transaction.)
--   S0  M1 inserts a supplier sending created_by=M2, approved=true    -> stored created_by=M1, approved=false
--   S1  M1 approves the supplier M1 added                            -> 42501 "You cannot approve a supplier you added"
--   S2  M1 approves M2's supplier                                    -> approved, approved_by_id = M1
--   S3  direct UPDATE approved_for_purchasing=true                   -> silently kept false
--   R0  Store Keeper 69faeb71 creates an RFQ                          -> 42501 procure required
--   R1  RFQ inviting an unapproved supplier                          -> 22023 refused
--   R2  quote from an unapproved supplier                            -> 22023 refused
--   R3  award the SAR 100 quote over a SAR 90 quote, no reason       -> 22023 "Give a reason ..."
--   R4  award the lowest quote                                       -> Draft PO-2026-00006, 1 line, SAR 900.00, created_by=M1
--   L1  M1 (creator) approves the PO                                 -> 42501 refused (self-approval)
--   L2  M2 approves the SAR 900 PO with a Manager SAR 500 limit       -> 42501 "Order value SAR 900.00 is above your limit of 500"
--   L3  limit set in AED, PO in SAR                                  -> 42501 "Your limit is in AED and this order is in SAR"
--   L4  limit SAR 5000: M2 approves (sending approved_by_id=M1), orders -> Ordered, approved_by_id = M2 (stamped), approved_by='Test User'
--   G1  receive 6 with 2 rejected and no reason                      -> 22023 "give a reason for the rejected quantity"
--   G2  receive 6, 2 rejected "damaged: crushed carton"               -> accepted 4, rejected 2, rejection_code 'damaged'
--   B1  v_po_backorders                                              -> ordered 10, accepted 4, rejected 2, outstanding 6, PO Partial Delivery
--   RT1 return 3 rejected (2 on the receipt)                         -> 22023 "you can return at most 2"
--   RT2 return 2 rejected                                            -> SRN posted, no stock movement
--   RT3 return 5 accepted (4 accepted)                               -> 22023 "you can return at most 4"
--   RT3b return 1 more rejected after both returned                  -> 22023 "you can return at most 0"
--   RT4 return 1 accepted defective                                  -> posted; ledger movement supplier_return qty_change -1
--   B2  backorder after the return                                   -> accepted 3, rejected 3, returned 1, outstanding 7
--   M1  invoice 4 @ 95 vs PO 90 (2% tolerance), 3 accepted net        -> qty_and_price_mismatch (variance detected)
--   M2  invoice 3 @ 90.5 (first invoice rejected)                     -> matched
--   E0..E5 above are SUPERSEDED by the structured-justification proof below.
--   P1  v_supplier_delivery_performance (S2)                         -> 1 order, on_time_pct null (not complete), received 6,
--                                                                       rejected 2, reject_pct 33.33, returned 3
--
-- PROOF 2 (2026-11-24, structured emergency justification + purchase limit admin; live project via the CLI, ONE
-- transaction: begin; WP4 20261124090000; this file; test block ending in RAISE EXCEPTION. Re-checked afterwards:
-- purchase_orders 0, inventory_approval_limits 0, test grants 0, _po_emergency_link absent, guard_po_rules absent,
-- purchase_orders emergency_* columns absent. Admin = d2d43a5f (super admin, aal2), M1 / M2 as above, Store Keeper 69faeb71.)
--   L0  Manager M1 calls inv_approval_limit_upsert (purchase_order)   -> 42501 "Only an administrator sets approval limits."
--   L0b Store Keeper calls it                                         -> 42501 same
--   L1  Admin sets Manager KSA SAR 100, Manager UAE AED 2000          -> ok, 2 rows (one per currency)
--   L1c Admin sets a Store Keeper PO limit                            -> 22023 role cannot approve purchase_order
--   E0  emergency PO with only a reason (no category)                 -> 22023 "Choose why this is an emergency ..."
--   E0b asset NOPE999                                                 -> 22023 "Asset NOPE999 was not found in the KSA asset register."
--   E0c job card GCKR/JC/1324/0526 with asset TM999                    -> 22023 "Job card ... is for asset TM514, not TM999."
--   E0d route reason under 30 characters                              -> 22023 refused
--   E0e no downtime hours and impact text under 10 characters          -> 22023 refused
--   E0f estimate in AED on a SAR order                                -> 22023 "Currencies are not converted."
--   E0g no estimated value                                            -> 22023 refused
--   E0h category other without a note                                 -> 22023 refused
--   E1  complete justification (job card only, forged declared_by=M2,
--       forged requester name)                                        -> accepted; asset TM514 resolved from the job card,
--                                                                        work order id linked, declared_by = M1, name stamped
--   E2  emergency Draft -> Ordered                                    -> Ordered
--   E3  edit downtime hours after ordering                            -> 22023 refused
--   E4  creator M1 post-approves                                      -> 42501 refused
--   E5a M2 post-approves with a Manager SAR 100 limit (PO SAR 900)     -> 42501 "Order value SAR 900.00 is above your approval limit of 100."
--   L2  Admin raises Manager KSA SAR to 5000 (same row updated)        -> ok, still 2 rows
--   E5  M2 post-approves                                              -> ok, emergency_approved_by_id = M2, name stamped
--   L3  Admin removes both limits (active false)                      -> 0 active rows (no threshold again)
--   N1  normal PO sent with stray emergency fields                    -> fields cleared
--
-- REVIEW FIXES + ROLLED-BACK PROOF, ROUND 2 (2026-11-24). All 8 files applied in order (090000, 091000, 130000,
-- 131000, 132000, 133000, 120000, 135000; the 135000 work_orders index build left out of the run because of its
-- SHARE lock) in ONE implicit transaction through the Supabase CLI, then a test block as real users (claims + role
-- authenticated) ending in RAISE EXCEPTION, so everything rolled back; re-checked afterwards: purchase_orders 0,
-- test suppliers 0, test grants 0, procurement_rfqs and _inv_job_card_resolve absent, purchase_orders.updated_by
-- absent. Users: super admin d2d43a5f (SA), Store Keeper 69faeb71 (SK), Managers 34793423 (M1) / ecdcdb9e (M2);
-- extra stock / fleet grants were given INSIDE the transaction. Script: scratchpad review_round2_proof.sql.
--   Changes here: begin/commit; versioned _bak.wms_proc_130000_v (A14); A3 approved supplier needed for Submitted /
--   Approved, limit checked on the NEW row (_po_limit_block(purchase_orders)); A4 approver role required, Admin /
--   super admin not locked out by limits; A16 guard_po_controls is SECURITY DEFINER and the limit / emergency helpers
--   are no longer executable by clients, scope checked first; A13 no invoice create / match / PO close while an
--   emergency PO is unapproved, post-approval over the estimate +10% needs a written reason
--   (emergency_overrun_reason); A11 supplier approval cleared when name, code or tax / bank / payment custom_data
--   keys change; B6 expired quotes cannot be awarded (and do not count as lowest); A15 child-table parent scope.
--   A11.1 code change -> approved false;  A11.2 notes change -> stays true;  A11.3 bank_iban change -> false
--   A3.s1 Submitted PO with an unapproved supplier              -> 22023
--   A4.1  Store Keeper (procure granted) approves               -> 42501 "Your role (Store Keeper) cannot approve ..."
--   A3.3  M2 approves while raising total 100 -> 9000 (limit SAR 500) -> 42501 "Order value SAR 9000.00 is above ..."
--   A3.4  M2 approves at 100 -> Approved;  A4.2 SA approves SAR 901 with limits but no SA row -> Approved
--   A13.1 invoice on unapproved emergency PO -> 22023;  A13.2 close it -> 22023
--   A13.3 post-approve 500 vs estimate 100, no reason -> 22023;  A13.4 with reason -> approved, reason stored
--   A13.5 invoice after approval -> created;  A16 authenticated EXECUTE on _po_limit_block / _po_emergency_link /
--         _po_emergency_normalise / _inv_job_card_resolve -> false/false/false/false
--   B6.1  award a quote valid until yesterday                   -> 22023 "This quote expired on 2026-11-23 ..."
--   A15.1 M1 reads KSA RFQ lines/invites/quote lines -> 1/1/1;  A15.2 same RFQ moved to UAE -> 0/0/0/0
-- UNDO (one transaction)
--   drop view if exists public.v_supplier_delivery_performance, public.v_po_backorders;
--   do $u$ declare r record; begin
--     for r in select distinct on (obj) def from _bak.wms_proc_130000_v order by obj, id desc loop execute r.def; end loop;
--   end $u$;   -- _inv_supplier_invoice_match, guard_po_rules, inv_approver_roles (newest copy)
--   drop trigger if exists trg_guard_invoice_emergency_po on public.supplier_invoices;
--   drop function if exists public.guard_invoice_emergency_po();
--   drop function if exists public.inv_supplier_return(jsonb), public.inv_po_emergency_approve(jsonb),
--     public.inv_rfq_create(jsonb), public.inv_rfq_quote_record(jsonb), public.inv_rfq_award(jsonb),
--     public.inv_rfq_cancel(jsonb), public.inv_supplier_set_approval(jsonb), public._po_limit_block(public.purchase_orders);
--   drop function if exists public._po_emergency_normalise(public.purchase_orders),
--     public._po_emergency_clear(public.purchase_orders), public._po_emergency_link(uuid, text, text, text, uuid);
--   drop trigger if exists trg_po_controls on public.purchase_orders; drop function if exists public.guard_po_controls();
--   drop trigger if exists trg_grn_line_rejection on public.goods_receipt_lines; drop function if exists public.guard_grn_line_rejection();
--   drop trigger if exists trg_guard_supplier_approval on public.suppliers; drop function if exists public.guard_supplier_approval();
--   drop table if exists public.supplier_return_lines, public.supplier_returns, public.procurement_quote_lines,
--     public.procurement_quotes, public.procurement_rfq_invites, public.procurement_rfq_lines, public.procurement_rfqs;
--   delete from public.inventory_approval_limits where entity_type = 'purchase_order';
--   alter table public.inventory_approval_limits drop constraint inventory_approval_limits_entity_type_check,
--     add constraint inventory_approval_limits_entity_type_check check (entity_type in ('stock_adjustment',
--     'recount_assignment','opening_balance_batch','cost_reconciliation','tyre_conflict_correction'));
--   alter table public.goods_receipt_lines drop column if exists rejection_code;
--   alter table public.purchase_orders drop column if exists approved_by_id, drop column if exists approved_at,
--     drop column if exists is_emergency, drop column if exists emergency_reason, drop column if exists emergency_declared_by,
--     drop column if exists emergency_declared_at, drop column if exists emergency_approved_by_id,
--     drop column if exists emergency_approved_by, drop column if exists emergency_approved_at,
--     drop column if exists emergency_category, drop column if exists emergency_category_note,
--     drop column if exists emergency_asset_no, drop column if exists emergency_work_order_id,
--     drop column if exists emergency_job_card_no, drop column if exists emergency_downtime_hours,
--     drop column if exists emergency_impact, drop column if exists emergency_est_value,
--     drop column if exists emergency_est_currency, drop column if exists emergency_attachment_path,
--     drop column if exists emergency_requested_by_name, drop column if exists emergency_overrun_reason;
--   alter table public.suppliers drop column if exists approved_for_purchasing, drop column if exists approval_note,
--     drop column if exists approved_by_id, drop column if exists approved_at;
-- =====================================================================================================================

begin;

do $pre$ begin
  if to_regprocedure('public.guard_po_rules()') is null or to_regprocedure('public._inv_po_add_line(uuid, jsonb)') is null then
    raise exception '130000: apply 20261124090000 (WP4 procurement controls) and the inventory programme first.';
  end if;
end $pre$;

-- Versioned rollback copies (review A14): one row per apply, written only while the object is still UNPATCHED,
-- so the newest row per object is the body that was live just before the latest real apply. The undo restores
-- the newest row per object.
create schema if not exists _bak;
revoke all on schema _bak from public, anon, authenticated;
create table if not exists _bak.wms_proc_130000_v (id bigserial primary key, obj text not null, def text not null,
  saved_at timestamptz default now());
revoke all on _bak.wms_proc_130000_v from public, anon, authenticated;
insert into _bak.wms_proc_130000_v(obj, def)
select obj, def from (values
  ('_inv_supplier_invoice_match', pg_get_functiondef('public._inv_supplier_invoice_match(uuid)'::regprocedure), 'supplier_return_lines'),
  ('guard_po_rules', pg_get_functiondef('public.guard_po_rules()'::regprocedure), 'new.is_emergency'),
  ('inv_approver_roles', pg_get_functiondef('public.inv_approver_roles(text)'::regprocedure), '''purchase_order''')
) x(obj, def, marker)
where position(x.marker in x.def) = 0;

-- ── 1. Approved supplier list ───────────────────────────────────────────────────────────────────────────────────
alter table public.suppliers
  add column if not exists approved_for_purchasing boolean not null default false,
  add column if not exists approval_note text,
  add column if not exists approved_by_id uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz;
comment on column public.suppliers.approved_for_purchasing is
  'On the approved supplier list. Changed only by inv_supplier_set_approval (never by the person who added the supplier).';

create or replace function public.guard_supplier_approval()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_sensitive boolean := false;
begin
  -- (review A11) a change to who is paid (name, code, tax, bank or payment terms) takes the supplier off the
  -- approved list again, for every writer (imports included); a second person must re-approve it.
  if tg_op = 'UPDATE' then
    v_sensitive := (new.supplier_name, new.supplier_code) is distinct from (old.supplier_name, old.supplier_code)
      or (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(coalesce(new.custom_data, '{}'::jsonb)) e
           where e.key ~* '(tax|vat|trn|bank|iban|swift|bic|account|payment|pay_|remit)')
         is distinct from
         (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(coalesce(old.custom_data, '{}'::jsonb)) e
           where e.key ~* '(tax|vat|trn|bank|iban|swift|bic|account|payment|pay_|remit)');
  end if;
  if v_uid is null then                                            -- service role / imports
    if v_sensitive and current_setting('app.inv_supplier_approval', true) is distinct from 'on'
       and old.approved_for_purchasing then
      new.approved_for_purchasing := false; new.approved_by_id := null; new.approved_at := null;
      new.approval_note := 'Approval cleared: supplier name, code, tax, bank or payment details changed.';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := v_uid;                                       -- had no default and was client written
  elsif old.created_by is not null and new.created_by is distinct from old.created_by
        and not coalesce(public.is_super_admin(), false) then
    new.created_by := old.created_by;
  end if;
  if current_setting('app.inv_supplier_approval', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.approved_for_purchasing := false; new.approval_note := null; new.approved_by_id := null; new.approved_at := null;
  elsif v_sensitive and old.approved_for_purchasing then
    new.approved_for_purchasing := false; new.approved_by_id := null; new.approved_at := null;
    new.approval_note := 'Approval cleared: supplier name, code, tax, bank or payment details changed.';
  else
    new.approved_for_purchasing := old.approved_for_purchasing; new.approval_note := old.approval_note;
    new.approved_by_id := old.approved_by_id; new.approved_at := old.approved_at;
  end if;
  return new;
end $$;
revoke execute on function public.guard_supplier_approval() from public, anon, authenticated;
create or replace trigger trg_guard_supplier_approval
  before insert or update on public.suppliers
  for each row execute function public.guard_supplier_approval();

create or replace function public.inv_supplier_set_approval(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_uid uuid := auth.uid(); v_org uuid := public.app_current_org(); s public.suppliers%rowtype;
  v_on boolean := coalesce((p_payload->>'approved')::boolean, false);
begin
  r := public._inv_req_begin('inv_supplier_set_approval', p_payload); if r is not null then return r; end if;
  if not public.inv_can('procure') then
    raise exception 'Stock permission "procure" is required.' using errcode = '42501';
  end if;
  select * into s from public.suppliers where id = nullif(p_payload->>'supplier_id', '')::uuid and organisation_id = v_org for update;
  if not found then raise exception 'Supplier not found in your company.' using errcode = 'P0002'; end if;
  if not public.app_write_country_ok(s.country) then
    raise exception 'This supplier is outside your country scope.' using errcode = '42501';
  end if;
  if v_on and s.created_by = v_uid then
    raise exception 'You cannot approve a supplier you added. Ask another buyer.' using errcode = '42501';
  end if;
  if v_on and lower(coalesce(s.status, '')) <> 'active' then
    raise exception 'Only an active supplier can be approved for purchasing.' using errcode = '22023';
  end if;
  perform set_config('app.inv_supplier_approval', 'on', true);
  update public.suppliers set approved_for_purchasing = v_on,
    approval_note = nullif(btrim(coalesce(p_payload->>'note', '')), ''),
    approved_by_id = v_uid, approved_at = now(), updated_at = now()
   where id = s.id;
  perform set_config('app.inv_supplier_approval', 'off', true);
  return public._inv_req_end('inv_supplier_set_approval', p_payload,
    jsonb_build_object('supplier_id', s.id, 'approved_for_purchasing', v_on));
end $fn$;

-- ── 2. RFQ + supplier quotations ────────────────────────────────────────────────────────────────────────────────
create table if not exists public.procurement_rfqs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  country text not null, site text,
  rfq_no text not null,
  requisition_id uuid references public.requisitions(id) on delete set null,
  title text, needed_by date, notes text,
  status text not null default 'open' check (status in ('open','awarded','cancelled')),
  awarded_quote_id uuid, awarded_po_id uuid references public.purchase_orders(id) on delete set null,
  award_reason text, awarded_by uuid, awarded_at timestamptz, cancel_reason text,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organisation_id, rfq_no)
);
select public._inv_secure_table('procurement_rfqs', true, true);

create table if not exists public.procurement_rfq_lines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  rfq_id uuid not null references public.procurement_rfqs(id) on delete cascade,
  line_no integer not null,
  item_id uuid references public.material_master(id),
  description text,
  qty numeric not null check (qty > 0),
  check (item_id is not null or nullif(btrim(description), '') is not null),
  unique (rfq_id, line_no)
);
select public._inv_secure_table('procurement_rfq_lines', false, false);

create table if not exists public.procurement_rfq_invites (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  rfq_id uuid not null references public.procurement_rfqs(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  invited_by uuid, invited_at timestamptz not null default now(),
  unique (rfq_id, supplier_id)
);
select public._inv_secure_table('procurement_rfq_invites', false, false);

create table if not exists public.procurement_quotes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  country text,
  rfq_id uuid not null references public.procurement_rfqs(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  quote_ref text,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  valid_until date, notes text,
  status text not null default 'received' check (status in ('received','awarded','not_awarded','withdrawn')),
  recorded_by uuid, recorded_at timestamptz not null default now(),
  unique (rfq_id, supplier_id)
);
select public._inv_secure_table('procurement_quotes', true, false);

create table if not exists public.procurement_quote_lines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  quote_id uuid not null references public.procurement_quotes(id) on delete cascade,
  rfq_line_id uuid not null references public.procurement_rfq_lines(id) on delete cascade,
  unit_price numeric check (unit_price is null or unit_price >= 0),          -- null = no bid for this line
  qty_offered numeric check (qty_offered is null or qty_offered > 0),
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  unique (quote_id, rfq_line_id)
);
select public._inv_secure_table('procurement_quote_lines', false, false);

create or replace function public.inv_rfq_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_uid uuid := auth.uid(); v_org uuid := public.app_current_org(); v_id uuid := gen_random_uuid();
  v_country text := nullif(btrim(coalesce(p_payload->>'country', '')), ''); v_site text := nullif(upper(btrim(coalesce(p_payload->>'site', ''))), '');
  v_req public.requisitions%rowtype; v_lines jsonb := coalesce(p_payload->'lines', '[]'::jsonb); l jsonb; v_n int := 0;
  v_sup uuid; v_no text;
begin
  r := public._inv_req_begin('inv_rfq_create', p_payload); if r is not null then return r; end if;
  if not public.inv_can('procure') then raise exception 'Stock permission "procure" is required.' using errcode = '42501'; end if;
  if nullif(p_payload->>'requisition_id', '') is not null then
    select * into v_req from public.requisitions where id = (p_payload->>'requisition_id')::uuid and organisation_id = v_org;
    if not found then raise exception 'Requisition not found in your company.' using errcode = 'P0002'; end if;
    if v_req.status <> 'approved' then
      raise exception 'Only an approved requisition can go out for quotation.' using errcode = '22023';
    end if;
    v_country := coalesce(v_country, v_req.country); v_site := coalesce(v_site, nullif(upper(btrim(v_req.site)), ''));
    if jsonb_array_length(v_lines) = 0 then
      v_lines := jsonb_build_array(jsonb_build_object('item_id', to_jsonb(v_req)->>'item_id',
        'description', v_req.item, 'qty', coalesce(v_req.quantity, 1)));
    end if;
  end if;
  if v_country is null then raise exception 'Choose the country this quotation is for.' using errcode = '22023'; end if;
  if not public._inv_scope_ok(v_country, v_site) then
    raise exception 'Choose a permitted country and site.' using errcode = '42501';
  end if;
  if jsonb_array_length(v_lines) = 0 then raise exception 'Add at least one line to quote.' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p_payload->'supplier_ids', '[]'::jsonb)) = 0 then
    raise exception 'Choose at least one approved supplier to ask for a quotation.' using errcode = '22023';
  end if;
  v_no := 'RFQ-' || to_char(now(), 'YYYY') || '-' || upper(left(replace(v_id::text, '-', ''), 6));
  insert into public.procurement_rfqs(id, organisation_id, country, site, rfq_no, requisition_id, title, needed_by, notes, created_by)
  values (v_id, v_org, v_country, v_site, v_no, v_req.id, nullif(btrim(coalesce(p_payload->>'title', '')), ''),
    coalesce(nullif(p_payload->>'needed_by', '')::date, v_req.needed_by), nullif(btrim(coalesce(p_payload->>'notes', '')), ''), v_uid);
  for l in select value from jsonb_array_elements(v_lines) loop
    v_n := v_n + 1;
    if coalesce(nullif(l->>'qty', '')::numeric, 0) <= 0 then
      raise exception 'Line %: enter a quantity above zero.', v_n using errcode = '22023';
    end if;
    if nullif(l->>'item_id', '') is not null and not exists (select 1 from public.material_master m
         where m.id = (l->>'item_id')::uuid and m.organisation_id = v_org
           and (m.country is null or upper(btrim(m.country)) = upper(v_country))) then
      raise exception 'Line %: choose an item from this company''s Material Master for %.', v_n, v_country using errcode = '23503';
    end if;
    insert into public.procurement_rfq_lines(organisation_id, rfq_id, line_no, item_id, description, qty)
    values (v_org, v_id, v_n, nullif(l->>'item_id', '')::uuid, nullif(btrim(coalesce(l->>'description', '')), ''), (l->>'qty')::numeric);
  end loop;
  for v_sup in select (value #>> '{}')::uuid from jsonb_array_elements(p_payload->'supplier_ids') loop
    if not exists (select 1 from public.suppliers s where s.id = v_sup and s.organisation_id = v_org
         and s.approved_for_purchasing and lower(coalesce(s.status, '')) = 'active'
         and (s.country is null or upper(btrim(s.country)) = upper(v_country))) then
      raise exception 'Quotations can be requested only from approved, active suppliers for %.', v_country using errcode = '22023';
    end if;
    insert into public.procurement_rfq_invites(organisation_id, rfq_id, supplier_id, invited_by)
    values (v_org, v_id, v_sup, v_uid) on conflict do nothing;
  end loop;
  return public._inv_req_end('inv_rfq_create', p_payload, jsonb_build_object('rfq_id', v_id, 'rfq_no', v_no, 'lines', v_n));
end $fn$;

create or replace function public.inv_rfq_quote_record(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_uid uuid := auth.uid(); v_org uuid := public.app_current_org(); q public.procurement_rfqs%rowtype;
  v_sup uuid := nullif(p_payload->>'supplier_id', '')::uuid; v_cur text := upper(btrim(coalesce(p_payload->>'currency', '')));
  v_quote uuid; l jsonb; v_priced int := 0;
begin
  r := public._inv_req_begin('inv_rfq_quote_record', p_payload); if r is not null then return r; end if;
  if not public.inv_can('procure') then raise exception 'Stock permission "procure" is required.' using errcode = '42501'; end if;
  select * into q from public.procurement_rfqs where id = nullif(p_payload->>'rfq_id', '')::uuid and organisation_id = v_org for update;
  if not found then raise exception 'Quotation request not found.' using errcode = 'P0002'; end if;
  if q.status <> 'open' then raise exception 'This quotation request is closed.' using errcode = '22023'; end if;
  if not public._inv_scope_ok(q.country, q.site) then raise exception 'Outside your country or site scope.' using errcode = '42501'; end if;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'Enter the quote currency as a 3-letter code (SAR, AED, EGP).' using errcode = '22023'; end if;
  if not exists (select 1 from public.suppliers s where s.id = v_sup and s.organisation_id = v_org
       and s.approved_for_purchasing and lower(coalesce(s.status, '')) = 'active'
       and (s.country is null or upper(btrim(s.country)) = upper(q.country))) then
    raise exception 'Quotations are accepted only from approved, active suppliers.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb)) x
              where not exists (select 1 from public.procurement_rfq_lines rl where rl.id = nullif(x->>'rfq_line_id', '')::uuid and rl.rfq_id = q.id)) then
    raise exception 'A quoted line is not on this quotation request.' using errcode = '22023';
  end if;
  insert into public.procurement_rfq_invites(organisation_id, rfq_id, supplier_id, invited_by)
  values (v_org, q.id, v_sup, v_uid) on conflict do nothing;
  insert into public.procurement_quotes(organisation_id, country, rfq_id, supplier_id, quote_ref, currency, lead_time_days,
    valid_until, notes, recorded_by)
  values (v_org, q.country, q.id, v_sup, nullif(btrim(coalesce(p_payload->>'quote_ref', '')), ''), v_cur,
    nullif(p_payload->>'lead_time_days', '')::int, nullif(p_payload->>'valid_until', '')::date,
    nullif(btrim(coalesce(p_payload->>'notes', '')), ''), v_uid)
  on conflict (rfq_id, supplier_id) do update set quote_ref = excluded.quote_ref, currency = excluded.currency,
    lead_time_days = excluded.lead_time_days, valid_until = excluded.valid_until, notes = excluded.notes,
    recorded_by = excluded.recorded_by, recorded_at = now()
    where public.procurement_quotes.status = 'received'
  returning id into v_quote;
  if v_quote is null then raise exception 'This supplier''s quote can no longer be changed.' using errcode = '22023'; end if;
  delete from public.procurement_quote_lines where quote_id = v_quote;
  for l in select value from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb)) loop
    insert into public.procurement_quote_lines(organisation_id, quote_id, rfq_line_id, unit_price, qty_offered, lead_time_days)
    values (v_org, v_quote, (l->>'rfq_line_id')::uuid, nullif(l->>'unit_price', '')::numeric,
      nullif(l->>'qty_offered', '')::numeric, nullif(l->>'lead_time_days', '')::int);
    if nullif(l->>'unit_price', '') is not null then v_priced := v_priced + 1; end if;
  end loop;
  if v_priced = 0 then raise exception 'Enter a price for at least one line.' using errcode = '22023'; end if;
  return public._inv_req_end('inv_rfq_quote_record', p_payload, jsonb_build_object('quote_id', v_quote, 'priced_lines', v_priced));
end $fn$;

create or replace function public.inv_rfq_award(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_uid uuid := auth.uid(); v_org uuid := public.app_current_org(); q public.procurement_rfqs%rowtype;
  v_qt public.procurement_quotes%rowtype; s public.suppliers%rowtype; v_reason text := nullif(btrim(coalesce(p_payload->>'reason', '')), '');
  v_nlines int; v_lowest boolean; v_currencies int; v_po uuid; v_po_no text; v_total numeric := 0; x record; v_added int := 0;
begin
  r := public._inv_req_begin('inv_rfq_award', p_payload); if r is not null then return r; end if;
  if not public.inv_can('procure') then raise exception 'Stock permission "procure" is required.' using errcode = '42501'; end if;
  select * into q from public.procurement_rfqs where id = nullif(p_payload->>'rfq_id', '')::uuid and organisation_id = v_org for update;
  if not found then raise exception 'Quotation request not found.' using errcode = 'P0002'; end if;
  if q.status <> 'open' then raise exception 'This quotation request is already closed.' using errcode = '22023'; end if;
  if not public._inv_scope_ok(q.country, q.site) then raise exception 'Outside your country or site scope.' using errcode = '42501'; end if;
  select * into v_qt from public.procurement_quotes where id = nullif(p_payload->>'quote_id', '')::uuid and rfq_id = q.id;
  if not found or v_qt.status <> 'received' then raise exception 'Choose a received quote on this request.' using errcode = '22023'; end if;
  -- (review B6) an expired quote cannot be awarded
  if v_qt.valid_until is not null and v_qt.valid_until < current_date then
    raise exception 'This quote expired on %. Ask the supplier to confirm or renew it first.', v_qt.valid_until using errcode = '22023';
  end if;
  select * into s from public.suppliers where id = v_qt.supplier_id;
  if not s.approved_for_purchasing then raise exception 'The supplier is no longer on the approved list.' using errcode = '22023'; end if;
  -- lowest = cheapest among quotes that price EVERY line, in the same currency. Never compared across currencies.
  select count(*) into v_nlines from public.procurement_rfq_lines where rfq_id = q.id;
  select count(distinct currency) into v_currencies from public.procurement_quotes where rfq_id = q.id and status = 'received'
     and (valid_until is null or valid_until >= current_date);
  with t as (
    select pq.id, pq.currency, count(ql.unit_price) as priced,
           sum(ql.unit_price * coalesce(ql.qty_offered, rl.qty)) as total
      from public.procurement_quotes pq
      join public.procurement_quote_lines ql on ql.quote_id = pq.id
      join public.procurement_rfq_lines rl on rl.id = ql.rfq_line_id
     where pq.rfq_id = q.id and pq.status = 'received' and (pq.valid_until is null or pq.valid_until >= current_date)
     group by pq.id, pq.currency)
  select coalesce((select t.priced = v_nlines from t where t.id = v_qt.id), false)
     and not exists (select 1 from t o, t me where me.id = v_qt.id and o.currency = me.currency and o.priced = v_nlines
                      and o.id <> me.id and o.total < me.total)
    into v_lowest;
  if v_reason is null and (not v_lowest or v_currencies > 1) then
    raise exception 'Give a reason: this is not the lowest full quote in one currency.' using errcode = '22023';
  end if;
  insert into public.purchase_orders(organisation_id, po_number, vendor_name, supplier_name, supplier_id, order_date,
    expected_delivery, status, priority, country, site, currency, requested_by, notes, items)
  values (v_org, public.generate_po_number(), s.supplier_name, s.supplier_name, s.id, current_date,
    case when v_qt.lead_time_days is not null then current_date + v_qt.lead_time_days end, 'Draft', 'Normal',
    q.country, q.site, v_qt.currency, (select v.requester from public.requisitions v where v.id = q.requisition_id),
    'Awarded from ' || q.rfq_no || coalesce(' (' || v_qt.quote_ref || ')', ''), '[]'::jsonb)
  returning id, po_number into v_po, v_po_no;
  for x in select rl.line_no, rl.item_id, rl.description, coalesce(ql.qty_offered, rl.qty) as qty, ql.unit_price
             from public.procurement_quote_lines ql join public.procurement_rfq_lines rl on rl.id = ql.rfq_line_id
            where ql.quote_id = v_qt.id and ql.unit_price is not null order by rl.line_no loop
    perform public._inv_po_add_line(v_po, jsonb_build_object('item_id', x.item_id, 'description', x.description,
      'qty_ordered', x.qty, 'unit_price', x.unit_price, 'currency', v_qt.currency));
    v_total := v_total + x.qty * x.unit_price; v_added := v_added + 1;
  end loop;
  update public.purchase_orders set subtotal = round(v_total, 2), total_amount = round(v_total, 2) where id = v_po;
  update public.procurement_quotes set status = case when id = v_qt.id then 'awarded' else 'not_awarded' end
   where rfq_id = q.id and status = 'received';
  update public.procurement_rfqs set status = 'awarded', awarded_quote_id = v_qt.id, awarded_po_id = v_po,
    award_reason = v_reason, awarded_by = v_uid, awarded_at = now(), updated_at = now() where id = q.id;
  if q.requisition_id is not null then
    update public.requisitions set status = 'ordered', po_ref = v_po_no where id = q.requisition_id and status = 'approved';
  end if;
  return public._inv_req_end('inv_rfq_award', p_payload, jsonb_build_object('po_id', v_po, 'po_number', v_po_no,
    'lines', v_added, 'currency', v_qt.currency, 'total', round(v_total, 2), 'lowest', v_lowest));
end $fn$;

create or replace function public.inv_rfq_cancel(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_org uuid := public.app_current_org(); q public.procurement_rfqs%rowtype;
begin
  r := public._inv_req_begin('inv_rfq_cancel', p_payload); if r is not null then return r; end if;
  if not public.inv_can('procure') then raise exception 'Stock permission "procure" is required.' using errcode = '42501'; end if;
  select * into q from public.procurement_rfqs where id = nullif(p_payload->>'rfq_id', '')::uuid and organisation_id = v_org for update;
  if not found then raise exception 'Quotation request not found.' using errcode = 'P0002'; end if;
  if q.status <> 'open' then raise exception 'Only an open quotation request can be cancelled.' using errcode = '22023'; end if;
  if not public._inv_scope_ok(q.country, q.site) then raise exception 'Outside your country or site scope.' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_payload->>'reason', '')), '') is null then raise exception 'Give a reason for cancelling.' using errcode = '22023'; end if;
  update public.procurement_rfqs set status = 'cancelled', cancel_reason = btrim(p_payload->>'reason'), updated_at = now() where id = q.id;
  update public.procurement_quotes set status = 'not_awarded' where rfq_id = q.id and status = 'received';
  return public._inv_req_end('inv_rfq_cancel', p_payload, jsonb_build_object('rfq_id', q.id, 'status', 'cancelled'));
end $fn$;

-- ── 3. PO approval limits (reuse inventory_approval_limits) ─────────────────────────────────────────────────────
do $c$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.inventory_approval_limits'::regclass and conname = 'inventory_approval_limits_entity_type_check';
  if v_def is null then raise exception '130000: inventory_approval_limits_entity_type_check not found.'; end if;
  if position('purchase_order' in v_def) = 0 then
    if v_def <> $x$CHECK ((entity_type = ANY (ARRAY['stock_adjustment'::text, 'recount_assignment'::text, 'opening_balance_batch'::text, 'cost_reconciliation'::text, 'tyre_conflict_correction'::text])))$x$ then
      raise exception '130000: entity_type check differs from the reviewed definition: %', v_def;
    end if;
    alter table public.inventory_approval_limits drop constraint inventory_approval_limits_entity_type_check;
    alter table public.inventory_approval_limits add constraint inventory_approval_limits_entity_type_check
      check (entity_type in ('stock_adjustment','recount_assignment','opening_balance_batch','cost_reconciliation',
        'tyre_conflict_correction','purchase_order'));
  end if;
end $c$;

do $p$
declare src text := pg_get_functiondef('public.inv_approver_roles(text)'::regprocedure);
  a text := $a$    when 'tyre_conflict_correction' then array['PMV Manager']$a$;
  b text := $a$    when 'tyre_conflict_correction' then array['PMV Manager']
    when 'purchase_order' then array['Admin','Director','Manager','Finance Manager','PMV Manager',
      'Workshop Area Manager','Workshop Maintenance Area Manager']$a$;
  n int;
begin
  if position('''purchase_order''' in src) > 0 then raise notice '130000: inv_approver_roles already lists purchase_order'; return; end if;
  src := replace(src, chr(13), '');
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then raise exception '130000: inv_approver_roles anchor matched % times (expected 1)', n; end if;
  execute replace(src, a, b);
end $p$;

alter table public.purchase_orders
  add column if not exists approved_by_id uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists is_emergency boolean not null default false,
  add column if not exists emergency_reason text,
  add column if not exists emergency_declared_by uuid references auth.users(id) on delete set null,
  add column if not exists emergency_declared_at timestamptz,
  add column if not exists emergency_approved_by_id uuid references auth.users(id) on delete set null,
  add column if not exists emergency_approved_by text,
  add column if not exists emergency_approved_at timestamptz,
  -- structured emergency justification (owner decision 2026-11-24): stored on the PO, checked by the trigger
  add column if not exists emergency_category text
    check (emergency_category is null or emergency_category in ('breakdown','safety','production_stoppage','customer_commitment','other')),
  add column if not exists emergency_category_note text,
  add column if not exists emergency_asset_no text,
  add column if not exists emergency_work_order_id uuid references public.work_orders(id) on delete set null,
  add column if not exists emergency_job_card_no text,
  add column if not exists emergency_downtime_hours numeric check (emergency_downtime_hours is null or emergency_downtime_hours >= 0),
  add column if not exists emergency_impact text,
  add column if not exists emergency_est_value numeric check (emergency_est_value is null or emergency_est_value > 0),
  add column if not exists emergency_est_currency text check (emergency_est_currency is null or emergency_est_currency ~ '^[A-Z]{3}$'),
  add column if not exists emergency_attachment_path text,
  add column if not exists emergency_requested_by_name text,
  add column if not exists emergency_overrun_reason text check (emergency_overrun_reason is null or length(emergency_overrun_reason) <= 1000);
comment on column public.purchase_orders.is_emergency is
  'Emergency purchase: may be ordered before approval, must then be approved after the fact (inv_po_emergency_approve).';
comment on column public.purchase_orders.emergency_reason is
  'Why the normal approval route could not be used (at least 30 characters).';
comment on column public.purchase_orders.emergency_category is
  'Emergency reason category: breakdown / safety / production_stoppage / customer_commitment / other.';
create index if not exists purchase_orders_emergency_open_idx on public.purchase_orders (organisation_id)
  where is_emergency and emergency_approved_at is null;

-- Resolve and check the affected asset / job card of an emergency purchase in the PO's company and country.
-- Returns {ok, error, asset_no, work_order_id, job_card_no}. SECURITY DEFINER so a site-scoped buyer can still name a
-- fleet asset; it only answers for the caller's own company and reveals nothing but "found / not found".
create or replace function public._po_emergency_link(p_org uuid, p_country text, p_asset text, p_job_card text, p_wo uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare v_asset text := nullif(upper(regexp_replace(btrim(coalesce(p_asset, '')), '\s+', '', 'g')), '');
  v_jc text := nullif(btrim(coalesce(p_job_card, '')), ''); w record; v_wo_id uuid; v_wo_no text; v_country text := upper(btrim(coalesce(p_country, '')));
begin
  if auth.uid() is not null and p_org is distinct from public.app_current_org() and not coalesce(public.is_super_admin(), false) then
    return jsonb_build_object('ok', false, 'error', 'This purchase order is not in your company.');
  end if;
  if v_country = '' then
    return jsonb_build_object('ok', false, 'error', 'Choose the country of an emergency purchase.');
  end if;
  -- (review A16) say nothing about another country's fleet or job cards
  if auth.uid() is not null and not coalesce(public.app_write_country_ok(p_country), false) then
    return jsonb_build_object('ok', false, 'error', format('%s is outside your country scope.', p_country));
  end if;
  if v_asset is null and v_jc is null and p_wo is null then
    return jsonb_build_object('ok', false, 'error', 'Name the affected asset number or job card for an emergency purchase.');
  end if;
  if v_jc is not null or p_wo is not null then
    select wo.id, wo.work_order_no, upper(regexp_replace(btrim(coalesce(wo.asset_no, '')), '\s+', '', 'g')) as asset_no into w
      from public.work_orders wo
     where wo.organisation_id = p_org and upper(btrim(coalesce(wo.country, ''))) = v_country
       and (wo.id = p_wo or (p_wo is null and wo.work_order_no = v_jc))
     limit 1;
    if not found then
      return jsonb_build_object('ok', false, 'error', format('Job card %s was not found in %s.', coalesce(v_jc, 'given'), p_country));
    end if;
    if v_asset is not null and nullif(w.asset_no, '') is not null and w.asset_no <> v_asset then
      return jsonb_build_object('ok', false, 'error', format('Job card %s is for asset %s, not %s.', w.work_order_no, w.asset_no, v_asset));
    end if;
    v_asset := coalesce(v_asset, nullif(w.asset_no, '')); v_wo_id := w.id; v_wo_no := w.work_order_no;
  end if;
  if v_asset is not null and not exists (select 1 from public.vehicle_fleet f
       where f.organisation_id = p_org and upper(btrim(coalesce(f.country, ''))) = v_country
         and upper(regexp_replace(btrim(coalesce(f.asset_no, '')), '\s+', '', 'g')) = v_asset) then
    return jsonb_build_object('ok', false, 'error', format('Asset %s was not found in the %s asset register.', v_asset, p_country));
  end if;
  return jsonb_build_object('ok', true, 'asset_no', v_asset, 'work_order_id', v_wo_id, 'job_card_no', v_wo_no);
end $fn$;
-- internal: reached only through the SECURITY DEFINER trigger guard_po_controls (review A16)
revoke all on function public._po_emergency_link(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public._po_emergency_link(uuid, text, text, text, uuid) to service_role;

-- Check a complete emergency justification and return the row with the resolved asset / job card and stamps.
-- Raises 22023 with a plain-English message when anything required is missing.
create or replace function public._po_emergency_normalise(p public.purchase_orders)
returns public.purchase_orders language plpgsql set search_path = public, pg_temp as $fn$
declare v jsonb; v_uid uuid := auth.uid(); v_name text;
begin
  if p.emergency_category is null then
    raise exception 'Choose why this is an emergency (breakdown, safety, production stoppage, customer commitment or other).' using errcode = '22023';
  end if;
  if p.emergency_category = 'other' and length(btrim(coalesce(p.emergency_category_note, ''))) < 10 then
    raise exception 'Describe the "other" emergency in at least 10 characters.' using errcode = '22023';
  end if;
  v := public._po_emergency_link(p.organisation_id, p.country, p.emergency_asset_no, p.emergency_job_card_no, p.emergency_work_order_id);
  if not coalesce((v->>'ok')::boolean, false) then raise exception '%', v->>'error' using errcode = '22023'; end if;
  p.emergency_asset_no := v->>'asset_no';
  p.emergency_work_order_id := nullif(v->>'work_order_id', '')::uuid;
  p.emergency_job_card_no := v->>'job_card_no';
  if p.emergency_downtime_hours is null and length(btrim(coalesce(p.emergency_impact, ''))) < 10 then
    raise exception 'State the impact of waiting: downtime hours, or a description of at least 10 characters.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p.emergency_reason, ''))) < 30 then
    raise exception 'Explain why the normal approval route could not be used, in at least 30 characters.' using errcode = '22023';
  end if;
  if p.emergency_est_value is null or p.emergency_est_value <= 0 then
    raise exception 'Enter the estimated value of the emergency purchase.' using errcode = '22023';
  end if;
  p.emergency_est_currency := upper(btrim(coalesce(p.emergency_est_currency, p.currency, '')));
  if p.emergency_est_currency !~ '^[A-Z]{3}$' then
    raise exception 'Choose the currency of the estimated value.' using errcode = '22023';
  end if;
  if p.currency is not null and upper(btrim(p.currency)) <> p.emergency_est_currency then
    raise exception 'The estimated value is in % but the order is in %. Currencies are not converted.', p.emergency_est_currency, upper(p.currency) using errcode = '22023';
  end if;
  if p.supplier_id is null and nullif(btrim(coalesce(p.supplier_name, p.vendor_name, '')), '') is null then
    raise exception 'Name the supplier of the emergency purchase.' using errcode = '22023';
  end if;
  p.emergency_reason := btrim(p.emergency_reason);
  p.emergency_impact := nullif(btrim(coalesce(p.emergency_impact, '')), '');
  p.emergency_category_note := nullif(btrim(coalesce(p.emergency_category_note, '')), '');
  p.emergency_attachment_path := nullif(left(btrim(coalesce(p.emergency_attachment_path, '')), 500), '');
  if v_uid is not null then
    select coalesce(nullif(btrim(pr.full_name), ''), nullif(btrim(pr.username), ''), left(v_uid::text, 8)) into v_name
      from public.profiles pr where pr.id = v_uid;
    p.emergency_declared_by := v_uid;
    p.emergency_requested_by_name := left(coalesce(v_name, left(v_uid::text, 8)), 100);
  end if;
  p.emergency_declared_at := now();
  return p;
end $fn$;
revoke all on function public._po_emergency_normalise(public.purchase_orders) from public, anon, authenticated;
grant execute on function public._po_emergency_normalise(public.purchase_orders) to service_role;

-- clears every emergency field on a row that is not (or no longer) an emergency purchase
create or replace function public._po_emergency_clear(p public.purchase_orders)
returns public.purchase_orders language plpgsql immutable set search_path = public, pg_temp as $fn$
begin
  p.is_emergency := false; p.emergency_reason := null; p.emergency_declared_by := null; p.emergency_declared_at := null;
  p.emergency_category := null; p.emergency_category_note := null; p.emergency_asset_no := null;
  p.emergency_work_order_id := null; p.emergency_job_card_no := null; p.emergency_downtime_hours := null;
  p.emergency_impact := null; p.emergency_est_value := null; p.emergency_est_currency := null;
  p.emergency_attachment_path := null; p.emergency_requested_by_name := null; p.emergency_overrun_reason := null;
  return p;
end $fn$;
revoke all on function public._po_emergency_clear(public.purchase_orders) from public, anon, authenticated;
grant execute on function public._po_emergency_clear(public.purchase_orders) to service_role;

-- NULL = the signed-in approver may approve this PO; otherwise the plain-English reason.
-- Review fixes: A3 the check reads the NEW row the approval writes (value, currency, country, site passed in, never a
-- re-read of the stored row); A4 the approver must hold a purchase-order approver role (inv_approver_roles) even when
-- no limit row exists, and a super admin or Admin is never locked out by limits (no row = no upper limit for them);
-- A16 the caller's company and country/site scope are checked before anything about the order or a limit is said.
-- Internal: called only from the SECURITY DEFINER trigger guard_po_controls and inv_po_emergency_approve.
create or replace function public._po_limit_block(p public.purchase_orders)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare v_raw text := coalesce(public.get_my_role(), '');
  v_role text := lower(regexp_replace(btrim(coalesce(public.get_my_role(), '')), '\s+', '_', 'g'));
  v_super boolean := coalesce(public.is_super_admin(), false);
  v_admin boolean := coalesce(public.is_super_admin(), false) or v_role = 'admin';
  l public.inventory_approval_limits%rowtype; v_val numeric; v_qty numeric; v_cur text; v_unpriced int; v_curs int;
begin
  if p.id is null or (p.organisation_id is distinct from public.app_current_org() and not v_super) then
    return 'Purchase order not found.';
  end if;
  if auth.uid() is not null and not public._inv_scope_ok(p.country, p.site) then
    return 'This purchase order is outside your country or site scope.';
  end if;
  if not v_admin and not exists (select 1 from unnest(public.inv_approver_roles('purchase_order')) r
                                  where lower(regexp_replace(btrim(r), '\s+', '_', 'g')) = v_role) then
    return 'Your role (' || coalesce(nullif(v_raw, ''), 'no role') || ') cannot approve purchase orders.';
  end if;
  if not exists (select 1 from public.inventory_approval_limits x where x.organisation_id = p.organisation_id
                  and x.entity_type = 'purchase_order' and x.active) then
    return null;                                                    -- no limits set: no threshold (today)
  end if;
  select * into l from public.inventory_approval_limits x
   where x.organisation_id = p.organisation_id and x.entity_type = 'purchase_order' and x.active
     and lower(regexp_replace(btrim(x.approver_role), '\s+', '_', 'g')) = v_role
     and (x.country is null or upper(btrim(x.country)) = upper(btrim(coalesce(p.country, '')))
          or (p.country is null and upper(btrim(coalesce(x.currency, ''))) = upper(btrim(coalesce(p.currency, '')))))
     and (x.site is null or upper(btrim(x.site)) = upper(btrim(coalesce(p.site, ''))))
   order by (x.site is not null) desc, (x.country is not null) desc, x.created_at limit 1;
  if not found then
    if v_admin then return null; end if;                            -- Admin / super admin: no row = no upper limit
    return 'No purchase approval limit is set for your role (' || coalesce(nullif(v_raw, ''), 'no role') || '). Ask an approver with a limit.';
  end if;
  if exists (select 1 from public.purchase_order_lines where po_id = p.id) then
    select sum(qty_ordered), sum(qty_ordered * unit_price), count(*) filter (where unit_price is null),
           count(distinct upper(coalesce(currency, p.currency))), upper(min(coalesce(currency, p.currency)))
      into v_qty, v_val, v_unpriced, v_curs, v_cur
      from public.purchase_order_lines where po_id = p.id and status <> 'cancelled';
    if v_unpriced > 0 or v_curs > 1 then v_val := null; end if;
    if v_cur is not null and p.currency is not null and v_cur <> upper(btrim(p.currency)) then v_val := null; end if;
  else
    v_qty := null; v_val := nullif(p.total_amount, 0); v_cur := upper(p.currency);
  end if;
  v_cur := coalesce(v_cur, upper(p.currency), upper(public.currency_for_country(p.country)));
  if l.max_qty is not null and coalesce(v_qty, 0) > l.max_qty then
    return format('Quantity %s is above your approval limit of %s. Escalate to a higher approver.', v_qty, l.max_qty);
  end if;
  if l.max_value is not null then
    if v_val is null then
      return 'The order value is not known (a line has no price or lines use different currencies). It needs an approver without a value limit.';
    end if;
    if l.currency is not null and upper(btrim(l.currency)) is distinct from v_cur then
      return format('Your limit is in %s and this order is in %s. Escalate to an approver with a %s limit.', upper(l.currency), coalesce(v_cur, 'an unknown currency'), coalesce(v_cur, 'matching'));
    end if;
    if v_val > l.max_value then
      return format('Order value %s %s is above your approval limit of %s. Escalate to a higher approver.', coalesce(v_cur, ''), round(v_val, 2), l.max_value);
    end if;
  end if;
  return null;
end $fn$;
revoke all on function public._po_limit_block(public.purchase_orders) from public, anon, authenticated;
grant execute on function public._po_limit_block(public.purchase_orders) to service_role;

-- SECURITY DEFINER (review A16): the limit and emergency helpers it calls are no longer executable by clients.
-- auth.uid() / get_my_role() still describe the signed-in person (they read the request claims).
create or replace function public.guard_po_controls()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_post boolean := current_setting('app.inv_po_post_approval', true) = 'on'; v_block text;
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    new.approved_by_id := null; new.approved_at := null;
    new.emergency_approved_by_id := null; new.emergency_approved_by := null; new.emergency_approved_at := null;
    new.emergency_overrun_reason := null;
    if coalesce(new.is_emergency, false) then
      new := public._po_emergency_normalise(new);                    -- refuses an incomplete justification
    else
      new := public._po_emergency_clear(new);
    end if;
    -- (review A3) a PO raised straight as Submitted needs an approved supplier
    if v_uid is not null and new.supplier_id is not null and coalesce(new.status, 'Draft') = 'Submitted'
       and not exists (select 1 from public.suppliers s where s.id = new.supplier_id and s.approved_for_purchasing) then
      raise exception 'The supplier is not on the approved supplier list. Ask a buyer to approve the supplier first.' using errcode = '22023';
    end if;
    return new;
  end if;
  if not v_post then                                                 -- stamped columns are never client written
    new.approved_by_id := old.approved_by_id; new.approved_at := old.approved_at;
    new.emergency_approved_by_id := old.emergency_approved_by_id; new.emergency_approved_by := old.emergency_approved_by;
    new.emergency_approved_at := old.emergency_approved_at;
    new.emergency_declared_by := old.emergency_declared_by; new.emergency_declared_at := old.emergency_declared_at;
    new.emergency_requested_by_name := old.emergency_requested_by_name;
    new.emergency_overrun_reason := old.emergency_overrun_reason;
  end if;
  v_changed := (new.is_emergency, new.emergency_reason, new.emergency_category, new.emergency_category_note,
                new.emergency_asset_no, new.emergency_work_order_id, new.emergency_job_card_no, new.emergency_downtime_hours,
                new.emergency_impact, new.emergency_est_value, new.emergency_est_currency, new.emergency_attachment_path)
    is distinct from
               (old.is_emergency, old.emergency_reason, old.emergency_category, old.emergency_category_note,
                old.emergency_asset_no, old.emergency_work_order_id, old.emergency_job_card_no, old.emergency_downtime_hours,
                old.emergency_impact, old.emergency_est_value, old.emergency_est_currency, old.emergency_attachment_path);
  if v_changed then
    if old.status not in ('Draft', 'Submitted') then
      raise exception 'The emergency flag and its justification cannot change after the order is approved or placed.' using errcode = '22023';
    end if;
    if coalesce(new.is_emergency, false) then
      new := public._po_emergency_normalise(new);
      if v_uid is null then new.emergency_declared_by := old.emergency_declared_by; end if;
    else
      new := public._po_emergency_clear(new);
    end if;
  elsif coalesce(new.is_emergency, false) and (new.country, new.currency) is distinct from (old.country, old.currency)
        and old.status in ('Draft', 'Submitted') then
    new := public._po_emergency_normalise(new);                      -- the asset and currency checks depend on these
    new.emergency_declared_by := old.emergency_declared_by; new.emergency_declared_at := old.emergency_declared_at;
    new.emergency_requested_by_name := old.emergency_requested_by_name;
  end if;
  if v_uid is null then return new; end if;                          -- service role / cron
  if new.status is distinct from old.status then
    -- (review A3) Submitted / Approved need a supplier on the approved list
    if new.status in ('Submitted', 'Approved') and new.supplier_id is not null
       and not exists (select 1 from public.suppliers s where s.id = new.supplier_id and s.approved_for_purchasing) then
      raise exception 'The supplier is not on the approved supplier list. Ask a buyer to approve the supplier first.' using errcode = '22023';
    end if;
    if new.status = 'Approved' then
      if old.created_by = v_uid or (old.is_emergency and old.emergency_declared_by = v_uid) then
        raise exception 'You cannot approve a purchase order you created.' using errcode = '42501';
      end if;
      v_block := public._po_limit_block(new);                       -- (review A3) the NEW value, currency, country, site
      if v_block is not null then raise exception '%', v_block using errcode = '42501'; end if;
      new.approved_by_id := v_uid; new.approved_at := now();
    elsif new.status = 'Ordered' and old.status in ('Draft', 'Submitted') and not coalesce(new.is_emergency, false) then
      raise exception 'Only an approved purchase order can be placed. Flag it as an emergency purchase to order first and approve after.' using errcode = '22023';
    elsif new.status = 'Closed' and coalesce(old.is_emergency, false) and old.emergency_approved_at is null then
      -- (review A13) an emergency purchase is approved after the fact before it can be closed
      raise exception 'This emergency purchase is not approved yet. Approve it after the fact before closing it.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.guard_po_controls() from public, anon, authenticated;
create or replace trigger trg_po_controls
  before insert or update on public.purchase_orders
  for each row execute function public.guard_po_controls();

-- WP4's guard_po_rules: let an emergency PO be ordered before approval (one anchored replacement).
do $p$
declare src text := replace(pg_get_functiondef('public.guard_po_rules()'::regprocedure), chr(13), '');
  a text := $a$elsif new.status = 'Ordered' and old.status <> 'Approved' then$a$;
  b text := $a$elsif new.status = 'Ordered' and old.status <> 'Approved' and not coalesce(new.is_emergency, false) then$a$;
  n int;
begin
  if position('new.is_emergency' in src) > 0 then raise notice '130000: guard_po_rules already patched'; return; end if;
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then raise exception '130000: guard_po_rules anchor matched % times (expected 1)', n; end if;
  execute replace(src, a, b);
end $p$;

create or replace function public.inv_po_emergency_approve(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_uid uuid := auth.uid(); v_org uuid := public.app_current_org(); po public.purchase_orders%rowtype;
  v_block text; v_name text; v_total numeric; v_unpriced int; v_curs int;
  v_overrun text := nullif(btrim(coalesce(p_payload->>'overrun_reason', p_payload->>'reason', '')), '');
begin
  r := public._inv_req_begin('inv_po_emergency_approve', p_payload); if r is not null then return r; end if;
  if not public.inv_can('procure') then raise exception 'Stock permission "procure" is required.' using errcode = '42501'; end if;
  select * into po from public.purchase_orders where id = nullif(p_payload->>'po_id', '')::uuid and organisation_id = v_org for update;
  if not found then raise exception 'Purchase order not found.' using errcode = 'P0002'; end if;
  if not public._inv_scope_ok(po.country, po.site) then raise exception 'Outside your country or site scope.' using errcode = '42501'; end if;
  if not po.is_emergency then raise exception 'This is not an emergency purchase. Use the normal approval.' using errcode = '22023'; end if;
  if po.emergency_approved_at is not null then raise exception 'This emergency purchase is already approved.' using errcode = '22023'; end if;
  if po.status not in ('Ordered', 'Partial Delivery', 'Delivered', 'Closed') then
    raise exception 'Approve a Draft or Submitted emergency order through the normal approval.' using errcode = '22023';
  end if;
  if po.created_by = v_uid or po.emergency_declared_by = v_uid then
    raise exception 'You cannot approve a purchase order you created.' using errcode = '42501';
  end if;
  -- (review A3) nor one you last edited or added a line to
  if po.updated_by = v_uid then
    raise exception 'You made the last change to this purchase order; another person must approve it.' using errcode = '42501';
  end if;
  if exists (select 1 from public.purchase_order_lines l where l.po_id = po.id and l.created_by = v_uid) then
    raise exception 'You added a line to this purchase order; another person must approve it.' using errcode = '42501';
  end if;
  v_block := public._po_limit_block(po);
  if v_block is not null then raise exception '%', v_block using errcode = '42501'; end if;
  -- (review A13) the order may not cost more than 10% above the estimate given when it was declared, unless the
  -- approver writes why (an unpriced or mixed-currency order counts as over: its value is not known)
  select sum(qty_ordered * unit_price), count(*) filter (where unit_price is null),
         count(distinct upper(coalesce(currency, po.currency)))
    into v_total, v_unpriced, v_curs
    from public.purchase_order_lines where po_id = po.id and status <> 'cancelled';
  if (v_unpriced > 0 or v_curs > 1 or v_total is null or v_total > po.emergency_est_value * 1.10)
     and (v_overrun is null or length(v_overrun) < 10) then
    raise exception 'The order value (% %) is more than 10%% above the emergency estimate (% %) or is not known. Write why (at least 10 characters) to approve it.',
      coalesce(round(v_total, 2)::text, 'unknown'), coalesce(po.currency, ''), po.emergency_est_value, coalesce(po.emergency_est_currency, '')
      using errcode = '22023';
  end if;
  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.username), ''), left(v_uid::text, 8)) into v_name
    from public.profiles p where p.id = v_uid;
  perform set_config('app.inv_po_post_approval', 'on', true);
  update public.purchase_orders set emergency_approved_by_id = v_uid, emergency_approved_by = left(v_name, 100),
    emergency_approved_at = now(), approved_by_id = v_uid, approved_at = now(), updated_at = now(),
    emergency_overrun_reason = case when v_unpriced > 0 or v_curs > 1 or v_total is null
                                         or v_total > po.emergency_est_value * 1.10 then left(v_overrun, 1000) end
   where id = po.id;
  perform set_config('app.inv_po_post_approval', 'off', true);
  return public._inv_req_end('inv_po_emergency_approve', p_payload, jsonb_build_object('po_id', po.id, 'approved_by', v_name));
end $fn$;

-- (review A13) no supplier invoice against an emergency purchase until it is approved after the fact.
create or replace function public.guard_invoice_emergency_po()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.po_id is not null and (tg_op = 'INSERT' or new.po_id is distinct from old.po_id)
     and exists (select 1 from public.purchase_orders po where po.id = new.po_id
                  and po.is_emergency and po.emergency_approved_at is null) then
    raise exception 'This emergency purchase is not approved yet. It must be approved after the fact before an invoice is recorded against it.'
      using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function public.guard_invoice_emergency_po() from public, anon, authenticated;
create or replace trigger trg_guard_invoice_emergency_po
  before insert or update of po_id on public.supplier_invoices
  for each row execute function public.guard_invoice_emergency_po();

-- ── 5. Receipt rejection reasons ────────────────────────────────────────────────────────────────────────────────
alter table public.goods_receipt_lines
  add column if not exists rejection_code text
  check (rejection_code is null or rejection_code in ('damaged','wrong_part','quality','expired','other'));

create or replace function public.guard_grn_line_rejection()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_reason text := lower(btrim(coalesce(new.rejection_reason, '')));
begin
  if coalesce(new.qty_rejected, 0) > 0 then
    if new.rejection_code is null then
      new.rejection_code := case when v_reason ~ '^damage' then 'damaged'
        when v_reason ~ '^wrong[ _-]?(part|item)' then 'wrong_part' when v_reason ~ '^quality' then 'quality'
        when v_reason ~ '^expir' then 'expired' end;
    end if;
    if new.rejection_code is null and v_reason = '' then
      raise exception 'Line %: give a reason for the rejected quantity (damaged, wrong part, quality, expired).', new.line_no
        using errcode = '22023';
    end if;
    new.rejection_code := coalesce(new.rejection_code, 'other');
  else
    new.rejection_code := null;
  end if;
  return new;
end $$;
revoke execute on function public.guard_grn_line_rejection() from public, anon, authenticated;
create or replace trigger trg_grn_line_rejection
  before insert on public.goods_receipt_lines
  for each row execute function public.guard_grn_line_rejection();

-- ── 6. Supplier returns ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.supplier_returns (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  country text, site text,
  return_no text not null,
  supplier_id uuid references public.suppliers(id),
  grn_id uuid not null references public.goods_receipts(id),
  po_id uuid references public.purchase_orders(id),
  reason text not null,
  status text not null default 'posted' check (status in ('posted')),
  idempotency_key text not null,
  created_by uuid, created_at timestamptz not null default now(),
  unique (organisation_id, idempotency_key), unique (organisation_id, return_no)
);
select public._inv_secure_table('supplier_returns', true, true);

create table if not exists public.supplier_return_lines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  return_id uuid not null references public.supplier_returns(id) on delete cascade,
  line_no integer not null,
  grn_line_id uuid not null references public.goods_receipt_lines(id),
  item_id uuid references public.material_master(id),
  location_id uuid references public.inventory_locations(id),
  source text not null check (source in ('rejected','accepted')),
  qty numeric not null check (qty > 0),
  reason_code text check (reason_code is null or reason_code in ('damaged','wrong_part','quality','expired','other')),
  movement_id uuid references public.stock_movements(id),
  unique (return_id, line_no)
);
create index if not exists supplier_return_lines_grn_line_idx on public.supplier_return_lines (grn_line_id, source);
select public._inv_secure_table('supplier_return_lines', false, false);

create or replace function public.inv_supplier_return(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_uid uuid := auth.uid(); v_org uuid := public.app_current_org(); v_key text := nullif(btrim(coalesce(p_payload->>'idempotency_key', '')), '');
  g public.goods_receipts%rowtype; gl public.goods_receipt_lines%rowtype; v_ret public.supplier_returns%rowtype;
  l jsonb; v_n int := 0; v_src text; v_qty numeric; v_done numeric; v_avail numeric; v_post jsonb; v_line uuid;
  v_po uuid; v_reopened boolean := false;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('receive') then
    raise exception 'Stock permission "receive" is required.' using errcode = '42501';
  end if;
  if v_key is null then raise exception 'An idempotency_key is required.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':sret:' || v_key, 0));
  select * into v_ret from public.supplier_returns where organisation_id = v_org and idempotency_key = v_key;
  if found then return jsonb_build_object('return_id', v_ret.id, 'return_no', v_ret.return_no, 'replayed', true); end if;
  select * into g from public.goods_receipts where id = nullif(p_payload->>'grn_id', '')::uuid and organisation_id = v_org;
  if not found then raise exception 'Goods receipt not found.' using errcode = 'P0002'; end if;
  if not public._inv_scope_ok(g.country, g.site) then raise exception 'Outside your country or site scope.' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(p_payload->>'reason', '')), '') is null then
    raise exception 'Give a reason for the return.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_payload->'lines', '[]'::jsonb)) = 0 then
    raise exception 'Add at least one line to return.' using errcode = '22023';
  end if;
  v_po := g.po_id;
  insert into public.supplier_returns(organisation_id, country, site, return_no, supplier_id, grn_id, po_id, reason,
    idempotency_key, created_by)
  values (v_org, g.country, g.site, 'SRN-' || upper(left(md5(v_org::text || v_key), 8)),
    coalesce(g.supplier_id, (select po.supplier_id from public.purchase_orders po where po.id = g.po_id)),
    g.id, g.po_id, btrim(p_payload->>'reason'), v_key, v_uid)
  returning * into v_ret;
  for l in select value from jsonb_array_elements(p_payload->'lines') loop
    v_n := v_n + 1;
    v_src := lower(btrim(coalesce(l->>'source', '')));
    v_qty := nullif(l->>'qty', '')::numeric;
    if v_src not in ('rejected', 'accepted') then
      raise exception 'Line %: say whether you return rejected goods or accepted (defective) goods.', v_n using errcode = '22023';
    end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Line %: enter a quantity above zero.', v_n using errcode = '22023'; end if;
    select * into gl from public.goods_receipt_lines where id = nullif(l->>'grn_line_id', '')::uuid and grn_id = g.id for update;
    if not found then raise exception 'Line %: that line is not on this goods receipt.', v_n using errcode = '22023'; end if;
    select coalesce(sum(qty), 0) into v_done from public.supplier_return_lines where grn_line_id = gl.id and source = v_src;
    v_avail := case v_src when 'rejected' then gl.qty_rejected else gl.qty_accepted end - v_done;
    if v_qty > v_avail then
      raise exception 'Line %: you can return at most % (% % on the receipt, % already returned).', v_n, greatest(v_avail, 0),
        case v_src when 'rejected' then gl.qty_rejected else gl.qty_accepted end, v_src, v_done using errcode = '22023';
    end if;
    insert into public.supplier_return_lines(organisation_id, return_id, line_no, grn_line_id, item_id, location_id, source,
      qty, reason_code)
    values (v_org, v_ret.id, v_n, gl.id, gl.item_id, gl.location_id, v_src, v_qty,
      coalesce(nullif(lower(btrim(coalesce(l->>'reason_code', ''))), ''), gl.rejection_code, 'other'))
    returning id into v_line;
    if v_src = 'accepted' then
      v_post := public._inv_post(jsonb_strip_nulls(jsonb_build_object('idempotency_key', 'sret:' || v_key || ':' || v_n,
        'item_id', gl.item_id, 'location_id', gl.location_id, 'condition', gl.condition, 'ownership', gl.ownership,
        'owner_supplier_id', gl.owner_supplier_id, 'movement_type', 'supplier_return', 'qty_change', -v_qty,
        'credit_unit_cost', gl.unit_cost, 'currency', gl.currency, 'reason', btrim(p_payload->>'reason'),
        'reference_no', v_ret.return_no, 'source_doc_type', 'supplier_return', 'source_doc_id', v_ret.id::text)), false);
      if v_post->>'status' = 'refused_shortage' then
        raise exception 'Line %: not enough of this item is left at the receiving location to return it (it may have been issued or moved).', v_n
          using errcode = '22023';
      end if;
      update public.supplier_return_lines set movement_id = nullif(v_post->>'movement_id', '')::uuid where id = v_line;
      if gl.po_line_id is not null then                         -- the replacement is now outstanding again
        update public.purchase_order_lines set qty_accepted = qty_accepted - v_qty, qty_rejected = qty_rejected + v_qty,
          status = case when qty_accepted - v_qty >= qty_ordered then 'received' else 'partial' end
         where id = gl.po_line_id and status not in ('closed', 'cancelled');
        v_reopened := v_reopened or found;
      end if;
    end if;
  end loop;
  if v_reopened and v_po is not null then
    perform set_config('app.inv_receiving', 'on', true);
    update public.purchase_orders po set status = 'Partial Delivery', updated_at = now()
     where id = v_po and status = 'Delivered'
       and exists (select 1 from public.purchase_order_lines x where x.po_id = po.id and x.status = 'partial');
    perform set_config('app.inv_receiving', 'off', true);
  end if;
  return jsonb_build_object('return_id', v_ret.id, 'return_no', v_ret.return_no, 'lines', v_n);
end $fn$;

-- ── 6b. Three-way match nets supplier returns out of the accepted quantity, and refuses an invoice of an emergency
--        purchase that is not yet approved after the fact (review A13). Anchored; aborts unless each anchor occurs once.
do $p$
declare src text := replace(pg_get_functiondef('public._inv_supplier_invoice_match(uuid)'::regprocedure), chr(13), '');
  a text := $a$coalesce((select sum(g.qty_accepted) from public.goods_receipt_lines g where g.po_line_id = pl.id), 0) as grn_qty$a$;
  b text := $a$coalesce((select sum(g.qty_accepted) from public.goods_receipt_lines g where g.po_line_id = pl.id), 0)
           - coalesce((select sum(rl.qty) from public.supplier_return_lines rl
                          join public.goods_receipt_lines g2 on g2.id = rl.grn_line_id
                         where g2.po_line_id = pl.id and rl.source = 'accepted'), 0) as grn_qty$a$;
  a2 text := $a$if not found then raise exception 'Invoice not found.' using errcode = 'P0002'; end if;$a$;
  b2 text := $a$if not found then raise exception 'Invoice not found.' using errcode = 'P0002'; end if;
  if v.po_id is not null and exists (select 1 from public.purchase_orders po where po.id = v.po_id
                                      and po.is_emergency and po.emergency_approved_at is null) then
    raise exception 'This emergency purchase is not approved yet. Approve it after the fact before matching its invoice.' using errcode = '22023';
  end if;$a$;
  n int;
begin
  if position('supplier_return_lines' in src) > 0 then raise notice '130000: invoice match already patched'; return; end if;
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then raise exception '130000: invoice match anchor matched % times (expected 1)', n; end if;
  n := (length(src) - length(replace(src, a2, ''))) / length(a2);
  if n <> 1 then raise exception '130000: invoice match anchor 2 matched % times (expected 1)', n; end if;
  execute replace(replace(src, a, b), a2, b2);
end $p$;

-- ── 7. Read views (security_invoker: RLS of the base tables applies) ────────────────────────────────────────────
create or replace view public.v_po_backorders with (security_invoker = on) as
select l.id as po_line_id, l.organisation_id, po.id as po_id, po.po_number, po.country, po.site, po.status as po_status,
       po.supplier_id, coalesce(s.supplier_name, po.supplier_name, po.vendor_name) as supplier_name,
       po.order_date, po.expected_delivery, po.is_emergency,
       l.line_no, l.item_id, m.item_code, coalesce(m.item_name, l.description) as item_name, m.base_uom as uom,
       l.qty_ordered, l.qty_received, l.qty_accepted, l.qty_rejected, coalesce(rt.returned_qty, 0) as returned_qty,
       greatest(l.qty_ordered - l.qty_accepted, 0) as qty_outstanding,
       l.status as line_status, l.unit_price, upper(coalesce(l.currency, po.currency)) as currency,
       (l.status not in ('received','closed','cancelled') and po.expected_delivery is not null
         and po.expected_delivery < current_date) as is_overdue,
       case when l.status not in ('received','closed','cancelled') and po.expected_delivery < current_date
            then current_date - po.expected_delivery end as days_overdue,
       (select max(gr.received_date) from public.goods_receipt_lines g join public.goods_receipts gr on gr.id = g.grn_id
         where g.po_line_id = l.id) as last_received_on
  from public.purchase_order_lines l
  join public.purchase_orders po on po.id = l.po_id
  left join public.suppliers s on s.id = po.supplier_id
  left join public.material_master m on m.id = l.item_id
  left join lateral (select sum(rl.qty) as returned_qty from public.supplier_return_lines rl
                       join public.goods_receipt_lines g on g.id = rl.grn_line_id
                      where g.po_line_id = l.id and rl.source = 'accepted') rt on true
 where po.status not in ('Draft','Submitted','Cancelled');
revoke all on public.v_po_backorders from anon;
grant select on public.v_po_backorders to authenticated;

create or replace view public.v_supplier_delivery_performance with (security_invoker = on) as
with po as (
  select p.id, p.supplier_id, p.expected_delivery,
         (select max(gr.received_date) from public.goods_receipts gr where gr.po_id = p.id) as last_receipt,
         (select count(*) from public.goods_receipts gr where gr.po_id = p.id) as receipts,
         exists (select 1 from public.purchase_order_lines x where x.po_id = p.id) as has_lines,
         not exists (select 1 from public.purchase_order_lines x where x.po_id = p.id
                      and x.status not in ('received','closed','cancelled')) as complete
    from public.purchase_orders p
   where p.supplier_id is not null and p.status not in ('Draft','Submitted','Cancelled')
), agg as (
  select supplier_id, count(*) as orders_placed,
         count(*) filter (where has_lines and complete) as orders_completed,
         count(*) filter (where has_lines and complete and expected_delivery is not null and last_receipt <= expected_delivery) as on_time,
         count(*) filter (where has_lines and complete and expected_delivery is not null and last_receipt > expected_delivery) as late,
         count(*) filter (where has_lines and not complete and expected_delivery < current_date) as open_overdue,
         count(*) filter (where has_lines and not complete and receipts > 0 and expected_delivery < current_date) as short_deliveries,
         count(*) filter (where receipts > 1) as split_deliveries
    from po group by supplier_id
), g as (
  select coalesce(gr.supplier_id, p.supplier_id) as supplier_id, sum(gl.qty_received) as qty_received,
         sum(gl.qty_rejected) as qty_rejected, count(*) filter (where gl.qty_rejected > 0) as lines_with_rejects
    from public.goods_receipt_lines gl join public.goods_receipts gr on gr.id = gl.grn_id
    left join public.purchase_orders p on p.id = gr.po_id
   group by 1
), ret as (
  select r.supplier_id, sum(rl.qty) as qty_returned
    from public.supplier_returns r join public.supplier_return_lines rl on rl.return_id = r.id group by 1
)
select s.id as supplier_id, s.organisation_id, s.supplier_name, s.country, s.status, s.approved_for_purchasing,
       coalesce(a.orders_placed, 0) as orders_placed, coalesce(a.orders_completed, 0) as orders_completed,
       coalesce(a.on_time, 0) as on_time, coalesce(a.late, 0) as late, coalesce(a.open_overdue, 0) as open_overdue,
       coalesce(a.short_deliveries, 0) as short_deliveries, coalesce(a.split_deliveries, 0) as split_deliveries,
       round(100.0 * a.on_time / nullif(a.on_time + a.late, 0), 1) as on_time_pct,
       g.qty_received, g.qty_rejected, coalesce(g.lines_with_rejects, 0) as lines_with_rejects,
       round(100.0 * g.qty_rejected / nullif(g.qty_received, 0), 2) as reject_pct,
       ret.qty_returned
  from public.suppliers s
  left join agg a on a.supplier_id = s.id
  left join g on g.supplier_id = s.id
  left join ret on ret.supplier_id = s.id;
revoke all on public.v_supplier_delivery_performance from anon;
grant select on public.v_supplier_delivery_performance to authenticated;


-- ── 8. Child tables read their parent's country / site scope (review A15) ───────────────────────────────────────
-- The parent rows are themselves filtered by their country and site policies, so "the parent is visible" is exactly
-- the parent's scope; a child row of an out-of-scope request / quote / return is hidden.
drop policy if exists procurement_rfq_lines_parent_scope on public.procurement_rfq_lines;
create policy procurement_rfq_lines_parent_scope on public.procurement_rfq_lines as restrictive for select to authenticated
  using (exists (select 1 from public.procurement_rfqs r where r.id = rfq_id));
drop policy if exists procurement_rfq_invites_parent_scope on public.procurement_rfq_invites;
create policy procurement_rfq_invites_parent_scope on public.procurement_rfq_invites as restrictive for select to authenticated
  using (exists (select 1 from public.procurement_rfqs r where r.id = rfq_id));
drop policy if exists procurement_quotes_parent_scope on public.procurement_quotes;
create policy procurement_quotes_parent_scope on public.procurement_quotes as restrictive for select to authenticated
  using (exists (select 1 from public.procurement_rfqs r where r.id = rfq_id));
drop policy if exists procurement_quote_lines_parent_scope on public.procurement_quote_lines;
create policy procurement_quote_lines_parent_scope on public.procurement_quote_lines as restrictive for select to authenticated
  using (exists (select 1 from public.procurement_quotes q where q.id = quote_id));
drop policy if exists supplier_return_lines_parent_scope on public.supplier_return_lines;
create policy supplier_return_lines_parent_scope on public.supplier_return_lines as restrictive for select to authenticated
  using (exists (select 1 from public.supplier_returns r where r.id = return_id));

-- ── Grants ──────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.inv_supplier_set_approval(jsonb), public.inv_rfq_create(jsonb), public.inv_rfq_quote_record(jsonb),
  public.inv_rfq_award(jsonb), public.inv_rfq_cancel(jsonb), public.inv_po_emergency_approve(jsonb),
  public.inv_supplier_return(jsonb) from public, anon;
grant execute on function public.inv_supplier_set_approval(jsonb), public.inv_rfq_create(jsonb), public.inv_rfq_quote_record(jsonb),
  public.inv_rfq_award(jsonb), public.inv_rfq_cancel(jsonb), public.inv_po_emergency_approve(jsonb),
  public.inv_supplier_return(jsonb) to authenticated, service_role;

do $$ begin
  if to_regprocedure('anum_integration.apply_reader_policies()') is not null then
    perform anum_integration.apply_reader_policies();
  end if;
end $$;

commit;
