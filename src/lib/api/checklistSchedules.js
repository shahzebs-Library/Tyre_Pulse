/**
 * Checklist scheduling service — recurring schedules and the assignments they
 * generate (V124). Schedules assign a template to sites/assets on a cadence;
 * `generate_checklist_assignments()` (daily pg_cron, or on-demand here)
 * materialises due assignments. Org/country-scoped; mirrors checklists.js.
 */
import { supabase, unwrap, applyCountry } from './_client'

const SCHED_COLS =
  'id,organisation_id,country,template_id,name,cadence,sites,asset_nos,assignee_role,start_date,next_due,active,created_by,created_at,updated_at'
const ASSIGN_COLS =
  'id,country,schedule_id,template_id,template_name,site,asset_no,assignee_role,due_date,status,submission_id,completed_at,created_at,updated_at'

// ── Schedules ───────────────────────────────────────────────────────────────

export async function listSchedules({ country, active, limit = 200 } = {}) {
  let q = supabase.from('checklist_schedules').select(SCHED_COLS)
  if (active != null) q = q.eq('active', active)
  q = applyCountry(q, country)
  return unwrap(await q.order('next_due', { ascending: true }).limit(limit)) || []
}

export async function getSchedule(id) {
  return unwrap(await supabase.from('checklist_schedules').select(SCHED_COLS).eq('id', id).maybeSingle())
}

export async function createSchedule(values) {
  const payload = {
    template_id: values.template_id,
    name: values.name,
    cadence: values.cadence || 'weekly',
    sites: Array.isArray(values.sites) ? values.sites : [],
    asset_nos: Array.isArray(values.asset_nos) ? values.asset_nos : [],
    assignee_role: values.assignee_role ?? null,
    country: values.country ?? null,
    start_date: values.start_date ?? undefined,
    next_due: values.next_due ?? values.start_date ?? undefined,
    active: values.active ?? true,
  }
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k])
  return unwrap(await supabase.from('checklist_schedules').insert(payload).select(SCHED_COLS).single())
}

export async function updateSchedule(id, patch) {
  const clean = { ...patch }
  delete clean.id; delete clean.created_at; delete clean.organisation_id
  return unwrap(await supabase.from('checklist_schedules').update(clean).eq('id', id).select(SCHED_COLS).single())
}

export async function setScheduleActive(id, active) {
  return updateSchedule(id, { active })
}

export async function deleteSchedule(id) {
  return unwrap(await supabase.from('checklist_schedules').delete().eq('id', id))
}

/** Materialise any due assignments right now (also runs daily via pg_cron). */
export async function generateNow() {
  return unwrap(await supabase.rpc('generate_checklist_assignments'))
}

// ── Assignments ─────────────────────────────────────────────────────────────

export async function listAssignments({ country, status, templateId, scheduleId, limit = 300 } = {}) {
  let q = supabase.from('checklist_assignments').select(ASSIGN_COLS)
  if (status) q = q.eq('status', status)
  if (templateId) q = q.eq('template_id', templateId)
  if (scheduleId) q = q.eq('schedule_id', scheduleId)
  q = applyCountry(q, country)
  return unwrap(await q.order('due_date', { ascending: true }).limit(limit)) || []
}

export async function getAssignment(id) {
  return unwrap(await supabase.from('checklist_assignments').select(ASSIGN_COLS).eq('id', id).maybeSingle())
}

/** Mark an assignment complete, linking the submission that fulfilled it. */
export async function completeAssignment(id, submissionId) {
  return unwrap(await supabase.from('checklist_assignments')
    .update({ status: 'completed', submission_id: submissionId ?? null, completed_at: new Date().toISOString() })
    .eq('id', id).select(ASSIGN_COLS).single())
}

export async function skipAssignment(id) {
  return unwrap(await supabase.from('checklist_assignments')
    .update({ status: 'skipped' }).eq('id', id).select(ASSIGN_COLS).single())
}
