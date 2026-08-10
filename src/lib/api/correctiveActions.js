/**
 * Corrective Actions service - corrective_actions records. Explicit column
 * lists (no SELECT *); additive, mirrors assets.js / inspections.js. Many pages
 * read corrective_actions (RCA, KPIs, executive reports, gate-pass blockers),
 * so this is the single boundary for that table as pages migrate onto it.
 */
import { supabase, unwrap, fetchAllPages, ServiceError } from './_client'
import { toUserMessage } from '../safeError'
import { actionRowsForInspection } from '../inspectionTyreFlags'

// Least-privilege column set covering the CorrectiveActions page (list + detail
// + edit form). Omits organisation_id (RLS-managed) and the legacy `photos`
// column the page does not read.
const COLS =
  'id,title,priority,site,region,description,assigned_to,status,root_cause,asset_no,tyre_serial,created_by,closed_by,created_at,closed_at,due_date,country,photo_data,work_order_id,source_type,source_id,source_detail'

/** Statuses that mean the action is finished (mirrors the V496 partial index). */
const CLOSED_STATUSES = ['closed', 'resolved', 'cancelled']
export const isActionClosed = (s) => CLOSED_STATUSES.includes(String(s ?? '').trim().toLowerCase())

/**
 * List corrective actions, newest first. Strict country scoping (exact match,
 * no NULL inclusion) to match the page's prior `.eq('country', ...)` behaviour.
 * @param {{country?:string}} [opts]
 */
export async function listCorrectiveActions({ country } = {}) {
  return unwrap(await fetchAllPages((from, to) => {
    let q = supabase.from('corrective_actions').select(COLS)
      .order('created_at', { ascending: false }).order('id').range(from, to)
    if (country && country !== 'All') q = q.eq('country', country)
    return q
  }))
}

/** Get one corrective action by id (or null if not found). */
export async function getCorrectiveAction(id) {
  return unwrap(await supabase.from('corrective_actions').select(COLS).eq('id', id).maybeSingle())
}

/** Create a corrective action; returns the inserted row. */
export async function createCorrectiveAction(values) {
  return unwrap(await supabase.from('corrective_actions').insert(values).select(COLS).single())
}

/** Update a corrective action by id. */
export async function updateCorrectiveAction(id, patch) {
  return unwrap(await supabase.from('corrective_actions').update(patch).eq('id', id))
}

/**
 * Actions already raised from one source row (an inspection or a checklist
 * submission). Degrades to [] rather than throwing, so a failure to read the
 * existing actions can never block the page that shows the defects.
 */
export async function listActionsForSource(sourceType, sourceId) {
  if (!sourceType || !sourceId) return []
  try {
    return await unwrap(await supabase.from('corrective_actions').select(COLS)
      .eq('source_type', sourceType).eq('source_id', sourceId)
      .order('created_at', { ascending: false }))
  } catch {
    return []
  }
}

/**
 * Raise corrective actions for an inspection's defects.
 *
 * The defect list and the row shape come from the pure engine
 * (inspectionTyreFlags.defectsForAction / actionRowsForInspection) so the flag a
 * user sees on the register and the action raised from it can never disagree.
 *
 * Idempotent twice over: already-open actions for the same defect are filtered
 * out client-side, and V496's partial unique index is the real guarantee if two
 * people press the button at once. A duplicate-key rejection is therefore an
 * expected outcome, not an error - it is reported as `skipped`.
 *
 * @returns {{created:Object[], skipped:number, failed:{key:string,error:string}[]}}
 */
export async function raiseActionsForInspection(inspection, defects = []) {
  if (!inspection?.id) throw new ServiceError('An inspection is required to raise an action.')

  const existing = await listActionsForSource('inspection', inspection.id)
  const openKeys = existing.filter(a => !isActionClosed(a.status))
    .map(a => a.source_detail).filter(Boolean)

  const rows = actionRowsForInspection(inspection, defects, { existingKeys: openKeys })
  const skippedUpFront = (defects?.length || 0) - rows.length

  const created = []
  const failed = []
  let skipped = skippedUpFront

  // One at a time: a single duplicate must not roll back the rest of the batch.
  for (const row of rows) {
    const { data, error } = await supabase.from('corrective_actions').insert(row).select(COLS).single()
    if (error) {
      // 23505 = the V496 uniqueness guard did its job; that is a skip, not a failure.
      if (error.code === '23505') skipped += 1
      else failed.push({ key: row.source_detail, error: toUserMessage(error) })
      continue
    }
    created.push(data)
  }
  return { created, skipped, failed }
}

/**
 * Turn a corrective action into a scheduled job and link the two.
 *
 * REUSES workshopLive.createJob - the single work-order creator, which owns the
 * work-order number, the canonical status vocabulary and the payload shape. A
 * second creator here would drift from it. Imported lazily so the corrective
 * action service does not pull the workshop module into every page that reads
 * an action.
 *
 * The link is written after the job exists; if that write fails the job is NOT
 * orphaned silently - the error carries the created work order number so it can
 * be linked by hand.
 */
export async function createWorkOrderForAction(action, overrides = {}) {
  if (!action?.id) throw new ServiceError('A corrective action is required.')
  if (!action.asset_no) throw new ServiceError('This action has no asset number, so a job cannot be raised for it.')
  if (action.work_order_id) throw new ServiceError('A job has already been raised for this action.')

  const { createJob } = await import('./workshopLive')
  const job = await createJob({
    asset_no: action.asset_no,
    priority: action.priority || 'Medium',
    work_type: 'Repair',
    description: [action.title, action.description].filter(Boolean).join(' - ').slice(0, 2000),
    site: action.site || null,
    country: action.country || null,
    ...overrides,
  })

  try {
    await updateCorrectiveAction(action.id, { work_order_id: job.id })
  } catch (e) {
    throw new ServiceError(
      `Job ${job.work_order_no} was created but could not be linked to this action. Link it manually.`,
      { cause: e },
    )
  }
  return job
}
