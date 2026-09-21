import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../migrations/20260921123304_checklist_governance_policy.sql', import.meta.url)
const ORG = '11111111-1111-4111-8111-111111111111'
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TEMPLATE = '22222222-2222-4222-8222-222222222222'

async function database() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${USER}');
    create function auth.uid() returns uuid language sql stable as $$ select '${USER}'::uuid $$;
    create function public.app_current_org() returns uuid language sql stable as $$ select '${ORG}'::uuid $$;
    create function public.get_my_role() returns text language sql stable as $$ select 'Admin'::text $$;
    create function public.is_super_admin() returns boolean language sql stable as $$ select false $$;
    create table public.organisations (id uuid primary key);
    insert into public.organisations values ('${ORG}');
    create table public.checklist_templates (id uuid primary key, name text);
    insert into public.checklist_templates values ('${TEMPLATE}', 'Workshop');
    create table public.checklist_schedules (
      id uuid primary key default gen_random_uuid(), organisation_id uuid,
      country text, template_id uuid references public.checklist_templates(id), name text,
      cadence text, sites text[] default '{}', asset_nos text[] default '{}',
      assignee_role text, start_date date, next_due date, active boolean default true
    );
    create table public.checklist_submissions (
      id uuid primary key default gen_random_uuid(), organisation_id uuid,
      template_id uuid, template_name text, country text, site text,
      approval_status text, supervisor_at timestamptz, submitted_at timestamptz,
      created_at timestamptz default now(), answers jsonb default '{}',
      photos jsonb default '{}', notes jsonb default '{}', signature_data text
    );
    create table public.corrective_actions (
      id uuid primary key default gen_random_uuid(), organisation_id uuid,
      priority text, due_date date, created_at timestamptz default now()
    );
  `)
  await db.exec(await readFile(migrationUrl, 'utf8'))
  return db
}

test('policy is configurable and pilot schedules remain inside the boundary', async () => {
  const db = await database()
  const defaults = await db.query(`select public.get_checklist_governance_policy() as policy`)
  assert.equal(defaults.rows[0].policy.supervisor_approval_sla_hours, 24)
  const grants = await db.query(`select
    has_function_privilege('authenticated','public.get_checklist_governance_policy()','EXECUTE') can_read,
    has_function_privilege('authenticated','public.checklist_governance_defaults()','EXECUTE') can_defaults,
    has_function_privilege('authenticated','public.evaluate_checklist_submission_evidence()','EXECUTE') can_call_trigger`)
  assert.deepEqual(grants.rows[0], { can_read: true, can_defaults: true, can_call_trigger: false })
  await db.query(`select public.save_checklist_governance_policy($1::jsonb)`, [{
    industry_profile: 'mining', pilot_enabled: true, pilot_country: 'KSA',
    pilot_site: 'Riyadh', pilot_start_date: '2026-10-01', pilot_end_date: '2026-10-31',
    supervisor_approval_sla_hours: 12,
  }])
  await assert.rejects(
    db.exec(`insert into public.checklist_schedules
      (organisation_id,country,template_id,name,cadence,sites,start_date,next_due,pilot)
      values ('${ORG}','KSA','${TEMPLATE}','Bad','daily','{}','2026-10-01','2026-10-01',true)`),
    /configured pilot site|checklist_schedule_has_scope|violates check constraint/,
  )
  await db.exec(`insert into public.checklist_schedules
    (organisation_id,country,template_id,name,cadence,sites,start_date,next_due,pilot)
    values ('${ORG}','KSA','${TEMPLATE}','Pilot','daily','{Riyadh}','2026-10-01','2026-10-01',true)`)
  const saved = await db.query(`select industry_profile,supervisor_approval_sla_hours from public.checklist_governance_policies`)
  assert.deepEqual(saved.rows[0], { industry_profile: 'mining', supervisor_approval_sla_hours: 12 })
  await db.close()
})

test('evidence gaps are measured and corrective due dates use severity SLA', async () => {
  const db = await database()
  await db.exec(`insert into public.checklist_submissions
    (organisation_id,template_id,template_name,country,site,approval_status,submitted_at,answers)
    values ('${ORG}','${TEMPLATE}','Workshop','KSA','Riyadh','pending',now(),'{"brakes":"fail"}')`)
  const evidence = await db.query(`select evidence_policy_status,evidence_policy_gaps from public.checklist_submissions`)
  assert.equal(evidence.rows[0].evidence_policy_status, 'gaps')
  assert.equal(evidence.rows[0].evidence_policy_gaps.exception_notes_missing, 1)
  assert.equal(evidence.rows[0].evidence_policy_gaps.exception_photos_missing, 1)
  assert.equal(evidence.rows[0].evidence_policy_gaps.completion_signature_missing, true)

  await db.exec(`insert into public.corrective_actions (organisation_id,priority) values ('${ORG}','Critical')`)
  const action = await db.query(`select due_date-created_at::date as due_days from public.corrective_actions`)
  assert.equal(action.rows[0].due_days, 1)
  await db.close()
})

test('approval monitor reports configured targets and breaches', async () => {
  const db = await database()
  await db.exec(`insert into public.checklist_submissions
    (organisation_id,template_id,template_name,country,site,approval_status,submitted_at)
    values ('${ORG}','${TEMPLATE}','Workshop','KSA','Riyadh','pending',now()-interval '30 hours')`)
  const result = await db.query(`select target_hours,breached_count,oldest_breached
    from public.checklist_approval_sla_monitor('KSA','${TEMPLATE}')`)
  assert.equal(result.rows[0].target_hours, 24)
  assert.equal(result.rows[0].breached_count, 1)
  assert.equal(result.rows[0].oldest_breached, true)
  await db.close()
})
