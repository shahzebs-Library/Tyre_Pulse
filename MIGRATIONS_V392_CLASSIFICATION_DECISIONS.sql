-- V392: what the system MOVED and what it KEPT, in one place, from the user's own data.
--
-- The ERP file carries its own three-way split per line (Spare / Trye / Oil).
-- Those raw columns are preserved verbatim on parts_consumption, and the app
-- deliberately does NOT trust them: the category is decided by the ITEM, so a
-- real tyre the ERP filed under Spare lands in tyre, and a gearbox the ERP
-- dumped in the Trye column is moved out. That rule is correct and is why the
-- V390 gearbox was findable at all - but every one of those decisions has been
-- INVISIBLE. Nobody could see what the system changed about their own file.
--
-- Three honest groups:
--   moved      the ERP put it in one bucket, we put it in another
--   kept       we agreed with the ERP
--   unlabelled the ERP left all three columns blank, so there was nothing to
--              agree or disagree WITH and the decision is ours alone
--
-- Grouped by (country, item code, what the ERP said, what we said) because that
-- is one movement FACT, and because the item code is the unit the override
-- actually keys on. A code whose lines are partly moved and partly kept
-- correctly appears in both - collapsing it would hide the inconsistency.
--
-- Value stays in the row's own currency and is NEVER summed across countries.
--
-- MEASURED ON LIVE DATA AT BUILD TIME (reconciles exactly to the country
-- totals, moved + kept + unlabelled = total):
--   Egypt  1,368 moved / EGP 3,511,287.57   35,687 kept   5,476 unlabelled
--   KSA    1,961 moved / SAR   937,093.44   68,386 kept  36,299 unlabelled
--   UAE      579 moved / AED    28,199.98   67,035 kept       1 unlabelled
--
-- APPLIED LIVE 2026-07-27 as v392_classification_decisions, then v392b (single
-- statement, see below), v392c (stored erp_bucket) and v392d (read it).
-- Surfaces: src/lib/api/classificationDecisions.js,
-- src/console/pages/importHistory/DecisionsPanel.jsx.

-- ── V392c: store what the ERP FILE itself said ───────────────────────────────
-- MEASURED, not assumed. Scanning the table is 158 ms; ONE _to_num() call over
-- the same rows is 1,943 ms, and this view needs three of them. The whole 4.2 s
-- was function-call overhead on text that never changes after import, which is
-- the definition of something that should be computed once. 4,245 ms -> 508 ms.
--
-- A STORED generated column is the right shape: it cannot drift from the three
-- raw columns it derives from, no trigger can forget to set it, and the existing
-- safeguards already exclude generated columns (admin_dup_restore and
-- admin_db_revert_change build explicit column lists, _admin_editable_cols
-- refuses them). Verified first that all three functions inserting into this
-- table use an explicit column list, so a new column cannot break a positional
-- insert - the V320 lesson. Verified after: 0 disagreements with the live
-- derivation across all 216,792 rows.
--
-- NOTE: a generated column freezes the _to_num definition in place. If that
-- function's parsing ever changes, this column must be rebuilt deliberately.
--
-- A blank stays NULL, not 'spare': the ERP not stating a bucket is not the same
-- as the ERP saying spare, and collapsing the two would invent an agreement.
alter table public.parts_consumption
  add column if not exists erp_bucket text
  generated always as (
    case when coalesce(public._to_num(tyre_amount), 0)        > 0 then 'tyre'
         when coalesce(public._to_num(oil_amount), 0)         > 0 then 'oil'
         when coalesce(public._to_num(spare_parts_amount), 0) > 0 then 'spare'
    end
  ) stored;

comment on column public.parts_consumption.erp_bucket is
  'What the ERP export itself filed this line under, from its own Spare/Trye/Oil columns. NULL means the file stated nothing. Our decision is cost_category - the two disagreeing is the subject of get_classification_decisions.';

-- ── the view itself ──────────────────────────────────────────────────────────
-- A STABLE function may not create a temp table, so this is one statement. A
-- CTE referenced twice is materialised once by the planner, so the scan still
-- happens only once. Ordering is carried by an explicit rank rather than by
-- sorting the built jsonb: ordering json text would put 9 above 1,000,000.
create or replace function public.get_classification_decisions(
  p_country text default null,
  p_from    date default null,
  p_to      date default null,
  p_view    text default 'moved',
  p_search  text default null,
  p_limit   integer default 200)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $fn$
declare
  v_org   uuid := public.app_current_org();
  v_ctry  text := nullif(btrim(coalesce(p_country, '')), '');
  v_view  text := lower(coalesce(nullif(btrim(p_view), ''), 'moved'));
  v_q     text := nullif(btrim(coalesce(p_search, '')), '');
  v_lim   integer := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_out   jsonb;
begin
  if not public.app_is_elevated() then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if v_ctry ilike 'all' then v_ctry := null; end if;
  if v_view not in ('moved', 'kept', 'unlabelled', 'all') then v_view := 'moved'; end if;

  with base as materialized (
    select
      pc.country, pc.item_code, pc.item_description, pc.line_cost, pc.currency,
      pc.classified_by, pc.classify_confidence,
      case when pc.tyre_cost > 0 then 'tyre'
           when pc.oil_cost  > 0 then 'oil'
           else 'spare' end as ours,
      pc.erp_bucket as erp          -- NULL = the file stated nothing
    from public.parts_consumption pc
    where pc.organisation_id = v_org
      and (v_ctry is null or pc.country = v_ctry)
      and (p_from is null or pc.event_date >= p_from)
      and (p_to   is null or pc.event_date <= p_to)
  ),
  -- Over the WHOLE window, never only the rows the search box left behind, so
  -- the headline cannot quietly describe a different set than it claims to.
  per_country as (
    select country,
      max(currency) as currency,
      count(*) filter (where erp is not null and erp <> ours) as moved_rows,
      round(coalesce(sum(line_cost) filter (where erp is not null and erp <> ours), 0), 2) as moved_value,
      count(*) filter (where erp is not null and erp = ours) as kept_rows,
      round(coalesce(sum(line_cost) filter (where erp is not null and erp = ours), 0), 2) as kept_value,
      count(*) filter (where erp is null) as unlabelled_rows,
      round(coalesce(sum(line_cost) filter (where erp is null), 0), 2) as unlabelled_value,
      count(*) as total_rows,
      round(coalesce(sum(line_cost), 0), 2) as total_value
    from base group by country
  ),
  grouped as (
    select b.country, b.item_code, b.erp, b.ours,
      max(b.item_description) as item_name,
      mode() within group (order by b.classified_by) as decided_by,
      -- the WEAKEST evidence in the group: a code decided partly by the
      -- fallback is exactly what should be reviewed first
      min(b.classify_confidence) as confidence,
      count(*) as rows_n,
      round(sum(b.line_cost), 2) as value_n,
      max(b.currency) as currency
    from base b
    where (v_view = 'all'
           or (v_view = 'moved'      and b.erp is not null and b.erp <> b.ours)
           or (v_view = 'kept'       and b.erp is not null and b.erp =  b.ours)
           or (v_view = 'unlabelled' and b.erp is null))
      and (v_q is null
           or b.item_code ilike '%' || v_q || '%'
           or b.item_description ilike '%' || v_q || '%')
    group by b.country, b.item_code, b.erp, b.ours
    order by abs(sum(b.line_cost)) desc
    limit v_lim
  ),
  ranked as (
    select g.*, row_number() over (order by abs(g.value_n) desc) as rn,
           coalesce(mm.reviewed, false) as reviewed,
           case when mm.reviewed then mm.category end as reviewed_category
    from grouped g
    left join public.material_master mm
      on mm.organisation_id = v_org and mm.country = g.country and mm.item_code = g.item_code
  )
  select jsonb_build_object(
    'ok', true,
    'view', v_view,
    'countries', coalesce((select jsonb_agg(jsonb_build_object(
        'country', country, 'currency', currency,
        'moved_rows', moved_rows, 'moved_value', moved_value,
        'kept_rows', kept_rows, 'kept_value', kept_value,
        'unlabelled_rows', unlabelled_rows, 'unlabelled_value', unlabelled_value,
        'total_rows', total_rows, 'total_value', total_value
      ) order by country) from per_country), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'country', country, 'item_code', item_code, 'item_name', item_name,
        'erp_said', coalesce(erp, 'not stated'), 'we_said', ours,
        'movement', case when erp is null then 'unlabelled'
                         when erp = ours then 'kept' else 'moved' end,
        'decided_by', decided_by, 'confidence', confidence,
        'rows', rows_n, 'value', value_n, 'currency', currency,
        'reviewed', reviewed, 'reviewed_category', reviewed_category
      ) order by rn) from ranked), '[]'::jsonb),
    'limit', v_lim
  ) into v_out;

  return v_out;
end $fn$;

revoke all on function public.get_classification_decisions(text, date, date, text, text, integer) from public, anon;
grant execute on function public.get_classification_decisions(text, date, date, text, text, integer) to authenticated;

comment on function public.get_classification_decisions(text, date, date, text, text, integer) is
  'What the classifier MOVED vs KEPT against the ERP file''s own Spare/Trye/Oil split, grouped by item code so the result can be acted on. Elevated only, org from the session, value never blended across currencies.';
