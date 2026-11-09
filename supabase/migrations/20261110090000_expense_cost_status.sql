-- 20261110090000 - Cost status for every expense line (parts_consumption), read only.
--
-- Phase 2 (expense and ERP financial reconciliation). The expense grid is the money
-- source of truth (rule T9). This gives every line ONE purchase-cost status, the
-- expense-line twin of the tyre status T17:
--   ACTUAL          the ERP sent an amount (Values, Total, or a bucket column).
--                   A negative amount (refund / return) is ACTUAL and flagged is_credit.
--   ESTIMATED       the ERP sent nothing and parts_cost_fill (V517) priced the line from
--                   the median of the same item code (filled_cost).
--   CONFIRMED_ZERO  zero amount on a warranty / free-of-charge line (evidenced by the
--                   description, parts_cost_is_warranty OR tyre_price_is_warranty).
--   MISSING         zero amount, no estimate, not warranty.
--   DISPUTED        a person must decide, the line is NOT safe to sum blindly:
--                   * cross_load_copy - the same content (every ERP field except the
--                     line number "#") already arrived in an EARLIER upload at least as
--                     many times. Overlapping date-range exports renumber "#", so
--                     import_uid (keyed on "#") does not catch them. The earliest
--                     arrival stays ACTUAL; only the later copies are DISPUTED.
--                   * conflicting_revision - same ERP line ("#") and same business key
--                     uploaded more than once with DIFFERENT values (a zero line later
--                     re-sent with a price). Every row of the group is DISPUTED.
-- Precedence: DISPUTED > CONFIRMED_ZERO > ESTIMATED > MISSING > ACTUAL.
--
-- An "upload" is the hour the row arrived (date_trunc('hour', created_at)): one upload
-- is written within minutes, separate uploads hours or days apart (measured).
-- Both duplicate keys include txn_date, so every member of a group shares event_date;
-- filtering by country / date BEFORE grouping is therefore exact.
--
-- ADDITIVE ONLY: two new SECURITY INVOKER functions. No table, trigger or existing
-- function changes; RLS of parts_consumption applies to the caller. Totals elsewhere
-- are unchanged; screens show this split BESIDE them.
--
-- DRY RUN 2026-11-09 (all dates; functions created, checked, rolled back by the final RAISE):
--   KSA   SAR: 119,725 lines 43,279,081.37 = ACTUAL 116,463 / 42,878,377.32 + ESTIMATED 1,066 / 31,972.98
--         + CONFIRMED_ZERO 2 / 0 + MISSING 106 / 0 + DISPUTED 2,088 / 368,731.07
--         (cross_load_copy 2,037 / 346,786.07, conflicting_revision 51 / 21,945.00)
--   UAE   AED: 60,020 lines 15,054,215.58 = ACTUAL 60,019 / 15,053,615.58 + ESTIMATED 1 / 600.00
--   Egypt EGP: 40,680 lines 81,747,668.44 = ACTUAL 40,550 / 81,162,280.73 + ESTIMATED 1 / 12.00
--         + DISPUTED 129 / 585,375.71 (all cross_load_copy)
--   Status totals equal the grid totals to the cent. anon EXECUTE = false.
--   As the KSA-only Manager: KSA 2026 YTD summary 1.4 s, only KSA returned; UAE asked -> empty.
--   All countries all dates (super scope) 10.7 s - the Data Reconciliation panel runs it on demand.
--
-- ROLLBACK:
--   drop function if exists public.get_expense_cost_status_summary(text, date, date);
--   drop function if exists public.expense_cost_status_lines(text, date, date, text, integer);

create or replace function public.expense_cost_status_lines(
  p_country text default null,
  p_from date default null,
  p_to date default null,
  p_status text default null,
  p_limit integer default null
)
returns table (
  id uuid,
  country text,
  currency text,
  event_date date,
  issue_number text,
  work_order_no text,
  asset_code text,
  store_code text,
  site text,
  item_code text,
  item_description text,
  qty numeric,
  cost_category text,
  erp_amount numeric,
  filled_cost numeric,
  line_cost numeric,
  cost_status text,
  dispute_reason text,
  is_credit boolean,
  is_repair boolean,
  is_retread boolean,
  is_multi_qty boolean,
  loaded_at timestamptz
)
language sql
stable
security invoker
set search_path = public
set plan_cache_mode = force_custom_plan
as $f$
  with base as (
    select p.*,
           date_trunc('hour', p.created_at) as load_at,
           coalesce(btrim(p.source_row), '') as src,
           md5(concat_ws('|', p.country, p.issue_number, p.work_order_no, p.txn_date, p.asset_code,
                         p.store_code, p.cost_center, p.item_code, p.qty, p.item_description,
                         p.value_amount, p.spare_parts_amount, p.tyre_amount, p.oil_amount,
                         p.total_amount)) as ck,
           md5(concat_ws('|', p.country, p.issue_number, p.work_order_no, p.txn_date, p.asset_code,
                         p.store_code, p.cost_center, p.item_code, p.qty, p.item_description)) as rk,
           coalesce(nullif(public._to_num(p.value_amount), 0), nullif(public._to_num(p.total_amount), 0),
                    nullif(greatest(coalesce(public._to_num(p.spare_parts_amount), 0),
                                    coalesce(public._to_num(p.tyre_amount), 0),
                                    coalesce(public._to_num(p.oil_amount), 0)), 0),
                    nullif(least(coalesce(public._to_num(p.spare_parts_amount), 0),
                                 coalesce(public._to_num(p.tyre_amount), 0),
                                 coalesce(public._to_num(p.oil_amount), 0)), 0)) as erp_amt
      from public.parts_consumption p
     where (p_country is null or p_country = 'All' or p.country = p_country)
       and (p_from is null or p.event_date >= p_from)
       and (p_to is null or p.event_date <= p_to)
  ),
  per_load as (
    select ck, load_at, count(*) as c
      from base group by ck, load_at
  ),
  prior as (
    select ck, load_at,
           coalesce(max(c) over (partition by ck order by load_at
                                 rows between unbounded preceding and 1 preceding), 0) as prior_max
      from per_load
  ),
  revisions as (
    select rk, src
      from base
     where src <> ''
     group by rk, src
    having count(distinct coalesce(value_amount, '')) > 1
        or count(distinct coalesce(tyre_amount, '') || '|' || coalesce(total_amount, '')) > 1
  ),
  marked as (
    select b.*,
           row_number() over (partition by b.ck, b.load_at order by b.id) as rn_in_load,
           pr.prior_max,
           (rv.rk is not null) as is_revision
      from base b
      join prior pr on pr.ck = b.ck and pr.load_at = b.load_at
      left join revisions rv on rv.rk = b.rk and rv.src = b.src
  ),
  classed as (
    select m.*,
           case
             when m.is_revision then 'conflicting_revision'
             when m.rn_in_load <= m.prior_max then 'cross_load_copy'
           end as dispute
      from marked m
  )
  select c.id, c.country, coalesce(c.currency, public.currency_for_country(c.country)),
         c.event_date, c.issue_number, c.work_order_no, c.asset_code, c.store_code, c.site,
         c.item_code, c.item_description, c.qty_n, c.cost_category,
         c.erp_amt, c.filled_cost, coalesce(c.line_cost, 0),
         case
           when c.dispute is not null then 'DISPUTED'
           when coalesce(c.line_cost, 0) = 0
                and (public.parts_cost_is_warranty(c.item_description)
                     or public.tyre_price_is_warranty(c.item_description)) then 'CONFIRMED_ZERO'
           when c.erp_amt is null and c.filled_cost is not null and c.filled_cost > 0 then 'ESTIMATED'
           when coalesce(c.line_cost, 0) = 0 then 'MISSING'
           else 'ACTUAL'
         end,
         c.dispute,
         coalesce(c.line_cost, 0) < 0,
         public.tyre_price_is_repair(c.item_description),
         coalesce(c.item_description, '') ~* '\m(retread|re-tread|recap|remould)',
         coalesce(c.qty_n, 0) > 1,
         c.created_at
    from classed c
   where p_status is null
      or p_status = case
           when c.dispute is not null then 'DISPUTED'
           when coalesce(c.line_cost, 0) = 0
                and (public.parts_cost_is_warranty(c.item_description)
                     or public.tyre_price_is_warranty(c.item_description)) then 'CONFIRMED_ZERO'
           when c.erp_amt is null and c.filled_cost is not null and c.filled_cost > 0 then 'ESTIMATED'
           when coalesce(c.line_cost, 0) = 0 then 'MISSING'
           else 'ACTUAL'
         end
   order by c.event_date desc nulls last, c.id
   limit case when p_limit is null or p_limit <= 0 then null else least(p_limit, 5000) end
$f$;

comment on function public.expense_cost_status_lines(text, date, date, text, integer) is
  'Phase 2 (20261110090000): one cost status per expense line - ACTUAL / ESTIMATED / CONFIRMED_ZERO / MISSING / DISPUTED. Read only; RLS applies.';

create or replace function public.get_expense_cost_status_summary(
  p_country text default null,
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
set plan_cache_mode = force_custom_plan
as $f$
  with l as (
    select * from public.expense_cost_status_lines(p_country, p_from, p_to, null, null)
  ),
  by_status as (
    select country, currency, cost_status,
           count(*) as lines,
           round(sum(line_cost), 2) as amount,
           count(*) filter (where cost_category = 'tyre') as tyre_lines,
           round(sum(line_cost) filter (where cost_category = 'tyre'), 2) as tyre_amount
      from l group by 1, 2, 3
  ),
  per_country as (
    select country, currency,
           count(*) as lines,
           round(sum(line_cost), 2) as total,
           count(*) filter (where is_credit) as credit_lines,
           round(sum(line_cost) filter (where is_credit), 2) as credit_amount,
           count(*) filter (where is_repair) as repair_lines,
           round(sum(line_cost) filter (where is_repair), 2) as repair_amount,
           count(*) filter (where is_retread) as retread_lines,
           round(sum(line_cost) filter (where is_retread), 2) as retread_amount,
           count(*) filter (where is_multi_qty) as multi_qty_lines,
           count(*) filter (where dispute_reason = 'cross_load_copy') as copy_lines,
           round(sum(line_cost) filter (where dispute_reason = 'cross_load_copy'), 2) as copy_amount,
           count(*) filter (where dispute_reason = 'conflicting_revision') as revision_lines,
           round(sum(line_cost) filter (where dispute_reason = 'conflicting_revision'), 2) as revision_amount
      from l group by 1, 2
  )
  select jsonb_build_object(
    'ok', true,
    'country', coalesce(p_country, 'All'),
    'from', p_from,
    'to', p_to,
    'countries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'country', c.country, 'currency', c.currency,
               'lines', c.lines, 'total', c.total,
               'credit', jsonb_build_object('lines', c.credit_lines, 'amount', coalesce(c.credit_amount, 0)),
               'repair', jsonb_build_object('lines', c.repair_lines, 'amount', coalesce(c.repair_amount, 0)),
               'retread', jsonb_build_object('lines', c.retread_lines, 'amount', coalesce(c.retread_amount, 0)),
               'multi_qty_lines', c.multi_qty_lines,
               'disputed', jsonb_build_object(
                  'cross_load_copy', jsonb_build_object('lines', c.copy_lines, 'amount', coalesce(c.copy_amount, 0)),
                  'conflicting_revision', jsonb_build_object('lines', c.revision_lines, 'amount', coalesce(c.revision_amount, 0))),
               'statuses', coalesce((
                  select jsonb_object_agg(s.cost_status, jsonb_build_object(
                           'lines', s.lines, 'amount', coalesce(s.amount, 0),
                           'tyre_lines', s.tyre_lines, 'tyre_amount', coalesce(s.tyre_amount, 0)))
                    from by_status s where s.country is not distinct from c.country), '{}'::jsonb))
             order by c.country)
        from per_country c), '[]'::jsonb)
  )
$f$;

comment on function public.get_expense_cost_status_summary(text, date, date) is
  'Phase 2 (20261110090000): per country (own currency, never blended) lines and amount by expense cost status. Read only.';

revoke all on function public.expense_cost_status_lines(text, date, date, text, integer) from public, anon;
revoke all on function public.get_expense_cost_status_summary(text, date, date) from public, anon;
grant execute on function public.expense_cost_status_lines(text, date, date, text, integer) to authenticated;
grant execute on function public.get_expense_cost_status_summary(text, date, date) to authenticated;
