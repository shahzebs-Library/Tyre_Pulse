-- V388 / V388b. Two date-parsing bugs found on the customer's real 55,606 card
-- import. Both silently corrupted dates rather than failing, which is worse
-- than an error: the load looked successful.
--
-- V388 - A TWO-DIGIT YEAR WAS READ AS THE YEAR ITSELF.
-- The export mixes formats. `to_timestamp` with a YYYY pattern happily reads
-- '26' as year 0026, so 33,626 of 55,606 cards (60%) landed two thousand years
-- in the past:
--     yr 22: 1561   yr 23: 3028   yr 24: 5949   yr 25: 12105   yr 26: 10983
--     yr 2022: 1092  yr 2023: 1926  yr 2024: 3700  yr 2025: 7272  yr 2026: 7990
-- Every downtime average and the whole daily panel would have been computed
-- against dates in antiquity. Fixed with a pivot applied AFTER parsing rather
-- than more patterns: adding a DD-MM-YY pattern would also change how
-- four-digit years parse.
--
-- V388b - THE ISO CAST WAS READING AMBIGUOUS DATES MONTH-FIRST.
-- V381b put `s::timestamptz` first as a fast path for real ISO datetimes. But
-- DateStyle here is MDY, so that cast also accepts '07-09-2026' and returns
-- 9 JULY when the Ramco/GCC export means 7 SEPTEMBER. The day-first patterns
-- underneath were never reached for any date the cast could swallow - which is
-- every dd-mm-yyyy value with a day of 12 or less, 21,980 of the imported rows.
--
-- THIS IS A REPEAT. The codebase already fixed this exact class once in the JS
-- importer (`coerceDate`, ~39% of dates corrupted). It came back because the
-- cast looked like a harmless fast path. RULE: never hand a dd-mm-yyyy string
-- to a bare timestamptz cast.
--
-- The already-imported rows were NOT repaired in place. Both groups are
-- mechanically recoverable, but that means inferring the customer's source data
-- when the source file is right there and the pipe refreshes each card in place
-- on re-import. Re-uploading the same file is exact; inference is not.
create or replace function public.erp_parse_ts(t text)
returns timestamptz language plpgsql immutable parallel safe
set search_path to 'public' as $fn$
declare
  s text := btrim(coalesce(t, ''));
  v timestamptz;
begin
  if s = '' or upper(s) in ('NULL','N/A','-') then return null; end if;

  -- ISO only: yyyy-mm-dd... . Never let the cast see a dd-mm-yyyy string, or
  -- MDY DateStyle silently swaps day and month.
  if s ~ '^\d{4}-\d{2}-\d{2}' then
    begin return s::timestamptz; exception when others then null; end;
  end if;

  begin v := to_timestamp(s, 'DD-MM-YYYY HH24:MI:SS'); exception when others then v := null; end;
  if v is null then begin v := to_timestamp(s, 'DD/MM/YYYY HH24:MI:SS'); exception when others then v := null; end; end if;
  if v is null then begin v := to_timestamp(s, 'DD-MM-YYYY HH24:MI');    exception when others then v := null; end; end if;
  if v is null then begin v := to_timestamp(s, 'DD/MM/YYYY HH24:MI');    exception when others then v := null; end; end if;
  if v is null then begin v := to_timestamp(s, 'DD-Mon-YYYY HH24:MI');   exception when others then v := null; end; end if;
  if v is null then begin v := to_timestamp(s, 'DD-Mon-YY HH24:MI');     exception when others then v := null; end; end if;
  if v is null then begin v := to_timestamp(s, 'DD-MM-YYYY');            exception when others then v := null; end; end if;
  if v is null then begin v := to_timestamp(s, 'DD/MM/YYYY');            exception when others then v := null; end; end if;
  if v is null then begin v := public.erp_parse_date(s)::timestamptz;    exception when others then v := null; end; end if;
  if v is null then return null; end if;

  -- Two-digit year taken literally: '01-06-26' parses to year 26, not 2026.
  if extract(year from v) < 100 then
    v := v + make_interval(years => 2000);
  end if;
  return v;
end $fn$;

comment on function public.erp_parse_ts(text) is
  'Day-first timestamp parser for the ERP exports. Casts ONLY unambiguous ISO (yyyy-mm-dd...) - an unguarded cast reads dd-mm-yyyy month-first under MDY DateStyle. Pivots a two-digit year to 20xx.';

-- Verified after the fix:
--   erp_parse_ts('07-09-2026')        -> 2026-09-07   (7 Sep, not 9 Jul)
--   erp_parse_ts('01-06-26 06:00')    -> 2026-06-01
--   erp_parse_ts('2026-09-07T14:30Z') -> unchanged ISO
--   erp_parse_ts('junk')              -> null
