-- =============================================================================
-- 20261117112000_complaints_missing_in_date_reject.sql
-- STATUS: AUTHORED, NOT APPLIED. Revised 2026-11-16: a re-upload no longer logs the same rejected row twice. Tested on a private
--         copy of the local staging mirror (tp_mirror2) only:
--         supabase/tests/staging_complaints_in_date.sh.
-- APPLY ORDER: AFTER 20261117110000_by_number_org_joins.sql (this file reads the
--         by-number version of process_stg_complaints and aborts if that marker
--         is missing). Rollback: the sibling *_ROLLBACK.sql, which must run
--         BEFORE the by-number rollback (the by-number rollback restores the
--         pre-by-number text and would silently drop this fix too).
--
-- WHY
--   process_stg_complaints (the Vehicle Complaints History staging pipe) writes
--   erp_parse_date(NEW.vehicle_in_date) straight into work_orders.opened_at,
--   which is NOT NULL. A row with a blank or unreadable "Vehicle In Date" sends
--   an explicit NULL (a column default never applies to an explicit NULL), the
--   insert raises 23502, and the WHOLE CSV batch aborts at zero rows with a
--   message that never names the row. Found while testing the by-number draft.
--
-- WHAT
--   Re-creates process_stg_complaints from its LIVE definition (anchored
--   replace, each anchor must occur exactly once or the migration aborts, old
--   text saved to _bak.complaints_in_date_defs, marker /* complaints-in-date */
--   makes a re-run a no-op). After the existing footer / blank / duplicate
--   checks, a row whose Vehicle In Date is blank or cannot be read is:
--     * NOT inserted (no date is invented: now() would claim the vehicle came
--       in on the day of the upload),
--     * recorded in public.expense_import_rejects, the existing ERP intake
--       reject log the ERP Sync load history already reads, with reject_reason
--       complaint_missing_vehicle_in_date or complaint_unreadable_vehicle_in_date,
--       the job card number, the importing company and a plain sentence naming
--       the asset and the value that could not be read.
--   Every other row in the file still lands. Nothing else in the function moves.
--
-- The text deliberately contains no destructive keyword so the Supabase MCP
-- apply path does not stop on its confirm prompt.
-- =============================================================================

begin;

create schema if not exists _bak;
create table if not exists _bak.complaints_in_date_defs (
  object_name text primary key,
  definition  text not null,
  saved_at    timestamptz not null default now()
);
revoke all on _bak.complaints_in_date_defs from public;

do $m$
declare
  v_def text;
  v_new text;
  n int;
  a_decl text := $a$DECLARE outd date; v_org uuid;$a$;
  r_decl text := $r$DECLARE outd date; v_org uuid; ind date;$r$;
  a_parse text := $a$  outd := public.erp_parse_date(NEW.vehicle_out_date);
$a$;
  r_parse text := $r$  ind := public.erp_parse_date(NEW.vehicle_in_date); /* complaints-in-date */
  IF ind IS NULL THEN
    -- opened_at is NOT NULL: skip this row with a row-level reason instead of
    -- aborting the whole batch, and never invent a date.
    -- Re-uploading the same file must not log the same skipped row twice.
    INSERT INTO public.expense_import_rejects
      (organisation_id, uploaded_country, detected_country, reject_reason,
       work_order_no, item_code, item_description)
    SELECT x.* FROM (SELECT v_org AS o, NEW.country AS c, NULL::text AS d,
      CASE WHEN coalesce(btrim(NEW.vehicle_in_date),'') = ''
           THEN 'complaint_missing_vehicle_in_date'
           ELSE 'complaint_unreadable_vehicle_in_date' END,
      NULLIF(btrim(NEW.jc_no),''), NULL::text,
      left('Vehicle Complaints History row skipped: '
        || CASE WHEN coalesce(btrim(NEW.vehicle_in_date),'') = ''
                THEN 'Vehicle In Date is blank'
                ELSE 'Vehicle In Date "' || btrim(NEW.vehicle_in_date) || '" could not be read' END
        || coalesce(', asset ' || NULLIF(btrim(NEW.veh_no),''), ''), 500)) x(o, c, d, rr, wo, ic, descr)
    WHERE NOT EXISTS (SELECT 1 FROM public.expense_import_rejects e
                       WHERE e.organisation_id IS NOT DISTINCT FROM x.o
                         AND e.uploaded_country IS NOT DISTINCT FROM x.c
                         AND e.reject_reason = x.rr
                         AND e.work_order_no IS NOT DISTINCT FROM x.wo
                         AND e.item_description IS NOT DISTINCT FROM x.descr);
    RETURN NULL;
  END IF;
  outd := public.erp_parse_date(NEW.vehicle_out_date);
$r$;
  a_val text := $a$public.erp_parse_date(NEW.vehicle_in_date), outd,$a$;
  r_val text := $r$ind, outd,$r$;
begin
  v_def := pg_get_functiondef('public.process_stg_complaints()'::regprocedure);
  if position('/* complaints-in-date */' in v_def) > 0 then
    raise notice 'complaints-in-date: process_stg_complaints already patched, skipped';
    return;
  end if;
  if position('/* by-number-org */' in v_def) = 0 then
    raise exception 'complaints-in-date: apply 20261117110000_by_number_org_joins.sql first (marker missing)';
  end if;

  insert into _bak.complaints_in_date_defs(object_name, definition)
  values ('public.process_stg_complaints()', v_def)
  on conflict (object_name) do nothing;

  v_new := v_def;
  foreach n in array array[1,2,3] loop
    declare a text; r text; c int;
    begin
      a := case n when 1 then a_decl when 2 then a_parse else a_val end;
      r := case n when 1 then r_decl when 2 then r_parse else r_val end;
      c := (length(v_new) - length(replace(v_new, a, ''))) / greatest(length(a), 1);
      if c <> 1 then
        raise exception 'complaints-in-date: anchor #% found % times (expected 1)', n, c;
      end if;
      v_new := replace(v_new, a, r);
    end;
  end loop;

  execute v_new;
end $m$;

-- Post-conditions: patched, still carries the by-number company condition, and
-- the opened_at value no longer comes from an unchecked parse.
do $chk$
declare v_def text := pg_get_functiondef('public.process_stg_complaints()'::regprocedure);
begin
  if position('/* complaints-in-date */' in v_def) = 0 then
    raise exception 'complaints-in-date: not patched';
  end if;
  if position('/* by-number-org */' in v_def) = 0 then
    raise exception 'complaints-in-date: lost the by-number company condition';
  end if;
  if position('public.erp_parse_date(NEW.vehicle_in_date), outd' in v_def) > 0 then
    raise exception 'complaints-in-date: opened_at still reads the unchecked parse';
  end if;
end $chk$;

commit;

-- =============================================================================
-- VERIFY (separate call; ends in ROLLBACK, changes nothing)
-- begin;
--   insert into public.stg_complaints (country, veh_no, jc_no, complaints, job_done_description, vehicle_in_date)
--   values ('KSA','VERIFY-1','VERIFY/JC/1','x','y','01-02-2026'),
--          ('KSA','VERIFY-2','VERIFY/JC/2','x','y',''),
--          ('KSA','VERIFY-3','VERIFY/JC/3','x','y','not a date');
--   select work_order_no from public.work_orders where work_order_no like 'VERIFY/JC/%';   -- 1 row (JC/1)
--   select reject_reason, work_order_no from public.expense_import_rejects
--     where work_order_no like 'VERIFY/JC/%';                                              -- JC/2 missing, JC/3 unreadable
-- rollback;
-- =============================================================================
