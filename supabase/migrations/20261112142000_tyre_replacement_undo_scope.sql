-- tyre_replacement_undo / list_tyre_replacement_batches: caller scope on the ROWS.
--
-- FINDING: RLS-2 (P1)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12. Verified by
--   rolled-back impersonation (VERIFY block at the foot).
--
-- WHAT WAS WRONG (reproduced live, KSA-only Manager, rolled back):
--   tyre_replacement_undo('34b68cac-...') -> {"ok":true,"restored":28}; privileged
--   recount: 28 rows undone (18 UAE + 10 Egypt). list_tyre_replacement_batches
--   listed that UAE/Egypt batch. Both functions are SECURITY DEFINER (RLS never
--   runs inside) and checked role + organisation only.
--
-- WHAT THIS DOES
--   tyre_replacement_undo: before touching anything, a non-super-admin caller is
--     REFUSED (42501) when the batch still has a row to undo whose country - on the
--     log row or on the tyre itself - the caller cannot see, or whose tyre sits at
--     a site outside the caller's site scope.
--     CHOICE: refuse the whole batch rather than undo only the visible rows. A
--     batch is one clean-up operation; undoing part of it leaves the register
--     half reverted with a success reply. Refusal is the safer of the two.
--   list_tyre_replacement_batches: a batch that contains any row outside the
--     caller's country/site scope is not listed (super admin still sees all).
--   Scope helpers: app_can_see_country(text), app_can_see_site(text) - the same
--     ones the other tyre RPCs use. A null country / blank site is visible to all
--     (the project-wide RLS convention).
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Data loss: none (function bodies only). No table, grant or signature change.
-- Method: each new body is the LIVE pg_get_functiondef with one anchored
--   insertion; the block aborts unless each anchor is found exactly once.
-- Locks: none beyond CREATE OR REPLACE FUNCTION.
-- SECURITY DEFINER + search_path preserved by CREATE OR REPLACE; EXECUTE grants
--   unchanged (authenticated; neither function takes an org id).
-- PostgREST: raises 42501 only.
-- Client behaviour that changes: a country-scoped Manager no longer sees, and can
--   no longer undo, a replacement batch that includes another country's tyres.
-- Rollback: at the foot.

do $mig$
declare
  v_def text;
  v_a   text := '  for l in';
  v_b   text := 'from public.tyre_replacement_log where organisation_id = v_org';
  v_scope text :=
       '(   (x.country is not null and public.app_can_see_country(x.country) is not true)'
    || ' or (t.id is not null and t.country is not null and public.app_can_see_country(t.country) is not true)'
    || ' or (t.id is not null and nullif(btrim(coalesce(t.site, '''')), '''') is not null and public.app_can_see_site(t.site) is not true))';
begin
  select pg_get_functiondef('public.tyre_replacement_undo(uuid)'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_a, ''))) / length(v_a) <> 1 then
    raise exception 'undo: anchor not found exactly once';
  end if;
  if position('outside your country or site access' in v_def) > 0 then
    raise exception 'undo: already scoped';
  end if;
  v_def := replace(v_def, v_a,
       E'  if not public.is_super_admin() and exists (\n'
    || E'    select 1 from public.tyre_replacement_log x\n'
    || E'    left join public.tyre_records t on t.id = x.tyre_id\n'
    || E'    where x.batch_id = p_batch and x.undone_at is null and x.organisation_id = v_org\n'
    || E'      and ' || v_scope || E'\n'
    || E'  ) then\n'
    || E'    raise exception ''This batch includes tyres outside your country or site access.'' using errcode = ''42501'';\n'
    || E'  end if;\n'
    || v_a);
  execute v_def;

  select pg_get_functiondef('public.list_tyre_replacement_batches(integer)'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_b, ''))) / length(v_b) <> 1 then
    raise exception 'list: anchor not found exactly once';
  end if;
  if position('app_can_see_country' in v_def) > 0 then
    raise exception 'list: already scoped';
  end if;
  v_def := replace(v_def, v_b,
       v_b
    || E'\n      and (public.is_super_admin() or batch_id not in (\n'
    || E'            select x.batch_id from public.tyre_replacement_log x\n'
    || E'            left join public.tyre_records t on t.id = x.tyre_id\n'
    || E'            where x.organisation_id = v_org and x.batch_id is not null\n'
    || E'              and ' || v_scope || E'))');
  execute v_def;
end
$mig$;

-- ============================================================================
-- VERIFY (rolled-back impersonation; privileged recount after reset role)
--   KSA-only Manager 34793423-...
--     tyre_replacement_undo('34b68cac-35ba-471d-b5c7-4289dc6cfa84') -> ERR 42501,
--       privileged recount of undone rows in that batch = 0   (was 28)
--     list_tyre_replacement_batches(50) -> the KSA batch only (was 2 batches)
--     control: tyre_replacement_undo('79095899-0969-4d69-9504-8c0d2dd26678') (KSA)
--       -> ok, restored + skipped = 28 as before
--   super admin: list -> both batches; undo of the UAE/Egypt batch -> ok
--
-- ROLLBACK: re-create both functions without the inserted block, i.e. remove
--   from tyre_replacement_undo the "if not public.is_super_admin() and exists (...)
--   raise ... end if;" block placed directly before "for l in", and from
--   list_tyre_replacement_batches the "and (public.is_super_admin() or batch_id
--   not in (...))" predicate after "where organisation_id = v_org".
