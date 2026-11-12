// COM-0 and COM-6: the per-organisation settings store and its resolvers.
// The point of every test: the CURRENT company (the legacy owner, ORG_A) gets exactly the answer
// the live code gives today, and a second company gets its own answer, never the first one's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ORG_A, ORG_B, USERS, all, asUser, code, createCommercialDb, one, pendingMigration, written,
} from './fixtures/commercial_harness.mjs';

const FOUNDATION = await pendingMigration('20261113150000_com_organisation_settings_foundation.sql');
const RESOLVERS = await pendingMigration('20261113156000_com_tenant_settings_resolvers.sql');

async function setup({ resolvers = true } = {}) {
  const db = await createCommercialDb();
  await db.exec(`
    insert into public.settings (key, value) values ('company_name', '"Global Company Name"');
    insert into public.system_config (key, value) values ('company_logo', '"https://cdn.example.test/global-logo.png"');
  `);
  await db.exec(FOUNDATION);
  if (resolvers) await db.exec(RESOLVERS);
  return db;
}

test('COM-0: settings are walled per organisation and written by the company Admin only', async () => {
  const db = await setup({ resolvers: false });
  try {
    assert.equal((await one(db, 'select public.legacy_settings_owner_org() o')).o, ORG_A);
    const put = (uid, org, key) => asUser(db, uid, () => db.query(
      `insert into public.organisation_settings (organisation_id, key, value) values ($1, $2, '{"x":1}')`, [org, key]));
    await put(USERS.adminA, ORG_A, 'demo_a');
    await put(USERS.adminB, ORG_B, 'demo_b');
    await assert.rejects(put(USERS.mgrA, ORG_A, 'by_manager'), code('42501'), 'a Manager cannot write settings');
    await assert.rejects(put(USERS.adminB, ORG_A, 'cross_org'), code('42501'), 'another company Admin cannot write here');
    const seen = (uid) => asUser(db, uid, async () => (await db.query('select key from public.organisation_settings order by key')).rows.map(r => r.key));
    assert.deepEqual(await seen(USERS.userA), ['demo_a']);
    assert.deepEqual(await seen(USERS.mgrB), ['demo_b']);
    assert.equal(await asUser(db, USERS.adminB, () => written(db, `update public.organisation_settings set value = '{}' where key = 'demo_a'`)), 0);
    assert.deepEqual(await asUser(db, USERS.userA, async () => (await db.query(`select public.my_org_setting('demo_a') v`)).rows[0].v), { x: 1 });
    assert.equal(await asUser(db, USERS.mgrB, async () => (await db.query(`select public.my_org_setting('demo_a') v`)).rows[0].v), null);
    await assert.rejects(asUser(db, USERS.adminB, () => db.query(`select public.org_setting($1, 'demo_a')`, [ORG_A])), code('42501'),
      'the reader that takes an organisation id is not callable by a signed-in user');
    await assert.rejects(db.query(`insert into public.organisation_settings (organisation_id, key, value) values ($1, 'Bad Key', '1')`, [ORG_A]), code('23514'));
  } finally { await db.close(); }
});

test('COM-6 branding: the current company keeps the global name and logo; a second company never gets them', async () => {
  const db = await setup();
  try {
    // The expression the live get_report_snapshot uses today.
    const live = await one(db, `select
      coalesce(nullif(replace(replace((select value::text from public.settings where key = 'company_name' limit 1), '"', ''), '\\', ''), ''), 'TyrePulse') company,
      nullif(replace(replace(coalesce((select coalesce(value_text, value::text) from public.system_config where key = 'company_logo' limit 1), ''), '"', ''), '\\', ''), '') logo`);
    const a = (await one(db, 'select public.org_public_branding($1) b', [ORG_A])).b;
    assert.equal(a.company, live.company);
    assert.equal(a.logo, live.logo);
    assert.equal(a.source, 'legacy_global');
    const b = (await one(db, 'select public.org_public_branding($1) b', [ORG_B])).b;
    assert.deepEqual(b, { company: 'Tenant B', logo: null, source: 'organisation_record' });
    await db.query(`insert into public.organisation_settings (organisation_id, key, value) values ($1, 'public_branding', $2)`,
      [ORG_B, { company_name: 'Tenant B Haulage', logo_url: 'https://cdn.example.test/b.png' }]);
    assert.deepEqual((await one(db, 'select public.org_public_branding($1) b', [ORG_B])).b,
      { company: 'Tenant B Haulage', logo: 'https://cdn.example.test/b.png', source: 'organisation' });
    assert.equal((await asUser(db, USERS.mgrB, async () => (await db.query('select public.my_org_public_branding() b')).rows[0].b)).company, 'Tenant B Haulage');
    assert.equal((await asUser(db, USERS.userA, async () => (await db.query('select public.my_org_public_branding() b')).rows[0].b)).company, live.company);
  } finally { await db.close(); }
});

test('COM-6 countries: the current company list is the three hard-coded countries, in screen order', async () => {
  const db = await setup();
  try {
    const a = await all(db, 'select country, currency, label from public.org_countries($1) order by sort_order', [ORG_A]);
    // src/contexts/SettingsContext.jsx: COUNTRIES, COUNTRY_CURRENCY, COUNTRY_LABEL
    assert.deepEqual(a, [
      { country: 'KSA', currency: 'SAR', label: 'KSA' },
      { country: 'UAE', currency: 'AED', label: 'UAE' },
      { country: 'Egypt', currency: 'EGP', label: 'EGY' }]);
    for (const c of ['KSA', 'UAE', 'Egypt', 'egypt ', 'Qatar', null]) {
      const r = await one(db, 'select public.org_currency_for_country($1, $2) a, public.currency_for_country($2) live', [ORG_A, c]);
      assert.equal(r.a, r.live, `currency for ${c} equals the live currency_for_country`);
    }
    await db.query(`insert into public.organisation_settings (organisation_id, key, value) values ($1, 'countries', $2)`,
      [ORG_B, JSON.stringify([{ country: 'Qatar', currency: 'QAR', currency_name: 'Qatari Riyal', is_base: true }])]);
    assert.deepEqual(await asUser(db, USERS.mgrB, async () => (await db.query('select country, currency, label from public.my_org_countries()')).rows),
      [{ country: 'Qatar', currency: 'QAR', label: 'Qatar' }]);
    assert.equal((await one(db, `select public.org_currency_for_country($1, 'Qatar') c`, [ORG_B])).c, 'QAR');
  } finally { await db.close(); }
});

// Distinct vehicle types read from production on 2026-11-12, plus edge cases.
const VEHICLE_TYPES = ['BT-PLANT', 'BUILDINGS', 'BUS', 'CHILLER', 'D TANKER', 'EXCAVATOR', 'FORKLIFT', 'GENERATOR',
  'HD-DISTRIBUTOR', 'HEAVY EQP', 'ICE PLANT', 'LINE PUMP', 'NULL', 'PICKUP', 'PLACING BOOM', 'PUMPS', 'RECLAIMER',
  'SKID LOADER', 'SPIDER PUMP', 'STATIONARY PUMP', 'TR-MIXER', 'TRAILER', 'VEH TYPE/CATEGORY', 'W TANKER',
  'WATER TREATMENT PLANT', 'WHEEL_LOADER', 'tr-mixer', 'Mixer Pump Loader', 'Pump loader', '', null];

test('COM-6 tyre ceilings: the seeded rules equal the live functions for every vehicle type and km case', async () => {
  const db = await setup();
  try {
    for (const v of VEHICLE_TYPES) {
      const r = await one(db, 'select public.tyre_life_km_cap_for($1, $2) a, public.tyre_life_km_cap_for($3, $2) b, public.tyre_life_km_cap($2) live', [ORG_A, v, ORG_B]);
      assert.equal(Number(r.a), Number(r.live), `seeded owner ceiling for ${v}`);
      assert.equal(Number(r.b), Number(r.live), `an organisation with no setting falls back to the live function for ${v}`);
    }
    const fits = [null, 0, 1, 2, 5000];
    const rems = [null, 0, 4000, 60000, 90000, 150000];
    const totals = [null, 0, 30000, 79999, 80000, 80001, 100000, 100001];
    const diff = await one(db, `
      select count(*)::int n,
             count(*) filter (where public.tyre_km_life_for($1, f, r, t, v) is distinct from public.tyre_km_life(f, r, t, v))::int bad
        from unnest($2::numeric[]) f, unnest($3::numeric[]) r, unnest($4::numeric[]) t, unnest($5::text[]) v`,
      [ORG_A, fits, rems, totals, VEHICLE_TYPES]);
    assert.equal(diff.n, fits.length * rems.length * totals.length * VEHICLE_TYPES.length);
    assert.equal(diff.bad, 0, 'tyre_km_life_for(owner) is identical to the live tyre_km_life on every combination');

    // A long-haul company: 250,000 km ceiling keeps a 180,000 km life the live rule discards.
    await db.query(`insert into public.organisation_settings (organisation_id, key, value) values ($1, 'tyre_life_km_caps', $2)`,
      [ORG_B, { default_cap_km: 250000, rules: [{ contains: 'TIPPER', cap_km: 120000 }] }]);
    const b = await one(db, `select public.tyre_km_life_for($1, 1000, 181000, null, 'TRACTOR HEAD') kept,
                                    public.tyre_km_life(1000, 181000, null, 'TRACTOR HEAD') live,
                                    public.tyre_km_life_for($1, 1000, 181000, null, 'TIPPER 6X4') tipper,
                                    public.tyre_km_life_for($2, 1000, 181000, null, 'TRACTOR HEAD') owner`, [ORG_B, ORG_A]);
    assert.equal(Number(b.kept), 180000);
    assert.equal(b.live, null);
    assert.equal(b.tipper, null, 'its own 120,000 km rule applies to tippers');
    assert.equal(b.owner, null, 'the current company is unaffected by tenant B setting');
    assert.equal((await asUser(db, USERS.mgrB, async () => (await db.query('select public.my_tyre_life_km_caps() c')).rows[0].c)).default_cap_km, 250000);
  } finally { await db.close(); }
});

// Every role name in production on 2026-11-12, plus the built-in ones a new company starts with.
const ROLES = ['Admin', 'Manager', 'Director', 'Inspector', 'Reporter', 'Driver', 'Tyre Man', 'Tyre Data Collector',
  'Store Keeper', 'Workshop Supervisor', 'Maintenance Supervisor', 'Fleet Supervisor', 'PMV Manager',
  'Workshop Area Manager', 'Workshop Maintenance Area Manager', 'Data Monitor Officer', 'Tire Planning Engineer',
  'Helper Workshop', 'Diesel Mechanic', 'admin', 'pmv manager'];
// The list inside the live decide_inspection_approval (read 2026-11-12).
const LIVE_INSPECTION_SIGNERS = ['Admin', 'PMV Manager', 'Workshop Area Manager', 'Workshop Maintenance Area Manager', 'Tyre Data Collector'];

test('COM-6 approver roles: the current company answers match the live gates for every role', async () => {
  const db = await setup();
  try {
    const as = async (uid, role) => {
      await db.query('update public.profiles set role = $2 where id = $1', [uid, role]);
      return asUser(db, uid, async () => (await db.query(`select
        public.my_role_in_approval_list('checklist_supervisors') sup, public.checklist_is_supervisor() live_sup,
        public.my_role_in_approval_list('checklist_area_managers') am, public.checklist_is_area_manager() live_am,
        public.my_role_in_approval_list('inspection_signers') insp`)).rows[0]);
    };
    for (const role of ROLES) {
      const a = await as(USERS.userA, role);
      assert.equal(a.sup, a.live_sup, `checklist supervisor, role ${role}`);
      assert.equal(a.am, a.live_am, `checklist final approver, role ${role}`);
      assert.equal(a.insp, LIVE_INSPECTION_SIGNERS.includes(role), `inspection signer, role ${role}`);
    }
    // A super admin passes all three, as in the live gates.
    const s = await asUser(db, USERS.superA, async () => (await db.query(`select public.my_role_in_approval_list('inspection_signers') a, public.checklist_is_supervisor() b`)).rows[0]);
    assert.deepEqual(s, { a: true, b: true });

    // A new company with only built-in roles: Manager can sign, the live gates refuse.
    const b = await as(USERS.mgrB, 'Manager');
    assert.deepEqual({ sup: b.sup, am: b.am, insp: b.insp }, { sup: true, am: true, insp: true });
    assert.deepEqual({ live_sup: b.live_sup, live_am: b.live_am }, { live_sup: false, live_am: false }, 'this is the defect MODB-1 and MODB-2 describe');
    assert.equal((await as(USERS.mgrB, 'PMV Manager')).insp, false, "the current company's custom role names mean nothing in tenant B");
    assert.equal((await as(USERS.mgrB, 'Reporter')).sup, false);
    await db.query(`insert into public.organisation_settings (organisation_id, key, value) values ($1, 'approval_roles', $2)`,
      [ORG_B, { inspection_signers: ['Depot Lead'], checklist_supervisors: [] }]);
    assert.equal((await as(USERS.mgrB, 'Depot Lead')).insp, true);
    assert.equal((await as(USERS.mgrB, 'Manager')).insp, false, 'a configured list replaces the default');
    assert.equal((await as(USERS.mgrB, 'Manager')).sup, true, 'an empty list means the built-in default');
    await assert.rejects(db.query(`select public.org_approval_roles($1, 'nonsense')`, [ORG_A]), code('22023'));
  } finally { await db.close(); }
});

test('COM-6 accident vocabulary: the current company keeps its labels; a second company sees its own name', async () => {
  const db = await setup();
  try {
    const a = (await one(db, 'select public.org_accident_vocabulary($1) v', [ORG_A])).v;
    // src/lib/accidentVocab.js: LIABLE_PARTY_OPTS[0], PAYER_OPTS[0], INTERNAL_WORKSHOPS, EXTERNAL_WORKSHOPS
    assert.equal(a.own_company_label, 'GCC');
    assert.deepEqual(a.legacy_own_company_values, ['GCC']);
    assert.deepEqual(a.internal_workshops, ['GCC Workshop']);
    assert.deepEqual(a.external_workshops, ['Vision Workshop']);
    assert.deepEqual(a.country_packs, { '*': ['najm', 'taqdeer'] }, 'Najm and Taqdeer stay visible for every country, as today');
    const b = await asUser(db, USERS.mgrB, async () => (await db.query('select public.my_org_accident_vocabulary() v')).rows[0].v);
    assert.equal(b.own_company_label, 'Tenant B');
    assert.deepEqual(b.internal_workshops, ['Tenant B Workshop']);
    assert.deepEqual(b.country_packs, {}, 'no Saudi report fields unless the company configures a country pack');
    assert.ok(!JSON.stringify(b).includes('GCC'));
  } finally { await db.close(); }
});

test('COM-6: nothing that exists today is changed, and the migration is re-runnable', async () => {
  const db = await setup({ resolvers: false });
  try {
    const snap = () => all(db, `select proname, md5(prosrc) m from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('tyre_life_km_cap','tyre_km_life','checklist_is_supervisor','checklist_is_area_manager','currency_for_country') order by 1`);
    const before = await snap();
    await db.exec(RESOLVERS);
    await db.query(`update public.organisation_settings set value = '{"default_cap_km": 90000}' where organisation_id = $1 and key = 'tyre_life_km_caps'`, [ORG_A]);
    await db.exec(RESOLVERS);
    assert.deepEqual(await snap(), before);
    assert.equal((await one(db, `select value ->> 'default_cap_km' v from public.organisation_settings where organisation_id = $1 and key = 'tyre_life_km_caps'`, [ORG_A])).v,
      '90000', 're-running never overwrites a value the company has since changed');
    assert.deepEqual((await all(db, `select key from public.organisation_settings where organisation_id = $1 order by 1`, [ORG_A])).map(r => r.key),
      ['accident_vocabulary', 'approval_roles', 'countries', 'tyre_life_km_caps']);
    assert.equal((await one(db, `select count(*)::int n from public.organisation_settings where organisation_id = $1`, [ORG_B])).n, 0);
    const p = await one(db, `select has_function_privilege('authenticated','public.org_public_branding(uuid)','EXECUTE') a,
      has_function_privilege('authenticated','public.tyre_life_km_cap_for(uuid,text)','EXECUTE') b,
      has_function_privilege('anon','public.my_org_countries()','EXECUTE') c,
      has_function_privilege('authenticated','public.my_org_countries()','EXECUTE') d`);
    assert.deepEqual(p, { a: false, b: false, c: false, d: true });
  } finally { await db.close(); }
});
