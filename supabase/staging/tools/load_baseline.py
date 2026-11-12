#!/usr/bin/env python3
"""Load the baseline SQL files statement by statement and report honestly.

Each statement runs in its own transaction. A statement that fails is retried after everything else
(an object it depends on may simply come later); rounds repeat until nothing more succeeds. What still
fails at the end is listed with its error. Exit code 1 if anything is left unresolved.

Usage: load_baseline.py --dsn "<libpq dsn>" --baseline <dir> [--report out.json] [--only 03_functions.sql]
Works against the local stand-in cluster and against a hosted Supabase project (use its DIRECT
connection string for the postgres role; never a production one).
"""
import argparse, glob, json, os, re, sys, time
import psycopg2

ap = argparse.ArgumentParser()
ap.add_argument('--dsn', required=True)
ap.add_argument('--baseline', required=True)
ap.add_argument('--report')
ap.add_argument('--only', action='append')
a = ap.parse_args()
if 'jhssdmeruxtrlqnwfksc' in a.dsn:
    sys.exit('Refusing: that is the production project.')

conn = psycopg2.connect(a.dsn)
conn.autocommit = True
cur = conn.cursor()
cur.execute("set check_function_bodies = off; set client_min_messages = warning; set search_path = \"$user\", public, extensions")

def key(stmt):
    m = re.match(r'\s*CREATE OR REPLACE (?:FUNCTION|PROCEDURE) ([^\n]+)', stmt)
    return (m.group(1) if m else stmt.split('\n')[0])[:160]

files = sorted(glob.glob(os.path.join(a.baseline, '[0-9][0-9]_*.sql')))
if a.only:
    files = [f for f in files if os.path.basename(f) in a.only]
pending, ok, first_fail = [], 0, []
t0 = time.time()
per_file = {}
for f in files:
    stmts = [s.strip() for s in open(f).read().split('\n-- @@\n')]
    stmts = [s for s in stmts if s and not all(l.startswith('--') or not l.strip() for l in s.split('\n'))]
    n_ok = 0
    for s in stmts:
        try:
            cur.execute(s); ok += 1; n_ok += 1
        except Exception as e:
            pending.append((os.path.basename(f), s, str(e).strip().split('\n')[0]))
            first_fail.append((os.path.basename(f), key(s), str(e).strip().split('\n')[0]))
    per_file[os.path.basename(f)] = {'statements': len(stmts), 'ok_first_pass': n_ok}
rounds = 0
resolved_late = []
while pending:
    rounds += 1
    still = []
    for f, s, err in pending:
        try:
            cur.execute(s); ok += 1; resolved_late.append((f, key(s)))
        except Exception as e:
            still.append((f, s, str(e).strip().split('\n')[0]))
    if len(still) == len(pending):
        pending = still
        break
    pending = still
report = {'seconds': round(time.time() - t0, 1), 'statements_ok': ok, 'retry_rounds': rounds,
          'per_file': per_file,
          'resolved_on_retry': [{'file': f, 'statement': k} for f, k in resolved_late],
          'first_pass_failures': [{'file': f, 'statement': k, 'error': e} for f, k, e in first_fail],
          'unresolved': [{'file': f, 'statement': key(s), 'error': e} for f, s, e in pending]}
if a.report:
    json.dump(report, open(a.report, 'w'), indent=1)
print('baseline load: %d statements ok, %d resolved on retry, %d UNRESOLVED, %.0fs'
      % (ok, len(resolved_late), len(pending), time.time() - t0))
for f, s, e in pending[:15]:
    print('  UNRESOLVED [%s] %s :: %s' % (f, key(s), e))
sys.exit(1 if pending else 0)
