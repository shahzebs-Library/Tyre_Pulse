-- =============================================================================
-- Report export jobs: DESIGN DRAFT for a later server-side bulk ZIP worker.
-- STATUS: AUTHORED, NOT APPLIED, NOT USED BY ANY CODE. Do not apply until an edge
-- function worker exists. Today bulk ZIP runs in the browser (src/lib/pdfCache/bulkZip.js)
-- from the stored PDFs; this table is what a server job would need for exports too
-- large for a browser (more than 100 reports, or to be emailed as a link).
-- Depends on 20261117090000_report_pdf_cache.sql.
--
-- Worker outline (not built): cron every minute -> edge function claims one job
-- (lease), reads report_pdf_files rows in the job's organisation, streams each stored
-- PDF into a ZIP in the private bucket tenant-exports under
-- <org>/report-exports/<job id>.zip with manifest.csv and manifest.json, marks the
-- job ready and notifies the requester. Missing PDFs are listed in the manifest with
-- reason "not_generated": a server without a browser cannot draw them.
--
-- ROLLBACK (by hand): drop table if exists public.report_export_jobs;
-- =============================================================================
create table if not exists public.report_export_jobs (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  requested_by     uuid not null default auth.uid(),
  report_type      text not null check (report_type in ('tyre_inspection','tyre_observation')),
  source_ids       uuid[] not null check (cardinality(source_ids) between 1 and 1000),
  status           text not null default 'queued' check (status in ('queued','processing','ready','failed','expired')),
  included         integer not null default 0,
  missing          integer not null default 0,
  manifest         jsonb,
  zip_path         text,
  zip_bytes        bigint,
  lease_owner      text,
  lease_expires_at timestamptz,
  attempts         integer not null default 0 check (attempts between 0 and 10),
  last_error       text,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  expires_at       timestamptz not null default now() + interval '7 days'
);
alter table public.report_export_jobs enable row level security;
drop policy if exists report_export_jobs_org on public.report_export_jobs;
create policy report_export_jobs_org on public.report_export_jobs as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()))
  with check (organisation_id = (select public.app_current_org()));
drop policy if exists report_export_jobs_own_read on public.report_export_jobs;
create policy report_export_jobs_own_read on public.report_export_jobs for select to authenticated
  using ((select public.app_is_active()) and requested_by = (select auth.uid()));
drop policy if exists report_export_jobs_own_insert on public.report_export_jobs;
create policy report_export_jobs_own_insert on public.report_export_jobs for insert to authenticated
  with check ((select public.app_is_active()) and requested_by = (select auth.uid()) and status = 'queued'
              and included = 0 and missing = 0 and zip_path is null);
revoke all on public.report_export_jobs from anon;
revoke all on public.report_export_jobs from authenticated;
grant select, insert on public.report_export_jobs to authenticated;

select anum_integration.apply_reader_policies();
