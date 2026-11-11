-- Expense re-upload guard: index the content dedupe so a big grid upload no longer times out.
--
-- STATUS: APPLIED 2026-11-11 (ledger version 20261111141914). Verified live, rolled back:
--   218,605 rows all hashed (0 null); the guard lookup is now a Bitmap Index Scan on
--   idx_parts_reupload_hash (1.9ms vs a 218k-row seq scan); 0 live rows contain the chr(30)/
--   chr(31) separators, so the null-safe hash == the old ten-column IS NOT DISTINCT FROM; a
--   content-duplicate upload is skipped + logged 'already_stored' and a genuinely-new line lands.
--
-- PROBLEM (owner-reported 2026-11-11: "ERP intake takes time to upload then it's failed"):
--   20261111109000 added expense_reupload_guard() as a BEFORE INSERT trigger whose body runs,
--   for EVERY row, a COUNT(*) over the whole ~216k-row parts_consumption table using ten
--   `IS NOT DISTINCT FROM` predicates. `IS NOT DISTINCT FROM` is not btree-usable, so each row
--   is a full Seq Scan. A large grid upload therefore pays seq-scan x rows and hits the Postgres
--   statement timeout (57014); the web client classified 57014 as transient and retried the
--   identical deterministically-timing-out insert 6x + a deferred sweep = "slow, then failed".
--   The COUNT(*) runs even for first-time (non-duplicate) rows, so it slows normal uploads too.
--   (The client half - treat 57014 as fatal/fail-fast - shipped separately in partsConsumption.js.)
--
-- FIX: add a STORED generated content hash (null-safe, same 10 columns the guard already dedupes
--   on), index it, and have the guard look up prior copies by `reupload_hash = <hash> and
--   created_at < now()` instead of ten `IS NOT DISTINCT FROM` columns. The seq scan becomes an
--   index probe. The multiplicity GUC counter, the restore window, the bypass flag and the
--   reject logging are UNCHANGED, so the dedupe BEHAVIOUR is preserved.
--
-- NULL-SAFE HASH: `IS NOT DISTINCT FROM` treats NULL=NULL as a match. The hash encodes a NULL as
--   chr(31) (unit separator) and delimits fields with chr(30) (record separator); neither ever
--   appears in expense text, so hash-equality == the ten-column IS NOT DISTINCT FROM. The old
--   guard's multiplicity key used a non-null-safe concat_ws md5 - this change makes the prior-count
--   and the multiplicity key use the SAME null-safe hash, which also removes that latent mismatch.
--   event_date is encoded as integer days (immutable) so the generated column is IMMUTABLE and the
--   guard computes the byte-identical value from NEW.
--
-- NOTE: adding a STORED generated column rewrites parts_consumption once under ACCESS EXCLUSIVE
--   (seconds for ~216k rows). Apply in a quiet window.

alter table public.parts_consumption
  add column if not exists reupload_hash text
  generated always as (
    md5(
      coalesce(organisation_id::text, chr(31)) || chr(30) ||
      coalesce(country, chr(31))               || chr(30) ||
      coalesce((event_date - date '1970-01-01')::text, chr(31)) || chr(30) ||
      coalesce(issue_number, chr(31))          || chr(30) ||
      coalesce(work_order_no, chr(31))         || chr(30) ||
      coalesce(item_code, chr(31))             || chr(30) ||
      coalesce(qty::text, chr(31))             || chr(30) ||
      coalesce(value_amount::text, chr(31))    || chr(30) ||
      coalesce(store_code, chr(31))            || chr(30) ||
      coalesce(cost_center, chr(31))
    )
  ) stored;

create index if not exists idx_parts_reupload_hash
  on public.parts_consumption (reupload_hash, created_at);

create or replace function public.expense_reupload_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prior int;
  v_hash  text;
  v_key   text;
  v_seen  int;
begin
  if coalesce(current_setting('tp.allow_dup_expense', true), '') = 'on' then
    return new;
  end if;
  -- only fresh uploads; restored rows keep their original created_at
  if new.created_at is not null and new.created_at < now() - interval '1 minute' then
    return new;
  end if;

  -- Same ten-column content key, encoded null-safe + immutable so it equals the stored
  -- reupload_hash generated column (which the index serves). event_date as integer days.
  v_hash := md5(
      coalesce(new.organisation_id::text, chr(31)) || chr(30) ||
      coalesce(new.country, chr(31))               || chr(30) ||
      coalesce((new.event_date - date '1970-01-01')::text, chr(31)) || chr(30) ||
      coalesce(new.issue_number, chr(31))          || chr(30) ||
      coalesce(new.work_order_no, chr(31))         || chr(30) ||
      coalesce(new.item_code, chr(31))             || chr(30) ||
      coalesce(new.qty::text, chr(31))             || chr(30) ||
      coalesce(new.value_amount::text, chr(31))    || chr(30) ||
      coalesce(new.store_code, chr(31))            || chr(30) ||
      coalesce(new.cost_center, chr(31))
  );

  select count(*) into v_prior
  from public.parts_consumption p
  where p.reupload_hash = v_hash
    and p.created_at < now();   -- same-txn rows share now() so are never compared

  if v_prior = 0 then
    return new;
  end if;

  v_key := 'tp_expdup.k' || v_hash;
  v_seen := coalesce(nullif(current_setting(v_key, true), ''), '0')::int;

  if v_seen >= v_prior then
    return new;               -- earlier copies already matched; this one is extra in the file
  end if;

  perform set_config(v_key, (v_seen + 1)::text, true);
  begin
    insert into public.expense_import_rejects
      (organisation_id, uploaded_country, detected_country, work_order_no, item_code,
       item_description, value_amount, source_row, reject_reason)
    values (new.organisation_id, new.country, new.country, new.work_order_no, new.item_code,
            new.item_description, new.value_amount::numeric, new.source_row::text, 'already_stored');
  exception when others then null;  -- logging must never block the import
  end;
  return null;
end;
$$;

revoke all on function public.expense_reupload_guard() from public;
revoke all on function public.expense_reupload_guard() from anon, authenticated;

-- The trigger already binds to this function (20261111109000); CREATE OR REPLACE keeps it. No DROP.

-- VERIFY (separate calls; rolled back where they write):
--   -- 1. every row got a hash:
--   select count(*) as null_hashes from public.parts_consumption where reupload_hash is null;  -- 0
--   -- 2. the guard's lookup now uses the index, not a seq scan (pick a real stored hash):
--   explain (analyze, buffers)
--     select count(*) from public.parts_consumption p
--      where p.reupload_hash = (select reupload_hash from public.parts_consumption limit 1)
--        and p.created_at < now();                                         -- Index Scan on idx_parts_reupload_hash
--   -- 3. behaviour preserved (rolled back): re-insert one existing line as a fresh upload -> skipped.
--   begin;
--     -- as service role, insert a row whose 10 key columns copy an existing stored line, created_at = now();
--     -- expect: 0 new parts_consumption rows for that key beyond the original, +1 expense_import_rejects 'already_stored'.
--   rollback;
--   -- 4. a genuinely new line still lands (rolled back).
--
-- ROLLBACK:
--   drop index if exists public.idx_parts_reupload_hash;
--   alter table public.parts_consumption drop column if exists reupload_hash;
--   -- then re-apply the guard body from supabase/migrations/20261111109000_expense_reupload_content_guard.sql
