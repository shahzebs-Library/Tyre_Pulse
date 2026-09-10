import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../migrations/20260910182201_governed_approval_policies.sql', import.meta.url), 'utf8');
const baseline = await readFile(new URL('./fixtures/approval_legacy_baseline.sql', import.meta.url), 'utf8');
const workflowBaseline = await readFile(new URL('./fixtures/approval_workflow_baseline.sql', import.meta.url), 'utf8');
const inspectionLockBaseline = await readFile(new URL('./fixtures/approval_inspection_lock_baseline.sql', import.meta.url), 'utf8');
const preExecutionMigration=await readFile(new URL('../migrations/20260910185625_approval_pre_execution_gates.sql',import.meta.url),'utf8');
const tyreBaseline=await readFile(new URL('./fixtures/approval_tyre_baseline.sql',import.meta.url),'utf8');
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const org = uuid(1), admin = uuid(2), submitter = uuid(3), reviewer = uuid(4), otherOrg = uuid(5), reviewer2 = uuid(6), publisher=uuid(8);

test('governed approvals: tenant isolation, publication, snapshots, domain gates and replay', async t => {
 const db = new PGlite();
 try {
  await db.exec(`
   CREATE SCHEMA auth; CREATE ROLE authenticated; CREATE ROLE anon;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
   CREATE TABLE profiles(id uuid PRIMARY KEY,org_id uuid,organisation_id uuid,role text,approved boolean DEFAULT true,locked boolean DEFAULT false,
    full_name text,username text,email text,push_token text DEFAULT 'test-push-token',country text[],countries text[],site text,sites text[],is_super_admin boolean DEFAULT false);
   CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT org_id FROM profiles WHERE id=auth.uid() $$;
   CREATE FUNCTION get_my_role() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT role FROM profiles WHERE id=auth.uid() AND approved AND NOT locked $$;
   CREATE FUNCTION app_is_active() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT approved AND NOT locked FROM profiles WHERE id=auth.uid() $$;
   CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
   CREATE FUNCTION app_sees_all_countries() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'All'=ANY(country) FROM profiles WHERE id=auth.uid() $$;
   CREATE FUNCTION app_country_scope() RETURNS text[] LANGUAGE sql SECURITY DEFINER AS $$ SELECT array_agg(lower(c)) FROM profiles,unnest(country)c WHERE id=auth.uid() $$;
   CREATE FUNCTION app_sees_all_sites() RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT role='Admin' OR 'ALL'=ANY(sites) FROM profiles WHERE id=auth.uid() $$;
   CREATE FUNCTION app_site_scope() RETURNS text[] LANGUAGE sql SECURITY DEFINER AS $$ SELECT sites FROM profiles WHERE id=auth.uid() $$;
   CREATE FUNCTION app_user_can(text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.module',true),'true')<>'false' $$;
   CREATE FUNCTION checklist_is_supervisor() RETURNS boolean LANGUAGE sql AS $$ SELECT get_my_role()=ANY(ARRAY['Admin','Maintenance Supervisor','PMV Manager']) $$;
   CREATE FUNCTION checklist_is_area_manager() RETURNS boolean LANGUAGE sql AS $$ SELECT get_my_role()=ANY(ARRAY['Admin','PMV Manager']) $$;
   CREATE TABLE sites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,name text,country text,active boolean DEFAULT true);
   CREATE TABLE module_permissions(org_id uuid,role text,module_key text,enabled boolean,updated_at timestamptz DEFAULT now());
   CREATE TABLE user_access_grants(user_id uuid,module_key text,capability text,effect text,expires_at timestamptz);
   INSERT INTO module_permissions(role,module_key,enabled) VALUES('PMV Manager','checklists',true),('PMV Manager','inspections',true),('PMV Manager','work_orders',true),('PMV Manager','tyre_records',true);
   CREATE TABLE vehicle_fleet(id uuid PRIMARY KEY,organisation_id uuid,asset_no text,country text,site text,vehicle_type text);
   CREATE TABLE work_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,work_order_no text DEFAULT 'WO-TEST',asset_no text,country text,site text,status text DEFAULT 'Open',
    description text,scope text,notes text,parts_cost numeric DEFAULT 0,labour_hours numeric DEFAULT 0,created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),started_at timestamptz,completed_at timestamptz);
   CREATE TABLE tyre_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,asset_no text,asset_number text,country text,site text,position text,tyre_position text,
    serial_no text,brand text,km_at_fitment numeric,km_at_removal numeric,cost_per_tyre numeric,qty int,issue_date date,removal_date date,removal_reason text,status text DEFAULT 'Active',
    risk_level text,category text,uploaded_by uuid,size text,tread_depth numeric,photos jsonb);
   CREATE TABLE tyre_audit(action text,record_id text,old_data jsonb,new_data jsonb);
   CREATE FUNCTION app_cap_revoked(text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
   CREATE FUNCTION is_approved_and_unlocked() RETURNS boolean LANGUAGE sql AS $$ SELECT app_is_active() $$;
   CREATE FUNCTION app_write_country_ok(text) RETURNS boolean LANGUAGE sql AS $$ SELECT app_sees_all_countries() OR lower($1)=ANY(app_country_scope()) $$;
   CREATE FUNCTION record_audit_event(text,text,text,jsonb,jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO tyre_audit VALUES($1,$3,$4,$5) $$;
   CREATE TABLE approval_delegations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,delegator_id uuid,delegate_id uuid,entity_type text,reason text,
    starts_at timestamptz,ends_at timestamptz,active boolean DEFAULT true,created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
   CREATE TABLE checklist_templates(id uuid PRIMARY KEY,require_area_manager boolean DEFAULT false,option_sets jsonb,fields jsonb,name text);
   CREATE TABLE checklist_submissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,template_id uuid,template_name text,country text,site text,
    asset_no text,title text,approval_status text DEFAULT 'pending',status text DEFAULT 'submitted',answers jsonb,photos jsonb,signature_data text,
    submitted_by uuid,submitted_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
    supervisor_by uuid,supervisor_name text,supervisor_signature text,supervisor_at timestamptz,
    approved_by uuid,approver_name text,approver_signature text,approved_at timestamptz,review_note text,locked boolean DEFAULT false);
   CREATE TABLE inspections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,country text,site text,asset_no text,title text,
    findings text,created_by uuid,created_at timestamptz DEFAULT now(),approval_status text DEFAULT 'pending_approval',status text DEFAULT 'In Progress',
    approved_by uuid,approver_email text,approver_signature text,approved_at timestamptz,locked boolean DEFAULT false,locked_at timestamptz);
   CREATE TABLE inspection_audit_log(id bigint GENERATED ALWAYS AS IDENTITY,inspection_id uuid,changed_by uuid,action text,new_values jsonb);
   CREATE TABLE notifications(id bigint GENERATED ALWAYS AS IDENTITY,user_id uuid,type text,title text,body text,entity_type text,entity_id uuid);
   CREATE TABLE domain_events(id bigint GENERATED ALWAYS AS IDENTITY,event_type text NOT NULL,entity_type text,entity_id text,organisation_id uuid,actor_id uuid,payload jsonb NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'pending',processed_at timestamptz);
   CREATE FUNCTION trg_emit_domain_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN
    INSERT INTO domain_events(event_type,entity_type,entity_id,organisation_id,actor_id,payload) VALUES(TG_ARGV[0],TG_ARGV[1],NEW.id::text,NEW.organisation_id,auth.uid(),'{}'); RETURN NEW; END $$;
   CREATE TABLE workflow_notifications(id bigint GENERATED ALWAYS AS IDENTITY,event_id bigint NOT NULL UNIQUE,organisation_id uuid,instance_id uuid,event_type text NOT NULL,payload jsonb NOT NULL,recipient_count int NOT NULL,status text NOT NULL CHECK(status IN('pending','delivered','failed','skipped')));
   CREATE TABLE workflow_instances(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid,entity_type text,entity_id text,entity_label text,
    definition_id uuid,started_at timestamptz DEFAULT now(),definition_name text,steps jsonb,current_step int DEFAULT 0,status text DEFAULT 'pending' CHECK(status IN('pending','in_review','returned','approved','rejected','cancelled')),
    context jsonb,started_by uuid,step_started_at timestamptz,completed_at timestamptz,last_actor_id uuid);
   CREATE TABLE workflow_step_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,instance_id uuid REFERENCES workflow_instances(id),organisation_id uuid,
    step_index int,step_name text,action text CHECK(action IN('started','approved','rejected','returned','cancelled','escalated')),actor_id uuid,
    comment text,signature_data text,printed_name text,device_info jsonb,created_at timestamptz DEFAULT now());
   INSERT INTO profiles(id,org_id,role,full_name,country,sites) VALUES
    ('${admin}','${org}','Admin','Policy administrator',ARRAY['All'],ARRAY['ALL']),
    ('${submitter}','${org}','Tyre Data Collector','Submitter',ARRAY['KSA'],ARRAY['JEDDAH']),
    ('${reviewer}','${org}','PMV Manager','Reviewer',ARRAY['KSA'],ARRAY['JEDDAH']),
    ('${reviewer2}','${org}','PMV Manager','Second reviewer',ARRAY['KSA'],ARRAY['JEDDAH']),
    ('${uuid(7)}','${otherOrg}','Admin','Other tenant',ARRAY['All'],ARRAY['ALL']),
    ('${publisher}','${org}','Admin','Policy publisher',ARRAY['All'],ARRAY['ALL']);
   INSERT INTO sites(organisation_id,name,country) VALUES('${org}','JEDDAH','KSA');
   INSERT INTO checklist_templates VALUES('${uuid(20)}',false,'{"legend":{"blocking":["Fail"]}}','[]','Safety checklist'),('${uuid(21)}',true,'{}','[]','Two stage');
  `);
  await db.exec(baseline);
  await db.exec(workflowBaseline);
  await db.exec(inspectionLockBaseline);
  await db.exec(tyreBaseline);
  await db.exec('CREATE TRIGGER trg_lock_inspection_content BEFORE INSERT OR UPDATE ON inspections FOR EACH ROW EXECUTE FUNCTION lock_inspection_content();');
  await db.exec(`ALTER TABLE workflow_instances ENABLE ROW LEVEL SECURITY; ALTER TABLE workflow_step_events ENABLE ROW LEVEL SECURITY;
    CREATE POLICY existing_workflow_read ON workflow_instances FOR SELECT TO authenticated USING(organisation_id=app_current_org());
    CREATE POLICY existing_event_read ON workflow_step_events FOR SELECT TO authenticated USING(organisation_id=app_current_org());`);
  await db.exec('CREATE TRIGGER trg_guard_checklist_approval_stages BEFORE UPDATE ON checklist_submissions FOR EACH ROW EXECUTE FUNCTION guard_checklist_approval_stages();');
  await db.exec(migration);
  await db.exec(preExecutionMigration);
  await db.exec(`CREATE TRIGGER trg_notify_checklist_decision AFTER UPDATE ON checklist_submissions FOR EACH ROW WHEN (OLD.approval_status IS DISTINCT FROM NEW.approval_status) EXECUTE FUNCTION notify_submission_decision();
   CREATE TRIGGER trg_notify_inspection_decision AFTER UPDATE ON inspections FOR EACH ROW WHEN (OLD.approval_status IS DISTINCT FROM NEW.approval_status) EXECUTE FUNCTION notify_submission_decision();`);
  await db.exec(`GRANT USAGE ON SCHEMA auth TO authenticated; GRANT SELECT,INSERT,UPDATE ON inspections,checklist_submissions,workflow_instances,workflow_step_events,work_orders,tyre_records TO authenticated;
   GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated; SET ROLE authenticated; SET test.actor='${admin}';`);
  const actor = async id => db.exec(`SET test.actor='${id}'`);
  const scalar = async (sql,args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
  const context = async (id,kind='checklist') => scalar('SELECT approval_review_context($1,$2)',[kind,id]);
  const save = async (policy,updated=null) => scalar('SELECT approval_policy_save($1,$2)',[JSON.stringify(policy),updated]);
  const publish = async p => {
   await actor(publisher);
   try { return await scalar('SELECT approval_policy_publish($1,$2,$3)',[p.id,p.updated_at,'Reviewed routing and coverage']); }
   finally { await actor(admin); }
  };
  const stage = (id=reviewer) => ({name:'Review',approver_user_id:id,require_signature:true,prevent_self_approval:true,distinct_reviewer:true,sla_hours:24});
  const policy = (overrides={}) => ({name:'Checklist signoff',entity_type:'checklist',priority:10,match_country:'KSA',match_site:'JEDDAH',stages:[stage()],...overrides});
  const submit = async (id,template=uuid(20),answers={}) => {
   await actor(submitter);
   await db.query('INSERT INTO checklist_submissions(id,organisation_id,template_id,country,site,asset_no,title,submitted_by,answers) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,org,template,'KSA','JEDDAH','TM-TEST','Test checklist',submitter,JSON.stringify(answers)]);
   await actor(reviewer);
  };
  const decide = async (id,c,operation=uuid(100),decision='approved',note=null) => scalar('SELECT decide_approval($1,$2,$3,$4,$5,$6,$7,$8,$9)', ['checklist',id,decision,c.revision,c.stage_token,operation,note,'signature','2026-09-10T10:00:00Z']);

  let draft,published,legacyContext;
  await t.test('legacy record uses the shared RPC and immutable receipt', async () => {
   await submit(uuid(30)); legacyContext=await context(uuid(30)); assert.equal(legacyContext.mode,'legacy');
   assert.equal(legacyContext.document.checklist_templates.name,'Safety checklist');
   const receipt=await decide(uuid(30),legacyContext); assert.equal(receipt.status,'approved');
   assert.deepEqual(await decide(uuid(30),legacyContext),receipt);
   await assert.rejects(decide(uuid(30),legacyContext,uuid(100),'rejected','Different'), e=>e.code==='22023');
  });
  await t.test('active tenant administrator only; validated sites, stages and optimistic save', async () => {
   await assert.rejects(save(policy()),e=>e.code==='42501'); await actor(admin);
   await assert.rejects(save(policy({match_country:'UAE'})),e=>e.code==='22023');
   await assert.rejects(save(policy({stages:[{...stage(),approver_role:'Admin'}]})),e=>e.code==='22023');
   await assert.rejects(save(policy({stages:[{...stage(),approver_user_id:uuid(7)}]})),e=>e.code==='22023');
   draft=await save(policy());
   await assert.rejects(save({...policy(),id:draft.id},'2000-01-01T00:00:00Z'),e=>e.code==='40001');
   draft=await save({...policy(),id:draft.id},draft.updated_at);
   assert.equal((await scalar('SELECT approval_policy_people()')).length,5);
  });
  await t.test('publish is immutable and ambiguous overlapping policies are blocked', async () => {
   await assert.rejects(scalar('SELECT approval_policy_publish($1,$2,$3)',[draft.id,draft.updated_at,'Self publish']),e=>e.code==='42501');
   published=await publish(draft); assert.equal(published.state,'published');
   await assert.rejects(save({...policy(),id:published.id},published.updated_at),e=>e.code==='22023');
   const conflict=await save(policy({name:'Conflict'})); await assert.rejects(publish(conflict),e=>e.code==='22023');
   const route=await scalar('SELECT approval_policy_simulate($1,$2,$3)', ['checklist','KSA','JEDDAH']);
   assert.equal(route.status,'matched'); assert.equal(route.policy.id,published.id);
   await actor(uuid(7)); assert.equal(await scalar('SELECT count(*)::int FROM approval_policies'),0);
   await assert.rejects(scalar('SELECT approval_policy_retire($1,$2,$3)',[published.id,published.updated_at,'cross tenant']),e=>e.code==='42501'); await actor(admin);
   await assert.rejects(db.query('UPDATE approval_policies SET name=$1 WHERE id=$2',['forged',published.id]),e=>e.code==='42501');
  });
  await t.test('submission snapshots published policy and blocks direct or legacy RPC bypass', async () => {
   await submit(uuid(31)); const c=await context(uuid(31)); assert.equal(c.mode,'enforced'); assert.equal(c.policy.id,published.id); assert.equal(c.can_decide,true);
   await assert.rejects(db.query("UPDATE checklist_submissions SET approval_status='approved',approver_name='Forged',approver_signature='x' WHERE id=$1",[uuid(31)]),e=>e.code==='42501');
   await assert.rejects(scalar("SELECT decide_checklist_approval($1,'approved',NULL,'signature')",[uuid(31)]),e=>e.code==='42501');
   assert.equal((await db.query("UPDATE workflow_instances SET status='approved' WHERE id=$1 RETURNING id",[c.document.approval_workflow_id])).rows.length,0);
   await assert.rejects(db.query("UPDATE checklist_submissions SET answers='{}'::jsonb || '{\"changed\":true}'::jsonb WHERE id=$1",[uuid(31)]),e=>e.code==='40001');
   await actor(submitter); assert.equal((await context(uuid(31))).can_decide,false); await actor(reviewer);
   assert.equal((await decide(uuid(31),c,uuid(101))).status,'approved');
   assert.equal((await context(uuid(31))).history.filter(x=>x.action==='approved').length,1);
  });
  await t.test('scope, current account state, and module permission checked on context and decision', async () => {
   await actor(uuid(7)); await assert.rejects(context(uuid(31)),e=>e.code==='42501');
   await actor(reviewer); await db.exec("SET test.module='false'"); await assert.rejects(context(uuid(31)),e=>e.code==='42501'); await db.exec("SET test.module='true'");
   await db.exec(`RESET ROLE; UPDATE profiles SET locked=true WHERE id='${reviewer}'; SET ROLE authenticated;`);
   await assert.rejects(context(uuid(31)),e=>e.code==='42501');
   await db.exec(`RESET ROLE; UPDATE profiles SET locked=false,country=ARRAY['UAE'] WHERE id='${reviewer}'; SET ROLE authenticated;`);
   await assert.rejects(context(uuid(31)),e=>e.code==='42501');
   await db.exec(`RESET ROLE; UPDATE profiles SET country=ARRAY['KSA'] WHERE id='${reviewer}'; SET ROLE authenticated;`);
  });
  await t.test('blocking checklist answers are preserved as a server completion gate', async () => {
   await submit(uuid(32),uuid(20),{brakes:'Fail'}); const c=await context(uuid(32));
   await assert.rejects(decide(uuid(32),c,uuid(102)),e=>e.code==='22023');
   assert.equal((await context(uuid(32))).status,'pending');
   await assert.rejects(decide(uuid(32),c,uuid(102),'rejected',null),e=>e.code==='22023');
   assert.equal((await decide(uuid(32),c,uuid(102),'rejected','Repair brakes')).status,'rejected');
  });
  await t.test('template changes invalidate a reviewed revision and do not retain earlier authority', async () => {
   await submit(uuid(33)); const c=await context(uuid(33));
   await db.exec(`RESET ROLE; UPDATE checklist_templates SET fields='[{"name":"new safety question"}]' WHERE id='${uuid(20)}'; SET ROLE authenticated;`);
   await assert.rejects(decide(uuid(33),c,uuid(103)),e=>e.code==='40001');
   assert.equal((await context(uuid(33))).can_decide,false);
   await db.exec(`RESET ROLE; UPDATE checklist_templates SET fields='[]' WHERE id='${uuid(20)}'; SET ROLE authenticated;`);
  });
  await t.test('retired policy remains in pending snapshots; absent route never falls back to legacy', async () => {
   await actor(admin); await scalar('SELECT approval_policy_retire($1,$2,$3)',[published.id,published.updated_at,'Replace routing']);
   await actor(reviewer); assert.equal((await context(uuid(33))).policy.id,published.id);
   assert.equal((await decide(uuid(33),await context(uuid(33)),uuid(103))).status,'approved');
   await submit(uuid(34)); const c=await context(uuid(34)); assert.equal(c.mode,'enforced'); assert.equal(c.routing_status,'no_route'); assert.equal(c.can_decide,false);
   await assert.rejects(decide(uuid(34),c,uuid(104)),e=>e.code==='42501');
  });
  await t.test('multiple policy stages record independent decisions and preserve area-manager gate', async () => {
   await actor(admin); await publish(await save(policy({name:'Two independent reviewers',stages:[stage(),stage(reviewer2)]})));
   await submit(uuid(35),uuid(21)); const first=await context(uuid(35));
   const receipt=await decide(uuid(35),first,uuid(105)); assert.equal(receipt.status,'pending_area_manager');
   assert.notEqual(receipt.stage_token,first.stage_token); assert.equal((await context(uuid(35))).can_decide,false);
   await actor(reviewer2); const second=await context(uuid(35)); assert.equal(second.can_decide,true);
   assert.equal((await decide(uuid(35),second,uuid(106))).status,'approved');
   const final=await context(uuid(35)); assert.equal(final.history.filter(x=>x.action==='approved').length,2);
  });
  await t.test('dashboard and direct workflow reads hide snapshots outside country and module scope', async () => {
   await actor(reviewer); const dashboard=await scalar('SELECT approval_dashboard()');
   assert.ok(dashboard.buckets.recently_approved.some(x=>x.governed===true && x.country==='KSA' && x.site==='JEDDAH'));
   await db.exec(`RESET ROLE; UPDATE profiles SET country=ARRAY['UAE'] WHERE id='${reviewer}'; SET ROLE authenticated;`);
   assert.equal((await scalar('SELECT approval_dashboard()')).metrics.total_count,0);
   assert.equal(await scalar('SELECT count(*)::int FROM workflow_instances'),0);
   assert.equal(await scalar('SELECT count(*)::int FROM workflow_step_events'),0);
   assert.equal(await scalar('SELECT count(*)::int FROM my_pending_approvals()'),0);
   await db.exec(`RESET ROLE; UPDATE profiles SET country=ARRAY['KSA'] WHERE id='${reviewer}'; SET ROLE authenticated;`);
   await db.exec("SET test.module='false'"); assert.equal((await scalar('SELECT approval_dashboard()')).metrics.total_count,0); await db.exec("SET test.module='true'");
  });
  await t.test('routing recovery selects a published policy and invalidates stale stage tokens', async () => {
   await actor(admin); const c=await context(uuid(34)); assert.equal(c.can_recover,true);
   const recovered=await scalar('SELECT approval_recover_route($1,$2,$3,$4)',['checklist',uuid(34),c.stage_token,'Policy coverage repaired']);
   assert.equal(recovered.routing_status,'matched'); assert.notEqual(recovered.stage_token,c.stage_token);
   assert.equal(recovered.history.filter(x=>x.action==='route_recovered').length,1);
   await assert.rejects(scalar('SELECT approval_recover_route($1,$2,$3,$4)',['checklist',uuid(34),c.stage_token,'stale']),e=>e.code==='40001');
  });
  await t.test('audited reassignment validates current scope and invalidates pending device intentions', async () => {
   await submit(uuid(36)); const old=await context(uuid(36)); await actor(admin);
   await assert.rejects(scalar('SELECT approval_reassign_stage($1,$2,$3,$4,$5)',['checklist',uuid(36),old.stage_token,uuid(7),'Wrong tenant']),e=>e.code==='42501');
   await assert.rejects(scalar('SELECT approval_reassign_stage($1,$2,$3,$4,$5)',['checklist',uuid(36),old.stage_token,submitter,'Self approval']),e=>e.code==='42501');
   const current=await scalar('SELECT approval_reassign_stage($1,$2,$3,$4,$5)',['checklist',uuid(36),old.stage_token,reviewer2,'Reviewer unavailable']);
   assert.notEqual(current.stage_token,old.stage_token); assert.equal(current.policy.stages[0].approver_user_id,reviewer);
   assert.equal(current.stages[0].approver_user_id,reviewer2); assert.equal(current.history.at(-1).action,'reassigned');
   await actor(reviewer); await assert.rejects(decide(uuid(36),old,uuid(107)),e=>e.code==='40001');
   await actor(reviewer2); assert.equal((await context(uuid(36))).can_decide,true);
  });
  await t.test('delegation is stage-bound, scoped, non-transitive, revocable and records represented actor', async () => {
   await submit(uuid(37)); let c=await context(uuid(37)); assert.equal(c.can_delegate,true);
   const delegate=async (id=reviewer2) => scalar('SELECT approval_delegate_stage($1,$2,$3,$4,now()-interval \'1 minute\',now()+interval \'1 day\',$5)',['checklist',uuid(37),c.stage_token,id,'Reviewer leave']);
   await assert.rejects(delegate(uuid(7)),e=>e.code==='42501');
   await assert.rejects(delegate(submitter),e=>e.code==='42501');
   let a=await delegate(); await assert.rejects(delegate(),e=>e.code==='22023');
   await actor(reviewer2); const delegated=await context(uuid(37)); assert.equal(delegated.can_decide,true); assert.equal(delegated.can_delegate,false); assert.equal(delegated.represented_actor_id,reviewer);
   assert.equal(await scalar('SELECT count(*)::int FROM my_pending_approvals() WHERE id=$1',[c.document.approval_workflow_id]),1);
   await assert.rejects(delegate(admin),e=>e.code==='42501');
   await actor(reviewer); await scalar('SELECT approval_revoke_delegation($1,$2)',[a.id,'Reviewer returned']);
   await actor(reviewer2); assert.equal((await context(uuid(37))).can_decide,false);
   await actor(reviewer); a=await delegate(); await actor(reviewer2);
   await decide(uuid(37),await context(uuid(37)),uuid(108));
   c=await context(uuid(37)); const event=c.history.find(x=>x.action==='approved');
   assert.equal(event.actor_id,reviewer2); assert.equal(event.device_info.represented_actor_id,reviewer);
   assert.equal(c.can_decide,false,'delegate cannot also sign next independent stage in own role');
  });
  await t.test('future publication does not change routing until its effective time', async () => {
   await actor(admin); const p=await save(policy({name:'Scheduled inspection policy',entity_type:'inspection'}));
   await actor(publisher); const scheduled=await scalar('SELECT approval_policy_publish($1,$2,$3,now()+interval \'1 day\')',[p.id,p.updated_at,'Scheduled rollout']);
   assert.ok(scheduled.effective_at); await actor(admin);
   const route=await scalar('SELECT approval_policy_simulate($1,$2,$3)',['inspection','KSA','JEDDAH']); assert.equal(route.mode,'legacy'); assert.equal(route.status,'no_route');
  });
  await t.test('return preserves a distinct outcome and resubmission starts a new immutable workflow', async () => {
   await submit(uuid(38)); const old=await context(uuid(38)); assert.equal(old.can_return,true);
   const receipt=await scalar('SELECT decide_approval($1,$2,$3,$4,$5,$6,$7,NULL,NULL)',['checklist',uuid(38),'returned',old.revision,old.stage_token,uuid(109),'Correct the observations']);
   assert.equal(receipt.decision,'returned'); assert.equal(receipt.status,'rejected'); assert.equal(receipt.workflow_status,'returned');
   assert.equal((await context(uuid(38))).workflow_status,'returned');
   await actor(submitter); await db.query("UPDATE checklist_submissions SET answers='{\"brakes\":\"Pass\"}',approval_status='pending' WHERE id=$1",[uuid(38)]);
   await actor(reviewer); const revised=await context(uuid(38)); assert.notEqual(revised.stage_token,old.stage_token); assert.notEqual(revised.revision,old.revision);
   assert.equal(revised.current_stage,0); assert.equal(revised.history.some(x=>x.action==='approved'),false);
   assert.equal(await scalar("SELECT count(*)::int FROM workflow_step_events WHERE instance_id=$1 AND action='returned'",[old.document.approval_workflow_id]),1);
   await assert.rejects(decide(uuid(38),old,uuid(110)),e=>e.code==='40001');
  });
  await t.test('a terminal rejection cannot be edited or resubmitted as if it had been returned', async () => {
   await submit(uuid(39)); await decide(uuid(39),await context(uuid(39)),uuid(111),'rejected','Request denied');
   await actor(submitter);
   await assert.rejects(db.query("UPDATE checklist_submissions SET answers='{\"changed\":true}' WHERE id=$1",[uuid(39)]),e=>e.code==='40001');
   await assert.rejects(db.query("UPDATE checklist_submissions SET approval_status='pending' WHERE id=$1",[uuid(39)]),e=>e.code==='40001');
  });
  await t.test('template drift denies approval but permits a fresh reviewed return for correction', async () => {
   await submit(uuid(40));
   await db.exec(`RESET ROLE; UPDATE checklist_templates SET fields='[{"name":"new question"}]' WHERE id='${uuid(20)}'; SET ROLE authenticated;`);
   const c=await context(uuid(40)); assert.equal(c.can_decide,false); assert.equal(c.can_return,true);
   assert.equal((await decide(uuid(40),c,uuid(112),'returned','Template changed; review updated form')).workflow_status,'returned');
   await db.exec(`RESET ROLE; UPDATE checklist_templates SET fields='[]' WHERE id='${uuid(20)}'; SET ROLE authenticated;`);
  });
  await t.test('inspection adapter preserves locking, signature requirements and domain final status', async () => {
   await actor(admin); await publish(await save(policy({name:'Inspection policy',entity_type:'inspection',priority:20})));
   await actor(submitter); await db.query('INSERT INTO inspections(id,organisation_id,country,site,title,created_by) VALUES($1,$2,$3,$4,$5,$6)',[uuid(41),org,'KSA','JEDDAH','Inspection',submitter]);
   await actor(reviewer); const c=await context(uuid(41),'inspection'); assert.equal(c.can_decide,true);
   await assert.rejects(scalar('SELECT decide_approval($1,$2,$3,$4,$5,$6,NULL,NULL,NULL)',['inspection',uuid(41),'approved',c.revision,c.stage_token,uuid(113)]),e=>e.code==='22023');
   const receipt=await scalar('SELECT decide_approval($1,$2,$3,$4,$5,$6,NULL,$7,NULL)',['inspection',uuid(41),'approved',c.revision,c.stage_token,uuid(113),'signature']);
   assert.equal(receipt.status,'approved'); const final=await context(uuid(41),'inspection'); assert.equal(final.document.status,'Done'); assert.equal(final.document.locked,true);
  });
  await t.test('stage notifications are tenant-scoped, persistent and not duplicated on decision replay', async () => {
   await actor(admin);
   const counts=await scalar('SELECT approval_dashboard()'); assert.ok(counts.metrics.total_count>0);
   await db.exec('RESET ROLE');
   assert.ok(await scalar("SELECT count(*)::int FROM notifications WHERE user_id=$1 AND title='Approval required'",[reviewer])>0);
   assert.equal(await scalar('SELECT count(*)::int FROM notifications WHERE user_id=$1',[uuid(7)]),0);
   assert.ok(await scalar("SELECT count(*)::int FROM workflow_notifications WHERE payload->>'approval_matrix'='true' AND status='pending'")>0);
   assert.ok(await scalar("SELECT count(*)::int FROM notifications WHERE title='Checklist returned for correction'")>0);
   assert.ok(await scalar("SELECT count(*)::int FROM notifications WHERE title='Checklist rejected'")>0);
   await db.exec('SET ROLE authenticated');
  });
 } finally { await db.close(); }
});
