-- ============================================================================
-- MIGRATIONS_V613_SCRAP_SERIAL_CASE_INSENSITIVE.sql
-- STATUS: APPLIED LIVE 2026-09-26 (project jhssdmeruxtrlqnwfksc).
--
-- Closes the last case-sensitive corner of the scrap family (PROJECT_MEMORY
-- item 12). V604 already made scrap_tyre_by_serial / unscrap_tyre_by_serial /
-- list_scrapped_tyres match on upper(btrim(serial_no)), and every
-- tyre_status_marks.serial is stored canonical (measured: 503 scrap marks,
-- 0 non-canonical). set_scrap_reason was the exception: it used btrim() only,
-- so editing the reason with the lower-case spelling of a split serial
-- (k507B403590 vs K507B403590) matched no mark and silently changed nothing.
--
-- The column is NOT normalised (the web and mobile lookups read it; see item 12).
-- The live body is rewritten by anchored replace; anchor 1 must occur once and
-- anchor 2 exactly twice (the select and the update) or the migration aborts.
-- Verified rolled back as the super admin on split serial k507b403590 /
-- K507B403590 (TM662 LHRO): scrap updated 2 rows (both Scrapped), reason edit
-- via the lower-case spelling landed, undo restored Active + Removed exactly.
-- Rollback: re-run with the two replacements reversed.
-- ============================================================================
do $mig$
declare
  v_def text;
  v_a1  text := $a$v_s   text := btrim(coalesce(p_serial, ''));$a$;
  v_b1  text := $a$v_s   text := upper(btrim(coalesce(p_serial, '')));$a$;
  v_a2  text := $a$where serial = v_s and mark_type = 'scrap'$a$;
  v_b2  text := $a$where upper(btrim(serial)) = v_s and mark_type = 'scrap'$a$;
  n int;
begin
  select pg_get_functiondef('public.set_scrap_reason(text,text)'::regprocedure) into v_def;

  n := (length(v_def) - length(replace(v_def, v_a1, ''))) / length(v_a1);
  if n <> 1 then raise exception 'V613 anchor 1 matched % times', n; end if;
  v_def := replace(v_def, v_a1, v_b1);

  n := (length(v_def) - length(replace(v_def, v_a2, ''))) / length(v_a2);
  if n <> 2 then raise exception 'V613 anchor 2 matched % times (expected 2: select + update)', n; end if;
  v_def := replace(v_def, v_a2, v_b2);

  execute v_def;
end $mig$;
