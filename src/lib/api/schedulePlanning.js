/**
 * Inspection plan service: adherence, coverage, and spreadsheet intake.
 *
 * Adherence and coverage come from SECURITY INVOKER RPCs, so org, country and
 * site RLS apply to the caller exactly as they do on a table read. The state of
 * a plan is computed there, live, and is never stored - a stored state goes
 * stale the moment an inspection lands.
 *
 * The planner surface is `src/pages/InspectionPlanner.jsx`. Do not add a second
 * scheduling screen; extend that one.
 */
import { supabase, unwrap, fetchAllPages, isMissingRelation } from './_client'

/** Uploading more than this in one go is a sign the sheet is wrong, not big. */
export const PLAN_INSERT_CHUNK = 200

const PEOPLE_COLS = 'id, full_name, username, role, country, sites, approved, locked'
const FLEET_COLS = 'id, asset_no, site, vehicle_type, country, status'

function rpcArgs(extra = {}) {
  return Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined))
}

/** A country argument only ever narrows; RLS is what bounds the caller. */
function scopeCountry(country) {
  return country && country !== 'All' ? country : null
}

// -- Reads -------------------------------------------------------------------

/**
 * One row per plan in the window, each carrying the inspection that fulfilled
 * it and the resulting state. Returns [] when the RPC is not deployed yet so a
 * page can still render rather than showing an error the user cannot act on.
 */
export async function loadAdherence({ country, from, to } = {}) {
  try {
    const rows = unwrap(await supabase.rpc('get_schedule_adherence', rpcArgs({
      p_country: scopeCountry(country),
      p_from: from || undefined,
      p_to: to || undefined,
    })))
    return Array.isArray(rows) ? rows : []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Per-site planning coverage: who is planned, who is overdue with no plan. */
export async function loadPlanCoverage({ country, horizonDays = 30 } = {}) {
  try {
    const rows = unwrap(await supabase.rpc('get_plan_coverage', rpcArgs({
      p_country: scopeCountry(country),
      p_horizon_days: horizonDays,
    })))
    return Array.isArray(rows) ? rows : []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * The pick list: active vehicles with no live plan, never-inspected first.
 * `total` is the true total, so a capped list can say how much it is hiding
 * instead of quietly looking complete.
 */
export async function loadUnplannedAssets({ country, horizonDays = 30, site, limit = 300 } = {}) {
  try {
    const rows = unwrap(await supabase.rpc('get_unplanned_assets', rpcArgs({
      p_country: scopeCountry(country),
      p_horizon_days: horizonDays,
      p_site: site || null,
      p_limit: limit,
    })))
    const list = Array.isArray(rows) ? rows : []
    const total = list.length ? Number(list[0].total_unplanned) || list.length : 0
    return { rows: list, total, truncated: total > list.length }
  } catch (err) {
    if (isMissingRelation(err)) return { rows: [], total: 0, truncated: false }
    throw err
  }
}

/**
 * People a plan can be assigned to. Only approved, unlocked accounts - a plan
 * handed to a locked account is work nobody can do.
 */
export async function loadPlanPeople({ country } = {}) {
  const result = await fetchAllPages((fromRow, toRow) => supabase
    .from('profiles').select(PEOPLE_COLS)
    .eq('approved', true).eq('locked', false)
    .order('full_name').order('id').range(fromRow, toRow), { max: 5000 })
  if (result.error) throw result.error
  const scope = scopeCountry(country)
  const rows = (result.data || []).filter(person => {
    if (!scope) return true
    const countries = Array.isArray(person.country) ? person.country : []
    // A person with no country recorded is offered everywhere rather than
    // hidden, matching how the rest of the app treats an unset scope.
    return !countries.length || countries.includes(scope)
  })
  return { rows, truncated: Boolean(result.truncated) }
}

/** Active fleet for validating an upload and for the pick list. */
export async function loadPlanFleet({ country } = {}) {
  const scope = scopeCountry(country)
  const result = await fetchAllPages((fromRow, toRow) => {
    let query = supabase.from('vehicle_fleet').select(FLEET_COLS)
      .order('asset_no').order('id').range(fromRow, toRow)
    if (scope) query = query.eq('country', scope)
    return query
  }, { max: 20000 })
  if (result.error) throw result.error
  const rows = (result.data || []).filter(row => String(row.status || 'Active') === 'Active')
  return { rows, truncated: Boolean(result.truncated) }
}

/** Recent upload batches, newest first, so one can be found and undone. */
export async function listPlanBatches({ country, limit = 25 } = {}) {
  const scope = scopeCountry(country)
  let query = supabase.from('inspection_schedules')
    .select('plan_ref, country, created_at, created_by')
    .not('plan_ref', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000)
  if (scope) query = query.or(`country.eq.${scope},country.is.null`)
  const rows = unwrap(await query) || []
  const batches = new Map()
  for (const row of rows) {
    const existing = batches.get(row.plan_ref)
    if (existing) { existing.count += 1; continue }
    batches.set(row.plan_ref, { plan_ref: row.plan_ref, country: row.country, created_at: row.created_at, created_by: row.created_by, count: 1 })
  }
  return [...batches.values()].slice(0, limit)
}

// -- Writes ------------------------------------------------------------------

function toPlanPayload(row, { country, profileId, planRef }) {
  return {
    asset_no: row.asset_no,
    site: row.site || null,
    scheduled_date: row.scheduled_date,
    inspection_time: row.inspection_time || '08:00',
    inspector_name: row.inspector_name || null,
    assigned_to: row.assigned_to || null,
    team: row.team || null,
    inspection_type: row.inspection_type || 'Routine',
    priority: row.priority || 'Medium',
    status: 'Scheduled',
    notes: row.notes || null,
    grace_days: Number.isInteger(row.grace_days) ? row.grace_days : 2,
    plan_ref: planRef,
    country,
    created_by: profileId || null,
  }
}

/**
 * Write one upload batch.
 *
 * Chunked so a large sheet does not ride on a single request, and every chunk
 * is confirmed by row count - a write that cannot be confirmed is reported as
 * a failure rather than assumed to have worked. Partial progress is returned
 * with the batch reference so the caller can undo exactly what landed.
 */
export async function createPlanBatch(rows, { country, profileId, planRef, onProgress } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('There are no ready rows to schedule.')
  if (!country || country === 'All') throw new Error('Choose a country before uploading a plan.')
  if (!planRef) throw new Error('This upload has no batch reference.')

  let inserted = 0
  for (let index = 0; index < rows.length; index += PLAN_INSERT_CHUNK) {
    const chunk = rows.slice(index, index + PLAN_INSERT_CHUNK)
    const payload = chunk.map(row => toPlanPayload(row, { country, profileId, planRef }))
    const result = await supabase.from('inspection_schedules').insert(payload).select('id')
    if (result.error) {
      const err = new Error(result.error.message)
      err.cause = result.error
      err.inserted = inserted
      err.planRef = planRef
      throw err
    }
    if (!Array.isArray(result.data) || result.data.length !== chunk.length) {
      const err = new Error('Part of this upload could not be confirmed. Check the batch before uploading again.')
      err.inserted = inserted
      err.planRef = planRef
      throw err
    }
    inserted += result.data.length
    onProgress?.({ inserted, total: rows.length })
  }
  return { inserted, planRef }
}

/**
 * Undo an upload batch.
 *
 * Plans that have already been carried out are DELIBERATELY kept: removing a
 * plan an inspector already completed would erase the evidence that the work
 * happened. Only untouched plans are withdrawn, and the caller is told how
 * many were kept and why.
 */
export async function undoPlanBatch(planRef, { keepFulfilled = true, country } = {}) {
  if (!planRef) throw new Error('Choose a batch to undo.')
  const adherence = await loadAdherence({ country, from: '1900-01-01', to: '2999-12-31' })
  const inBatch = adherence.filter(row => row.plan_ref === planRef)
  const fulfilled = inBatch.filter(row => row.plan_state === 'Done' || row.plan_state === 'Started')
  const removable = keepFulfilled
    ? inBatch.filter(row => row.plan_state !== 'Done' && row.plan_state !== 'Started')
    : inBatch
  if (!removable.length) {
    return { removed: 0, kept: fulfilled.length, reason: fulfilled.length ? 'Every plan in this batch has already been worked on.' : 'This batch has no plans left to withdraw.' }
  }
  const ids = removable.map(row => row.id)
  let removed = 0
  for (let index = 0; index < ids.length; index += PLAN_INSERT_CHUNK) {
    const slice = ids.slice(index, index + PLAN_INSERT_CHUNK)
    const result = await supabase.from('inspection_schedules').delete().in('id', slice).select('id')
    if (result.error) throw result.error
    removed += (result.data || []).length
  }
  return { removed, kept: fulfilled.length, reason: fulfilled.length ? 'Plans that were already worked on were kept.' : '' }
}

/** Reassign a single plan to a person and crew. */
export async function assignPlan(id, { assignedTo, inspectorName, team } = {}) {
  if (!id) throw new Error('Choose a plan to assign.')
  const patch = {
    assigned_to: assignedTo || null,
    inspector_name: inspectorName || null,
    team: team || null,
  }
  const result = await supabase.from('inspection_schedules').update(patch).eq('id', id).select('id')
  if (result.error) throw result.error
  if (!Array.isArray(result.data) || result.data.length !== 1) {
    throw new Error('The change could not be confirmed. Refresh and check your access before trying again.')
  }
  return result.data[0]
}

/** Move a missed or upcoming plan to a new date. */
export async function reschedulePlan(id, scheduledDate) {
  if (!id) throw new Error('Choose a plan to move.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(scheduledDate || ''))) throw new Error('Choose a valid date.')
  const result = await supabase.from('inspection_schedules')
    .update({ scheduled_date: scheduledDate, status: 'Scheduled' }).eq('id', id).select('id')
  if (result.error) throw result.error
  if (!Array.isArray(result.data) || result.data.length !== 1) {
    throw new Error('The change could not be confirmed. Refresh and check your access before trying again.')
  }
  return result.data[0]
}
