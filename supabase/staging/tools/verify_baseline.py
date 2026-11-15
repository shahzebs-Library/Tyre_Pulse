#!/usr/bin/env python3
"""Compare what is loaded with what the extraction expected (baseline/MANIFEST.json), then re-create
every function with check_function_bodies = on so SQL-language bodies are validated against the
loaded schema. Prints a short table and any function that does not validate.

Usage: verify_baseline.py --dsn "<dsn>" --baseline <dir> [--report out.json]
"""
import argparse, glob, json, os, re, sys
import psycopg2
ap = argparse.ArgumentParser(); ap.add_argument('--dsn', required=True); ap.add_argument('--baseline', required=True)
ap.add_argument('--report'); a = ap.parse_args()
if 'jhssdmeruxtrlqnwfksc' in a.dsn: sys.exit('Refusing: that is the production project.')
exp = json.load(open(os.path.join(a.baseline, 'MANIFEST.json')))['expected']
conn = psycopg2.connect(a.dsn); conn.autocommit = True; cur = conn.cursor()
NS = "('public','approval_private','private','workforce_internal','ai_tyre_private','anum_integration','administration_imports')"
EXT = "not exists (select 1 from pg_depend d where d.objid = %s.oid and d.deptype = 'e')"
q = {
 'tables': f"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in {NS} and " + EXT % 'c',
 'functions': f"select count(*) from pg_proc c join pg_namespace n on n.oid=c.pronamespace where n.nspname in {NS} and " + EXT % 'c',
 'policies_app': f"select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in {NS}",
 'policies_storage': "select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='storage'",
 'constraints': f"select count(*) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in {NS}",
 'indexes_non_constraint': f"select count(*) from pg_index x join pg_class c on c.oid=x.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in {NS} and not exists (select 1 from pg_constraint k where k.conindid=x.indexrelid and k.contype in ('p','u','x')) and " + EXT % 'c',
 'views': f"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('v','m') and n.nspname in {NS} and " + EXT % 'c',
 'triggers': f"select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in {NS}",
 'sequences_total': f"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='S' and n.nspname in {NS}",
 'rls_enabled_tables': f"select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and c.relrowsecurity and n.nspname in {NS}",
}
exp['policies_storage'] = exp['policies'] - exp['policies_app']
rows, bad = [], 0
for k, sql in q.items():
    cur.execute(sql); got = cur.fetchone()[0]; want = exp.get(k)
    rows.append((k, want, got, 'OK' if want == got else 'MISMATCH')); bad += want != got
print('%-26s %10s %8s' % ('object', 'production', 'loaded'))
for r in rows: print('%-26s %10s %8s  %s' % r)
# validate function bodies
cur.execute('set check_function_bodies = on; set search_path = "$user", public, extensions')
invalid = []
for f in sorted(glob.glob(os.path.join(a.baseline, '[0-9][0-9]_*.sql'))):
    for s in open(f).read().split('\n-- @@\n'):
        if not re.match(r'\s*CREATE OR REPLACE (FUNCTION|PROCEDURE)', s): continue
        try: cur.execute(s)
        except Exception as e:
            invalid.append({'function': re.match(r'\s*CREATE OR REPLACE \w+ ([^\n(]+)', s).group(1), 'error': str(e).strip().split('\n')[0]})
print('function bodies that fail validation with check_function_bodies = on: %d' % len(invalid))
for i in invalid[:40]: print('  %s :: %s' % (i['function'], i['error']))
if a.report: json.dump({'counts': rows, 'invalid_functions': invalid}, open(a.report, 'w'), indent=1)
sys.exit(1 if bad else 0)
