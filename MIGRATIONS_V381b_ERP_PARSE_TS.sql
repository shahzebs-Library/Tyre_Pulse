-- V381b. A timestamp parser for the ERP exports.
--
-- The existing erp_parse_date returns a DATE, so it silently DISCARDS the time
-- component. That is fatal for the job card availability cycle: Production Out
-- 06-01-2026 05:42 and Workshop In 06-01-2026 08:15 are the same date, so a
-- date parser measures the wait as zero. Hours are the whole point of those
-- four columns, so they need their own parser.
--
-- Day-first, matching the V-audit finding that these Ramco/GCC exports are
-- DD-MM-YYYY: reading 07/09/2026 month-first turns 7 September into 9 July.
-- Falls through to erp_parse_date for date-only values so the two never
-- disagree about which shapes are valid.

create or replace function public.erp_parse_ts(t text)
returns timestamptz language plpgsql immutable parallel safe
set search_path to 'public' as $$
declare s text := btrim(coalesce(t, ''));
begin
  if s = '' or upper(s) in ('NULL','N/A','-') then return null; end if;

  -- ISO, which is what a spreadsheet export of a real datetime produces
  begin return s::timestamptz; exception when others then null; end;

  -- day-first with a time component
  begin return to_timestamp(s, 'DD-MM-YYYY HH24:MI:SS'); exception when others then null; end;
  begin return to_timestamp(s, 'DD/MM/YYYY HH24:MI:SS'); exception when others then null; end;
  begin return to_timestamp(s, 'DD-MM-YYYY HH24:MI');    exception when others then null; end;
  begin return to_timestamp(s, 'DD/MM/YYYY HH24:MI');    exception when others then null; end;
  begin return to_timestamp(s, 'DD-Mon-YY HH24:MI');     exception when others then null; end;
  begin return to_timestamp(s, 'DD-Mon-YYYY HH24:MI');   exception when others then null; end;

  -- date only: fall back to the existing parser so the two agree on shapes
  begin
    return public.erp_parse_date(s)::timestamptz;
  exception when others then return null;
  end;
end $$;

-- Numeric coercion for the ERP's money/hours columns, which arrive with
-- thousands separators, currency text and the occasional stray space. Anything
-- that is not a number becomes NULL rather than a fabricated zero.
create or replace function public._to_num(t text)
returns numeric language plpgsql immutable
set search_path to 'public' as $$
declare s text;
begin
  s := regexp_replace(coalesce(t,''), '[^0-9.\-]', '', 'g');
  if s is null or s = '' or s = '-' or s = '.' then return null; end if;
  return s::numeric;
exception when others then return null;
end $$;
