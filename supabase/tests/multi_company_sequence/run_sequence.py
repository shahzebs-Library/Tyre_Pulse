#!/usr/bin/env python3
"""Runs the whole multi-company migration sequence on a COPY of the local staging database.

  1. create a copy of the staging baseline (three synthetic companies) and shape it like production
     (prepare_production_shape.sql);
  2. take a "current company" snapshot (company Alpha);
  3. apply every draft in sequence.json in order; after each one re-take the snapshot and compare;
  4. run the tests of the round 2 drafts (TEN-6b, TEN-7c, TEN-8b, TEN-9b);
  5. apply the HOLD step (per-company usernames), re-take the snapshot, run its tests.

Everything a test changes is rolled back. Nothing here can reach production: the script refuses any
host other than 127.0.0.1 / localhost. Usage:

  /usr/bin/python3 run_sequence.py --port 54329 --template tyrepulse_staging --db tp_commercial2 \
      --out /path/outside/the/repository/report.json

Needs psql on PATH and a Python with psycopg2.
"""
import argparse, contextlib, json, os, subprocess, sys
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
PENDING = os.path.normpath(os.path.join(HERE, '..', '..', 'pending_migrations'))
ALPHA = '00000000-0000-0000-0000-000000000001'

ap = argparse.ArgumentParser()
ap.add_argument('--host', default='127.0.0.1'); ap.add_argument('--port', default='54329')
ap.add_argument('--template', default='tyrepulse_staging'); ap.add_argument('--db', default='tp_commercial2')
ap.add_argument('--out'); ap.add_argument('--keep', action='store_true', help='reuse the database instead of recreating it')
args = ap.parse_args()
if args.host not in ('127.0.0.1', 'localhost'):
    sys.exit('Refusing: this runner only talks to a local database.')

def psql(db, *extra, check=True):
    cmd = ['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', args.host, '-p', str(args.port), '-U', 'postgres', '-d', db, *extra]
    return subprocess.run(cmd, capture_output=True, text=True, check=check)

if not args.keep:
    psql('postgres', '-c', "select pg_terminate_backend(pid) from pg_stat_activity where datname = '%s' and pid <> pg_backend_pid()" % args.db)
    psql('postgres', '-c', 'drop database if exists %s' % args.db)
    psql('postgres', '-c', 'create database %s template %s' % (args.db, args.template))
    psql(args.db, '-f', os.path.join(HERE, 'prepare_production_shape.sql'))

conn = psycopg2.connect(host=args.host, port=args.port, dbname=args.db, user='postgres')
cur = conn.cursor()

def q(sql, params=None):
    cur.execute(sql, params); return cur.fetchall()
def q1(sql, params=None):
    r = q(sql, params); return r[0][0] if r else None

USER = {}
def load_users():
    USER.clear()
    for uid, name in q("select id, username from public.profiles where username is not null"):
        USER[name] = str(uid)
    conn.rollback()

def become(username, aal='aal1'):
    cur.execute('reset role')
    cur.execute("select set_config('request.jwt.claims', %s, true)",
                (json.dumps({'sub': USER[username], 'role': 'authenticated', 'aal': aal}),))
    cur.execute('set local role authenticated')
def become_anon():
    cur.execute('reset role')
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'role': 'anon'}),))
    cur.execute('set local role anon')
def become_service():
    cur.execute('reset role')
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'role': 'service_role'}),))
    cur.execute('set local role service_role')
def become_owner():
    cur.execute('reset role'); cur.execute("select set_config('request.jwt.claims', '', true)")

def attempt(sql, params=None):
    """Statement that may be refused: (rows or rowcount, error text or None). Uses a savepoint."""
    cur.execute('savepoint s')
    try:
        cur.execute(sql, params)
        out = cur.fetchall() if cur.description else cur.rowcount
        cur.execute('release savepoint s'); return out, None
    except psycopg2.Error as e:
        cur.execute('rollback to savepoint s')
        return None, ((e.pgcode or '') + ' ' + (e.diag.message_primary or str(e))).strip()

def signup(meta, email, uid=None):
    """What the sign-up trigger does for a new auth user. Returns (org, role, approved) or error text."""
    become_owner()
    r, err = attempt("insert into auth.users (id, email, raw_user_meta_data) values (coalesce(%s::uuid, gen_random_uuid()), %s, %s) returning id",
                     (uid, email, json.dumps(meta)))
    if err: return 'ERROR ' + err
    row = q("select org_id::text, role, approved from public.profiles where id = %s", (r[0][0],))
    return row[0] if row else ('NO PROFILE',)

COUNT_TABLES = ['vehicle_fleet', 'tyre_records', 'work_orders', 'inspections', 'accidents', 'stock_records',
                'parts_consumption', 'corrective_actions', 'sites', 'alerts', 'profiles', 'custom_roles',
                'module_permissions', 'organisations']
BASE_CONFIG_KEYS = None

def snapshot():
    """Everything that must stay identical for the current company, as a flat dict."""
    global BASE_CONFIG_KEYS
    conn.rollback(); snap = {}
    alpha_users = sorted(u for u in USER if u.startswith('alpha.') or u == 'platform.superadmin')
    if BASE_CONFIG_KEYS is None:
        BASE_CONFIG_KEYS = [r[0] for r in q('select key from public.system_config order by key')]
    for u in alpha_users:
        conn.rollback(); become(u)
        snap[u + ' permissions md5'] = q1("select md5(public.get_user_module_permissions()::text)")
        snap[u + ' capability matrix md5'] = q1(
            "select md5(string_agg(m.module_id || ':' || c || '=' || coalesce(public.app_user_can(m.module_id, c)::text, 'null'), ',' order by m.module_id, c)) "
            "from public.modules m cross join unnest(array['view','create','edit','delete','approve','export']) c")
        for t in COUNT_TABLES:
            r, err = attempt('select count(*) from public.%s' % t)
            snap['%s rows visible in %s' % (u, t)] = r[0][0] if r else 'ERROR ' + err
        r, err = attempt("select count(*), md5(coalesce(string_agg(key || '=' || coalesce(value, ''), '|' order by key), '')) "
                         "from public.system_config where key = any(%s)", (BASE_CONFIG_KEYS,))
        snap[u + ' system_config (baseline keys)'] = list(r[0]) if r else 'ERROR ' + err
    for u in ('alpha.admin', 'alpha.manager', 'alpha.tyreman'):
        conn.rollback(); become(u)
        r, err = attempt("insert into public.vehicle_fleet (asset_no, country, site) values ('ZZ-SNAP-1', 'KSA', 'nhc-st') "
                         "returning organisation_id::text, site")
        snap[u + ' adds a vehicle'] = list(r[0]) if r else 'REFUSED ' + err
    # sign-in resolution, as an anonymous caller, for every current-company account
    conn.rollback(); become_owner()
    ids = q("select username, employee_id from public.profiles where org_id = %s order by 1", (ALPHA,))
    become_anon()
    for uname, emp in ids:
        for ident in (uname, emp, (uname or '').upper()):
            if ident:
                r, err = attempt('select public.get_email_by_identifier(%s)', (ident,))
                snap['sign-in resolves %s' % ident] = r[0][0] if r else 'ERROR ' + err
    conn.rollback()
    snap['sign-up with no invitation'] = list(signup({'username': 'zz.snap.user', 'employee_id': 'ZZ-SNAP-9', 'region': 'KSA'},
                                                    'zz.snap.user@users.tyrepulse.app'))
    conn.rollback(); become_owner()
    r, err = attempt("insert into public.vehicle_fleet (asset_no, country, site) values ('ZZ-SNAP-2', 'KSA', 'nhc-st') returning organisation_id::text, site")
    snap['service load with no session'] = list(r[0]) if r else 'REFUSED ' + err
    conn.rollback(); become_owner()
    # historical records: nothing in any company's data is rewritten by a migration
    for t, extra in (('work_orders', "coalesce(sum(total_cost),0)::text || '/' || coalesce(max(updated_at)::text,'')"),
                     ('tyre_records', "coalesce(sum(cost_per_tyre),0)::text"),
                     ('parts_consumption', "coalesce(sum(line_cost),0)::text"),
                     ('inspections', "count(*) filter (where approval_status = 'approved')::text"),
                     ('vehicle_fleet', "md5(coalesce(string_agg(asset_no || coalesce(site,''), ',' order by asset_no), ''))"),
                     ('profiles', "md5(coalesce(string_agg(id::text || coalesce(role,'') || coalesce(approved::text,'') || coalesce(org_id::text,''), ',' order by id), ''))")):
        org_col = 'org_id' if t == 'profiles' else 'organisation_id'
        r, err = attempt('select %s::text, count(*), %s from public.%s group by 1 order by 1' % (org_col, extra, t))
        snap['stored data ' + t] = [list(x) for x in r] if r is not None else 'ERROR ' + err
    conn.rollback()
    return snap

def diff(a, b):
    return [k for k in sorted(set(a) | set(b)) if a.get(k) != b.get(k)]

results = []
def rec(section, name, ok, evidence=''):
    results.append({'section': section, 'name': name, 'ok': bool(ok), 'evidence': str(evidence)[:500]})
    print('  %-4s %-9s %s%s' % ('PASS' if ok else 'FAIL', section, name, '' if ok else '  :: ' + str(evidence)[:300]))

# ----------------------------------------------------------------------------------------------
load_users()
with open(os.path.join(HERE, 'sequence.json')) as _f:
    seq = json.load(_f)
base = snapshot()
print('baseline snapshot: %d facts about the current company' % len(base))
steps = []
def apply(step, kind):
    path = os.path.join(PENDING, step['file'])
    conn.rollback()
    p = psql(args.db, '-1', '-f', path, check=False)
    ok = p.returncode == 0
    err = '' if ok else next((l for l in p.stderr.splitlines() if 'ERROR' in l or 'FATAL' in l), p.stderr[-300:])
    load_users()
    changed = diff(base, snapshot()) if ok else ['not compared']
    steps.append({'file': step['file'], 'kind': kind, 'applied': ok, 'error': err[:300], 'current_company_changed': changed})
    print('%s %s  current company: %s' % ('APPLIED' if ok else 'FAILED ', step['file'],
          'unchanged' if not changed else 'CHANGED ' + '; '.join(changed[:6])))
    return ok

if not args.keep:
    for s in seq['steps']:
        if not apply(s, 'sequence'): break
after_sequence = snapshot()

# ---------------------------------------------------------------------------- round 2 draft tests
ORG = {r[1]: str(r[0]) for r in q("select id, slug from public.organisations")}; conn.rollback()
BETA, GAMMA = ORG['beta-haulage'], ORG['gamma-new-fleet']

def set_cfg(key, value):
    become_owner()
    cur.execute("update public.system_config set value = %s where key = %s", (value, key))
    if cur.rowcount == 0:
        cur.execute("insert into public.system_config (key, value) values (%s, %s)", (key, value))

@contextlib.contextmanager
def tx():
    conn.rollback()
    try: yield
    finally: conn.rollback()

print('\nTEN-6b plan limits and the enforcement switch')
with tx():
    become('platform.superadmin', 'aal2')
    pre = q1('select public.entitlement_enforcement_preflight()')
    legacy = [o for o in pre['organisations'] if o['is_legacy']][0]
    rec('TEN-6b', 'the current company is on the internal plan with no limits and above the trial caps',
        legacy['plan_code'] == 'internal' and legacy['max_vehicles'] is None and legacy['vehicles'] > 25 and legacy['approved_users'] > 3,
        {k: legacy[k] for k in ('plan_code', 'vehicles', 'max_vehicles', 'approved_users', 'max_users', 'standing')})
    rec('TEN-6b', 'preflight: the current company would be refused nothing by the switch', pre['legacy_company_unchanged'] is True and legacy['would_refuse'] == [])
    others = {o['name']: o['would_refuse'] for o in pre['organisations'] if not o['is_legacy']}
    rec('TEN-6b', 'preflight names what each other company would lose (a module its plan does not include)',
        pre['safe_to_enable'] is False and all(any(x.startswith('modules_refused') for x in v) for v in others.values()), others)
    rec('TEN-6b', 'the switch is off as shipped', pre['enforcement'] == 'off')
with tx():
    become('alpha.manager'); r, err = attempt('select public.entitlement_enforcement_preflight()')
    rec('TEN-6b', 'a company Manager cannot read the preflight', err and err.startswith('42501'), err)
    r, err = attempt("select public.admin_set_entitlement_enforcement(true, 'x')")
    rec('TEN-6b', 'a company Manager cannot turn enforcement on', err and err.startswith('42501'), err)
    become('alpha.admin'); r, err = attempt("select public.admin_set_entitlement_enforcement(true, 'x')")
    rec('TEN-6b', 'a company Admin cannot turn enforcement on', err and err.startswith('42501'), err)
with tx():
    become('platform.superadmin', 'aal2')
    r, err = attempt("update public.system_config set value = 'on' where key = 'entitlement_enforcement'")
    rec('TEN-6b', 'a direct write of the switch by a signed-in super admin is refused', err and err.startswith('PT409'), err or r)
    r, err = attempt("select public.admin_set_entitlement_enforcement(true, 'staging test')")
    rec('TEN-6b', 'the guarded function refuses until the super admin acknowledges what other companies lose', err and err.startswith('PT409'), err)
    r, err = attempt("select public.admin_set_entitlement_enforcement(true, null, true)")
    rec('TEN-6b', 'a reason is required', err and err.startswith('22023'), err)
    r, err = attempt("select public.admin_set_entitlement_enforcement(true, 'staging test', true)")
    rec('TEN-6b', 'with the acknowledgement the switch turns on and an audit row is written',
        err is None and r[0][0]['enforcement'] == 'on' and q1("select count(*) from public.console_sessions where action = 'set_entitlement_enforcement'") == 1, err)
    become('alpha.admin')
    r, err = attempt("insert into public.vehicle_fleet (asset_no, country, site) values ('ZZ-T6-A', 'KSA', 'NHC') returning organisation_id::text")
    rec('TEN-6b', 'switch ON: the current company (above the trial cap) still adds a vehicle', err is None and r[0][0] == ALPHA, err)
    for u in sorted(x for x in USER if x.startswith('alpha.')):
        become(u); m = q1("select md5(public.get_user_module_permissions()::text)")
        if m != base[u + ' permissions md5']: rec('TEN-6b', 'switch ON: permissions of %s unchanged' % u, False, m)
    rec('TEN-6b', 'switch ON: permission map of every current-company role is identical to the baseline', True)
    become('alpha.manager')
    capm = q1("select md5(string_agg(m.module_id || ':' || c || '=' || coalesce(public.app_user_can(m.module_id, c)::text, 'null'), ',' order by m.module_id, c)) "
              "from public.modules m cross join unnest(array['view','create','edit','delete','approve','export']) c")
    rec('TEN-6b', 'switch ON: capability matrix of the current-company Manager is identical to the baseline',
        capm == base['alpha.manager capability matrix md5'])
with tx():
    # a synthetic company on the trial plan, filled to its vehicle cap
    become_owner()
    cur.execute("insert into public.vehicle_fleet (asset_no, country, site, organisation_id) select 'ZZ-G-' || g, 'KSA', 'GAMMA YARD', %s from generate_series(1, 25) g", (GAMMA,))
    become('gamma.admin')
    r, err = attempt("insert into public.vehicle_fleet (asset_no, country, site) values ('ZZ-G-26', 'KSA', 'GAMMA YARD')")
    rec('TEN-6b', 'trial company at 25 vehicles: the 26th is refused with a plan message', err is not None and 'Plan limit reached' in err, err)
    become_owner(); cur.execute("update public.org_subscriptions set trial_ends_at = now() - interval '1 day', current_period_end = now() - interval '1 day' where organisation_id = %s", (GAMMA,))
    cur.execute("delete from public.vehicle_fleet where organisation_id = %s and asset_no like 'ZZ-G-%%'", (GAMMA,))
    become('gamma.admin')
    r, err = attempt("insert into public.vehicle_fleet (asset_no, country, site) values ('ZZ-G-1', 'KSA', 'GAMMA YARD')")
    rec('TEN-6b', 'switch OFF (as shipped): a company whose trial ended still adds a vehicle (not enforced yet)', err is None, err)
    become('platform.superadmin', 'aal2')
    g = [o for o in q1('select public.entitlement_enforcement_preflight()')['organisations'] if o['name'] == 'Gamma New Fleet'][0]
    rec('TEN-6b', 'preflight reports the company whose trial ended', 'standing:trial_expired' in g['would_refuse'], g['would_refuse'])
    r, err = attempt("select public.admin_set_entitlement_enforcement(true, 'staging test', true)")
    rec('TEN-6b', 'switch turned on with the acknowledgement', err is None, err)
    become('gamma.admin')
    r, err = attempt("insert into public.vehicle_fleet (asset_no, country, site) values ('ZZ-G-2', 'KSA', 'GAMMA YARD')")
    rec('TEN-6b', 'switch ON: the company whose trial ended can no longer add a vehicle', err is not None and 'no active subscription' in err, err or r)
    become('alpha.admin')
    r, err = attempt("insert into public.vehicle_fleet (asset_no, country, site) values ('ZZ-T6-B', 'KSA', 'NHC')")
    rec('TEN-6b', 'switch ON with an expired company present: the current company is unaffected', err is None, err)
with tx():
    become_owner(); cur.execute("update public.org_subscriptions set plan_code = 'trial' where organisation_id = %s", (ALPHA,))
    become('platform.superadmin', 'aal2')
    r, err = attempt("select public.admin_set_entitlement_enforcement(true, 'staging test', true)")
    rec('TEN-6b', 'the switch cannot be turned on while the current company sits on a plan it exceeds', err and err.startswith('PT409') and 'current company' in err, err)

print('\nTEN-7c role matrix per company')
with tx():
    become_owner()
    n_all = q1('select count(*) from public.module_permissions')
    n_builtin = q1('select count(*) from public.module_permissions where org_id is null and role = any (public._builtin_roles())')
    become('alpha.manager'); a = q1('select count(*) from public.module_permissions')
    rec('TEN-7c', 'current company reads every global row, as before', a == n_all == base['alpha.manager rows visible in module_permissions'], (a, n_all))
    become('beta.manager'); b = q1('select count(*) from public.module_permissions')
    bc = q1("select count(*) from public.module_permissions where role <> all (public._builtin_roles())")
    rec('TEN-7c', 'second company reads only the built-in defaults', b == n_builtin and bc == 0, {'visible': b, 'builtin': n_builtin, 'custom_visible': bc, 'all': n_all})
    yl = q1("select count(*) from public.module_permissions where role = 'Alpha Yard Lead'")
    rec('TEN-7c', "second company reads 0 rows of the current company's custom role", yl == 0, yl)
    beta_before = q1("select md5(public.get_user_module_permissions()::text)")
    mod = q1("select module_key from public.module_permissions where org_id is null and role = 'Manager' and enabled order by 1 limit 1")
    r, err = attempt("select public.set_org_module_permissions(%s::jsonb, 'x')", (json.dumps([{'role': 'Manager', 'module_key': mod, 'enabled': False}]),))
    rec('TEN-7c', 'a Manager cannot change the role matrix of the company', err and err.startswith('42501'), err)
    become('beta.admin')
    r, err = attempt("select public.set_org_module_permissions(%s::jsonb, 'staging test')", (json.dumps([{'role': 'Manager', 'module_key': mod, 'enabled': False}]),))
    rec('TEN-7c', 'the company Admin sets an own row', err is None and r[0][0] == 1, err)
    rows = q("select role, module_key, enabled, source from public.get_org_role_matrix() where role = 'Manager' and module_key = %s", (mod,))
    rec('TEN-7c', 'the own row wins over the default and is labelled own', rows == [('Manager', mod, False, 'own')], rows)
    src = dict(q("select source, count(*) from public.get_org_role_matrix() group by 1"))
    rec('TEN-7c', 'every other cell of that company falls back to the default', src.get('own') == 1 and src.get('default', 0) > 100, src)
    become('beta.manager')
    perms = q1("select public.get_user_module_permissions()")
    rec('TEN-7c', 'the second-company Manager now resolves that module as off', perms.get(mod) is False and q1("select md5(public.get_user_module_permissions()::text)") != beta_before, perms.get(mod))
    r, err = attempt('select * from public.get_org_role_matrix()')
    rec('TEN-7c', 'a Manager cannot read the company matrix function', err and err.startswith('42501'), err)
    become('alpha.manager')
    rec('TEN-7c', "current company cannot read the second company's own row",
        q1('select count(*) from public.module_permissions where org_id = %s', (BETA,)) == 0)
    rec('TEN-7c', "current company permissions are unchanged by the second company's edit",
        q1("select md5(public.get_user_module_permissions()::text)") == base['alpha.manager permissions md5'])
    become('gamma.admin')
    rec('TEN-7c', "a third company cannot read the second company's own row",
        q1('select count(*) from public.module_permissions where org_id = %s', (BETA,)) == 0)
with tx():
    become('beta.admin'); r, err = attempt('select public.admin_seed_org_role_matrix(%s, true)', (BETA,))
    rec('TEN-7c', 'a company Admin cannot seed a matrix', err and err.startswith('42501'), err)
    become('beta.manager'); before = q1("select md5(public.get_user_module_permissions()::text)")
    become('platform.superadmin', 'aal2')
    d = q1('select public.admin_seed_org_role_matrix(%s, true)', (BETA,))
    r, err = attempt('select public.admin_seed_org_role_matrix(%s, false)', (BETA,))
    rec('TEN-7c', 'seed copies exactly the built-in defaults (dry run equals real run)', err is None and r[0][0]['copied'] == d['would_copy'] > 0, (d, r, err))
    r, err = attempt('select public.admin_seed_org_role_matrix(%s, false)', (ALPHA,))
    rec('TEN-7c', 'seeding the current company is refused', err and err.startswith('PT409'), err)
    become('beta.manager')
    rec('TEN-7c', 'after a seed the second company resolves the same permissions as before',
        q1("select md5(public.get_user_module_permissions()::text)") == before)

print('\nTEN-8b sign-up by invitation')
def invite(as_user, email, role):
    become(as_user); r, err = attempt('select public.org_invite_member(%s, %s)', (email, role))
    return (r[0][0]['invite_token'] if r else None), err
with tx():
    rec('TEN-8b', 'single-company mode on, no invitation: lands in the current company, pending, as before',
        list(signup({'username': 'zz.t8.a', 'employee_id': 'ZZ8A', 'region': 'KSA'}, 'zz.t8.a@users.tyrepulse.app')) == base['sign-up with no invitation'],
        base['sign-up with no invitation'])
    tok, err = invite('beta.admin', None, 'Inspector')
    rec('TEN-8b', 'a company Admin creates an invitation', tok is not None, err)
    become('beta.manager'); r, err2 = attempt("select public.org_invite_member(null, 'Inspector')")
    rec('TEN-8b', 'a Manager cannot invite', err2 and err2.startswith('42501'), err2)
    become_anon(); pv = q1('select public.get_invitation_preview(%s)', (tok,))
    rec('TEN-8b', 'before sign-in the invitation shows the company and the role', pv.get('ok') and pv['organisation_name'] == 'Beta Haulage LLC' and pv['role'] == 'Inspector', pv)
    rec('TEN-8b', 'a wrong token shows nothing', q1("select public.get_invitation_preview(%s)", ('0' * 64,)) == {'ok': False, 'reason': 'invalid'})
    r, err = attempt('select count(*) from public.org_invitations')
    rec('TEN-8b', 'an anonymous caller cannot read the invitation table', err is not None, err or r)
    s = signup({'username': 'zz.t8.b', 'employee_id': 'ZZ8B', 'invite_token': tok, 'company_code': 'gamma-new-fleet'}, 'zz.t8.b@users.tyrepulse.app')
    rec('TEN-8b', 'invitation for one company plus the code of another: no company at all', s == (None, 'Reporter', False), s)
    become_anon(); pv = q1('select public.get_invitation_preview(%s)', (tok,))
    rec('TEN-8b', 'and the invitation is still unused', pv.get('ok') is True, pv)
    s = signup({'username': 'zz.t8.c', 'employee_id': 'ZZ8C', 'invite_token': tok, 'company_code': 'BETA-haulage'}, 'zz.t8.c@users.tyrepulse.app')
    rec('TEN-8b', 'invitation plus the matching company code: lands in that company with the invited role, approved', s == (BETA, 'Inspector', True), s)
    become_anon(); pv = q1('select public.get_invitation_preview(%s)', (tok,))
    rec('TEN-8b', 'the invitation is single use', pv == {'ok': False, 'reason': 'used'}, pv)
    s = signup({'username': 'zz.t8.d', 'employee_id': 'ZZ8D', 'invite_token': tok}, 'zz.t8.d@users.tyrepulse.app')
    rec('TEN-8b', 'a used invitation gives no company (and not the current company)', s == (None, 'Reporter', False), s)
    s = signup({'username': 'zz.t8.e', 'employee_id': 'ZZ8E', 'company_code': 'beta-haulage'}, 'zz.t8.e@users.tyrepulse.app')
    rec('TEN-8b', 'a company code with no invitation gives no company, even in single-company mode', s == (None, 'Reporter', False), s)
    s = signup({'username': 'zz.t8.f', 'employee_id': 'ZZ8F', 'company_code': 'alpha-readymix'}, 'zz.t8.f@users.tyrepulse.app')
    rec('TEN-8b', "the current company's own code with no invitation also gives no company", s == (None, 'Reporter', False), s)
with tx():
    tok, _ = invite('beta.admin', None, 'Driver')
    become_owner(); cur.execute("update public.org_invitations set expires_at = now() - interval '1 hour'")
    become_anon(); rec('TEN-8b', 'an expired invitation previews as expired', q1('select public.get_invitation_preview(%s)', (tok,)) == {'ok': False, 'reason': 'expired'})
    s = signup({'username': 'zz.t8.g', 'employee_id': 'ZZ8G', 'invite_token': tok}, 'zz.t8.g@users.tyrepulse.app')
    rec('TEN-8b', 'an expired invitation gives no company', s == (None, 'Reporter', False), s)
with tx():
    tok, _ = invite('beta.admin', None, 'Driver')
    become_owner(); cur.execute("update public.organisations set locked = true where id = %s", (BETA,))
    s = signup({'username': 'zz.t8.h', 'employee_id': 'ZZ8H', 'invite_token': tok}, 'zz.t8.h@users.tyrepulse.app')
    rec('TEN-8b', 'an invitation of a locked company gives no company', s == (None, 'Reporter', False), s)
with tx():
    set_cfg('single_tenant_mode', 'false')
    s = signup({'username': 'zz.t8.i', 'employee_id': 'ZZ8I'}, 'zz.t8.i@users.tyrepulse.app')
    rec('TEN-8b', 'single-company mode OFF: a sign-up with no invitation has no company', s == (None, 'Reporter', False), s)
    tok, _ = invite('gamma.admin', None, 'Manager')
    s = signup({'username': 'zz.t8.j', 'employee_id': 'ZZ8J', 'invite_token': tok}, 'zz.t8.j@users.tyrepulse.app')
    rec('TEN-8b', 'single-company mode OFF: an invitation still lands in its company', s == (GAMMA, 'Manager', True), s)
with tx():
    become('platform.superadmin', 'aal2')
    r, err = attempt("select public.admin_provision_organisation('Delta Synthetic Fleet', 'owner@delta-synthetic.invalid', 'trial', 14, 'KSA', 'staging test')")
    ok = err is None; out = r[0][0] if ok else {}
    rec('TEN-8b', 'a super admin creates a company with an owner invitation, no SQL', ok and out.get('status') == 'trialing' and out.get('invite_token'), err)
    if ok:
        s = signup({'username': 'zz.delta.owner', 'employee_id': 'ZZD1', 'invite_token': out['invite_token']}, 'zz.delta.owner@users.tyrepulse.app')
        rec('TEN-8b', 'KNOWN GAP: the owner invitation is tied to an e-mail, so the username sign-up form cannot redeem it', s == (None, 'Reporter', False), s)
        s = signup({'username': 'zz.delta.owner2', 'employee_id': 'ZZD2', 'invite_token': out['invite_token']}, 'owner@delta-synthetic.invalid')
        rec('TEN-8b', 'a sign-up with the invited e-mail becomes the Admin of the new company', s == (out['organisation_id'], 'Admin', True), s)
        become_owner(); cur.execute("select id from public.profiles where username = 'zz.delta.owner2'"); did = cur.fetchone()[0]
        cur.execute('reset role'); cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': str(did), 'role': 'authenticated'}),)); cur.execute('set local role authenticated')
        seen = q1('select count(*) from public.vehicle_fleet'); own = q1('select count(*) from public.organisations')
        rec('TEN-8b', 'the new company Admin sees 0 vehicles of other companies and exactly one company', seen == 0 and own == 1, (seen, own))
        r, err = attempt("insert into public.vehicle_fleet (asset_no, country, site) values ('DELTA-1', 'KSA', 'DELTA YARD') returning organisation_id::text")
        rec('TEN-8b', 'and adds its first vehicle into its own company', err is None and r[0][0] == out['organisation_id'], err)
with tx():
    become('beta.admin')
    r, err = attempt("update public.organisations set sign_in_code = 'alpha-readymix' where id = %s", (BETA,))
    rec('TEN-8b', 'a company Admin cannot set the company code', err is not None or r == 0, err or r)
    become('platform.superadmin', 'aal2')
    r, err = attempt("select public.admin_set_org_sign_in_code(%s, 'BETA')", (BETA,))
    rec('TEN-8b', 'a super admin sets a short company code', err is None, err)
    r, err = attempt("select public.admin_set_org_sign_in_code(%s, 'beta')", (GAMMA,))
    rec('TEN-8b', 'the same code (any case) is refused for another company', err and err.startswith('23505'), err)
    r, err = attempt("select public.admin_set_org_sign_in_code(%s, 'alpha-readymix')", (GAMMA,))
    rec('TEN-8b', "another company's slug is refused as a code", err and err.startswith('23505'), err)

print('\nTEN-9b sign-in resolver')
def resolve(ident):
    become_anon(); r, err = attempt('select public.get_email_by_identifier(%s)', (ident,)); return r[0][0] if r else 'ERROR ' + err
with tx():
    same = all(after_sequence[k] == base[k] for k in base if k.startswith('sign-in resolves'))
    n = len([k for k in base if k.startswith('sign-in resolves')])
    rec('TEN-9b', 'every current-company username and employee id resolves exactly as before (%d checks)' % n, same and n > 0)
    rec('TEN-9b', 'and they do resolve (the comparison is not empty against empty)', base.get('sign-in resolves alpha.driver') == 'alpha.driver@users.tyrepulse.app', base.get('sign-in resolves alpha.driver'))
    rec('TEN-9b', 'company slug / username resolves the same account', resolve('beta-haulage/beta.driver') == 'beta.driver@users.tyrepulse.app', resolve('beta-haulage/beta.driver'))
    rec('TEN-9b', 'company / employee id resolves', resolve('beta-haulage/EMP-0014') == 'beta.driver@users.tyrepulse.app', resolve('beta-haulage/EMP-0014'))
    rec('TEN-9b', 'a name under the wrong company resolves nothing', resolve('beta-haulage/alpha.driver') is None, resolve('beta-haulage/alpha.driver'))
    rec('TEN-9b', 'an unknown company code resolves nothing', resolve('nope/beta.driver') is None)
    rec('TEN-9b', 'an unknown name resolves nothing', resolve('zz.nobody') is None)
    become('platform.superadmin', 'aal2'); attempt("select public.admin_set_org_sign_in_code(%s, 'BETA')", (BETA,))
    rec('TEN-9b', 'short code with either slash, any case', resolve('beta/BETA.DRIVER') == 'beta.driver@users.tyrepulse.app' and resolve('BETA\\beta.driver') == 'beta.driver@users.tyrepulse.app')
    rec('TEN-9b', 'a real e-mail account is never disclosed to an anonymous caller', resolve('alpha.admin') is None, resolve('alpha.admin'))
    become_anon(); r, err = attempt("select public.resolve_sign_in_user('alpha.admin')")
    rec('TEN-9b', 'the id resolver for the sign-in function is not callable anonymously', err and err.startswith('42501'), err or r)
    become('alpha.manager'); r, err = attempt("select public.resolve_sign_in_user('alpha.admin')")
    rec('TEN-9b', 'nor by a signed-in user', err and err.startswith('42501'), err or r)
    become_service(); r, err = attempt("select public.resolve_sign_in_user('alpha.admin')")
    rec('TEN-9b', 'the service role resolves a real e-mail account to its id', err is None and str(r[0][0]) == USER['alpha.admin'], err)
    tok, _ = invite('beta.admin', None, 'Driver')
    s = signup({'username': 'alpha.driver', 'employee_id': 'ZZ9A', 'invite_token': tok}, 'alpha.driver+beta@users.tyrepulse.app')
    rec('TEN-9b', 'BEFORE the hold step: a second company cannot take a username the current company uses (refused, lands nowhere)',
        isinstance(s, str) and s.startswith('ERROR'), s)

hold_steps = []
print('\nHOLD step (point of no easy return)')
for s in seq['hold']:
    apply(s, 'hold')
after_hold = snapshot()
rec('TEN-9c', 'current company snapshot identical after the hold step', not diff(base, after_hold), diff(base, after_hold)[:8])
with tx():
    tok, _ = invite('beta.admin', None, 'Driver')
    s = signup({'username': 'alpha.driver', 'employee_id': 'EMP-0007', 'invite_token': tok}, 'alpha.driver+beta@users.tyrepulse.app')
    rec('TEN-9c', 'a second company creates the same username and employee id as a current-company user', s == (BETA, 'Driver', True), s)
    rec('TEN-9c', 'the bare username still signs in the current-company user', resolve('alpha.driver') == 'alpha.driver@users.tyrepulse.app', resolve('alpha.driver'))
    rec('TEN-9c', 'the bare employee id still signs in the current-company user', resolve('EMP-0007') == 'alpha.driver@users.tyrepulse.app', resolve('EMP-0007'))
    rec('TEN-9c', 'company code / username signs in the second-company user', resolve('beta-haulage/alpha.driver') == 'alpha.driver+beta@users.tyrepulse.app', resolve('beta-haulage/alpha.driver'))
    tok, _ = invite('beta.admin', None, 'Driver'); tok2, _ = invite('gamma.admin', None, 'Driver')
    s1 = signup({'username': 'shared.name', 'employee_id': 'ZZ9S1', 'invite_token': tok}, 'shared.name+beta@users.tyrepulse.app')
    s2 = signup({'username': 'shared.name', 'employee_id': 'ZZ9S2', 'invite_token': tok2}, 'shared.name+gamma@users.tyrepulse.app')
    rec('TEN-9c', 'two new companies share a username', s1 == (BETA, 'Driver', True) and s2 == (GAMMA, 'Driver', True), (s1, s2))
    rec('TEN-9c', 'that bare name is ambiguous and resolves nothing (never an arbitrary pick)', resolve('shared.name') is None, resolve('shared.name'))
    rec('TEN-9c', 'with the company code each resolves to its own account',
        resolve('beta-haulage/shared.name') == 'shared.name+beta@users.tyrepulse.app' and resolve('gamma-new-fleet/shared.name') == 'shared.name+gamma@users.tyrepulse.app')
    tok, _ = invite('beta.admin', None, 'Driver')
    s = signup({'username': 'Shared.Name', 'employee_id': 'ZZ9S3', 'invite_token': tok}, 'shared.name2+beta@users.tyrepulse.app')
    rec('TEN-9c', 'the same username twice INSIDE one company is still refused', isinstance(s, str) and s.startswith('ERROR'), s)
    become_owner()
    r, err = attempt("alter table public.profiles add constraint profiles_username_key unique (username)")
    rec('TEN-9c', 'POINT OF NO RETURN shown: once a cross-company duplicate exists the global key cannot be put back', err is not None, err)

report = {'database': args.db, 'steps': steps, 'tests': results, 'baseline': base,
          'baseline_facts': len(base),
          'current_company_changed_after_sequence': diff(base, after_sequence),
          'current_company_changed_after_hold': diff(base, after_hold)}
bad_steps = [s for s in steps if not s['applied']]; changed = [s for s in steps if s['current_company_changed']]
failed = [t for t in results if not t['ok']]
print('\nSUMMARY  steps applied %d of %d | steps that changed the current company: %d | tests %d passed, %d failed | snapshot facts %d'
      % (len(steps) - len(bad_steps), len(steps), len(changed), len(results) - len(failed), len(failed), len(base)))
if args.out:
    with open(args.out, 'w') as _f:
        json.dump(report, _f, indent=1, default=str)
sys.exit(1 if (bad_steps or changed or failed) else 0)
