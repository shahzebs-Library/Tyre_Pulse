/**
 * Operational employee records (designation, reporting line, sites, availability), person-keyed
 * certifications and task-type requirements. Account permissions stay on profiles; these tables
 * describe the job. RLS: own row, the supervisor, or a workforce manager.
 */
import { supabase, unwrap, ServiceError, isNotProvisioned, toServiceError, fetchAllPages } from './_client'
import { NOT_INSTALLED } from './workforceAssignments'

export const EMPLOYEE_COLS = 'profile_id,employee_code,designation,department,team,supervisor_id,sites,responsibilities,employment_status,unavailable_until,shift_start,shift_end,escalation_contact,updated_at'
export const EMPLOYMENT_STATUSES = Object.freeze(['active', 'temporarily_unavailable', 'inactive'])

const wrap = (e, fallback) => { if (isNotProvisioned(e)) return new ServiceError(NOT_INSTALLED, e.code, e); return toServiceError(e, fallback) }

export async function listEmployeeRecords () {
  const r = await fetchAllPages((from, to) => supabase.from('workforce_employees').select(EMPLOYEE_COLS)
    .order('profile_id', { ascending: true }).range(from, to), { max: 20000 })
  if (r.error) throw wrap(r.error, 'Unable to load employee records')
  if (r.truncated) throw new ServiceError('The employee directory is larger than can be shown here. Narrow it first.')
  return r.data || []
}

const clean = v => { const s = String(v ?? '').trim(); return s === '' ? null : s }

/** Pure: validate + shape the editor form into a row. Throws a plain sentence on bad input. */
export function employeePayload (form) {
  if (!form?.profile_id) throw new ServiceError('Choose the employee account')
  const designation = clean(form.designation)
  if (!designation) throw new ServiceError('Designation is required')
  if (form.supervisor_id && form.supervisor_id === form.profile_id) throw new ServiceError('An employee cannot supervise themselves')
  const status = EMPLOYMENT_STATUSES.includes(form.employment_status) ? form.employment_status : 'active'
  const sites = (Array.isArray(form.sites) ? form.sites : String(form.sites || '').split(','))
    .map(s => String(s ?? '').trim().toUpperCase()).filter(Boolean)
  if (clean(form.shift_start) && clean(form.shift_end) && form.shift_start === form.shift_end) throw new ServiceError('Shift start and end cannot be the same time')
  return {
    profile_id: form.profile_id, designation, employee_code: clean(form.employee_code), department: clean(form.department), team: clean(form.team),
    supervisor_id: form.supervisor_id || null, sites: [...new Set(sites)], responsibilities: clean(form.responsibilities),
    employment_status: status, unavailable_until: status === 'temporarily_unavailable' ? clean(form.unavailable_until) : null,
    shift_start: clean(form.shift_start), shift_end: clean(form.shift_end), escalation_contact: clean(form.escalation_contact),
  }
}

export async function saveEmployeeRecord (form, { exists = false } = {}) {
  const row = employeePayload(form)
  const q = exists
    ? supabase.from('workforce_employees').update(row).eq('profile_id', row.profile_id)
    : supabase.from('workforce_employees').insert(row)
  const { data, error } = await q.select(EMPLOYEE_COLS).single()
  if (error) {
    if (/reporting loop/.test(String(error.message))) throw new ServiceError('This supervisor would create a reporting loop.')
    throw wrap(error, 'Could not save the employee record')
  }
  return data
}

export async function listEmployeeHistory (profileId) {
  try {
    return unwrap(await supabase.from('workforce_employee_history').select('id,changed_by,changed_at,old_values,new_values')
      .eq('profile_id', profileId).order('changed_at', { ascending: false }).limit(200))
  } catch (e) { throw wrap(e, 'Unable to load history') }
}

/** Pure: which tracked fields changed between two history snapshots. */
export function historyDiff (oldValues, newValues) {
  const keys = ['employee_code', 'designation', 'department', 'team', 'supervisor_id', 'sites', 'employment_status', 'unavailable_until', 'shift_start', 'shift_end', 'responsibilities', 'escalation_contact']
  return keys.filter(k => JSON.stringify(oldValues?.[k] ?? null) !== JSON.stringify(newValues?.[k] ?? null))
    .map(k => ({ field: k, from: oldValues?.[k] ?? null, to: newValues?.[k] ?? null }))
}

const CERT_COLS = 'id,profile_id,cert_type,cert_number,issued_on,expires_on,verified_by,created_at'
export async function listCertifications (profileId = null) {
  if (profileId) {
    try {
      return unwrap(await supabase.from('workforce_employee_certifications').select(CERT_COLS).eq('profile_id', profileId)
        .order('expires_on', { ascending: true, nullsFirst: false }).order('id', { ascending: true }).limit(1000))
    } catch (e) { throw wrap(e, 'Unable to load certifications') }
  }
  // Directory-wide: page past the server row cap; a silently short list would hide expired certificates.
  const r = await fetchAllPages((from, to) => supabase.from('workforce_employee_certifications').select(CERT_COLS)
    .order('id', { ascending: true }).range(from, to), { max: 50000 })
  if (r.error) throw wrap(r.error, 'Unable to load certifications')
  if (r.truncated) throw new ServiceError('There are more certificates than can be shown here.')
  return r.data || []
}

export async function addCertification ({ profile_id, cert_type, cert_number, issued_on, expires_on }) {
  if (!profile_id || !clean(cert_type)) throw new ServiceError('Employee and certificate type are required')
  if (issued_on && expires_on && expires_on < issued_on) throw new ServiceError('Expiry cannot be before the issue date')
  try {
    return unwrap(await supabase.from('workforce_employee_certifications')
      .insert({ profile_id, cert_type: clean(cert_type), cert_number: clean(cert_number), issued_on: issued_on || null, expires_on: expires_on || null })
      .select('id').single())
  } catch (e) { throw wrap(e, 'Could not record the certificate') }
}

/** Pure: certificate validity on a given day ('valid' | 'expired' | 'not_yet_valid' | 'expiring'). */
export function certificateState (cert, today = new Date().toISOString().slice(0, 10), warnDays = 30) {
  if (cert.issued_on && cert.issued_on > today) return 'not_yet_valid'
  if (!cert.expires_on) return 'valid'
  if (cert.expires_on < today) return 'expired'
  const days = (Date.parse(cert.expires_on) - Date.parse(today)) / 86400000
  return days <= warnDays ? 'expiring' : 'valid'
}

export const TASK_TYPE_COLS = 'id,task_type,label,required_skill_id,min_skill_level,required_cert_type,safety_critical,evidence_required,technical_review_required,operational_record_table,active'
export async function listTaskTypes () {
  try { return unwrap(await supabase.from('workforce_task_types').select(TASK_TYPE_COLS).order('task_type').limit(500)) } catch (e) {
    if (isNotProvisioned(e)) return []
    throw wrap(e, 'Unable to load task types')
  }
}
export async function saveTaskType (form) {
  const task_type = clean(form.task_type)
  if (!task_type) throw new ServiceError('Task type is required')
  if (form.safety_critical && !clean(form.required_skill_id) && !clean(form.required_cert_type)) {
    throw new ServiceError('A safety-critical task must name the required skill or certificate')
  }
  const row = {
    task_type, label: clean(form.label), required_skill_id: clean(form.required_skill_id), min_skill_level: Math.min(3, Math.max(1, Number(form.min_skill_level) || 1)),
    required_cert_type: clean(form.required_cert_type), safety_critical: !!form.safety_critical, evidence_required: !!form.evidence_required,
    technical_review_required: !!form.technical_review_required, operational_record_table: clean(form.operational_record_table), active: form.active !== false,
  }
  const q = form.id ? supabase.from('workforce_task_types').update(row).eq('id', form.id) : supabase.from('workforce_task_types').insert(row)
  try { return unwrap(await q.select(TASK_TYPE_COLS).single()) } catch (e) { throw wrap(e, 'Could not save the task type') }
}

/** Pure: direct + indirect reports of a supervisor (loop-safe). */
export function reportingTree (records, supervisorId) {
  const bySup = new Map()
  for (const r of records) { if (!r.supervisor_id) continue; if (!bySup.has(r.supervisor_id)) bySup.set(r.supervisor_id, []); bySup.get(r.supervisor_id).push(r.profile_id) }
  const out = []; const seen = new Set([supervisorId]); const queue = [...(bySup.get(supervisorId) || [])]
  while (queue.length) { const id = queue.shift(); if (seen.has(id)) continue; seen.add(id); out.push(id); queue.push(...(bySup.get(id) || [])) }
  return out
}

/** Assignment evidence (private bucket, assignee uploads while the work is open). */
export async function listAssignmentEvidence (assignmentId) {
  try {
    return unwrap(await supabase.from('workforce_assignment_evidence').select('id,kind,object_path,file_name,mime_type,byte_size,uploaded_by,created_at')
      .eq('assignment_id', assignmentId).order('created_at'))
  } catch (e) { throw wrap(e, 'Unable to load evidence') }
}
export async function uploadAssignmentEvidence ({ assignment, organisationId, file, kind = 'photo' }) {
  if (!file) throw new ServiceError('Choose a file')
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) throw new ServiceError('Only JPG, PNG or PDF files are accepted')
  if (file.size < 1 || file.size > 10485760) throw new ServiceError('Files must be under 10 MB')
  const safe = String(file.name || 'evidence').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120)
  const path = `${organisationId}/assignments/${assignment.id}/${Date.now()}-${safe}`
  const up = await supabase.storage.from('workforce-evidence').upload(path, file, { upsert: false, contentType: file.type })
  if (up.error) throw wrap(up.error, 'Could not upload the file')
  try {
    return unwrap(await supabase.from('workforce_assignment_evidence')
      .insert({ assignment_id: assignment.id, kind, object_path: path, file_name: file.name.slice(0, 240), mime_type: file.type, byte_size: file.size }).select('id').single())
  } catch (e) {
    // Orphan file cleanup is best-effort; the metadata row is what makes evidence count.
    await supabase.storage.from('workforce-evidence').remove([path]).catch(() => {})
    throw wrap(e, 'Could not record the evidence')
  }
}
