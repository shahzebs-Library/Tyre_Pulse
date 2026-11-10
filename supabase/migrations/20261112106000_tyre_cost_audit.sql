-- 20261112106000_tyre_cost_audit.sql
-- STATUS: AUTHORED, NOT APPLIED. Apply only with the owner's approval.
--
-- Tyre Cost Audit: deterministic detection and SAFE recovery of tyre acquisition costs.
-- Mirror of src/lib/tyreCostAudit.js (change both; src/test/tyreCostAudit.test.js pins the rules).
--
-- Rules: no guessed price, no cross-month substitution, same normalised item code only,
-- warranty never repriced, tube/flap/valve/repair/service never a tyre price, unknown cost
-- stays NULL ("Cost Pending Verification"), conflicts go to review, never averaged.
-- Price source: ERP store-issue lines in parts_consumption (no invoice/GRN/PO data exists:
-- goods_receipts, purchase_orders and invoices hold 0 rows). Stated on every report.
--
-- Objects
--   tyre_cost_line_kind(text)                 IMMUTABLE line classifier (tyre/tube/flap/valve/service/repair/warranty/mixed/other)
--   tyre_cost_audit_classify(country,from,to) STABLE, SECURITY INVOKER: per-tyre class + proposal (RLS applies)
--   tyre_cost_audit_findings                  persisted findings (one open finding per tyre + class + proposal)
--   tyre_cost_audit_scan(country,from,to,dry_run)  summary; persists findings when dry_run = false (idempotent)
--   tyre_cost_audit_decide(ids,decision,note)       approve / reject (Admin, Manager, Director, super admin)
--   tyre_cost_audit_apply(ids)                      writes APPROVED proposals only, logs to tyre_cost_corrections,
--                                                   undo = public.tyre_cost_correction_undo(batch). Aborts if any km changed.
--
-- VERIFY (rolled back):
--   begin; select public.tyre_cost_audit_scan('KSA','2025-01-01',current_date,true); rollback;
--   -- expect KSA: exact_match 147 (SAR 115,952.96), same_month_item_match 4 (SAR 3,440),
--   --         priced_estimate_not_verified 1,885, month_mismatch 1,793 (live, 2026-11-10)
-- ROLLBACK:
--   drop function if exists public.tyre_cost_audit_apply(uuid[]);
--   drop function if exists public.tyre_cost_audit_decide(uuid[], text, text);
--   drop function if exists public.tyre_cost_audit_scan(text, date, date, boolean);
--   drop function if exists public.tyre_cost_audit_classify(text, date, date);
--   drop table if exists public.tyre_cost_audit_findings;
--   drop function if exists public.tyre_cost_line_kind(text);
--   (applied corrections: select public.tyre_cost_correction_undo('<batch>') first)

create or replace function public.tyre_cost_line_kind(p_text text)
returns text language sql immutable parallel safe set search_path = public as $$
  select (case
  when public.tyre_price_is_warranty(p_text) then 'warranty'
  when public.tyre_price_is_repair(p_text) then 'repair'
  when p_text ~* '(^|[^a-z])(tyres?|tires?)([^a-z]|$)' and p_text ~* '(^|[^a-z])((inner\s*)?tubes?|flaps?)([^a-z]|$)'
       and p_text ~* '((^|[^a-z])(with|and|incl\w*)([^a-z]|$)|[+&])' then 'mixed'
  when p_text ~* '(^|[^a-z])(inner\s*)?tubes?([^a-z]|$)' then 'tube'
  when p_text ~* '(^|[^a-z])flaps?([^a-z]|$)' then 'flap'
  when p_text ~* '(^|[^a-z])valves?([^a-z]|$)' then 'valve'
  when p_text ~* '(fitting|mounting|dismount|labou?r|service charge|alignment|balanc|installation)'
       and not (p_text ~* '\y\d{3}/\d{2,3}\s*[rz]?\s*\d{2}(\.\d)?\y|\y\d{2}\.\d{1,2}\s*[-r]\s*\d{2}\y|\y1[12]\.?0?0\s*[-r]\s*\d{2}(\.\d)?\y|\y\d{2}\s*[-r]\s*1[68]\.5\y|\y\d{1,2}\.\d{2}\s*r\s*\d{2}\y|\y\d{3}\s*r\s*\d{2}c?\y') then 'service'
  when p_text ~* '(^|[^a-z])(tyres?|tires?)([^a-z]|$)'
       or p_text ~* '\y\d{3}/\d{2,3}\s*[rz]?\s*\d{2}(\.\d)?\y|\y\d{2}\.\d{1,2}\s*[-r]\s*\d{2}\y|\y1[12]\.?0?0\s*[-r]\s*\d{2}(\.\d)?\y|\y\d{2}\s*[-r]\s*1[68]\.5\y|\y\d{1,2}\.\d{2}\s*r\s*\d{2}\y|\y\d{3}\s*r\s*\d{2}c?\y' then 'tyre'
  else 'other' end)
$$;

create or replace function public.tyre_cost_audit_classify(p_country text, p_from date, p_to date)
returns table (
  tyre_id uuid, country text, site text, asset_no text, serial_no text, job_card text, month text,
  current_cost numeric, currency text, class text, proposed_cost numeric, source_line_id text,
  item_code text, confidence text, reason text)
language sql stable security invoker set search_path = public
set plan_cache_mode = force_custom_plan as $fn$
with t as materialized (
  select r.id, r.country, r.cost_per_tyre cost, btrim(r.job_card) jc, coalesce(r.issue_date, r.fitment_date) d,
         to_char(coalesce(r.issue_date, r.fitment_date), 'YYYY-MM') m,
         nullif(regexp_replace(upper(coalesce(r.size,'')), '[^0-9A-Z]', '', 'g'), '') sz,
         nullif(upper(btrim(r.brand)), '') brand, r.serial_no, r.site, r.asset_no,
         (select l.source from public.tyre_price_backfill_log l where l.tyre_id = r.id order by l.created_at desc limit 1) bf_source
  from public.tyre_records r
  where coalesce(r.issue_date, r.fitment_date) between p_from and p_to
    and (p_country::text is null or r.country = p_country::text)),
dup as (
  select upper(btrim(serial_no)) s, country from public.tyre_records
  where cost_per_tyre > 0 and public.tyre_serial_is_strong(serial_no)
  group by 1, 2 having count(*) > 1),
ol as materialized (
  select p.id, p.country, btrim(p.work_order_no) jc, upper(regexp_replace(coalesce(p.item_code,''), '\s+', '', 'g')) item,
         to_char(p.event_date, 'YYYY-MM') m, p.item_description dsc, p.qty_n q, p.line_cost v,
         public.tyre_cost_line_kind(p.item_description) k
  from public.parts_consumption p
  where btrim(p.work_order_no) in (select jc from t where coalesce(jc,'') <> '')
    and p.event_date >= (p_from::date - 120)),
own as (
  select o.*, case when o.k = 'tyre' and o.q > 0 and o.v > 0 then round(o.v / o.q, 2) end up
  from ol o where o.k in ('tyre', 'mixed', 'warranty')),
idx as (
  select p.country, upper(regexp_replace(coalesce(p.item_code,''), '\s+', '', 'g')) item, to_char(p.event_date, 'YYYY-MM') m,
         count(distinct round(p.line_cost / p.qty_n, 2)) n_prices, min(round(p.line_cost / p.qty_n, 2)) price, min(p.id::text) src
  from public.parts_consumption p
  where p.cost_category = 'tyre' and p.qty_n > 0 and p.line_cost > 0 and coalesce(p.item_code,'') <> ''
    and p.event_date between (p_from::date - 31) and (p_to::date + 31)
    and public.tyre_cost_line_kind(p.item_description) = 'tyre'
  group by 1, 2, 3),
a as (
  select t.*,
    exists (select 1 from public.warranty_claims w where upper(btrim(w.serial_number)) = upper(btrim(t.serial_no)) and coalesce(btrim(t.serial_no),'') <> '') claim,
    exists (select 1 from dup where dup.s = upper(btrim(t.serial_no)) and dup.country = t.country) dup_price,
    bool_or(o.k = 'warranty') w_line, bool_or(o.k = 'mixed') mixed,
    count(distinct o.item) filter (where o.up is not null and o.item <> '') n_items,
    count(distinct o.up) filter (where o.up is not null and o.m = t.m) n_p_same,
    min(o.up) filter (where o.up is not null and o.m = t.m) p_same,
    min(o.id::text) filter (where o.up is not null and o.m = t.m) src_same,
    min(o.dsc) filter (where o.up is not null and o.m = t.m) dsc_same,
    min(o.item) filter (where o.up is not null and o.m = t.m) item_same,
    count(*) filter (where o.up is not null) n_priced,
    min(o.m) filter (where o.up is not null) m_other,
    bool_or(o.up is not null and abs(o.up - t.cost) <= greatest(0.01, t.cost * 0.005)) cost_matches,
    count(*) filter (where o.k = 'tyre' and o.up is null) n_zero,
    count(distinct o.item) filter (where o.k = 'tyre' and o.up is null and o.item <> '') n_zero_items,
    min(o.item) filter (where o.k = 'tyre' and o.up is null and o.item <> '') zero_item,
    min(o.dsc) filter (where o.k = 'tyre' and o.up is null) zero_dsc
  from t left join own o on o.country = t.country and o.jc = t.jc and coalesce(t.jc,'') <> ''
  group by t.id, t.country, t.cost, t.jc, t.d, t.m, t.sz, t.brand, t.serial_no, t.site, t.asset_no, t.bf_source),
b as (
  select a.*, i.n_prices ix_n, i.price ix_price, i.src ix_src
  from a left join idx i on i.country = a.country and i.item = a.zero_item and i.m = a.m and a.n_zero_items = 1),
s as (
  select b.*,
    -- spec mismatch on the line that would supply the price
    (case when coalesce(b.dsc_same, b.zero_dsc) is null then false
      when b.sz is not null and coalesce(b.dsc_same, b.zero_dsc) ~* '\y\d{3}/\d{2,3}\s*[rz]?\s*\d{2}(\.\d)?\y|\y\d{2}\.\d{1,2}\s*[-r]\s*\d{2}\y|\y1[12]\.?0?0\s*[-r]\s*\d{2}(\.\d)?\y|\y\d{2}\s*[-r]\s*1[68]\.5\y|\y\d{1,2}\.\d{2}\s*r\s*\d{2}\y|\y\d{3}\s*r\s*\d{2}c?\y'
           and position(b.sz in regexp_replace(upper(coalesce(b.dsc_same, b.zero_dsc)), '[^0-9A-Z]', '', 'g')) = 0 then true
      when b.brand is not null and exists (select 1 from unnest(public.brain_tokens('tyre_brand')) bt(tok)
             where upper(coalesce(b.dsc_same, b.zero_dsc)) ~ ('(^|[^A-Z])' || regexp_replace(upper(bt.tok), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '([^A-Z]|$)'))
           and not exists (select 1 from unnest(public.brain_tokens('tyre_brand')) bt(tok)
             where upper(coalesce(b.dsc_same, b.zero_dsc)) ~ ('(^|[^A-Z])' || regexp_replace(upper(bt.tok), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '([^A-Z]|$)')
               and (position(upper(bt.tok) in b.brand) > 0 or position(b.brand in upper(bt.tok)) > 0)) then true
      else false end) spec_bad
  from b)
select s.id tyre_id, s.country, s.site, s.asset_no, s.serial_no, s.jc job_card, s.m as month, s.cost as current_cost,
  public.currency_for_country(s.country) currency,
  case
    when s.cost < 0 then 'invalid_cost'
    when s.claim or coalesce(s.w_line, false) then 'excluded_warranty'
    when s.cost > 0 and s.dup_price then 'duplicate_price'
    when s.cost > 0 and s.bf_source = 'comparable' then 'priced_estimate_not_verified'
    when s.cost > 0 and s.n_priced = 0 then 'priced_no_source'
    when s.cost > 0 and coalesce(s.cost_matches, false) then 'priced_verified'
    when s.cost > 0 then 'priced_unreconciled'
    when coalesce(s.mixed, false) then 'mixed_tyre_tube'
    when s.n_items > 1 or s.n_p_same > 1 then 'conflict'
    when s.n_p_same = 1 and s.spec_bad then 'spec_mismatch'
    when s.n_p_same = 1 then 'exact_match'
    when s.n_priced > 0 then 'month_mismatch'
    when s.n_zero_items = 1 and s.ix_n > 1 then 'conflict'
    when s.n_zero_items = 1 and s.ix_n = 1 and s.spec_bad then 'spec_mismatch'
    when s.n_zero_items = 1 and s.ix_n = 1 then 'same_month_item_match'
    when s.n_zero > 0 then 'zero_line_uncertain'
    else 'unresolved' end class,
  case
    when coalesce(s.cost, 0) <= 0 and not (s.claim or coalesce(s.w_line, false)) and not coalesce(s.mixed, false)
         and not (s.n_items > 1 or s.n_p_same > 1) and s.n_p_same = 1 and not s.spec_bad then s.p_same
    when coalesce(s.cost, 0) <= 0 and not (s.claim or coalesce(s.w_line, false)) and not coalesce(s.mixed, false)
         and s.n_items <= 1 and s.n_p_same = 0 and s.n_priced = 0 and s.n_zero_items = 1 and s.ix_n = 1 and not s.spec_bad then s.ix_price
  end proposed_cost,
  coalesce(s.src_same, s.ix_src) source_line_id,
  coalesce(s.item_same, s.zero_item) item_code,
  case when s.n_p_same = 1 and s.sz is not null then 'high' when s.n_p_same = 1 then 'medium' when s.ix_n = 1 then 'medium' end confidence,
  -- Plain-language reason shown to the reviewer (deterministic, no AI).
  case
    when s.cost < 0 then 'Negative cost ' || s.cost
    when s.claim then 'Warranty claim record exists for this serial'
    when coalesce(s.w_line, false) then 'Warranty wording on its own job card line'
    when s.cost > 0 and s.dup_price then 'Same strong serial carries a purchase price on another row'
    when s.cost > 0 and s.bf_source = 'comparable' then 'Price came from a median of other tyres of the same brand and size in earlier months, not a transaction'
    when s.cost > 0 and s.n_priced = 0 then 'No tyre line on its job card to confirm the stored price'
    when s.cost > 0 and coalesce(s.cost_matches, false) then 'Matches its own job card line'
    when s.cost > 0 then 'Stored ' || s.cost || ' differs from its own job card line'
    when coalesce(s.mixed, false) then 'Its job card line combines tyre and tube; split before pricing'
    when s.n_items > 1 or s.n_p_same > 1 then s.n_items || ' item codes / ' || s.n_p_same || ' prices on its job card in ' || s.m
    when s.n_p_same = 1 and s.spec_bad then 'Source line size or brand differs from the tyre (' || coalesce(s.sz, '?') || ', ' || coalesce(s.brand, '?') || ')'
    when s.n_p_same = 1 then 'Own job card line ' || coalesce(s.item_same, '(no item code)') || ' in ' || s.m || ': value / qty = ' || s.p_same
    when s.n_priced > 0 then 'Own line is in ' || coalesce(s.m_other, '?') || ', tyre is in ' || s.m || '; cross-month prices are not used'
    when s.n_zero_items = 1 and s.ix_n > 1 then 'Item ' || s.zero_item || ' has ' || s.ix_n || ' different prices in ' || s.m
    when s.n_zero_items = 1 and s.ix_n = 1 and s.spec_bad then 'Same-month price found but size or brand differs'
    when s.n_zero_items = 1 and s.ix_n = 1 then 'Own line ' || s.zero_item || ' issued at zero; same item priced ' || s.ix_price || ' in ' || s.m
    when s.n_zero > 0 then 'Own tyre line issued at zero; warranty not proven and no same-month price'
    when coalesce(s.jc, '') = '' then 'No job card to trace a price'
    else 'Its job card has no tyre line' end reason
from s

$fn$;

create table if not exists public.tyre_cost_audit_findings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  tyre_id uuid not null references public.tyre_records(id) on delete cascade,
  country text, site text, asset_no text, serial_no text, job_card text, month text,
  class text not null, original_cost numeric, proposed_cost numeric, currency text,
  item_code text, source_line_id text, confidence text, reasons jsonb not null default '[]'::jsonb,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','applied','undone','superseded')),
  decided_by uuid, decided_at timestamptz, decision_note text,
  applied_batch uuid, applied_at timestamptz,
  first_seen timestamptz not null default now(), last_seen timestamptz not null default now(),
  dedupe_key text not null
);
create unique index if not exists tyre_cost_audit_findings_open_uq
  on public.tyre_cost_audit_findings (organisation_id, dedupe_key) where status in ('proposed','approved');
create index if not exists tyre_cost_audit_findings_org_country on public.tyre_cost_audit_findings (organisation_id, country, class);
alter table public.tyre_cost_audit_findings enable row level security;
drop policy if exists tcaf_org_isolation on public.tyre_cost_audit_findings;
create policy tcaf_org_isolation on public.tyre_cost_audit_findings as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
drop policy if exists tcaf_country on public.tyre_cost_audit_findings;
create policy tcaf_country on public.tyre_cost_audit_findings as restrictive for select to authenticated
  using (country is null or public.app_can_see_country(country) is not false);
drop policy if exists tcaf_read on public.tyre_cost_audit_findings;
create policy tcaf_read on public.tyre_cost_audit_findings for select to authenticated using ((select public.app_is_elevated()));
revoke all on public.tyre_cost_audit_findings from anon;
drop policy if exists tcaf_insert on public.tyre_cost_audit_findings;
create policy tcaf_insert on public.tyre_cost_audit_findings for insert to authenticated
  with check ((select public.app_is_elevated()) or (select public.is_super_admin()));
-- Inserts happen through the (invoker) scan as the caller. Status and cost changes only through
-- the definer decide/apply RPCs, and apply re-checks every proposal against its source line,
-- so a hand-inserted finding with an invented price can never be applied.
revoke update, delete, truncate on public.tyre_cost_audit_findings from authenticated;
grant select, insert on public.tyre_cost_audit_findings to authenticated;

-- Scan: always computed as the caller (RLS). Persisting needs an elevated caller.
create or replace function public.tyre_cost_audit_scan(p_country text default null, p_from date default '2025-01-01', p_to date default current_date, p_dry_run boolean default true)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v jsonb;
begin
  if not public.app_is_elevated() and not public.is_super_admin() then
    raise exception 'Only Admin, Manager or Director can run the tyre cost audit' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'Invalid date range' using errcode = '22023'; end if;
  -- One statement: the classification is computed once, summarised, and (when not a dry run)
  -- saved. No temp table, so calling it twice in one transaction is safe.
  with c as materialized (select * from public.tyre_cost_audit_classify(p_country, p_from, p_to)),
  ins as (
    insert into public.tyre_cost_audit_findings (organisation_id, tyre_id, country, site, asset_no, serial_no, job_card, month, class,
      original_cost, proposed_cost, currency, item_code, source_line_id, confidence, reasons, dedupe_key)
    select public.app_current_org(), c.tyre_id, c.country, c.site, c.asset_no, c.serial_no, c.job_card, c.month, c.class,
      c.current_cost, c.proposed_cost, c.currency, c.item_code, c.source_line_id, c.confidence, jsonb_build_array(c.reason),
      c.tyre_id::text || '|' || c.class || '|' || coalesce(c.proposed_cost::text, '') || '|' || coalesce(c.source_line_id, '')
    from c where not p_dry_run and c.class not in ('priced_verified', 'priced_no_source')
    on conflict (organisation_id, dedupe_key) where status in ('proposed','approved') do nothing
    returning 1)
  select jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'from', p_from, 'to', p_to, 'country', p_country,
    'checked', (select count(*) from c),
    'by_country_class', (select coalesce(jsonb_agg(x), '[]') from (select country, class, count(*) n, sum(proposed_cost) proposed, min(currency) currency from c group by 1,2 order by 1,2) x),
    'new_findings', case when p_dry_run then null else (select count(*) from ins) end,
    'price_source_note', 'Prices come from ERP store-issue lines (parts_consumption). No invoice, GRN or PO records exist in the database.')
  into v;
  return v;
end $$;

create or replace function public.tyre_cost_audit_decide(p_ids uuid[], p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not (public.app_is_elevated() or public.is_super_admin()) then
    raise exception 'Only Admin, Manager or Director can decide a cost correction' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Decision must be approved or rejected' using errcode = '22023'; end if;
  if p_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then raise exception 'A rejection needs a reason' using errcode = '22023'; end if;
  update public.tyre_cost_audit_findings f set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where f.id = any(p_ids) and f.status = 'proposed'
    and (f.organisation_id = public.app_current_org() or public.is_super_admin())
    and public.app_can_see_country(f.country) is not false
    -- only actionable classes can be approved
    and (p_decision = 'rejected' or f.class in ('exact_match', 'same_month_item_match', 'priced_estimate_not_verified'));
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'decided', v_n, 'skipped', coalesce(array_length(p_ids, 1), 0) - v_n);
end $$;

-- Apply: one transaction, approved findings only, idempotent, km untouched, undoable.
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
    where f.id = any(p_ids) and f.status = 'approved'
      and (f.organisation_id = public.app_current_org() or public.is_super_admin())
      and (
        -- price proposals: the proposed price must equal the source line's own per-tyre price,
        -- the line must be a tyre-only line of the same item code, country and month.
        (f.class in ('exact_match', 'same_month_item_match') and exists (
          select 1 from public.parts_consumption p
          where p.id::text = f.source_line_id and p.country = f.country
            and p.qty_n > 0 and p.line_cost > 0
            and round(p.line_cost / p.qty_n, 2) = f.proposed_cost
            and to_char(p.event_date, 'YYYY-MM') = f.month
            and upper(regexp_replace(coalesce(p.item_code,''), '\s+', '', 'g')) = coalesce(f.item_code, '')
            and public.tyre_cost_line_kind(p.item_description) = 'tyre'))
        -- estimate revert: the stored price must still be the comparable-median fill
        or (f.class = 'priced_estimate_not_verified' and exists (
          select 1 from public.tyre_price_backfill_log l
          where l.tyre_id = f.tyre_id and l.source = 'comparable' and l.new_cost = f.original_cost)))
    for update),
  upd as (
    update public.tyre_records t
       set cost_per_tyre = case when d.class = 'priced_estimate_not_verified' then null else d.proposed_cost end
      from todo d
     where t.id = d.tyre_id
       -- only if the row still holds what the audit saw (no silent overwrite of a newer value)
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

revoke all on function public.tyre_cost_audit_classify(text, date, date) from public, anon;
revoke all on function public.tyre_cost_audit_scan(text, date, date, boolean) from public, anon;
revoke all on function public.tyre_cost_audit_decide(uuid[], text, text) from public, anon;
revoke all on function public.tyre_cost_audit_apply(uuid[]) from public, anon;
grant execute on function public.tyre_cost_line_kind(text) to authenticated, service_role;
grant execute on function public.tyre_cost_audit_classify(text, date, date) to authenticated, service_role;
grant execute on function public.tyre_cost_audit_scan(text, date, date, boolean) to authenticated, service_role;
grant execute on function public.tyre_cost_audit_decide(uuid[], text, text) to authenticated;
grant execute on function public.tyre_cost_audit_apply(uuid[]) to authenticated;

select anum_integration.apply_reader_policies();
