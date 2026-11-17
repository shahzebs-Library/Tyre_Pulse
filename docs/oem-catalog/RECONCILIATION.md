# Data reconciliation plan: 20261118100000_oem_catalog_advanced

Nothing here is run by the agent (no production access). The owner or lead runs it around the migration.

## Why the risk is low
Only additive columns and new tables are created. No existing row, id, storage path or work-order reference is changed. The one behavioural change is who may write (admin only).

## Before applying (save the output)
```sql
select count(*) manuals, (select count(*) from public.oem_parts_entries) entries from public.oem_parts_manuals;
select md5(string_agg(id::text || part_no || description || coalesce(quantity::text,''), '|' order by id)) entries_fingerprint from public.oem_parts_entries;
select count(*) objects from storage.objects where bucket_id = 'oem-parts-catalogs';
select policyname, cmd from pg_policies where tablename in ('oem_parts_manuals','oem_parts_entries') order by 1;
select policyname, cmd from pg_policies where schemaname='storage' and policyname like 'oem_parts_pdf%' order by 1;
```

## After applying
1. Re-run the first three queries: counts and `entries_fingerprint` must be identical.
2. Policies: insert, update and delete on both tables and the three storage write policies now call `oem_catalog_admin()`; select policies unchanged.
3. `select count(*) from public.oem_parts_entries where review_status <> 'published' or admin_corrected` must be 0.
4. Run `docs/oem-catalog/VINAY_ACCESS.md` section 3 and an admin import of a small PDF; confirm both outcomes.

## Existing manuals (reprocess, optional, later)
Use the reprocess preview in the review workspace. It lists new parts, changed values, category changes, duplicate candidates and uncertain records, and shows admin-corrected or work-order-referenced records as protected: they are never overwritten. Nothing is written until an admin approves the preview.

## Rollback
`20261118100000_oem_catalog_advanced_ROLLBACK.sql`. Export `oem_figures`, `oem_review_items`, `oem_corrections` and `oem_category_rules` first; the rollback drops them. Added columns on existing tables are kept.
