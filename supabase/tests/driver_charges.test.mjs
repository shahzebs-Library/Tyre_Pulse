import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const base = await read('20260912110325_driver_workspace_fines_and_assignments.sql');
const storage = await read('20260912110823_driver_fine_private_evidence_storage.sql');
const enterprise = await read('20260921134725_driver_fine_enterprise_workflows.sql');
const charges = await read('20261126170000_driver_charge_cases.sql');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const SIG = 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(1400);
const THIN_SIG = 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(120);
const monthPlus = n => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`; };
const thisMonth = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`; };
const nextMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`; };

// Actors: 2 manager (also holds the finance capability), 3 driver A, 4 driver B,
// 5 supervisor of driver A, 6 other tenant, 10 finance, 11 second manager.
test('driver charges are consented, separated, capped, appealable and immutable', async t => {
  const db = new PGlite(); let request = 1000;
  const command = async (action, payload, key = id(request++)) => (await db.query('select driver_workspace_command($1,$2,$3) r', [action, payload, key])).rows[0].r;
  const detail = async charge => (await db.query('select driver_charge_detail($1) r', [charge])).rows[0].r;
  const actor = async n => db.exec(`SET request.jwt.claim.sub='${id(n)}'`);
  const code = c => e => e.code === c;
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TABLE profiles(id uuid PRIMARY KEY,org_id uuid,full_name text,approved boolean DEFAULT true,locked boolean DEFAULT false,employee_id text,role text,username text);
      CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql AS $$ SELECT org_id FROM public.profiles WHERE id=auth.uid() $$;
      CREATE FUNCTION app_is_active() RETURNS boolean LANGUAGE sql AS $$ SELECT approved AND NOT locked FROM public.profiles WHERE id=auth.uid() $$;
      CREATE FUNCTION app_user_can(k text,c text) RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid()='${id(2)}'::uuid OR (auth.uid()='${id(11)}'::uuid AND NOT (k='driver_workspace' AND c='finance')) $$;
      CREATE FUNCTION app_is_elevated() RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid() IN ('${id(2)}'::uuid,'${id(11)}'::uuid) $$;
      CREATE FUNCTION app_can_see_country(c text) RETURNS boolean LANGUAGE sql AS $$ SELECT NOT (auth.uid()='${id(5)}'::uuid AND upper(coalesce(c,''))='UAE') $$;
      CREATE FUNCTION app_can_see_site(s text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION app_is_org_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid()='${id(2)}'::uuid $$;
      CREATE TABLE country_currency(country text PRIMARY KEY,currency text NOT NULL);
      INSERT INTO country_currency VALUES ('KSA','SAR'),('UAE','AED');
      CREATE FUNCTION app_sees_all_countries() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION app_sees_all_sites() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION app_country_scope() RETURNS text[] LANGUAGE sql AS $$ SELECT ARRAY['ksa'] $$;
      CREATE FUNCTION app_site_scope() RETURNS text[] LANGUAGE sql AS $$ SELECT ARRAY['JEDDAH'] $$;
      CREATE TABLE drivers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),driver_id text,driver_name text,country text,site text,organisation_id uuid,created_by uuid,status text DEFAULT 'active',custom_data jsonb);
      CREATE TABLE vehicle_fleet(id uuid PRIMARY KEY,organisation_id uuid,asset_no text,country text,site text,registration_no text);
      CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner_id text);
      CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
      CREATE TABLE wo_tasks(id uuid PRIMARY KEY,organisation_id uuid,assignee_user_id uuid,country text,site text,title text,status text,job_id uuid);
      CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,type text,title text,body text,entity_type text,entity_id text);
      CREATE TABLE system_config(key text PRIMARY KEY,value text,description text,category text,value_text text);
      CREATE TABLE accidents(id uuid PRIMARY KEY,organisation_id uuid,reference_no text,vehicle_id uuid,incident_date date,repair_cost numeric,country text,site text,asset_no text,
        driver_name text,description text,plate_number text,created_at timestamptz DEFAULT now());
      CREATE TABLE accident_liability_assessments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,accident_id uuid NOT NULL UNIQUE REFERENCES accidents(id) ON DELETE CASCADE,country text,site text,payer text,
        approved boolean NOT NULL DEFAULT false,approved_by uuid,approved_at timestamptz,locked boolean NOT NULL DEFAULT false,change_reason text,created_by uuid DEFAULT auth.uid(),
        field_audit jsonb NOT NULL DEFAULT '{}',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      GRANT SELECT,INSERT,UPDATE,DELETE ON accident_liability_assessments TO authenticated;
      ALTER TABLE accident_liability_assessments ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ala_all ON accident_liability_assessments FOR ALL USING (true) WITH CHECK (true);
      CREATE POLICY ala_country ON accident_liability_assessments AS RESTRICTIVE FOR SELECT USING (public.app_can_see_country(country));
      CREATE TABLE tyre_records(id uuid PRIMARY KEY,organisation_id uuid,serial_no text,asset_no text,job_card text,driver_name text,driver_id uuid,description text,country text,site text,created_at timestamptz DEFAULT now());
      CREATE TABLE driver_expenses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid DEFAULT public.app_current_org(),country text,driver_name text NOT NULL,category text,amount numeric,
        expense_date date,asset_no text,status text NOT NULL DEFAULT 'pending',description text,created_by uuid DEFAULT auth.uid(),created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      ALTER TABLE driver_expenses ENABLE ROW LEVEL SECURITY;
      CREATE POLICY driver_expenses_org_isolation ON driver_expenses AS RESTRICTIVE FOR ALL USING (organisation_id IS NOT DISTINCT FROM public.app_current_org()) WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());
      CREATE POLICY driver_expenses_read ON driver_expenses FOR SELECT USING (auth.uid() IS NOT NULL);
      CREATE POLICY driver_expenses_insert ON driver_expenses FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
      CREATE POLICY driver_expenses_update ON driver_expenses FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
      CREATE POLICY driver_expenses_delete ON driver_expenses FOR DELETE USING (auth.uid() IS NOT NULL);
      GRANT SELECT,INSERT,UPDATE,DELETE ON driver_expenses TO authenticated;
      INSERT INTO profiles(id,org_id,full_name,role) VALUES ('${id(2)}','${id(1)}','Manager','Manager'),('${id(3)}','${id(1)}','Driver A','Driver'),('${id(4)}','${id(1)}','Driver B','Driver'),
        ('${id(5)}','${id(1)}','Supervisor','Supervisor'),('${id(6)}','${id(9)}','Other tenant','Manager'),('${id(10)}','${id(1)}','Finance Reviewer','Finance'),('${id(11)}','${id(1)}','Second Manager','Manager');
      INSERT INTO vehicle_fleet(id,organisation_id,asset_no,country,site) VALUES ('${id(7)}','${id(1)}','TM1','KSA','JEDDAH');
      INSERT INTO accidents(id,organisation_id,reference_no,vehicle_id,incident_date,repair_cost,country,site) VALUES ('${id(40)}','${id(1)}','ACC-2026-0001','${id(7)}','2026-01-05',900,'KSA','JEDDAH');
      GRANT USAGE ON SCHEMA auth TO authenticated; GRANT SELECT ON profiles TO authenticated;
      BEGIN; ${base} ${storage} ${enterprise} ${charges} COMMIT; SET ROLE authenticated;`);

    await actor(2);
    const a = (await command('create_driver', { driver_id: 'EMP1', driver_name: 'Driver A', country: 'KSA', site: 'JEDDAH' })).driver_id;
    const b = (await command('create_driver', { driver_id: 'EMP2', driver_name: 'Driver B', country: 'KSA', site: 'JEDDAH' })).driver_id;
    await command('link_account', { driver_id: a, user_id: id(3), reason: 'Verified employee identity' });
    await command('link_account', { driver_id: b, user_id: id(4), reason: 'Verified employee identity' });
    await command('assign_team', { driver_id: a, supervisor_id: id(5), vehicle_id: id(7), reason: 'Assigned to shift team' });

    const issue = extra => command('charge_issue', { driver_id: a, category: 'missing_item', source_type: 'none', vehicle_id: id(7), basis: 'Fire extinguisher missing at handover, signed checklist shows it was issued.', amount: 300, currency: 'SAR', evidence: [{ kind: 'document', ref: 'checklist/123', label: 'Handover checklist' }], ...extra });
    let charge, version, liability, accepted;
    const refresh = async () => { const x = await detail(charge); version = x.charge.version; return x; };

    await t.test('supervisor issues; driver cannot issue; evidence or source required', async () => {
      await actor(3); await assert.rejects(issue(), code('42501'));
      await actor(5); await assert.rejects(issue({ evidence: [] }), code('22023'));
      charge = (await issue()).id; const x = await refresh();
      assert.match(x.charge.charge_no, /^DC-\d{4}-00001$/); assert.equal(x.charge.status, 'issued'); assert.equal(x.evidence.length, 1);
      await assert.rejects(db.query('update driver_charges set amount=1 where id=$1', [charge]), code('42501'));
      await assert.rejects(db.query('insert into driver_charges(organisation_id,charge_no,driver_id,country,site,category,source_type,basis,amount,currency,issued_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [id(1), 'X', a, 'KSA', 'JEDDAH', 'other', 'none', 'direct insert attempt', 1, 'SAR', id(5)]), code('42501'));
    });

    await t.test('edits are allowed before notification and refused after', async () => {
      await actor(5);
      await command('charge_correct', { driver_id: a, charge_id: charge, version, amount: 250, reason: 'Price list corrected' }); await refresh();
      await command('charge_notify', { driver_id: a, charge_id: charge, version }); const x = await refresh();
      assert.equal(x.charge.status, 'notified'); assert.ok(x.charge.notified_at); assert.equal(Number(x.charge.amount), 250);
      await assert.rejects(command('charge_correct', { driver_id: a, charge_id: charge, version, amount: 400, reason: 'Late change' }), code('42501'));
      await assert.rejects(command('charge_attach_evidence', { driver_id: a, charge_id: charge, version, kind: 'photo', ref: 'p/1', label: 'Late photo' }), code('42501'));
      await db.exec('RESET ROLE');
      await assert.rejects(db.query('update driver_charges set amount=1 where id=$1', [charge]), code('42501'));
      await assert.rejects(db.query('delete from driver_charges where id=$1', [charge]), code('42501'));
      await db.exec('SET ROLE authenticated');
    });

    await t.test('only the linked driver accepts, with consent text and signature', async () => {
      const accept = { driver_id: a, charge_id: charge, version, response: 'accept', statement_version: 'deduction-consent-v3', acknowledged: true, signature: SIG };
      await actor(4); await assert.rejects(command('charge_respond', accept), code('42501'));
      await actor(5); await assert.rejects(command('charge_respond', accept), code('42501'));
      await actor(3);
      await assert.rejects(command('charge_respond', { ...accept, statement_version: 'receipt-dispute-v2' }), code('22023'));
      await assert.rejects(command('charge_respond', { ...accept, signature: '<svg><script/></svg>' }), code('22023'));
      await assert.rejects(command('charge_respond', { ...accept, signature: THIN_SIG }), code('22023'));
      const dot = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><path d="M1 1 L2 2" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      await assert.rejects(command('charge_respond', { ...accept, signature: dot }), code('22023'));
      await command('charge_respond', accept);
      const x = await refresh();
      assert.equal(x.charge.status, 'accepted'); assert.equal(x.signatures[0].kind, 'driver_acceptance');
      assert.match(x.signatures[0].statement_text, /take this amount from my salary/); assert.equal(x.signatures[0].statement_language, 'en'); assert.ok(x.signatures[0].signed_at);
      assert.deepEqual(x.actions, []);
    });

    await t.test('issuer cannot supervisor-approve; same person cannot do supervisor and finance', async () => {
      await actor(5); await assert.rejects(command('charge_supervisor_review', { driver_id: a, charge_id: charge, version, decision: 'approve', reason: 'Own approval' }), code('42501'));
      await actor(2); await command('charge_supervisor_review', { driver_id: a, charge_id: charge, version, decision: 'approve', reason: 'Checklist confirms the item' }); await refresh();
      await assert.rejects(command('charge_finance_review', { driver_id: a, charge_id: charge, version, decision: 'approve', reason: 'Self finance approval' }), code('42501'));
      await actor(10); await command('charge_finance_review', { driver_id: a, charge_id: charge, version, decision: 'approve', reason: 'Amount verified with price list' }); await refresh();
      assert.equal((await detail(charge)).charge.status, 'finance_approved');
    });

    await t.test('appeal is decided by a third person only', async () => {
      await actor(3); await command('charge_appeal', { driver_id: a, charge_id: charge, version, reason: 'The extinguisher was in the cab locker, please recheck.' }); await refresh();
      const decide = { driver_id: a, charge_id: charge, version, outcome: 'upheld', reason: 'Locker checked, extinguisher not present.' };
      for (const n of [5, 2, 10, 3]) { await actor(n); await assert.rejects(command('charge_decide_appeal', decide), code('42501')); }
      await actor(11); await command('charge_decide_appeal', decide); const x = await refresh();
      assert.equal(x.charge.status, 'finance_approved'); assert.equal(x.appeal.outcome, 'upheld');
      await actor(3); await assert.rejects(command('charge_appeal', { driver_id: a, charge_id: charge, version, reason: 'Second appeal attempt here.' }), code('23505'));
    });

    await t.test('KSA instalments are capped at 5 days wage (Art 91) and must add up', async () => {
      await actor(10);
      const base = { driver_id: a, charge_id: charge, version, monthly_wage: 1200, wage_currency: 'SAR' };
      for (const bad of [{ monthly_wage: 'NaN' }, { monthly_wage: 'Infinity' }, { monthly_wage: 0 }, { monthly_wage: 5000000 }, { wage_currency: 'USD' }, { wage_currency: null }]) {
        await assert.rejects(command('charge_schedule', { ...base, ...bad, instalments: [{ due_month: thisMonth(), amount: 200 }, { due_month: nextMonth(), amount: 50 }] }), code('22023'));
      }
      await assert.rejects(command('charge_schedule', { ...base, instalments: [{ due_month: thisMonth(), amount: 'NaN' }] }), code('22023'));
      await assert.rejects(command('charge_schedule', { ...base, instalments: [{ due_month: thisMonth(), amount: 250 }] }), code('22023'));
      await assert.rejects(command('charge_schedule', { ...base, instalments: [{ due_month: thisMonth(), amount: 200 }] }), code('22023'));
      await command('charge_schedule', { ...base, instalments: [{ due_month: thisMonth(), amount: 200 }, { due_month: nextMonth(), amount: 50 }] });
      let x = await refresh(); assert.equal(x.charge.status, 'scheduled'); assert.equal(Number(x.charge.schedule_cap_amount), 200); assert.equal(x.instalments.length, 2);
      await assert.rejects(command('charge_record_deduction', { driver_id: a, charge_id: charge, version, instalment_id: x.instalments[1].id, payroll_reference: 'PR-2' }), code('22023'));
      await command('charge_record_deduction', { driver_id: a, charge_id: charge, version, instalment_id: x.instalments[0].id, payroll_reference: 'PR-1' });
      x = await refresh(); assert.equal(Number(x.charge.deducted_amount), 200);
      await actor(2); await assert.rejects(command('charge_reverse', { driver_id: a, charge_id: charge, version, reversal_code: 'wrong_amount', reason: 'Wrong price used for this item' }), code('PT409'));
    });

    await t.test('the monthly limit applies across all charges of the driver', async () => {
      await actor(5);
      const other = (await issue({ basis: 'Second item missing: first aid kit not returned at handover.', amount: 100 })).id;
      let v = (await detail(other)).charge.version;
      await command('charge_notify', { driver_id: a, charge_id: other, version: v }); v++;
      await actor(3); await command('charge_respond', { driver_id: a, charge_id: other, version: v, response: 'accept', statement_version: 'deduction-consent-v3', acknowledged: true, signature: SIG }); v++;
      await actor(2); await command('charge_supervisor_review', { driver_id: a, charge_id: other, version: v, decision: 'approve', reason: 'Kit missing per checklist' }); v++;
      await actor(10); await command('charge_finance_review', { driver_id: a, charge_id: other, version: v, decision: 'approve', reason: 'Price verified' }); v++;
      const base = { driver_id: a, charge_id: other, version: v, monthly_wage: 1200, wage_currency: 'SAR' };
      // this month already carries 200 from the first charge: 200 + 100 > 200
      await assert.rejects(command('charge_schedule', { ...base, instalments: [{ due_month: thisMonth(), amount: 100 }] }), e => e.code === '22023' && /across all charges/.test(e.message));
      // next month carries 50: 50 + 100 <= 200
      await command('charge_schedule', { ...base, instalments: [{ due_month: nextMonth(), amount: 100 }] });
      assert.equal((await detail(other)).charge.schedule_wage_currency, 'SAR');
    });

    await t.test('charges check currency, source ownership and scope, and refuse NULL choices', async () => {
      await actor(5);
      await assert.rejects(issue({ currency: 'USD' }), code('22023'));
      await assert.rejects(issue({ amount: 'NaN' }), code('22023'));
      await db.exec(`RESET ROLE;
        INSERT INTO accidents(id,organisation_id,reference_no,country,site,driver_name,description) VALUES
          ('${id(42)}','${id(1)}','ACC-2026-0042','KSA','JEDDAH','Driver B','Hit gate'),
          ('${id(43)}','${id(1)}','ACC-2026-0043','UAE','JEDDAH',null,'Other country'),
          ('${id(45)}','${id(1)}','ACC-2026-0045','KSA','JEDDAH','driver a','Mirror');
        SET ROLE authenticated;`);
      await actor(5);
      const found = await db.query("select driver_charge_sources('accident',$1,'',0) r", [a]);
      const ids = found.rows[0].r.map(r => r.id);
      assert.ok(ids.includes(id(45)) && ids.includes(id(40))); assert.ok(!ids.includes(id(42)), 'another driver'); assert.ok(!ids.includes(id(43)), 'another country');
      assert.equal((await db.query("select driver_charge_sources('accident',$1,'0000-000000000001',0) r", [a])).rows[0].r.length, 0, 'searches named columns only');
      assert.equal((await db.query("select driver_charge_sources('accident',$1,'Mirror',0) r", [a])).rows[0].r.length, 1);
      for (const src of [id(42), id(43)]) {
        await assert.rejects(command('charge_issue', { driver_id: a, category: 'accident_damage', source_type: 'accident', source_id: src, basis: 'Damage recorded on the accident case file.', amount: 100, currency: 'SAR' }), code('42501'));
      }
      const c = (await issue()).id; const v = (await detail(c)).charge.version;
      await assert.rejects(command('charge_correct', { driver_id: a, charge_id: c, version: v, incident_at: '2999-01-01T00:00:00Z', reason: 'Wrong date' }), code('22023'));
      await command('charge_notify', { driver_id: a, charge_id: c, version: v });
      await actor(3); await assert.rejects(command('charge_respond', { driver_id: a, charge_id: c, version: v + 1, statement_version: 'receipt-dispute-v2', acknowledged: true, explanation: 'No response chosen here', signature: SIG }), code('22023'));
      await command('charge_respond', { driver_id: a, charge_id: c, version: v + 1, response: 'accept', statement_version: 'deduction-consent-v3', acknowledged: true, signature: SIG });
      await actor(2); await assert.rejects(command('charge_supervisor_review', { driver_id: a, charge_id: c, version: v + 2, reason: 'No decision given' }), code('22023'));
      accepted = c;
      await actor(3);
      await assert.rejects(db.query('select * from driver_charge_signatures'), code('42501'));
      await assert.rejects(db.query("select private.driver_charge_setting('driver_charge_instalment_cap_pct',20)"), code('42501'));
    });

    await t.test('the month limit uses the lowest wage stated, so a higher wage cannot raise it', async () => {
      let v = (await detail(accepted)).charge.version;
      await actor(2); await command('charge_supervisor_review', { driver_id: a, charge_id: accepted, version: v, decision: 'approve', reason: 'Item missing per checklist' }); v++;
      await actor(10); await command('charge_finance_review', { driver_id: a, charge_id: accepted, version: v, decision: 'approve', reason: 'Price verified' }); v++;
      // next month already holds 150 scheduled on a 1200 wage (limit 5 days = 200); a 5000 wage must not lift that
      await assert.rejects(command('charge_schedule', { driver_id: a, charge_id: accepted, version: v, monthly_wage: 5000, wage_currency: 'SAR',
        instalments: [{ due_month: nextMonth(), amount: 60 }, { due_month: monthPlus(2), amount: 240 }] }), e => e.code === '22023' && /across all charges/.test(e.message));
      await command('charge_schedule', { driver_id: a, charge_id: accepted, version: v, monthly_wage: 5000, wage_currency: 'SAR', instalments: [{ due_month: monthPlus(2), amount: 300 }] });
      const events = (await detail(accepted)).events.filter(e => e.action === 'charge_schedule');
      assert.ok(events.length === 1 && events[0].details.monthly_wage === undefined, 'the wage is not copied into the shared event log');
    });

    await t.test('appeals end once a deduction is recorded (no refund step)', async () => {
      await actor(10); const before = await detail(accepted);
      await db.exec('RESET ROLE'); await db.query('update driver_charges set deducted_amount=10 where id=$1', [accepted]); await db.exec('SET ROLE authenticated');
      await actor(3); const x = await detail(accepted); assert.ok(!x.actions.includes('charge_appeal'));
      await assert.rejects(command('charge_appeal', { driver_id: a, charge_id: accepted, version: x.charge.version, reason: 'I want to appeal after the deduction.' }), code('PT409'));
      await db.exec('RESET ROLE'); await db.query('update driver_charges set deducted_amount=0 where id=$1', [accepted]); await db.exec('SET ROLE authenticated');
      assert.equal(before.charge.status, 'scheduled');
    });

    await t.test('large registers need a search and skip records naming another driver', async () => {
      await db.exec(`RESET ROLE; INSERT INTO tyre_records(id,organisation_id,serial_no,asset_no,driver_name,country,site) VALUES
        ('${id(70)}','${id(1)}','SER-100','TM1',null,'KSA','JEDDAH'),('${id(71)}','${id(1)}','SER-101','TM1','Driver B','KSA','JEDDAH'); SET ROLE authenticated;`);
      await actor(5);
      const src = async q => (await db.query("select driver_charge_sources('tyre_record',$1,$2,0) r", [a, q])).rows[0].r;
      assert.equal((await src('')).length, 0); assert.equal((await src('SE')).length, 0);
      assert.deepEqual((await src('SER')).map(r => r.id), [id(70)]);
      assert.equal((await src('SER'))[0].summary.driver_recorded, false);
    });

    await t.test('a traffic fine is charged only when approved and unpaid, and its payment step is then locked', async () => {
      await db.exec(`RESET ROLE;
        INSERT INTO driver_fines(id,organisation_id,driver_id,vehicle_id,country,site,authority,notice_reference,incident_at,amount,currency,description,assignment_reason,status,response_status,review_stage,created_by) VALUES
          ('${id(60)}','${id(1)}','${a}','${id(7)}','KSA','JEDDAH','Muroor','N-1',now()-interval '3 days',150,'SAR','Speeding on ring road','Driver on shift','open','approved','complete','${id(2)}'),
          ('${id(61)}','${id(1)}','${a}','${id(7)}','KSA','JEDDAH','Muroor','N-2',now()-interval '3 days',90,'SAR','Red light camera','Driver on shift','open','awaiting_response','driver','${id(2)}'),
          ('${id(62)}','${id(1)}','${b}','${id(7)}','KSA','JEDDAH','Muroor','N-3',now()-interval '3 days',90,'SAR','Parking','Driver on shift','open','approved','complete','${id(2)}');
        SET ROLE authenticated;`);
      await actor(5);
      const fine = (src, extra = {}) => command('charge_issue', { driver_id: a, category: 'traffic_fine', source_type: 'driver_fine', source_id: src, basis: 'Traffic fine recovered from the driver as agreed.', amount: 150, currency: 'SAR', ...extra });
      await assert.rejects(fine(id(61), { amount: 90 }), code('22023'));
      await assert.rejects(fine(id(62), { amount: 90 }), code('42501'));
      await assert.rejects(fine(id(60), { amount: 151 }), code('22023'));
      const listed = (await db.query("select driver_charge_sources('driver_fine',$1,'',0) r", [a])).rows[0].r.map(r => r.id);
      assert.deepEqual(listed, [id(60)]);
      const c = (await fine(id(60))).id;
      await db.exec('RESET ROLE');
      assert.equal((await db.query('select recovery_charge_id from driver_fines where id=$1', [id(60)])).rows[0].recovery_charge_id, c);
      await assert.rejects(db.query('update driver_fines set paid_amount=150 where id=$1', [id(60)]), code('42501'));
      await db.exec('SET ROLE authenticated');
      await actor(2); await command('charge_waive', { driver_id: a, charge_id: c, version: (await detail(c)).charge.version, reason: 'Fine paid directly by the driver' });
      await db.exec('RESET ROLE');
      const f = (await db.query('select recovery_charge_id,paid_amount from driver_fines where id=$1', [id(60)])).rows[0];
      assert.equal(f.recovery_charge_id, null); assert.equal(Number(f.paid_amount), 0);
      await db.query('update driver_fines set paid_amount=150 where id=$1', [id(60)]);
      await db.exec('SET ROLE authenticated');
    });

    await t.test('refusal needs a witness; disputed charge cannot be scheduled inside the appeal window', async () => {
      await actor(5);
      const second = (await issue({ basis: 'Side mirror broken at handover, photo attached by the gate officer.', amount: 120 })).id;
      let v = (await detail(second)).charge.version;
      await command('charge_notify', { driver_id: a, charge_id: second, version: v }); v++;
      await assert.rejects(command('charge_record_refusal', { driver_id: a, charge_id: second, version: v, reason: 'Presented at gate office' }), code('22023'));
      await assert.rejects(command('charge_record_refusal', { driver_id: a, charge_id: second, version: v, witness_name: 'Gate Officer', reason: 'Presented at gate office' }), code('22023'));
      await assert.rejects(command('charge_record_refusal', { driver_id: a, charge_id: second, version: v, witness_name: 'Self', witness_user_id: id(5), witness_signature: SIG, reason: 'Presented at gate office' }), code('22023'));
      await assert.rejects(command('charge_record_refusal', { driver_id: a, charge_id: second, version: v, witness_user_id: id(3), reason: 'Presented at gate office' }), code('22023'));
      await assert.rejects(command('charge_record_refusal', { driver_id: a, charge_id: second, version: v, witness_user_id: id(4), reason: 'Presented at gate office' }), e => e.code === '22023' && /access/.test(e.message));
      await command('charge_record_refusal', { driver_id: a, charge_id: second, version: v, witness_user_id: id(2), reason: 'Presented at gate office' }); v++;
      await command('charge_record_refusal', { driver_id: a, charge_id: second, version: v, witness_user_id: id(11), reason: 'Presented at gate office, second witness' }); v++;
      await actor(2); await assert.rejects(command('charge_witness_confirm', { driver_id: a, charge_id: second, version: v, statement_version: 'refusal-witness-v2', acknowledged: true, signature: SIG }), code('42501'));
      await actor(5);
      let x = await detail(second); assert.equal(x.charge.status, 'notified', 'one person alone cannot make a refusal count'); assert.equal(x.signatures.length, 0);
      await actor(2); await assert.rejects(command('charge_supervisor_review', { driver_id: a, charge_id: second, version: v, decision: 'approve', reason: 'Too early review' }), code('PT409'));
      const confirm = { driver_id: a, charge_id: second, version: v, statement_version: 'refusal-witness-v2', acknowledged: true, signature: SIG };
      for (const n of [5, 10, 2]) { await actor(n); await assert.rejects(command('charge_witness_confirm', confirm), code('42501')); }
      await actor(11); assert.ok((await detail(second)).actions.includes('charge_witness_confirm'));
      await assert.rejects(command('charge_witness_confirm', { ...confirm, acknowledged: false }), code('22023'));
      await command('charge_witness_confirm', confirm); v++;
      x = await detail(second); assert.equal(x.charge.status, 'refused'); assert.equal(x.signatures[0].kind, 'refusal_witness'); assert.equal(x.signatures[0].signer_id, id(11));
      await assert.rejects(command('charge_supervisor_review', { driver_id: a, charge_id: second, version: v, decision: 'approve', reason: 'Witness approving' }), code('42501'));
      await actor(2); await command('charge_supervisor_review', { driver_id: a, charge_id: second, version: v, decision: 'return', reason: 'Present the notice again in Arabic' }); v++;
      x = await detail(second); assert.equal(x.charge.status, 'notified'); assert.equal(x.charge.refusal_witness_id, null); assert.equal(x.charge.refusal_recorded_by, null);
      await actor(5); await command('charge_record_refusal', { driver_id: a, charge_id: second, version: v, witness_user_id: id(11), reason: 'Presented again in Arabic, refused' }); v++;
      await actor(11); await command('charge_witness_confirm', { ...confirm, version: v }); v++;
      await actor(2); await command('charge_supervisor_review', { driver_id: a, charge_id: second, version: v, decision: 'approve', reason: 'Gate photo confirms damage' }); v++;
      await actor(10); await command('charge_finance_review', { driver_id: a, charge_id: second, version: v, decision: 'approve', reason: 'Quote checked' }); v++;
      await assert.rejects(command('charge_schedule', { driver_id: a, charge_id: second, version: v, monthly_wage: 1200, wage_currency: 'SAR', instalments: [{ due_month: thisMonth(), amount: 120 }] }), code('22023'));
    });

    await t.test('wrongly issued charge is reversed and reissued with lineage, never edited', async () => {
      await db.exec(`RESET ROLE; INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES
        ('tyre-photos','modules/driver-charge/abc/1_0_x.jpg','${id(5)}'),('tyre-photos','modules/driver-charge/abc/2_0_y.jpg','${id(11)}'),
        ('tyre-photos','modules/driver-charge/abc/3_0_z.jpg','${id(11)}'),('tyre-photos','modules/driver-charge/abc/4_0_w.jpg','${id(5)}');
        SET ROLE authenticated;`);
      await actor(5);
      const thirdIssue = { driver_id: a, category: 'accident_damage', source_type: 'accident', source_id: id(40), basis: 'Rear bumper damage recorded on accident ACC-2026-0001.', amount: 500, currency: 'SAR', evidence: [{ kind: 'photo', ref: 'tp-storage://tyre-photos/modules/driver-charge/abc/1_0_x.jpg', label: 'Rear bumper' }] };
      await assert.rejects(command('charge_issue', thirdIssue), e => e.code === '22023' && /does not name a driver/.test(e.message));
      const third = (await command('charge_issue', { ...thirdIssue, link_unverified: true })).id;
      assert.equal((await detail(third)).charge.source_link_unverified, true);
      await assert.rejects(command('charge_issue', { driver_id: a, category: 'accident_damage', source_type: 'accident', source_id: id(40), basis: 'Duplicate of the same accident charge.', amount: 500, currency: 'SAR', link_unverified: true }), code('23505'));
      let v = (await detail(third)).charge.version;
      await command('charge_notify', { driver_id: a, charge_id: third, version: v }); v++;
      await actor(2);
      const r = await command('charge_reverse', { driver_id: a, charge_id: third, version: v, reversal_code: 'wrong_driver', reason: 'Shift log shows Driver B drove that day', reissue: { driver_id: b } });
      const old = await detail(third); assert.equal(old.charge.status, 'cancelled_wrongly_issued'); assert.equal(old.charge.superseded_by_charge_id, r.replacement_charge_id);
      const fresh = await detail(r.replacement_charge_id); assert.equal(fresh.charge.driver_id, b); assert.equal(fresh.charge.source_link_unverified, true); assert.equal(fresh.charge.status, 'issued'); assert.equal(fresh.charge.supersedes_charge_id, third);
      await actor(3); await assert.rejects(detail(r.replacement_charge_id), code('42501'));
    });

    await t.test('KSA labour law: photos, statement languages, 5 day caps, 50% total, 15 working day objection', async () => {
      const rule = async c => (await db.query('select private.driver_charge_country_rule($1) r', [c])).rows[0].r;
      await db.exec('RESET ROLE');
      assert.equal((await rule('KSA')).statutory, true); assert.equal((await rule('UAE')).statutory, false); assert.equal((await rule('UAE')).needs_legal_confirmation, true);
      // Thu 2026-11-26 + 15 working days (Sun-Thu) = Thu 2026-12-17, window closes at the end of that day in Riyadh.
      assert.equal(new Date((await db.query("select private.driver_charge_working_deadline('2026-11-26T09:00:00+03:00', 15) r")).rows[0].r).toISOString(), '2026-12-17T21:00:00.000Z');
      await db.exec(`INSERT INTO driver_fines(id,organisation_id,driver_id,vehicle_id,country,site,authority,notice_reference,incident_at,amount,currency,description,assignment_reason,status,response_status,review_stage,created_by) VALUES
          ('${id(63)}','${id(1)}','${b}','${id(7)}','KSA','JEDDAH','Muroor','N-63',now()-interval '3 days',400,'SAR','Speeding','Driver on shift','open','approved','complete','${id(2)}'),
          ('${id(64)}','${id(1)}','${b}','${id(7)}','KSA','JEDDAH','Muroor','N-64',now()-interval '3 days',600,'SAR','Speeding twice','Driver on shift','open','approved','complete','${id(2)}');
        SET ROLE authenticated;`);
      const photo = { kind: 'photo', ref: 'tp-storage://tyre-photos/modules/driver-charge/abc/2_0_y.jpg', label: 'Damage photo' };
      const photo2 = { kind: 'photo', ref: 'tp-storage://tyre-photos/modules/driver-charge/abc/3_0_z.jpg', label: 'Damage photo' };
      const open = async (fields, response = 'accept', lang = 'en') => {
        await actor(11); const c = (await command('charge_issue', { driver_id: b, basis: 'Charge recorded for the KSA labour law test case.', currency: 'SAR', source_type: 'none', evidence: [{ kind: 'document', ref: 'doc/1', label: 'Record' }], ...fields })).id;
        let v = (await detail(c)).charge.version;
        await command('charge_notify', { driver_id: b, charge_id: c, version: v }); v++;
        await actor(4); await command('charge_respond', { driver_id: b, charge_id: c, version: v, response, statement_version: response === 'accept' ? 'deduction-consent-v3' : 'receipt-dispute-v2', statement_language: lang, acknowledged: true, explanation: 'I was not driving this vehicle that day.', signature: SIG }); v++;
        await actor(2); await command('charge_supervisor_review', { driver_id: b, charge_id: c, version: v, decision: 'approve', reason: 'Evidence reviewed' }); v++;
        await actor(10); await command('charge_finance_review', { driver_id: b, charge_id: c, version: v, decision: 'approve', reason: 'Amount verified' }); v++;
        return { c, v };
      };
      const schedule = (c, v, instalments, wage = 3000) => command('charge_schedule', { driver_id: b, charge_id: c, version: v, monthly_wage: wage, wage_currency: 'SAR', instalments });

      // A damage charge cannot reach the driver without a photo; a photo must be an uploaded private file.
      await actor(11);
      const noPhoto = (await command('charge_issue', { driver_id: b, category: 'tyre_damage', source_type: 'none', basis: 'Tyre sidewall cut from kerb strike on the yard exit.', amount: 100, currency: 'SAR', evidence: [{ kind: 'document', ref: 'doc/2', label: 'Report' }] })).id;
      await assert.rejects(command('charge_notify', { driver_id: b, charge_id: noPhoto, version: (await detail(noPhoto)).charge.version }), e => e.code === '22023' && /photo/.test(e.message));
      await assert.rejects(command('charge_attach_evidence', { driver_id: b, charge_id: noPhoto, version: (await detail(noPhoto)).charge.version, kind: 'photo', ref: 'https://example.com/x.jpg', label: 'Public URL' }), code('22023'));
      // A photo someone else uploaded cannot be attached by naming its path.
      await assert.rejects(command('charge_attach_evidence', { driver_id: b, charge_id: noPhoto, version: (await detail(noPhoto)).charge.version, kind: 'photo', ref: 'tp-storage://tyre-photos/modules/driver-charge/abc/4_0_w.jpg', label: 'Not mine' }), e => e.code === '42501' && /you uploaded/.test(e.message));
      await command('charge_attach_evidence', { driver_id: b, charge_id: noPhoto, version: (await detail(noPhoto)).charge.version, ...photo });
      await command('charge_notify', { driver_id: b, charge_id: noPhoto, version: (await detail(noPhoto)).charge.version });
      await actor(4);
      const seen = await detail(noPhoto);
      assert.equal(seen.evidence.filter(e => e.kind === 'photo').length, 1, 'the driver sees the photo before answering');
      assert.ok(seen.statements['deduction-consent-v3'].ar && seen.statements['deduction-consent-v3'].ur);
      assert.ok(seen.statements['deduction-consent-v3'].en.includes('100.00 SAR'), 'the consent names the total');
      assert.ok(!seen.statements['deduction-consent-v3'].ur.includes('{amount}'));
      assert.equal(seen.settings.country_rule.rule, 'ksa_labour_law');
      assert.ok(!('needs_legal_confirmation' in seen.settings.country_rule), 'the legal caveat is for staff only');
      await assert.rejects(command('charge_respond', { driver_id: b, charge_id: noPhoto, version: seen.charge.version, response: 'accept', statement_version: 'deduction-consent-v3', statement_language: 'fr', acknowledged: true, signature: SIG }), code('22023'));
      await command('charge_respond', { driver_id: b, charge_id: noPhoto, version: seen.charge.version, response: 'accept', statement_version: 'deduction-consent-v3', statement_language: 'ar', acknowledged: true, signature: SIG });
      const signedAr = (await detail(noPhoto)).signatures[0];
      assert.equal(signedAr.statement_language, 'ar'); assert.equal(signedAr.statement_text, seen.statements['deduction-consent-v3'].ar);
      assert.ok(signedAr.statement_text.includes('100.00 SAR'), 'the stored words carry the amount');

      // Damage (Art 91): one instalment at most 5 days wage (3000 / 30 * 5 = 500).
      const dmg = await open({ category: 'missing_item', amount: 600 });
      await assert.rejects(schedule(dmg.c, dmg.v, [{ due_month: thisMonth(), amount: 600 }]), code('22023'));
      await schedule(dmg.c, dmg.v, [{ due_month: thisMonth(), amount: 500 }, { due_month: nextMonth(), amount: 100 }]);
      let x = await detail(dmg.c); assert.equal(Number(x.charge.schedule_cap_amount), 500); assert.equal(x.charge.schedule_rule, 'ksa_labour_law');
      // A government traffic fine recovered from the driver is an Art 92 deduction: with his consent it
      // counts only against the half-wage total, so 500 damage + 400 fine in one month is allowed.
      const fine = await open({ category: 'traffic_fine', source_type: 'driver_fine', source_id: id(63), amount: 400, evidence: [] });
      assert.equal((await detail(fine.c)).settings.bucket, 'consent');
      await schedule(fine.c, fine.v, [{ due_month: thisMonth(), amount: 400 }]);
      // Without his consent a traffic fine is never deducted (Art 92), even after the window.
      const refusedFine = await open({ category: 'traffic_fine', source_type: 'driver_fine', source_id: id(64), amount: 600, evidence: [] }, 'dispute');
      await assert.rejects(schedule(refusedFine.c, refusedFine.v, [{ due_month: monthPlus(3), amount: 600 }]), e => e.code === '22023' && /Article 92/.test(e.message));
      // All deductions together at most half the wage (Art 93): 500 + 400 + 700 > 1500 in this month.
      const consent = await open({ category: 'other', amount: 1000 });
      await assert.rejects(schedule(consent.c, consent.v, [{ due_month: thisMonth(), amount: 700 }, { due_month: nextMonth(), amount: 300 }]), e => e.code === '22023' && /Article 93/.test(e.message) && /across all charges/.test(e.message));
      await schedule(consent.c, consent.v, [{ due_month: thisMonth(), amount: 600 }, { due_month: nextMonth(), amount: 400 }]);

      // Without consent: only damage, only after 15 working days, never another category (Art 92).
      // The deadline is stamped on the charge at finance approval; tests move it into the past directly.
      const shiftBack = async c => {
        await db.exec('RESET ROLE; ALTER TABLE driver_charges DISABLE TRIGGER driver_charges_guard');
        await db.query("update driver_charges set objection_deadline = now() - interval '1 day' where id = $1", [c]);
        await db.exec('ALTER TABLE driver_charges ENABLE TRIGGER driver_charges_guard; SET ROLE authenticated');
      };
      const disputedOther = await open({ category: 'other', amount: 100 }, 'dispute', 'ur');
      await shiftBack(disputedOther.c); await actor(10);
      const otherDetail = await detail(disputedOther.c);
      assert.equal(otherDetail.settings.schedule_block.code, 'consent_required'); assert.equal(otherDetail.settings.schedule_block.article, '92');
      assert.ok(!otherDetail.actions.includes('charge_schedule'), 'never offer a schedule the server refuses');
      await assert.rejects(schedule(disputedOther.c, disputedOther.v, [{ due_month: monthPlus(5), amount: 100 }]), e => e.code === '22023' && /Article 92/.test(e.message));
      const disputedDamage = await open({ category: 'accident_damage', source_type: 'accident', source_id: id(42), amount: 300, evidence: [photo2] }, 'dispute');
      await assert.rejects(schedule(disputedDamage.c, disputedDamage.v, [{ due_month: monthPlus(5), amount: 300 }]), e => e.code === '22023' && /15 working days/.test(e.message));
      const inWindow = await detail(disputedDamage.c);
      assert.equal(inWindow.settings.schedule_block.code, 'window_open'); assert.ok(!inWindow.actions.includes('charge_schedule'));
      const dd = (await detail(disputedDamage.c)).settings; assert.ok(dd.objection_deadline); assert.match(dd.objection_last_day, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(new Date((await detail(disputedDamage.c)).charge.objection_deadline).toISOString(), new Date(dd.objection_deadline).toISOString(), 'stamped on the charge');
      await db.exec('RESET ROLE');
      await assert.rejects(db.query("update driver_charges set objection_deadline = objection_deadline + interval '3 days' where id = $1", [disputedDamage.c]), code('42501'));
      await db.exec('SET ROLE authenticated');
      await shiftBack(disputedDamage.c); await actor(10);
      const afterWindow = await detail(disputedDamage.c);
      assert.equal(afterWindow.settings.schedule_block, null); assert.ok(afterWindow.actions.includes('charge_schedule'));
      await schedule(disputedDamage.c, disputedDamage.v, [{ due_month: monthPlus(5), amount: 300 }]);
      assert.equal((await detail(disputedDamage.c)).charge.status, 'scheduled');
    });

    await t.test('outside KSA: configured percent cap and 7 day window (needs legal confirmation)', async () => {
      await db.exec(`RESET ROLE;
        CREATE OR REPLACE FUNCTION app_country_scope() RETURNS text[] LANGUAGE sql AS $$ SELECT ARRAY['ksa','uae'] $$;
        INSERT INTO profiles(id,org_id,full_name,role) VALUES ('${id(12)}','${id(1)}','Driver C','Driver');
        SET ROLE authenticated;`);
      await actor(2);
      const c = (await command('create_driver', { driver_id: 'EMP3', driver_name: 'Driver C', country: 'UAE', site: 'JEDDAH' })).driver_id;
      await command('link_account', { driver_id: c, user_id: id(12), reason: 'Verified employee identity' });
      const open = async (fields, response) => {
        await actor(11); const ch = (await command('charge_issue', { driver_id: c, basis: 'Charge recorded for the UAE test case here.', currency: 'AED', source_type: 'none', evidence: [{ kind: 'document', ref: 'doc/9', label: 'Record' }], ...fields })).id;
        let v = (await detail(ch)).charge.version;
        await command('charge_notify', { driver_id: c, charge_id: ch, version: v }); v++;
        await actor(12); await command('charge_respond', { driver_id: c, charge_id: ch, version: v, response, statement_version: response === 'accept' ? 'deduction-consent-v3' : 'receipt-dispute-v2', statement_language: 'en', acknowledged: true, explanation: 'I did not lose this item at all.', signature: SIG }); v++;
        await actor(2); await command('charge_supervisor_review', { driver_id: c, charge_id: ch, version: v, decision: 'approve', reason: 'Evidence reviewed' }); v++;
        await actor(10); await command('charge_finance_review', { driver_id: c, charge_id: ch, version: v, decision: 'approve', reason: 'Amount verified' }); v++;
        return { ch, v };
      };
      const schedule = (ch, v, instalments) => command('charge_schedule', { driver_id: c, charge_id: ch, version: v, monthly_wage: 3000, wage_currency: 'AED', instalments });
      const accepted = await open({ category: 'missing_item', amount: 700 }, 'accept');
      const rule = (await detail(accepted.ch)).settings.country_rule;
      assert.equal(rule.statutory, false); assert.equal(rule.needs_legal_confirmation, true, 'staff see the caveat');
      await actor(12); assert.ok(!('needs_legal_confirmation' in (await detail(accepted.ch)).settings.country_rule), 'the driver does not');
      await actor(10);
      // 20% of 3000 = 600 per month, not the KSA 5 days (500).
      await assert.rejects(schedule(accepted.ch, accepted.v, [{ due_month: thisMonth(), amount: 700 }]), code('22023'));
      await schedule(accepted.ch, accepted.v, [{ due_month: thisMonth(), amount: 600 }, { due_month: nextMonth(), amount: 100 }]);
      let x = await detail(accepted.ch); assert.equal(x.charge.schedule_rule, 'company_setting'); assert.equal(Number(x.charge.schedule_cap_amount), 600);
      // A disputed "other" charge is not refused outright outside KSA: after 7 calendar days it can be scheduled.
      const disputed = await open({ category: 'other', amount: 100 }, 'dispute');
      x = await detail(disputed.ch);
      assert.equal(x.settings.schedule_block.code, 'window_open'); assert.ok(!x.actions.includes('charge_schedule'));
      await assert.rejects(schedule(disputed.ch, disputed.v, [{ due_month: monthPlus(3), amount: 100 }]), e => e.code === '22023' && /appeal period/.test(e.message));
      await db.exec('RESET ROLE; ALTER TABLE driver_charges DISABLE TRIGGER driver_charges_guard');
      await db.query("update driver_charges set objection_deadline = now() - interval '1 day' where id = $1", [disputed.ch]);
      await db.exec('ALTER TABLE driver_charges ENABLE TRIGGER driver_charges_guard; SET ROLE authenticated');
      await actor(10); x = await detail(disputed.ch);
      assert.equal(x.settings.schedule_block, null); assert.ok(x.actions.includes('charge_schedule'));
      await schedule(disputed.ch, disputed.v, [{ due_month: monthPlus(3), amount: 100 }]);
      await db.exec(`RESET ROLE; CREATE OR REPLACE FUNCTION app_country_scope() RETURNS text[] LANGUAGE sql AS $$ SELECT ARRAY['ksa'] $$; SET ROLE authenticated;`);
    });

    await t.test('charge photos are readable only by people who can see the charge', async () => {
      const name = 'modules/driver-charge/abc/2_0_y.jpg';
      await db.exec(`RESET ROLE;
        CREATE POLICY test_storage_read ON storage.objects FOR SELECT TO authenticated USING (true);
        INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES
          ('tyre-photos','modules/driver-charge/sup/unattached.jpg','${id(5)}'),('tyre-photos','modules/wash/w.jpg','${id(5)}');
        SET ROLE authenticated;`);
      const visible = async (n, obj) => { await actor(n); return (await db.query('select count(*)::int n from storage.objects where name=$1', [obj])).rows[0].n; };
      assert.equal(await visible(4, name), 1, 'the driver of the charge');
      assert.equal(await visible(11, name), 1, 'the uploader');
      assert.equal(await visible(2, name), 1, 'organisation admin / manager');
      assert.equal(await visible(10, name), 1, 'finance');
      assert.equal(await visible(3, name), 0, 'another driver');
      assert.equal(await visible(5, name), 0, 'a supervisor of another driver');
      assert.equal(await visible(6, name), 0, 'another tenant');
      assert.equal(await visible(5, 'modules/driver-charge/sup/unattached.jpg'), 1, 'own upload before it is attached');
      assert.equal(await visible(4, 'modules/driver-charge/sup/unattached.jpg'), 0);
      assert.equal(await visible(3, 'modules/wash/w.jpg'), 1, 'other paths keep the bucket rule');
      await db.exec('RESET ROLE; DROP POLICY test_storage_read ON storage.objects; SET ROLE authenticated;');
    });

    await t.test('admin-maintained public holidays: skipped by the counter, one country spelling, past days locked, audited', async () => {
      // A Thursday at least a week ahead, so the dates stay in the future whenever the test runs.
      const day = n => { const d = new Date(Date.now() + 3 * 3600e3); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return d; };
      let base = 7; while (day(base).getUTCDay() !== 4) base++;
      const iso = n => day(base + n).toISOString().slice(0, 10);
      const end = n => new Date(day(base + n).getTime() + 21 * 3600e3).toISOString(); // end of that day in Riyadh
      const deadline = async (country = 'KSA') => new Date((await db.query(`select private.driver_charge_working_deadline('${iso(0)}T09:00:00+03:00', 15, '${country}', '${id(1)}') r`)).rows[0].r).toISOString();
      await db.exec('RESET ROLE'); assert.equal(await deadline(), end(21), 'Thu + 15 working days (Sun-Thu) = Thu three weeks later; empty by default'); await db.exec('SET ROLE authenticated');
      await actor(5); await assert.rejects(db.query(`insert into driver_charge_holidays(country,holiday,label) values ('KSA','${iso(5)}','Test holiday')`), code('42501'));
      await actor(2);
      await db.query(`insert into driver_charge_holidays(country,holiday,label) values ('Saudi Arabia','${iso(5)}','Test holiday')`);
      assert.equal((await db.query('select country from driver_charge_holidays')).rows[0].country, 'KSA', 'stored under the one country spelling');
      await assert.rejects(db.query("insert into driver_charge_holidays(country,holiday,label) values ('KSA','2020-01-01','Past')"), code('22023'));
      await actor(5); assert.equal((await db.query('select count(*)::int n from driver_charge_holidays')).rows[0].n, 1, 'everyone in the organisation can read the list');
      await db.exec('RESET ROLE');
      assert.equal(await deadline(), end(24), 'the Tuesday holiday is skipped, the window ends on the Sunday after');
      assert.equal(await deadline('SA'), end(24), 'SA is the same country as KSA');
      assert.equal(await deadline('UAE'), end(21), 'a KSA holiday does not move a UAE window');
      // A day already in the past can no longer be changed or removed.
      await db.exec('ALTER TABLE driver_charge_holidays DISABLE TRIGGER driver_charge_holidays_guard');
      await db.query(`insert into driver_charge_holidays(organisation_id,country,holiday,label) values ('${id(1)}','KSA','2020-01-01','Past')`);
      await db.exec('ALTER TABLE driver_charge_holidays ENABLE TRIGGER driver_charge_holidays_guard; SET ROLE authenticated');
      await actor(2);
      await assert.rejects(db.query("delete from driver_charge_holidays where holiday = '2020-01-01'"), code('42501'));
      await assert.rejects(db.query("update driver_charge_holidays set label = 'x' where holiday = '2020-01-01'"), code('42501'));
      await db.query(`delete from driver_charge_holidays where holiday = '${iso(5)}'`);
      const ev = (await db.query('select action from driver_charge_holiday_events order by created_at, action')).rows.map(r => r.action);
      assert.deepEqual(ev.sort(), ['delete', 'insert'], 'every change is kept');
      await db.exec('RESET ROLE'); await db.exec('ALTER TABLE driver_charge_holidays DISABLE TRIGGER driver_charge_holidays_guard');
      await db.query('delete from driver_charge_holidays'); await db.exec('ALTER TABLE driver_charge_holidays ENABLE TRIGGER driver_charge_holidays_guard; SET ROLE authenticated');
    });

    await t.test('RLS keeps another tenant and another driver out', async () => {
      await actor(6); await assert.rejects(detail(charge), code('42501'));
      assert.equal((await db.query('select id from driver_charges')).rows.length, 0);
      assert.equal((await db.query("select driver_charges_list('{}',0) r")).rows[0].r.rows.length, 0);
      await actor(4); assert.equal((await db.query('select id from driver_charges where driver_id=$1', [a])).rows.length, 0);
      await actor(3); assert.ok((await db.query('select id, status from driver_charges')).rows.length >= 2);
      await assert.rejects(db.query('select schedule_monthly_wage from driver_charges'), code('42501'));
      await assert.rejects(db.query('select * from driver_charges'), code('42501'));
    });

    await t.test('accident liability approval is server stamped, immutable and opens the driver charge', async () => {
      await db.exec(`RESET ROLE; INSERT INTO accidents(id,organisation_id,reference_no,vehicle_id,incident_date,repair_cost,country,site) VALUES ('${id(41)}','${id(1)}','ACC-2026-0002','${id(7)}','2026-01-06',700,'KSA','JEDDAH'); SET ROLE authenticated;`);
      await actor(11);
      const ins = await db.query("insert into accident_liability_assessments(organisation_id,accident_id,country,site,payer,approved,approved_by,locked) values ($1,$2,'KSA','JEDDAH','driver_recovery',true,$3,true) returning *", [id(1), id(41), id(2)]);
      await assert.rejects(db.query("select approve_accident_liability($1,'Recorder approving own work',$2)", [ins.rows[0].id, { driver_id: a, currency: 'SAR' }]), code('42501'));
      await actor(2);
      assert.equal(ins.rows[0].approved, false); assert.equal(ins.rows[0].approved_by, null);
      const assessment = ins.rows[0].id;
      await db.query('update accident_liability_assessments set approved=true where id=$1', [assessment]);
      assert.equal((await db.query('select approved from accident_liability_assessments where id=$1', [assessment])).rows[0].approved, false);
      await assert.rejects(db.query("select approve_accident_liability($1,'Driver at fault per Najm',null)", [assessment]), code('22023'));
      const res = (await db.query("select approve_accident_liability($1,'Driver at fault per Najm',$2) r", [assessment, { driver_id: a, currency: 'SAR' }])).rows[0].r;
      assert.equal(res.approved_by, id(2)); assert.ok(res.driver_charge_id);
      await assert.rejects(db.query("update accident_liability_assessments set payer='company' where id=$1", [assessment]), code('42501'));
      const x = await detail(res.driver_charge_id); assert.equal(x.charge.source_type, 'accident'); assert.equal(Number(x.charge.amount), 700);
      await actor(3); await assert.rejects(db.query("select approve_accident_liability($1,'x reason',null)", [assessment]), code('42501'));
      liability = { assessment, charge: res.driver_charge_id };
    });

    await t.test('approved liability: field audit still writable, admin reopen reverses the charge, accident delete is blocked', async () => {
      await actor(2);
      assert.equal((await db.query(`update accident_liability_assessments set field_audit='{"payer":{"source":"najm"}}' where id=$1 returning id`, [liability.assessment])).rows.length, 1);
      await actor(11); await assert.rejects(db.query("select reopen_accident_liability($1,'Najm report was revised on appeal')", [liability.assessment]), code('42501'));
      await actor(2); await assert.rejects(db.query("select reopen_accident_liability($1,'short')", [liability.assessment]), code('22023'));
      const r = (await db.query("select reopen_accident_liability($1,'Najm report was revised on appeal') r", [liability.assessment])).rows[0].r;
      assert.equal(r.reversed_charge_id, liability.charge);
      const old = await detail(liability.charge); assert.equal(old.charge.status, 'cancelled_wrongly_issued');
      assert.ok(old.decisions.some(d => d.stage === 'reversal'));
      const row = (await db.query('select approved,locked,approved_by,change_reason from accident_liability_assessments where id=$1', [liability.assessment])).rows[0];
      assert.equal(row.approved, false); assert.equal(row.locked, false); assert.equal(row.approved_by, null); assert.match(row.change_reason, /revised/);
      assert.equal((await db.query("update accident_liability_assessments set payer='driver_recovery' where id=$1 returning id", [liability.assessment])).rows.length, 1);
      const again = (await db.query("select approve_accident_liability($1,'Revised Najm still names the driver',$2) r", [liability.assessment, { driver_id: a, currency: 'SAR', amount: 400 }])).rows[0].r;
      assert.ok(again.driver_charge_id && again.driver_charge_id !== liability.charge);
      assert.equal((await db.query('select count(*)::int n from accident_liability_approvals where assessment_id=$1', [liability.assessment])).rows[0].n, 2);
      assert.equal((await db.query('select count(*)::int n from accident_liability_reopens where assessment_id=$1', [liability.assessment])).rows[0].n, 1);
      await db.exec('RESET ROLE');
      await assert.rejects(db.query('delete from accidents where id=$1', [id(41)]), e => e.code === '42501' && /cannot be deleted/.test(e.message));
      await db.exec(`INSERT INTO accidents(id,organisation_id,reference_no,country,site) VALUES ('${id(44)}','${id(1)}','ACC-2026-0044','KSA','JEDDAH');
        INSERT INTO accident_liability_assessments(organisation_id,accident_id,country,site,payer,created_by) VALUES ('${id(1)}','${id(44)}','KSA','JEDDAH','company','${id(2)}');`);
      await db.query('delete from accidents where id=$1', [id(44)]);
      assert.equal((await db.query('select count(*)::int n from accident_liability_assessments where accident_id=$1', [id(44)])).rows[0].n, 0);
      // approved before this migration: no approval row. Alone it is protected; with the whole case it goes.
      await db.exec(`INSERT INTO accidents(id,organisation_id,reference_no,country,site) VALUES ('${id(46)}','${id(1)}','ACC-2026-0046','KSA','JEDDAH');
        SELECT set_config('tyrepulse.liability_approval','on',false);
        INSERT INTO accident_liability_assessments(id,organisation_id,accident_id,country,site,payer,approved,approved_by,approved_at,locked,created_by) VALUES ('${id(47)}','${id(1)}','${id(46)}','KSA','JEDDAH','company',true,'${id(2)}',now(),true,'${id(11)}');
        SELECT set_config('tyrepulse.liability_approval','off',false);`);
      await assert.rejects(db.query('delete from accident_liability_assessments where id=$1', [id(47)]), e => e.code === '42501' && /on its own/.test(e.message));
      await db.query('delete from accidents where id=$1', [id(46)]);
      assert.equal((await db.query('select count(*)::int n from accident_liability_assessments where id=$1', [id(47)])).rows[0].n, 0);
      // a UAE approval is invisible to a KSA-only user
      await db.exec(`INSERT INTO accidents(id,organisation_id,reference_no,country,site) VALUES ('${id(48)}','${id(1)}','ACC-UAE-1','UAE','JEDDAH');
        INSERT INTO accident_liability_assessments(id,organisation_id,accident_id,country,site,payer,created_by) VALUES ('${id(49)}','${id(1)}','${id(48)}','UAE','JEDDAH','company','${id(11)}');
        INSERT INTO accident_liability_approvals(organisation_id,assessment_id,accident_id,approved_by,reason,assessment_snapshot) VALUES ('${id(1)}','${id(49)}','${id(48)}','${id(2)}','UAE approval','{}');
        INSERT INTO accident_liability_reopens(organisation_id,assessment_id,accident_id,reason,reopened_by) VALUES ('${id(1)}','${id(49)}','${id(48)}','UAE reopen reason','${id(2)}');`);
      await db.exec('SET ROLE authenticated');
      const seen = async (tbl, acc) => (await db.query(`select count(*)::int n from ${tbl} where accident_id=$1`, [acc])).rows[0].n;
      await actor(5); assert.equal(await seen('accident_liability_approvals', id(48)), 0); assert.equal(await seen('accident_liability_reopens', id(48)), 0);
      assert.equal(await seen('accident_liability_approvals', id(41)), 2);
      await actor(2); assert.equal(await seen('accident_liability_approvals', id(48)), 1); assert.equal(await seen('accident_liability_reopens', id(48)), 1);
      await db.exec('RESET ROLE');
      await db.exec('SET ROLE authenticated');
    });

    await t.test('driver expenses: only owner edits a pending claim; review is stamped and never self-review', async () => {
      await actor(3);
      const e = (await db.query("insert into driver_expenses(country,driver_name,amount,status) values ('KSA','Driver A',50,'approved') returning *")).rows[0];
      assert.equal(e.status, 'pending'); assert.equal(e.created_by, id(3));
      await assert.rejects(db.query("update driver_expenses set status='approved' where id=$1", [e.id]), code('42501'));
      await actor(4); assert.equal((await db.query('update driver_expenses set amount=999 where id=$1 returning id', [e.id])).rows.length, 0);
      await actor(3); assert.equal((await db.query('update driver_expenses set amount=60 where id=$1 returning id', [e.id])).rows.length, 1);
      const token = "(select updated_at from driver_expenses where id=$1)";
      await assert.rejects(db.query(`select review_driver_expense($1,'approved','ok fine',${token})`, [e.id]), code('42501'));
      await actor(2);
      await assert.rejects(db.query("select review_driver_expense($1,'approved','Receipt checked',now() - interval '1 day')", [e.id]), code('PT409'));
      await assert.rejects(db.query("select review_driver_expense($1,'approved','Receipt checked',null)", [e.id]), code('22023'));
      await assert.rejects(db.query(`select review_driver_expense($1,null,'Receipt checked',${token})`, [e.id]), code('22023'));
      const r = (await db.query(`select review_driver_expense($1,'approved','Receipt checked',${token}) r`, [e.id])).rows[0].r;
      assert.equal(r.status, 'approved'); assert.equal(r.reviewed_by, id(2));
      await actor(3); assert.equal((await db.query('update driver_expenses set amount=70 where id=$1 returning id', [e.id])).rows.length, 0);
      assert.equal((await db.query('delete from driver_expenses where id=$1 returning id', [e.id])).rows.length, 0);
      await actor(2); assert.equal((await db.query('delete from driver_expenses where id=$1 returning id', [e.id])).rows.length, 0);
      await db.exec('RESET ROLE'); await assert.rejects(db.query('delete from driver_expenses where id=$1', [e.id]), code('42501')); await db.exec('SET ROLE authenticated');
      await db.exec('RESET ROLE');
      const imported = (await db.query("insert into driver_expenses(organisation_id,country,driver_name,amount,status,created_by) values ($1,'KSA','Imported',30,'approved',$2) returning *", [id(1), id(2)])).rows[0];
      assert.equal(imported.status, 'approved');
      assert.equal((await db.query("update driver_expenses set description='import correction' where id=$1 returning id", [imported.id])).rows.length, 1);
      await db.exec('SET ROLE authenticated');
      await actor(3); const p = (await db.query("insert into driver_expenses(country,driver_name,amount) values ('KSA','Driver A',20) returning id")).rows[0];
      assert.equal((await db.query('delete from driver_expenses where id=$1 returning id', [p.id])).rows.length, 1);
    });
  } finally { await db.close(); }
});
