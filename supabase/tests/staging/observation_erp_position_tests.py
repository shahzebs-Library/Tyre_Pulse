#!/usr/bin/env python3
"""
Staging tests for the two drafts
  supabase/pending_migrations/20261115110000_tyre_position_service.sql
  supabase/pending_migrations/20261115120000_observation_erp_reconciliation.sql

Runs against a LOCAL staging database copy that already has both drafts applied (never
production: the script refuses any host but 127.0.0.1 / localhost). All data is invented
here, inside ONE transaction that is always rolled back.

  createdb -h 127.0.0.1 -p 54329 -U postgres -T tyrepulse_staging tp_position
  psql ... -d tp_position -1 -f supabase/pending_migrations/20261115110000_tyre_position_service.sql
  psql ... -d tp_position -1 -f supabase/pending_migrations/20261115120000_observation_erp_reconciliation.sql
  python3 supabase/tests/staging/observation_erp_position_tests.py \
      --dsn "host=127.0.0.1 port=54329 dbname=tp_position user=postgres"

Covers: every layout type (mixer 12, mixer 13 with spare, pump 14, pump 12, 6x4 10, line
pump 12, loader, pickup 4, tyreless), tenant, country, site, role, position, serial,
dates, append-only history, and "nothing historical is rewritten".
"""
import argparse, json, sys, uuid
import psycopg2

ap = argparse.ArgumentParser()
ap.add_argument('--dsn', default='host=127.0.0.1 port=54329 dbname=tp_position user=postgres')
args = ap.parse_args()
if not any(h in args.dsn for h in ('host=127.0.0.1', 'host=localhost')):
    sys.exit('Refusing: this script only runs against a local staging database.')

conn = psycopg2.connect(args.dsn)
cur = conn.cursor()
results = []

def q(sql, params=None):
    cur.execute(sql, params)
    return cur.fetchall() if cur.description else None

def check(section, name, ok, evidence=''):
    results.append((section, name, bool(ok), str(evidence)[:300]))

ALPHA = '00000000-0000-0000-0000-000000000001'
BETA = 'bbbbbbbb-0000-4000-8000-000000000002'
USER = {r[0].split('@')[0]: r[1] for r in q("select email, id::text from public.profiles")}

def become(name):
    cur.execute('reset role')
    cur.execute("select set_config('request.jwt.claims', %s, true)",
                (json.dumps({'sub': USER[name], 'role': 'authenticated', 'aal': 'aal1'}),))
    cur.execute('set local role authenticated')

def owner():
    cur.execute('reset role')
    cur.execute("select set_config('request.jwt.claims', '', true)")

def attempt(sql, params=None):
    cur.execute('savepoint s')
    try:
        cur.execute(sql, params)
        out = cur.fetchall() if cur.description else cur.rowcount
        cur.execute('release savepoint s')
        return out, None, None
    except Exception as e:
        code = getattr(e, 'pgcode', None)
        cur.execute('rollback to savepoint s')
        return None, code, str(e).strip().split('\n')[0][:160]

# ------------------------------------------------------------------ seed (owner, triggers off)
owner()
cur.execute("set local session_replication_role = replica")
SITE = 'ALPHA NORTH PLANT'
FLEET = [  # asset, org, country, type, axle_count, site
    ('ZPMX1', ALPHA, 'KSA', 'TR-MIXER', None, SITE), ('ZPMX2', ALPHA, 'KSA', 'TR-MIXER', None, SITE),
    ('ZPPU1', ALPHA, 'KSA', 'PUMPS', None, SITE), ('ZPPU2', ALPHA, 'KSA', 'PUMPS', 4, SITE),
    ('ZP6X1', ALPHA, 'KSA', 'TRUCK 6X4', None, SITE), ('ZPLP1', ALPHA, 'KSA', 'LINE PUMP', None, SITE),
    ('ZPWL1', ALPHA, 'KSA', 'WHEEL LOADER', None, SITE), ('ZPPK1', ALPHA, 'KSA', 'PICKUP', None, SITE),
    ('ZPGN1', ALPHA, 'KSA', 'GENERATOR', None, SITE), ('ZPXX1', ALPHA, 'KSA', 'MISC EQUIPMENT', None, SITE),
    ('ZPMX9', ALPHA, 'UAE', 'TR-MIXER', None, 'ALPHA UAE YARD'),
    ('ZPMX1', BETA, 'KSA', 'TR-MIXER', None, 'BETA YARD'),
    ('ZPEAST', ALPHA, 'KSA', 'TR-MIXER', None, 'ALPHA EAST PLANT'),
]
for a, org, c, vt, ax, site in FLEET:
    cur.execute("""insert into public.vehicle_fleet (id, asset_no, organisation_id, country, vehicle_type, axle_count, site, status)
                   values (gen_random_uuid(), %s, %s, %s, %s, %s, %s, 'Active')""", (a, org, c, vt, ax, site))

INSPECTED = '2026-09-10'
def make_case(asset, detail, rows, org=ALPHA, country='KSA', site=SITE, serial=None, insp_type=None,
              wo_opened='2026-09-12', wo_country=None, wo_org=None, wo_asset=None, wo_site=None):
    """rows: list of (position, serial, issue_date, removal_date). Returns (action, work order, job card)."""
    insp, act, wo = (str(uuid.uuid4()) for _ in range(3))
    job = 'ZP/JC/' + wo[:8]
    cur.execute("""insert into public.inspections (id, organisation_id, country, site, asset_no, inspection_date, vehicle_type, status, title)
                   values (%s, %s, %s, %s, %s, %s, %s, 'Done', 'Synthetic inspection')""",
                (insp, org, country, site, asset, INSPECTED, insp_type))
    cur.execute("""insert into public.corrective_actions (id, organisation_id, country, site, asset_no, title, status, priority,
                     source_type, source_id, source_detail, tyre_serial)
                   values (%s, %s, %s, %s, %s, 'Synthetic tyre action', 'Open', 'High', 'inspection', %s, %s, %s)""",
                (act, org, country, site, asset, insp, detail, serial))
    cur.execute("""insert into public.work_orders (id, organisation_id, country, site, asset_no, work_order_no, status, priority,
                     work_type, opened_at, description)
                   values (%s, %s, %s, %s, %s, %s, 'Completed', 'Medium', 'Repair', %s, 'Synthetic tyre change')""",
                (wo, wo_org or org, wo_country or country, wo_site or site, wo_asset or asset, job, wo_opened))
    for pos, ser, issued, removed in rows:
        cur.execute("""insert into public.tyre_records (id, organisation_id, country, site, asset_no, job_card, position, serial_no,
                         issue_date, removal_date, cost_per_tyre, status)
                       values (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s, 1234.50, 'Active')""",
                    (wo_org or org, wo_country or country, site, wo_asset or asset, job, pos, ser, issued, removed))
    return act, wo, job

AFTER = '2026-09-12'; BEFORE = '2026-08-01'
C = {}
# ---- every layout type: same wheel, dated movement
C['mixer_match'] = make_case('ZPMX1', 'damage:R1Ro', [('RHCO', 'NEWTYRE001', AFTER, None)])
C['mixer_other'] = make_case('ZPMX1', 'damage:R1Ro', [('RHRO', 'NEWTYRE002', AFTER, None)])
C['mixer_scheme'] = make_case('ZPMX1', 'damage:R1Ro', [('RHR1-O', 'NEWTYRE003', AFTER, None)])
C['mixer_overdue_key'] = make_case('ZPMX1', 'overdue:R2Li:OLDTYRE777', [('LHRI', 'NEWTYRE004', AFTER, None)])
C['pump14'] = make_case('ZPPU1', 'damage:F3L', [('LHF3', 'NEWTYRE005', AFTER, None)])
C['pump12_slot_missing'] = make_case('ZPPU2', 'damage:F3L', [('LHF3', 'NEWTYRE006', AFTER, None)])
C['pump12_match'] = make_case('ZPPU2', 'damage:F2R', [('RHF2', 'NEWTYRE007', AFTER, None)])
C['six_by_four'] = make_case('ZP6X1', 'damage:R2Li', [('LHR2-I', 'NEWTYRE008', AFTER, None)])
C['line_pump'] = make_case('ZPLP1', 'damage:R1Lo', [('LHR1-O', 'NEWTYRE009', AFTER, None)])
C['loader'] = make_case('ZPWL1', 'damage:FL', [('LHF1', 'NEWTYRE010', AFTER, None)])
C['pickup_bare'] = make_case('ZPPK1', 'RR', [('RHR1', 'NEWTYRE011', AFTER, None)])
C['pickup_dual_code'] = make_case('ZPPK1', 'damage:RR', [('RHRO', 'NEWTYRE012', AFTER, None)])
C['tyreless'] = make_case('ZPGN1', 'damage:FL', [('LHF1', 'NEWTYRE013', AFTER, None)])
C['unknown_type'] = make_case('ZPXX1', 'damage:FL', [('LHF1', 'NEWTYRE014', AFTER, None)])
C['missing_position'] = make_case('ZPMX1', 'damage:unknown position', [('RHCO', 'NEWTYRE015', AFTER, None)])
C['erp_position_blank'] = make_case('ZPMX1', 'damage:R1Ro', [('', 'NEWTYRE016', AFTER, None)])
C['wrong_slot_for_asset'] = make_case('ZPMX1', 'damage:RR', [('RHRO', 'NEWTYRE017', AFTER, None)])
C['inspection_other_layout'] = make_case('ZPMX1', 'damage:R1Ro', [('RHCO', 'NEWTYRE018', AFTER, None)], insp_type='TRAILER')
# ---- serial evidence
C['serial_supports'] = make_case('ZPMX2', 'damage:R1Ro', [('', 'OBSERVED9001', BEFORE, AFTER)], serial='OBSERVED9001')
C['serial_weak'] = make_case('ZPMX2', 'damage:R1Ro', [('', 'DOT18E56', BEFORE, AFTER)], serial='DOT18E56')
C['serial_other_wheel'] = make_case('ZPMX2', 'damage:R1Ro', [('RHRO', 'OBSERVED9002', BEFORE, AFTER)], serial='OBSERVED9002')
C['serial_replaced'] = make_case('ZPMX2', 'damage:R1Ro', [('RHCO', 'BRANDNEW5005', AFTER, None)], serial='OBSERVED9003')
# ---- dates
C['undated'] = make_case('ZPMX2', 'damage:R1Ro', [('RHCO', 'NEWTYRE020', BEFORE, None)])
C['wo_before_inspection'] = make_case('ZPMX2', 'damage:R1Ro', [('RHCO', 'NEWTYRE021', AFTER, None)], wo_opened='2026-09-01')
C['no_tyre_rows'] = make_case('ZPMX2', 'damage:R1Ro', [])
# ---- tenant, country, site
C['uae'] = make_case('ZPMX9', 'damage:R1Ro', [('RHCO', 'NEWTYRE030', AFTER, None)], country='UAE', site='ALPHA UAE YARD')
C['beta'] = make_case('ZPMX1', 'damage:R1Ro', [('RHCO', 'NEWTYRE031', AFTER, None)], org=BETA, site='BETA YARD')
C['wo_other_country'] = make_case('ZPMX1', 'damage:R1Ro', [('RHCO', 'NEWTYRE032', AFTER, None)], wo_country='UAE')
C['wo_other_asset'] = make_case('ZPMX1', 'damage:R1Ro', [('RHCO', 'NEWTYRE033', AFTER, None)], wo_asset='ZPMX2')
C['east_site'] = make_case('ZPEAST', 'damage:R1Ro', [('RHCO', 'NEWTYRE034', AFTER, None)], site='ALPHA EAST PLANT')
cur.execute("set local session_replication_role = origin")

def evaluate(name, user='alpha.manager'):
    become(user)
    out, code, msg = attempt("select public.observation_erp_evaluate(%s, %s)", C[name][:2])
    owner()
    return (out[0][0] if out else None), code, msg

def decide(name, decision='confirmed', user='alpha.manager', reason='Synthetic review reason'):
    become(user)
    fn = 'confirm_observation_erp_link' if decision == 'confirmed' else 'reject_observation_erp_link'
    out, code, msg = attempt(f"select public.{fn}(%s, %s, %s)", (*C[name][:2], reason))
    owner()
    return (out[0][0] if out else None), code, msg

def links(): return q("select count(*) from public.observation_erp_links")[0][0]
def events(): return q("select count(*) from public.observation_erp_link_events")[0][0]

def fingerprint():
    """Everything that must never change, except the one column a confirm is allowed to set."""
    return q("""select
      (select md5(string_agg(md5(t::text), ',' order by id)) from public.tyre_records t where asset_no like 'ZP%%'),
      (select md5(string_agg(md5(w::text), ',' order by id)) from public.work_orders w where asset_no like 'ZP%%'),
      (select md5(string_agg(md5(i::text), ',' order by id)) from public.inspections i where asset_no like 'ZP%%'),
      (select md5(string_agg(md5((to_jsonb(a) - 'work_order_id')::text), ',' order by id)) from public.corrective_actions a where asset_no like 'ZP%%'),
      (select md5(string_agg(md5(f::text), ',' order by id)) from public.vehicle_fleet f where asset_no like 'ZP%%')""")[0]

BASE = fingerprint()

# ------------------------------------------------------------------ A: position by layout type
EXPECT = {
    'mixer_match': ('offered_for_review', 'RHCO'), 'mixer_overdue_key': ('offered_for_review', 'LHRI'),
    'pump14': ('offered_for_review', 'LHF3'), 'pump12_match': ('offered_for_review', 'RHF2'),
    'six_by_four': ('offered_for_review', 'LHR2-I'), 'line_pump': ('offered_for_review', 'LHR1-O'),
    'loader': ('offered_for_review', 'LHF1'), 'pickup_bare': ('offered_for_review', 'RHR1'),
    'mixer_other': ('different_wheel', None), 'mixer_scheme': ('pending_manual_review', None),
    'pump12_slot_missing': ('pending_manual_review', None), 'pickup_dual_code': ('pending_manual_review', None),
    'tyreless': ('pending_manual_review', None), 'unknown_type': ('pending_manual_review', None),
    'missing_position': ('pending_manual_review', None), 'erp_position_blank': ('pending_manual_review', None),
    'wrong_slot_for_asset': ('pending_manual_review', None), 'inspection_other_layout': ('inconsistent', None),
    'serial_supports': ('offered_for_review', None), 'serial_weak': ('pending_manual_review', None),
    'serial_other_wheel': ('inconsistent', None), 'serial_replaced': ('offered_for_review', 'RHCO'),
    'undated': ('no_dated_movement', 'RHCO'), 'no_tyre_rows': ('no_tyre_movement', None),
    'wo_before_inspection': ('offered_for_review', 'RHCO'),
}
for name, (state, canonical) in EXPECT.items():
    v, code, msg = evaluate(name)
    ok = v is not None and v['state'] == state and v.get('canonical') == canonical \
        and v['eligible_to_confirm'] == (state == 'offered_for_review')
    check('A position', f'{name}: {state}', ok, v and {k: v[k] for k in ('state', 'canonical', 'layout_key', 'layout_reason', 'pending_reasons')} or (code, msg))

check('A position', 'evaluating wrote nothing (never auto confirms)', links() == 0 and events() == 0 and fingerprint() == BASE,
      (links(), events()))

# ------------------------------------------------------------------ B: confirm is refused unless offered
for name, (state, _) in EXPECT.items():
    if state == 'offered_for_review' and name != 'wo_before_inspection':
        continue
    v, code, msg = decide(name)
    check('B refuse', f'confirm refused: {name}', v is None and code == 'PT409', (code, msg))
check('B refuse', 'refusals left no link and no history', links() == 0 and events() == 0, (links(), events()))

# ------------------------------------------------------------------ C: tenant, country, site, role
for user, name, want in [
    ('beta.manager', 'mixer_match', '42501'),      # another tenant's action
    ('alpha.manager', 'beta', '42501'),            # our user, their action
    ('alpha.manager', 'uae', '42501'),             # KSA only manager, UAE case
    ('alpha.engineer', 'mixer_match', '42501'),    # not elevated
    ('alpha.tyreman', 'mixer_match', '42501'),
    ('alpha.driver', 'mixer_match', '42501'),
    ('alpha.inspector', 'mixer_match', '42501'),
    ('alpha.manager', 'wo_other_country', 'PT409'),
    ('alpha.manager', 'wo_other_asset', 'PT409'),
]:
    v, code, msg = evaluate(name, user)
    check('C scope', f'evaluate refused: {user} on {name}', v is None and code == want, (code, msg))
    v, code, msg = decide(name, 'confirmed', user)
    check('C scope', f'confirm refused: {user} on {name}', v is None and code == want, (code, msg))
    v, code, msg = decide(name, 'rejected', user)
    check('C scope', f'reject refused: {user} on {name}', v is None and code == want, (code, msg))

# our user naming another tenant's job card
become('alpha.manager')
out, code, msg = attempt("select public.observation_erp_evaluate(%s, %s)", (C['mixer_match'][0], C['beta'][1]))
owner()
check('C scope', 'another tenant job card is not found', out is None and code == 'PT409', (code, msg))

v, code, msg = evaluate('uae', 'alpha.director')
check('C scope', 'a director who sees UAE may evaluate the UAE case', v is not None and v['state'] == 'offered_for_review', (code, msg))

# site: narrow the manager to one site, then try a case at another
cur.execute('savepoint site')
cur.execute("set local session_replication_role = replica")
cur.execute("update public.profiles set sites = array['ALPHA NORTH PLANT'] where id = %s", (USER['alpha.manager'],))
cur.execute("set local session_replication_role = origin")
v, code, msg = evaluate('east_site')
check('C scope', 'site outside scope is refused', v is None and code == '42501', (code, msg))
v, code, msg = decide('east_site')
check('C scope', 'confirm at a site outside scope is refused', v is None and code == '42501', (code, msg))
v, code, msg = evaluate('mixer_match')
check('C scope', 'own site still works', v is not None and v['state'] == 'offered_for_review', (code, msg))
cur.execute('rollback to savepoint site')
v, code, msg = evaluate('east_site')
check('C scope', 'all sites user reaches the east site case', v is not None and v['state'] == 'offered_for_review', (code, msg))

for fn, sig in [('observation_erp_evaluate', 'uuid,uuid'), ('observation_erp_decide', 'uuid,uuid,text,text'),
                ('confirm_observation_erp_link', 'uuid,uuid,text'), ('reject_observation_erp_link', 'uuid,uuid,text'),
                ('tyre_asset_layout', 'uuid,text,text,text,date'), ('tyre_type_layout', 'uuid,text,text,integer,date')]:
    r = q(f"select has_function_privilege('anon', 'public.{fn}({sig})', 'execute'), has_function_privilege('public', 'public.{fn}({sig})', 'execute')")[0]
    check('C scope', f'anon and PUBLIC cannot execute {fn}', r == (False, False), r)
r = q("""select has_function_privilege('authenticated', 'public.tyre_asset_layout(uuid,text,text,text,date)', 'execute'),
                has_function_privilege('authenticated', 'public.tyre_type_layout(uuid,text,text,integer,date)', 'execute')""")[0]
check('C scope', 'helpers that take an organisation id are closed to authenticated', r == (False, False), r)

become('alpha.manager')
out, code, msg = attempt("""insert into public.observation_erp_links (organisation_id, country, action_id, work_order_id, source_job_card, decision_note, reviewed_by)
                            values (%s, 'KSA', %s, %s, 'X', 'forged link', %s)""", (ALPHA, *C['mixer_match'][:2], USER['alpha.manager']))
owner()
check('C scope', 'a link cannot be written directly', out is None and code == '42501', (code, msg))

# ------------------------------------------------------------------ D: confirm, reject, history
v, code, msg = decide('mixer_other', 'rejected')
check('D decide', 'reject is recorded', v is not None and v['decision'] == 'rejected' and links() == 0 and events() == 1, (v, code, msg))
row = q("select status, closed_at, work_order_id from public.corrective_actions where id = %s", (C['mixer_other'][0],))[0]
check('D decide', 'reject leaves the action untouched', row == ('Open', None, None), row)

v, code, msg = decide('mixer_match', reason='ab')
check('D decide', 'a reason is required', v is None and code == '22023', (code, msg))

v, code, msg = decide('mixer_match')
check('D decide', 'confirm on the same canonical wheel', v is not None and v['canonical'] == 'RHCO' and links() == 1 and events() == 2, (v, code, msg))
row = q("select status, closed_at, resolved_at, verified_at, work_order_id::text from public.corrective_actions where id = %s", (C['mixer_match'][0],))[0]
check('D decide', 'confirm links the job card and does NOT close the action',
      row == ('Open', None, None, None, C['mixer_match'][1]), row)
ev = q("select position_evidence->>'state', position_evidence->>'canonical', reviewed_by::text from public.observation_erp_links where action_id = %s", (C['mixer_match'][0],))[0]
check('D decide', 'the link keeps the position evidence and the reviewer', ev == ('offered_for_review', 'RHCO', USER['alpha.manager']), ev)

v, code, msg = decide('mixer_match')
check('D decide', 'confirming twice is idempotent', v is not None and v['already_linked'] is True and links() == 1, (v, code, msg))
become('alpha.manager')
out, code, msg = attempt("select public.confirm_observation_erp_link(%s, %s, %s)", (C['mixer_match'][0], C['mixer_overdue_key'][1], 'Second job card'))
owner()
check('D decide', 'a second job card for a linked action is refused', out is None and code == 'PT409', (code, msg))

v, code, msg = decide('serial_supports')
check('D decide', 'a real serial leaving on the job card can be confirmed', v is not None and v['state'] == 'offered_for_review', (v, code, msg))
v, code, msg = decide('serial_replaced')
check('D decide', 'a replacement tyre with its own serial is not blocked', v is not None and v['canonical'] == 'RHCO', (v, code, msg))

for stmt in ("update public.observation_erp_link_events set reason = 'edited'",
             "delete from public.observation_erp_link_events"):
    out, code, msg = attempt(stmt)
    check('D decide', f'history is append-only: {stmt.split()[0]}', out is None and code == 'PT409', (code, msg))

become('beta.manager')
seen = q("select (select count(*) from public.observation_erp_links), (select count(*) from public.observation_erp_link_events)")[0]
owner()
check('D decide', 'another tenant reads none of the links or history', seen == (0, 0), seen)
become('alpha.engineer')   # UAE only
seen = q("select (select count(*) from public.observation_erp_links), (select count(*) from public.observation_erp_link_events)")[0]
owner()
check('D decide', 'a UAE scoped user reads none of the KSA links or history', seen == (0, 0), seen)

# ------------------------------------------------------------------ E: nothing historical was rewritten
check('E history', 'tyre records, costs, work orders, inspections, fleet and action fields unchanged', fingerprint() == BASE,
      [a == b for a, b in zip(fingerprint(), BASE)])
changed = q("select count(*) from public.corrective_actions where asset_no like 'ZP%%' and work_order_id is not null")[0][0]
check('E history', 'only the three confirmed actions carry a job card link', changed == 3, changed)
cost = q("select count(*), min(cost_per_tyre), max(cost_per_tyre) from public.tyre_records where asset_no like 'ZP%%'")[0]
check('E history', 'no tyre cost moved', float(cost[1]) == 1234.5 and float(cost[2]) == 1234.5, cost)

# ------------------------------------------------------------------ F: admin layouts and layout history
cur.execute('savepoint custom')
cur.execute("""insert into public.vehicle_diagram_configs (id, organisation_id, vehicle_type, config, active, updated_at)
               values (gen_random_uuid(), %s, 'TR-MIXER',
                 '{"axles":[{"kind":"steer"},{"kind":"steer"},{"kind":"drive","dual":true},{"kind":"drive","dual":true}],"spare":1}', true, '2026-01-01')""", (ALPHA,))
cur.execute("set local session_replication_role = replica")
C['mixer13_spare'] = make_case('ZPMX2', 'damage:SP', [('SP1', 'NEWTYRE040', AFTER, None)])
C['mixer13_numbered'] = make_case('ZPMX2', 'damage:R1Ro', [('RHR1-O', 'NEWTYRE041', AFTER, None)])
C['mixer13_cr_code'] = make_case('ZPMX2', 'damage:R1Ro', [('RHCO', 'NEWTYRE042', AFTER, None)])
cur.execute("set local session_replication_role = origin")
v, code, msg = evaluate('mixer13_spare')
check('F layouts', 'mixer 13 (admin layout with a spare): spare resolves', v and v['state'] == 'offered_for_review' and v['canonical'] == 'SP1' and v['layout_key'] == 'custom:TR-MIXER', v or (code, msg))
v, code, msg = evaluate('mixer13_numbered')
check('F layouts', 'admin layout numbers its rear axles: numbered ERP code matches', v and v['state'] == 'offered_for_review' and v['canonical'] == 'RHR1-O', v or (code, msg))
v, code, msg = evaluate('mixer13_cr_code')
check('F layouts', 'centre axle code on a numbered admin layout stays pending', v and v['state'] == 'pending_manual_review', v or (code, msg))
cur.execute("update public.vehicle_diagram_configs set updated_at = '2026-10-15' where organisation_id = %s and vehicle_type = 'TR-MIXER'", (ALPHA,))
v, code, msg = evaluate('mixer13_numbered')
check('F layouts', 'admin layout changed after the inspection: pending, not trusted',
      v and v['state'] == 'pending_manual_review' and v['pending_reasons'] == {'layout_changed_since_record': 1}, v or (code, msg))
become('beta.manager')
out, code, msg = attempt("select public.observation_erp_evaluate(%s, %s)", C['beta'][:2])
owner()
check('F layouts', "another tenant's admin layout does not leak into ours (beta still built-in)",
      out is not None and out[0][0]['layout_key'] == 'Tri-mixer', out or (code, msg))
cur.execute('rollback to savepoint custom')

conn.rollback()
failed = [r for r in results if not r[2]]
for section, name, ok, ev in results:
    print(('PASS ' if ok else 'FAIL ') + f'[{section}] {name}' + ('' if ok else f'   -> {ev}'))
print(f'\n{len(results) - len(failed)} passed, {len(failed)} failed (all rolled back)')
sys.exit(1 if failed else 0)
