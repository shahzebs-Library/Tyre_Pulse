-- V378 - cost variance decomposition
--
-- Answers "why did this cost change" with arithmetic that closes. Everything
-- this returns is a signed contribution to one number: the change in spend
-- between the chosen window and the window immediately before it. The parts add
-- up to the whole, exactly, or the caller is told what is missing.
--
-- WHY A SECOND RPC AND NOT AN EXTENSION OF get_cost_cpk_overview (V374):
--   1. V374's _cost_dim orders members by CURRENT spend and takes the top 25.
--      That is right for "where does the money go" and wrong for "what moved" -
--      a cost line that stopped has zero current spend and sorts last, so the
--      single biggest explanation of a fall can fall off the list entirely.
--      Every dimension here is ordered by the ABSOLUTE SIZE OF THE SWING.
--   2. V374 returns no quantity and no unit price, so nothing downstream can
--      tell a price rise from a volume rise. That distinction is the whole
--      reason this exists: 216,790 of 216,792 rows carry both qty_n and
--      unit_cost, so it is answerable, and the answer changes what a manager
--      does about it.
--
-- THE PRICE / VOLUME METHOD IS BENNET (SYMMETRIC), DELIBERATELY.
--   The textbook split, volume = dq*p0 and price = q0*dp, leaves an interaction
--   term dq*dp that nobody can act on. Measured on the real KSA first half of
--   2026 that leftover was -526,245 SAR, larger than either named effect, so
--   the "explanation" was mostly a rounding bucket. Bennet weights each effect
--   by the average of the two periods:
--       volume = (q1 - q0) * (p0 + p1)/2
--       price  = (p1 - p0) * (q0 + q1)/2
--   which sums to exactly q1*p1 - q0*p0 with NO third term. Same data, same
--   total, no residual: volume -394,493 and price -129,349.
--
-- PRICE IS ONLY MEANINGFUL WITHIN ONE ITEM CODE. Unit prices are per item and
-- the units are not comparable across items (a tyre, a litre of oil, a metre of
-- hose). So the split is computed per item code and then summed. Items that
-- appear in only one window have no pair of prices to compare and are reported
-- as their own terms - new lines and stopped lines - never folded into price or
-- volume, which would invent a price change that did not happen.
--
-- ITEM CODES ARE NOT GLOBALLY UNIQUE (V367): 450115-O is COMPRESSOR OIL 68 in
-- KSA and GREASE MISC ITEMS in UAE. Every query here is already inside one
-- country, either because the caller named one or because the org only has one.
-- When the scope covers more than one country this returns NO MONEY AT ALL
-- rather than a blended figure, so a SAR + AED + EGP total cannot be rendered
-- even by mistake. That defect has been patched at reader sites four times in
-- this system's history; here it is structural.

create or replace function public._cost_var_dim(
  p_org uuid, p_country text, p_site text,
  p_cf date, p_ct date, p_pf date, p_pt date,
  p_dim text, p_limit int)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare result jsonb; v_sql text;
begin
  -- p_dim never comes from a user: the caller passes one of this fixed set and
  -- anything else returns empty rather than reaching format().
  if p_dim not in ('site','cost_center','asset_type','asset_code','item_description','store_code') then
    return '{"rows":[],"tail":null}'::jsonb;
  end if;

  v_sql := format($f$
    with g as (
      select coalesce(nullif(btrim(%1$I::text),''),'Unspecified') label,
             coalesce(sum(line_cost) filter (where event_date between $4 and $5),0) cur,
             coalesce(sum(line_cost) filter (where event_date between $6 and $7),0) prev,
             count(*) filter (where event_date between $4 and $5) lines
        from public.parts_consumption
       where organisation_id = $1
         and ($2 is null or country = $2)
         and ($3 is null or site = $3)
         and (event_date between $4 and $5 or event_date between $6 and $7)
       group by 1),
    -- rank by the size of the swing, not by spend, so a line that stopped is
    -- as visible as a line that started
    r as (select g.*, (cur - prev) d,
                 row_number() over (order by abs(cur - prev) desc, label) rn
            from g where cur <> prev)
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
                 'label', label, 'current', round(cur,2), 'previous', round(prev,2),
                 'delta', round(d,2), 'lines', lines) order by rn)
               from r where rn <= $8), '[]'::jsonb),
      -- everything past the cut, kept as one signed figure so the column still
      -- adds up to the total change instead of quietly losing the tail
      'tail', (select jsonb_build_object(
                 'count', count(*), 'current', round(coalesce(sum(cur),0),2),
                 'previous', round(coalesce(sum(prev),0),2),
                 'delta', round(coalesce(sum(d),0),2))
                 from r where rn > $8),
      -- members that did not move at all: excluded from rows, still part of the
      -- level, contribute exactly nothing to the change
      'unchanged', (select count(*) from g where cur = prev))
  $f$, p_dim);

  execute v_sql into result
    using p_org, p_country, p_site, p_cf, p_ct, p_pf, p_pt, p_limit;
  return coalesce(result, '{"rows":[],"tail":null}'::jsonb);
end $function$;

comment on function public._cost_var_dim(uuid,text,text,date,date,date,date,text,int) is
  'V378 helper. One dimension ranked by absolute change, with the tail kept as a signed total so contributions close.';


create or replace function public.get_cost_variance(
  p_country text default null,
  p_site    text default null,
  p_from    date default null,
  p_to      date default null,
  p_limit   int  default 25)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_org   uuid := public.app_current_org();
  v_to    date := coalesce(p_to, current_date);
  v_from  date := coalesce(p_from, coalesce(p_to, current_date) - 364);
  v_len   int;
  v_pf date; v_pt date;
  v_cur text; v_countries int;
  v_lim int := least(greatest(coalesce(p_limit, 25), 5), 100);
  result jsonb;
begin
  if v_org is null or not public.app_is_active() then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;

  -- the previous window is the same number of days ending the day before this
  -- one. Identical arithmetic to get_cost_cpk_overview: if the two ever drift
  -- the page shows two different "previous" figures for the same question.
  v_len := (v_to - v_from) + 1;
  v_pt  := v_from - 1;
  v_pf  := v_pt - (v_len - 1);

  select count(distinct country) into v_countries
    from public.parts_consumption
   where organisation_id = v_org and (p_country is null or country = p_country);

  v_cur := case when p_country is null and v_countries > 1 then null
                else public.currency_for_country(coalesce(p_country,
                  (select country from public.parts_consumption
                    where organisation_id = v_org limit 1))) end;

  -- More than one currency in scope. Return the shape but none of the money:
  -- there is no honest single number to decompose, and an item code means
  -- different things in different countries.
  if v_cur is null then
    return jsonb_build_object(
      'ok', true, 'blended', true, 'currency', null,
      'country', p_country, 'site', p_site,
      'generated_at', now(),
      'windows', jsonb_build_object(
        'current',  jsonb_build_object('from', v_from, 'to', v_to),
        'previous', jsonb_build_object('from', v_pf,  'to', v_pt),
        'days', v_len),
      'totals', null, 'effects', null, 'items', '[]'::jsonb,
      'items_tail', null, 'dims', '{}'::jsonb,
      'reason', 'Spend spans more than one currency. Choose a country to decompose the change.');
  end if;

  with base as (
    select coalesce(nullif(btrim(item_code),''),'(no item code)') code,
           event_date, qty_n, line_cost, unit_cost,
           item_description, tyre_cost, spare_cost, oil_cost,
           -- a line can only join the price/volume split if it carries both a
           -- real quantity and a unit cost. 2 rows in 216,792 do not.
           (qty_n > 0 and unit_cost is not null) usable
      from public.parts_consumption
     where organisation_id = v_org
       and (p_country is null or country = p_country)
       and (p_site is null or site = p_site)
       and (event_date between v_from and v_to or event_date between v_pf and v_pt)
  ),
  agg as (
    select code,
      -- longest description wins as the label: the ERP repeats an item under
      -- several truncations of the same name
      (array_agg(item_description order by length(coalesce(item_description,'')) desc))[1] label,
      sum(qty_n)     filter (where event_date between v_from and v_to and usable) q1,
      sum(line_cost) filter (where event_date between v_from and v_to and usable) s1,
      sum(qty_n)     filter (where event_date between v_pf  and v_pt and usable) q0,
      sum(line_cost) filter (where event_date between v_pf  and v_pt and usable) s0,
      sum(line_cost) filter (where event_date between v_from and v_to and not usable) x1,
      sum(line_cost) filter (where event_date between v_pf  and v_pt and not usable) x0,
      count(*)       filter (where event_date between v_from and v_to) lines1,
      count(*)       filter (where event_date between v_pf  and v_pt) lines0,
      -- bucket is characterised over BOTH windows, not just the current one:
      -- a stopped item has no current spend and would otherwise come back with
      -- no bucket at all, which is exactly the row a reader most wants labelled
      sum(tyre_cost) tc, sum(spare_cost) sc, sum(oil_cost) oc
      from base group by code
  ),
  calc as (
    select a.*,
      coalesce(q0,0) qq0, coalesce(q1,0) qq1,
      coalesce(s0,0) ss0, coalesce(s1,0) ss1,
      coalesce(x0,0) xx0, coalesce(x1,0) xx1,
      case when coalesce(q0,0) > 0 then s0/q0 end p0,
      case when coalesce(q1,0) > 0 then s1/q1 end p1,
      (coalesce(q0,0) > 0 and coalesce(q1,0) > 0) in_both
      from agg a
  ),
  eff as (
    select c.*,
      -- Bennet: each effect weighted by the average of the two periods, so the
      -- two of them sum to the change with nothing left over
      case when in_both then (qq1 - qq0) * ((p0 + p1) / 2) else 0 end vol_e,
      case when in_both then (p1 - p0) * ((qq0 + qq1) / 2) else 0 end price_e,
      case when not in_both and qq0 = 0 and qq1 > 0 then ss1 else 0 end new_e,
      case when not in_both and qq1 = 0 and qq0 > 0 then -ss0 else 0 end stop_e,
      (xx1 - xx0) undec_e,
      (ss1 + xx1) - (ss0 + xx0) delta
      from calc c
  ),
  ranked as (
    select e.*, row_number() over (order by abs(delta) desc, code) rn
      from eff e where delta <> 0
  )
  select jsonb_build_object(
    'ok', true,
    'blended', false,
    'currency', v_cur,
    'country', p_country,
    'site', p_site,
    'generated_at', now(),
    'limit', v_lim,
    'windows', jsonb_build_object(
      'current',  jsonb_build_object('from', v_from, 'to', v_to),
      'previous', jsonb_build_object('from', v_pf,  'to', v_pt),
      'days', v_len),

    'totals', jsonb_build_object(
      'current',  round(coalesce(sum(ss1 + xx1), 0), 2),
      'previous', round(coalesce(sum(ss0 + xx0), 0), 2),
      'delta',    round(coalesce(sum(delta), 0), 2),
      'lines_current',  coalesce(sum(lines1), 0),
      'lines_previous', coalesce(sum(lines0), 0)),

    -- these five add up to totals.delta, exactly, by construction
    'effects', jsonb_build_object(
      'price',            round(coalesce(sum(price_e), 0), 2),
      'volume',           round(coalesce(sum(vol_e), 0), 2),
      'new_items',        round(coalesce(sum(new_e), 0), 2),
      'stopped_items',    round(coalesce(sum(stop_e), 0), 2),
      'not_decomposable', round(coalesce(sum(undec_e), 0), 2),
      'items_both',    count(*) filter (where in_both),
      'items_new',     count(*) filter (where not in_both and qq0 = 0 and qq1 > 0),
      'items_stopped', count(*) filter (where not in_both and qq1 = 0 and qq0 > 0),
      'spend_priced_current',  round(coalesce(sum(ss1), 0), 2),
      'spend_priced_previous', round(coalesce(sum(ss0), 0), 2)),

    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'code', code, 'label', coalesce(label, code),
        'qty_previous', round(qq0, 3), 'qty_current', round(qq1, 3),
        'spend_previous', round(ss0 + xx0, 2), 'spend_current', round(ss1 + xx1, 2),
        'price_previous', round(p0, 4), 'price_current', round(p1, 4),
        'price_effect', round(price_e, 2), 'volume_effect', round(vol_e, 2),
        'delta', round(delta, 2),
        'lines_current', lines1, 'lines_previous', lines0,
        'kind', case when in_both then 'both'
                     when qq0 = 0 and qq1 > 0 then 'new'
                     when qq1 = 0 and qq0 > 0 then 'stopped'
                     else 'unpriced' end,
        'bucket', case when coalesce(tc,0) >= greatest(coalesce(sc,0), coalesce(oc,0)) and coalesce(tc,0) > 0 then 'tyre'
                       when coalesce(oc,0) >= coalesce(sc,0) and coalesce(oc,0) > 0 then 'oil'
                       when coalesce(sc,0) > 0 then 'spare' end)
        order by rn) from ranked where rn <= v_lim), '[]'::jsonb),

    'items_tail', (select jsonb_build_object(
        'count', count(*), 'delta', round(coalesce(sum(delta), 0), 2),
        'price_effect', round(coalesce(sum(price_e), 0), 2),
        'volume_effect', round(coalesce(sum(vol_e), 0), 2))
        from ranked where rn > v_lim),

    'dims', jsonb_build_object(
      'by_site',        public._cost_var_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, 'site', v_lim),
      'by_cost_center', public._cost_var_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, 'cost_center', v_lim),
      'by_asset_type',  public._cost_var_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, 'asset_type', v_lim),
      'by_asset',       public._cost_var_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, 'asset_code', v_lim),
      'by_item',        public._cost_var_dim(v_org, p_country, p_site, v_from, v_to, v_pf, v_pt, 'item_description', v_lim))
  ) into result
  from eff;

  return result;
end $function$;

comment on function public.get_cost_variance(text,text,date,date,int) is
  'V378. Decomposes the change in parts spend between a window and the window before it into price, volume, new lines, stopped lines and an undecomposable remainder that sum exactly to the total change, plus every dimension ranked by size of swing. Returns no money when the scope spans more than one currency.';

revoke all on function public._cost_var_dim(uuid,text,text,date,date,date,date,text,int) from public, anon;
revoke all on function public.get_cost_variance(text,text,date,date,int) from public, anon;
grant execute on function public._cost_var_dim(uuid,text,text,date,date,date,date,text,int) to authenticated;
grant execute on function public.get_cost_variance(text,text,date,date,int) to authenticated;
