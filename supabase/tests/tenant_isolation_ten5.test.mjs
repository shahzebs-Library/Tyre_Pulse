// TEN-5: a customer Admin must not grant itself a plan, restart its trial, raise its cap or unlock itself.
// Policies are the LIVE expressions (pg_policies, 2026-11-12); guard_organisation_configuration and
// ensure_org_subscription are faithful copies of the LIVE functions (md5 checked).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ORG_A, ORG_B, USERS, asUser, asService, assertLiveMd5, code, createDb, liveFunction, pendingMigration, written }
  from './fixtures/tenant_isolation_harness.mjs';

const migration = await pendingMigration('20261113104000_ten5_subscription_and_plan_write_guard.sql');
// TEN-5b: the live trigger fires only on UPDATE OF settings, so the plan-column check TEN-5 put
// inside guard_organisation_configuration() never runs for a plan update. TEN-5b adds its own trigger.
const migrationB = await pendingMigration('20261113114500_ten5b_organisation_plan_columns_trigger.sql');
const PLAN_SETS = [`locked = false`, `plan = 'enterprise'`, `max_users = 100000`, `active = false`, `parent_organisation_id = '${ORG_A}'`];

async function setup() {
  const db = await createDb();
  await db.exec(`
    create table public.org_subscriptions (
      id uuid primary key default gen_random_uuid(),
      organisation_id uuid default public.app_current_org() unique,
      plan_code text not null, status text not null default 'trialing',
      billing_interval text not null default 'monthly', seats integer not null default 1,
      trial_ends_at timestamptz, current_period_start timestamptz not null default now(),
      current_period_end timestamptz, cancel_at_period_end boolean not null default false,
      external_customer_id text, external_subscription_id text,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := clock_timestamp(); return new; end $$;
    create trigger set_updated_at_org_subscriptions before update on public.org_subscriptions
      for each row execute function public.set_updated_at();
    alter table public.org_subscriptions enable row level security;
    grant select, insert, update, delete on public.org_subscriptions to authenticated; grant all on public.org_subscriptions to service_role;
    alter table public.profiles enable row level security; grant select on public.profiles to authenticated;
    create policy profiles_select on public.profiles for select to authenticated using (true);
    create policy org_subscriptions_read on public.org_subscriptions for select to authenticated
      using (organisation_id = (select public.app_current_org()));
    create policy org_subscriptions_admin_write on public.org_subscriptions for all to authenticated
      using ((organisation_id = (select public.app_current_org())) and (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.role = 'Admin')))
      with check ((organisation_id = (select public.app_current_org())) and (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.role = 'Admin')));
    create policy admin_only_delete_guard on public.org_subscriptions as restrictive for delete to authenticated using (public.app_can_admin_delete());

    ${liveFunction('guard_organisation_configuration')}
    ${liveFunction('ensure_org_subscription')}
    -- LIVE definition (pg_get_triggerdef, read from the production catalog baseline): column limited.
    create trigger guard_organisation_configuration before update of settings on public.organisations
      for each row execute function public.guard_organisation_configuration();
    alter table public.organisations enable row level security;
    grant select, insert, update, delete on public.organisations to authenticated; grant all on public.organisations to service_role;
    create policy organisations_select on public.organisations for select to public
      using ((id = (select public.app_current_org())) or (select public.is_super_admin()));
    create policy organisations_write on public.organisations for all to public
      using (((id = (select public.app_current_org())) and ((select public.get_my_role()) = 'Admin')) or (select public.is_super_admin()))
      with check (((id = (select public.app_current_org())) and ((select public.get_my_role()) = 'Admin')) or (select public.is_super_admin()));
    create policy admin_only_delete_guard on public.organisations as restrictive for delete to authenticated using (public.app_can_admin_delete());
    update public.organisations set locked = true, plan = 'starter', max_users = 5 where id = '${ORG_B}';
    -- A definer path that changes plan-class columns, standing in for holding_link_subsidiary / admin_archive_empty_org.
    create function public.test_definer_set_active(p_org uuid, p_active boolean) returns void language sql security definer
      set search_path to 'public' as $$ update public.organisations set active = p_active where id = p_org $$;`);
  await assertLiveMd5(db, ['guard_organisation_configuration', 'ensure_org_subscription']);
  return db;
}
const sub = async (db, org) => (await db.query(
  'select plan_code, status, seats, cancel_at_period_end, trial_ends_at from public.org_subscriptions where organisation_id = $1', [org])).rows[0];
const org = async (db, id) => (await db.query('select name, plan, active, locked, max_users, parent_organisation_id from public.organisations where id = $1', [id])).rows[0];

test('TEN-5 BEFORE: a customer Admin gives itself the enterprise plan and unlocks its own organisation', async () => {
  const db = await setup();
  try {
    await asUser(db, USERS.adminB, () => db.query('select * from public.ensure_org_subscription()'));
    assert.equal((await sub(db, ORG_B)).plan_code, 'trial');
    assert.equal(await asUser(db, USERS.adminB, () => written(db,
      `update public.org_subscriptions set plan_code = 'enterprise', status = 'active', seats = 500, trial_ends_at = now() + interval '10 years'`)), 1);
    assert.deepEqual([(await sub(db, ORG_B)).plan_code, (await sub(db, ORG_B)).status, (await sub(db, ORG_B)).seats], ['enterprise', 'active', 500]);
    assert.equal(await asUser(db, USERS.adminB, () => written(db,
      `update public.organisations set locked = false, plan = 'enterprise', max_users = 100000 where id = '${ORG_B}'`)), 1);
    assert.deepEqual(await org(db, ORG_B), { name: 'Tenant B', plan: 'enterprise', active: true, locked: false, max_users: 100000, parent_organisation_id: null });
    // It can also insert a paid row from nothing and remove its own organisation row.
    await db.exec('delete from public.org_subscriptions');
    await asUser(db, USERS.adminB, () => db.query(`insert into public.org_subscriptions (plan_code, status) values ('enterprise', 'active')`));
    assert.equal((await sub(db, ORG_B)).status, 'active');
    assert.equal(await asUser(db, USERS.adminB, () => written(db, `delete from public.organisations where id = '${ORG_B}'`)), 1);
  } finally { await db.close(); }
});

test('TEN-5 AFTER: plan, status, limits and lock are refused for a customer Admin; platform paths still write', async () => {
  const db = await setup();
  try {
    await db.exec(migration);
    await db.exec(migration); // idempotent
    await db.exec(migrationB);
    await db.exec(migrationB); // idempotent
    const acl = await db.query(`select has_function_privilege('authenticated','public.guard_org_subscription_writes()','EXECUTE') a,
      has_function_privilege('anon','public.guard_org_subscription_writes()','EXECUTE') n,
      has_function_privilege('authenticated','public.guard_organisation_platform_columns()','EXECUTE') a2,
      has_function_privilege('anon','public.guard_organisation_platform_columns()','EXECUTE') n2`);
    assert.deepEqual(acl.rows[0], { a: false, n: false, a2: false, n2: false });
    const trg = await db.query(`select tgenabled::text e, tgattr::text cols from pg_trigger
      where tgrelid = 'public.organisations'::regclass and tgname = 'trg_guard_organisation_platform_columns'`);
    assert.deepEqual(trg.rows, [{ e: 'O', cols: '' }], 'one enabled trigger with no column list');

    // The trial row still appears through the definer RPC, for the customer and for Company A.
    await asUser(db, USERS.adminB, () => db.query('select * from public.ensure_org_subscription()'));
    await asUser(db, USERS.superA, () => db.query('select * from public.ensure_org_subscription()'));
    const trial = await sub(db, ORG_B);
    assert.deepEqual([trial.plan_code, trial.status], ['trial', 'trialing']);

    // org_subscriptions: every self-grant is refused and the row is unchanged.
    for (const set of [`plan_code = 'enterprise'`, `status = 'active'`, `seats = 500`, `trial_ends_at = now() + interval '10 years'`,
      `current_period_end = now() + interval '10 years'`, `billing_interval = 'annual'`, `external_subscription_id = 'sub_forged'`,
      `plan_code = 'trial', status = 'trialing', current_period_start = now()`]) {
      await assert.rejects(asUser(db, USERS.adminB, () => db.query(`update public.org_subscriptions set ${set}`)), code('42501'), set);
    }
    await assert.rejects(asUser(db, USERS.adminB, () => db.query('delete from public.org_subscriptions')), code('42501'));
    await assert.rejects(asUser(db, USERS.adminA, () => db.query(`update public.org_subscriptions set plan_code = 'enterprise'`)), code('42501'),
      'a future plain Company A Admin is held to the same rule');
    assert.deepEqual(await sub(db, ORG_B), trial, 'subscription row unchanged (privileged read)');
    await db.exec(`delete from public.org_subscriptions where organisation_id = '${ORG_B}'`);
    await assert.rejects(asUser(db, USERS.adminB, () => db.query(
      `insert into public.org_subscriptions (plan_code, status) values ('enterprise', 'active')`)), code('42501'));
    await asUser(db, USERS.adminB, () => db.query('select * from public.ensure_org_subscription()'));

    // Still allowed for the customer: ask to cancel at period end, and undo it.
    assert.equal(await asUser(db, USERS.adminB, () => written(db, 'update public.org_subscriptions set cancel_at_period_end = true')), 1);
    assert.equal((await sub(db, ORG_B)).cancel_at_period_end, true);
    assert.equal(await asUser(db, USERS.adminB, () => written(db, 'update public.org_subscriptions set cancel_at_period_end = false')), 1);
    assert.equal(await asUser(db, USERS.mgrB, () => written(db, 'update public.org_subscriptions set cancel_at_period_end = true')), 0, 'a Manager still cannot');

    // organisations: plan-class columns refused one by one, ordinary columns still editable.
    for (const set of [...PLAN_SETS, `locked = false, plan = 'enterprise', max_users = 9999`, `name = 'X', max_users = 6`]) {
      await assert.rejects(asUser(db, USERS.adminB, () => db.query(`update public.organisations set ${set} where id = '${ORG_B}'`)),
        e => e.code === '42501' && e.message === 'Plan, status and limits are managed by the platform.', set);
    }
    await assert.rejects(asUser(db, USERS.adminA, () => db.query(`update public.organisations set max_users = 9999 where id = '${ORG_A}'`)), code('42501'),
      'a future plain Company A Admin is held to the same rule');
    // Writing the same value back is not a change and is not refused.
    assert.equal(await asUser(db, USERS.adminB, () => written(db, `update public.organisations set plan = 'starter', name = 'Tenant B' where id = '${ORG_B}'`)), 1);
    assert.equal(await asUser(db, USERS.adminB, () => written(db, `update public.organisations set name = 'Tenant B Ltd' where id = '${ORG_B}'`)), 1);
    assert.equal(await asUser(db, USERS.adminB, () => written(db, `delete from public.organisations where id = '${ORG_B}'`)), 0);
    assert.deepEqual(await org(db, ORG_B), { name: 'Tenant B Ltd', plan: 'starter', active: true, locked: true, max_users: 5, parent_organisation_id: null });
    // The pre-existing settings guard still fires.
    await assert.rejects(asUser(db, USERS.adminB, () => db.query(
      `update public.organisations set settings = '{"settings":{"x":1}}' where id = '${ORG_B}'`)), code('42501'));

    // Platform paths. 1) Stripe webhook: service_role upsert and status change.
    await asService(db, () => db.query(`insert into public.org_subscriptions (organisation_id, plan_code, status, external_subscription_id)
      values ('${ORG_B}', 'professional', 'active', 'sub_1') on conflict (organisation_id) do update
      set plan_code = excluded.plan_code, status = excluded.status, external_subscription_id = excluded.external_subscription_id`));
    assert.equal(await asService(db, () => written(db, `update public.org_subscriptions set status = 'past_due' where external_subscription_id = 'sub_1'`)), 1);
    assert.deepEqual([(await sub(db, ORG_B)).plan_code, (await sub(db, ORG_B)).status], ['professional', 'past_due']);
    // 2) Super admin in the console: direct writes to any organisation and any subscription.
    assert.equal(await asUser(db, USERS.superA, () => written(db, `update public.organisations set locked = false, plan = 'enterprise', max_users = 250 where id = '${ORG_B}'`)), 1);
    assert.equal(await asUser(db, USERS.superA, () => written(db, `update public.organisations set max_users = 900 where id = '${ORG_A}'`)), 1);
    assert.equal(await asUser(db, USERS.superA, () => written(db, `update public.org_subscriptions set plan_code = 'enterprise', status = 'active' where organisation_id = '${ORG_A}'`)), 1);
    assert.equal((await org(db, ORG_B)).plan, 'enterprise');
    // 3) A SECURITY DEFINER RPC called by a customer Admin is not restricted by the trigger.
    await asUser(db, USERS.adminB, () => db.query('select public.test_definer_set_active($1, false)', [ORG_B]));
    assert.equal((await org(db, ORG_B)).active, false);
    // 4) Only a super admin removes an organisation row.
    await db.exec(`insert into public.organisations (id, name, slug) values ('00000000-0000-0000-0000-0000000000c3', 'Empty', 'empty')`);
    assert.equal(await asUser(db, USERS.superA, () => written(db, `delete from public.organisations where slug = 'empty'`)), 1);
  } finally { await db.close(); }
});

test('TEN-5 migration aborts when guard_organisation_configuration no longer matches its anchor', async () => {
  const db = await setup();
  try {
    await db.exec(`create or replace function public.guard_organisation_configuration() returns trigger language plpgsql as $$ begin return new; end $$;`);
    await assert.rejects(db.exec(migration), /TEN-5 aborted/);
  } finally { await db.close(); }
});

test('TEN-5 alone leaves organisations plan columns open: the live trigger fires only on UPDATE OF settings', async () => {
  const db = await setup();
  try {
    await db.exec(migration);
    // The check TEN-5 added is in the function, but the trigger does not run for this statement.
    assert.equal(await asUser(db, USERS.adminB, () => written(db,
      `update public.organisations set locked = false, plan = 'enterprise', max_users = 9999 where id = '${ORG_B}'`)), 1);
    assert.deepEqual([(await org(db, ORG_B)).plan, (await org(db, ORG_B)).max_users, (await org(db, ORG_B)).locked], ['enterprise', 9999, false]);
    // It does run when the statement names settings, which is how the first fixture hid the gap.
    await assert.rejects(asUser(db, USERS.adminB, () => db.query(
      `update public.organisations set plan = 'starter', settings = settings where id = '${ORG_B}'`)), code('42501'));
  } finally { await db.close(); }
});

test('TEN-5b closes the plan columns on its own (without TEN-5) and leaves platform paths alone', async () => {
  const db = await setup();
  try {
    await db.exec(migrationB);
    for (const set of PLAN_SETS) {
      await assert.rejects(asUser(db, USERS.adminB, () => db.query(`update public.organisations set ${set} where id = '${ORG_B}'`)), code('42501'), set);
    }
    assert.deepEqual(await org(db, ORG_B), { name: 'Tenant B', plan: 'starter', active: true, locked: true, max_users: 5, parent_organisation_id: null });
    assert.equal(await asUser(db, USERS.adminB, () => written(db, `update public.organisations set name = 'Tenant B Ltd' where id = '${ORG_B}'`)), 1);
    // Super admin, service role and a SECURITY DEFINER RPC still write the guarded columns.
    assert.equal(await asUser(db, USERS.superA, () => written(db, `update public.organisations set plan = 'enterprise', max_users = 250, locked = false where id = '${ORG_B}'`)), 1);
    assert.equal(await asUser(db, USERS.superA, () => written(db, `update public.organisations set max_users = 900 where id = '${ORG_A}'`)), 1);
    assert.equal(await asService(db, () => written(db, `update public.organisations set plan = 'professional' where id = '${ORG_B}'`)), 1);
    await asUser(db, USERS.adminB, () => db.query('select public.test_definer_set_active($1, false)', [ORG_B]));
    assert.deepEqual(await org(db, ORG_B), { name: 'Tenant B Ltd', plan: 'professional', active: false, locked: false, max_users: 250, parent_organisation_id: null });
    // The ROLLBACK statement from the file header reopens the columns (and nothing else is needed).
    await db.exec('alter table public.organisations disable trigger trg_guard_organisation_platform_columns');
    assert.equal(await asUser(db, USERS.adminB, () => written(db, `update public.organisations set max_users = 7 where id = '${ORG_B}'`)), 1);
  } finally { await db.close(); }
});

test('TEN-5b migration aborts when organisations has lost a guarded column', async () => {
  const db = await setup();
  try {
    await db.exec('alter table public.organisations rename column max_users to max_seats');
    await assert.rejects(db.exec(migrationB), /TEN-5b aborted: organisations no longer has column\(s\) max_users/);
    const { rows } = await db.query(`select count(*)::int n from pg_proc where proname = 'guard_organisation_platform_columns'`);
    assert.equal(rows[0].n, 0, 'nothing was created');
  } finally { await db.close(); }
});
