-- =====================================================================================
-- V584 - INDEX PRUNE: 14 REDUNDANT/UNUSED INDEXES DROPPED, 2 EXPRESSION INDEXES ADDED
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc as
-- `v584_index_prune_and_staging_expression_index`.
-- Net index footprint: -51,440 kB dropped, +4,192 kB added = ~46.1 MB reclaimed
-- against a 256 MB shared_buffers (~18% of the buffer pool).
-- =====================================================================================
--
-- WHY THIS IS SAFE TO DO NOW: THE STATISTICS ARE FINALLY OLD ENOUGH
--
-- PROJECT_MEMORY records, correctly, that `idx_scan = 0` means "not since the last stats
-- reset" and is NOT proof, and that on 2026-08-12 the counters were only ~39 hours old
-- because the postmaster had restarted (`n_tup_ins = 0` on 200k-row tables proved the
-- counters had been discarded). It left an open question: whether the nightly backup
-- restarts the backend, "because if so this evidence can never accumulate."
--
-- MEASURED AT THE TOP OF THIS WORK - THE ANSWER IS NO, AND THE EVIDENCE HAS ACCUMULATED:
--   pg_postmaster_start_time()              2026-08-11 07:23:02+00
--   now()                                   2026-08-17 16:17:16+00
--   uptime                                  6 days 08:54:13
--   pg_stat_database.stats_reset            NULL  (never explicitly reset)
--   oldest pg_stat_statements.stats_since   2026-08-11 07:23:03+00  (== postmaster start)
--   recorded in the window                  59,462,940 index scans / 804,438 writes
--
-- SIX nightly backups have passed inside that window without a restart. So the index
-- counters describe 6.4 unbroken days of real traffic, not hours. That is what makes a
-- usage-based judgement admissible here at all - but it is still not sufficient on its
-- own, which the three refusals below demonstrate.
--
--
-- **PROJECT_MEMORY'S RECORDED INDEX FIGURES ARE STALE AND WERE NOT ACTIONABLE. RE-MEASURED.**
--
--   RECORDED                                    MEASURED 2026-08-17
--   work_order_line_items 5 of 6 unused,        7 indexes, exactly ONE is unused
--     18 MB of 19 MB                            (wo_line_items_org_country_idx, 2856 kB).
--                                               The rest have 9/60/1/19/41 scans.
--                                               Acting on the recorded figure would have
--                                               dropped ~18 MB of indexes that ARE in use.
--   parts_consumption "0 unused - it is clean"  TWO are unused, 6,320 kB:
--                                               parts_consumption_asset_idx (3240 kB)
--                                               parts_consumption_date_idx (3080 kB)
--   work_orders 9 of 18 unused, 14 MB           4 unused, and only 2 of those 4 are
--                                               droppable (see REFUSED below).
--
-- RULE: do not carry an index-usage figure across sessions. It ages out with the stats.
--
--
-- **THE THREE REFUSALS. THESE ARE WORTH MORE THAN THE DROPS.**
--
-- Each of the three had idx_scan = 0 over the full 6.4 days and would have been dropped
-- by a catalog-only sweep. In each case EXPLAIN under `set local role authenticated`
-- showed the planner CHOOSES it. They are dormant, not dead - the mirror image of the
-- recorded `parts_consumption (organisation_id, event_date desc)` mistake, where an index
-- was created on a 14.6x benchmark the app never issues. Here the trap is dropping an
-- index because a query shape I invented does not need it.
--
-- 1. `idx_work_orders_work_type` (1968 kB, 0 scans) - KEPT.
--    Three SECURITY DEFINER RPCs filter it with equality: get_asset_disposal_reliability
--    (= 'Emergency' / 'Preventive Maintenance' / 'Repair'), get_daily_job_cards,
--    get_asset_disposal_fleet_baseline. Cardinality makes it usable: Repair 81.1% but
--    Preventive Maintenance is only 1.2% (1,034 of 89,913) and Service 0.4%.
--    EXPLAIN of the real predicate:
--      ->  Index Scan using idx_work_orders_work_type  (rows=1034)
--            Index Cond: ((work_type)::text = 'Preventive Maintenance'::text)
--    0 scans means the /asset-disposals RPCs were not called in 6.4 days, nothing more.
--
-- 2. `material_master_review_idx (reviewed, txn_value DESC)` (2248 kB, 0 scans) - KEPT.
--    src/lib/api/materialMaster.js listMaterials() sets `.eq('reviewed', true|false)` for
--    the reviewedOnly/unreviewedOnly filters and ALWAYS `.order('txn_value',desc).limit()`.
--    This index is an exact match: equality on the leading column, sort on the second.
--      ->  Index Scan using material_master_review_idx  (rows=200)
--            Index Cond: (reviewed = true)
--    It supplies the ordering, so LIMIT 200 stops after 200 rows (524 buffers) instead of
--    sorting all 22,162. The Material Master review workflow is live per PROJECT_MEMORY.
--
-- 3. `idx_domain_events_type_time (event_type, created_at DESC)` (3344 kB, 0 scans) - KEPT.
--    It looked doubly dead: listDomainEvents() orders by `id` DESC, never created_at, so
--    the index cannot supply the sort. But it still supplies the FILTER, and the table has
--    209,086 rows over 23 event types, several of them rare. Measured on the real shape
--    (`where event_type = 'accident.reported' order by id desc limit 50`):
--      WITH it     Index Scan using idx_domain_events_type_time    428 buffers
--      WITHOUT it  Parallel Seq Scan, Rows Removed by Filter 104,518 / worker
--                                                          10,433 buffers
--    A 24x difference in pages touched. Buffer counts are quoted rather than milliseconds
--    deliberately: timings on this instance vary 5-7x call to call, buffers do not.
--
-- BY CONTRAST, `material_master_category_idx` HAS a live query shape too
-- (`.eq('category', category)` on the same listMaterials call) and was still dropped,
-- because EXPLAIN shows the planner does NOT choose it even with its exact predicate
-- present - `category` is ~4 values over 22,162 rows and the ORDER BY dominates:
--      ->  Sort  ->  Seq Scan on material_master
--            Filter: ... (category = 'spare_part'::text) ...
-- That is the discrimination this migration rests on: a live query shape is not a reason
-- to keep an index; the planner actually choosing it is.
--
--
-- **A CORRECTION TO MY OWN INTERIM FINDING, recorded so nobody repeats it.**
--
-- I first read `pg_stat_user_tables.n_live_tup = 1,640` for domain_events against a 78 MB
-- heap and 33 MB of indexes and concluded "catastrophic bloat on a 1,640-row queue table".
-- That was WRONG. `select count(*)` returns 209,086 rows (reltuples 199,989). n_live_tup
-- is only refreshed by vacuum/analyze, and this table shows last_analyze and
-- last_autoanalyze both NULL since the postmaster start, so the 1,640 was a stale
-- fragment. The indexes are proportionate to 209k rows and there is no bloat to reclaim.
-- The claim was withdrawn before anything was dropped on that basis.
-- RULE: n_live_tup is a stats-window artifact. Use count(*) or reltuples before calling
-- anything bloated.
--
--
-- WHAT WAS DROPPED, IN TWO CATEGORIES
--
-- CATEGORY A - STRUCTURALLY REDUNDANT (safe WITHOUT reference to usage stats).
-- A btree on (a,b,c) serves any predicate a plain btree on (a) or (a,b) serves; that is a
-- property of btree, not a planner preference. Detected by comparing ordered key
-- signatures including collation, opclass and DESC/NULLS options, and requiring an
-- identical partial predicate, so a partial index is never treated as covering a full one.
-- In EVERY case below the surviving covering index is hotter AND (except production_logs)
-- SMALLER than what it replaces, so cache pressure strictly improves:
--
--   dropped                          kB    scans   covered by                                     kB   scans
--   idx_production_logs_org         4872      66   production_logs_org_country_period_idx        4792     293
--   wo_line_items_org_country_idx   2856       0   work_order_line_items_org_country_created_idx 1384      41
--   parts_consumption_org_idx       2544     389   parts_consumption_org_country_date_idx        3152   3,796
--   wo_line_items_org_idx           2392      19   work_order_line_items_org_country_created_idx 1384      41
--   work_orders_org_country_idx     2032     248   work_orders_org_country_created_idx            680     634
--   idx_work_orders_org             1776     138   work_orders_org_country_created_idx            680     634
--   idx_tyre_records_risk_level      176       0   idx_tyre_risk_date                             200     401
--
-- Note work_orders: (org) and (org,country) were BOTH present alongside three separate
-- (org,country,<timestamp> DESC) indexes - a three-rung ladder where only the widest is
-- needed. The 2-column index is 2032 kB while the 3-column one is 680 kB; the extra bulk
-- is page-split bloat in the older index, so dropping it is a double win.
--
-- CONFIRMED EMPIRICALLY, not just argued. Both work_orders indexes dropped inside a
-- rolled-back transaction, then the real predicate run as the KSA-only Manager
-- (34793423-43df-4b6f-9270-9d1e8be6fa30) under `set local role authenticated`:
--      ->  Index Scan using work_orders_org_country_created_idx
--            Index Cond: ((organisation_id = '...0001') AND ((country)::text = 'KSA'))
-- Same Index Cond, still an index scan, no seq scan. (The wall time there is dominated by
-- the RLS per-row filter over 62,412 rows, not by index choice, and is not quoted.)
--
-- `idx_tyre_records_risk_level` is the clearest case in the whole set: `risk_level` is
-- populated on 0 of 11,193 rows, so no predicate on it can ever benefit, yet the index was
-- maintained on all 13,225 UPDATEs in the window. It also has live filter shapes
-- (dashboard.js `.eq('risk_level','Critical')`, tyres.js, tyreRecords.js, ragService.js) -
-- which is exactly why it is dropped on REDUNDANCY grounds and not "no caller": those
-- queries are already served by idx_tyre_risk_date (401 scans).
--
-- CATEGORY B - UNUSED *AND* CORROBORATED FROM THE CODE (0 scans over 6.4 days, plus no
-- query shape that a btree could serve, checked in BOTH src/+mobile/ and in pg_proc):
--
--   idx_domain_events_entity (entity_type, entity_id)          16,104 kB
--     The only reference to entity_type/entity_id anywhere is inside listDomainEvents()'s
--     free-text search `.or(entity_type.ilike.%s%,entity_id.ilike.%s%)`. A leading-%
--     ILIKE cannot use a btree. Zero equality predicates in src/, mobile/, and zero among
--     the functions whose body mentions domain_events. Largest single drop in this file.
--
--   _bucket_snap_i (id) on _bucket_snapshot_20260727            6,704 kB
--     An index on a deny-all rollback snapshot (RLS on, no policy, unreachable per V501).
--     Its only conceivable use is a manual restore joining on id - which for a whole-table
--     restore the planner would hash-join anyway. The DATA is untouched; only the index
--     goes, and the ROLLBACK below recreates it if a restore ever wants it.
--
--   parts_consumption_asset_idx (asset_code)                    3,240 kB
--     No `.eq/.order/.in('asset_code')` anywhere in src/ or mobile/. Server-side, all 22
--     functions that mention asset_code use it as `IS NOT NULL` + `GROUP BY asset_code`
--     (get_parts_expense_snapshot, get_tyre_cost_by_asset, get_asset_master,
--     get_asset_ownership), never `asset_code = <value>`, and those aggregates carry an
--     organisation_id predicate so they are served by parts_consumption_org_asset_idx
--     (56 scans), which remains.
--
--   parts_consumption_date_idx (txn_date)                       3,080 kB
--     The strongest case in the file, and instructive: a query shape DOES exist server
--     side, and a plain btree provably cannot serve it. get_expense_yearly_trend and
--     get_expense_period_trend filter `where txn_date ~ '^\d{4}'` / `~ '^\d{4}-\d{2}'` -
--     a REGEX on a text column. `~` is not a btree-indexable operator, and the pattern is
--     a character class, not a literal prefix, so even text_pattern_ops would not help.
--     In src/ `txn_date` appears only as an import header-mapping name (partsExpense.js,
--     importTargets.js), never in a filter. PROJECT_MEMORY already records that the DATE
--     column the RPCs really bound on is `event_date` (V361 added org+country+event_date
--     for exactly that reason). Recorded here so nobody "restores" this index believing
--     they are helping the expense-trend RPCs.
--
--   idx_domain_events_org_time (organisation_id, created_at DESC) 3,280 kB
--     listDomainEvents() applies no org filter (RLS supplies it) and orders by id, not
--     created_at. The RLS org term is a disjunction (`organisation_id IS NULL OR = X`),
--     which appears in Filter, not Index Cond, and is not indexable. No function filters
--     org+created_at on this table.
--
--   idx_work_orders_tyre_serial (tyre_serial)                   1,760 kB
--     `tyre_serial` appears in work_orders only as a PROJECTED column in the WO_COLS
--     select list (src/lib/api/workOrders.js:9). Projecting a column never uses an index
--     on it. Every other match in the repo is a different table (rca_records,
--     corrective_actions) or a test fixture. No filter, no order, no server predicate.
--
--   material_master_category_idx (category)                       624 kB
--     Live shape exists but the planner refuses it - see the discrimination note above.
--
--
-- **WHAT WAS REFUSED AND WHY - do not "finish the job" by dropping these.**
--
--   idx_work_orders_work_type          planner chooses it (refusal 1)
--   material_master_review_idx         planner chooses it (refusal 2)
--   idx_domain_events_type_time        planner chooses it (refusal 3)
--
--   ux_work_orders_client_uuid         UNIQUE. 0 scans, but it is the mobile offline
--                                     idempotency key (ON CONFLICT client_uuid). A UNIQUE
--                                     index is correctness, never a cache optimisation.
--   ux_ksa_asset_master_upload_file_asset  UNIQUE, same rule.
--   work_order_line_items_pkey,
--   material_master_pkey               0 scans but PRIMARY KEY. Never dropped.
--
--   idx_audit_v2_user (5280 kB)        REFUSED ON TWO GROUNDS. It supports a FOREIGN KEY
--                                     (audit_log_v2.user_id -> profiles); dropping the
--                                     referencing-side index degrades any profile deletion
--                                     to a seq scan over ~503k audit rows, and account
--                                     deletion is a real flow (V317). It is also the table
--                                     a sibling agent is actively reworking under V583, so
--                                     leaving its indexes untouched avoids a collision.
--   idx_work_orders_created_by,
--   idx_tyre_records_uploaded_by       Also FK-supporting (checked via pg_constraint by
--                                     matching conkey to the index key columns). Kept for
--                                     the same cascade-cost reason.
--
--   knowledge_documents_embedding_idx,
--   idx_inspection_embeddings_embedding,
--   idx_chunks_embedding               3 ivfflat vector indexes, ~4.8 MB, all 0 scans
--                                     because RAG is barely exercised. Refused: an ivfflat
--                                     index is trained on the data present at build time,
--                                     so dropping and recreating it later is not a
--                                     round-trip. Cheap to keep, awkward to restore.
--                                     Candidate only if the owner confirms RAG is retired.
--
--   idx_tyre_records_cleaned,
--   idx_tyre_records_data_source,
--   idx_tyre_records_vehicle_type      176 kB each, 0 scans. `cleaned` has many live shapes
--                                     (src/lib/api/dataCleaning.js `.eq('cleaned',false)`)
--                                     and was NOT EXPLAINed, so it is left alone rather
--                                     than guessed at. The other two are plausible future
--                                     candidates but each needs its own verification, and
--                                     528 kB does not justify a loose call. Deliberately
--                                     left, not overlooked.
--
--
-- **THE ONE MISSING INDEX. CONFIRMED BY EXPLAIN, NOT ASSUMED - AND IT NEEDED AN ANALYZE.**
--
-- The brief's instruction was to add nothing speculatively. The candidate found itself:
-- `ksa_country_upload_template_staging` is the worst read amplifier in the database and
-- ties directly to a standing PROJECT_MEMORY open item ("get_tyre_gap_overview and
-- tyre_learn_suggestions run a pre-existing expensive correlated subquery over the 192k-row
-- ksa_country_upload_template_staging and exceeded a 45s statement timeout under load").
--
--   seq_scan 3,069 | seq_tup_read 588,199,472 | avg 191,658 rows per scan
--   idx_scan 1     | 282,352 rows | 149 MB heap | ONLY a pkey existed
--
-- get_tyre_gap_overview runs this as a CORRELATED subquery, once per tyre_records row:
--   exists (select 1 from ksa_country_upload_template_staging m
--           where upper(btrim(m.tyre_brand)) not in ('NULL','N/A','NA','-','NONE','')
--             and (upper(btrim(m.srno))        = upper(btrim(t.serial_no))
--               or upper(btrim(m.old_serialno))= upper(btrim(t.serial_no))))
-- 11,193 outer rows x 282,352 inner rows is ~3.1 billion comparisons per call. The join
-- keys are EXPRESSIONS, which is why no plain column index has ever helped.
--
-- MEASURED on one serial lookup (the unit the correlated subquery repeats):
--   before                      Seq Scan, Rows Removed by Filter 170,325   10,110 buffers
--   + 2 expression indexes      Seq Scan  (planner IGNORED them)            5,151 buffers
--   + the same 2 indexes ANALYZEd   BitmapOr of both indexes                    9 buffers
--                                     Bitmap Index Scan on ..._srno_expr
--                                     Bitmap Index Scan on ..._old_serialno_expr
--
-- **THE ANALYZE IS LOAD-BEARING AND IS THE REAL LESSON.** With the indexes present but
-- unanalyzed the planner ignored them completely and kept the seq scan - which is exactly
-- how a correct index gets judged useless and reverted. An expression index carries no
-- statistics until the table is ANALYZEd, and this table has last_analyze NULL. The
-- ANALYZE below is therefore part of the fix, not housekeeping.
--
-- Cost of the addition is small and the write side is irrelevant here: this is a
-- bulk-loaded staging table, not a transactional one.
--   upper(btrim(srno))         2176 kB
--   upper(btrim(old_serialno)) 2016 kB   = 4,192 kB added
--
-- 10,110 -> 9 buffers is quoted instead of 441 ms -> 1.3 ms on purpose: pages touched is
-- deterministic, wall time on this instance is not.
--
--
-- LOCKING. DROP INDEX and CREATE INDEX both take ACCESS EXCLUSIVE on the parent table.
-- Every DROP here is a metadata operation (milliseconds); the two CREATEs scan a 149 MB
-- staging table that carries no live user traffic (idx_scan 1 in 6.4 days). `lock_timeout`
-- is set so that if a long report is mid-flight this migration FAILS FAST and rolls back
-- rather than queueing behind it and blocking every subsequent query on a hot table. On a
-- timeout, simply re-run. Nothing here needs CONCURRENTLY: no drop rebuilds anything, and
-- the one table being indexed is not user-facing.
--
--
-- ROLLBACK (complete; every statement read from pg_indexes.indexdef, not retyped):
--
--   CREATE INDEX idx_domain_events_entity ON public.domain_events USING btree (entity_type, entity_id);
--   CREATE INDEX _bucket_snap_i ON public._bucket_snapshot_20260727 USING btree (id);
--   CREATE INDEX idx_production_logs_org ON public.production_logs USING btree (organisation_id);
--   CREATE INDEX idx_domain_events_org_time ON public.domain_events USING btree (organisation_id, created_at DESC);
--   CREATE INDEX parts_consumption_asset_idx ON public.parts_consumption USING btree (asset_code);
--   CREATE INDEX parts_consumption_date_idx ON public.parts_consumption USING btree (txn_date);
--   CREATE INDEX wo_line_items_org_country_idx ON public.work_order_line_items USING btree (organisation_id, country);
--   CREATE INDEX parts_consumption_org_idx ON public.parts_consumption USING btree (organisation_id);
--   CREATE INDEX wo_line_items_org_idx ON public.work_order_line_items USING btree (organisation_id);
--   CREATE INDEX work_orders_org_country_idx ON public.work_orders USING btree (organisation_id, country);
--   CREATE INDEX idx_work_orders_org ON public.work_orders USING btree (organisation_id);
--   CREATE INDEX idx_work_orders_tyre_serial ON public.work_orders USING btree (tyre_serial);
--   CREATE INDEX material_master_category_idx ON public.material_master USING btree (category);
--   CREATE INDEX idx_tyre_records_risk_level ON public.tyre_records USING btree (risk_level);
--   DROP INDEX IF EXISTS public.ksa_staging_srno_expr_idx;
--   DROP INDEX IF EXISTS public.ksa_staging_old_serialno_expr_idx;
--
-- =====================================================================================

set local lock_timeout = '5s';

-- -------------------------------------------------------------------------------------
-- CATEGORY A - structurally redundant (a wider btree with the same leading columns,
-- same opclass/collation/sort options and the same partial predicate, already exists).
-- -------------------------------------------------------------------------------------
drop index if exists public.idx_production_logs_org;
drop index if exists public.wo_line_items_org_country_idx;
drop index if exists public.parts_consumption_org_idx;
drop index if exists public.wo_line_items_org_idx;
drop index if exists public.work_orders_org_country_idx;
drop index if exists public.idx_work_orders_org;
drop index if exists public.idx_tyre_records_risk_level;

-- -------------------------------------------------------------------------------------
-- CATEGORY B - 0 scans over 6.4 unbroken days AND no query shape a btree could serve,
-- corroborated in src/ + mobile/ and in pg_proc.
-- -------------------------------------------------------------------------------------
drop index if exists public.idx_domain_events_entity;
drop index if exists public._bucket_snap_i;
drop index if exists public.idx_domain_events_org_time;
drop index if exists public.parts_consumption_asset_idx;
drop index if exists public.parts_consumption_date_idx;
drop index if exists public.idx_work_orders_tyre_serial;
drop index if exists public.material_master_category_idx;

-- -------------------------------------------------------------------------------------
-- THE MISSING INDEX: expression indexes on the two serial columns the correlated
-- EXISTS in get_tyre_gap_overview / tyre_learn_suggestions joins on.
-- The ANALYZE is REQUIRED: without expression statistics the planner ignores both.
-- -------------------------------------------------------------------------------------
create index if not exists ksa_staging_srno_expr_idx
  on public.ksa_country_upload_template_staging (upper(btrim(srno)));

create index if not exists ksa_staging_old_serialno_expr_idx
  on public.ksa_country_upload_template_staging (upper(btrim(old_serialno)));

analyze public.ksa_country_upload_template_staging;

comment on index public.ksa_staging_srno_expr_idx is
  'V584. Serves the correlated EXISTS in get_tyre_gap_overview / tyre_learn_suggestions, '
  'which joins on upper(btrim(srno)). Measured 10,110 -> 9 shared buffers per serial '
  'lookup. REQUIRES table statistics: an expression index is inert until ANALYZE runs, '
  'and the planner was observed ignoring this index entirely before it was analyzed.';

comment on index public.ksa_staging_old_serialno_expr_idx is
  'V584. Sibling of ksa_staging_srno_expr_idx. Both are needed because the predicate is '
  'an OR across srno and old_serialno, which the planner resolves as a BitmapOr; dropping '
  'either one returns the plan to a full sequential scan of the 282k-row staging table.';
