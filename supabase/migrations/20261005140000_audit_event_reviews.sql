-- 20261005140000_audit_event_reviews.sql
-- STATUS: APPLIED LIVE 2026-10-05 (as audit_event_reviews).
--
-- Why: the Audit Trail page (/audit) lets an Admin/Manager/Director flag an
-- audit event for review ("Investigate") and track it to resolved. audit_log_v2
-- has no severity and no review column, and it must stay append-only, so the
-- review state lives in its own table keyed by the audit row id. One flag per
-- event per organisation. Starts EMPTY; nothing is seeded.
--
-- Security model (matches the rest of the schema):
--   * organisation_id defaults to app_current_org(); RESTRICTIVE org isolation
--     for every command (super admin crosses orgs only via is_super_admin()).
--   * read + write: app_is_elevated() (the same audience that can read
--     audit_log_v2 under audit_log_v2_select), plus super admin.
--   * no country/site columns: audit_log_v2 country attribution is mostly NULL
--     (V579/V581), so a country policy here would scope nothing real.
--   * anon has no grant; no function is created.

create table if not exists public.audit_event_reviews (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id) on delete cascade,
  audit_id        uuid not null,
  record_table    text,
  record_id       text,
  status          text not null default 'open' check (status in ('open', 'investigating', 'resolved')),
  note            text check (note is null or char_length(note) <= 2000),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  constraint audit_event_reviews_org_audit_uq unique (organisation_id, audit_id)
);

create index if not exists audit_event_reviews_open_idx
  on public.audit_event_reviews (organisation_id, status) where status <> 'resolved';

alter table public.audit_event_reviews enable row level security;

drop policy if exists audit_event_reviews_org_isolation on public.audit_event_reviews;
create policy audit_event_reviews_org_isolation on public.audit_event_reviews
  as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));

drop policy if exists audit_event_reviews_read on public.audit_event_reviews;
create policy audit_event_reviews_read on public.audit_event_reviews
  for select to authenticated
  using (coalesce((select public.app_is_active()), false)
         and (coalesce((select public.app_is_elevated()), false) or (select public.is_super_admin())));

drop policy if exists audit_event_reviews_write on public.audit_event_reviews;
create policy audit_event_reviews_write on public.audit_event_reviews
  for all to authenticated
  using (coalesce((select public.app_is_active()), false)
         and (coalesce((select public.app_is_elevated()), false) or (select public.is_super_admin())))
  with check (coalesce((select public.app_is_active()), false)
         and (coalesce((select public.app_is_elevated()), false) or (select public.is_super_admin())));

revoke all on public.audit_event_reviews from anon, public;
grant select, insert, update on public.audit_event_reviews to authenticated;

-- VERIFY (rolled back, impersonating a real Manager and a real Reporter):
--   set local role authenticated; set local request.jwt.claims = '{"sub":"<manager uuid>","role":"authenticated"}';
--   insert into audit_event_reviews (audit_id) values (gen_random_uuid());  -- expect 1 row
--   (as Reporter) select count(*) from audit_event_reviews;                -- expect 0, insert refused 42501
-- ROLLBACK: drop table public.audit_event_reviews;
