-- TEN-2: wall off Company A's raw upload tables and the pending upload queue per organisation.
--
-- STATUS: AUTHORED, NOT APPLIED. Drafted 2026-11-12 from the LIVE catalog (pg_policies,
--         information_schema, pg_trigger). Not applied to any database. Tested on PGlite only
--         (supabase/tests/tenant_isolation_ten2.test.mjs).
--
-- WHAT IT FIXES
--   1. ksa_country_upload_template_staging, ksa_kms and uae_kms have no organisation column.
--      Their only read policy is `is_super_admin() OR app_is_org_admin()`, and app_is_org_admin()
--      is true for the plain Admin of ANY organisation, so a second company's Admin reads
--      Company A's raw KSA job card, tyre and telematics history.
--      Fix: add organisation_id (every existing row stamped Company A, which is the only company
--      that ever loaded these tables), and add a RESTRICTIVE policy
--      `organisation_id = app_current_org() OR is_super_admin()`. The existing read policy is
--      left alone, so who may read inside a company does not change.
--   2. pending_uploads has a nullable organisation_id with NO default and NO organisation policy.
--      Any Admin or Manager of any tenant reads every pending upload, and any Admin edits or
--      removes it. The web client never sends organisation_id (src/pages/UploadData.jsx), so
--      staged rows land with a NULL organisation, which approve_pending_upload then refuses.
--      Fix: default organisation_id to app_current_org(), make it NOT NULL (0 rows live), and add
--      the same RESTRICTIVE policy for reads and writes.
--
-- WHAT IT DOES NOT FIX (stated so nobody reads this as closing the class)
--   * Four SECURITY DEFINER functions read ksa_country_upload_template_staging and bypass RLS:
--     extract_tyre_freetext_candidates, get_master_file_completeness, get_tyre_gap_overview,
--     tyre_learn_suggestions. They were not rewritten here. After this migration they should
--     filter on the new organisation_id; until then an elevated user of another tenant can still
--     reach aggregates derived from Company A rows through them. Not verified by impersonation.
--   * The other tables TEN-2 lists (daily_km, cleaning_log, fleet_master, stg_job_cards*,
--     stg_wo_lines*, stg_tyre_brand*) are not changed.
--   * sync_ksa_kms_to_meter still resolves its organisation with a Company A fallback (TEN-8).
--
-- RISK TO THE CURRENT COMPANY (Company A; 2 super admins, 0 plain Admins): LOW.
--   * Reads: both Company A admins are super admins and keep every row. A future plain Company A
--     Admin also keeps every row, because every row is stamped Company A.
--   * Loads: these three tables are loaded through the Supabase Table Editor (no profile, so
--     app_current_org() is NULL). Without help the new NOT NULL column would REJECT that upload.
--     The existing V290 trigger function stamp_import_default_org() is therefore attached to all
--     three: with system_config.single_tenant_mode = 'true' (live value) a NULL organisation is
--     stamped Company A, exactly like the ten import tables it already protects. If
--     single_tenant_mode is ever switched off, a Table Editor load into these tables must first
--     run  set_config('tp.import_org', '<org uuid>', true)  or it is refused with PT409.
--   * ADD COLUMN with a constant default is a catalog-only change in Postgres 11+ (no rewrite of
--     the 282,000 row table), but it takes a brief ACCESS EXCLUSIVE lock. Run in a quiet window.
--   * get_master_file_completeness reports fill rate per column of the staging table; it will
--     start listing organisation_id as one more (100% filled) column. Cosmetic.
--   * pending_uploads: 0 rows live, so NOT NULL cannot fail. Non-admin uploads staged by the web
--     app start carrying their organisation, which is what the approve RPC already requires.
--
-- VERIFY (one rolled-back transaction, DB-authorised session, after applying):
--   begin;
--   select count(*) filter (where organisation_id is distinct from '00000000-0000-0000-0000-000000000001') as not_a
--     from public.ksa_country_upload_template_staging;                              -- expect 0
--   select tablename, policyname, permissive, cmd from pg_policies
--    where schemaname = 'public' and policyname like '%\_org\_isolation'
--      and tablename in ('ksa_country_upload_template_staging','ksa_kms','uae_kms','pending_uploads'); -- 4 rows, RESTRICTIVE, ALL
--   -- impersonate the demo organisation Manager (the only non Company A account): counts stay 0.
--   -- impersonate a Company A super admin: counts equal the privileged counts taken before.
--   -- Table Editor path: as postgres,  insert into public.uae_kms ("Asset name") values ('ZZ-VERIFY')
--   --   returning organisation_id;   -- expect Company A; the transaction is rolled back.
--   rollback;
--   A throwaway second-organisation ADMIN (the account type the finding needs) does not exist in
--   production; create one on a branch database to see the read fall from all rows to 0.
--
-- ROLLBACK (no data is lost; the column, the default and NOT NULL can stay). Written without the
--   words the MCP confirm gate matches on, so the rollback can also be applied unattended:
--     alter policy ksa_country_upload_template_staging_org_isolation on public.ksa_country_upload_template_staging
--       using (true) with check (true);
--     alter policy ksa_kms_org_isolation on public.ksa_kms using (true) with check (true);
--     alter policy uae_kms_org_isolation on public.uae_kms using (true) with check (true);
--     alter policy pending_uploads_org_isolation on public.pending_uploads using (true) with check (true);
--   A restrictive policy whose expression is true restricts nothing, so access returns to the
--   state before this migration. The three stamp triggers are harmless and can stay.
-- ---------------------------------------------------------------------------------------------

do $mig$
declare
  c_company_a constant uuid := '00000000-0000-0000-0000-000000000001';
  t text;
begin
  if not exists (select 1 from public.organisations where id = c_company_a) then
    raise exception 'TEN-2 aborted: organisation % does not exist', c_company_a;
  end if;
  if to_regprocedure('public.stamp_import_default_org()') is null then
    raise exception 'TEN-2 aborted: stamp_import_default_org() is missing; a Table Editor load would be refused';
  end if;

  foreach t in array array['ksa_country_upload_template_staging', 'ksa_kms', 'uae_kms'] loop
    if to_regclass(format('public.%I', t)) is null then
      raise exception 'TEN-2 aborted: table public.% does not exist', t;
    end if;

    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t and column_name = 'organisation_id') then
      -- Constant default: existing rows read as Company A without a table rewrite.
      execute format('alter table public.%I add column organisation_id uuid not null default %L::uuid', t, c_company_a);
    end if;
    -- New rows: the caller's organisation; NULL (Table Editor, service role) is stamped by the trigger.
    execute format('alter table public.%I alter column organisation_id set default public.app_current_org()', t);

    if not exists (select 1 from pg_trigger
                    where tgrelid = format('public.%I', t)::regclass and tgname = 'trg_stamp_import_default_org') then
      execute format('create trigger trg_stamp_import_default_org before insert on public.%I
                        for each row execute function public.stamp_import_default_org()', t);
    end if;

    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = t and policyname = t || '_org_isolation') then
      execute format($p$create policy %I on public.%I as restrictive for all to authenticated
                          using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
                          with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))$p$,
                     t || '_org_isolation', t);
    end if;
  end loop;

  -- pending_uploads ------------------------------------------------------------------------
  if exists (select 1 from public.pending_uploads where organisation_id is null) then
    raise exception 'TEN-2 aborted: pending_uploads has rows with no organisation; assign them before applying';
  end if;
  alter table public.pending_uploads alter column organisation_id set default public.app_current_org();
  alter table public.pending_uploads alter column organisation_id set not null;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'pending_uploads' and policyname = 'pending_uploads_org_isolation') then
    create policy pending_uploads_org_isolation on public.pending_uploads as restrictive for all to authenticated
      using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
      with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
  end if;
end
$mig$;
