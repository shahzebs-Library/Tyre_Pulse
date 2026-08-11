-- V511 / V511b - load the tyre fitments the KSA master file carries that we
-- never had, and repair the double-active wheels the first pass created.
-- APPLIED LIVE 2026-08-11.
--
-- WHY THEY WERE MISSING, AND IT WAS NOT THE FILE'S FAULT
-- erp_parse_date cannot read a TWO-DIGIT year. The master file writes fix_date
-- as '29-06-26', so every one of these parsed to NULL and the loader skipped it.
-- They are not stale rows either: they run Aug 2025 to Aug 2026 - the newest
-- tyre changes in the business were the ones missing.
--
-- master_parse_date() adds DD-MM-YY on top of erp_parse_date, and only as a
-- FALLBACK, so four-digit-year strings parse exactly as before. That ordering is
-- load-bearing: V388 is the standing scar from a two-digit year being read as
-- the year itself (33,626 job cards landed in year 0026). to_date's DD-MM-YY
-- pivots 26 to 2026, and the guard refuses any future date, so that cannot land.
--
-- RESULT: 196 fitments loaded across 135 assets, 190 of them current.
--
-- DELIBERATELY NOT LOADED: 27 rows whose serial Excel destroyed into scientific
-- notation ('1.25121E+11'). A serial is an identity; loading a mangled one
-- creates a tyre that can never be matched to the real one and splits its
-- history in two.
--
-- ============================================================================
-- V511b - THE BUG IN V511, AND IT IS THE THREE-VALUED-LOGIC TRAP AGAIN
-- ============================================================================
-- V511 decided whether a new fitment superseded the tyre already on that wheel
-- with `n.fd > cur.issue_date`. The tyres already on those wheels have
-- issue_date NULL, so that comparison is NULL - not false - and BOTH branches
-- testing it fell through to "Active". 67 wheels ended up carrying two active
-- tyres, exactly what trg_guard_tyre_active_fitment exists to prevent.
--
-- A NULL reads as "no" to a human and as "unknown" to Postgres. COALESCE before
-- comparing. This is the same class as the V370a defect already recorded here.
--
-- V511b rule: one active tyre per wheel, and the active one is the one with the
-- LATEST fitment date. An undated tyre loses to one carrying a real date from
-- the newest file. Scope is only wheels V511 touched - pre-existing conflicts
-- elsewhere are not silently rewritten. Verified after: double-active 0,
-- reversed 0, future-dated 0.
--
-- ROLLBACK
--   update tyre_records t set status=b.status, removal_date=b.removal_date
--     from _bak.tyre_double_active_fix_v511b b where b.id=t.id;
--   update tyre_records t set status=b.status, removal_date=b.removal_date
--     from _bak.tyre_master_load_v511_superseded b where b.id=t.id;
--   delete from tyre_records where id in (select id from _bak.tyre_master_load_v511_inserted);
--
-- The applied bodies are in the Supabase migration history under
-- v511_master_tyre_fitments_load and v511b_fix_double_active_from_master_load.
-- The reusable piece is master_parse_date, reproduced here.

create or replace function public.master_parse_date(p text)
returns date language plpgsql immutable set search_path to 'public' as $fn$
declare v text := public.master_clean_value(p); d date;
begin
  if v is null then return null; end if;
  begin d := public.erp_parse_date(v); exception when others then d := null; end;
  if d is not null then return d; end if;
  if v ~ '^\d{1,2}-\d{1,2}-\d{2}$' then
    begin return to_date(v, 'DD-MM-YY'); exception when others then return null; end;
  end if;
  if v ~ '^\d{1,2}/\d{1,2}/\d{2}$' then
    begin return to_date(v, 'DD/MM/YY'); exception when others then return null; end;
  end if;
  return null;
end $fn$;
