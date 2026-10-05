-- ============================================================================
-- 20261005150000  brand_asset_registry  (APPLIED LIVE 2026-10-05 as brand_asset_registry)
--
-- Governance metadata for the Brand Assets gallery (/brand-assets). The assets
-- themselves are code (logo PNGs in public/brand/library, illustration and icon
-- React components) or org settings (system_config.company_logo, the tenant
-- logo placement map). None of those carry an OWNER, a review STATUS or a
-- deprecation flag, which the owner's mockup shows on the "Selected asset" card.
-- This table records that metadata per asset id, per organisation. It starts
-- EMPTY: an asset with no row reads "Not reviewed" in the UI. No seed rows.
--
-- Security: RESTRICTIVE org isolation; any active member reads; elevated
-- (Admin/Manager/Director) writes; anon gets nothing.
-- Rollback: drop table public.brand_asset_registry;
-- ============================================================================

create table if not exists public.brand_asset_registry (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  asset_id         text not null check (char_length(asset_id) between 1 and 200),
  asset_kind       text not null check (asset_kind in ('logo','illustration','icon','tenant')),
  owner            text check (owner is null or char_length(owner) <= 200),
  status           text not null default 'approved'
                     check (status in ('approved','draft','deprecated')),
  notes            text check (notes is null or char_length(notes) <= 4000),
  created_by       uuid default auth.uid(),
  updated_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organisation_id, asset_id)
);

create index if not exists idx_brand_asset_registry_org on public.brand_asset_registry (organisation_id);

drop trigger if exists set_updated_at_brand_asset_registry on public.brand_asset_registry;
create trigger set_updated_at_brand_asset_registry before update on public.brand_asset_registry
  for each row execute function public.set_updated_at();

alter table public.brand_asset_registry enable row level security;

drop policy if exists brand_asset_registry_org_isolation on public.brand_asset_registry;
create policy brand_asset_registry_org_isolation on public.brand_asset_registry
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()))
  with check (organisation_id = (select public.app_current_org()));

drop policy if exists brand_asset_registry_read on public.brand_asset_registry;
create policy brand_asset_registry_read on public.brand_asset_registry
  for select to authenticated using ((select public.app_is_active()));

drop policy if exists brand_asset_registry_write on public.brand_asset_registry;
create policy brand_asset_registry_write on public.brand_asset_registry
  for all to authenticated
  using ((select public.app_is_elevated()))
  with check ((select public.app_is_elevated()));

revoke all on public.brand_asset_registry from anon;
grant select, insert, update, delete on public.brand_asset_registry to authenticated;

-- VERIFY (rolled back, impersonating a real Manager then a Reporter):
--   insert ... returning 1  -> Manager 1 row, Reporter refused (42501)
--   select count(*)         -> both read their own org only
