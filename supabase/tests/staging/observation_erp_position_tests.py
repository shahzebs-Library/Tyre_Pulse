#!/usr/bin/env python3
"""
Staging tests for the follow-up drafts
  supabase/pending_migrations/20261116084000_observation_erp_confirm_interim_lock.sql
  supabase/pending_migrations/20261116085000_tyre_layout_versions_and_position_mappings.sql
  supabase/pending_migrations/20261116090000_tyre_position_service.sql
  supabase/pending_migrations/20261116091000_observation_erp_decide_on_position_service.sql
on top of the migration that is live in production
  supabase/migrations/20261115120000_observation_erp_reconciliation.sql

Runs against a LOCAL staging database copy (never production: the script refuses any host
but 127.0.0.1 / localhost). All data is invented here, inside ONE transaction that is
always rolled back.

  createdb -h 127.0.0.1 -p 54329 -U postgres -T tyrepulse_staging tp_position
  psql ... -d tp_position -1 -f supabase/migrations/20261115120000_observation_erp_reconciliation.sql
  psql ... -d tp_position -1 -f supabase/pending_migrations/20261116085000_tyre_layout_versions_and_position_mappings.sql
  psql ... -d tp_position -1 -f supabase/pending_migrations/20261116090000_tyre_position_service.sql
  psql ... -d tp_position -1 -f supabase/pending_migrations/20261116091000_observation_erp_decide_on_position_service.sql
  python3 supabase/tests/staging/observation_erp_position_tests.py \
      --dsn "host=127.0.0.1 port=54329 dbname=tp_position user=postgres"

Covers: every layout type (mixer 12, mixer 13 with spare, pump 14, pump 12, 6x4 10, line
pump 12, loader, pickup 4, tyreless), tenant, country, site, role, position, serial
(never confirms alone), the separately authorised serial exception, layout versions,
per-layout verified mappings, the permission matrix, the interim lock, the rollback file,
dates, append-only history, and "nothing historical is rewritten".
"""
import argparse, json, os, sys, uuid
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
C['mixer_second_axle'] = make_case('ZPMX1', 'damage:R2Li', [('LHRI', 'NEWTYRE004', AFTER, None)])
C['not_damage_action'] = make_case('ZPMX1', 'overdue:R2Li:OLDTYRE777', [('LHRI', 'NEWTYRE044', AFTER, None)])
C['mixer_typed'] = make_case('ZPMX1', 'damage:R1Li', [('LHCI', 'NEWTYRE045', AFTER, None)], insp_type='TR-MIXER')
C['mixer_typed_reject'] = make_case('ZPMX1', 'damage:R1Li', [('RHRO', 'NEWTYRE046', AFTER, None)], insp_type='TR-MIXER')
C['pump14'] = make_case('ZPPU1', 'damage:F3L', [('LHF3', 'NEWTYRE005', AFTER, None)])
C['pump12_slot_missing'] = make_case('ZPPU2', 'damage:F3L', [('LHF3', 'NEWTYRE006', AFTER, None)])
C['pump12_match'] = make_case('ZPPU2', 'damage:F2R', [('RHF2', 'NEWTYRE007', AFTER, None)])
C['six_by_four'] = make_case('ZP6X1', 'damage:R2Li', [('LHR2-I', 'NEWTYRE008', AFTER, None)])
C['line_pump'] = make_case('ZPLP1', 'damage:R1Lo', [('LHR1-O', 'NEWTYRE009', AFTER, None)])
C['loader'] = make_case('ZPWL1', 'damage:FL', [('LHF1', 'NEWTYRE010', AFTER, None)])
C['pickup_bare'] = make_case('ZPPK1', 'damage:RR', [('RHR1', 'NEWTYRE011', AFTER, None)])
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
C['pump_cr_spelling'] = make_case('ZPPU1', 'damage:R1Lo', [('LHRCO', 'NEWTYRE050', AFTER, None)])
C['pump_rr_spelling'] = make_case('ZPPU1', 'damage:R2Li', [('LHRRI', 'NEWTYRE051', AFTER, None)])
C['pump_numbered_exact'] = make_case('ZPPU1', 'damage:R1Ro', [('RHR1-O', 'NEWTYRE053', AFTER, None)])
C['pump4_numbered_exact'] = make_case('ZPPU2', 'damage:R1Lo', [('LHR1-O', 'NEWTYRE054', AFTER, None)])
C['mixer_cr_spelling'] = make_case('ZPMX1', 'damage:R1Lo', [('LHRCO', 'NEWTYRE052', AFTER, None)])
C['serial_exc_admin'] = make_case('ZPMX2', 'damage:R1Ro', [('', 'OBSERVED9010', BEFORE, AFTER)], serial='OBSERVED9010')
C['serial_exc_grant'] = make_case('ZPMX2', 'damage:R1Ro', [('', 'OBSERVED9011', BEFORE, AFTER)], serial='OBSERVED9011')
C['perm'] = make_case('ZPMX2', 'damage:R1Ro', [('RHCO', 'NEWTYRE060', AFTER, None)])
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
    'mixer_match': ('offered_for_review', 'RHCO'), 'mixer_second_axle': ('offered_for_review', 'LHRI'),
    'pump14': ('offered_for_review', 'LHF3'), 'pump12_match': ('offered_for_review', 'RHF2'),
    'six_by_four': ('offered_for_review', 'LHR2-I'), 'line_pump': ('offered_for_review', 'LHR1-O'),
    'loader': ('offered_for_review', 'LHF1'), 'pickup_bare': ('offered_for_review', 'RHR1'),
    'mixer_other': ('different_wheel', None), 'mixer_scheme': ('pending_manual_review', None),
    'pump12_slot_missing': ('pending_manual_review', None), 'pickup_dual_code': ('pending_manual_review', None),
    'tyreless': ('pending_manual_review', None), 'unknown_type': ('pending_manual_review', None),
    'missing_position': ('pending_manual_review', None), 'erp_position_blank': ('pending_manual_review', None),
    'wrong_slot_for_asset': ('pending_manual_review', None), 'inspection_other_layout': ('inconsistent', None),
    'serial_supports': ('pending_manual_review', None), 'serial_exc_admin': ('pending_manual_review', None),
    'pump_cr_spelling': ('pending_manual_review', None), 'pump_rr_spelling': ('pending_manual_review', None),
    'mixer_cr_spelling': ('pending_manual_review', None), 'pump_numbered_exact': ('pending_manual_review', None),
    'pump4_numbered_exact': ('pending_manual_review', None), 'serial_weak': ('pending_manual_review', None),
    'serial_other_wheel': ('inconsistent', None), 'serial_replaced': ('offered_for_review', 'RHCO'),
    'undated': ('no_dated_movement', 'RHCO'), 'no_tyre_rows': ('no_tyre_movement', None),
    'wo_before_inspection': ('offered_for_review', 'RHCO'),
}
for name, (state, canonical) in EXPECT.items():
    v, code, msg = evaluate(name)
    ok = v is not None and v['state'] == state and v.get('canonical') == canonical \
        and v['eligible_to_confirm'] == (state == 'offered_for_review')
    check('A position', f'{name}: {state}', ok, v and {k: v[k] for k in ('state', 'canonical', 'layout_key', 'layout_reason', 'pending_reasons')} or (code, msg))

for name, want in [('serial_supports', True), ('serial_exc_admin', True), ('serial_weak', False), ('serial_other_wheel', False),
                   ('serial_replaced', False), ('mixer_match', False), ('erp_position_blank', False)]:
    v, code, msg = evaluate(name)
    check('A position', f'serial exception possible = {want}: {name}', v is not None and v.get('serial_exception_possible') is want
          and (not want or v.get('serial_supports') is True), v and {k: v.get(k) for k in ('state', 'serial_supports', 'serial_exception_possible')} or (code, msg))
for name in ('pump_cr_spelling', 'pump_rr_spelling', 'mixer_cr_spelling', 'pump_numbered_exact', 'pump4_numbered_exact'):
    v, code, msg = evaluate(name)
    check('A position', f'ERP rear spelling is not read without a verified mapping: {name}',
          v is not None and v['pending_reasons'] == {'erp_spelling_not_verified': 1}, v and v['pending_reasons'] or (code, msg))
v, code, msg = evaluate('mixer_match')
check('A position', 'the function reports the rules version the client checks', v is not None and v.get('rules_version') == 'position-service-2', v and v.get('rules_version'))

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
    ('alpha.manager', 'not_damage_action', '42501'),   # live guard kept: damage actions only
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
check('D decide', 'confirm on the same canonical wheel', v is not None and v['decision'] == 'confirmed' and links() == 1 and events() == 2, (v, code, msg))
check('D decide', 'result has exactly the five keys the live function returns',
      v is not None and sorted(v.keys()) == ['action_id', 'already_linked', 'decision', 'ok', 'work_order_id'], v)
row = q("select status, closed_at, resolved_at, verified_at, work_order_id::text from public.corrective_actions where id = %s", (C['mixer_match'][0],))[0]
check('D decide', 'confirm links the job card and does NOT close the action',
      row == ('Open', None, None, None, C['mixer_match'][1]), row)
ev = q("select source_job_card, reviewed_by::text, work_order_snapshot->>'work_order_no' from public.observation_erp_links where action_id = %s", (C['mixer_match'][0],))[0]
check('D decide', 'the link keeps the job card, its snapshot and the reviewer', ev == (C['mixer_match'][2], USER['alpha.manager'], C['mixer_match'][2]), ev)

v, code, msg = decide('mixer_match')
check('D decide', 'confirming twice is idempotent', v is not None and v['already_linked'] is True and links() == 1, (v, code, msg))
become('alpha.manager')
out, code, msg = attempt("select public.confirm_observation_erp_link(%s, %s, %s)", (C['mixer_match'][0], C['mixer_second_axle'][1], 'Second job card'))
owner()
check('D decide', 'a second job card for a linked action is refused', out is None and code == 'PT409', (code, msg))

v, code, msg = decide('serial_supports')
check('D decide', 'a matching serial alone is NOT confirmed (normal reviewer)', v is None and code == 'PT409', (v, code, msg))
v, code, msg = decide('serial_supports', user='alpha.admin')
check('D decide', 'a matching serial alone is NOT confirmed by the normal Confirm, even for an Admin', v is None and code == 'PT409', (v, code, msg))
v, code, msg = decide('serial_replaced')
check('D decide', 'a replacement tyre with its own serial is not blocked', v is not None and v['ok'] is True, (v, code, msg))

for stmt in ("update public.observation_erp_link_events set reason = 'edited'",
             "delete from public.observation_erp_link_events"):
    out, code, msg = attempt(stmt)
    check('D decide', f'history is append-only: {stmt.split()[0]}', out is None and 'append-only' in (msg or ''), (code, msg))

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
check('E history', 'only the two confirmed actions carry a job card link', changed == 2, changed)
cost = q("select count(*), min(cost_per_tyre), max(cost_per_tyre) from public.tyre_records where asset_no like 'ZP%%'")[0]
check('E history', 'no tyre cost moved', float(cost[1]) == 1234.5 and float(cost[2]) == 1234.5, cost)


# ------------------------------------------------------------------ X: documented serial exception
LONG = 'Workshop read the serial off the removed tyre and it is the inspected one'
def exception(name, user, reason=LONG):
    become(user)
    out, code, msg = attempt("select public.confirm_observation_erp_link_by_exception(%s, %s, %s)", (*C[name][:2], reason))
    owner()
    return (out[0][0] if out else None), code, msg

def rules(user):
    become(user)
    out, code, msg = attempt("select public.observation_erp_rules()")
    owner()
    return out[0][0] if out else {'error': code}

n0 = (links(), events())
for user in ('alpha.manager', 'alpha.director', 'alpha.tyreman', 'alpha.engineer', 'alpha.driver', 'alpha.inspector', 'beta.admin', 'beta.manager'):
    v, code, msg = exception('serial_exc_admin', user)
    check('X exception', f'refused for {user}', v is None and code == '42501', (v, code, msg))
check('X exception', 'refusals wrote nothing', (links(), events()) == n0, (links(), events()))
r = rules('alpha.manager')
check('X exception', 'rules: a Manager may review but may not record an exception',
      r.get('can_review') is True and r.get('can_record_exception') is False and r.get('rules_version') == 'position-service-2', r)
r = rules('alpha.admin')
check('X exception', 'rules: an Admin may record an exception (default)', r.get('can_review') is True and r.get('can_record_exception') is True, r)
r = rules('alpha.tyreman')
check('X exception', 'rules: a Tyre Man may do neither', r.get('can_review') is False and r.get('can_record_exception') is False, r)
v, code, msg = exception('serial_exc_admin', 'alpha.admin', 'too short')
check('X exception', 'a short reason is refused (20 characters)', v is None and code == '22023', (v, code, msg))
for name in ('mixer_other', 'serial_weak', 'serial_other_wheel', 'no_tyre_rows', 'erp_position_blank', 'pump_cr_spelling'):
    v, code, msg = exception(name, 'alpha.admin')
    check('X exception', f'an exception does not apply to: {name}', v is None and code == 'PT409', (v, code, msg))
v, code, msg = exception('serial_exc_admin', 'alpha.admin')
check('X exception', 'an Admin records the exception with a reason', v is not None and v['ok'] is True and (links(), events()) == (n0[0] + 1, n0[1] + 1), (v, code, msg))
row = q("""select l.exception_basis, l.reviewed_by::text, l.decision_note, l.reviewed_at is not null,
                  e.exception_basis, e.reviewer::text, e.reason, e.decision, e.created_at is not null
           from public.observation_erp_links l join public.observation_erp_link_events e on e.action_id = l.action_id
           where l.action_id = %s""", (C['serial_exc_admin'][0],))
check('X exception', 'stored on the link and in history: basis, who, when, reason',
      row == [('serial_only', USER['alpha.admin'], LONG, True, 'serial_only', USER['alpha.admin'], LONG, 'confirmed', True)], row)
out, code, msg = attempt("update public.observation_erp_link_events set reason = 'edited' where action_id = %s", (C['serial_exc_admin'][0],))
check('X exception', 'the recorded exception cannot be edited afterwards', out is None and 'append-only' in (msg or ''), (code, msg))
row = q("select exception_basis from public.observation_erp_links where action_id = %s", (C['mixer_match'][0],))
check('X exception', 'a normal confirm carries no exception basis', row == [(None,)], row)
# configurable per company: grant the capability to one Manager
cur.execute("""insert into public.user_access_grants (org_id, user_id, module_key, capability, effect, granted_by, note)
               values (%s, %s, 'corrective_actions', 'erp_serial_exception', 'grant', %s, 'Synthetic grant')""",
            (ALPHA, USER['alpha.manager'], USER['alpha.admin']))
r = rules('alpha.manager')
check('X exception', 'granting the capability to a person enables it for them', r.get('can_record_exception') is True, r)
v, code, msg = exception('serial_exc_grant', 'alpha.manager')
check('X exception', 'the granted Manager records an exception', v is not None and v['ok'] is True, (v, code, msg))
v, code, msg = exception('serial_supports', 'alpha.director')
check('X exception', 'another reviewer without the grant is still refused', v is None and code == '42501', (v, code, msg))
r = q("select has_function_privilege('authenticated', 'public.observation_erp_decide_core(uuid,uuid,text,text,text)', 'execute')")[0][0]
check('X exception', 'the writer that accepts an exception basis is closed to signed-in users', r is False, r)

# ------------------------------------------------------------------ P: permission matrix
# role x site x country x company x account state, on one offered case (C['perm'], ALPHA / KSA / north plant).
ROLES = ['admin', 'director', 'manager', 'engineer', 'tyreman', 'driver', 'inspector']
ELEVATED = {'admin', 'director', 'manager'}
matrix = {'allowed': 0, 'refused': 0, 'wrong': 0}
def set_profile(user, **cols):
    cur.execute("set local session_replication_role = replica")
    for k, val in cols.items():
        cur.execute(f"update public.profiles set {k} = %s where id = %s", (val, USER[user]))
    cur.execute("set local session_replication_role = origin")

def probe(user, expect_ok, label):
    for kind in ('evaluate', 'confirm', 'reject'):
        cur.execute('savepoint probe')
        if kind == 'evaluate':
            v, code, msg = evaluate('perm', user)
        else:
            v, code, msg = decide('perm', 'confirmed' if kind == 'confirm' else 'rejected', user)
        cur.execute('rollback to savepoint probe')
        ok = (v is not None) if expect_ok else (v is None and code == '42501')
        matrix['allowed' if (ok and expect_ok) else 'refused' if ok else 'wrong'] += 1
        if not ok:
            check('P matrix', f'{label}: {user} {kind}', False, (v, code, msg))

for company in ('alpha', 'beta'):
    for role in ROLES:
        user = f'{company}.{role}'
        for country in ('own', 'other'):
            for site in ('own', 'other'):
                for state in ('active', 'locked', 'unapproved'):
                    cur.execute('savepoint cell')
                    set_profile(user, country=['KSA'] if country == 'own' else ['UAE'],
                                sites=['ALPHA NORTH PLANT'] if site == 'own' else ['ALPHA EAST PLANT'],
                                locked=(state == 'locked'), approved=(state != 'unapproved'))
                    # An Admin sees every site of the company by design (app_can_see_site); countries
                    # follow the profile for everyone, Admin included.
                    scope_ok = country == 'own' and (site == 'own' or role == 'admin')
                    expect = company == 'alpha' and role in ELEVATED and state == 'active' and scope_ok
                    probe(user, expect, f'{company}/{role}/country {country}/site {site}/{state}')
                    cur.execute('rollback to savepoint cell')
cells = 2 * len(ROLES) * 2 * 2 * 3
check('P matrix', f'{cells} cells x 3 calls = {cells * 3} checks: {matrix["allowed"]} allowed, {matrix["refused"]} refused, {matrix["wrong"]} wrong',
      matrix['wrong'] == 0 and matrix['allowed'] + matrix['refused'] == cells * 3, matrix)
# a reviewer switched off in Access Control (corrective_actions / approve revoked)
cur.execute('savepoint capoff')
cur.execute("""insert into public.user_access_grants (org_id, user_id, module_key, capability, effect, granted_by, note)
               values (%s, %s, 'corrective_actions', 'approve', 'revoke', %s, 'Synthetic revoke')""",
            (ALPHA, USER['alpha.director'], USER['alpha.admin']))
v, code, msg = decide('perm', user='alpha.director')
check('P matrix', 'a reviewer switched off in Access Control is refused', v is None and code == '42501', (v, code, msg))
r = rules('alpha.director')
check('P matrix', 'and the rules function says so', r.get('can_review') is False, r)
cur.execute('rollback to savepoint capoff')
v, code, msg = evaluate('perm', 'platform.superadmin')
check('P matrix', 'a super admin may review', v is not None and v['state'] == 'offered_for_review', (v, code, msg))
cur.execute("select set_config('request.jwt.claims', '', true)"); cur.execute('set local role anon')
out, code, msg = attempt("select public.observation_erp_evaluate(%s, %s)", C['perm'][:2])
owner()
check('P matrix', 'not signed in: refused', out is None and code == '42501', (code, msg))
check('P matrix', 'the matrix left no link and no history behind', (links(), events()) == (n0[0] + 2, n0[1] + 2), (links(), events()))

# ------------------------------------------------------------------ F: admin layouts and layout history
cur.execute('savepoint custom')
CFG13 = '{"axles":[{"kind":"steer"},{"kind":"steer"},{"kind":"drive","dual":true},{"kind":"drive","dual":true}],"spare":1}'
CFG_NEW = '{"axles":[{"kind":"steer"},{"kind":"drive","dual":true}]}'
cur.execute("""insert into public.vehicle_diagram_configs (id, organisation_id, vehicle_type, config, active)
               values (gen_random_uuid(), %s, 'TR-MIXER', %s, true)""", (ALPHA, CFG13))
ver = q("select count(*), count(valid_to), min(basis) from public.vehicle_diagram_config_versions where organisation_id = %s and vehicle_type = 'TR-MIXER'", (ALPHA,))[0]
check('F layouts', 'creating a layout opens its first version', ver == (1, 0, 'recorded'), ver)
cur.execute("set local session_replication_role = replica")
C['mixer13_spare'] = make_case('ZPMX2', 'damage:SP', [('SP1', 'NEWTYRE040', AFTER, None)])
C['mixer13_numbered'] = make_case('ZPMX2', 'damage:R1Ro', [('RHR1-O', 'NEWTYRE041', AFTER, None)])
C['mixer13_cr_code'] = make_case('ZPMX2', 'damage:R1Ro', [('RHCO', 'NEWTYRE042', AFTER, None)])
cur.execute("set local session_replication_role = origin")
v, code, msg = evaluate('mixer13_numbered')
check('F layouts', 'a layout recorded AFTER the inspection is not used for it (built-in applies)',
      v and v['layout_key'] == 'Tri-mixer' and v['state'] == 'pending_manual_review', v or (code, msg))
# the layout was really in force since January (test data: move the opening version back)
cur.execute("set local session_replication_role = replica")
cur.execute("update public.vehicle_diagram_config_versions set valid_from = '2026-01-01' where organisation_id = %s and vehicle_type = 'TR-MIXER'", (ALPHA,))
cur.execute("set local session_replication_role = origin")
v, code, msg = evaluate('mixer13_spare')
check('F layouts', 'mixer 13 (admin layout with a spare): spare resolves', v and v['state'] == 'offered_for_review' and v['canonical'] == 'SP1' and v['layout_key'] == 'custom:TR-MIXER', v or (code, msg))
v, code, msg = evaluate('mixer13_numbered')
check('F layouts', 'admin layout numbers its rear axles: numbered ERP code matches', v and v['state'] == 'offered_for_review' and v['canonical'] == 'RHR1-O', v or (code, msg))
v, code, msg = evaluate('mixer13_cr_code')
check('F layouts', 'centre axle code on a numbered admin layout stays pending', v and v['state'] == 'pending_manual_review', v or (code, msg))
# an Admin now EDITS the layout (today): history must not be reinterpreted
become('platform.superadmin')   # layouts are edited in the console (super admin only)
out, code, msg = attempt("update public.vehicle_diagram_configs set config = %s where vehicle_type = 'TR-MIXER'", (CFG_NEW,))
owner()
ver = q("select count(*), count(valid_to) from public.vehicle_diagram_config_versions where organisation_id = %s and vehicle_type = 'TR-MIXER'", (ALPHA,))[0]
check('F layouts', 'an edit closes the old version and opens a new one', out == 1 and ver == (2, 1), (out, code, msg, ver))
old = (q("select config::text from public.vehicle_diagram_config_versions where organisation_id = %s and vehicle_type = 'TR-MIXER' and valid_to is not null", (ALPHA,)) or [('{}',)])[0][0]
check('F layouts', 'the old version still holds the old layout', json.loads(old) == json.loads(CFG13), old)
v, code, msg = evaluate('mixer13_numbered')
check('F layouts', 'OLD inspection still resolves on the layout in force at its date',
      v and v['state'] == 'offered_for_review' and v['canonical'] == 'RHR1-O' and v['layout_key'] == 'custom:TR-MIXER', v or (code, msg))
v, code, msg = evaluate('mixer13_spare')
check('F layouts', 'OLD inspection: the spare of the old layout still resolves', v and v['state'] == 'offered_for_review' and v['canonical'] == 'SP1', v or (code, msg))
then = q("select jsonb_array_length(public.tyre_type_layout(%s, 'TR-MIXER', null, null, date '2026-09-10')->'wheels')", (ALPHA,))[0][0]
now = q("select jsonb_array_length(public.tyre_type_layout(%s, 'TR-MIXER', null, null, current_date + 1)->'wheels')", (ALPHA,))[0][0]
check('F layouts', 'the resolver takes an as-of date: 13 wheels then, 6 wheels from tomorrow', (then, now) == (13, 6), (then, now))
today = q("""select public.tyre_position_resolve(public.tyre_type_layout(%s, 'TR-MIXER', null, null, current_date), 'F1L', 'slot')->>'reason'""", (ALPHA,))[0][0]
check('F layouts', 'a record dated on the day of the edit is not trusted (pending)', today == 'layout_changed_since_record', today)
for stmt in ("update public.vehicle_diagram_config_versions set config = '{}'", "delete from public.vehicle_diagram_config_versions"):
    out, code, msg = attempt(stmt)
    check('F layouts', f'layout history is append-only: {stmt.split()[0]}', out is None and 'append-only' in (msg or ''), (code, msg))
become('alpha.admin')
out, code, msg = attempt("insert into public.vehicle_diagram_config_versions (organisation_id, vehicle_type, config) values (%s, 'TR-MIXER', '{}')", (ALPHA,))
owner()
check('F layouts', 'nobody writes layout history directly, not even an Admin', out is None and code == '42501', (code, msg))
# a backfilled opening version: what was in force before it is not known
cur.execute("set local session_replication_role = replica")
cur.execute("""insert into public.vehicle_diagram_config_versions (organisation_id, vehicle_type, config, active, valid_from, basis)
               values (%s, 'PICKUP', '{"axles":[{"kind":"steer"},{"kind":"drive"}]}', true, '2026-10-15', 'backfill')""", (ALPHA,))
cur.execute("set local session_replication_role = origin")
v, code, msg = evaluate('pickup_bare')
check('F layouts', 'layout whose earlier state is unknown (backfill after the inspection): pending, not trusted',
      v and v['state'] == 'pending_manual_review' and v['pending_reasons'] == {'layout_changed_since_record': 1}, v or (code, msg))
become('beta.manager')
out, code, msg = attempt("select public.observation_erp_evaluate(%s, %s)", C['beta'][:2])
owner()
check('F layouts', "another tenant's admin layout does not leak into ours (beta still built-in)",
      out is not None and out[0][0]['layout_key'] == 'Tri-mixer', out or (code, msg))
become('beta.manager')
seen = q("select count(*) from public.vehicle_diagram_config_versions")[0][0]
owner()
check('F layouts', 'another tenant reads none of our layout history', seen == 0, seen)

# ---- per-layout verified mappings (the table ships empty)
n = q("select count(*) from public.tyre_layout_position_mappings")[0][0]
check('M mappings', 'no mapping exists by default', n == 0, n)
EVID = 'Checked against the axle diagram and three known ERP replacements'
def add_mapping(user, layout, code_, slot, evidence=EVID):
    become(user)
    out, code, msg = attempt("""insert into public.tyre_layout_position_mappings (organisation_id, layout_key, erp_code, slot, evidence, verified_by)
                                values (%s, %s, %s, %s, %s, %s)""", (ALPHA, layout, code_, slot, evidence, USER[user]))
    owner()
    return out, code, msg
key = evaluate('pump_cr_spelling')[0]['layout_key']
out, code, msg = add_mapping('alpha.manager', key, 'LHRCO', 'R1Lo')
check('M mappings', 'a Manager cannot record a mapping', out is None and code == '42501', (code, msg))
out, code, msg = add_mapping('alpha.admin', key, 'LHRCO', 'R1Lo', 'short')
check('M mappings', 'a mapping needs written evidence', out is None and code == '23514', (code, msg))
out, code, msg = add_mapping('alpha.admin', key, 'LHRCO', 'R1Lo')
check('M mappings', 'an Admin records a verified mapping for ONE layout', out == 1, (out, code, msg))
v, code, msg = evaluate('pump_cr_spelling')
check('M mappings', 'that layout now reads the spelling', v and v['state'] == 'offered_for_review', v or (code, msg))
v, code, msg = evaluate('pump_rr_spelling')
check('M mappings', 'a spelling that was not mapped stays pending', v and v['state'] == 'pending_manual_review', v or (code, msg))
out, code, msg = add_mapping('alpha.admin', key, 'RHR1-O', 'R1Ro')
v, code, msg = evaluate('pump_numbered_exact')
check('M mappings', 'a numbered rear code on a pump reads only once it is verified for that layout', out == 1 and v and v['state'] == 'offered_for_review', v or (code, msg))
v, code, msg = evaluate('pump4_numbered_exact')
check('M mappings', 'and the 4-axle pump layout is a different layout: still pending', v and v['state'] == 'pending_manual_review', v or (code, msg))
v, code, msg = evaluate('mixer_cr_spelling')
check('M mappings', 'the same spelling on ANOTHER layout stays pending', v and v['state'] == 'pending_manual_review', v or (code, msg))
become('alpha.admin')
out, code, msg = attempt("update public.tyre_layout_position_mappings set slot = 'R2Lo' where erp_code = 'LHRCO'")
owner()
check('M mappings', 'a mapping cannot be rewritten', out is None, (out, code, msg))
become('alpha.admin')
out, code, msg = attempt("update public.tyre_layout_position_mappings set active = false where erp_code = 'LHRCO'")
owner()
check('M mappings', 'a mapping can be switched off', out == 1, (out, code, msg))
v, code, msg = evaluate('pump_cr_spelling')
check('M mappings', 'switched off: the spelling is pending again', v and v['state'] == 'pending_manual_review', v or (code, msg))
out, code, msg = attempt("delete from public.tyre_layout_position_mappings")
check('M mappings', 'a mapping cannot be removed', out is None, (out, code, msg))
cur.execute('rollback to savepoint custom')

# ------------------------------------------------------------------ G: on top of the LIVE function
# Put the live function back (the rollback companion is the exact production text), record
# decisions with it, then apply the follow-up again: existing rows must be byte-identical.
HERE = os.path.dirname(os.path.abspath(__file__))
PENDING = os.path.join(HERE, '..', '..', 'pending_migrations')
READER_CALL = 'select anum_integration.apply_reader_policies();'
_reader_done = set()
def run_file(name):
    # The reader-policy call re-creates policies on every table and takes a lock on each; one
    # transaction cannot hold that several times over. It runs the FIRST time a file is applied
    # here (and is checked); repeats of the same file skip only that last line.
    owner()
    with open(os.path.join(PENDING, name)) as fh:
        sql = fh.read()
    if name in _reader_done:
        sql = sql.replace(READER_CALL, '')
    _reader_done.add(name)
    cur.execute(sql)

def table_print():
    return q("""select
      (select md5(coalesce(string_agg(md5(l::text), ',' order by id), '')) from public.observation_erp_links l),
      (select md5(coalesce(string_agg(md5(e::text), ',' order by id), '')) from public.observation_erp_link_events e),
      (select count(*) from public.observation_erp_links), (select count(*) from public.observation_erp_link_events)""")[0]

run_file('20261116091000_observation_erp_decide_ROLLBACK.sql')
live_md5 = q("select md5(pg_get_functiondef('public.observation_erp_decide(uuid,uuid,text,text)'::regprocedure))")[0][0]
check('G live', 'the rollback companion restores the exact production function (md5 272f785a...)',
      live_md5 == '272f785a2a32256bfe2b83b99d131c1b', live_md5)
before_live = (links(), events())
v, code, msg = decide('mixer_typed')
check('G live', 'live function: confirms a typed mixer case', v is not None and links() == before_live[0] + 1, (v, code, msg))
v, code, msg = decide('mixer_typed_reject', 'rejected')
check('G live', 'live function: records a rejection', v is not None and events() == before_live[1] + 2, (v, code, msg))
# Where the live CASE table and the position service disagree (documented in POSITION_ROUND2.md).
LIVE_DIFFERS = {
    'mixer_match': False,           # inspection has no vehicle type: live reads a mixer as "not a mixer"
    'serial_replaced': False,       # live wants the observed serial on the replacement tyre
    'serial_supports': False,       # live cannot use the serial when the ERP position is blank (follow-up: pending too)
    'pickup_bare': True,            # agree
    'pump12_slot_missing': True,    # live accepts front axle 3 on a machine registered with two
    'inspection_other_layout': False,
}
for name, live_accepts in LIVE_DIFFERS.items():
    cur.execute('savepoint probe')
    cur.execute("delete from public.observation_erp_links where action_id = %s", (C[name][0],))
    cur.execute("update public.corrective_actions set work_order_id = null where id = %s", (C[name][0],))
    v, code, msg = decide(name)
    check('G live', f'live function {"accepts" if live_accepts else "refuses"}: {name}', (v is not None) == live_accepts, (v, code, msg))
    cur.execute('rollback to savepoint probe')
snap_tables = table_print()
snap_actions = fingerprint()
run_file('20261116091000_observation_erp_decide_on_position_service.sql')
check('G live', 'follow-up applied over live rows: links and history byte-identical', table_print() == snap_tables, (table_print(), snap_tables))
check('G live', 'follow-up applied over live rows: tyre records, costs, work orders, inspections, actions unchanged', fingerprint() == snap_actions)
new_md5 = q("select md5(pg_get_functiondef('public.observation_erp_decide(uuid,uuid,text,text)'::regprocedure))")[0][0]
check('G live', 'the follow-up replaced the function body', new_md5 != live_md5, new_md5)
n = q("select count(*) from pg_policies where schemaname = 'public' and tablename like 'observation_erp_link%%' and policyname like 'anum_reader%%'")[0][0]
check('G live', 'reader policies exist on both tables', n == 8, n)
n = q("select count(*) from pg_policies where schemaname = 'public' and tablename in ('vehicle_diagram_config_versions', 'tyre_layout_position_mappings') and policyname like 'anum_reader%%'")[0][0]
check('G live', 'reader policies exist on the two new tables', n == 8, n)
n = q("select count(*) from pg_policies where schemaname = 'public' and tablename like 'observation_erp_link%%' and policyname not like 'anum_reader%%'")[0][0]
check('G live', 'the six live policies are still there, none added or removed', n == 6, n)
v, code, msg = decide('mixer_typed')
check('G live', 'a link made by the live function is still honoured (idempotent confirm)', v is not None and v['already_linked'] is True, (v, code, msg))
v, code, msg = decide('pump12_slot_missing')
check('G live', 'follow-up refuses what live accepted: wheel not on the registered build', v is None and code == 'PT409', (code, msg))

# ------------------------------------------------------------------ R: the rollback file, end to end
# live function -> synthetic links and events -> follow-up -> rollback file: the function is
# byte-identical to production again and no link or event row changed at any step.
FNS = ['observation_erp_decide(uuid,uuid,text,text)', 'confirm_observation_erp_link(uuid,uuid,text)', 'reject_observation_erp_link(uuid,uuid,text)']
def fn_md5(sig): return q(f"select md5(pg_get_functiondef('public.{sig}'::regprocedure))")[0][0]
def acl():
    # One sorted entry list per function: PostgreSQL appends a re-granted entry at the end, so the
    # text order can differ while the privileges are identical.
    return q("""select p.oid::regprocedure::text, (select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a)
                from pg_proc p where p.oid = any(%s::regprocedure[]) order by 1""", (['public.' + f for f in FNS],))
PROD = {FNS[0]: '272f785a2a32256bfe2b83b99d131c1b', FNS[1]: '479f5400cf932e246c748909733be801', FNS[2]: 'f3109e20f4628824f4ecd90bd836e289'}
PROD_ACL = 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres'
run_file('20261116091000_observation_erp_decide_ROLLBACK.sql')
check('R rollback', 'step 1: live function in place', fn_md5(FNS[0]) == PROD[FNS[0]], fn_md5(FNS[0]))
cur.execute("set local session_replication_role = replica")
C['rb1'] = make_case('ZPMX1', 'damage:R2Lo', [('LHRO', 'NEWTYRE070', AFTER, None)], insp_type='TR-MIXER')
C['rb2'] = make_case('ZPMX1', 'damage:R2Ro', [('LHCO', 'NEWTYRE071', AFTER, None)], insp_type='TR-MIXER')
cur.execute("set local session_replication_role = origin")
a = decide('rb1'); b = decide('rb2', 'rejected')
check('R rollback', 'step 2: synthetic link and events recorded by the live function', a[0] is not None and b[0] is not None, (a, b))
snap = table_print(); snap_rows = fingerprint()
run_file('20261116091000_observation_erp_decide_on_position_service.sql')
check('R rollback', 'step 3: follow-up applied, rows byte-identical', table_print() == snap and fn_md5(FNS[0]) != PROD[FNS[0]], table_print())
run_file('20261116091000_observation_erp_decide_ROLLBACK.sql')
check('R rollback', 'step 4: rollback file run, function md5 equals production (272f785a2a32256bfe2b83b99d131c1b)', fn_md5(FNS[0]) == PROD[FNS[0]], fn_md5(FNS[0]))
check('R rollback', 'step 4: link and event rows byte-identical', table_print() == snap, (table_print(), snap))
check('R rollback', 'step 4: tyre records, work orders, inspections, actions, fleet unchanged', fingerprint() == snap_rows)
check('R rollback', 'the two wrappers are byte-identical to production throughout', all(fn_md5(f) == PROD[f] for f in FNS[1:]), [fn_md5(f) for f in FNS[1:]])
v, code, msg = decide('rb1')
check('R rollback', 'after rollback the live function still honours its link', v is not None and v['already_linked'] is True, (v, code, msg))

# ------------------------------------------------------------------ L: interim lock (on the LIVE function)
check('L lock', 'before: ACL equals production on all three entry points', all(a_ == PROD_ACL for _, a_ in acl()), acl())
acl_before = acl(); snap = table_print(); snap_rows = fingerprint()
LOOKUP = [  # the reads the evidence lookup and the review panel make
    "select count(*) from public.observation_erp_links", "select count(*) from public.observation_erp_link_events",
    "select count(*) from public.work_orders where asset_no = 'ZPMX1'", "select count(*) from public.tyre_records where asset_no = 'ZPMX1'",
    "select count(*) from public.corrective_actions where asset_no = 'ZPMX1'", "select count(*) from public.vehicle_fleet where asset_no = 'ZPMX1'",
    "select count(*) from public.inspections where asset_no = 'ZPMX1'",
]
def reads(user):
    become(user); out = [q(x)[0][0] for x in LOOKUP]; owner(); return out
reads_before = reads('alpha.manager')
run_file('20261116084000_observation_erp_confirm_interim_lock.sql')
want = 'postgres=X/postgres,service_role=X/postgres'
check('L lock', 'after: only the owner and service_role keep EXECUTE', all(a_ == want for _, a_ in acl()), acl())
check('L lock', 'no function body changed', all(fn_md5(f) == PROD[f] for f in FNS), [fn_md5(f) for f in FNS])
paths = [("select public.observation_erp_decide(%s, %s, %s, 'confirmed')", 'decide confirm'),
         ("select public.observation_erp_decide(%s, %s, %s, 'rejected')", 'decide reject'),
         ("select public.confirm_observation_erp_link(%s, %s, %s)", 'confirm wrapper'),
         ("select public.reject_observation_erp_link(%s, %s, %s)", 'reject wrapper')]
for user in ('alpha.manager', 'alpha.director', 'alpha.admin', 'platform.superadmin', 'alpha.tyreman', 'beta.admin'):
    for sql, label in paths:
        become(user)
        out, code, msg = attempt(sql, (*C['perm'][:2], 'Synthetic review reason'))
        owner()
        check('L lock', f'refused for {user}: {label}', out is None and code == '42501' and 'permission denied for function' in (msg or ''), (out, code, msg))
cur.execute("select set_config('request.jwt.claims', '', true)"); cur.execute('set local role anon')
out, code, msg = attempt(paths[2][0], (*C['perm'][:2], 'Synthetic review reason'))
owner()
check('L lock', 'refused for anon', out is None and code == '42501', (code, msg))
check('L lock', 'reads for an elevated user are unchanged (lookup tables and both ERP tables)', reads('alpha.manager') == reads_before, (reads('alpha.manager'), reads_before))
cur.execute("select set_config('request.jwt.claims', '', true)"); cur.execute('set local role service_role')
out, code, msg = attempt(paths[2][0], (*C['perm'][:2], 'Synthetic review reason'))
owner()
check('L lock', 'service_role is not locked out (it reaches the function own gate, which refuses a caller with no user)',
      out is None and code == '42501' and 'permission denied for function' not in (msg or ''), (out, code, msg))
r = q("select " + ", ".join(f"has_function_privilege('service_role', 'public.{f}', 'execute')" for f in FNS))[0]
check('L lock', 'service_role keeps EXECUTE on all three', r == (True, True, True), r)
check('L lock', 'rows byte-identical under the lock', table_print() == snap and fingerprint() == snap_rows, table_print())
for f in FNS:
    cur.execute(f"grant execute on function public.{f} to authenticated")
check('L lock', 'rollback (the three grants in the header) restores the same ACL entries', acl() == acl_before, (acl(), acl_before))
v, code, msg = decide('rb1')
check('L lock', 'after the lock rollback the live path works as before', v is not None and v['already_linked'] is True, (v, code, msg))
# lock, then the corrected function: it grants again on purpose
run_file('20261116084000_observation_erp_confirm_interim_lock.sql')
run_file('20261116091000_observation_erp_decide_on_position_service.sql')
check('L lock', 'the corrected function migration grants EXECUTE again on all three', all(a_ == PROD_ACL for _, a_ in acl()), acl())
before = table_print()
v, code, msg = decide('perm')
check('L lock', 'and a reviewer can confirm an offered case on the corrected rules', v is not None and v['ok'] is True, (v, code, msg))
check('L lock', 'which adds exactly one link and one history row', table_print()[2:] == (before[2] + 1, before[3] + 1), table_print())

conn.rollback()
failed = [r for r in results if not r[2]]
for section, name, ok, ev in results:
    print(('PASS ' if ok else 'FAIL ') + f'[{section}] {name}' + ('' if ok else f'   -> {ev}'))
print(f'\n{len(results) - len(failed)} passed, {len(failed)} failed (all rolled back)')
sys.exit(1 if failed else 0)
