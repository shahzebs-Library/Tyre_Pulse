// COM-4 (MODA-1) tyre scrap marks and COM-5 (MODA-2) warranty claim numbers: keys that had no
// organisation. BEFORE uses the faithful copy of the live scrap function and the live constraints.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ORG_A, ORG_B, USERS, all, asUser, code, createCommercialDb, one, pendingMigration,
} from './fixtures/commercial_harness.mjs';

const GUARD = await pendingMigration('20261113154000_com_scrap_mark_org_guard.sql');
const PER_ORG = await pendingMigration('20261113154500_com_tyre_status_marks_per_org_key.sql');
const WARRANTY = await pendingMigration('20261113155000_com_warranty_claim_no_per_org.sql');

const T_A = 'aaaaaaaa-0000-0000-0000-0000000000a1';
const T_B = 'bbbbbbbb-0000-0000-0000-0000000000b1';

async function scrapSetup() {
  const db = await createCommercialDb();
  await db.exec(`
    insert into public.tyre_records (id, organisation_id, serial_no, country, status) values
      ('${T_A}', '${ORG_A}', 'SER-100', 'KSA', 'Active'),
      ('${T_B}', '${ORG_B}', 'ser-100', 'KSA', 'Removed');
  `);
  return db;
}
const scrap = (db, uid, serial, reason) => asUser(db, uid, async () =>
  (await db.query('select public.scrap_tyre_by_serial($1, $2) r', [serial, reason])).rows[0].r);
const marks = (db) => all(db, `select serial, mark_type, organisation_id, reason, created_by, prior_status
                                 from public.tyre_status_marks order by organisation_id, serial`);
const status = async (db, id) => (await one(db, 'select status from public.tyre_records where id = $1', [id])).status;

test('COM-4 BEFORE: a second company scrapping the same serial rewrites the first company mark', async () => {
  const db = await scrapSetup();
  try {
    assert.equal((await scrap(db, USERS.userA, 'SER-100', 'A: sidewall cut')).ok, true);
    assert.equal((await scrap(db, USERS.mgrB, 'SER-100', 'B: worn out')).ok, true);
    const m = await marks(db);
    assert.equal(m.length, 1, 'still one mark for the whole platform');
    assert.equal(m[0].organisation_id, ORG_A, 'the row still belongs to company A');
    assert.equal(m[0].reason, 'B: worn out', "but it now carries tenant B's reason");
    assert.equal(m[0].created_by, USERS.mgrB, "and tenant B's user");
    assert.equal(await status(db, T_B), 'Scrapped', 'tenant B tyre is Scrapped with no mark of its own');
  } finally { await db.close(); }
});

test('COM-4a AFTER step 1: the overwrite is refused and nothing of tenant B changes', async () => {
  const db = await scrapSetup();
  try {
    await db.exec(GUARD);
    assert.equal((await scrap(db, USERS.userA, 'SER-100', 'A: sidewall cut')).ok, true);
    const res = await scrap(db, USERS.mgrB, 'SER-100', 'B: worn out');
    assert.deepEqual(res, { ok: false, reason: 'serial_mark_conflict', serial: 'SER-100' });
    const m = await marks(db);
    assert.equal(m.length, 1);
    assert.equal(m[0].reason, 'A: sidewall cut', 'company A mark is untouched');
    assert.equal(m[0].created_by, USERS.userA);
    assert.equal(await status(db, T_B), 'Removed', 'tenant B tyre is not left Scrapped without a mark');
  } finally { await db.close(); }
});

test('COM-4a: the current company scrap, re-scrap and audit trail are identical before and after', async () => {
  const before = await scrapSetup();
  const after = await scrapSetup();
  try {
    await after.exec(GUARD);
    const out = [];
    for (const db of [before, after]) {
      const r1 = await scrap(db, USERS.userA, ' ser-100 ', 'first reason');
      const r2 = await scrap(db, USERS.mgrA, 'SER-100', 'second reason');
      const r3 = await scrap(db, USERS.mgrA, 'NO-SUCH', 'x');
      out.push({
        r1, r2, r3, marks: await marks(db), tyre: await status(db, T_A),
        audit: await all(db, 'select action, serial, old, new, country, org, actor from public.scrap_audit order by actor, action'),
      });
    }
    assert.deepEqual(out[1], out[0]);
    assert.equal(out[0].marks[0].reason, 'second reason');
    assert.deepEqual(out[0].marks[0].prior_status, { [T_A]: 'Active' }, 'the first prior status survives a re-scrap');
  } finally { await before.close(); await after.close(); }
});

test('COM-4b AFTER step 2: each company holds its own mark for the same serial', async () => {
  const db = await scrapSetup();
  try {
    await db.exec(GUARD);
    await assert.rejects(async () => {
      const fresh = await scrapSetup();
      try { await fresh.exec(PER_ORG); } finally { await fresh.close(); }
    }, /apply 20261113154000/, 'step 2 refuses to run before step 1');
    await db.exec(PER_ORG);
    assert.equal((await scrap(db, USERS.userA, 'SER-100', 'A: sidewall cut')).ok, true);
    assert.equal((await scrap(db, USERS.mgrB, 'SER-100', 'B: worn out')).ok, true);
    const m = await marks(db);
    assert.deepEqual(m.map(r => [r.organisation_id, r.reason, r.created_by]), [
      [ORG_A, 'A: sidewall cut', USERS.userA], [ORG_B, 'B: worn out', USERS.mgrB]]);
    assert.equal(await status(db, T_A), 'Scrapped');
    assert.equal(await status(db, T_B), 'Scrapped');
    assert.deepEqual(m[1].prior_status, { [T_B]: 'Removed' }, 'tenant B undo snapshot is its own');
    // The client dependency stated in the migration header: the old conflict target is gone.
    await assert.rejects(db.query(`insert into public.tyre_status_marks (serial, mark_type, organisation_id)
      values ('SER-200', 'returned', '${ORG_A}') on conflict (serial, mark_type) do nothing`), code('42P10'));
    await db.query(`insert into public.tyre_status_marks (serial, mark_type, organisation_id)
      values ('SER-200', 'returned', '${ORG_A}') on conflict (organisation_id, serial, mark_type) do nothing`);
    await assert.rejects(db.query(`insert into public.tyre_status_marks (serial, mark_type, organisation_id) values ('SER-300', 'returned', null)`), code('23502'));
  } finally { await db.close(); }
});

// ── COM-5 ────────────────────────────────────────────────────────────────────────────────
const YEAR = new Date().getFullYear();
const WAR = (n) => `WAR-${YEAR}-${String(n).padStart(5, '0')}`;
const claim = (db, uid, claimNo, country = 'KSA') => asUser(db, uid, async () => (await db.query(
  claimNo === undefined
    ? 'insert into public.warranty_claims (country, serial_number) values ($1, $2) returning claim_no'
    : 'insert into public.warranty_claims (country, serial_number, claim_no) values ($1, $2, $3) returning claim_no',
  claimNo === undefined ? [country, 'S'] : [country, 'S', claimNo])).rows[0].claim_no);

test('COM-5 BEFORE: the first claim of a second company in the same country is refused', async () => {
  const db = await createCommercialDb();
  try {
    assert.equal(await claim(db, USERS.userA, WAR(1)), WAR(1));
    await assert.rejects(claim(db, USERS.mgrB, WAR(1)), code('23505'), 'browser-minted number collides across companies');
  } finally { await db.close(); }
});

test('COM-5 AFTER: numbers are per organisation, minted server side when missing or taken', async () => {
  const db = await createCommercialDb();
  try {
    await db.exec(WARRANTY);
    assert.equal(await claim(db, USERS.userA, WAR(1)), WAR(1), 'current company: the browser number is kept as sent');
    assert.equal(await claim(db, USERS.mgrB, WAR(1)), WAR(1), 'tenant B gets its own 00001');
    assert.equal(await claim(db, USERS.mgrA, WAR(1)), WAR(2), 'a taken number is replaced by the next free one, not refused');
    assert.equal(await claim(db, USERS.mgrA, '  '), WAR(3), 'a blank number is minted');
    assert.equal(await claim(db, USERS.mgrA, WAR(1), 'UAE'), WAR(1), 'another country keeps its own sequence');
    assert.equal(await asUser(db, USERS.userA, async () => (await db.query("select public.next_warranty_claim_no('KSA') n")).rows[0].n), WAR(4));
    assert.equal(await asUser(db, USERS.mgrB, async () => (await db.query("select public.next_warranty_claim_no('KSA') n")).rows[0].n), WAR(2));
    const rows = await all(db, 'select organisation_id, country, claim_no from public.warranty_claims order by 1, 2, 3');
    assert.deepEqual(rows.map(r => [r.organisation_id, r.country, r.claim_no]), [
      [ORG_A, 'KSA', WAR(1)], [ORG_A, 'KSA', WAR(2)], [ORG_A, 'KSA', WAR(3)], [ORG_A, 'UAE', WAR(1)], [ORG_B, 'KSA', WAR(1)]]);
    const p = await one(db, `select has_function_privilege('authenticated','public._next_warranty_claim_no(uuid,text,date)','EXECUTE') internal,
                                    has_function_privilege('anon','public.next_warranty_claim_no(text)','EXECUTE') anon`);
    assert.deepEqual(p, { internal: false, anon: false });
    await db.exec(WARRANTY); // re-runnable
  } finally { await db.close(); }
});
