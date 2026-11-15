import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createBaselineDb, createDb, applyDraft, asClient, val,
  ORG_A, ORG_B, U,
} from './fixtures/tenant_saas_harness.mjs'

// TEN-8: hard-coded Company A fallbacks (pending draft 20261113112000 on top of TEN-6 and TEN-7).
// handle_new_user, stamp_import_default_org, process_stg_wo_lines, process_expenses_import and
// material_category_for are verbatim live bodies; the other patched functions are stand-ins
// with the live signature and literal count (see the harness header).

const uid = n => `00000000-0000-0000-0000-0000000007${String(n).padStart(2, '0')}`
const signUp = (db, n, meta = {}) =>
  db.exec(`insert into auth.users(id, email, raw_user_meta_data) values ('${uid(n)}', 'new${n}@example.test', '${JSON.stringify(meta)}'::jsonb)`)
const multiTenant = db => db.exec(`update public.system_config set value = 'false' where key = 'single_tenant_mode'`)
const countA = db => val(db, `select (select count(*) from public.profiles where org_id = '${ORG_A}')
  + (select count(*) from public.vehicle_fleet where organisation_id = '${ORG_A}')
  + (select count(*) from public.work_order_line_items where organisation_id = '${ORG_A}')
  + (select count(*) from public.parts_consumption where organisation_id = '${ORG_A}')
  + (select count(*) from public.stg_probe where org = '${ORG_A}')`)

// The sessionless writes Company A relies on today, replayed on any database.
async function legacyWrites (db) {
  await signUp(db, 1, { username: 'walk_in', region: 'UAE', employee_id: 'E-77' })
  await db.exec(`
    insert into public.vehicle_fleet(country, asset_no, site) values ('KSA', 'TE-1', 'nhc-st');
    insert into public.stg_wo_lines(work_order_no, country, task, source_row) values ('GCKR/JC/1', 'KSA', 'tyre change', '1');
    insert into public.expenses_import("Country", "Work Order Number", "Item Description", "Values", "#") values ('KSA', 'GCKR/JC/1', 'TYRE 315/80', '900', '1');
    insert into public.stg_monthly_tyres(veh_no) values ('TM001');
    insert into public.material_master(organisation_id, country, item_code, category, reviewed) values ('${ORG_A}', 'KSA', 'X1', 'tyre', true);
    insert into public.profiles(id, username, role, approved) values ('${uid(90)}', 'no_org_given', 'Reporter', false);`)
  return JSON.stringify({
    profile: (await db.query(`select username, role, region, employee_id, org_id, organisation_id, country, approved from public.profiles where id = '${uid(1)}'`)).rows,
    defaulted: (await db.query(`select org_id, organisation_id from public.profiles where id = '${uid(90)}'`)).rows,
    fleet: (await db.query(`select organisation_id, site from public.vehicle_fleet where asset_no = 'TE-1'`)).rows,
    lines: (await db.query(`select organisation_id, country, work_order_no, task, source_row from public.work_order_line_items`)).rows,
    parts: (await db.query(`select organisation_id, country, work_order_no, value_amount from public.parts_consumption`)).rows,
    probe: (await db.query(`select fn, org from public.stg_probe order by fn`)).rows,
    category: await val(db, `select public.material_category_for('KSA', 'x1')`),
    showcase: await val(db, `select public.get_login_showcase()`),
    rpcs: [
      await val(db, `select public.material_master_coverage()`),
      await asClient(db, U.managerA, () => val(db, `select public.material_master_set('KSA', 'A', 'tyre')`)),
      await asClient(db, U.managerA, () => val(db, `select public.list_tyre_import_reviews()`)),
    ],
  })
}

test('single_tenant_mode on: every sessionless write resolves exactly as production does today', async () => {
  const base = await createBaselineDb()
  const before = await legacyWrites(base)
  await base.close()
  const db = await createDb(['ten6', 'ten7', 'ten8'])
  const after = await legacyWrites(db)
  assert.equal(after, before)
  assert.match(after, new RegExp(`"org_id":"${ORG_A}"`))
  assert.match(after, /"role":"Reporter"/)
  await db.close()
})

test('the Company A id is no longer hard-coded in any function; the one place left is a config row', async () => {
  const db = await createDb(['ten6', 'ten7', 'ten8'])
  assert.equal(await val(db, `select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%${ORG_A}%'`), 0)
  assert.equal(await val(db, `select value from public.system_config where key = 'legacy_config_org'`), ORG_A)
  assert.match(await val(db, `select column_default from information_schema.columns where table_name = 'profiles' and column_name = 'org_id'`),
    /_single_tenant_org\(\)/)
  assert.equal(await val(db, `select count(*)::int from public._fn_backup_ten8`), 20, 'all 20 originals kept for rollback')
  await db.close()
})

test('single_tenant_mode off: a sign-up without an invitation has no organisation and reads nothing', async () => {
  const db = await createDb(['ten6', 'ten7', 'ten8'])
  await db.exec(`insert into public.vehicle_fleet(organisation_id, country, asset_no) values ('${ORG_A}', 'KSA', 'A-KEEP')`)
  const a0 = await countA(db)
  await multiTenant(db)
  await signUp(db, 2, { username: 'tenant_b_person', employee_id: 'B-1001' })
  const p = (await db.query(`select org_id, organisation_id, role, approved from public.profiles where id = '${uid(2)}'`)).rows[0]
  assert.deepEqual(p, { org_id: null, organisation_id: null, role: 'Reporter', approved: false })
  assert.equal(await countA(db), a0, 'nothing landed in Company A')
  // even if someone approves the orphan by mistake, the org wall shows nothing
  await db.exec(`update public.profiles set approved = true where id = '${uid(2)}'`)
  assert.equal(await asClient(db, uid(2), () => val(db, `select count(*)::int from public.vehicle_fleet`)), 0)
  // Company A admins no longer see the stranger in their member list
  assert.equal(await val(db, `select count(*)::int from public.profiles where org_id = '${ORG_A}' and username = 'tenant_b_person'`), 0)
  // a profile inserted with no organisation gets none
  await db.exec(`insert into public.profiles(id, username, role) values ('${uid(91)}', 'no_default', 'Reporter')`)
  assert.equal(await val(db, `select org_id from public.profiles where id = '${uid(91)}'`), null)
  await db.close()
})

test('single_tenant_mode off: a sessionless import without tp.import_org raises PT409 and writes nothing', async () => {
  const db = await createDb(['ten6', 'ten7', 'ten8'])
  await multiTenant(db)
  const a0 = await countA(db)
  const refused = async sql => {
    await assert.rejects(db.exec(sql), e => { assert.equal(e.code, 'PT409', `${sql} -> ${e.message}`); return true })
  }
  await refused(`insert into public.vehicle_fleet(country, asset_no) values ('KSA', 'TE-X')`)
  await refused(`insert into public.stg_wo_lines(work_order_no, country, source_row) values ('RM/1', 'UAE', '1')`)
  await refused(`insert into public.expenses_import("Country", "Work Order Number", "Item Description", "Values") values ('UAE', 'RM/1', 'TYRE', '5')`)
  await refused(`insert into public.stg_monthly_tyres(veh_no) values ('TM9')`)
  await refused(`select public.material_master_coverage()`)
  await refused(`select public.reclassify_from_master(true)`)
  assert.equal(await val(db, `select public.material_category_for('KSA', 'X1')`), null, 'a lookup returns nothing, it does not raise')
  assert.equal(await countA(db), a0)
  assert.equal(await val(db, `select (select count(*) from public.vehicle_fleet) + (select count(*) from public.work_order_line_items)
    + (select count(*) from public.parts_consumption) + (select count(*) from public.stg_probe)`), 0, 'nothing written anywhere')
  await db.close()
})

test('single_tenant_mode off: a tenant B import lands in tenant B only (tp.import_org or a tenant B session)', async () => {
  const db = await createDb(['ten6', 'ten7', 'ten8'])
  await multiTenant(db)
  const a0 = await countA(db)
  // operator load with the runbook line
  await db.exec(`begin; set local tp.import_org = '${ORG_B}';
    insert into public.vehicle_fleet(country, asset_no, site) values ('UAE', 'B-TE-1', 'nhc-st');
    insert into public.stg_wo_lines(work_order_no, country, source_row) values ('RM/1', 'UAE', '1');
    insert into public.expenses_import("Country", "Work Order Number", "Item Description", "Values") values ('UAE', 'RM/1', 'TYRE', '5');
    insert into public.stg_monthly_tyres(veh_no) values ('TM9');
    commit;`)
  // a signed-in tenant B user using the staging pipes
  await asClient(db, U.adminB, () => db.exec(`insert into public.stg_wo_lines(work_order_no, country, source_row) values ('RM/2', 'UAE', '2')`))
  // a signed-in Company A user still lands in Company A
  await asClient(db, U.adminA, () => db.exec(`insert into public.stg_wo_lines(work_order_no, country, source_row) values ('GCKR/JC/9', 'KSA', '9')`))

  assert.equal(await val(db, `select count(*)::int from public.vehicle_fleet where organisation_id = '${ORG_B}'`), 1)
  assert.equal(await val(db, `select site from public.vehicle_fleet where asset_no = 'B-TE-1'`), 'NHC-ST',
    'tenant B rules, not Company A aliases, for an operator load into tenant B')
  assert.equal(await val(db, `select count(*)::int from public.work_order_line_items where organisation_id = '${ORG_B}'`), 2)
  assert.equal(await val(db, `select count(*)::int from public.parts_consumption where organisation_id = '${ORG_B}'`), 1)
  assert.equal(await val(db, `select org from public.stg_probe where fn = 'process_stg_monthly_tyres'`), ORG_B)
  assert.equal(await countA(db), Number(a0) + 1, 'only the Company A session row reached Company A')
  assert.equal(await val(db, `select organisation_id from public.work_order_line_items where work_order_no = 'GCKR/JC/9'`), ORG_A)

  await assert.rejects(db.exec(`begin; set local tp.import_org = 'not-a-uuid'; insert into public.stg_wo_lines(work_order_no) values ('Z'); commit;`),
    e => e.code === 'PT409')
  await db.exec('rollback').catch(() => {})
  await assert.rejects(db.exec(`begin; set local tp.import_org = '00000000-0000-0000-0000-00000000dead'; insert into public.stg_wo_lines(work_order_no) values ('Z'); commit;`),
    e => e.code === 'PT409')
  await db.exec('rollback').catch(() => {})
  await db.close()
})

test('grants and guards', async () => {
  const db = await createDb(['ten6', 'ten7', 'ten8'])
  const priv = (role, fn) => val(db, `select has_function_privilege('${role}', '${fn}', 'execute')`)
  assert.equal(await priv('authenticated', 'public._signup_context(uuid,jsonb,text)'), false)
  assert.equal(await priv('anon', 'public._signup_context(uuid,jsonb,text)'), false)
  assert.equal(await priv('anon', 'public._resolve_import_org()'), false)
  assert.equal(await priv('authenticated', 'public._resolve_import_org()'), true, 'the invoker stamping trigger needs it')
  await db.close()

  // a function that gained a second copy of the literal aborts the whole migration
  const drift = await createBaselineDb({
    mutateBaseline: s => s.replace("insert into public.stg_probe values ('process_daily_km', v_org);",
      `insert into public.stg_probe values ('process_daily_km', coalesce(v_org, '${ORG_A}'::uuid));`),
  })
  await applyDraft(drift, 'ten6'); await applyDraft(drift, 'ten7')
  await assert.rejects(applyDraft(drift, 'ten8'), /anchor found 2 time\(s\) in process_daily_km/)
  assert.equal(await val(drift, `select to_regprocedure('public._resolve_import_org()') is null`), true)
  assert.match(await val(drift, `select pg_get_functiondef('public.handle_new_user()'::regprocedure)`), new RegExp(ORG_A), 'untouched')
  await drift.close()

  // a NEW function carrying the literal (added after the audit) is caught by the final guard
  const added = await createBaselineDb({
    mutateBaseline: s => s + `\ncreate function public.late_addition() returns uuid language sql as $$ select '${ORG_A}'::uuid $$;`,
  })
  await applyDraft(added, 'ten6'); await applyDraft(added, 'ten7')
  await assert.rejects(applyDraft(added, 'ten8'), /still hard-coded in: late_addition\(\)/)
  await added.close()
})
