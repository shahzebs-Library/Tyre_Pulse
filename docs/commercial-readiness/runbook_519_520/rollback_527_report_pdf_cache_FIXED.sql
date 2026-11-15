-- Corrected rollback for #527 draft 20261117090000_report_pdf_cache.sql (header block fails, see GROUP_B_RELEASE_PACKAGE.md defect B-1).
-- Order: storage policies, tables (their policies, indexes and trigger go with them), functions, the two pure functions
-- the header forgot, then the bucket row. Run only after 20261117091000 is rolled back and after stored files were
-- removed through the Storage API. Rehearsed on local tp_final 2026-11-15: fingerprint back to the pre-#527 state.
begin;
drop policy if exists report_pdfs_read on storage.objects;
drop policy if exists report_pdfs_upload on storage.objects;
drop policy if exists report_pdfs_reupload on storage.objects;
drop table if exists public.report_pdf_settings_events;
drop table if exists public.report_pdf_settings;
drop table if exists public.report_pdf_events;
drop table if exists public.report_pdf_files;
drop function if exists public.pdf_cache_record_download(uuid,text);
drop function if exists public.pdf_cache_regenerate(text,uuid,text,text,text,text,text,integer);
drop function if exists public.pdf_cache_fail(uuid,text,boolean,boolean);
drop function if exists public.pdf_cache_complete(uuid,text,bigint);
drop function if exists public.pdf_cache_heartbeat(uuid,integer);
drop function if exists public.pdf_cache_claim(text,uuid,text,text,text,text,integer,boolean);
drop function if exists public.pdf_cache_lookup(text,uuid,text,text,text);
drop function if exists public.pdf_cache_key_for(text,uuid,text,text,text);
drop function if exists public.pdf_cache_source(text,uuid);
drop function if exists public.pdf_cache_can_see(uuid,text,text);
drop function if exists public.pdf_cache_source_visible(text,uuid);
drop function if exists public.pdf_cache_update_settings(integer,integer,boolean);
drop function if exists public.pdf_cache_settings();
drop function if exists public.pdf_cache_can_regenerate_approved();
drop function if exists public.pdf_cache_effective_settings(uuid);
drop function if exists public.report_pdf_files_guard();
drop function if exists public.pdf_cache_compose_key(uuid,text,uuid,text,text,text,text,text);
drop function if exists public.pdf_sha256_hex(text);
drop function if exists public.pdf_canonical_json(jsonb);
drop function if exists public.pdf_canonical_json(jsonb);
drop function if exists public.pdf_sha256_hex(text);
delete from storage.buckets where id = 'report-pdfs';
commit;
