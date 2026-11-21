"""Compare relation structure of a local DB against the production read (columns, constraints, indexes, policies, triggers, ACL)."""
import json, subprocess, sys
sys.path.insert(0, '.')
from mcpjson import load

db = sys.argv[1]
T = load('prod_tables.raw')
names = ' '.join(f"{r['sch']}.{r['rel']}" for r in T)
sql = f"""with t(sch,rel) as (select split_part(x,'.',1), split_part(x,'.',2) from unnest(string_to_array('{names}',' ')) x),
c as (select c.oid, t.sch, t.rel, c.relacl::text acl from t join pg_namespace n on n.nspname=t.sch join pg_class c on c.relnamespace=n.oid and c.relname=t.rel)
select json_agg(json_build_object('k', c.sch||'.'||c.rel, 'acl', c.acl,
 'cols',(select json_agg(json_build_object('n',a.attname,'t',format_type(a.atttypid,a.atttypmod),'nn',a.attnotnull,'def',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'cons',(select json_agg(json_build_object('n',co.conname,'def',pg_get_constraintdef(co.oid)) order by co.conname) from pg_constraint co where co.conrelid=c.oid and co.contype<>'n'),
 'idx',(select json_agg(pg_get_indexdef(i.indexrelid) order by 1) from pg_index i where i.indrelid=c.oid and not exists (select 1 from pg_constraint co where co.conindid=i.indexrelid)),
 'pols',(select json_agg(json_build_object('n',p.polname,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
 'trgs',(select json_agg(pg_get_triggerdef(tg.oid) order by tg.tgname) from pg_trigger tg where tg.tgrelid=c.oid and not tg.tgisinternal))) from c"""
out = subprocess.run(['psql', '-h', 'localhost', '-p', '54417', '-U', 'supabase_admin', '-d', db, '-Atc', sql],
                     capture_output=True, text=True, check=True).stdout
L = {r['k']: r for r in json.loads(out)}
res = {}
for r in T:
    k = f"{r['sch']}.{r['rel']}"
    l = L.get(k)
    d = []
    if not l:
        res[k] = ['MISSING']; continue
    pc = [(c['n'], c['t'], c['nn'], c['def']) for c in r['cols']]
    lc = [(c['n'], c['t'], c['nn'], c['def']) for c in l['cols']]
    if pc != lc: d.append('cols')
    pcons = sorted((c['n'], c['def']) for c in (r['cons'] or []) if c['type'] != 'n')
    lcons = sorted((c['n'], c['def']) for c in (l['cons'] or []))
    if pcons != lcons: d.append(f'cons({len(set(pcons) ^ set(lcons))})')
    if sorted(r['idx'] or []) != sorted(l['idx'] or []): d.append('idx')
    pp = sorted((p['n'], p['using'], p['check']) for p in (r['pols'] or []))
    lp = sorted((p['n'], p['using'], p['check']) for p in (l['pols'] or []))
    if pp != lp: d.append(f'pols({len(set(pp) ^ set(lp))})')
    pt = sorted(t['def'] for t in (r['trgs'] or []))
    lt = sorted(l['trgs'] or [])
    if pt != lt: d.append(f'trgs({len(set(pt) ^ set(lt))})')
    if d: res[k] = d
print(json.dumps({'db': db, 'relations': len(T), 'identical': len(T) - len(res), 'differences': res}, indent=1))
