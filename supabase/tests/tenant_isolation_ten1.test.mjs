// TEN-1: the job card staging pipe must not overwrite another organisation's work order.
// Runs the pending migrations against a faithful copy of the LIVE process_stg_job_cards().
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ORG_A, ORG_B, USERS, asUser, asService, assertLiveMd5, code, createDb, liveFunction, pendingMigration }
  from './fixtures/tenant_isolation_harness.mjs';

const guard = await pendingMigration('20261113100000_ten1_job_card_conflict_org_guard.sql');
const perOrgKey = await pendingMigration('20261113100500_ten1b_work_orders_per_org_key.sql');

async function setup() {
  const db = await createDb();
  await db.exec(`
    create table public.work_orders (
      id uuid primary key default gen_random_uuid(),
      organisation_id uuid not null default public.app_current_org(),
      country varchar, work_order_no varchar not null, rfr_no text, source_row text,
      asset_no text, plate_no text, asset_category text, site text, work_location text, scope text,
      status text, work_type text, description text, notes text,
      opened_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz,
      target_completion timestamptz, production_out_at timestamptz, production_in_at timestamptz,
      breakdown_hours numeric, standard_hours numeric, waiting_parts_hours numeric,
      waiting_manpower_hours numeric, manpower_hours numeric, mr_no text, sco_no text,
      asset_description text, truck_category text, head_tail text, custom_data jsonb,
      updated_at timestamptz default now(),
      constraint work_orders_work_order_no_key unique (work_order_no));
    create table public.stg_job_cards (
      country text, "Job Card No" text, "RFR Number" text, "Asset Code" text, "Status" text,
      "Type" text, "Location" text, "Production Complaint" text, "Production Out" text);
    ${liveFunction('process_stg_job_cards')}
    revoke all on function public.process_stg_job_cards() from public;
    create trigger trg_process_stg_job_cards before insert on public.stg_job_cards
      for each row execute function public.process_stg_job_cards();
    -- Live policies on stg_job_cards (pg_policies, 2026-11-12).
    alter table public.stg_job_cards enable row level security;
    grant select, insert on public.stg_job_cards to authenticated, service_role;
    create policy stg_job_cards_write on public.stg_job_cards for all to authenticated
      using ((select public.app_is_elevated())) with check ((select public.app_is_elevated()));
    create policy stg_job_cards_org_isolation on public.stg_job_cards as restrictive for all to authenticated
      using (((select public.app_current_org()) is not null) or (select public.is_super_admin()))
      with check (((select public.app_current_org()) is not null) or (select public.is_super_admin()));
    insert into public.work_orders (organisation_id, country, work_order_no, asset_no, site, status, work_type, description, custom_data)
    values ('${ORG_A}', 'KSA', 'GCKR/JC/0001/0826', 'TM514', 'NHC', 'Open', 'Repair', 'Company A original complaint', '{"owner":"A"}');`);
  await assertLiveMd5(db, ['process_stg_job_cards']);
  return db;
}

const stage = (db, uid, row) => asUser(db, uid, () => db.query(
  `insert into public.stg_job_cards (country, "Job Card No", "Asset Code", "Status", "Type", "Location", "Production Complaint")
   values ($1,$2,$3,$4,$5,$6,$7)`,
  [row.country, row.no, row.asset ?? null, row.status ?? 'Open', row.type ?? 'General', row.site ?? null, row.complaint ?? null]));
const rowA = async (db) => (await db.query(
  `select organisation_id, country, asset_no, site, status, description, custom_data, md5(to_jsonb(w)::text) fp
     from public.work_orders w where work_order_no = 'GCKR/JC/0001/0826' and organisation_id = '${ORG_A}'`)).rows;
const count = async (db) => (await db.query('select count(*)::int n from public.work_orders')).rows[0].n;

test('TEN-1 BEFORE: a tenant B Manager overwrites the Company A work order through the live function', async () => {
  const db = await setup();
  try {
    await stage(db, USERS.mgrB, { country: 'UAE', no: 'GCKR/JC/0001/0826', asset: 'B-TRUCK', status: 'Closed', site: 'B-SITE', complaint: 'tenant B text' });
    const [a] = await rowA(db);
    assert.equal(await count(db), 1, 'no new row: the Company A row itself was rewritten');
    assert.equal(a.organisation_id, ORG_A, 'the row still claims to be Company A');
    assert.equal(a.country, 'UAE');
    assert.equal(a.asset_no, 'B-TRUCK');
    assert.equal(a.site, 'B-SITE');
    assert.equal(a.status, 'Closed');
    assert.equal(a.description, 'tenant B text');
  } finally { await db.close(); }
});

test('TEN-1 AFTER guard: the foreign overwrite is refused with PT409 and Company A re-imports still work', async () => {
  const db = await setup();
  try {
    await db.exec(guard);
    const acl = await db.query(`select has_function_privilege('authenticated','public.process_stg_job_cards()','EXECUTE') a,
      has_function_privilege('anon','public.process_stg_job_cards()','EXECUTE') n,
      prosecdef d, proconfig::text c from pg_proc where oid = 'public.process_stg_job_cards()'::regprocedure`);
    assert.deepEqual(acl.rows[0], { a: false, n: false, d: true, c: '{search_path=public}' }, 'definer, search_path and ACL survive the replacement');

    const [before] = await rowA(db);
    await assert.rejects(
      stage(db, USERS.mgrB, { country: 'UAE', no: 'GCKR/JC/0001/0826', asset: 'B-TRUCK', status: 'Closed', complaint: 'tenant B text' }),
      code('PT409'));
    const [after] = await rowA(db);
    assert.equal(after.fp, before.fp, 'Company A row is byte-identical after the refused attempt');
    assert.equal(await count(db), 1);

    // Tenant B can still import a number nobody else holds.
    await stage(db, USERS.mgrB, { country: 'UAE', no: 'B/JC/0001', asset: 'B-TRUCK' });
    assert.equal((await db.query(`select organisation_id from public.work_orders where work_order_no = 'B/JC/0001'`)).rows[0].organisation_id, ORG_B);

    // Company A: re-importing its own card refreshes the row in place, as today.
    await stage(db, USERS.superA, { country: 'KSA', no: 'GCKR/JC/0001/0826', status: 'Completed', type: 'Break Down' });
    const [refreshed] = await rowA(db);
    assert.equal(refreshed.status, 'Completed');
    assert.equal(refreshed.asset_no, 'TM514', 'a blank cell does not blank the stored asset');
    assert.equal(refreshed.description, 'Company A original complaint');
    assert.equal(refreshed.custom_data.owner, 'A', 'custom_data is merged, not replaced');
    assert.equal(refreshed.custom_data.erp_type, 'Break Down');
    assert.equal(await count(db), 2, 'still one row per job card');

    // Company A: a brand new card inserts; a Table Editor style load (no profile) still lands in Company A.
    await stage(db, USERS.mgrA, { country: 'KSA', no: 'GCKR/JC/0002/0826', asset: 'tm515' });
    await asService(db, () => db.query(`insert into public.stg_job_cards (country, "Job Card No") values ('KSA','GCKR/JC/0003/0826')`));
    const fresh = await db.query(`select work_order_no, organisation_id, asset_no from public.work_orders where work_order_no like 'GCKR/JC/000_/0826' order by 1`);
    assert.deepEqual(fresh.rows.map(r => r.organisation_id), [ORG_A, ORG_A, ORG_A]);
    assert.equal(fresh.rows[1].asset_no, 'TM515');
    assert.equal((await db.query('select count(*)::int n from public.stg_job_cards')).rows[0].n, 0, 'staging stays a pure pipe');

    // Idempotent, and it refuses to run against a function it does not recognise.
    await db.exec(guard);
    const hits = await db.query(`select (length(prosrc) - length(replace(prosrc, 'excluded.organisation_id', ''))) / length('excluded.organisation_id') n
      from pg_proc where oid = 'public.process_stg_job_cards()'::regprocedure`);
    assert.equal(hits.rows[0].n, 1, 'a second run does not stack the guard');
  } finally { await db.close(); }
});

test('TEN-1 guard migration aborts when the live function no longer matches its anchor', async () => {
  const db = await setup();
  try {
    await db.exec(`create or replace function public.process_stg_job_cards() returns trigger language plpgsql as $$ begin return null; end $$;`);
    await assert.rejects(db.exec(guard), /TEN-1 aborted/);
  } finally { await db.close(); }
});

test('TEN-1b AFTER per-organisation key: tenant B gets its own row and Company A is untouched', async () => {
  const db = await setup();
  try {
    await assert.rejects(db.exec(perOrgKey), /apply the TEN-1 organisation guard/, 'part b refuses to run before part a');
    await db.exec(guard);
    await db.exec(perOrgKey);
    const keys = await db.query(`select conname from pg_constraint where conrelid = 'public.work_orders'::regclass and contype = 'u'`);
    assert.deepEqual(keys.rows.map(r => r.conname), ['work_orders_org_work_order_no_key']);

    const [before] = await rowA(db);
    await stage(db, USERS.mgrB, { country: 'UAE', no: 'GCKR/JC/0001/0826', asset: 'B-TRUCK', status: 'Closed', complaint: 'tenant B text' });
    const [after] = await rowA(db);
    assert.equal(after.fp, before.fp, 'Company A row is byte-identical');
    const b = await db.query(`select organisation_id, asset_no, description from public.work_orders
      where work_order_no = 'GCKR/JC/0001/0826' and organisation_id = '${ORG_B}'`);
    assert.deepEqual(b.rows, [{ organisation_id: ORG_B, asset_no: 'B-TRUCK', description: 'tenant B text' }]);

    // Each organisation refreshes only its own copy.
    await stage(db, USERS.mgrB, { country: 'UAE', no: 'GCKR/JC/0001/0826', status: 'Completed' });
    await stage(db, USERS.mgrA, { country: 'KSA', no: 'GCKR/JC/0001/0826', status: 'In Progress' });
    const both = await db.query(`select organisation_id, status from public.work_orders where work_order_no = 'GCKR/JC/0001/0826' order by 1`);
    assert.deepEqual(both.rows, [{ organisation_id: ORG_A, status: 'In Progress' }, { organisation_id: ORG_B, status: 'Completed' }]);
    assert.equal(await count(db), 2);
  } finally { await db.close(); }
});
