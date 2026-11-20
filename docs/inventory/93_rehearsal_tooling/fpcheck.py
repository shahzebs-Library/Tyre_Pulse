"""Compare function fingerprints of a local DB against the production read."""
import json, subprocess, sys
sys.path.insert(0, '.')
from mcpjson import load

db = sys.argv[1]
F = load('prod_functions.raw')
sql = """select n.nspname||'.'||p.proname, pg_get_function_identity_arguments(p.oid), md5(replace(p.prosrc,chr(13),'')),
 md5(replace(pg_get_functiondef(p.oid),chr(13),'')), pg_get_userbyid(p.proowner), coalesce(p.proacl::text,'NULL')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','approval_private','anum_integration','auth') and p.prokind in ('f','p')"""
out = subprocess.run(['psql', '-h', 'localhost', '-p', '54417', '-U', 'supabase_admin', '-d', db, '-AtF', '\t', '-c', sql],
                     capture_output=True, text=True, check=True).stdout
loc = {}
for line in out.splitlines():
    a = line.split('\t')
    loc[(a[0], a[1])] = a[2:]
ok = bad = 0
mism = []
for f in F:
    k = (f['fn'], f['args'])
    l = loc.get(k)
    if l and l[0] == f['prosrc_md5'] and l[1] == f['def_md5'] and l[2] == f['owner']:
        ok += 1
    else:
        bad += 1
        mism.append((k, l and l[:3], f['prosrc_md5'], f['def_md5']))
print(json.dumps({'db': db, 'match': ok, 'mismatch': bad, 'details': mism[:20]}, indent=1))
watch = ['public.post_stock_movement', 'public.set_stock_count', 'public.save_stock_entry', 'public.transfer_stock_entry',
         'public.reserve_work_order_stock', 'public.release_work_order_stock', 'private.reserve_work_order_stock_internal',
         'private.release_work_order_stock_internal', 'approval_private.validate_policy']
for f in F:
    if f['fn'] in watch:
        l = loc.get((f['fn'], f['args']))
        print(f['fn'], 'prod_def', f['def_md5'][:8], 'local_def', l and l[1][:8], 'prod_src', f['prosrc_md5'][:8])
