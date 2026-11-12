#!/usr/bin/env python3
"""Tenant isolation tests for the Tyre Pulse STAGING database (synthetic data only).

Every check impersonates a seeded user the way PostgREST does (SET LOCAL ROLE authenticated plus
request.jwt.claims) inside a transaction that is ALWAYS rolled back, and confirms writes with a
privileged recount in the same transaction (a blocked write and an invisible write look the same from
inside the session).

Sections
  A  cross-company READ, both directions, on every public table that carries organisation_id
  B  cross-company WRITE, both directions
  C  country scoping inside one company
  D  empty company (Gamma): zero rows and no errors on key RPCs
  T  tenancy findings TEN-1..TEN-9: does each one REPRODUCE on this database
     (a sub-check printed HELD is still open; it is a documented design hold, with the reason shown)

Usage: run_tests.py --dsn "<dsn>" [--json out.json] [--label before]
Exit code 1 when an isolation check in A to D fails. Section T never fails the run: it reports state.
"""
import argparse, json, sys, contextlib
import psycopg2

ap = argparse.ArgumentParser()
ap.add_argument('--dsn', required=True); ap.add_argument('--json'); ap.add_argument('--label', default='run')
a = ap.parse_args()
if 'jhssdmeruxtrlqnwfksc' in a.dsn:
    sys.exit('Refusing: that is the production project.')
conn = psycopg2.connect(a.dsn)
cur = conn.cursor()
cur.execute('set search_path = "$user", public, extensions'); conn.commit()

def q(sql, params=None):
    cur.execute(sql, params); return cur.fetchall()
def q1(sql, params=None):
    r = q(sql, params); return r[0][0] if r else None

ORG = {r[0].split('-')[0]: r[1] for r in q("select slug, id::text from public.organisations")}
USER = {r[0]: r[1] for r in q("select username, id::text from public.profiles")}
conn.rollback()
results = []
def rec(section, name, ok, evidence):
    results.append({'section': section, 'name': name, 'ok': ok, 'evidence': str(evidence)[:400]})

@contextlib.contextmanager
def as_user(username):
    """Impersonate; everything is rolled back on exit."""
    conn.rollback()
    cur.execute("set local role authenticated")
    cur.execute("select set_config('request.jwt.claims', %s, true)",
                (json.dumps({'sub': USER[username], 'role': 'authenticated', 'aal': 'aal1'}),))
    try:
        yield
    finally:
        conn.rollback()

def attempt(sql, params=None):
    """Run a statement that may be refused. Returns (rows or rowcount, error text or None)."""
    cur.execute('savepoint s')
    try:
        cur.execute(sql, params)
        out = cur.fetchall() if cur.description else cur.rowcount
        cur.execute('release savepoint s')
        return out, None
    except Exception as e:
        cur.execute('rollback to savepoint s')
        return None, str(e).strip().split('\n')[0][:200]

def privileged(sql, params=None):
    """Recount as the owner inside the SAME transaction, then return to the impersonated role."""
    cur.execute('reset role'); cur.execute(sql, params); r = cur.fetchall()
    cur.execute('set local role authenticated'); return r

# ---------------------------------------------------------------- A: cross-company read
org_tables = [r[0] for r in q("""select c.relname from pg_class c join pg_attribute a on a.attrelid=c.oid
    where c.relnamespace='public'::regnamespace and c.relkind='r' and a.attname='organisation_id' and not a.attisdropped
      and has_table_privilege('authenticated', c.oid, 'select') order by 1""")]
conn.rollback()
populated = {}
for t in org_tables:
    for k, oid in ORG.items():
        n = q1('select count(*) from public.%s where organisation_id = %%s' % psycopg2.extensions.quote_ident(t, cur), (oid,))
        if n: populated[(t, k)] = n
conn.rollback()
PAIRS = [('alpha', 'beta'), ('beta', 'alpha')]
for me, other in PAIRS:
    for role in ['admin', 'manager', 'director', 'engineer', 'tyreman', 'inspector', 'driver']:
        uname = '%s.%s' % (me, role)
        leaks, errors, own = [], [], 0
        with as_user(uname):
            for t in org_tables:
                qt = psycopg2.extensions.quote_ident(t, cur)
                r, err = attempt('select count(*) filter (where organisation_id = %%s), count(*) filter (where organisation_id = %%s) from public.%s' % qt,
                                 (ORG[other], ORG[me]))
                if err: errors.append('%s: %s' % (t, err)); continue
                if r[0][0]: leaks.append('%s=%d' % (t, r[0][0]))
                own += r[0][1]
            r, err = attempt("select count(*) from public.profiles where org_id = %s", (ORG[other],))
            prof = r[0][0] if r else err
        with_data = sum(1 for (t, k) in populated if k == other)
        rec('A', '%s cannot read %s rows (%d org tables, %d hold %s rows)' % (uname, other, len(org_tables), with_data, other),
            not leaks and not errors and prof == 0,
            'leaks=%s errors=%s other-company profiles visible=%s own rows visible=%d' % (leaks or 'none', errors[:3] or 'none', prof, own))

# ---------------------------------------------------------------- B: cross-company write
for me, other in PAIRS:
    uname = me + '.admin'
    with as_user(uname):
        before = privileged("select count(*), md5(string_agg(id::text || coalesce(notes,''), ',' order by id)) from public.vehicle_fleet where organisation_id=%s", (ORG[other],))[0]
        r, err = attempt("insert into public.vehicle_fleet (asset_no, vehicle_type, site, country, status, organisation_id) values ('ZZ999','PICKUP','X','KSA','Active',%s) returning id", (ORG[other],))
        landed = privileged("select count(*) from public.vehicle_fleet where organisation_id=%s and asset_no='ZZ999'", (ORG[other],))[0][0]
        rec('B', '%s cannot INSERT a vehicle into %s' % (uname, other), landed == 0, 'error=%s rows landed in %s (privileged recount)=%d' % (err, other, landed))
        r, err = attempt("update public.vehicle_fleet set notes='tampered' where organisation_id=%s returning id", (ORG[other],))
        r2, err2 = attempt("update public.tyre_records set remarks='tampered' where organisation_id=%s returning id", (ORG[other],))
        r3, err3 = attempt("delete from public.work_orders where organisation_id=%s returning id", (ORG[other],))
        r4, err4 = attempt("delete from public.parts_consumption where organisation_id=%s returning id", (ORG[other],))
        after = privileged("select count(*), md5(string_agg(id::text || coalesce(notes,''), ',' order by id)) from public.vehicle_fleet where organisation_id=%s", (ORG[other],))[0]
        n = [len(x) if isinstance(x, list) else x for x in (r, r2, r3, r4)]
        rec('B', '%s cannot UPDATE or DELETE %s fleet, tyres, job cards, expense lines' % (uname, other),
            before == after and all((x or 0) == 0 for x in n),
            'rows affected fleet-update=%s tyre-update=%s wo-delete=%s expense-delete=%s errors=%s fleet hash unchanged=%s'
            % (n[0], n[1], n[2], n[3], [e for e in (err, err2, err3, err4) if e] or 'none', before == after))
        # control: the same admin CAN write inside its own company
        r, err = attempt("insert into public.vehicle_fleet (asset_no, vehicle_type, site, country, status, organisation_id) values ('ZZ998','PICKUP','X','KSA','Active',%s) returning id", (ORG[me],))
        rec('B', 'control: %s CAN insert a vehicle into its own company' % uname, bool(r), 'rows=%s error=%s' % (len(r) if r else 0, err))
        # moving an own row into the other company
        r, err = attempt("update public.vehicle_fleet set organisation_id=%s where organisation_id=%s and asset_no='PL001' returning id", (ORG[other], ORG[me]))
        moved = privileged("select count(*) from public.vehicle_fleet where organisation_id=%s and notes is null and asset_no='PL001'", (ORG[other],))[0][0]
        rec('B', '%s cannot MOVE its own vehicle into %s' % (uname, other), not r, 'rows=%s error=%s' % (len(r) if r else 0, err))

# ---------------------------------------------------------------- C: country scoping inside a company
for org in ['alpha', 'beta']:
    for role, scope in [('manager', 'KSA'), ('engineer', 'UAE'), ('inspector', 'Egypt'), ('tyreman', 'KSA')]:
        uname = '%s.%s' % (org, role)
        with as_user(uname):
            out = {}
            for t in ['vehicle_fleet', 'tyre_records', 'work_orders', 'parts_consumption', 'inspections', 'accidents', 'stock_records']:
                r, err = attempt("select count(*) filter (where country = %%s), count(*) filter (where country is distinct from %%s) from public.%s" % t, (scope, scope))
                out[t] = err or (r[0][0], r[0][1])
        bad = {t: v for t, v in out.items() if not isinstance(v, tuple) or v[1] != 0}
        rec('C', '%s (scope %s) sees only %s rows' % (uname, scope, scope), not bad,
            'table: (in scope, out of scope) %s' % {t: v for t, v in out.items()})
    with as_user(org + '.manager'):
        r, err = attempt("insert into public.tyre_records (serial_no, asset_no, country, tyre_position, status, data_source, organisation_id) values ('SYN-X-1','TM001','UAE','LHF1','Removed','manual',%s) returning id", (ORG[org],))
        landed = privileged("select count(*) from public.tyre_records where serial_no='SYN-X-1'")[0][0]
        r2, err2 = attempt("insert into public.tyre_records (serial_no, asset_no, country, tyre_position, status, data_source, organisation_id) values ('SYN-X-2','TM001','KSA','LHF1','Removed','manual',%s) returning id", (ORG[org],))
        rec('C', '%s.manager (KSA) cannot write a UAE tyre row; KSA control row accepted' % org, landed == 0 and bool(r2),
            'UAE insert landed=%d error=%s | KSA control rows=%s error=%s' % (landed, err, len(r2) if r2 else 0, err2))

# ---------------------------------------------------------------- D: empty company
RPCS = ['get_user_module_permissions', 'get_my_access_grants', 'get_my_capabilities', 'get_subscription_overview', 'report_tyre_summary',
        'get_cost_cpk_overview', 'get_parts_expense_snapshot', 'get_maintenance_snapshot', 'get_tyre_running_life',
        'get_expense_by_country', 'get_fleet_cpk', 'get_country_kpi', 'get_data_trust_overview', 'get_upload_coverage_detail',
        'get_mobile_analytics', 'get_public_config', 'reference_asset_options', 'reference_site_options',
        'get_tyre_filter_options', 'get_daily_job_cards', 'get_work_order_stats', 'get_brand_size_cpk', 'get_asset_master',
        'get_cost_per_m3', 'get_schedule_adherence', 'workforce_board_summary', 'list_scrapped_tyres', 'get_tyre_consumption']
def rpc_call(name):
    r = q("""select p.oid::regprocedure::text,
                    (select string_agg(format('%%I := null::%%s', p.proargnames[i], format_type(p.proargtypes[i-1], null)), ', ')
                       from generate_series(1, p.pronargs - p.pronargdefaults) i)
             from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=%s order by p.pronargs limit 1""", (name,))
    if not r: return None
    return 'select count(*) from public.%s(%s)' % (name, r[0][1] or '')
conn.rollback()
calls = {n: rpc_call(n) for n in RPCS}
conn.rollback()
with as_user('gamma.admin'):
    seen = {}
    for t in org_tables:
        r, err = attempt('select count(*) from public.%s' % psycopg2.extensions.quote_ident(t, cur))
        if err: seen[t] = err
        elif r[0][0]: seen[t] = r[0][0]
    foreign = {}
    for t, v in seen.items():
        if isinstance(v, int):
            n = privileged('select count(*) from public.%s where organisation_id is not null and organisation_id <> %%s' % psycopg2.extensions.quote_ident(t, cur), (ORG['gamma'],))[0][0]
            r, _ = attempt('select count(*) from public.%s where organisation_id is not null and organisation_id <> %%s' % psycopg2.extensions.quote_ident(t, cur), (ORG['gamma'],))
            if r and r[0][0]: foreign[t] = r[0][0]
    errs = {t: v for t, v in seen.items() if not isinstance(v, int)}
    rec('D', 'gamma.admin reads zero rows of any other company on %d org tables, without errors' % len(org_tables),
        not foreign and not errs, 'other-company rows visible=%s errors=%s own or null-org rows visible=%s'
        % (foreign or 'none', errs or 'none', {t: v for t, v in seen.items() if isinstance(v, int)} or 'none'))
    for t in ['vehicle_fleet', 'tyre_records', 'work_orders', 'parts_consumption', 'inspections', 'accidents', 'stock_records', 'sites']:
        pass
    okc, bad = [], {}
    for n, sql in calls.items():
        if sql is None: bad[n] = 'function not present'; continue
        r, err = attempt(sql)
        if err: bad[n] = err
        else: okc.append(n)
    rec('D', 'gamma.admin: %d key RPCs return without error on an empty company' % len(calls), not bad,
        'ok=%d failed=%s' % (len(okc), bad or 'none'))
with as_user('gamma.admin'):
    r, err = attempt("insert into public.vehicle_fleet (asset_no, vehicle_type, site, country, status) values ('GM001','PICKUP','GAMMA YARD','KSA','Active') returning organisation_id::text")
    rec('D', 'gamma.admin can add its first vehicle and it lands in Gamma', bool(r) and r[0][0] == ORG['gamma'],
        'returned organisation=%s error=%s' % ('gamma' if r and r[0][0] == ORG['gamma'] else (r[0][0] if r else None), err))

# ---------------------------------------------------------------- T: tenancy findings
# Each finding is split into sub-checks. A sub-check is (label, vulnerable?, evidence[, hold reason]).
# REPRODUCES = every sub-check vulnerable, PARTIAL = some, NOT REPRODUCED = none.
# A hold reason never changes the measurement: the sub-check still counts as vulnerable. It only says,
# next to the result, that the open state is a documented design hold (and why), so it is not read as
# an oversight. When every still-open sub-check carries a hold reason the state is OPEN BY DESIGN HOLD.
def ten(code, title, subs):
    subs = [tuple(x) + (None,) * (4 - len(x)) for x in subs]
    v = [x for x in subs if x[1]]
    state = 'REPRODUCES' if len(v) == len(subs) else ('PARTIAL' if v else 'NOT REPRODUCED')
    if v and len(v) < len(subs) and all(x[3] for x in v):
        state = 'OPEN BY DESIGN HOLD'
    def word(x): return ('HELD' if x[3] else 'VULNERABLE') if x[1] else 'closed'
    results.append({'section': 'T', 'name': '%s %s' % (code, title), 'ok': None, 'state': state,
                    'subs': [{'check': x[0], 'vulnerable': bool(x[1]), 'evidence': str(x[2])[:300],
                              'hold': (x[3] if x[1] else None)} for x in subs],
                    'evidence': ' | '.join('%s: %s (%s)' % (x[0], word(x), str(x[2])[:140]) for x in subs)})

def impersonate(username):
    cur.execute("set local role authenticated")
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': USER[username], 'role': 'authenticated', 'aal': 'aal1'}),))

def set_config_row(key, value):
    """Flip a platform switch inside the current (rolled back) transaction, as the owner."""
    cur.execute('reset role')
    cur.execute('alter table public.system_config disable trigger user')
    cur.execute("insert into public.system_config (key, value) values (%s, %s) on conflict (key) do update set value = excluded.value", (key, value))
    cur.execute('alter table public.system_config enable trigger user')

# TEN-1: Beta stages a job card carrying an Alpha job card number
victim = q("select work_order_no, asset_no, coalesce(description,'') from public.work_orders where organisation_id=%s and work_type='Repair' order by work_order_no limit 1", (ORG['alpha'],))[0]
with as_user('beta.manager'):
    r, err = attempt("""insert into public.stg_job_cards_ksa ("Job Card No","Asset Code","Status","Type","Job Repair Description","Location","Production Out")
                        values (%s,'HIJACK01','Closed','General','overwritten by beta','BETA DEPOT ONE','01-11-2026 08:00')""", (victim[0],))
    after = privileged("select organisation_id::text, asset_no from public.work_orders where work_order_no=%s", (victim[0],))
    alpha_changed = any(x[0] == ORG['alpha'] and x[1] != victim[1] for x in after)
    beta_has = any(x[0] == ORG['beta'] for x in after)
    ten('TEN-1', 'job card import overwrites another company work order', [
        ('Alpha job card rewritten by a Beta upload', alpha_changed, 'Alpha asset after=%s was=%s' % ([x[1] for x in after if x[0] == ORG['alpha']], victim[1])),
        ('Beta cannot hold the same job card number itself', not beta_has, 'Beta row created=%s error=%s' % (beta_has, err))])

# TEN-2: raw upload tables readable by another company Admin
conn.rollback()
m, merr = attempt("""insert into public.ksa_kms ("Asset name") values ('SYNTHETIC-ALPHA-ASSET') returning 1""")
if not m:   # after the fix the table carries an organisation column that must be stamped
    m, merr = attempt("""insert into public.ksa_kms ("Asset name", organisation_id) values ('SYNTHETIC-ALPHA-ASSET', %s) returning 1""", (ORG['alpha'],))
impersonate('beta.admin')
r, err = attempt("select count(*) from public.ksa_kms")
impersonate('alpha.admin')
c, cerr = attempt("select count(*) from public.ksa_kms")
ten('TEN-2', 'raw upload tables readable by any company Admin', [
    ('Beta Admin reads an Alpha row in ksa_kms', bool(r and r[0][0] > 0), 'beta.admin count=%s error=%s; control alpha.admin count=%s; marker insert error=%s' % (r[0][0] if r else None, err, c[0][0] if c else cerr, merr))])
conn.rollback()

# TEN-3: customer Admin writes platform-wide configuration
with as_user('beta.admin'):
    r1, e1 = attempt("update public.modules set status='disabled' where module_id=(select min(module_id) from public.modules where status='live') returning module_id")
    r2, e2 = attempt("update public.subscription_plans set price_monthly=1 where code='enterprise' returning code")
    r3, e3 = attempt("update public.due_alert_rules set enabled=false returning rule_key")
    ten('TEN-3', 'customer Admin changes platform-wide configuration', [
        ('modules', bool(r1), 'rows=%d %s' % (len(r1 or []), e1 or '')),
        ('subscription_plans', bool(r2), 'rows=%d %s' % (len(r2 or []), e2 or '')),
        ('due_alert_rules', bool(r3), 'rows=%d %s' % (len(r3 or []), e3 or ''))])

# TEN-4: admin RPCs act on a user of another company
with as_user('beta.admin'):
    r1, e1 = attempt("select public.admin_set_user_sites(%s, array['HIJACKED'], null)", (USER['alpha.manager'],))
    r2, e2 = attempt("select public.admin_set_web_access(%s, false)", (USER['alpha.manager'],))
    after = privileged("select sites, web_access from public.profiles where id=%s", (USER['alpha.manager'],))[0]
    # The function returns ONE jsonb value, so a row count is always 1. Vulnerable means a non-empty
    # module map came back for the foreign id. Controls: the Alpha manager's own map is non-empty, and an
    # Alpha Admin still gets it (same company), so a refusal here is the rule and not a broken function.
    r3, e3 = attempt("select public.get_user_module_permissions(%s)", (USER['alpha.manager'],))
    foreign_keys = len(r3[0][0] or {}) if r3 else 0
    impersonate('alpha.manager')
    own, eo = attempt("select public.get_user_module_permissions()")
    impersonate('alpha.admin')
    same, es = attempt("select public.get_user_module_permissions(%s)", (USER['alpha.manager'],))
    impersonate('beta.admin')
    ctl = 'control own map keys=%s, same-company Admin keys=%s%s' % (len(own[0][0] or {}) if own else eo, len(same[0][0] or {}) if same else es,
                                                               '' if (own and own[0][0]) else ' (CONTROL EMPTY: result not conclusive)')
    ten('TEN-4', 'admin RPCs act on a user in another company', [
        ('admin_set_user_sites', after[0] != ['ALL'], 'sites after=%s %s' % (after[0], e1 or '')),
        ('admin_set_web_access', after[1] is False, 'web_access after=%s %s' % (after[1], e2 or '')),
        ('get_user_module_permissions answers for a foreign user id', foreign_keys > 0, 'module keys returned=%s %s; %s' % (foreign_keys, e3 or '', ctl))])

# TEN-5: customer Admin grants itself a plan / unlocks itself
with as_user('beta.admin'):
    r1, e1 = attempt("update public.org_subscriptions set plan_code='enterprise', status='active' where organisation_id=%s returning plan_code", (ORG['beta'],))
    r2, e2 = attempt("update public.organisations set plan='enterprise', max_users=9999, locked=false where id=%s returning plan", (ORG['beta'],))
    after = privileged("select plan, max_users from public.organisations where id=%s", (ORG['beta'],))[0]
    ten('TEN-5', 'customer Admin grants itself any plan', [
        ('own org_subscriptions row', bool(r1), 'rows=%d %s' % (len(r1 or []), e1 or '')),
        ('own organisations.plan / max_users / locked', after[0] == 'enterprise' or after[1] == 9999, 'plan after=%s max_users after=%s rows=%d %s' % (after[0], after[1], len(r2 or []), e2 or ''))])

# TEN-6: entitlement enforcement
def ten6(switch_on):
    conn.rollback()
    if switch_on: set_config_row('entitlement_enforcement', 'on')
    cur.execute('reset role')
    cur.execute("update public.organisations set locked=true, active=false where id=%s", (ORG['beta'],))
    cur.execute("delete from public.org_subscriptions where organisation_id=%s", (ORG['gamma'],))
    impersonate('beta.manager')
    r, err = attempt("select count(*) from public.vehicle_fleet")
    impersonate('gamma.admin')
    ins, e3 = attempt("insert into public.vehicle_fleet (asset_no, vehicle_type, site, country, status) select 'GX'||g, 'PICKUP','GAMMA YARD','KSA','Active' from generate_series(1,30) g returning 1")
    ov, e2 = attempt("select public.get_subscription_overview()")
    endless = False
    try:
        o = ov[0][0]; sub = o.get('subscription') or {}
        endless = (sub.get('status') in ('trialing', 'active')) and not sub.get('trial_ends_at')
    except Exception: pass
    conn.rollback()
    return (bool(r and r[0][0] > 0), 'locked Beta manager reads %s vehicles %s' % (r[0][0] if r else None, err or '')), \
           (bool(ins), 'company with no subscription row inserted %d vehicles (trial cap 25) %s' % (len(ins or []), e3 or '')), \
           (endless, 'overview reports a usable plan with no end date=%s %s' % (endless, e2 or ''))
a1, b1, c1 = ten6(False)
has_switch = True
a2, b2, c2 = ten6(True)
HOLD_SWITCH6 = 'deliberate: entitlement_enforcement ships off to protect the current company; closed when the owner turns it on (see the two rows below)'
ten('TEN-6', 'subscription state and plan limits are not enforced', [
    ('locked company still reads data (switches as shipped)', a1[0], a1[1], HOLD_SWITCH6),
    ('no subscription row means no vehicle limit (switches as shipped)', b1[0], b1[1], HOLD_SWITCH6),
    ('locked company still reads data (entitlement_enforcement = on)', a2[0], a2[1]),
    ('no subscription row means no vehicle limit (entitlement_enforcement = on)', b2[0], b2[1]),
    ('missing subscription row reported as an endless trial (switches as shipped)', c1[0], c1[1], HOLD_SWITCH6),
    ('missing subscription row reported as an endless trial (entitlement_enforcement = on)', c2[0], c2[1])])

# TEN-7: second tenant shares configuration that shapes its data
with as_user('beta.manager'):
    mp = attempt("select count(*) from public.module_permissions where org_id is null")[0]
    mail, me_ = attempt("select count(*) from public.system_config where key in ('accident_email_to','accident_email_cc')")
    impersonate('alpha.manager')   # control: the company the mailbox belongs to must still read it
    mail_ctl, mce = attempt("select count(*) from public.system_config where key in ('accident_email_to','accident_email_cc')")
    impersonate('beta.manager')
    r, err = attempt("insert into public.accidents (asset_no, incident_date, accident_type, severity, status, site, country) values ('TM001', current_date, 'other', 'minor', 'reported', 'BETA NEW-ST', 'KSA') returning site")
    cur.execute('reset role')
    cur.execute("insert into public.custom_roles (organisation_id, name) values (%s, 'Alpha Only Role')", (ORG['alpha'],))
    cur.execute("alter table public.profiles disable trigger trg_guard_profile_privileged")
    cur.execute("update public.profiles set role='Alpha Only Role' where id=%s returning role", (USER['beta.driver'],))
    role_after = cur.fetchone()[0]
    ten('TEN-7', 'second tenant shares and is shaped by global configuration', [
        ('Beta runs on the one global role matrix', bool(mp and mp[0][0]), 'global rows visible to beta.manager=%s' % (mp[0][0] if mp else None),
         'by design (TEN-7 decision D1): the global rows are the starter matrix every company inherits for the built-in roles, and reading them is how the current company resolves access today'),
        ('Beta manager reads the shared accident mailbox keys', bool(mail and mail[0][0]),
         'keys visible to beta.manager=%s %s; control alpha.manager=%s' % (mail[0][0] if mail else None, me_ or '', mail_ctl[0][0] if mail_ctl else mce)),
        ('a Beta site name is silently rewritten', bool(r) and r[0][0] != 'BETA NEW-ST', 'typed "BETA NEW-ST" stored as "%s" %s' % (r[0][0] if r else None, err or '')),
        ('a role name defined only in Alpha is accepted for a Beta user', role_after == 'Alpha Only Role', 'role stored=%s' % role_after)])

# TEN-8: hard-coded fallback company
def ten8(single_tenant):
    conn.rollback()
    set_config_row('single_tenant_mode', single_tenant)
    cur.execute('reset role')
    s1, e1 = attempt("""insert into auth.users (id, email, raw_user_meta_data) values ('99999999-0000-4000-8000-000000000009', 'newsignup@staging.tyrepulse.invalid', '{"username":"new.signup","full_name":"Test Signup"}') returning 1""")
    org_of_new = q1("select org_id::text from public.profiles where id='99999999-0000-4000-8000-000000000009'")
    cur.execute("set local role service_role")
    r, err = attempt("insert into public.vehicle_fleet (asset_no, vehicle_type, site, country, status) values ('SVC001','PICKUP','BETA DEPOT ONE','KSA','Active') returning organisation_id::text")
    conn.rollback()
    return (org_of_new == ORG['alpha'], 'sign-up with no invitation got organisation=%s %s' % ('Alpha' if org_of_new == ORG['alpha'] else org_of_new, e1 or '')), \
           (bool(r) and r[0][0] == ORG['alpha'], 'service insert with no organisation landed in=%s %s' % ('Alpha' if r and r[0][0] == ORG['alpha'] else (r[0][0] if r else None), err or ''))
x1, y1 = ten8('true'); x2, y2 = ten8('false')
HOLD_SWITCH8 = 'deliberate: single_tenant_mode ships true, which is the current company behaviour; closed when the owner sets it false (see the two rows below)'
ten('TEN-8', 'sign-ups and service loads fall back into the first company', [
    ('sign-up lands in Alpha (single_tenant_mode = true, as shipped)', x1[0], x1[1], HOLD_SWITCH8),
    ('service load lands in Alpha (single_tenant_mode = true, as shipped)', y1[0], y1[1], HOLD_SWITCH8),
    ('sign-up lands in Alpha (single_tenant_mode = false)', x2[0], x2[1]),
    ('service load lands in Alpha (single_tenant_mode = false)', y2[0], y2[1])])

# TEN-9: tenant lifecycle
conn.rollback()
inv = q1("select to_regclass('public.org_invitations') is not null")
prov = [p[0] for p in q("select proname from pg_proc where pronamespace='public'::regnamespace and proname in ('admin_provision_organisation','provision_organisation','admin_purge_organisation','purge_organisation','org_invite_member','seed_new_organisation')")]
glob_keys = [k[0] for k in q("select conname from pg_constraint where conrelid='public.profiles'::regclass and contype='u' and pg_get_constraintdef(oid) = 'UNIQUE (username)' union all select indexrelid::regclass::text from pg_index where indrelid='public.profiles'::regclass and indisunique and pg_get_indexdef(indexrelid) ~ 'lower\\(username\\)' and pg_get_indexdef(indexrelid) !~ 'org_id'")]
conn.rollback()
ten('TEN-9', 'no safe tenant lifecycle', [
    ('no invitation table', not inv, 'org_invitations exists=%s' % inv),
    ('no provisioning or purge function', not prov, 'functions present=%s' % (prov or 'none')),
    ('username is unique across ALL companies', bool(glob_keys), 'global unique keys still present=%s' % (glob_keys or 'none'),
     'documented design hold: sign-in resolves a user by username alone, so the key must stay global until sign-in takes a company code')])

# ---------------------------------------------------------------- report
conn.rollback()
print('=== Tyre Pulse staging isolation tests [%s] ===' % a.label)
fails = 0
for r in results:
    if r['section'] == 'T':
        print('[%s] %-14s %s' % (r['section'], r['state'], r['name']))
        for x in r['subs']:
            print('       - %-10s %s :: %s' % (('HELD' if x.get('hold') else 'VULNERABLE') if x['vulnerable'] else 'closed', x['check'], x['evidence'][:230]))
            if x.get('hold'):
                print('         %-10s still open, held on purpose: %s' % ('', x['hold']))
    else:
        fails += not r['ok']
        print('[%s] %-4s %s\n       %s' % (r['section'], 'PASS' if r['ok'] else 'FAIL', r['name'], r['evidence']))
iso = [r for r in results if r['section'] != 'T']
tens = [r for r in results if r['section'] == 'T']
print('--- isolation checks: %d passed, %d failed. Tenancy findings: %s'
      % (sum(1 for r in iso if r['ok']), fails, ', '.join('%s=%s' % (r['name'].split(' ')[0], r['state']) for r in tens)))
if a.json:
    json.dump({'label': a.label, 'results': results}, open(a.json, 'w'), indent=1)
sys.exit(1 if fails else 0)
