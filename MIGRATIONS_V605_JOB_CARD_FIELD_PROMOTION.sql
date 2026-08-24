-- ============================================================================
-- V605. Promote five job-card fields out of custom_data into typed columns.
--
-- STATUS: APPLIED + VERIFIED LIVE on jhssdmeruxtrlqnwfksc (2026-08-24).
--
-- APPLIED IN TWO STEPS, and the recorded migration is the first of them. The
-- row in supabase_migrations (`v605_job_card_field_promotion`) carries sections
-- 1, 2 and 4 - the columns, the snapshot and the trigger patch. Section 3, the
-- backfill, was run separately so a 30,239-row UPDATE could not time out inside
-- the DDL transaction. This file holds all four together because that is the
-- correct order to replay them in; on a fresh database the backfill is a no-op
-- (there are no pre-existing rows to promote), so replaying the whole file and
-- replaying only the recorded migration reach the same end state.
--
-- WHY. The ERP job-card export carries 34 mapped data columns. V381/V385/V386
-- land most of them on `work_orders` as typed columns, but FIVE were only ever
-- written into the `custom_data` jsonb:
--
--     MR NO             -> custom_data.mr_no
--     SCO NO            -> custom_data.sco_no
--     Asset Description -> custom_data.asset_description
--     Truck Category    -> custom_data.truck_category
--     Head/Tail         -> custom_data.head_tail
--
-- A value inside jsonb cannot be filtered on, sorted by, indexed, or corrected
-- from the app. So the Work Orders page could not show them and the user could
-- not edit them, even though the data was sitting in the database.
--
-- MEASURED BEFORE APPLYING (work_orders = 90,535 rows):
--     asset_description   30,239 rows carry a value in custom_data
--     mr_no                    0
--     sco_no                   0
--     truck_category           0
--     head_tail                0
--
-- A field at 0 is NOT proof the export lacks it. "Job Card Created By/Date" are
-- separately known to have failed import on invisible NBSP whitespace (V386),
-- and the same class of problem may be why these four are empty. The columns are
-- added regardless so the next clean import has somewhere typed to land.
--
-- BACKFILL COST, stated rather than discovered later. The asset_description
-- backfill UPDATEs 30,239 rows, and `trg_audit_row` fires per row, so it writes
-- ~30,239 rows (~20 MB) into audit_log_v2. That is one bulk-import day's worth
-- of audit growth on a 557 MB table. It was taken deliberately: leaving the
-- typed column half-populated while custom_data holds the rest is exactly the
-- trap this codebase keeps getting caught by - a later filter on the typed
-- column would silently miss 30,239 cards.
--
-- NO TRIGGER IS DISABLED. The BEFORE triggers on work_orders are safe for a
-- non-status update: trg_status_cap_work_orders only acts on a status change
-- (V242), trg_notify_workshop_qc only on qc_status, and trg_audit_row_change
-- skips its profiles lookup because auth.uid() is NULL in a migration (V499).
--
-- ROLLBACK
--   -- restore the pre-backfill values (they were all NULL, so this just clears)
--   update public.work_orders w
--      set asset_description = b.asset_description,
--          mr_no             = b.mr_no,
--          sco_no            = b.sco_no,
--          truck_category    = b.truck_category,
--          head_tail         = b.head_tail
--     from _bak.wo_jobcard_promote_v605 b
--    where b.id = w.id;
--   -- then drop the columns and re-apply the V386 body of process_stg_job_cards
--   alter table public.work_orders
--     drop column if exists mr_no, drop column if exists sco_no,
--     drop column if exists asset_description, drop column if exists truck_category,
--     drop column if exists head_tail;
-- ============================================================================

-- ── 1. The columns ──────────────────────────────────────────────────────────
alter table public.work_orders
  add column if not exists mr_no             text,
  add column if not exists sco_no            text,
  add column if not exists asset_description text,
  add column if not exists truck_category    text,
  add column if not exists head_tail         text;

comment on column public.work_orders.mr_no is
  'Job card MR NO: the material request the card draws parts against. From the ERP export column "MR NO".';
comment on column public.work_orders.sco_no is
  'Job card SCO NO: the sub-contract order when the work is bought out. From the ERP export column "SCO NO".';
comment on column public.work_orders.asset_description is
  'Plain description of the machine as the ERP names it. From the export column "Asset Description". Backfilled from custom_data by V605.';
comment on column public.work_orders.truck_category is
  'Truck category from the ERP export column "Truck Category". Distinct from asset_category.';
comment on column public.work_orders.head_tail is
  'Which half of an articulated unit the card is against. From the ERP export column "Head/Tail".';

-- ── 2. Snapshot, so the backfill is reversible ──────────────────────────────
create schema if not exists _bak;

drop table if exists _bak.wo_jobcard_promote_v605;
create table _bak.wo_jobcard_promote_v605 as
select id, mr_no, sco_no, asset_description, truck_category, head_tail
  from public.work_orders
 where custom_data ?| array['mr_no','sco_no','asset_description','truck_category','head_tail'];

-- ── 3. Backfill from custom_data ────────────────────────────────────────────
-- One statement per column, each guarded so it can only ever FILL a null.
update public.work_orders
   set mr_no = custom_data->>'mr_no'
 where mr_no is null and custom_data->>'mr_no' is not null;

update public.work_orders
   set sco_no = custom_data->>'sco_no'
 where sco_no is null and custom_data->>'sco_no' is not null;

update public.work_orders
   set asset_description = custom_data->>'asset_description'
 where asset_description is null and custom_data->>'asset_description' is not null;

update public.work_orders
   set truck_category = custom_data->>'truck_category'
 where truck_category is null and custom_data->>'truck_category' is not null;

update public.work_orders
   set head_tail = custom_data->>'head_tail'
 where head_tail is null and custom_data->>'head_tail' is not null;

-- ── 4. Teach the importer to write the typed columns ────────────────────────
-- The live body is read with pg_get_functiondef and patched by ANCHORED
-- replacement, never retyped: a 7.5k-char body transcribed by hand is how a
-- subtle behaviour change ships unnoticed. Each anchor must occur EXACTLY once
-- or the whole migration aborts - a partial patch reads like a complete one.
--
-- custom_data keeps receiving the same keys. That is deliberate: it preserves
-- provenance, costs nothing, and the app reader (jobCard.readField) prefers the
-- typed column anyway.
do $mig$
declare
  v_def text;
  v_new text;
  a_cols  constant text := 'waiting_parts_hours, waiting_manpower_hours, manpower_hours, custom_data)';
  a_vals  constant text := 'v_wait_p, v_wait_m, v_mp_hrs, v_extra)';
  a_upd   constant text := 'custom_data = coalesce(work_orders.custom_data,''{}''::jsonb) || excluded.custom_data,';
  n int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'process_stg_job_cards';

  if v_def is null then
    raise exception 'V605 aborted: process_stg_job_cards not found';
  end if;

  -- Guard every anchor before touching anything. Counted by literal string
  -- length difference, NOT by regex: the anchors contain (, ), | and {} and any
  -- escaping mistake in a regex guard would silently match zero and abort a
  -- migration that is actually fine, or worse match loosely.
  n := (length(v_def) - length(replace(v_def, a_cols, ''))) / length(a_cols);
  if n <> 1 then raise exception 'V605 aborted: column-list anchor found % times, expected 1', n; end if;

  n := (length(v_def) - length(replace(v_def, a_vals, ''))) / length(a_vals);
  if n <> 1 then raise exception 'V605 aborted: values anchor found % times, expected 1', n; end if;

  n := (length(v_def) - length(replace(v_def, a_upd, ''))) / length(a_upd);
  if n <> 1 then raise exception 'V605 aborted: do-update anchor found % times, expected 1', n; end if;

  v_new := replace(v_def, a_cols,
    'waiting_parts_hours, waiting_manpower_hours, manpower_hours, '
    || 'mr_no, sco_no, asset_description, truck_category, head_tail, custom_data)');

  v_new := replace(v_new, a_vals,
    'v_wait_p, v_wait_m, v_mp_hrs, '
    || 'public._stg_pick(j,''MR NO''), '
    || 'public._stg_pick(j,''SCO NO''), '
    || 'public._stg_pick(j,''Asset Description''), '
    || 'public._stg_pick(j,''Truck Category''), '
    || 'public._stg_pick(j,''Head/Tail''), '
    || 'v_extra)');

  -- coalesce(excluded.x, work_orders.x) so a re-import can never blank a value
  -- somebody corrected in the app. This mirrors how every other column here is
  -- handled - do not change it to a plain excluded.x.
  v_new := replace(v_new, a_upd,
    'mr_no             = coalesce(excluded.mr_no,             work_orders.mr_no),'             || E'\n    ' ||
    'sco_no            = coalesce(excluded.sco_no,            work_orders.sco_no),'            || E'\n    ' ||
    'asset_description = coalesce(excluded.asset_description, work_orders.asset_description),' || E'\n    ' ||
    'truck_category    = coalesce(excluded.truck_category,    work_orders.truck_category),'    || E'\n    ' ||
    'head_tail         = coalesce(excluded.head_tail,         work_orders.head_tail),'         || E'\n    ' ||
    a_upd);

  if v_new = v_def then
    raise exception 'V605 aborted: replacement produced no change';
  end if;

  execute v_new;
end $mig$;
