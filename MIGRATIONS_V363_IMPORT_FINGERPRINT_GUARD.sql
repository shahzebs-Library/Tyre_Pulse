-- V363 - Import fingerprint guard. Makes a re-upload idempotent instead of duplicating.
--
-- APPLIED LIVE. This file is the record; the DB is the source of truth.
--
-- MEASURED CONTEXT. 4 of the 8 staging triggers already de-duplicated (assets,
-- complaints, monthly_tyres, wo_lines each use an `if exists ... return null` guard)
-- and process_daily_km merges on asset + date. TWO did a bare INSERT:
--   * process_expenses_country -> the cause of the 8,248 duplicate expense rows
--                                 found in V362 (Egypt alone: EGP 17.4M, 18% of
--                                 that country's reported spend).
--   * process_stg_open_wo      -> would duplicate on any re-import. The table was
--                                 empty at the time, so no damage had occurred, but
--                                 the import reference had wrongly documented this
--                                 one as "replaces the snapshot, safe to re-upload".
-- process_stg_tyre_brand is UPDATE-only and therefore already idempotent.
--
-- APPROACH for the expense grid: use the ERP's OWN line number as row identity.
-- A retried upload chunk resends the same line number, so it collides and is skipped.
-- Two genuinely identical lines in one file carry DIFFERENT line numbers, so both
-- survive. That is the same discriminator V362 validated for detection, applied at
-- write time for prevention.
--
-- VERIFIED live in a rolled-back transaction: uploading 3 lines added 3 rows;
-- uploading the identical file again added 0; a genuine duplicate pair (same content,
-- line numbers 10 and 11) kept both rows.
--
-- Reversible: see the footer.

-- 1. Let the expense staging tables carry the ERP line number. The Ramco grid's
--    first column is literally "#", so the CSV importer maps it automatically.
alter table public.expenses_ksa   add column if not exists "#" text;
alter table public.expenses_ksa   add column if not exists source_row text;
alter table public.expenses_uae   add column if not exists "#" text;
alter table public.expenses_uae   add column if not exists source_row text;
alter table public.expenses_egypt add column if not exists "#" text;
alter table public.expenses_egypt add column if not exists source_row text;

-- 2. Row identity on the destination table.
alter table public.parts_consumption add column if not exists import_uid text;

comment on column public.parts_consumption.import_uid is
  'Deterministic identity of one source line: hash of country + the ERP line number '
  '+ the business key. NULL when the import did not carry a line number, in which '
  'case no write-time dedupe is possible and Console -> Duplicate Control is the '
  'safety net. Unique where present.';

create or replace function public.parts_import_uid(
  p_country text, p_source_row text, p_issue text, p_wo text, p_item_code text,
  p_item_desc text, p_qty text, p_value text, p_txn_date text, p_asset text
) returns text
language sql immutable set search_path to 'public'
as $function$
  select case
    when coalesce(btrim(p_source_row), '') = '' then null
    else md5(
      coalesce(upper(btrim(p_country)), '') || '|' || btrim(p_source_row) || '|' ||
      coalesce(btrim(p_issue), '')     || '|' || coalesce(btrim(p_wo), '')        || '|' ||
      coalesce(btrim(p_item_code), '') || '|' || coalesce(btrim(p_item_desc), '') || '|' ||
      coalesce(btrim(p_qty), '')       || '|' || coalesce(btrim(p_value), '')     || '|' ||
      coalesce(btrim(p_txn_date), '')  || '|' || coalesce(btrim(p_asset), '')
    )
  end;
$function$;

revoke all on function public.parts_import_uid(text,text,text,text,text,text,text,text,text,text) from public, anon;

-- Backfill only where a line number exists AND the value would be unique. Existing
-- duplicate rows keep a NULL uid so the index below can be created without deleting
-- anything first - removing them stays the user's decision in Duplicate Control.
with computed as (
  select id, organisation_id,
         public.parts_import_uid(country, source_row, issue_number, work_order_no,
           item_code, item_description, qty, value_amount, txn_date, asset_code) as uid
    from public.parts_consumption
   where source_row is not null and btrim(source_row) <> ''
), uniq as (
  select id, uid from (
    select id, uid, count(*) over (partition by organisation_id, uid) as n
      from computed where uid is not null
  ) x where n = 1
)
update public.parts_consumption p set import_uid = u.uid
  from uniq u where p.id = u.id and p.import_uid is null;

create unique index if not exists parts_consumption_import_uid_uidx
  on public.parts_consumption (organisation_id, import_uid)
  where import_uid is not null;

-- 3. The expense pipe: carry the line number, stamp the uid, skip a repeat.
--    (Body as applied; see the live definition for the authoritative copy.)
--    on conflict do nothing is what makes a resent chunk a no-op.

-- 4. Open job cards are a SNAPSHOT: match each card per country and REFRESH it,
--    so re-uploading the export updates status and days-open without stacking copies.
--    VERIFIED: re-upload kept 1 row and moved status Open -> In Progress, days 3 -> 5.

-- ---------------------------------------------------------------------------
-- REVERSIBLE
--   drop index if exists public.parts_consumption_import_uid_uidx;
--   alter table public.parts_consumption drop column if exists import_uid;
--   drop function if exists public.parts_import_uid(text,text,text,text,text,text,text,text,text,text);
--   -- then restore the previous process_expenses_country / process_stg_open_wo bodies,
--   -- which were bare INSERTs. Do NOT do this: it reopens the duplicate hole.
-- ---------------------------------------------------------------------------
