#!/usr/bin/env python3
"""Rollback rehearsal for the tenancy drafts on a throwaway local copy (127.0.0.1 only).

For every draft, in order, in its own transaction:
  fingerprint -> SAVEPOINT -> apply -> fingerprint (must change) -> ROLLBACK TO SAVEPOINT
  -> fingerprint (must equal the one before) -> apply again so the next draft sees its dependency.
Each draft is committed after the check, so the chain of restores composes back to the start.
Optional --pre files are applied (and kept inside the same transaction) before the sequence,
e.g. the Group B drafts (files with their own begin/commit must be applied with psql instead), to prove the tenancy drafts apply cleanly after them.
"""
import argparse, json, os
import psycopg2

def _read(path):
    with open(path) as fh:
        return fh.read()


def _load(path):
    with open(path) as fh:
        return json.load(fh)


def _dump(obj, path, **kw):
    with open(path, 'w') as fh:
        json.dump(obj, fh, **kw)


def _write(path, text):
    with open(path, 'w') as fh:
        fh.write(text)

ap = argparse.ArgumentParser()
ap.add_argument('--db', required=True)
ap.add_argument('--port', default='54329')
ap.add_argument('--dir', required=True)
ap.add_argument('--seq', required=True)
ap.add_argument('--pre', nargs='*', default=[])
ap.add_argument('--hold', action='store_true')
ap.add_argument('--out', required=True)
a = ap.parse_args()
assert a.db.startswith('tp_'), 'use a throwaway tp_ copy'

FP = """
select md5(string_agg(x, '|' order by x)) from (
  select 'c:'||n.nspname||'.'||c.relname||':'||c.relkind::text||':'||c.relrowsecurity||':'||c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','storage','auth','backups','anum_integration','extensions','_bak')
  union all
  select 'a:'||c.oid::regclass::text||'.'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'')
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
  left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where n.nspname in ('public','storage','auth','backups','anum_integration','_bak') and a.attnum>0 and not a.attisdropped
  union all
  select 'f:'||p.oid::regprocedure::text||':'||md5(pg_get_functiondef(p.oid))||':'||coalesce(array_to_string(p.proacl,','),'')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','storage','backups','anum_integration') and p.prokind in ('f','p')
  union all
  select 'p:'||c.oid::regclass::text||'.'||pol.polname||':'||pol.polcmd::text||':'||pol.polpermissive||':'||coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||':'||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),'')||':'||pol.polroles::text
  from pg_policy pol join pg_class c on c.oid=pol.polrelid
  union all
  select 't:'||t.tgrelid::regclass::text||'.'||t.tgname||':'||t.tgenabled::text||':'||md5(pg_get_triggerdef(t.oid))
  from pg_trigger t where not t.tgisinternal
  union all
  select 'k:'||conrelid::regclass::text||'.'||conname||':'||md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in (select oid from pg_namespace where nspname in ('public','storage'))
  union all
  select 'i:'||schemaname||'.'||indexname||':'||md5(indexdef) from pg_indexes where schemaname in ('public','storage')
  union all
  select 'g:'||table_schema||'.'||table_name||':'||grantee||':'||privilege_type from information_schema.role_table_grants
  where table_schema in ('public','storage')
  union all
  select 'cfg:'||key||'='||coalesce(value::text,'') from public.system_config
) s(x)
"""

conn = psycopg2.connect(host='127.0.0.1', port=a.port, dbname=a.db, user='postgres')
conn.autocommit = False
cur = conn.cursor()
def fp():
    cur.execute(FP); return cur.fetchone()[0]

seq = _load(a.seq)
files = [s['file'] for s in seq['steps']] + ([h['file'] for h in seq['hold']] if a.hold else [])
res = {'db': a.db, 'pre': [], 'steps': [], 'ok': True}
start = fp()
res['start'] = start
for p in a.pre:
    cur.execute('savepoint pre')
    try:
        cur.execute(_read(p)); cur.execute('release savepoint pre'); conn.commit()
        res['pre'].append({'file': os.path.basename(p), 'applied': True})
    except Exception as e:
        cur.execute('rollback to savepoint pre')
        res['pre'].append({'file': os.path.basename(p), 'applied': False, 'error': str(e).splitlines()[0]})
        res['ok'] = False
for f in files:
    sql = _read(os.path.join(a.dir, f))
    before = fp()
    r = {'file': f}
    cur.execute('savepoint s')
    try:
        cur.execute(sql)
    except Exception as e:
        cur.execute('rollback to savepoint s')
        r.update(applied=False, error=str(e).splitlines()[0]); res['ok'] = False
        conn.commit(); res['steps'].append(r); print('FAIL', f, r['error'], flush=True); continue
    after = fp()
    cur.execute('rollback to savepoint s')
    back = fp()
    r.update(applied=True, changed_schema=(after != before), rollback_restores=(back == before))
    if back != before: res['ok'] = False
    cur.execute(sql)  # keep it for the next draft
    conn.commit()  # one transaction per draft: a single long transaction exhausts the lock table
    res['steps'].append(r)
    print('OK' if back == before else 'NOT RESTORED', f, 'changed' if after != before else 'no-schema-change', flush=True)
res['all_applied_fp'] = fp(); conn.rollback()
res['every_step_restores'] = all(x.get('rollback_restores') for x in res['steps'] if x.get('applied'))
_dump(res, a.out, indent=1)
print('every_step_restores', res['every_step_restores'], 'ok', res['ok'])
