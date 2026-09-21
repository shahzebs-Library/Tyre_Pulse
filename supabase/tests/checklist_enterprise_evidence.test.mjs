import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../migrations/20260921075921_checklist_enterprise_evidence_and_compliance.sql', import.meta.url)
const skipMigrationUrl = new URL('../migrations/20260921083057_checklist_assignment_skip_audit.sql', import.meta.url)
const ORG = '11111111-1111-4111-8111-111111111111'
const TEMPLATE = '22222222-2222-4222-8222-222222222222'

async function database() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create function public.app_current_org() returns uuid language sql stable as $$ select '${ORG}'::uuid $$;
    create table public.checklist_templates (
      id uuid primary key, organisation_id uuid, version integer not null default 1,
      name text, description text, category text, country text, status text,
      require_signature boolean default false, require_approval boolean default false,
      require_area_manager boolean default false, scored boolean default false,
      pass_threshold numeric, assignee_roles text[], doc_prefix text, min_interval_days integer,
      name_i18n jsonb, description_i18n jsonb, option_sets jsonb, fields jsonb,
      created_by uuid
    );
    create table public.checklist_submissions (
      id uuid primary key default gen_random_uuid(), organisation_id uuid,
      template_id uuid references public.checklist_templates(id), template_name text,
      template_version integer, submitted_at timestamptz default now()
    );
    create table public.checklist_assignments (
      id uuid primary key default gen_random_uuid(), template_id uuid, template_name text,
      country text, site text, due_date date, status text, submission_id uuid,
      completed_at timestamptz
    );
  `)
  await db.exec(await readFile(migrationUrl, 'utf8'))
  return db
}

test('published revisions are immutable and submissions receive exact evidence', async () => {
  const db = await database()
  await db.exec(`insert into public.checklist_templates
    (id, organisation_id, version, name, status, fields)
    values ('${TEMPLATE}', '${ORG}', 1, 'Workshop', 'published', '[{"id":"brakes","label":"Brakes"}]')`)

  await db.exec(`update public.checklist_templates set fields = '[{"id":"brakes","label":"Service brakes"}]' where id = '${TEMPLATE}'`)
  const versions = await db.query(`select version from public.checklist_template_revisions order by version`)
  assert.deepEqual(versions.rows.map((row) => row.version), [1, 2])

  await db.exec(`insert into public.checklist_submissions (organisation_id, template_id, template_version)
    values ('${ORG}', '${TEMPLATE}', 1)`)
  const submission = await db.query(`select template_snapshot_status, template_snapshot #>> '{fields,0,label}' as label
    from public.checklist_submissions`)
  assert.deepEqual(submission.rows[0], { template_snapshot_status: 'exact', label: 'Brakes' })
  await assert.rejects(
    db.exec(`update public.checklist_submissions set template_snapshot = '{}'`),
    /evidence is immutable/,
  )
  await db.close()
})

test('compliance uses assignments and exposes missing evidence', async () => {
  const db = await database()
  await db.exec(`
    insert into public.checklist_templates (id, organisation_id, name, status, fields)
      values ('${TEMPLATE}', '${ORG}', 'Workshop', 'published', '[]');
    insert into public.checklist_submissions (organisation_id, template_id, template_version)
      values ('${ORG}', '${TEMPLATE}', 99);
    insert into public.checklist_assignments
      (template_id, template_name, country, site, due_date, status, submission_id, completed_at)
      select '${TEMPLATE}', 'Workshop', 'KSA', 'Riyadh', '2026-09-10', 'completed', id, '2026-09-11'
      from public.checklist_submissions;
  `)
  const result = await db.query(`select due_count, completed_count, completed_late_count,
      evidence_gap_count, compliance_pct, on_time_pct
    from public.checklist_compliance_monitor('2026-09-01', '2026-09-30', 'KSA', null, null)`)
  assert.deepEqual(result.rows[0], {
    due_count: 1, completed_count: 1, completed_late_count: 1,
    evidence_gap_count: 1, compliance_pct: '100.0', on_time_pct: '0.0',
  })
  await db.close()
})

test('assignment skips require an immutable reason and server timestamp', async () => {
  const db = await database()
  await db.exec(await readFile(skipMigrationUrl, 'utf8'))
  await db.exec(`insert into public.checklist_assignments
    (template_id, template_name, country, site, due_date, status)
    values ('${TEMPLATE}', 'Workshop', 'KSA', 'Riyadh', '2026-09-10', 'pending')`)
  await assert.rejects(
    db.exec(`update public.checklist_assignments set status = 'skipped'`),
    /reason is required/,
  )
  await db.exec(`update public.checklist_assignments
    set status = 'skipped', skip_reason = '  Asset out of service  '`)
  const result = await db.query(`select skip_reason, skipped_at is not null as stamped
    from public.checklist_assignments`)
  assert.deepEqual(result.rows[0], { skip_reason: 'Asset out of service', stamped: true })
  await assert.rejects(
    db.exec(`update public.checklist_assignments set skip_reason = 'Changed later'`),
    /skip evidence is immutable/,
  )
  await db.close()
})
