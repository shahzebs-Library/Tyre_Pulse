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
const SIG = 'data:image/png;base64,' + 'A'.repeat(120);
const thisMonth = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`; };
const nextMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`; };

// Actors: 2 manager (also holds the finance capability), 3 driver A, 4 driver B,
// 5 supervisor of driver A, 6 other tenant, 10 finance, 11 second manager.
test('driver charges are consented, separated, capped, appealable and immutable', async t => {
  const db = new PGlite(); let request = 1000;
  const command = async (action, payload, key = id(request++)) => (await db.query('select driver_workspace_command($1,$2,$3) r', [action, payload, key])).rows[0].r;
  const detail = async charge => (await db.query('select driver_charge_detail($1) r', [charge])).rows[0].r;
  const actor = async n => db.exec(`SET test.actor='${id(n)}'`);
  const code = c => e => e.code === c;
  try {
    await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
      CREATE TABLE profiles(id uuid PRIMARY KEY,org_id uuid,full_name text,approved boolean DEFAULT true,locked boolean DEFAULT false,employee_id text,role text,username text);
      CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql AS $$ SELECT org_id FROM public.profiles WHERE id=auth.uid() $$;
      CREATE FUNCTION app_is_active() RETURNS boolean LANGUAGE sql AS $$ SELECT approved AND NOT locked FROM public.profiles WHERE id=auth.uid() $$;
      CREATE FUNCTION app_user_can(k text,c text) RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid()='${id(2)}'::uuid OR (auth.uid()='${id(11)}'::uuid AND NOT (k='driver_workspace' AND c='finance')) $$;
      CREATE FUNCTION app_is_elevated() RETURNS boolean LANGUAGE sql AS $$ SELECT auth.uid() IN ('${id(2)}'::uuid,'${id(11)}'::uuid) $$;
      CREATE FUNCTION app_can_see_country(c text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
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
    let charge, version, liability;
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
      const accept = { driver_id: a, charge_id: charge, version, response: 'accept', statement_version: 'deduction-consent-v1', acknowledged: true, signature: SIG };
      await actor(4); await assert.rejects(command('charge_respond', accept), code('42501'));
      await actor(5); await assert.rejects(command('charge_respond', accept), code('42501'));
      await actor(3);
      await assert.rejects(command('charge_respond', { ...accept, statement_version: 'receipt-dispute-v1' }), code('22023'));
      await assert.rejects(command('charge_respond', { ...accept, signature: '<svg><script/></svg>' }), code('22023'));
      await command('charge_respond', accept);
      const x = await refresh();
      assert.equal(x.charge.status, 'accepted'); assert.equal(x.signatures[0].kind, 'driver_acceptance');
      assert.match(x.signatures[0].statement_text, /written consent/); assert.ok(x.signatures[0].signed_at);
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

    await t.test('instalments are capped by the configured share of wage and must add up', async () => {
      await actor(10);
      const base = { driver_id: a, charge_id: charge, version, monthly_wage: 1000, wage_currency: 'SAR' };
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
      await actor(3); await command('charge_respond', { driver_id: a, charge_id: other, version: v, response: 'accept', statement_version: 'deduction-consent-v1', acknowledged: true, signature: SIG }); v++;
      await actor(2); await command('charge_supervisor_review', { driver_id: a, charge_id: other, version: v, decision: 'approve', reason: 'Kit missing per checklist' }); v++;
      await actor(10); await command('charge_finance_review', { driver_id: a, charge_id: other, version: v, decision: 'approve', reason: 'Price verified' }); v++;
      const base = { driver_id: a, charge_id: other, version: v, monthly_wage: 1000, wage_currency: 'SAR' };
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
      await actor(3); await assert.rejects(command('charge_respond', { driver_id: a, charge_id: c, version: v + 1, statement_version: 'receipt-dispute-v1', acknowledged: true, explanation: 'No response chosen here', signature: SIG }), code('22023'));
      await command('charge_respond', { driver_id: a, charge_id: c, version: v + 1, response: 'accept', statement_version: 'deduction-consent-v1', acknowledged: true, signature: SIG });
      await actor(2); await assert.rejects(command('charge_supervisor_review', { driver_id: a, charge_id: c, version: v + 2, reason: 'No decision given' }), code('22023'));
      await actor(3);
      await assert.rejects(db.query('select * from driver_charge_signatures'), code('42501'));
      await assert.rejects(db.query("select private.driver_charge_setting('driver_charge_instalment_cap_pct',20)"), code('42501'));
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
      await command('charge_record_refusal', { driver_id: a, charge_id: second, version: v, witness_user_id: id(11), reason: 'Presented at gate office' }); v++;
      let x = await detail(second); assert.equal(x.charge.status, 'notified', 'one person alone cannot make a refusal count'); assert.equal(x.signatures.length, 0);
      await actor(2); await assert.rejects(command('charge_supervisor_review', { driver_id: a, charge_id: second, version: v, decision: 'approve', reason: 'Too early review' }), code('PT409'));
      const confirm = { driver_id: a, charge_id: second, version: v, statement_version: 'refusal-witness-v1', acknowledged: true, signature: SIG };
      for (const n of [5, 10, 2]) { await actor(n); await assert.rejects(command('charge_witness_confirm', confirm), code('42501')); }
      await actor(11); assert.ok((await detail(second)).actions.includes('charge_witness_confirm'));
      await assert.rejects(command('charge_witness_confirm', { ...confirm, acknowledged: false }), code('22023'));
      await command('charge_witness_confirm', confirm); v++;
      x = await detail(second); assert.equal(x.charge.status, 'refused'); assert.equal(x.signatures[0].kind, 'refusal_witness'); assert.equal(x.signatures[0].signer_id, id(11));
      await assert.rejects(command('charge_supervisor_review', { driver_id: a, charge_id: second, version: v, decision: 'approve', reason: 'Witness approving' }), code('42501'));
      await actor(2); await command('charge_supervisor_review', { driver_id: a, charge_id: second, version: v, decision: 'approve', reason: 'Gate photo confirms damage' }); v++;
      await actor(10); await command('charge_finance_review', { driver_id: a, charge_id: second, version: v, decision: 'approve', reason: 'Quote checked' }); v++;
      await assert.rejects(command('charge_schedule', { driver_id: a, charge_id: second, version: v, monthly_wage: 1000, wage_currency: 'SAR', instalments: [{ due_month: thisMonth(), amount: 120 }] }), code('22023'));
    });

    await t.test('wrongly issued charge is reversed and reissued with lineage, never edited', async () => {
      await actor(5);
      const third = (await command('charge_issue', { driver_id: a, category: 'accident_damage', source_type: 'accident', source_id: id(40), basis: 'Rear bumper damage recorded on accident ACC-2026-0001.', amount: 500, currency: 'SAR' })).id;
      await assert.rejects(command('charge_issue', { driver_id: a, category: 'accident_damage', source_type: 'accident', source_id: id(40), basis: 'Duplicate of the same accident charge.', amount: 500, currency: 'SAR' }), code('23505'));
      let v = (await detail(third)).charge.version;
      await command('charge_notify', { driver_id: a, charge_id: third, version: v }); v++;
      await actor(2);
      const r = await command('charge_reverse', { driver_id: a, charge_id: third, version: v, reversal_code: 'wrong_driver', reason: 'Shift log shows Driver B drove that day', reissue: { driver_id: b } });
      const old = await detail(third); assert.equal(old.charge.status, 'cancelled_wrongly_issued'); assert.equal(old.charge.superseded_by_charge_id, r.replacement_charge_id);
      const fresh = await detail(r.replacement_charge_id); assert.equal(fresh.charge.driver_id, b); assert.equal(fresh.charge.status, 'issued'); assert.equal(fresh.charge.supersedes_charge_id, third);
      await actor(3); await assert.rejects(detail(r.replacement_charge_id), code('42501'));
    });

    await t.test('RLS keeps another tenant and another driver out', async () => {
      await actor(6); await assert.rejects(detail(charge), code('42501'));
      assert.equal((await db.query('select * from driver_charges')).rows.length, 0);
      assert.equal((await db.query("select driver_charges_list('{}',0) r")).rows[0].r.rows.length, 0);
      await actor(4); assert.equal((await db.query('select * from driver_charges where driver_id=$1', [a])).rows.length, 0);
      await actor(3); assert.ok((await db.query('select * from driver_charges')).rows.length >= 2);
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
      await actor(3); const p = (await db.query("insert into driver_expenses(country,driver_name,amount) values ('KSA','Driver A',20) returning id")).rows[0];
      assert.equal((await db.query('delete from driver_expenses where id=$1 returning id', [p.id])).rows.length, 1);
    });
  } finally { await db.close(); }
});
