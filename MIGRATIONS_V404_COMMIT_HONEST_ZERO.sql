-- =====================================================================
-- V404 - A COMMIT THAT WROTE NOTHING MUST NOT REPORT SUCCESS
-- Applied live 2026-07-28.
-- =====================================================================
--
-- User: "why in data intake erp only expenses get uploaded and other is not
-- making upload properly, always imports comes zero".
--
-- THE BUG, verbatim in the deployed function. The batch ROW and the CLIENT were
-- told different things:
--
--   SET import_status = CASE WHEN v_remaining > 0 THEN 'committing'
--                            WHEN v_total_ins  > 0 THEN 'committed'
--                            ELSE 'failed' END,          <-- the row says FAILED
--
--   RETURN ... 'status', CASE WHEN v_remaining > 0 THEN 'partial'
--                             WHEN v_total_ins > 0 THEN 'committed'
--                             WHEN v_failed    > 0 THEN 'failed'
--                             ELSE 'committed' END       <-- the client says COMMITTED
--
-- With nothing inserted and nothing failed, the database recorded `failed` and
-- the user got a green tick reading "Committed - 0 row(s) inserted, 0 skipped."
--
-- IT IS IN THE PRODUCTION AUDIT LOG, as a pair on the same batch:
--   2026-07-12 09:56:39  warranty_claims  inserted 0, failed 22   (honest, red)
--   2026-07-12 09:58:30  warranty_claims  inserted 0, failed  0   (GREEN SUCCESS)
--
-- The mechanism behind that pair is the second half of the problem: on a per-row
-- insert error the loop does `UPDATE import_rows SET validation_status='error'`,
-- and the loop only ever selects `validation_status IN ('ready','warning')`. So
-- a failed row is PERMANENTLY excluded from every later commit of that batch.
-- The retry finds nothing eligible, and the ELSE branch calls that a success.
--
-- =====================================================================
-- WHAT WAS MEASURED BEFORE CHANGING ANYTHING
-- =====================================================================
--   17 batches, 3,555 staged rows.
--   * 9 batches staged ZERO rows and sit in draft forever - the same Egypt
--     asset file was uploaded SIX times in one day, each attempt an orphan.
--   * 2 Egypt fleet batches DID insert 94 rows each and were then reversed, so
--     the list shows them as 0/101 - correct behaviour, misleading display.
--   * The batch counters lie independently: several batches report total_rows 0
--     while actually holding hundreds of staged rows.
--
-- The insert itself is fine. Verified live as a real authenticated user: the
-- exact payload from a staged Egypt fleet row inserts into vehicle_fleet
-- without complaint. Neither RLS nor a constraint was blocking it.
--
-- =====================================================================
-- TWO CHANGES
-- =====================================================================
--  1. `nothing_to_commit` is its own status. Zero inserted is not success.
--  2. The response reports `not_eligible`, broken down by each row's own action
--     and validation_status. Without it a reader cannot tell "every row was
--     already in the system" from "every row failed on an earlier attempt" -
--     opposite problems with opposite fixes, previously both rendered as "0".
--
-- Applied by rewriting the existing definition with GUARDS that raise if the
-- expected text is absent, rather than retyping a function of this size. The
-- guard on the ELSE branch asserts it appears exactly once, so it cannot match
-- the UPDATE's own ELSE (which is 'failed').
--
-- VERIFIED LIVE, ROLLED BACK, on the real Egypt batch with its rows forced to
-- the post-failure state:
--   {"status": "nothing_to_commit", "inserted": 0, "failed": 0,
--    "not_eligible": {"insert/error": 101}}
-- Previously that exact call returned "committed".

do $$
declare
  v_def text;
  v_hits int;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'import_commit_batch';

  if v_def is null then
    raise exception 'V404: import_commit_batch not found';
  end if;

  select count(*) into v_hits
  from regexp_matches(v_def, 'ELSE ''committed'' END', 'g');
  if v_hits <> 1 then
    raise exception 'V404: expected exactly 1 committed-ELSE, found % - review before re-running', v_hits;
  end if;

  v_def := replace(v_def, 'ELSE ''committed'' END', 'ELSE ''nothing_to_commit'' END');

  if position('''skipped'',  v_skipped,' in v_def) = 0 then
    raise exception 'V404: skipped key not found - review before re-running';
  end if;

  v_def := replace(v_def, '''skipped'',  v_skipped,',
    '''skipped'',  v_skipped,
    ''not_eligible'', coalesce((
      select jsonb_object_agg(z.k, z.n) from (
        select coalesce(ir.action, ''unset'') || ''/'' || coalesce(ir.validation_status, ''unset'') as k,
               count(*) as n
        from public.import_rows ir
        where ir.batch_id = p_batch_id
          and not (ir.action = ''insert'' and ir.validation_status in (''ready'', ''warning''))
        group by 1
      ) z), ''{}''::jsonb),');

  execute v_def;
end $$;

comment on function public.import_commit_batch(uuid, integer) is
  'V404: returns nothing_to_commit (not committed) when zero rows were inserted, and reports not_eligible so the reader can tell "already in the system" from "failed on an earlier attempt".';

-- =====================================================================
-- SHIPPED WITH THIS (code only, no schema change)
--
-- 1. THE CLIENT NO LONGER DRAWS A GREEN TICK FOR ZERO.
--    diagnostics.summarizeCommitResult graded a zero-insert run `level='ok'`;
--    it now warns, headlines "Nothing was imported", and states which of the two
--    causes applies. DataIntakeCenter renders amber with the not_eligible
--    breakdown instead of a green "Committed - 0 row(s) inserted".
--
-- 2. /erp-import STOPS PROMISING A PROMOTION STEP THAT DOES NOT EXIST.
--    erp_asset_import / erp_tyre_change_import / erp_tyre_expense_import are the
--    ONLY staging family in the schema with no trigger and no RPC that reads
--    them - every other family (expenses_*, all 7 stg_* plus their 21 country
--    siblings) has a working pipe. That is precisely why the expense grid looks
--    like the only thing that imports. The page said "before promotion" and
--    "promotion is a deliberate, separate step" in four places; it now says
--    plainly that these rows do not reach the master tables.
--    BUILDING that promotion is real work and is NOT done here.
--
-- 3. A MISMATCHED SHEET IS REFUSED INSTEAD OF SAVED EMPTY.
--    erp_tyre_change_import holds 18 rows in which asset_no, serial_no,
--    tire_pos, fix_date, job_card and tyre_brand are ALL null - only `site` is
--    set, because the word "location" matched the site alias. Two faults
--    combined: detectSheetIndex silently fell back to sheet 0 when no tab name
--    matched, and isEmptyMappedRow only dropped a row when EVERY column was
--    null. The user was told "Saved 18 of 18 rows" for a sheet nothing had been
--    read from. Now a row must carry its dataset's declared keyField, and a
--    multi-tab workbook with no matching tab asks the user to pick.
--
-- 4. A BLANK DATE NO LONGER KILLS THE WHOLE BATCH.
--    work_orders.opened_at is NOT NULL with a now() default, and a column
--    default does NOT apply when the client sends an explicit null - which both
--    work-order mappers did. One blank "Vehicle In Date" anywhere in an ERP file
--    aborted the entire import at zero rows, with a sanitized message that never
--    named the column. The key is now omitted when there is no date, so the
--    default applies; the raw value is still kept in custom_data.
--    (This is the in-app twin of the staging-pipe defect already recorded as
--    open in PROJECT_MEMORY. The two were never connected.)
--
-- =====================================================================
-- STILL OPEN, deliberately not changed here
--   * work_orders.work_order_no is GLOBALLY unique while the client's duplicate
--     check is country-scoped, so a number already stored under another country
--     slips through and aborts the batch. Needs either a per-country key or a
--     global dedupe scope - a decision, not a patch.
--   * erpIntake existingKeys pages with .range() and NO .order(), against
--     60,099 KSA work orders. That violates the repo's own rule and can let one
--     stored row through, which is enough to abort a batch.
--   * The promotion step for the three erp_*_import tables.
-- =====================================================================
