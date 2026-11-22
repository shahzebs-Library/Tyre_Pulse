-- Assertions for 20261117113000_company_pinned_lookups.sql.
-- Runs inside one transaction that ends in ROLLBACK; prints PASS/FAIL lines.
-- Mirror companies: Alpha (Company A, 0000...0001) and Beta (bbbb...0002) share
-- asset codes TM001..; a super admin of Alpha must not see Beta folded into
-- Alpha's per-asset answers.
begin;
create or replace function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $f$;

do $t$
declare
  c_alpha constant uuid := '00000000-0000-0000-0000-000000000001';
  c_beta  constant uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  c_super constant uuid := '5eacf3d3-29af-5995-bc52-bcef51b82c38';   -- Alpha super admin
  n_alpha int; n_got int; v jsonb; v_site text; v_hit boolean;
begin
  -- Fixtures (as the table owner): one Alpha machine with no inspection and no
  -- plan, and a Beta machine with the SAME code that is planned and has a
  -- site history elsewhere.
  insert into public.vehicle_fleet (organisation_id, country, asset_no, site, status)
  values (c_alpha, 'KSA', 'ZZCP01', 'ALPHA-YARD', 'Active'),
         (c_beta,  'KSA', 'ZZCP01', 'BETA-YARD',  'Active');
  insert into public.inspection_schedules (organisation_id, country, asset_no, scheduled_date, status)
  values (c_beta, 'KSA', 'ZZCP01', current_date + 3, 'Scheduled');
  insert into public.work_orders (organisation_id, country, asset_no, site, work_order_no, opened_at, status)
  select c_beta, 'KSA', 'ZZCP01', 'BETA-YARD', 'ZZCP/JC/' || g, now() - (g || ' days')::interval, 'Completed'
    from generate_series(1, 4) g;
  -- A code only Beta holds: still answered (the single holder), not hidden.
  insert into public.vehicle_fleet (organisation_id, country, asset_no, site, status)
  values (c_beta, 'KSA', 'ZZCP02', 'BETA-ONLY', 'Active');

  select count(*) into n_alpha from public.tyre_records where organisation_id = c_alpha and asset_no = 'TM001';

  perform pg_temp.as_user(c_super);

  -- 1. report_asset_overview: TM001 counted from Alpha only.
  select (e->>'total_tyres')::int into n_got
    from jsonb_array_elements(public.report_asset_overview('All')) e where e->>'asset_no' = 'TM001';
  raise notice '% report_asset_overview TM001 tyres = Alpha only (got %, alpha %)',
    case when n_got = n_alpha then 'PASS' else 'FAIL' end, n_got, n_alpha;

  -- 2. report_asset_metrics: same.
  select (e->>'count')::int into n_got
    from jsonb_array_elements(public.report_asset_metrics('All', null, null)) e where e->>'assetNo' = 'TM001';
  raise notice '% report_asset_metrics TM001 count = Alpha only (got %, alpha %)',
    case when n_got = n_alpha then 'PASS' else 'FAIL' end, n_got, n_alpha;

  -- 3. check_duplicate_serials: a Beta-only serial is not Alpha's duplicate.
  select count(*) into n_got from public.check_duplicate_serials(array['SYN-BET-00001']);
  raise notice '% check_duplicate_serials ignores another company''s serial (rows=%)',
    case when n_got = 0 then 'PASS' else 'FAIL' end, n_got;

  -- 4. get_unplanned_assets: Beta's plan for ZZCP01 does not hide Alpha's ZZCP01.
  select exists (select 1 from public.get_unplanned_assets('KSA', 30, null, 2000) u
                  where u.asset_no = 'ZZCP01' and u.site = 'ALPHA-YARD') into v_hit;
  raise notice '% get_unplanned_assets keeps Alpha ZZCP01 despite Beta''s plan', case when v_hit then 'PASS' else 'FAIL' end;

  -- 5. asset_site_at: Alpha's machine is at Alpha's yard, not Beta's.
  select s.site into v_site from public.asset_site_at('ZZCP01', 'KSA', current_date) s;
  raise notice '% asset_site_at uses Alpha history only (site=%)',
    case when v_site = 'ALPHA-YARD' then 'PASS' else 'FAIL' end, v_site;

  select s.site into v_site from public.asset_site_at('ZZCP02', 'KSA', current_date) s;
  raise notice '% asset_site_at still answers a code only one company holds (site=%)',
    case when v_site = 'BETA-ONLY' then 'PASS' else 'FAIL' end, v_site;

  execute 'reset role';
end $t$;
rollback;
