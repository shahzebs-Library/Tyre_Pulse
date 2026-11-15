-- TEN-1 (part b): work order numbers become unique PER ORGANISATION.
--
-- STATUS: AUTHORED, NOT APPLIED. HELD FOR AN OWNER DECISION (see OPEN DECISION below).
--         Apply only after 20261113100000_ten1_job_card_conflict_org_guard.sql.
--         Tested on PGlite only (supabase/tests/tenant_isolation_ten1.test.mjs).
--
-- WHAT IT FIXES
--   With part a alone a second tenant is refused (PT409) whenever its job card number was
--   already used by Company A. This migration replaces the global key
--   work_orders_work_order_no_key UNIQUE (work_order_no) with
--   work_orders_org_work_order_no_key UNIQUE (organisation_id, work_order_no) and retargets the
--   staging upsert, so each organisation owns its own numbers and a second tenant staging a
--   Company A number gets its OWN new row while the Company A row is untouched.
--
-- OPEN DECISION (owner + a DB-authorised reviewer), which is why this is held:
--   1. Anything that joins to work_orders BY NUMBER ONLY assumes the number is globally unique.
--      Expense lines (parts_consumption.work_order_no), work_order_line_items, tyre_records.job_card
--      and several cost RPCs (for example get_site_operating_cost) join on the number. Once two
--      organisations can hold the same number, every such join must also match organisation_id or
--      it will attach one company's cost to the other company's job card. Those joins were NOT
--      audited for this draft. Until they are, do not apply.
--   2. The in-app ERP intake (src/lib/api/erpIntake.js insertWorkOrders) de-duplicates by number
--      through RLS, which is already per organisation for a normal user, so no client change is
--      expected, but it was not run against this key.
--   3. The statement set contains one DROP CONSTRAINT. There is no drop-free way to change the
--      columns of a unique key. The Supabase MCP destructive-statement gate will ask a human to
--      confirm; it cannot be applied from an unattended cloud session.
--   4. Building the new unique index takes a short ACCESS EXCLUSIVE lock on work_orders
--      (about 90,000 rows). Run it in a quiet window.
--
-- RISK TO THE CURRENT COMPANY: LOW for the data (measured live 2026-11-12: 0 repeated
--   (organisation_id, work_order_no) pairs, organisation_id is NOT NULL, no foreign key references
--   work_order_no; all 7 foreign keys reference work_orders.id). MEDIUM overall until decision 1
--   is closed, because a by-number join that was correct with one company becomes ambiguous the
--   day a second company imports an overlapping number. With one company nothing changes.
--
-- VERIFY (rolled back):
--   begin;
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.work_orders'::regclass and contype = 'u';      -- expect only the per-org key
--   select position('on conflict (organisation_id, work_order_no) do update set' in prosrc) > 0
--     from pg_proc where oid = 'public.process_stg_job_cards()'::regprocedure; -- expect t
--   -- then repeat VERIFY steps 3 and 4 of part a: step 4 now expects a NEW demo-organisation row,
--   -- no error, and the Company A row byte-identical.
--   rollback;
--
-- ROLLBACK (only possible while no number is held by two organisations):
--   alter table public.work_orders add constraint work_orders_work_order_no_key unique (work_order_no);
--   -- restore the function text captured before applying (or reverse the replacement below)
--   alter table public.work_orders drop constraint work_orders_org_work_order_no_key;
-- ---------------------------------------------------------------------------------------------

do $mig$
declare
  v_def    text;
  v_anchor constant text := 'on conflict (work_order_no) do update set';
  v_new    constant text := 'on conflict (organisation_id, work_order_no) do update set';
  v_hits   integer;
begin
  if exists (select 1 from public.work_orders group by organisation_id, work_order_no having count(*) > 1) then
    raise exception 'TEN-1b aborted: (organisation_id, work_order_no) is not unique in work_orders';
  end if;
  if exists (select 1 from public.work_orders where organisation_id is null) then
    raise exception 'TEN-1b aborted: work_orders has rows with no organisation';
  end if;

  select pg_get_functiondef('public.process_stg_job_cards()'::regprocedure) into v_def;
  if position('work_orders.organisation_id = excluded.organisation_id' in v_def) = 0 then
    raise exception 'TEN-1b aborted: apply the TEN-1 organisation guard (20261113100000) first';
  end if;
  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'TEN-1b aborted: expected "%" exactly once in process_stg_job_cards, found % time(s)', v_anchor, v_hits;
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.work_orders'::regclass and conname = 'work_orders_org_work_order_no_key') then
    alter table public.work_orders
      add constraint work_orders_org_work_order_no_key unique (organisation_id, work_order_no);
  end if;

  execute replace(v_def, v_anchor, v_new);

  -- The one unavoidable destructive statement: the global key has to go for a second
  -- organisation to hold the same number.
  alter table public.work_orders drop constraint work_orders_work_order_no_key;
end
$mig$;
