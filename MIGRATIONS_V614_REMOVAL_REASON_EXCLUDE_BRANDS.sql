-- ============================================================================
-- MIGRATIONS_V614_REMOVAL_REASON_EXCLUDE_BRANDS.sql
-- STATUS: APPLIED LIVE 2026-09-26 (project jhssdmeruxtrlqnwfksc).
--
-- PROJECT_MEMORY items 5/13: ~820 UAE tyre_records carry a tyre BRAND in
-- removal_reason (ROADX, FIREMAX, LONGMARCH, TRIANGLE, ROCK HOLDER, VGLORY...),
-- with brand already populated. On the public share board
-- (get_report_tyre_maintenance) ROADX ranked as the #3 "removal reason".
--
-- This does NOT clear the column (owner decision). It only stops the board
-- reading a brand as a reason: a value whose alphanumeric-only lower-case form
-- is in brain_tokens('tyre_brand') (the classifier's own catalog, one list, no
-- second copy) plus 'rock holder'/'vglory' is left out of the reasons ranking.
-- Normalising both sides folds ROCK HOLDER == rockholder and VGLORY == v-glory.
-- Mirror: src/lib/removalReason.js isBrandNotReason (change both).
--
-- NOTE: `= ANY ((select ...))` parses as the subquery form of ANY; the
-- coalesce(..., '{}'::text[]) wrapper keeps it an array expression (InitPlan).
-- Anchored replace on the LIVE body; aborts unless the anchor occurs once.
-- Rollback: re-run with the replacement reversed.
-- ============================================================================
do $mig$
declare
  v_def text;
  v_a   text := $a$WHERE status='Removed' AND removal_reason IS NOT NULL$a$;
  v_b   text := $a$WHERE status='Removed' AND removal_reason IS NOT NULL
            AND NOT (regexp_replace(lower(removal_reason), '[^a-z0-9]', '', 'g') = ANY (coalesce(
              (SELECT array_agg(regexp_replace(lower(bt), '[^a-z0-9]', '', 'g'))
                 FROM unnest(public.brain_tokens('tyre_brand') || ARRAY['rock holder','vglory']) bt),
              '{}'::text[])))$a$;
  n int;
begin
  select pg_get_functiondef('public.get_report_tyre_maintenance(text,text,text,text,text,text)'::regprocedure) into v_def;
  n := (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a);
  if n <> 1 then raise exception 'V614 anchor matched % times', n; end if;
  execute replace(v_def, v_a, v_b);
end $mig$;
