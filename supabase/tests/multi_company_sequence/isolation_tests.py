"""Company isolation tests run by run_sequence.py after the whole sequence is applied.

Two independent synthetic companies (Alpha = the current company, Beta) and an empty third (Gamma).
Every test runs in a transaction that is rolled back. `h` is the runner module (its helpers and ids).
"""
import json, uuid

CORE_TABLES = ['vehicle_fleet', 'tyre_records', 'work_orders', 'work_order_line_items', 'inspections', 'accidents',
               'stock_records', 'parts_consumption', 'corrective_actions', 'alerts', 'pm_programs', 'checklist_submissions',
               'odometer_logs', 'engine_hours_logs', 'wash_records', 'warranty_claims', 'gate_passes', 'drivers',
               'suppliers', 'purchase_orders', 'production_logs', 'notifications', 'ai_token_logs', 'ai_budgets',
               'org_invitations', 'audit_log_v2', 'report_schedules', 'tyre_status_marks', 'organisation_settings']

CORE_RPCS = [
    ('get_user_module_permissions', "select public.get_user_module_permissions()"),
    ('get_my_access_grants', "select public.get_my_access_grants()"),
    ('get_my_capabilities', "select public.get_my_capabilities()"),
    ('get_my_entitlements', "select public.get_my_entitlements()"),
    ('get_org_role_matrix', "select count(*) from public.get_org_role_matrix()"),
    ('my_org_public_branding', "select public.my_org_public_branding()"),
    ('report_tyre_summary', "select public.report_tyre_summary(null, null, null)"),
    ('get_fleet_cpk', "select public.get_fleet_cpk('KSA', current_date - 365, current_date, null)"),
    ('get_cost_cpk_overview', "select public.get_cost_cpk_overview('KSA', null, current_date - 365, current_date)"),
    ('get_parts_expense_snapshot', "select public.get_parts_expense_snapshot('KSA', null, current_date - 365, current_date)"),
    ('get_maintenance_snapshot', "select public.get_maintenance_snapshot('KSA', null, current_date - 365, current_date)"),
    ('get_tyre_running_life', "select public.get_tyre_running_life('KSA', 50, 0, null, false)"),
    ('get_tyre_filter_options', "select public.get_tyre_filter_options('KSA')"),
    ('get_tyre_exceptions', "select public.get_tyre_exceptions('KSA')"),
    ('get_tyre_consumption', "select public.get_tyre_consumption('KSA', current_date - 365, current_date)"),
    ('get_daily_job_cards', "select public.get_daily_job_cards('KSA', current_date)"),
    ('get_mobile_analytics', "select public.get_mobile_analytics('KSA', current_date - 365, current_date, null)"),
    ('get_schedule_adherence', "select public.get_schedule_adherence('KSA', current_date - 30, current_date)"),
    ('get_expense_by_country', "select public.get_expense_by_country(current_date - 365, current_date)"),
    ('get_country_kpi', "select count(*) from public.get_country_kpi('KSA')"),
    ('reference_asset_options', "select count(*) from public.reference_asset_options('KSA')"),
    ('reference_site_options', "select count(*) from public.reference_site_options('KSA')"),
    ('list_scrapped_tyres', "select public.list_scrapped_tyres(null, 'KSA', 50)"),
    ('workforce_board_summary', "select public.workforce_board_summary(current_date - 30, current_date, null)"),
    ('get_upload_coverage_detail', "select public.get_upload_coverage_detail(30, 'KSA')"),
    ('org_can_add vehicles', "select public.org_can_add('vehicles')"),
    ('org_export_manifest', "select public.org_export_manifest()"),
    ('get_org_admin_audit', "select count(*) from public.get_org_admin_audit(50)"),
]


def run(h):
    rec, attempt, become, q, q1, tx, cur = h.rec, h.attempt, h.become, h.q, h.q1, h.tx, h.cur
    ALPHA, BETA, GAMMA, USER = h.ALPHA, h.BETA, h.GAMMA, h.USER
    owner, service, anon = h.become_owner, h.become_service, h.become_anon

    def invite(as_user, email, role):
        become(as_user); r, err = attempt('select public.org_invite_member(%s, %s)', (email, role))
        return (r[0][0]['invite_token'] if r else None), err
    def refused(err, code='42501'):
        return err is not None and err.startswith(code)

    # ------------------------------------------------------------------ (a) files and photos
    print('\nISO-a company-scoped file and photo paths')
    def put(bucket, name):
        return attempt("insert into storage.objects (bucket_id, name, owner) values (%s, %s, auth.uid()) returning id", (bucket, name))
    with tx():
        become('beta.driver')
        r, err = put('vehicle-photos', BETA + '/KSA/BT-1/photo.jpg')
        rec('ISO-a', 'a second-company user uploads into its own company folder', err is None, err)
        r, err = put('vehicle-photos', ALPHA + '/KSA/TM-1/photo.jpg')
        rec('ISO-a', "a second-company user cannot create a file under the current company's folder (vehicle photos)", refused(err), err or r)
        for b in ('tyre-photos', 'inspection-photos', 'accident-photos'):
            r, err = put(b, ALPHA + '/x/' + b + '.jpg')
            rec('ISO-a', "nor under it in %s" % b, refused(err), err or r)
        r, err = put('import-files', ALPHA + '/KSA/file.xlsx')
        rec('ISO-a', 'nor in import files', refused(err), err or r)
        r, err = put('workforce-evidence', ALPHA + '/' + USER['beta.driver'] + '/e.jpg')
        rec('ISO-a', 'nor in workforce evidence', refused(err), err or r)
        r, err = put('accident-photos', 'accidents/00000000-0000-4000-8000-00000000beef/photo_1.jpg')
        rec('ISO-a', 'a path with no company prefix (as the apps write today) still uploads', err is None, err)
        r, err = put('inspection-photos', USER['beta.driver'] + '/i1/LHF1.jpg')
        rec('ISO-a', 'a path that starts with the user id still uploads', err is None, err)
        n_own = q1("select count(*) from storage.objects")
        become('beta.manager'); n_mgr = q1("select count(*) from storage.objects where bucket_id in ('vehicle-photos','accident-photos','inspection-photos')")
        rec('ISO-a', 'a colleague in the same company reads those files', n_own == 3 and n_mgr == 3, (n_own, n_mgr))
        for u in ('alpha.admin', 'alpha.manager', 'gamma.admin'):
            become(u); n = q1("select count(*) from storage.objects")
            rec('ISO-a', '%s reads none of them' % u, n == 0, n)
        become('alpha.admin')
        r, err = attempt("update storage.objects set name = name || '.x'")
        rec('ISO-a', 'an Admin of another company cannot rename or overwrite them', err is not None or r == 0, err or r)
        r, err = attempt("delete from storage.objects")
        rec('ISO-a', 'nor remove them', err is not None or r == 0, err or r)
        become('alpha.driver')
        r, err = put('vehicle-photos', ALPHA + '/KSA/TM-1/photo.jpg')
        rec('ISO-a', 'the current company uploads to its own folder exactly as before', err is None, err)
        r, err = put('vehicle-photos', BETA + '/KSA/BT-1/photo2.jpg')
        rec('ISO-a', "and cannot write into the second company's folder", refused(err), err or r)
        become('platform.superadmin', 'aal2')
        rec('ISO-a', 'a super admin is not limited by the folder rule', q1("select public.storage_path_company_ok(%s)", (BETA + '/x',)) is True)
        anon(); r, err = attempt("select count(*) from storage.objects")
        rec('ISO-a', 'an anonymous caller reads no file', err is not None or r[0][0] == 0, err or r)

    # ------------------------------------------------------------------ (b) accident notifications
    print('\nISO-b accident notifications stay inside the company')
    def report_accident(user, asset):
        become(user)
        r, err = attempt("insert into public.accidents (asset_no, incident_date, accident_type, severity, country, site) "
                         "values (%s, current_date, 'collision', 'minor', 'KSA', 'NHC') returning id, organisation_id::text", (asset,))
        return (r[0] if r else None), err
    def org_of(user_ids):
        if not user_ids: return set()
        return {x[0] for x in q("select distinct org_id::text from public.profiles where id = any(%s::uuid[])", (list(user_ids),))}
    with tx():
        owner(); cur.execute("update public.domain_events set status = 'processed', processed_at = now() where status = 'pending'")
        cur.execute("update public.system_config set value = 'true' where key = 'accident_emails_enabled'")
        row, err = report_accident('beta.manager', 'ZZ-ACC-B1')
        rec('ISO-b', 'a second-company Manager reports an accident into the own company', err is None and row[1] == BETA, err or row)
        owner(); cur.execute('select public.process_domain_events(200)')
        got = [str(x[0]) for x in q("select user_id from public.notifications where entity_id = %s", (row[0],))] if row else []
        rec('ISO-b', 'in-app notices for it go to second-company users only (and there are some)',
            len(got) > 0 and org_of(got) == {BETA}, {'recipients': len(got), 'companies': sorted(org_of(got))})
        wn = q("select organisation_id::text, payload::text from public.workflow_notifications where payload::text like %s", ('%' + str(row[0]) + '%',)) if row else []
        blob = ' '.join(x[1] for x in wn)
        rec('ISO-b', "no queued mail or push for it carries the current company's mailbox or a current-company address",
            'accidents@staging.tyrepulse.invalid' not in blob and 'alpha.' not in blob and all(x[0] == BETA for x in wn),
            {'queued': len(wn)})
        cfg = q("select source, emails_enabled, email_to from public.accident_mail_config(%s)", (BETA,))
        rec('ISO-b', 'the second company has no mailbox until it sets its own (mail off, no address)',
            cfg and cfg[0][0] == 'none' and cfg[0][1] == 'false' and cfg[0][2] is None, cfg)
        cfg = q("select source, email_to from public.accident_mail_config(%s)", (ALPHA,))
        rec('ISO-b', 'the current company still resolves its existing mailbox', cfg and cfg[0] == ('legacy_global', 'accidents@staging.tyrepulse.invalid'), cfg)
        row2, err = report_accident('alpha.manager', 'ZZ-ACC-A1')
        owner(); cur.execute('select public.process_domain_events(200)')
        got2 = [str(x[0]) for x in q("select user_id from public.notifications where entity_id = %s", (row2[0],))] if row2 else []
        rec('ISO-b', 'a current-company accident notifies current-company users only', len(got2) > 0 and org_of(got2) == {ALPHA},
            {'recipients': len(got2), 'companies': sorted(org_of(got2))})
        become('gamma.admin')
        rec('ISO-b', 'the third company received no notice and sees neither accident',
            q1("select count(*) from public.notifications") == 0 and q1("select count(*) from public.accidents where asset_no like 'ZZ-ACC-%'") == 0)
        become('beta.admin')
        r, err = attempt("select public.set_org_config('accident_email_to', 'x@beta-synthetic.invalid')")
        r2, err2 = attempt("update public.system_config set value = 'x@beta-synthetic.invalid' where key = 'accident_email_to'")
        owner()
        rec('ISO-b', "a second-company Admin cannot change the current company's mailbox",
            q1("select value from public.system_config where key = 'accident_email_to'") == 'accidents@staging.tyrepulse.invalid', (err, err2 or r2))

    # ------------------------------------------------------------------ (c) AI usage and budgets
    print('\nISO-c AI usage and budgets per company')
    def reserve(org, user, usd):
        service()
        r, err = attempt("select public.ai_orchestrator_reserve_budget(%s, %s, %s, %s, 'orchestrator')", (str(uuid.uuid4()), org, USER[user], usd))
        return r[0][0] if r else {'error': err}
    def ai_on(budget):
        owner()
        for k, v in (('ai_enabled', 'true'), ('ai_orchestrator_enabled', 'true'), ('ai_monthly_budget_usd', budget)):
            cur.execute("update public.system_config set value = %s where key = %s", (v, k))
            if cur.rowcount == 0: cur.execute("insert into public.system_config (key, value) values (%s, %s)", (k, v))
    def log_spend(org, usd):
        owner()
        cur.execute("insert into public.ai_token_logs (organisation_id, feature, cost_usd, country, model) values (%s, 'orchestrator', %s, 'KSA', 'synthetic-model')", (org, usd))
    with tx():
        owner()
        cols = {x[0] for x in q("select column_name from information_schema.columns where table_schema='public' and table_name='ai_token_logs' and is_nullable='NO' and column_default is null")}
        rec('ISO-c', 'test fixture: an AI usage row needs no column this test does not set', cols <= {'organisation_id', 'feature', 'cost_usd', 'country', 'model'}, cols)
        log_spend(ALPHA, 1.25); log_spend(BETA, 2.5)
        become('alpha.manager'); a = q("select organisation_id::text, cost_usd from public.ai_token_logs")
        become('beta.manager'); b = q("select organisation_id::text, cost_usd from public.ai_token_logs")
        become('gamma.admin'); g = q1("select count(*) from public.ai_token_logs")
        rec('ISO-c', 'each company reads only its own AI usage; the empty company reads none',
            [x[0] for x in a] == [ALPHA] and [x[0] for x in b] == [BETA] and g == 0, (a, b, g))
        become('beta.admin')
        r, err = attempt("insert into public.ai_budgets (period, cost_cap_usd) values ('monthly', 5) returning organisation_id::text")
        rec('ISO-c', 'a company Admin records an AI budget note for the own company', err is None and r[0][0] == BETA, err)
        r, err = attempt("insert into public.ai_budgets (organisation_id, period, cost_cap_usd) values (%s, 'monthly', 5)", (ALPHA,))
        rec('ISO-c', 'and cannot write one for another company', err is not None, err or r)
        become('alpha.admin')
        rec('ISO-c', 'another company cannot read it', q1("select count(*) from public.ai_budgets") == 0)
        r, err = attempt("select public.ai_month_spend_usd_for_org(%s)", (BETA,))
        rec('ISO-c', 'a signed-in user cannot call the per-company spend function', refused(err), err or r)
    with tx():
        ai_on('10')
        log_spend(BETA, 9.99)
        service()
        sa = q1("select public.ai_month_spend_usd_for_org(%s)", (ALPHA,)); sb = q1("select public.ai_month_spend_usd_for_org(%s)", (BETA,))
        rec('ISO-c', 'month spend is counted per company', float(sa) == 0.0 and abs(float(sb) - 9.99) < 1e-6, (sa, sb))
        ra = reserve(ALPHA, 'alpha.manager', 0.5)
        rec('ISO-c', "the second company's spend does not use up the current company's AI budget", ra.get('ok') is True, ra)
        rb = reserve(BETA, 'beta.manager', 0.5)
        rec('ISO-c', 'the company that spent its budget is refused', rb.get('ok') is False and rb.get('state') == 'reached', rb)
        log_spend(None, 9.8)
        ra = reserve(ALPHA, 'alpha.manager', 0.5)
        rec('ISO-c', 'usage with no company still counts for the current company, as today', ra.get('ok') is False and ra.get('state') == 'reached', ra)
    with tx():
        ai_on('0')
        service()
        rec('ISO-c', 'the current company has no company cap (internal entitlement, grandfathered)',
            q1("select public.ai_org_month_limit_usd(%s)", (ALPHA,)) is None)
        log_spend(ALPHA, 500)
        ra = reserve(ALPHA, 'alpha.manager', 0.5)
        rec('ISO-c', 'with no platform ceiling the current company is uncapped whatever it has spent', ra.get('ok') is True and ra.get('state') == 'uncapped', ra)
        owner(); cur.execute("update public.subscription_plans set features = features || '{\"ai_monthly_budget_usd\": 1}'::jsonb where code = (select plan_code from public.org_subscriptions where organisation_id = %s)", (BETA,))
        log_spend(BETA, 0.9)
        rb = reserve(BETA, 'beta.manager', 0.5)
        rec('ISO-c', "a plan with an AI allowance caps that company at the allowance", rb.get('ok') is False and rb.get('state') == 'reached' and float(rb.get('limit_usd')) == 1.0, rb)
        rb2 = reserve(BETA, 'beta.manager', 0.05)
        rec('ISO-c', 'and lets it through below the allowance', rb2.get('ok') is True, rb2)
        ra = reserve(ALPHA, 'alpha.manager', 0.5)
        rec('ISO-c', "the current company is not limited by another company's plan allowance", ra.get('ok') is True, ra)
        become('beta.admin')
        r, err = attempt("update public.subscription_plans set features = features || '{\"ai_monthly_budget_usd\": 1000}'::jsonb")
        r2, err2 = attempt("insert into public.system_config (key, value) values ('ai_default_company_budget_usd', '1000')")
        service()
        rec('ISO-c', 'a company Admin cannot raise the own AI allowance (plan or platform default)',
            (err is not None or r == 0) and (err2 is not None or r2 == 0) and float(q1("select public.ai_org_month_limit_usd(%s)", (BETA,))) == 1.0, (err or r, err2 or r2))

    # ------------------------------------------------------------------ (d) invitations and employee identity
    print('\nISO-d invitations and employee identity')
    with tx():
        ta, _ = invite('alpha.admin', None, 'Inspector'); tb, _ = invite('beta.admin', None, 'Inspector')
        become('beta.admin')
        rows = q("select organisation_id::text from public.org_invitations")
        rec('ISO-d', 'a company Admin lists only the own company invitations', [x[0] for x in rows] == [BETA], rows)
        owner(); aid = q1("select id from public.org_invitations where organisation_id = %s", (ALPHA,))
        become('beta.admin'); r, err = attempt("select public.org_revoke_invitation(%s)", (aid,))
        owner(); still = q1("select revoked_at is null from public.org_invitations where id = %s", (aid,))
        rec('ISO-d', "and cannot revoke another company's invitation", still is True, err or r)
        become('beta.admin')
        r, err = attempt("update public.org_invitations set organisation_id = %s, role = 'Admin'", (ALPHA,))
        owner(); n = q1("select count(*) from public.org_invitations where organisation_id = %s", (ALPHA,))
        rec('ISO-d', 'nor move an invitation into another company by a direct write', n == 1, err or r)
        owner(); stored = q1("select token_hash from public.org_invitations where organisation_id = %s", (BETA,))
        rec('ISO-d', 'the invitation token is stored hashed, never in clear', stored != tb and tb not in (stored or ''), None)
        become('beta.admin')
        n_alpha = q1("select count(*) from public.profiles where org_id = %s", (ALPHA,))
        n_beta = q1("select count(*) from public.profiles where org_id = %s", (BETA,))
        rec('ISO-d', 'a company Admin reads no employee of another company', n_alpha == 0 and n_beta > 0, (n_alpha, n_beta))
        r, err = attempt("update public.profiles set role = 'Admin' where id = %s", (USER['alpha.driver'],))
        rec('ISO-d', "cannot change another company's employee", err is not None or r == 0, err or r)
        r, err = attempt("update public.profiles set org_id = %s, organisation_id = %s where id = auth.uid()", (ALPHA, ALPHA))
        owner(); o = q1("select org_id::text from public.profiles where id = %s", (USER['beta.admin'],))
        rec('ISO-d', 'cannot move the own account into another company', o == BETA, err or r)
        become('beta.admin')
        r, err = attempt("update public.profiles set is_super_admin = true where id = auth.uid()")
        owner(); s = q1("select is_super_admin from public.profiles where id = %s", (USER['beta.admin'],))
        rec('ISO-d', 'cannot make the own account a platform super admin', s is not True, err or r)
        become('beta.admin')
        r, err = attempt("update public.profiles set org_id = %s, organisation_id = %s where id = %s", (BETA, BETA, USER['alpha.driver']))
        owner(); o = q1("select org_id::text from public.profiles where id = %s", (USER['alpha.driver'],))
        rec('ISO-d', "cannot pull another company's employee into the own company", o == ALPHA, err or r)
        anon(); r, err = attempt("select public.org_invite_member(null, 'Inspector')")
        rec('ISO-d', 'an anonymous caller cannot invite', err is not None, err or r)

    # ------------------------------------------------------------------ (e) plan and limits (TEN-5 regression)
    print('\nISO-e a customer Admin cannot change the own plan or limits')
    with tx():
        owner()
        before = q("select plan_code, status, seats, trial_ends_at, current_period_end from public.org_subscriptions where organisation_id = %s", (BETA,))
        org_before = q("select plan, max_users, active, locked from public.organisations where id = %s", (BETA,))
        plans_before = q1("select md5(string_agg(code || coalesce(max_vehicles::text,'') || coalesce(max_users::text,'') || features::text, '|' order by code)) from public.subscription_plans")
        become('beta.admin')
        tries = [
            ("update public.org_subscriptions set plan_code = 'internal'", None),
            ("update public.org_subscriptions set status = 'active', seats = 9999, trial_ends_at = now() + interval '10 years', current_period_end = now() + interval '10 years'", None),
            ("insert into public.org_subscriptions (organisation_id, plan_code, status) values (%s, 'internal', 'active')", (BETA,)),
            ("delete from public.org_subscriptions", None),
            ("update public.organisations set plan = 'enterprise'", None),
            ("update public.organisations set max_users = 100000", None),
            ("update public.organisations set locked = false, active = true", None) ,
            ("update public.subscription_plans set max_vehicles = null, max_users = null", None),
            ("insert into public.subscription_plans (code, name) values ('zz-free', 'Free for me')", None),
            ("update public.system_config set value = 'off' where key = 'entitlement_enforcement'", None),
            ("select public.admin_set_entitlement_enforcement(false, 'x', true)", None),
            ("select public.set_org_config('entitlement_enforcement', 'off')", None),
        ]
        outs = []
        for sql, p in tries:
            r, err = attempt(sql, p); outs.append((sql[:48], err[:60] if err else r))
        owner()
        after = q("select plan_code, status, seats, trial_ends_at, current_period_end from public.org_subscriptions where organisation_id = %s", (BETA,))
        org_after = q("select plan, max_users, active, locked from public.organisations where id = %s", (BETA,))
        plans_after = q1("select md5(string_agg(code || coalesce(max_vehicles::text,'') || coalesce(max_users::text,'') || features::text, '|' order by code)) from public.subscription_plans")
        rec('ISO-e', 'subscription row unchanged after %d attempts by the company Admin' % len(tries), before == after and len(after) == 1, outs)
        rec('ISO-e', 'organisation plan and limit columns unchanged', org_before == org_after, (org_before, org_after))
        rec('ISO-e', 'the plan catalogue is unchanged and has no new plan', plans_before == plans_after)
        rec('ISO-e', 'the enforcement switch is unchanged', q1("select value from public.system_config where key = 'entitlement_enforcement'") in ('off', 'false'),
            q1("select value from public.system_config where key = 'entitlement_enforcement'"))
        become('beta.admin')
        r, err = attempt("update public.organisations set name = 'Beta Haulage LLC' where id = %s", (BETA,))
        rec('ISO-e', 'the company Admin can still edit an ordinary field of the own company (the guard is not a blanket refusal)', err is None and r == 1, err or r)
        become('alpha.admin')
        r, err = attempt("update public.org_subscriptions set plan_code = 'trial'")
        owner()
        rec('ISO-e', 'the current-company Admin cannot change its plan either; it stays internal with no limits',
            q("select plan_code from public.org_subscriptions where organisation_id = %s", (ALPHA,)) == [('internal',)], err or r)

    # ------------------------------------------------------------------ (f) export and offboarding
    print('\nISO-f company export (own data only) and offboarding')
    with tx():
        owner()
        truth = dict(q("select organisation_id::text, count(*) from public.vehicle_fleet group by 1"))
        become('beta.admin')
        man, err = attempt("select public.org_export_manifest()")
        m = {x['table']: x['rows'] for x in man[0][0]['tables']} if man else {}
        rec('ISO-f', 'the company Admin gets a manifest of the own company', err is None and man[0][0]['organisation_id'] == BETA and m.get('vehicle_fleet') == truth.get(BETA), err or m.get('vehicle_fleet'))
        seen, after, pages = [], None, 0
        while True:
            r, err = attempt("select public.org_export_page('vehicle_fleet', %s, 5)", (after,))
            if err: break
            pg = r[0][0]; seen += pg['rows']; pages += 1; after = pg['next_after']
            if pg['done'] or pages > 100: break
        rec('ISO-f', 'paging the vehicle register returns every own row once and no row of another company',
            err is None and len(seen) == truth.get(BETA) and len({x['id'] for x in seen}) == len(seen) and {x['organisation_id'] for x in seen} == {BETA},
            err or (len(seen), truth.get(BETA), pages))
        r, err = attempt("select public.org_export_page('profiles')")
        rec('ISO-f', 'a table that is not on the export list is refused', refused(err, '22023'), err or 'returned rows')
        r, err = attempt("select public.org_export_page('vehicle_fleet; select 1')")
        rec('ISO-f', 'a crafted table name is refused', refused(err, '22023'), err or 'returned rows')
        owner(); wo = q1("select count(*) from public.work_orders where organisation_id = %s", (BETA,))
        hist = q1("select md5(coalesce(string_agg(id::text || coalesce(updated_at::text,''), ',' order by id), '')) from public.work_orders")
        become('beta.admin'); attempt("select public.org_export_page('work_orders')")
        owner()
        rec('ISO-f', 'an export changes no business row', q1("select md5(coalesce(string_agg(id::text || coalesce(updated_at::text,''), ',' order by id), '')) from public.work_orders") == hist, wo)
        for u in ('beta.manager', 'beta.driver'):
            become(u); r, err = attempt("select public.org_export_manifest()"); r2, err2 = attempt("select public.org_export_page('vehicle_fleet')")
            rec('ISO-f', '%s cannot export' % u, refused(err) and refused(err2), (err, err2))
        anon(); r, err = attempt("select public.org_export_page('vehicle_fleet')")
        rec('ISO-f', 'an anonymous caller cannot export', err is not None, err or r)
        become('alpha.admin'); r, err = attempt("select public.org_export_page('vehicle_fleet', null, 1000)")
        rec('ISO-f', 'the current-company Admin exports only current-company rows', err is None and {x['organisation_id'] for x in r[0][0]['rows']} == {ALPHA}, err)
        become('gamma.admin'); r, err = attempt("select public.org_export_page('vehicle_fleet')")
        rec('ISO-f', 'the empty company exports an empty page without error', err is None and r[0][0]['count'] == 0 and r[0][0]['done'] is True, err or r)
        become('beta.admin')
        for sql, p in (("select public.admin_tenant_export_page(%s, 'vehicle_fleet', null, 10)", (ALPHA,)),
                       ("select public.admin_tenant_export_manifest(%s)", (ALPHA,)),
                       ("select public.admin_purge_organisation(%s, true, null, 'x')", (GAMMA,)),
                       ("select public.admin_purge_organisation(%s, false, 'beta-haulage', 'leaving')", (BETA,))):
            r, err = attempt(sql, p)
            rec('ISO-f', 'a company Admin cannot call %s' % sql.split('(')[0].replace('select public.', ''), refused(err), err or r)
        owner(); counts = q("select (select count(*) from public.vehicle_fleet), (select count(*) from public.profiles), (select count(*) from public.organisations)")
        become('platform.superadmin', 'aal2')
        r, err = attempt("select public.admin_purge_organisation(%s, true, null, 'staging dry run')", (GAMMA,))
        rec('ISO-f', 'HOLD: the purge is not callable from the application at all, not even by a super admin', refused(err), err or r)
        owner()
        r, err = attempt("select public.admin_purge_organisation(%s, true, null, 'staging dry run')", (GAMMA,))
        rec('ISO-f', 'HOLD: its dry run (database owner) reports and removes nothing',
            err is None and q("select (select count(*) from public.vehicle_fleet), (select count(*) from public.profiles), (select count(*) from public.organisations)") == counts, err or r)
        r, err = attempt("select public.admin_purge_organisation(%s, false, 'alpha-readymix', 'x')", (ALPHA,))
        rec('ISO-f', 'the current company can never be purged, even by the database owner',
            (err is not None or r[0][0].get('ok') is False) and q1("select count(*) from public.organisations where id = %s", (ALPHA,)) == 1
            and q1("select count(*) from public.vehicle_fleet where organisation_id = %s", (ALPHA,)) > 0, err or r)

    # ------------------------------------------------------------------ (g) auditable admin actions
    print('\nISO-g administrative actions are recorded per company')
    with tx():
        tok, err = invite('beta.admin', None, 'Inspector')
        become('beta.admin')
        mod = q1("select module_key from public.module_permissions where org_id is null and role = 'Manager' and enabled order by 1 limit 1")
        attempt("select public.set_org_module_permissions(%s::jsonb, 'audit test')", (json.dumps([{'role': 'Manager', 'module_key': mod, 'enabled': False}]),))
        r, err = attempt("update public.profiles set role = 'Inspector' where id = %s", (USER['beta.tyreman'],))
        attempt("select public.org_export_page('sites')")
        ev, err2 = attempt("select action, actor::text, entity_id, details::text, organisation_id::text from public.get_org_admin_audit(100)")
        acts = {x[0] for x in (ev or [])}
        want = {'invitation.created', 'role_matrix.changed', 'member.role_changed', 'export.page'}
        rec('ISO-g', 'the company Admin reads the record of the own administrative actions', err2 is None and want <= acts, err2 or (err, sorted(acts)))
        rec('ISO-g', 'each row names the acting user and the company', bool(ev) and all(x[1] == USER['beta.admin'] and x[4] == BETA for x in ev), None)
        rc = [x for x in (ev or []) if x[0] == 'member.role_changed']
        rec('ISO-g', 'a role change records who was changed and the role before and after',
            len(rc) == 1 and rc[0][2] == USER['beta.tyreman'] and json.loads(rc[0][3]) == {'before': 'Tyre Man', 'after': 'Inspector'}, rc)
        blob = ' '.join(x[3] for x in (ev or []))
        rec('ISO-g', 'the record holds no invitation token and no e-mail address', (tok or 'x') not in blob and '@' not in blob)
        r, err = attempt("update public.org_admin_events set action = 'x'"); r2, err2 = attempt("delete from public.org_admin_events")
        r3, err3 = attempt("insert into public.org_admin_events (organisation_id, action) values (%s, 'forged')", (BETA,))
        rec('ISO-g', 'the record cannot be edited, removed or forged by the company Admin', err is not None and err2 is not None and err3 is not None, (err or r, err2 or r2, err3 or r3))
        become('beta.manager'); r, err = attempt("select count(*) from public.get_org_admin_audit(10)"); n = q1("select count(*) from public.org_admin_events")
        rec('ISO-g', 'a Manager cannot read it', refused(err) and n == 0, err or (r, n))
        become('alpha.admin'); n = q1("select count(*) from public.org_admin_events where organisation_id = %s", (BETA,))
        r, err = attempt("select count(*) from public.get_org_admin_audit(100) where organisation_id <> %s", (ALPHA,))
        rec('ISO-g', "another company's Admin reads none of it", n == 0 and err is None and r[0][0] == 0, err or (n, r))
        owner()   # the platform (billing webhook, service role) changes the subscription
        attempt("update public.org_subscriptions set status = 'past_due' where organisation_id = %s", (BETA,))
        become('beta.admin')
        pc = q("select details::text from public.get_org_admin_audit(100) where action = 'plan.changed'")
        rec('ISO-g', 'a plan change made by the platform is visible to the company it concerns', len(pc) == 1 and 'past_due' in pc[0][0], pc)
        become('alpha.admin')
        r, err = attempt("update public.profiles set role = 'Inspector' where id = %s", (USER['alpha.tyreman'],))
        ev, err2 = attempt("select action, entity_id from public.get_org_admin_audit(10)")
        rec('ISO-g', 'the current company keeps working and gets the same record', err is None and r == 1 and ('member.role_changed', USER['alpha.tyreman']) in (ev or []), err or err2 or ev)

    # ------------------------------------------------------------------ first use of the empty company
    print('\nGAMMA first use of an empty company')
    with tx():
        owner()
        missing = [t for t in CORE_TABLES if q1("select to_regclass(%s)", ('public.' + t,)) is None]
        rec('GAMMA', 'every core table of the test exists', not missing, missing)
        become('gamma.admin')
        bad = {}
        for t in CORE_TABLES:
            if t in missing: continue
            r, err = attempt('select count(*) from public.%s' % t)
            if err or r[0][0] != 0: bad[t] = err or r[0][0]
        rec('GAMMA', 'the Admin of the empty company reads %d core tables: all return 0 rows, none errors' % (len(CORE_TABLES) - len(missing)), not bad, bad)
        me = q("select id::text, org_id::text, role from public.profiles")
        rec('GAMMA', 'it sees exactly one employee (itself) and one company (its own)',
            me == [(USER['gamma.admin'], GAMMA, 'Admin')] and q("select id::text from public.organisations") == [(GAMMA,)], me)
        failed, absent = {}, []
        for name, sql in CORE_RPCS:
            fn = name.split(' ')[0]
            owner(); exists = q1("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = %s", (fn,))
            become('gamma.admin')
            if not exists: absent.append(fn); continue
            r, err = attempt(sql)
            if err: failed[name] = err[:160]
        rec('GAMMA', '%d core screen reads (functions) return without error for the empty company' % (len(CORE_RPCS) - len(absent)), not failed, failed)
        rec('GAMMA', 'no function of the list is missing from the database', not absent, absent)
        leak = {}
        for name, sql in CORE_RPCS:
            if name.split(' ')[0] in absent or name in failed: continue
            r, err = attempt(sql)
            txt = json.dumps(r, default=str) if r is not None else ''
            if ALPHA in txt or BETA in txt or 'alpha.' in txt or 'beta.' in txt or 'Alpha' in txt or 'Beta' in txt: leak[name] = txt[:120]
        rec('GAMMA', 'none of those answers names another company, its id or its users', not leak, leak)
        r, err = attempt("insert into public.sites (name, country) values ('GAMMA YARD 1', 'KSA') returning organisation_id::text")
        r2, err2 = attempt("insert into public.vehicle_fleet (asset_no, country, site) values ('GM-001', 'KSA', 'GAMMA YARD 1') returning organisation_id::text")
        rec('GAMMA', 'first records (a site, a vehicle) land in the own company', err is None and err2 is None and r[0][0] == GAMMA and r2[0][0] == GAMMA, err or err2)
        become('alpha.manager'); a = q1("select count(*) from public.vehicle_fleet where asset_no = 'GM-001'")
        become('beta.manager'); b = q1("select count(*) from public.vehicle_fleet where asset_no = 'GM-001'")
        rec('GAMMA', 'and neither other company sees them', a == 0 and b == 0, (a, b))
