/**
 * PM Programs service (V163) — preventive-maintenance programs defined against
 * an asset or asset-type with a recurring service interval and next-due date.
 * RLS enforces org isolation (read for any member; write for Admin/Manager/
 * Director). This layer keeps an explicit column list (least-privilege select)
 * and null-safe country scoping, mirroring certifications.js / support.js.
 *
 * When the table has not been migrated yet, the lister degrades to [] so the
 * page can surface an "apply MIGRATIONS_V163_PM_PROGRAMS.sql" hint instead of
 * throwing.
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,name,asset_no,asset_type,interval_type,interval_value,' +
  'last_done,next_due,site,status,notes,created_by,created_at,updated_at,' +
  'asset_category,meter_source,meter_interval,last_done_meter,next_due_meter,' +
  'assigned_to,priority,estimated_cost,task_list'

/** Explicit least-privilege column list for pm_service_records (V253). */
export const SERVICE_RECORD_COLS =
  'id,pm_program_id,asset_no,service_date,meter_reading,meter_type,performed_by,workshop,' +
  'site,tasks_done,parts_used,parts_cost,labour_cost,total_cost,findings,outcome,' +
  'next_due,next_due_meter,work_order_no,notes,created_by,created_at'

export const PM_STATUS_VALUES = ['active', 'paused', 'completed']
export const PM_INTERVAL_VALUES = ['km', 'hours', 'days', 'months']
export const PM_ASSET_CATEGORIES = ['vehicle', 'generator', 'plant', 'machinery', 'equipment', 'other']
export const PM_METER_SOURCES = ['odometer', 'engine_hours', 'none']
export const PM_PRIORITIES = ['low', 'medium', 'high', 'critical']

/** Coerce a value to a finite number or null (empty string / null / NaN -> null). */
function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Split an array into fixed-size chunks. */
function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** True when a Supabase error means the table/relation is not deployed yet. */
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('relation') ||
    m.includes('schema cache') ||
    m.includes('could not find the table')
  )
}

/**
 * List PM programs (soonest next_due first). Optional country / status filters.
 * Returns [] when the table is missing so the UI can prompt for the migration
 * rather than error.
 */
export async function listPmPrograms({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('pm_programs').select(COLS)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(await q.order('next_due', { ascending: true, nullsFirst: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getPmProgram(id) {
  return unwrap(await supabase.from('pm_programs').select(COLS).eq('id', id).maybeSingle())
}

/** Create a PM program. `name` is required. */
export async function createPmProgram(values = {}) {
  const name = String(values.name || '').trim()
  if (!name) throw new Error('A program name is required.')
  const intervalType = PM_INTERVAL_VALUES.includes(values.interval_type) ? values.interval_type : 'months'
  const status = PM_STATUS_VALUES.includes(values.status) ? values.status : 'active'
  const intervalValue = values.interval_value === '' || values.interval_value == null
    ? null
    : Number(values.interval_value)
  const payload = {
    name: name.slice(0, 200),
    asset_no: values.asset_no ? String(values.asset_no).slice(0, 120) : null,
    asset_type: values.asset_type ? String(values.asset_type).slice(0, 120) : null,
    interval_type: intervalType,
    interval_value: Number.isFinite(intervalValue) ? intervalValue : null,
    last_done: values.last_done || null,
    next_due: values.next_due || null,
    site: values.site ? String(values.site).slice(0, 120) : null,
    status,
    notes: values.notes ? String(values.notes).slice(0, 4000) : null,
    country: values.country ?? null,
    asset_category: PM_ASSET_CATEGORIES.includes(values.asset_category) ? values.asset_category : null,
    meter_source: PM_METER_SOURCES.includes(values.meter_source) ? values.meter_source : 'none',
    meter_interval: numOrNull(values.meter_interval),
    last_done_meter: numOrNull(values.last_done_meter),
    next_due_meter: numOrNull(values.next_due_meter),
    assigned_to: values.assigned_to ? String(values.assigned_to).trim().slice(0, 120) : null,
    priority: PM_PRIORITIES.includes(values.priority) ? values.priority : 'medium',
    estimated_cost: numOrNull(values.estimated_cost),
    task_list: Array.isArray(values.task_list) ? values.task_list : [],
  }
  return unwrap(await supabase.from('pm_programs').insert(payload).select(COLS).single())
}

/** Patch a PM program. Immutable columns are stripped before update. */
export async function updatePmProgram(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.created_at
  delete clean.created_by
  delete clean.organisation_id
  if (clean.interval_type != null && !PM_INTERVAL_VALUES.includes(clean.interval_type)) delete clean.interval_type
  if (clean.status != null && !PM_STATUS_VALUES.includes(clean.status)) delete clean.status
  if (clean.name != null) {
    const name = String(clean.name).trim()
    if (!name) throw new Error('A program name is required.')
    clean.name = name.slice(0, 200)
  }
  if ('interval_value' in clean) {
    if (clean.interval_value === '' || clean.interval_value == null) clean.interval_value = null
    else {
      const n = Number(clean.interval_value)
      clean.interval_value = Number.isFinite(n) ? n : null
    }
  }
  if ('last_done' in clean && !clean.last_done) clean.last_done = null
  if ('next_due' in clean && !clean.next_due) clean.next_due = null
  // New V253 fields: whitelist + sanitize (keep only when valid).
  if ('asset_category' in clean && !PM_ASSET_CATEGORIES.includes(clean.asset_category)) clean.asset_category = null
  if (clean.meter_source != null && !PM_METER_SOURCES.includes(clean.meter_source)) delete clean.meter_source
  if (clean.priority != null && !PM_PRIORITIES.includes(clean.priority)) delete clean.priority
  for (const k of ['meter_interval', 'last_done_meter', 'next_due_meter', 'estimated_cost']) {
    if (k in clean) clean[k] = numOrNull(clean[k])
  }
  if ('assigned_to' in clean) {
    clean.assigned_to = clean.assigned_to ? String(clean.assigned_to).trim().slice(0, 120) : null
  }
  if ('task_list' in clean) clean.task_list = Array.isArray(clean.task_list) ? clean.task_list : []
  return unwrap(await supabase.from('pm_programs').update(clean).eq('id', id).select(COLS).single())
}

export async function deletePmProgram(id) {
  return unwrap(await supabase.from('pm_programs').delete().eq('id', id))
}

/**
 * Record a completed / partial / deferred PM service against a program via the
 * SECURITY DEFINER RPC `record_pm_service` (V253). The RPC writes the immutable
 * service row (total_cost is DB-generated), advances the program's last/next-due
 * and returns { record, program }. jsonb args pass as plain JS arrays/objects.
 * @param {string|number} programId
 * @param {{ service_date?:string, meter_reading?:number|string, performed_by?:string,
 *   workshop?:string, site?:string, tasks_done?:any[], parts_used?:any[],
 *   parts_cost?:number|string, labour_cost?:number|string, findings?:string,
 *   outcome?:string, work_order_no?:string, notes?:string }} values
 * @returns {Promise<{ record:object, program:object }>}
 */
export async function recordPmService(programId, values = {}) {
  return unwrap(
    await supabase.rpc('record_pm_service', {
      p_program_id: programId,
      p_service_date: values.service_date || null,
      p_meter_reading: numOrNull(values.meter_reading),
      p_performed_by: values.performed_by || null,
      p_workshop: values.workshop || null,
      p_site: values.site || null,
      p_tasks_done: Array.isArray(values.tasks_done) ? values.tasks_done : [],
      p_parts_used: Array.isArray(values.parts_used) ? values.parts_used : [],
      p_parts_cost: numOrNull(values.parts_cost),
      p_labour_cost: numOrNull(values.labour_cost),
      p_findings: values.findings || null,
      p_outcome: values.outcome || 'completed',
      p_work_order_no: values.work_order_no || null,
      p_notes: values.notes || null,
    }),
  )
}

/**
 * List PM service history (newest first). Optionally scoped to one asset and/or
 * program, country-scoped (null-safe). Returns [] when the table is not
 * provisioned so the page degrades to an "apply the migration" state.
 * @param {{ asset_no?:string, program_id?:string|number, country?:string, limit?:number }} [opts]
 */
export async function listPmServiceRecords({ asset_no, program_id, country, limit = 500 } = {}) {
  try {
    let q = supabase.from('pm_service_records').select(SERVICE_RECORD_COLS)
    if (asset_no) q = q.eq('asset_no', asset_no)
    if (program_id) q = q.eq('pm_program_id', program_id)
    q = applyCountry(q, country)
    return unwrap(await q.order('service_date', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Load the PM dashboard bundle: every program plus the latest meter reading for
 * each referenced asset, so the page can flag km / engine-hour based programs as
 * due without re-querying per row. Each meter source degrades independently to
 * an empty map on a missing relation, so one absent table never sinks the other.
 * @param {{ country?:string }} [opts]
 * @returns {Promise<{ plans:object[], kmByAsset:object, hoursByAsset:object }>}
 */
export async function loadPmDashboard({ country } = {}) {
  const plans = await listPmPrograms({ country })
  const assetNos = [...new Set(plans.map((p) => p.asset_no).filter((a) => a != null && a !== ''))]
  const kmByAsset = {}
  const hoursByAsset = {}
  if (!assetNos.length) return { plans, kmByAsset, hoursByAsset }

  const chunks = chunk(assetNos, 200)

  // Odometer / current_km from the fleet master.
  try {
    for (const c of chunks) {
      const { data, error } = await supabase
        .from('vehicle_fleet').select('asset_no,current_km').in('asset_no', c)
      if (error) throw error
      for (const r of data || []) {
        if (r && r.asset_no != null) kmByAsset[r.asset_no] = Number(r.current_km)
      }
    }
  } catch {
    // Missing relation or read error: leave kmByAsset as collected (never throw).
  }

  // Engine hours: keep the FIRST (latest) reading seen per asset (desc by date).
  try {
    for (const c of chunks) {
      const { data, error } = await supabase
        .from('engine_hours_logs').select('asset_no,engine_hours,reading_date')
        .in('asset_no', c).order('reading_date', { ascending: false })
      if (error) throw error
      for (const r of data || []) {
        if (r && r.asset_no != null && !(r.asset_no in hoursByAsset)) {
          hoursByAsset[r.asset_no] = Number(r.engine_hours)
        }
      }
    }
  } catch {
    // Missing relation or read error: leave hoursByAsset as collected (never throw).
  }

  return { plans, kmByAsset, hoursByAsset }
}
