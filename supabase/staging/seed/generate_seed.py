#!/usr/bin/env python3
"""Synthetic seed for the Tyre Pulse staging database.

Everything here is INVENTED. No production row, name, phone, email or key is used.
Two independent companies with data (Alpha Readymix Co, Beta Haulage LLC), one empty company
(Gamma New Fleet), one platform super admin. Passwords are generated at run time and written to a
file OUTSIDE the repository (--accounts-out).

Usage: generate_seed.py --dsn "<dsn>" --accounts-out /path/outside/repo/staging_test_accounts.txt
Refuses the production project reference.
"""
import argparse, datetime as dt, json, os, random, secrets, sys, uuid
import psycopg2
from psycopg2.extras import execute_values, Json

ap = argparse.ArgumentParser()
ap.add_argument('--dsn', required=True)
ap.add_argument('--accounts-out', required=True)
a = ap.parse_args()
if 'jhssdmeruxtrlqnwfksc' in a.dsn:
    sys.exit('Refusing: that is the production project.')
repo = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
if os.path.abspath(a.accounts_out).startswith(repo + os.sep):
    sys.exit('Refusing: the accounts file must be written outside the repository.')

rnd = random.Random(20261112)
NS = uuid.UUID('5f3a1c1e-0000-4000-8000-00000000571a')
def uid(*parts):
    return str(uuid.uuid5(NS, '/'.join(str(p) for p in parts)))

# The first company reuses the id that 20 functions and one column default name as their fallback, so
# those functions run unchanged. Only the id value is reused; no production row is carried.
ORGS = [
    dict(key='alpha', id='00000000-0000-0000-0000-000000000001', name='Alpha Readymix Co', slug='alpha-readymix',
         plan='professional', code='ALP'),
    dict(key='beta', id='bbbbbbbb-0000-4000-8000-000000000002', name='Beta Haulage LLC', slug='beta-haulage',
         plan='starter', code='BET'),
    dict(key='gamma', id='cccccccc-0000-4000-8000-000000000003', name='Gamma New Fleet', slug='gamma-new-fleet',
         plan='trial', code='GAM'),
]
COUNTRIES = ['KSA', 'UAE', 'Egypt']
CUR = {'KSA': 'SAR', 'UAE': 'AED', 'Egypt': 'EGP'}
TYRE_PRICE = {'KSA': (850, 1450), 'UAE': (700, 1250), 'Egypt': (9500, 16500)}
SITES = {
    'alpha': {'KSA': ['ALPHA NORTH PLANT', 'ALPHA EAST PLANT', 'ALPHA CENTRAL YARD'],
              'UAE': ['ALPHA COAST PLANT', 'ALPHA DESERT PLANT'],
              'Egypt': ['ALPHA DELTA PLANT', 'ALPHA RIVER YARD']},
    'beta': {'KSA': ['BETA DEPOT ONE', 'BETA DEPOT TWO'],
             'UAE': ['BETA PORT DEPOT', 'BETA INLAND DEPOT'],
             'Egypt': ['BETA CANAL DEPOT', 'BETA CITY DEPOT']},
}
# (prefix, vehicle_type, positions, tyre size, count per company)
TYPES = [
    ('TM', 'TR-MIXER', ['LHF1', 'RHF1', 'LHRO', 'LHRI', 'RHRI', 'RHRO'], '315/80R22.5', {'alpha': 22, 'beta': 6}),
    ('MP', 'PUMPS', ['LHF1', 'RHF1', 'LHRO', 'LHRI', 'RHRI', 'RHRO'], '385/65R22.5', {'alpha': 8, 'beta': 2}),
    ('WL', 'WHEEL LOADER', ['LHF1', 'RHF1', 'LHR1', 'RHR1'], '23.5R25', {'alpha': 6, 'beta': 4}),
    ('PL', 'PICKUP', ['LHF1', 'RHF1', 'LHR1', 'RHR1'], '235/70R16', {'alpha': 8, 'beta': 10}),
    ('TR', 'TRAILER', ['LHF1', 'RHF1', 'LHRO', 'LHRI', 'RHRI', 'RHRO'], '385/65R22.5', {'alpha': 8, 'beta': 24}),
]
BRANDS = ['NORTHLINE', 'DUNEGRIP', 'TERRAFLEX', 'ORBITREAD']       # invented brand names
REASONS = ['WORN OUT', 'PUNCTURE', 'SIDE WALL DAMAGE', 'BURST']
ROLES = [  # (key, role, country scope, sites)
    ('admin', 'Admin', ['KSA', 'UAE', 'Egypt']),
    ('manager', 'Manager', ['KSA']),
    ('director', 'Director', ['KSA', 'UAE', 'Egypt']),
    ('engineer', 'Tyre Engineer', ['UAE']),
    ('tyreman', 'Tyre Man', ['KSA']),
    ('inspector', 'Inspector', ['Egypt']),
    ('driver', 'Driver', ['KSA']),
]

conn = psycopg2.connect(a.dsn)
cur = conn.cursor()
cur.execute('set search_path = "$user", public, extensions')
cur.execute("select count(*) from public.organisations")
if cur.fetchone()[0]:
    sys.exit('Refusing: organisations already has rows. Seed only an empty staging database (reset first).')

today = dt.date(2026, 11, 12)
def d(days_ago):
    return today - dt.timedelta(days=days_ago)

# ------------------------------------------------------------------ organisations, roles, sites
for o in ORGS:
    cur.execute("""insert into public.organisations (id, name, slug, plan, active, country, countries, primary_country,
                   timezone, contact_email, locked) values (%s,%s,%s,%s,true,'KSA',%s,'KSA','Asia/Riyadh',%s,false)""",
                (o['id'], o['name'], o['slug'], o['plan'], COUNTRIES, 'office@%s.staging.tyrepulse.invalid' % o['slug']))
    cur.execute("insert into public.custom_roles (organisation_id, name, description, active) values (%s,'Tyre Engineer','Synthetic custom role',true)", (o['id'],))
for o in ORGS[:2]:
    for c, names in SITES[o['key']].items():
        for n in names:
            cur.execute("""insert into public.sites (id, name, country, region, city, active, organisation_id, site_code, site_type)
                           values (%s,%s,%s,%s,%s,true,%s,%s,'depot')""",
                        (uid('site', o['key'], n), n, c, 'CENTRAL' if c == 'KSA' else None, 'Test City', o['id'], n.replace(' ', '-')[:20]))

# ------------------------------------------------------------------ users
accounts = []
def add_user(key, org, role, countries, username, full_name, super_admin=False):
    u = uid('user', username)
    email = '%s@staging.tyrepulse.invalid' % username
    pw = secrets.token_urlsafe(12)
    cur.execute("""insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                     raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                     confirmation_token, recovery_token, email_change, email_change_token_new)
                   values (%s,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',%s,
                     extensions.crypt(%s, extensions.gen_salt('bf')), now(), %s, %s, now(), now(), '', '', '', '')""",
                (u, email, pw, Json({'provider': 'email', 'providers': ['email']}),
                 Json({'username': username, 'full_name': full_name, 'region': countries[0]})))
    cur.execute("""insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
                   values (gen_random_uuid(), %s, %s, %s, 'email', now(), now())""",
                (u, u, Json({'sub': u, 'email': email, 'email_verified': True})))
    profiles.append((u, username, full_name, role, countries, org['id'], super_admin, email))
    accounts.append((org['name'] if not super_admin else 'PLATFORM', role + (' (super admin)' if super_admin else ''),
                     username, email, pw, ','.join(countries)))
    return u

profiles = []
USERS = {}
for o in ORGS[:2]:
    for key, role, countries in ROLES:
        USERS[(o['key'], key)] = add_user(key, o, role, countries, '%s.%s' % (o['key'], key),
                                          'Test %s %s' % (o['key'].title(), role))
USERS[('gamma', 'admin')] = add_user('admin', ORGS[2], 'Admin', COUNTRIES, 'gamma.admin', 'Test Gamma Admin')
USERS[('platform', 'super')] = add_user('super', ORGS[0], 'Admin', COUNTRIES, 'platform.superadmin',
                                        'Test Platform Owner', super_admin=True)
# on_auth_user_created made a pending Reporter profile in the fallback company for each user.
# The privileged-column guard only lets an Admin session change these; seeding is not a session.
cur.execute('alter table public.profiles disable trigger user')
for i, (u, username, full_name, role, countries, org_id, sa, email) in enumerate(profiles):
    cur.execute("""insert into public.profiles (id, username) values (%s,%s) on conflict (id) do nothing""", (u, username))
    cur.execute("""update public.profiles set username=%s, full_name=%s, role=%s, region=%s, country=%s, countries=%s,
                     org_id=%s, organisation_id=%s, approved=true, locked=false, is_super_admin=%s, sites=%s,
                     web_access=true, email=%s, employee_id=%s, phone=%s where id=%s""",
                (username, full_name, role, countries[0], countries, countries, org_id, org_id, sa, ['ALL'],
                 email, 'EMP-%04d' % (i + 1), '000000%04d' % (i + 1), u))
cur.execute('alter table public.profiles enable trigger user')

# ------------------------------------------------------------------ subscriptions
for o in ORGS:
    cur.execute("""insert into public.org_subscriptions (organisation_id, plan_code, status, billing_interval, seats, trial_ends_at)
                   values (%s,%s,%s,'monthly',%s,%s)""",
                (o['id'], o['plan'], 'trialing' if o['plan'] == 'trial' else 'active', 10,
                 today + dt.timedelta(days=14) if o['plan'] == 'trial' else None))

# ------------------------------------------------------------------ fleet, tyres, job cards, expenses, inspections
counts = {}
def bump(k, n=1):
    counts[k] = counts.get(k, 0) + n

for o in ORGS[:2]:
    ok, org = o['key'], o['id']
    fleet = []
    for prefix, vtype, positions, size, per in TYPES:
        for i in range(1, per[ok] + 1):
            country = COUNTRIES[(i - 1) % 3] if i % 5 else 'KSA'
            site = rnd.choice(SITES[ok][country])
            # Both companies use the same asset codes on purpose: isolation must hold on equal keys.
            asset = '%s%03d' % (prefix, i)
            km = rnd.randint(40000, 260000)
            fleet.append(dict(asset=asset, vtype=vtype, positions=positions, size=size, country=country, site=site, km=km))
    execute_values(cur, """insert into public.vehicle_fleet (id, asset_no, fleet_number, make, model, vehicle_type, year, site, country,
                             tyre_size, status, current_km, registration_no, is_active, organisation_id, model_year) values %s""",
                   [(uid('veh', ok, v['asset'], v['country']), v['asset'], 'F-%s-%s' % (o['code'], v['asset']), 'TESTMAKE', 'MODEL-' + v['vtype'][:3],
                     v['vtype'], 2021, v['site'], v['country'], v['size'], 'Active', v['km'], 'T%s %d' % (o['code'][0], 1000 + n),
                     True, org, 2021) for n, v in enumerate(fleet)])
    bump(ok + '.vehicle_fleet', len(fleet))

    tyres, serial = [], 0
    for v in fleet:
        lo, hi = TYRE_PRICE[v['country']]
        for pos in v['positions']:
            fit_days = rnd.randint(420, 640)
            fit_km = max(1000, v['km'] - rnd.randint(60000, 110000))
            cycles = rnd.choice([1, 2, 2, 3])
            for c in range(cycles):
                serial += 1
                last = c == cycles - 1
                life_days = rnd.randint(120, 220)
                life_km = rnd.randint(22000, 58000)
                rem_days = max(5, fit_days - life_days)
                price = round(rnd.uniform(lo, hi), 2) if rnd.random() > 0.12 else None
                row = dict(id=uid('tyre', ok, serial), issue=d(fit_days), brand=rnd.choice(BRANDS),
                           serial='SYN-%s-%05d' % (o['code'], serial), asset=v['asset'], site=v['site'], country=v['country'],
                           pos=pos, size=v['size'], vtype=v['vtype'], price=price, kmfit=fit_km,
                           jc='%s/JC/%04d/%s' % (o['code'], serial, d(fit_days).strftime('%m%y')))
                if last:
                    row.update(status='Active', removal=None, kmrem=None, total=None, reason=None)
                else:
                    row.update(status='Removed', removal=d(rem_days), kmrem=fit_km + life_km, total=life_km, reason=rnd.choice(REASONS))
                    fit_days, fit_km = rem_days, fit_km + life_km
                tyres.append(row)
    execute_values(cur, """insert into public.tyre_records (id, issue_date, brand, serial_no, qty, job_card, asset_no, site, country,
                             tyre_position, position, size, vehicle_type, cost_per_tyre, km_at_fitment, km_at_removal, total_km,
                             removal_date, removal_reason, status, data_source, organisation_id, description) values %s""",
                   [(t['id'], t['issue'], t['brand'], t['serial'], 1, t['jc'], t['asset'], t['site'], t['country'], t['pos'], t['pos'],
                     t['size'], t['vtype'], t['price'], t['kmfit'], t['kmrem'], t['total'], t['removal'], t['reason'], t['status'],
                     'upload', org, 'TYRE %s %s' % (t['size'], t['brand'])) for t in tyres], page_size=500)
    bump(ok + '.tyre_records', len(tyres))

    # job cards: one per tyre fitment (Tyre Change) plus general repairs
    wos = []
    for t in tyres:
        wos.append((t['jc'], t['asset'], 'Tyre Change', t['site'], t['country'], t['issue'], 'Completed',
                    'Replace tyre at %s' % t['pos'], 0, 0))
    for n in range(1, 121):
        v = rnd.choice(fleet)
        opened = d(rnd.randint(3, 400))
        status = rnd.choice(['Completed'] * 6 + ['Open', 'In Progress', 'Waiting for Parts'])
        wos.append(('%s/JC/R%04d/%s' % (o['code'], n, opened.strftime('%m%y')), v['asset'],
                    rnd.choice(['Repair', 'Service', 'Preventive Maintenance', 'Inspection']), v['site'], v['country'], opened,
                    status, rnd.choice(['Brake service', 'Engine oil change', 'Hydraulic hose replaced', 'Electrical check']),
                    round(rnd.uniform(1, 8), 1), round(rnd.uniform(100, 2500), 2)))
    execute_values(cur, """insert into public.work_orders (id, work_order_no, asset_no, work_type, site, country, opened_at, completed_at,
                             status, priority, description, labour_hours, parts_cost, labour_cost, technician_name, organisation_id) values %s""",
                   [(uid('wo', ok, w[0]), w[0], w[1], w[2], w[3], w[4], w[5], (w[5] + dt.timedelta(days=1)) if w[6] == 'Completed' else None,
                     w[6], 'Medium', w[7], w[8], w[9], round(w[8] * 45, 2), 'Test Technician', org) for w in wos], page_size=500)
    bump(ok + '.work_orders', len(wos))

    # expense lines (the cost source). Tyre lines for priced tyres, plus spare parts and lubricants.
    lines, ctr = [], [0]
    def line(country, wo, date, asset, vtype, site, code, desc, qty, value):
        ctr[0] += 1; n = ctr[0]
        lines.append((org, country, 'ISS-%s-%06d' % (o['code'], n), wo, date.strftime('%Y-%m-%d'), asset, vtype, vtype,
                      'ST-' + site.replace(' ', '-')[:14], 'CC-' + site.split(' ')[1][:6], code, str(qty), desc, '%.2f' % value, str(n)))
    for t in tyres:
        if t['price'] is not None:
            line(t['country'], t['jc'], t['issue'], t['asset'], t['vtype'], t['site'], '310%03d-S' % (BRANDS.index(t['brand']) + 1),
                 'TYRE %s %s' % (t['size'], t['brand']), 1, t['price'])
    PARTS = [('400101-S', 'BRAKE PAD SET', 180, 950), ('400202-S', 'HYDRAULIC HOSE 3/4', 60, 400),
             ('150301-S', 'OIL FILTER', 25, 90), ('450110-S', 'ENGINE OIL 15W40 20L', 120, 420), ('450120-S', 'GREASE EP2 18KG', 90, 260)]
    scale = {'KSA': 1, 'UAE': 1, 'Egypt': 13}
    for w in wos:
        if w[2] == 'Tyre Change':
            continue
        for _ in range(rnd.randint(1, 3)):
            code, desc, lo, hi = rnd.choice(PARTS)
            q = rnd.randint(1, 4)
            vt = next(v['vtype'] for v in fleet if v['asset'] == w[1])
            line(w[4], w[0], w[5], w[1], vt, w[3], code, desc, q, round(rnd.uniform(lo, hi) * q * scale[w[4]], 2))
    execute_values(cur, """insert into public.parts_consumption (organisation_id, country, issue_number, work_order_no, txn_date, asset_code,
                             asset_description, asset_type, store_code, cost_center, item_code, qty, item_description, value_amount, source_row)
                           values %s""", lines, page_size=500)
    bump(ok + '.parts_consumption', len(lines))

    # inspections
    insp = []
    for n in range(1, 61):
        v = rnd.choice(fleet)
        day = d(rnd.randint(1, 200))
        cond = {p: {'position': p, 'condition': rnd.choice(['Good'] * 6 + ['Worn', 'Damaged']),
                    'pressure_psi': rnd.randint(95, 125), 'checked': True} for p in v['positions']}
        approved = rnd.random() > 0.3
        insp.append((uid('insp', ok, n), 'Tyre inspection %s' % v['asset'], 'Routine', v['site'], v['asset'], day, day,
                     'Done' if approved else 'In Progress', 'Test %s Inspector' % ok.title(), v['country'], day, Json(cond), v['vtype'],
                     v['km'], 'approved' if approved else 'pending_approval', org, USERS[(ok, 'inspector')]))
    execute_values(cur, """insert into public.inspections (id, title, inspection_type, site, asset_no, scheduled_date, completed_date, status,
                             inspector, country, inspection_date, tyre_conditions, vehicle_type, odometer_km, approval_status,
                             organisation_id, created_by) values %s""", insp)
    bump(ok + '.inspections', len(insp))

    # accidents
    for n in range(1, 5):
        v = rnd.choice(fleet)
        cur.execute("""insert into public.accidents (id, site, asset_no, incident_date, location, accident_type, severity, description,
                         status, driver_name, country, organisation_id, vehicle_type, estimated_damage_cost)
                       values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (uid('acc', ok, n), v['site'], v['asset'], d(rnd.randint(5, 250)), 'Test road %d' % n,
                     rnd.choice(['collision', 'reversing', 'tyre_failure', 'property_damage']), rnd.choice(['minor', 'moderate', 'severe']),
                     'Synthetic incident %d for testing' % n, rnd.choice(['reported', 'under_review', 'closed']),
                     'Test Driver %d' % n, v['country'], org, v['vtype'], rnd.randint(500, 20000)))
        bump(ok + '.accidents')

    # stock
    st = []
    for c, names in SITES[ok].items():
        for s in names[:2]:
            for size in ['315/80R22.5', '385/65R22.5']:
                st.append((uid('stock', ok, s, size), s, 'TYRE %s %s' % (size, BRANDS[0]), rnd.randint(0, 40), 6, 2, c, org,
                           round(rnd.uniform(*TYRE_PRICE[c]), 2), CUR[c], BRANDS[0], size))
    execute_values(cur, """insert into public.stock_records (id, site, description, stock_qty, min_level, critical_level, country,
                             organisation_id, unit_cost, currency, brand, tyre_size) values %s""", st)
    bump(ok + '.stock_records', len(st))

conn.commit()
os.makedirs(os.path.dirname(os.path.abspath(a.accounts_out)), exist_ok=True)
with open(a.accounts_out, 'w') as f:
    f.write('# Tyre Pulse STAGING test accounts. Synthetic. Generated %s. Never commit this file.\n' % dt.datetime.now().isoformat(timespec='seconds'))
    f.write('company | role | username | email | password | country scope\n')
    for acc in accounts:
        f.write(' | '.join(acc) + '\n')
os.chmod(a.accounts_out, 0o600)
print('seed complete:', json.dumps(counts, sort_keys=True), 'users:', len(accounts))
print('accounts file written outside the repository:', a.accounts_out)
