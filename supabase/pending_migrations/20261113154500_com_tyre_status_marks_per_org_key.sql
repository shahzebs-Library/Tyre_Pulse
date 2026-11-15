-- COM-4b (audit MODA-1, step 2 of 2): tyre status marks are unique PER ORGANISATION.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the live catalog (pg_indexes,
--         pg_constraint) and the LIVE definition of scrap_tyre_by_serial. Not applied to any
--         database. Tested on PGlite only (supabase/tests/commercial_tyre_keys.test.mjs).
--         REQUIRES 20261113154000_com_scrap_mark_org_guard.sql first.
--
--   >>> DO NOT APPLY ALONE. It must go live in the same release as ONE client change: <<<
--       src/lib/api/tyreExchange.js:48
--         .upsert({ serial, mark_type: markType }, { onConflict: 'serial,mark_type' })
--       must become
--         .upsert({ serial, mark_type: markType }, { onConflict: 'organisation_id,serial,mark_type' })
--       Postgres resolves ON CONFLICT against a unique index with EXACTLY the named columns.
--       After this migration no index on (serial, mark_type) exists, so the old call fails with
--       42P10 and Tyre Exchange "returned" / "written off" marks stop saving. The scrap paths
--       (web, Expo, Flutter) all go through the RPC and need no change.
--       NOTE FOR WHOEVER APPLIES IT: the text below removes a constraint, and the Supabase MCP
--       asks a person to confirm such statements. Apply when the owner can approve the prompt.
--
-- ROOT CAUSE
--   Constraint tyre_status_marks_serial_mark_type_key UNIQUE (serial, mark_type) has no
--   organisation column: one serial can carry one scrap mark for the whole platform. Serial
--   numbers are not globally unique (batch codes, short numbers, re-used casings), so a second
--   company cannot mark a serial the first company already marked. Step 1 stops the overwrite;
--   this step lets both companies hold their own mark.
--
-- WHAT THIS CHANGES
--   1. organisation_id becomes NOT NULL (it is already filled on every row and defaults to the
--      caller's organisation). The migration aborts if any row has none.
--   2. The unique key becomes (organisation_id, serial, mark_type). The old key is removed.
--   3. scrap_tyre_by_serial targets the new key. The organisation test added in step 1 stays
--      (it is always true under the new key and costs nothing).
--   No row is changed. No policy is changed.
--
-- RISK TO THE CURRENT COMPANY: LOW, and only through ordering.
--   Its 846 marks are already unique under both keys (one organisation), so no row conflicts
--   and every scrap, undo and reason edit behaves the same. The risk is applying this without
--   the client line above: Tyre Exchange marks would fail until the web build is out. Scrap
--   through the RPC is unaffected either way.
--
-- VERIFY (after applying; read only)
--   select indexdef from pg_indexes where tablename = 'tyre_status_marks' and indexdef like '%UNIQUE%';
--     -- the primary key and tyre_status_marks_org_serial_mark_type_key only
--   select count(*) from public.tyre_status_marks where organisation_id is null;   -- 0
--   select position('on conflict (organisation_id, serial, mark_type)' in
--          pg_get_functiondef('public.scrap_tyre_by_serial(text,text,text)'::regprocedure)) > 0; -- t
--
-- ROLLBACK (only while no two organisations share a serial and mark type)
--   alter table public.tyre_status_marks add constraint tyre_status_marks_serial_mark_type_key unique (serial, mark_type);
--   re-create scrap_tyre_by_serial as left by step 1; remove constraint
--   tyre_status_marks_org_serial_mark_type_key; alter column organisation_id to allow null.

do $migration$
declare
  c_old constant text := 'on conflict (serial, mark_type) do update';
  c_new constant text := 'on conflict (organisation_id, serial, mark_type) do update';
  v_def text;
  v_n   int;
begin
  if exists (select 1 from public.tyre_status_marks where organisation_id is null) then
    raise exception 'COM-4b: tyre_status_marks has rows without an organisation. Assign them before applying.';
  end if;
  if exists (select 1 from public.tyre_status_marks
              group by organisation_id, serial, mark_type having count(*) > 1) then
    raise exception 'COM-4b: duplicate (organisation_id, serial, mark_type) rows exist.';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.oid = 'public.scrap_tyre_by_serial(text,text,text)'::regprocedure;
  if position('tyre_status_marks.organisation_id = excluded.organisation_id' in v_def) = 0 then
    raise exception 'COM-4b: apply 20261113154000_com_scrap_mark_org_guard.sql first.';
  end if;
  v_n := (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old);
  if v_n <> 1 then
    raise exception 'COM-4b: expected exactly one conflict target in scrap_tyre_by_serial, found %', v_n;
  end if;

  alter table public.tyre_status_marks alter column organisation_id set not null;
  alter table public.tyre_status_marks
    add constraint tyre_status_marks_org_serial_mark_type_key unique (organisation_id, serial, mark_type);
  alter table public.tyre_status_marks drop constraint tyre_status_marks_serial_mark_type_key;

  execute replace(v_def, c_old, c_new);
end
$migration$;
