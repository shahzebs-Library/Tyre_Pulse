"""Build a sanitized, production-equivalent PG17 snapshot script from read-only
catalog/data extracts of production (jhssdmeruxtrlqnwfksc, 2026-11-20).

Outputs:
  snap_schema_pre.sql   roles-independent DB objects before data (schemas, types, tables, functions, views)
  snap_data.sql         sanitized data (COPY-free INSERTs, triggers off via session_replication_role)
  snap_schema_post.sql  RLS, policies, triggers, grants, owners, default privileges
  snap_manifest.json    what was included / stubbed / skipped
"""
import json, re, sys
sys.path.insert(0, '.')
from mcpjson import load

T = load('prod_tables.raw')
F = load('prod_functions.raw')
D = {r['t']: r['d'] for r in load('prod_data.raw')}

SEED = set('''approval_policies custom_roles goods_receipts material_issue_lines material_issues material_master materials
metric_registry metric_versions organisations parts_consumption profiles purchase_orders report_schedules requisitions sites
stock stock_entry_requests stock_movements stock_records suppliers tyre_records tyre_status_marks
work_order_stock_reservation_lines work_order_stock_reservations work_orders workflow_instances v_stock_balance_reconcile'''.split())
INSET = {f"{r['sch']}.{r['rel']}" for r in T}
manifest = {'tables': [], 'support_tables': [], 'skipped_fks': [], 'skipped_triggers': [], 'stubs': [], 'functions': len(F)}

PRIV = {'a': 'INSERT', 'r': 'SELECT', 'w': 'UPDATE', 'd': 'DELETE', 'D': 'TRUNCATE', 'x': 'REFERENCES',
        't': 'TRIGGER', 'm': 'MAINTAIN', 'X': 'EXECUTE', 'U': 'USAGE', 'C': 'CREATE'}
ROLES = ['public', 'anon', 'authenticated', 'service_role', 'postgres', 'authenticator', 'dashboard_user',
         'supabase_auth_admin', 'supabase_read_only_user']


def q(n):
    return '"' + n.replace('"', '""') + '"'


def acl_sql(kind, obj, acl, cols=None):
    """kind: TABLE|FUNCTION|SEQUENCE; returns revoke + grants reproducing acl text."""
    if acl is None:
        return []
    out = [f"REVOKE ALL ON {kind} {obj} FROM {', '.join('PUBLIC' if r == 'public' else r for r in ROLES)};"]
    for item in acl.strip('{}').split(','):
        if not item:
            continue
        item = item.strip('"')
        grantee, rest = item.split('=', 1)
        privs = rest.split('/')[0]
        grantee = 'PUBLIC' if grantee == '' else grantee
        i = 0
        plain, withopt = [], []
        while i < len(privs):
            p = PRIV[privs[i]]
            if i + 1 < len(privs) and privs[i + 1] == '*':
                withopt.append(p); i += 2
            else:
                plain.append(p); i += 1
        if plain:
            out.append(f"GRANT {', '.join(plain)} ON {kind} {obj} TO {grantee};")
        if withopt:
            out.append(f"GRANT {', '.join(withopt)} ON {kind} {obj} TO {grantee} WITH GRANT OPTION;")
    return out


def lit(v):
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v).replace("'", "''") + "'"
    return "'" + str(v).replace("'", "''") + "'"


pre, post, data = [], [], []
pre.append("SET check_function_bodies = off;\nSET client_min_messages = warning;")
pre.append("""
CREATE SCHEMA IF NOT EXISTS extensions; CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS approval_private; CREATE SCHEMA IF NOT EXISTS anum_integration; CREATE SCHEMA IF NOT EXISTS _bak;
CREATE SCHEMA IF NOT EXISTS graphql; CREATE SCHEMA IF NOT EXISTS vault; CREATE SCHEMA IF NOT EXISTS pgmq; CREATE SCHEMA IF NOT EXISTS cron; CREATE SCHEMA IF NOT EXISTS net;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
DO $$ BEGIN CREATE TYPE auth.factor_type AS ENUM ('totp','webauthn','phone'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE auth.factor_status AS ENUM ('unverified','verified'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER SCHEMA auth OWNER TO supabase_admin; ALTER SCHEMA extensions OWNER TO postgres; ALTER SCHEMA private OWNER TO postgres;
ALTER SCHEMA approval_private OWNER TO postgres; ALTER SCHEMA anum_integration OWNER TO postgres; ALTER SCHEMA _bak OWNER TO postgres;
ALTER SCHEMA public OWNER TO pg_database_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO PUBLIC, postgres, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role; GRANT USAGE, CREATE ON SCHEMA extensions TO dashboard_user;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, postgres; GRANT USAGE, CREATE ON SCHEMA auth TO supabase_auth_admin, dashboard_user;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
GRANT USAGE ON SCHEMA anum_integration TO anon, authenticated, service_role;
REVOKE ALL ON SCHEMA approval_private FROM PUBLIC; REVOKE ALL ON SCHEMA _bak FROM PUBLIC;
""")
manifest['stubs'] += ['extension schemas graphql/vault/pgmq/cron/net created empty (pg_graphql, supabase_vault, pgmq, pg_cron, pg_net not installable in this PG build; no migration references them)',
                      'extensions vector, hypopg, index_advisor, wrappers not installed (no rehearsed object uses them)',
                      'auth.factor_type / auth.factor_status enums recreated with Supabase GoTrue values']

# functions: phase A (no table row types in signature) / phase B
def fn_needs_table(f):
    sig = f['args'] + ' ' + f['def'].split('RETURNS', 1)[1].split('\n', 1)[0] if 'RETURNS' in f['def'] else f['args']
    for t in T:
        if re.search(r'\b' + re.escape(t['rel']) + r'\b', sig) and t['rel'] not in ('users',):
            return True
    return False


phaseA = [f for f in F if not fn_needs_table(f)]
phaseB = [f for f in F if fn_needs_table(f)]

for f in phaseA:
    pre.append(f['def'].rstrip() + ';')

# tables
for r in T:
    full = f"{q(r['sch'])}.{q(r['rel'])}"
    if r['kind'] == 'v':
        continue
    cols = []
    for c in r['cols']:
        s = f"{q(c['n'])} {c['t']}"
        if c['coll']:
            s += f' COLLATE {q(c["coll"])}'
        if c['gen'] == 's':
            s += f" GENERATED ALWAYS AS ({c['def']}) STORED"
        elif c['ident'] in ('a', 'd'):
            s += ' GENERATED ' + ('ALWAYS' if c['ident'] == 'a' else 'BY DEFAULT') + ' AS IDENTITY'
        if c['nn']:
            s += ' NOT NULL'
        cols.append(s)
    pre.append(f"CREATE TABLE {full} (\n  " + ',\n  '.join(cols) + '\n);')
    for c in r['cols']:
        if c['def'] is not None and c['gen'] != 's':
            post.append(f"ALTER TABLE {full} ALTER COLUMN {q(c['n'])} SET DEFAULT {c['def']};")
    (manifest['tables'] if r['rel'] in SEED else manifest['support_tables']).append(f"{r['sch']}.{r['rel']}")

for f in phaseB:
    pre.append(f['def'].rstrip() + ';')

# views
for r in T:
    if r['kind'] == 'v':
        pre.append(f"CREATE VIEW {q(r['sch'])}.{q(r['rel'])} AS {r['viewdef'].rstrip().rstrip(';')};")

# constraints/indexes go in pre-data-late (before data so unique constraints hold), FKs after data
cons_pre, cons_fk = [], []
for r in T:
    full = f"{q(r['sch'])}.{q(r['rel'])}"
    for c in (r['cons'] or []):
        if c['type'] == 'n':
            continue
        if c['type'] == 'f':
            ref = c['ref'] if '.' in c['ref'] else 'public.' + c['ref']
            if ref.replace('"', '') not in INSET:
                manifest['skipped_fks'].append(f"{r['sch']}.{r['rel']}.{c['n']} -> {ref}")
                continue
            cons_fk.append(f"ALTER TABLE {full} ADD CONSTRAINT {q(c['n'])} {c['def']} NOT VALID;")
            cons_fk.append(f"ALTER TABLE {full} VALIDATE CONSTRAINT {q(c['n'])};")
        else:
            cons_pre.append(f"ALTER TABLE {full} ADD CONSTRAINT {q(c['n'])} {c['def']};")
    for i in (r['idx'] or []):
        cons_pre.append(i + ';')

# data
SKIP_DATA = {'counts'}
tbl_by_name = {r['rel']: r for r in T}
users = []
for name, rows in D.items():
    if name in SKIP_DATA or not rows:
        continue
    t = tbl_by_name[name]
    gen = {c['n'] for c in t['cols'] if c['gen'] == 's' or c['ident'] == 'a'}
    colnames = [c['n'] for c in t['cols'] if c['n'] not in gen]
    if name == 'system_config':
        rows = [x for x in rows if not re.search(r'(sk_|eyJ|re_[A-Za-z0-9]{8}|@)', json.dumps(x.get('value')) + str(x.get('value_text')))]
    cl = ', '.join(q(c) for c in colnames)
    for row in rows:
        data.append(f"INSERT INTO public.{q(name)} ({cl}) " + ("OVERRIDING SYSTEM VALUE " if any(c['ident'] == 'd' for c in t['cols']) else "") + f"SELECT {cl} FROM jsonb_populate_record(NULL::public.{q(name)}, {lit(row)}::jsonb);")
    if name == 'profiles':
        users = [p['id'] for p in rows]
for u in users:
    data.append(f"INSERT INTO auth.users (id, aud, role, email, created_at, updated_at, is_sso_user, is_anonymous) VALUES ('{u}','authenticated','authenticated','u{u[:10]}@example.invalid', now(), now(), false, false);")
manifest['data_rows'] = {k: (len(v) if isinstance(v, list) else 0) for k, v in D.items() if k != 'counts'}
manifest['prod_counts'] = D['counts']

# post: rls, policies, triggers, grants, owners
for r in T:
    full = f"{q(r['sch'])}.{q(r['rel'])}"
    if r['kind'] != 'v':
        if r['rls']:
            post.append(f"ALTER TABLE {full} ENABLE ROW LEVEL SECURITY;")
        if r['force_rls']:
            post.append(f"ALTER TABLE {full} FORCE ROW LEVEL SECURITY;")
    for p in (r['pols'] or []):
        cmd = {'r': 'SELECT', 'a': 'INSERT', 'w': 'UPDATE', 'd': 'DELETE', '*': 'ALL'}[p['cmd']]
        s = f"CREATE POLICY {q(p['n'])} ON {full} AS {'PERMISSIVE' if p['perm'] else 'RESTRICTIVE'} FOR {cmd} TO {', '.join(p['roles'])}"
        if p['using'] is not None:
            s += f" USING ({p['using']})"
        if p['check'] is not None:
            s += f" WITH CHECK ({p['check']})"
        post.append(f"DO $p$ BEGIN EXECUTE {lit(s)}; EXCEPTION WHEN others THEN RAISE WARNING 'SKIPPED POLICY {r['rel']}.{p['n']}: %', SQLERRM; END $p$;")
    for tg in (r['trgs'] or []):
        if r['rel'] in SEED:
            post.append(tg['def'] + ';')
            if tg['enabled'] == 'D':
                post.append(f"ALTER TABLE {full} DISABLE TRIGGER {q(tg['n'])};")
        else:
            manifest['skipped_triggers'].append(f"{r['rel']}.{tg['n']}")
    post.append(f"ALTER {'VIEW' if r['kind']=='v' else 'TABLE'} {full} OWNER TO {r['owner']};")
    post += acl_sql('TABLE', full, r['acl'])
    for c in r['cols']:
        if c['acl']:
            for item in c['acl'].strip('{}').split(','):
                g, rest = item.split('=', 1)
                privs = ','.join(PRIV[ch] for ch in rest.split('/')[0] if ch != '*')
                post.append(f"GRANT {privs} ({q(c['n'])}) ON {full} TO {'PUBLIC' if g=='' else g};")

for f in F:
    sch, name = f['fn'].split('.', 1)
    sig = f"{q(sch)}.{q(name)}({f['args']})"
    post.append(f"ALTER FUNCTION {sig} OWNER TO {f['owner']};")
    if f['acl'] is None:
        post.append(f"GRANT EXECUTE ON FUNCTION {sig} TO PUBLIC;")  # NULL acl = default (PUBLIC execute)
    else:
        post += acl_sql('FUNCTION', sig, f['acl'])

post.append("""
-- production default privileges (read 2026-11-20)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT INSERT, SELECT, UPDATE, REFERENCES, MAINTAIN ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO postgres, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
""")

open('snap_schema_pre.sql', 'w').write('\n'.join(pre) + '\n' + '\n'.join(cons_pre) + '\n')
open('snap_data.sql', 'w').write("SET session_replication_role = replica;\n" + '\n'.join(data) + "\nSET session_replication_role = origin;\n")
open('snap_schema_post.sql', 'w').write('SET check_function_bodies = off;\n' + '\n'.join(cons_fk) + '\n' + '\n'.join(post) + '\n')
json.dump(manifest, open('snap_manifest.json', 'w'), indent=1)
print('A', len(phaseA), 'B', len(phaseB), 'fks', len(cons_fk) // 2, 'skippedfk', len(manifest['skipped_fks']), 'data', len(data))
