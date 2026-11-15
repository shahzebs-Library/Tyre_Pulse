-- ENG-5 and ENG-6: warranty misspellings, and tyre spend split by line kind.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE definition of
--         public.tyre_price_is_warranty(text) (SELECT only). The anchor occurs
--         exactly once on the live text.
--
-- ROUND 2 (2026-11-15): EXECUTED ON LOCAL STAGING ONLY (PostgreSQL 16, production
--         schema, synthetic companies; database tp_eng), in order with drafts
--         120000 to 125000. Proven by supabase/tests/staging/eng_round2_staging.mjs
--         and src/test/engGoldenSqlParity.test.js. Still NOT applied to production.
--
-- ENG-6 WHY. Two live KSA lines read "TIRE -WARRENTY -315/80 R 22.5". The
-- warranty rule matched none of the ERP's spellings, so a warranty replacement
-- could be priced from a comparable tyre instead of being a confirmed zero.
-- Adds whole words: warrenty, waranty, warenty, warrantie, gaurantee,
-- guaranty, free issue. JS mirror (already changed): src/lib/tyrePriceRules.js
-- WARRANTY_WORDS. Callers that inherit it: tyre_cost_line_kind,
-- expense_cost_status_lines, tyre_price_backfill.
--   Measured 2026-11-12: newly detected lines KSA 2 (amount 0.00, neither in
--   the tyre bucket), UAE 0, Egypt 0. No money moves.
--
-- ENG-5 WHY. The expense grid tyre bucket also holds repair, tube and
-- unrecognised lines. Measured read-only, all time, tyre_cost > 0:
--   KSA   tyre 12,340,600.20 SAR | other 19,500.00 (10 lines) | repair 7,200.00 (18) | tube 62.00 (1)
--   UAE   tyre  3,922,925.04 AED | other 83,580.00 (73 lines)
--   Egypt tyre 16,368,995.59 EGP | repair 148,339.49 (33 lines)
-- This draft does NOT re-bucket anything (that would change booked history).
-- It adds a read-only breakdown so a screen can show how much of "tyre spend"
-- is new tyres and how much is repairs or other lines.
-- JS mirror: src/lib/tyreCostAudit.js tyreSpendKind / splitTyreSpend.
--
-- RISK TO THE CURRENT COMPANY: low. One regex widens by seven whole words;
-- one new read-only function. No table data is touched.
--
-- VERIFY:
--   select public.tyre_price_is_warranty('TIRE -WARRENTY -315/80 R 22.5');   -- true
--   select public.tyre_price_is_warranty('TYRE 315/80 R22.5 FREE ISSUE');     -- true
--   select public.tyre_price_is_warranty('WARRANTYLESS TYRE 315/80R22.5');    -- false (whole words)
--   select public.get_tyre_spend_breakdown('KSA', null, null);  -- tyre 12,340,600.20, repair 7,200.00
--
-- ROLLBACK: re-run the definition saved in _bak.fn_defs_eng_20261113 where
--   fn = 'tyre_price_is_warranty'. The new function can be left unused; if it
--   must go, revoke execute on it from authenticated.
-- ---------------------------------------------------------------------------

create schema if not exists _bak;
create table if not exists _bak.fn_defs_eng_20261113 (
  fn text not null, captured_at timestamptz not null default now(), def text not null);

-- Replace an anchor that must occur exactly once. Anything else aborts the script.
create or replace function pg_temp.eng_replace_once(p_src text, p_anchor text, p_new text, p_what text)
returns text language plpgsql as $f$
declare n int := (length(p_src) - length(replace(p_src, p_anchor, ''))) / length(p_anchor);
begin
  if n <> 1 then
    raise exception 'ENG guard: anchor for % found % times, expected 1. Live definition has changed; re-author the draft.', p_what, n;
  end if;
  return replace(p_src, p_anchor, p_new);
end $f$;

do $eng$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.tyre_price_is_warranty(text)'::regprocedure);
  insert into _bak.fn_defs_eng_20261113 (fn, def) values ('tyre_price_is_warranty', v_def);

  v_def := pg_temp.eng_replace_once(v_def,
    '(warranty|warrantee|guarantee|free of charge|no charge|',
    '(warranty|warrantee|warrenty|waranty|warenty|warrantie|guarantee|gaurantee|guaranty|free of charge|free issue|no charge|',
    'tyre_price_is_warranty word list');

  execute v_def;
end $eng$;

-- Tyre bucket split by what the line actually is. Read only. Per country, never blended.
create or replace function public.get_tyre_spend_breakdown(p_country text, p_from date default null, p_to date default null)
returns jsonb
language sql stable security invoker set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'country', country, 'currency', currency, 'kind', kind,
           'lines', lines, 'amount', amount) order by country, amount desc), '[]'::jsonb)
  from (
    select pc.country, pc.currency,
           public.tyre_cost_line_kind(pc.item_description) as kind,
           count(*) as lines, round(sum(pc.tyre_cost), 2) as amount
      from public.parts_consumption pc
     where pc.tyre_cost > 0
       and (p_country is null or pc.country = p_country)
       and (p_from is null or pc.event_date >= p_from)
       and (p_to   is null or pc.event_date <= p_to)
     -- currency is a grouping key, never max(): two currencies in one country stay two rows
     group by pc.country, pc.currency, public.tyre_cost_line_kind(pc.item_description)
  ) s
$function$;

revoke all on function public.get_tyre_spend_breakdown(text, date, date) from public;
revoke all on function public.get_tyre_spend_breakdown(text, date, date) from anon;
grant execute on function public.get_tyre_spend_breakdown(text, date, date) to authenticated, service_role;
