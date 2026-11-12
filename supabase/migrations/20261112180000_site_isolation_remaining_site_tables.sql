-- Site scope now applies to the remaining tables that carry a site.
--
-- FINDING: RLS-7 (P2)  - audit 2026-11-12.
-- STATUS: APPLIED LIVE on jhssdmeruxtrlqnwfksc 2026-11-12. Verified by
--   rolled-back impersonation (VERIFY block at the foot).
--
-- WHAT WAS WRONG (reproduced live as an approved Driver whose profile has no
-- site list; "sited" = rows with a non-blank site, which that account must not see):
--   odometer_logs 2418 (sited 2035), engine_hours_logs 3820 (1217),
--   inspection_schedules 245 (245), action_items 161 (161),
--   checklist_submissions 133 (130), insurance_property_risks 122 (122),
--   accident_stage_events 66 (66), asset_disposals 40 (40),
--   site_match_keywords 52 (46), production_station_map 27 (27),
--   store_site_map 19 (19).
--   These tables had org and country policies but no site policy.
--
-- WHAT THIS DOES
--   One RESTRICTIVE SELECT policy per table, role authenticated, named
--   <table>_site_isolation, whose expression is read from the live
--   tyre_records_site_isolation policy (V396 InitPlan form):
--     site is null / blank  OR  app_sees_all_sites()  OR  site in app_site_scope()
--   Rows with no site stay visible to everyone, exactly as on tyre_records.
--
-- -------------------------------------------------------------------- PRE-FLIGHT
-- Data loss: none (policies only).
-- Locks: brief ACCESS EXCLUSIVE per CREATE POLICY; largest table 5,691 rows.
-- Who is affected: every other account holds sites ['ALL'] (or is Admin / super admin)
--   and sees exactly what it saw. 12 approved Driver accounts have NO site list;
--   they keep rows with no site and lose rows that carry one. Those 12 accounts
--   have created 0 odometer / engine-hour / checklist rows.
-- Writes: SELECT only. SECURITY DEFINER writers (stage-event trigger, meter sync,
--   site keyword matching in the classifier) run as the owner and are unaffected.
--   A scoped user who inserts a row for a site outside their scope and asks for
--   the row back would be refused; no such account exists today.
-- Not covered: profiles (owned by the staff-directory change), parts_consumption,
--   and site WRITE policies on these tables.
-- Rollback: at the foot (file only).

do $mig$
declare
  t text;
  v_expr text;
  v_tables text[] := array['odometer_logs','engine_hours_logs','inspection_schedules','action_items',
    'checklist_submissions','insurance_property_risks','accident_stage_events','asset_disposals',
    'site_match_keywords','production_station_map','store_site_map'];
begin
  select pg_get_expr(polqual, polrelid) into v_expr
    from pg_policy
   where polrelid = 'public.tyre_records'::regclass and polname = 'tyre_records_site_isolation';
  if v_expr is null or v_expr not like '%app_sees_all_sites()%' or v_expr not like '%app_site_scope()%' then
    raise exception 'tyre_records_site_isolation is not in the expected form';
  end if;
  foreach t in array v_tables loop
    if not exists (select 1 from pg_attribute where attrelid = ('public.'||t)::regclass
                    and attname = 'site' and atttypid = 'text'::regtype and not attisdropped) then
      raise exception 'table % has no text site column', t;
    end if;
    if exists (select 1 from pg_policy where polrelid = ('public.'||t)::regclass
                and polname = t || '_site_isolation') then
      continue;
    end if;
    execute format('create policy %I on public.%I as restrictive for select to authenticated using (%s)',
                   t || '_site_isolation', t, v_expr);
  end loop;
end
$mig$;

-- ------------------------------------------------------------------------ VERIFY
-- (run 2026-11-12; total / sited per table, before -> after)
--   KSA Manager, KSA Driver (sites ALL), Egypt Tyre Data Collector, other-org
--   Manager: identical before and after on all 11 tables
--     (e.g. Manager and Driver: odometer_logs 2418/2035, engine_hours_logs
--      3820/1217, action_items 161/161; Egypt: 1/1, 67/1, 2/2; other org: 0
--      except accident_stage_events 2/2).
--   Driver with no site list: sited rows 0 on all 11 tables
--     (odometer_logs 383/0, engine_hours_logs 2603/0, checklist_submissions 3/0,
--      site_match_keywords 6/0, the other seven 0/0).
--   Driver narrowed to one site inside a rolled-back transaction (profile changed
--     by a super admin with an MFA session): rows from another site = 0 on all 11
--     (odometer_logs 551 total / 168 sited, engine_hours_logs 2627 / 24,
--      action_items 72 / 72, inspection_schedules 61 / 61, ...).
--
-- ---------------------------------------------------------------------- ROLLBACK
-- OWNER TO PASTE IN SQL EDITOR (not applied by the tool), one per table:
--   drop policy <table>_site_isolation on public.<table>;
