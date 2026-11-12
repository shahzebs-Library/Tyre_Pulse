// COM-1 (MODC-01), COM-2 (MODB-5), COM-3 (MODB-4): notifications and alerts stay inside one company.
// Each test builds the BEFORE state from faithful copies of the live functions (md5 checked in
// the harness), shows the leak, applies the pending migration and shows the AFTER state, and
// proves the current company (ORG_A) gets the same result before and after.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ORG_A, ORG_B, USERS, all, asUser, createCommercialDb, one, pendingMigration,
} from './fixtures/commercial_harness.mjs';

const FOUNDATION = await pendingMigration('20261113150000_com_organisation_settings_foundation.sql');
const MAIL = await pendingMigration('20261113151000_com_accident_mail_per_organisation.sql');
const NOTIFY = await pendingMigration('20261113152000_com_notify_elevated_users_org_scope.sql');
const ALERTS = await pendingMigration('20261113153000_com_alert_thresholds_org_scope.sql');

const ACC_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ACC_B = 'bbbbbbbb-0000-0000-0000-000000000001';
const OWNER_MAIL = ['claims@owner.test', 'safety@owner.test', 'cc@owner.test'];

async function accidentSetup() {
  const db = await createCommercialDb();
  await db.exec(`
    insert into public.system_config (key, value) values
      ('accident_emails_enabled', 'true'),
      ('accident_email_to', 'claims@owner.test; safety@owner.test'),
      ('accident_email_cc', 'cc@owner.test'),
      ('accident_email_subject_prefix', '[ACC]');
    insert into public.accident_email_templates (organisation_id, key, subject, body_html) values
      ('${ORG_A}', 'reported', 'Accident {{reference_no}}', '<p>{{reference_no}} {{department}}</p>'),
      ('${ORG_B}', 'reported', 'Accident {{reference_no}}', '<p>{{reference_no}} {{department}}</p>');
    insert into public.accidents (id, organisation_id, reference_no, asset_no, site, country, severity) values
      ('${ACC_A}', '${ORG_A}', 'ACC-2026-0001', 'TM-1', 'NHC', 'KSA', 'minor'),
      ('${ACC_B}', '${ORG_B}', 'ACC-2026-0001', 'BX-9', 'DEPOT', 'KSA', 'minor');
    insert into public.domain_events (event_type, entity_type, entity_id, organisation_id) values
      ('accident.reported', 'accident', '${ACC_A}', '${ORG_A}'),
      ('accident.reported', 'accident', '${ACC_B}', '${ORG_B}');
    insert into public.domain_events (event_type, entity_type, entity_id, organisation_id, actor_id, payload) values
      ('accident.closure_requested', 'accident', '${ACC_A}', '${ORG_A}', '${USERS.mgrA}', '{"accident_id":"${ACC_A}","level":"final"}'),
      ('accident.closure_requested', 'accident', '${ACC_B}', '${ORG_B}', '${USERS.mgrB}', '{"accident_id":"${ACC_B}","level":"final"}'),
      ('accident.closure_requested', 'accident', '${ACC_B}', null,       '${USERS.mgrB}', '{"accident_id":"${ACC_B}","level":"final"}');
  `);
  return db;
}
const runNotify = (db) => db.exec(`select public.consume_event_accident_notify(e) from public.domain_events e where e.event_type = 'accident.reported' order by e.id`);
const runCase = (db) => db.exec(`select public.consume_event_accident_case_notify(e) from public.domain_events e where e.event_type = 'accident.closure_requested' order by e.id`);
const mailRows = (db) => all(db, `
  select w.organisation_id, w.event_type, w.status, w.recipient_count, w.payload,
         (select coalesce(array_agg(r ->> 'email' order by r ->> 'email'), '{}')
            from jsonb_array_elements(w.payload -> 'recipients') r where r ->> 'email' is not null) emails
    from public.workflow_notifications w order by w.event_id`);
const bell = (db) => all(db, `
  select n.user_id, n.type, n.title, n.body, n.entity_id from public.notifications n
   order by n.title, n.body, n.user_id`);

test('COM-1 BEFORE: an accident in a second company is e-mailed to the current company mailbox', async () => {
  const db = await accidentSetup();
  try {
    await runNotify(db);
    await runCase(db);
    const rows = await mailRows(db);
    const leaked = rows.filter(r => r.organisation_id === ORG_B);
    assert.equal(leaked.length, 2, 'both consumers queue mail for the tenant B accident');
    for (const r of leaked) assert.deepEqual(r.emails, [...OWNER_MAIL].sort(), 'recipients are the GLOBAL mailbox');
    // The event without an organisation notified every company's managers in the app.
    const stray = await all(db, `select user_id from public.notifications where entity_id = '${ACC_B}' and user_id = any($1)`,
      [[USERS.superA, USERS.adminA, USERS.mgrA]]);
    assert.ok(stray.length > 0, 'company A managers were notified about a tenant B case');
  } finally { await db.close(); }
});

test('COM-1 AFTER: mail is per organisation, and the current company queue is identical', async () => {
  const before = await accidentSetup();
  const after = await accidentSetup();
  try {
    await runNotify(before); await runCase(before);
    await after.exec(FOUNDATION); await after.exec(MAIL);
    await runNotify(after); await runCase(after);

    const a0 = (await mailRows(before)).filter(r => r.organisation_id === ORG_A);
    const a1 = (await mailRows(after)).filter(r => r.organisation_id === ORG_A);
    assert.equal(a0.length, 2);
    assert.deepEqual(a1, a0, 'current company: same queued payload, recipients, count and status');
    const bellA = (rows) => rows.filter(r => r.entity_id === ACC_A);
    assert.deepEqual(bellA(await bell(after)), bellA(await bell(before)), 'current company: same in-app notifications');

    const b1 = (await mailRows(after)).filter(r => r.organisation_id === ORG_B);
    assert.equal(b1.length, 0, 'tenant B has no mailbox configured, so nothing is queued');
    assert.equal((await one(after, `select count(*)::int n from public.workflow_notifications
      where payload::text like '%owner.test%' and organisation_id is distinct from '${ORG_A}'`)).n, 0);
    // In-app: the tenant B case reaches tenant B managers only, including the event with no organisation.
    const strayAfter = await all(after, `select user_id from public.notifications where entity_id = '${ACC_B}' and user_id = any($1)`,
      [[USERS.superA, USERS.adminA, USERS.mgrA]]);
    assert.equal(strayAfter.length, 0);
    assert.ok((await one(after, `select count(*)::int n from public.notifications where entity_id = '${ACC_B}' and user_id = '${USERS.adminB}'`)).n >= 1);
  } finally { await before.close(); await after.close(); }
});

test('COM-1 AFTER: a company with its own mailbox setting receives its own accidents only', async () => {
  const db = await accidentSetup();
  try {
    await db.exec(FOUNDATION); await db.exec(MAIL);
    await db.query(`insert into public.organisation_settings (organisation_id, key, value) values ($1, 'accident_mail', $2)`,
      [ORG_B, { enabled: true, to: 'fleet@tenant-b.test', cc: '', subject_prefix: '[B]' }]);
    await runNotify(db); await runCase(db);
    const rows = await mailRows(db);
    for (const r of rows.filter(x => x.organisation_id === ORG_B)) assert.deepEqual(r.emails, ['fleet@tenant-b.test']);
    for (const r of rows.filter(x => x.organisation_id === ORG_A)) assert.deepEqual(r.emails, [...OWNER_MAIL].sort());
    assert.equal(rows.filter(x => x.organisation_id === ORG_B).length, 3, 'one reported event and two closure events (one took its organisation from the accident)');
    const cfg = await one(db, `select source, emails_enabled from public.accident_mail_config(gen_random_uuid())`);
    assert.deepEqual(cfg, { source: 'none', emails_enabled: 'false' });
    assert.equal((await one(db, `select has_function_privilege('authenticated','public.accident_mail_config(uuid)','EXECUTE') p`)).p, false);
  } finally { await db.close(); }
});

test('COM-1: the migration refuses a consumer body it was not written against', async () => {
  const db = await accidentSetup();
  try {
    await db.exec(FOUNDATION);
    await db.exec(`create or replace function public.consume_event_accident_notify(ev public.domain_events)
      returns void language plpgsql as $$ begin return; end $$;`);
    await assert.rejects(db.exec(MAIL), /has changed since this draft was written/);
  } finally { await db.close(); }
});

// ── COM-2 ────────────────────────────────────────────────────────────────────────────────
const partsRequest = (db, uid, asset) => asUser(db, uid, () =>
  db.query(`insert into public.parts_requests (asset_no, part_name) values ($1, 'Filter')`, [asset]));
const partsBell = (db, asset) => all(db,
  `select user_id, type, title, body, entity_type from public.notifications where body like $1 order by user_id`, [`%${asset}%`]);
const ELEVATED_A = [USERS.superA, USERS.adminA, USERS.mgrA].sort();
const ELEVATED_B = [USERS.adminB, USERS.mgrB].sort();

test('COM-2 BEFORE: a parts request notifies the managers of every company', async () => {
  const db = await createCommercialDb();
  try {
    await partsRequest(db, USERS.mgrB, 'BX-9');
    const got = (await partsBell(db, 'BX-9')).map(r => r.user_id).sort();
    assert.deepEqual(got, [...ELEVATED_A, ...ELEVATED_B].sort(), 'company A managers see a tenant B request');
  } finally { await db.close(); }
});

test('COM-2 AFTER: only the row organisation is notified; the current company gets what it got', async () => {
  const before = await createCommercialDb();
  const after = await createCommercialDb();
  try {
    await after.exec(NOTIFY);
    for (const db of [before, after]) {
      await partsRequest(db, USERS.userA, 'TM-1');
      await partsRequest(db, USERS.mgrB, 'BX-9');
    }
    const forA = (rows) => rows.filter(r => ELEVATED_A.includes(r.user_id));
    assert.deepEqual(forA(await partsBell(after, 'TM-1')), forA(await partsBell(before, 'TM-1')),
      'current company managers: same notifications for their own request');
    assert.deepEqual((await partsBell(after, 'TM-1')).map(r => r.user_id).sort(), ELEVATED_A);
    assert.deepEqual((await partsBell(after, 'BX-9')).map(r => r.user_id).sort(), ELEVATED_B);
    // The old five-argument entry point never falls back to "everyone".
    await after.exec(`select public.notify_elevated_users('info', 'No context', 'orphan-call', 'other', null)`);
    assert.equal((await one(after, `select count(*)::int n from public.notifications where body = 'orphan-call'`)).n, 0);
    await after.exec(`select public.notify_elevated_users('info', 'By entity', 'entity-call', 'parts_request',
      (select id from public.parts_requests where asset_no = 'BX-9'))`);
    assert.deepEqual((await all(after, `select user_id from public.notifications where body = 'entity-call' order by 1`)).map(r => r.user_id), ELEVATED_B);
    const p = await one(after, `select has_function_privilege('authenticated','public.notify_elevated_users_in_org(uuid,text,text,text,text,uuid)','EXECUTE') a,
                                       has_function_privilege('authenticated','public.notify_elevated_users(text,text,text,text,uuid)','EXECUTE') b`);
    assert.deepEqual(p, { a: false, b: false });
  } finally { await before.close(); await after.close(); }
});

// ── COM-3 ────────────────────────────────────────────────────────────────────────────────
async function alertSetup() {
  const db = await createCommercialDb();
  await db.exec(`
    insert into public.tyre_records (organisation_id, serial_no, site, issue_date, risk_level) values
      ('${ORG_A}', 'A1', 'NHC', current_date - 400, 'High'),
      ('${ORG_A}', 'A2', 'NHC', current_date - 400, 'Critical'),
      ('${ORG_A}', 'A3', 'NHC', current_date - 5,   'Low');
    insert into public.accidents (organisation_id, reference_no, status) values
      ('${ORG_A}', 'ACC-A-1', 'reported'), ('${ORG_A}', 'ACC-A-2', 'reported'), ('${ORG_B}', 'ACC-B-1', 'reported');
    insert into public.inspections (organisation_id, site, asset_no, tyre_conditions) values
      ('${ORG_B}', 'DEPOT', 'BX-9', '{"FL":{"tread_depth_mm":"2.5"},"FR":{"tread_depth_mm":"9"},"RL":{"tread_depth_mm":"n/a"}}'),
      ('${ORG_A}', 'NHC',   'TM-1', '{"FL":{"tread_depth_mm":"1.0"}}');
  `);
  return db;
}
const rule = (db, user, org, name, metric, operator, threshold) => db.query(
  `insert into public.alert_thresholds (user_id, org_id, name, metric, operator, threshold) values ($1,$2,$3,$4,$5,$6)`,
  [user, org, name, metric, operator, threshold]);
const fired = (db) => all(db, `select user_id, title, body from public.notifications where type = 'threshold' order by title`);

test('COM-3 BEFORE: a tenant B rule counts company A rows, and a tread rule aborts the run', async () => {
  const db = await alertSetup();
  try {
    await rule(db, USERS.mgrB, ORG_B, 'B old tyres', 'tyre_age_days', 'gt', 100);
    await rule(db, USERS.mgrB, null, 'B open accidents', 'open_accidents', 'gte', 3);
    await db.exec('select public.evaluate_alert_thresholds()');
    const got = await fired(db);
    assert.equal(got.length, 2, 'tenant B has no old tyres and one accident, yet both rules fire');
    assert.match(got.find(r => r.title.endsWith('B old tyres')).body, /^2 record\(s\)/, "the count is company A's tyres");
    assert.match(got.find(r => r.title.endsWith('B open accidents')).body, /^3 record\(s\)/, 'the count spans both companies');
    await rule(db, USERS.mgrB, ORG_B, 'B tread', 'tread_depth', 'lt', 3);
    await assert.rejects(db.exec('select public.evaluate_alert_thresholds()'), /tread_depth/, 'inspections.tread_depth does not exist');
  } finally { await db.close(); }
});

test('COM-3 AFTER: each rule counts its own company; tread reads the real source; one bad rule cannot stop the run', async () => {
  const db = await alertSetup();
  try {
    await db.exec(ALERTS);
    await rule(db, USERS.mgrB, ORG_B, 'B old tyres', 'tyre_age_days', 'gt', 100);
    await rule(db, USERS.mgrB, null, 'B open accidents', 'open_accidents', 'gte', 1);
    await rule(db, USERS.mgrB, ORG_B, 'B tread', 'tread_depth', 'lt', 3);
    await rule(db, USERS.mgrB, ORG_B, 'B bad', 'pressure', 'lt', 3);
    await db.exec(`alter table public.inspections rename column pressure_reading to pressure_reading_gone`); // make one rule fail
    const res = (await one(db, 'select public.evaluate_alert_thresholds() r')).r;
    assert.deepEqual(res, { fired: 2, failed: 1, skipped: 0 });
    const got = await fired(db);
    assert.deepEqual(got.map(r => r.title).sort(), ['Threshold triggered: B open accidents', 'Threshold triggered: B tread']);
    assert.match(got.find(r => r.title.endsWith('B open accidents')).body, /^1 record\(s\)/, 'only tenant B accidents');
    assert.match(got.find(r => r.title.endsWith('B tread')).body, /^1 record\(s\)/, 'one tenant B inspection has a wheel under 3 mm');
  } finally { await db.close(); }
});

test('COM-3: a current company rule fires with the same text before and after', async () => {
  const before = await alertSetup();
  const after = await alertSetup();
  try {
    await after.exec(ALERTS);
    for (const db of [before, after]) {
      await rule(db, USERS.mgrA, ORG_A, 'A risk', 'high_risk_tyres', 'gte', 1);
      await rule(db, USERS.mgrA, ORG_A, 'A old tyres', 'tyre_age_days', 'gt', 100);
      await rule(db, USERS.mgrA, ORG_A, 'A overdue inspections', 'inspection_overdue_days', 'gt', 9999);
      await db.exec('select public.evaluate_alert_thresholds()');
    }
    assert.equal((await fired(before)).length, 2);
    assert.deepEqual(await fired(after), await fired(before));
    // A rule whose owner has no organisation cannot be scoped and is skipped, not run fleet wide.
    await after.exec(`insert into public.profiles (id, org_id, organisation_id, role) values ('30000000-0000-0000-0000-00000000000a', null, null, 'Manager')`);
    await rule(after, '30000000-0000-0000-0000-00000000000a', null, 'orphan', 'open_accidents', 'gte', 1);
    assert.equal((await one(after, 'select public.evaluate_alert_thresholds() r')).r.skipped, 1);
  } finally { await before.close(); await after.close(); }
});
