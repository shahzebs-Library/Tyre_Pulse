// CUR-1: Managers and Directors create and edit work orders by default.
// Runs the draft supabase/pending_migrations/20261113130000_cur_work_orders_manager_director_default.sql
// against a byte-exact copy of the LIVE app_user_can() and the LIVE work_orders write policies.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const liveFns = await readFile(new URL('./fixtures/current_prod_live_functions.sql', import.meta.url), 'utf8');
const migration = await readFile(
  new URL('../pending_migrations/20261113130000_cur_work_orders_manager_director_default.sql', import.meta.url), 'utf8');

const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const ORG_A = uuid(1);      // explicit Manager work_orders false in the stored matrix (Company A shape)
const ORG_B = uuid(2);      // no matrix at all (organisation a50e2d87 shape)
const ORG_C = uuid(3);      // an Admin deliberately keeps Manager off after the migration
const U = {
  admin: uuid(10), mgrA: uuid(11), mgrA2: uuid(12), mgrB: uuid(13), director: uuid(14), tyreMan: uuid(15),
  collector: uuid(16), revokedMgr: uuid(17), mgrC: uuid(18), lockedMgr: uuid(19),
};

// The matrix exactly as production stores it: a JSON STRING inside jsonb, wrapped in { overrides }.
const matrix = (roles) => JSON.stringify({ version: 1, overrides: roles });
const MATRIX_A = matrix({
  Manager: { work_orders: { edit: false, create: false, export: false, approve: false }, budgets: { edit: false, create: false } },
  'Tyre Man': { work_orders: { edit: false, create: false } },
  'Tyre Data Collector': { work_orders: { edit: true, create: true } },
});

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth; CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor', true), '')::uuid $$;
    CREATE TABLE public.organisations(id uuid PRIMARY KEY, name text, settings jsonb DEFAULT '{}'::jsonb);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, org_id uuid, role text, approved boolean DEFAULT true,
      locked boolean DEFAULT false, is_super_admin boolean DEFAULT false);
    CREATE TABLE public.module_permissions(org_id uuid, role text, module_key text, enabled boolean, updated_at timestamptz DEFAULT now());
    CREATE TABLE public.user_access_grants(user_id uuid, module_key text, capability text, effect text, expires_at timestamptz);
    CREATE FUNCTION public.app_current_org() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
      AS $$ SELECT org_id FROM public.profiles WHERE id = auth.uid() $$;
    CREATE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
      AS $$ SELECT coalesce((SELECT is_super_admin FROM public.profiles WHERE id = auth.uid() AND NOT locked), false) $$;
    CREATE FUNCTION public.app_can_admin_delete() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
      AS $$ SELECT coalesce((SELECT p.is_super_admin IS TRUE OR lower(btrim(coalesce(p.role,''))) = 'admin'
                               FROM public.profiles p WHERE p.id = auth.uid() AND p.locked IS FALSE AND coalesce(p.approved, true) IS TRUE), false) $$;
    CREATE TABLE public.work_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organisation_id uuid, work_order_no text,
      asset_no text, status text DEFAULT 'New', priority text);
    INSERT INTO public.organisations(id, name, settings) VALUES
      ('${ORG_A}', 'A', jsonb_build_object('app_settings', jsonb_build_object('permission_overrides', '${MATRIX_A}'::text, 'currency', 'SAR'))),
      ('${ORG_B}', 'B', '{}'::jsonb),
      ('${ORG_C}', 'C', '{}'::jsonb);
    INSERT INTO public.profiles(id, org_id, role, is_super_admin, locked) VALUES
      ('${U.admin}', '${ORG_A}', 'Admin', true, false),
      ('${U.mgrA}', '${ORG_A}', 'Manager', false, false),
      ('${U.mgrA2}', '${ORG_A}', 'Manager', false, false),
      ('${U.revokedMgr}', '${ORG_A}', 'Manager', false, false),
      ('${U.lockedMgr}', '${ORG_A}', 'Manager', false, true),
      ('${U.director}', '${ORG_A}', 'Director', false, false),
      ('${U.tyreMan}', '${ORG_A}', 'Tyre Man', false, false),
      ('${U.collector}', '${ORG_A}', 'Tyre Data Collector', false, false),
      ('${U.mgrB}', '${ORG_B}', 'Manager', false, false),
      ('${U.mgrC}', '${ORG_C}', 'Manager', false, false);
    INSERT INTO public.user_access_grants VALUES
      ('${U.revokedMgr}', 'work_orders', 'create', 'revoke', null),
      ('${U.revokedMgr}', 'work_orders', 'edit', 'revoke', null);
    INSERT INTO public.work_orders(id, organisation_id, work_order_no, asset_no) VALUES
      ('${uuid(100)}', '${ORG_A}', 'WO-A-1', 'TM001'), ('${uuid(200)}', '${ORG_B}', 'WO-B-1', 'TM002'),
      ('${uuid(300)}', '${ORG_C}', 'WO-C-1', 'TM003');
  `);
  await db.exec(liveFns);
  // LIVE work_orders write policies (pg_policies, 2026-11-12), unchanged by the draft.
  await db.exec(`
    ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
    CREATE POLICY work_orders_org_isolation ON public.work_orders AS RESTRICTIVE FOR ALL TO authenticated
      USING ((organisation_id = (SELECT public.app_current_org())) OR (SELECT public.is_super_admin()))
      WITH CHECK ((organisation_id = (SELECT public.app_current_org())) OR (SELECT public.is_super_admin()));
    CREATE POLICY work_orders_read ON public.work_orders FOR SELECT TO authenticated USING (true);
    CREATE POLICY work_orders_cap_insert ON public.work_orders FOR INSERT TO authenticated
      WITH CHECK (public.app_user_can('work_orders'::text, 'create'::text));
    CREATE POLICY work_orders_cap_update ON public.work_orders FOR UPDATE TO authenticated
      USING (public.app_user_can('work_orders'::text, 'edit'::text)) WITH CHECK (public.app_user_can('work_orders'::text, 'edit'::text));
    CREATE POLICY work_orders_cap_delete ON public.work_orders FOR DELETE TO authenticated
      USING (public.app_user_can('work_orders'::text, 'delete'::text));
    CREATE POLICY admin_only_delete_guard ON public.work_orders AS RESTRICTIVE FOR DELETE TO authenticated
      USING (public.app_can_admin_delete());
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_orders TO authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated;
  `);
  return db;
}

const as = (db, id) => db.exec(`RESET ROLE; SET test.actor = '${id}'; SET ROLE authenticated;`);
const root = (db) => db.exec(`RESET ROLE; SET test.actor = '';`);
const can = async (db, id, cap, key = 'work_orders') => {
  await as(db, id);
  return (await db.query(`SELECT public.app_user_can('${key}', '${cap}') AS ok`)).rows[0].ok;
};
const insertJob = async (db, id, org, no) => {
  await as(db, id);
  return db.query(`INSERT INTO public.work_orders(organisation_id, work_order_no, asset_no) VALUES ('${org}', '${no}', 'TM9') RETURNING id`);
};
const updateJob = async (db, id, jobId) => {
  await as(db, id);
  return (await db.query(`UPDATE public.work_orders SET status = 'In Progress' WHERE id = '${jobId}' RETURNING id`)).rows.length;
};

test('BEFORE the draft: the live rule refuses every Manager (the production defect)', async () => {
  const db = await setup();
  try {
    for (const m of [U.mgrA, U.mgrB]) {
      assert.equal(await can(db, m, 'create'), false);
      assert.equal(await can(db, m, 'edit'), false);
    }
    await assert.rejects(insertJob(db, U.mgrA, ORG_A, 'WO-A-2'), /row-level security/);
    // The silent half: an update by a Manager changes ZERO rows and raises nothing.
    assert.equal(await updateJob(db, U.mgrA, uuid(100)), 0);
    // Admin and the roles the matrix switched on already work.
    assert.equal(await can(db, U.admin, 'create'), true);
    assert.equal(await can(db, U.collector, 'edit'), true);
  } finally { await db.close(); }
});

test('AFTER the draft: Manager and Director create and edit work orders; nobody else changes', async () => {
  const db = await setup();
  try {
    await db.exec(migration);

    // Managers: matrix flipped (org A), built-in default (org B, no matrix).
    for (const m of [U.mgrA, U.mgrA2, U.mgrB]) {
      assert.equal(await can(db, m, 'create'), true);
      assert.equal(await can(db, m, 'edit'), true);
      assert.equal(await can(db, m, 'delete'), false);
    }
    assert.equal((await insertJob(db, U.mgrA, ORG_A, 'WO-A-2')).rows.length, 1);
    assert.equal(await updateJob(db, U.mgrA, uuid(100)), 1);
    assert.equal((await insertJob(db, U.mgrB, ORG_B, 'WO-B-2')).rows.length, 1);
    assert.equal(await updateJob(db, U.mgrB, uuid(200)), 1);

    // Director: no stored value, built-in default applies.
    assert.equal(await can(db, U.director, 'create'), true);
    assert.equal(await updateJob(db, U.director, uuid(100)), 1);

    // The tenant wall is untouched: a Manager cannot write another organisation's job.
    await assert.rejects(insertJob(db, U.mgrB, ORG_A, 'WO-A-X'), /row-level security/);
    assert.equal(await updateJob(db, U.mgrB, uuid(100)), 0);

    // Delete stays Admin only.
    await as(db, U.mgrA);
    assert.equal((await db.query(`DELETE FROM public.work_orders WHERE id = '${uuid(100)}' RETURNING id`)).rows.length, 0);

    // Unchanged roles.
    assert.equal(await can(db, U.tyreMan, 'create'), false);
    assert.equal(await can(db, U.tyreMan, 'edit'), false);
    assert.equal(await updateJob(db, U.tyreMan, uuid(100)), 0);
    assert.equal(await can(db, U.collector, 'create'), true);
    assert.equal(await can(db, U.admin, 'delete'), true);

    // The default covers work_orders create/edit ONLY: no other module or capability opened.
    for (const [key, cap] of [['fleet_master', 'edit'], ['budgets', 'create'], ['budgets', 'edit'], ['tyre_records', 'edit'],
      ['work_orders', 'approve'], ['work_orders', 'export'], ['corrective_actions', 'edit']]) {
      assert.equal(await can(db, U.mgrA, cap, key), false, `${key}.${cap} must stay off for Manager`);
      assert.equal(await can(db, U.mgrB, cap, key), false, `${key}.${cap} must stay off for a Manager with no matrix`);
    }

    // A per-user revoke still wins over the default; a locked account gets nothing.
    assert.equal(await can(db, U.revokedMgr, 'create'), false);
    assert.equal(await updateJob(db, U.revokedMgr, uuid(100)), 0);
    assert.equal(await can(db, U.lockedMgr, 'create'), false);
  } finally { await db.close(); }
});

test('AFTER the draft: the matrix stays authoritative, is backed up, and the rest of it is untouched', async () => {
  const db = await setup();
  try {
    await db.exec(migration);
    await root(db);

    const stored = JSON.parse((await db.query(
      `SELECT settings->'app_settings'->>'permission_overrides' AS m, settings->'app_settings'->>'currency' AS cur
         FROM public.organisations WHERE id = '${ORG_A}'`)).rows[0].m);
    assert.deepEqual(stored.overrides.Manager.work_orders, { edit: true, create: true, export: false, approve: false });
    assert.deepEqual(stored.overrides.Manager.budgets, { edit: false, create: false });
    assert.deepEqual(stored.overrides['Tyre Man'].work_orders, { edit: false, create: false });
    assert.equal(stored.version, 1);
    // Still a JSON string inside jsonb, which is the shape app_user_can and the web both read.
    assert.equal((await db.query(
      `SELECT jsonb_typeof(settings->'app_settings'->'permission_overrides') AS t, settings->'app_settings'->>'currency' AS cur
         FROM public.organisations WHERE id = '${ORG_A}'`)).rows[0].t, 'string');

    // Only the organisation that changed is in the backup, with its previous value.
    const bak = (await db.query(`SELECT id, settings FROM _bak.cur1_org_settings_20261113`)).rows;
    assert.equal(bak.length, 1);
    assert.equal(bak[0].id, ORG_A);
    assert.equal(JSON.parse(bak[0].settings.app_settings.permission_overrides).overrides.Manager.work_orders.create, false);

    // An Admin who switches Manager off again in Access Control is obeyed: explicit false beats the default.
    await db.exec(`UPDATE public.organisations SET settings = jsonb_build_object('app_settings', jsonb_build_object(
      'permission_overrides', '${matrix({ Manager: { work_orders: { create: false, edit: false } } })}'::text)) WHERE id = '${ORG_C}'`);
    assert.equal(await can(db, U.mgrC, 'create'), false);
    assert.equal(await updateJob(db, U.mgrC, uuid(300)), 0);

    // The function half is idempotent: running it again leaves app_user_can byte-identical.
    // (The matrix step is a one-off correction and is deliberately left out of this second run.)
    await root(db);
    const before = (await db.query(`SELECT md5(prosrc) AS h FROM pg_proc WHERE proname = 'app_user_can'`)).rows[0].h;
    await db.exec(migration.replace(/-- 2\. Make the stored matrix[\s\S]*?\$do\$;\s*\n\s*commit;/, 'commit;'));
    const after = (await db.query(`SELECT md5(prosrc) AS h FROM pg_proc WHERE proname = 'app_user_can'`)).rows[0].h;
    assert.equal(after, before);

    // The helper is not callable by clients directly.
    const priv = (await db.query(`SELECT has_function_privilege('anon', 'public.app_role_capability_default(text,text,text)', 'EXECUTE') AS a,
      has_function_privilege('authenticated', 'public.app_role_capability_default(text,text,text)', 'EXECUTE') AS b`)).rows[0];
    assert.deepEqual(priv, { a: false, b: false });
  } finally { await db.close(); }
});

test('the draft refuses to overwrite an app_user_can it does not recognise', async () => {
  const db = await setup();
  try {
    await db.exec(`CREATE OR REPLACE FUNCTION public.app_user_can(p_key text, p_cap text) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT false $$;`);
    await assert.rejects(db.exec(migration), /CUR-1 aborted/);
  } finally { await db.close(); }
});
