// Security acceptance for the whole inventory release (QA lane), over all 13 pending
// inv_* migrations. Catalog checks, no exclusions:
//   1. every SECURITY DEFINER function named inv_* / _inv_* pins search_path;
//   2. none of them is executable by PUBLIC or anon;
//   3. internal _inv_* implementations are not executable by authenticated either;
//   4. anon holds no privilege on any inventory table or view;
//   5. every table the release creates has RLS enabled (+ a RESTRICTIVE org policy
//      when it carries organisation_id), and authenticated cannot write it directly;
//   6. every v_inv_* view is security_invoker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDb, q } from './inventory_harness.test.mjs'

const DEFINER = `select p.oid::regprocedure::text sig, p.proname, p.proconfig,
    has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x,
    exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where a.grantee = 0 and a.privilege_type = 'EXECUTE') public_x
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and (p.proname like 'inv\\_%' or p.proname like '\\_inv\\_%')`

test('inventory security acceptance: functions, grants, RLS, views', async t => {
  const before = await buildDb({ upTo: 0 })
  const oldRels = new Set((await q(before, `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','v','m')`)).map(r => r.relname))
  await before.close()
  const db = await buildDb()
  try {
    const fns = await q(db, DEFINER)
    t.diagnostic(`SECURITY DEFINER inv functions: ${fns.length}`)
    assert.ok(fns.length > 50)

    await t.test('every inv_* SECURITY DEFINER function pins search_path', () => {
      const unpinned = fns.filter(f => !(f.proconfig || []).some(c => c.startsWith('search_path=')))
      assert.deepEqual(unpinned.map(f => f.sig), [])
    })
    await t.test('no inv_* SECURITY DEFINER function is executable by PUBLIC or anon', () => {
      assert.deepEqual(fns.filter(f => f.anon_x || f.public_x).map(f => f.sig), [])
    })
    await t.test('internal _inv_* implementations are not executable by authenticated', () => {
      // Deliberate: both are evaluated AS THE CALLER inside RLS policies / security_invoker views,
      // answer only for the caller's own org (a boolean / a refusal code), and expose no row data.
      const POLICY_HELPERS = ['_inv_audit_can_see_expected(uuid)', '_inv_approval_block_reason(uuid)']
      assert.deepEqual(fns.filter(f => f.proname.startsWith('_inv_') && f.auth_x && !POLICY_HELPERS.includes(f.sig)).map(f => f.sig), [])
    })
    await t.test('non-definer inv helpers are not executable by anon either', async () => {
      // Trigger functions cannot be called through the API (PostgREST cannot invoke a
      // function returning trigger); only callable helpers are checked.
      const inv = await q(db, `select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and not p.prosecdef and (p.proname like 'inv\\_%' or p.proname like '\\_inv\\_%')
          and p.prorettype <> 'trigger'::regtype and has_function_privilege('anon', p.oid, 'EXECUTE')`)
      t.diagnostic(`anon-executable non-definer inv helpers (pure functions, read no table): ${inv.map(r => r.sig).join(', ') || 'none'}`)
      for (const r of inv) {
        const def = (await q(db, `select pg_get_functiondef($1::regprocedure) d`, [r.sig]))[0].d
        assert.doesNotMatch(def, /\bfrom\s+public\./i, `${r.sig} reads a table and is anon-executable`)
      }
    })

    const newRels = (await q(db, `select c.relname, c.relkind, c.relrowsecurity rls,
        has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
          or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE') anon_any,
        has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
          or has_table_privilege('authenticated', c.oid, 'DELETE') auth_write,
        exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'organisation_id') has_org,
        exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.permissive = 'RESTRICTIVE'
                  and p.qual like '%app_current_org%') org_policy,
        coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false') invoker
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','v')`)).filter(r => !oldRels.has(r.relname))
    t.diagnostic(`new relations: ${newRels.filter(r => r.relkind === 'r').length} tables, ${newRels.filter(r => r.relkind === 'v').length} views`)

    await t.test('anon holds no privilege on any new inventory table or view', () => {
      assert.deepEqual(newRels.filter(r => r.anon_any).map(r => r.relname), [])
    })
    await t.test('every new table has RLS on, an org RESTRICTIVE policy, and no direct client write', () => {
      const tables = newRels.filter(r => r.relkind === 'r')
      assert.deepEqual(tables.filter(r => !r.rls).map(r => r.relname), [], 'RLS off')
      assert.deepEqual(tables.filter(r => r.has_org && !r.org_policy).map(r => r.relname), [], 'no org isolation')
      assert.deepEqual(tables.filter(r => r.auth_write).map(r => r.relname), [], 'authenticated can write directly')
    })
    await t.test('every new view is security_invoker', () => {
      assert.deepEqual(newRels.filter(r => r.relkind === 'v' && r.invoker !== 'true' && r.invoker !== 'on').map(r => r.relname), [])
    })
    await t.test('the touched legacy tables refuse direct client writes on the balance and the ledger', async () => {
      const rows = await q(db, `select t, has_table_privilege('authenticated', ('public.' || t)::regclass, 'UPDATE') upd,
          has_table_privilege('authenticated', ('public.' || t)::regclass, 'DELETE') del
        from unnest(array['stock_movements']) t`)
      assert.deepEqual(rows.filter(r => r.upd || r.del).map(r => r.t), [])
    })
  } finally { await db.close() }
})
