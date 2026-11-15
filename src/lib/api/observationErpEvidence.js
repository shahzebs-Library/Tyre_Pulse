/**
 * Scoped, bounded, read-only job-card evidence lookup. A query failure is NOT
 * treated as an empty match. Existing ERP records are the only data source.
 */
import { supabase, unwrap, ServiceError, isNotProvisioned } from './_client'
import { matchObservationToErp } from '../erpObservationMatch'
import { getCustomLayoutMap } from './vehicleDiagrams'
import { toUserMessage } from '../safeError'
import { ERP_RULES_VERSION } from '../tyrePositionService'

const WO_FIELDS = 'id,work_order_no,asset_no,country,site,description,notes,status,opened_at,completed_at'
const TYRE_FIELDS = 'id,asset_no,country,serial_no,position,tyre_position,job_card,issue_date,removal_date,status'
const EXPENSE_FIELDS = 'id,country,asset_code,work_order_no,txn_date,issue_number,item_code,item_description,qty,tyre_amount,spare_parts_amount,oil_amount,total_amount,value_amount,source_row'

/**
 * The company that owns the inspection. Taken from the row when the caller
 * already has it, otherwise read once by id. A failed read is an error (it is
 * not treated as "no company", which would widen the evidence search).
 */
async function inspectionOrg(inspection) {
  if (inspection.organisation_id) return inspection.organisation_id
  const { data, error } = await supabase.from('inspections')
    .select('organisation_id').eq('id', inspection.id).maybeSingle()
  if (error) throw new ServiceError(toUserMessage(error, 'Could not read the inspection.'))
  return data?.organisation_id ?? null
}

export async function findObservationErpEvidence({ inspection, finding }) {
  if (!inspection?.id || !inspection?.asset_no || !inspection?.country || !finding?.rawPosition) {
    throw new ServiceError('A saved inspection, vehicle, country and wheel position are required.')
  }
  const country = inspection.country, asset = inspection.asset_no
  const inspectionDate = String(inspection.inspection_date || inspection.completed_date || inspection.created_at || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inspectionDate)) {
    throw new ServiceError('Inspection date missing. Job cards cannot be reliably reconciled.')
  }
  // Job card numbers and asset codes are unique per COMPANY, not globally
  // (TEN-1b). Every evidence read is pinned to the inspection's own company, so
  // a super admin (whose reads span companies) never matches another company's
  // job card that happens to carry the same number.
  const org = await inspectionOrg(inspection)
  const scoped = (q) => (org ? q.eq('organisation_id', org) : q)
  // Never scan the entire historic asset history for a recent finding. The
  // evidence must postdate the observation; old job cards belong in ERP history.
  const tyreQuery = scoped(supabase.from('tyre_records').select(TYRE_FIELDS)
    .eq('country', country).eq('asset_no', asset))
    .or(`issue_date.gte.${inspectionDate},removal_date.gte.${inspectionDate}`)
    .order('issue_date', { ascending: false }).limit(200)
  const tyreResult = await tyreQuery
  const fitments = unwrap(tyreResult) || []
  const jobNumbers = [...new Set(fitments.map(r => String(r.job_card || '').trim()).filter(Boolean))]
  const workOrders = []
  let limited = fitments.length >= 200
  // Prioritise exact ERP job-card keys from actual tyre movements.
  for (let i = 0; i < jobNumbers.length; i += 25) {
    const rows = unwrap(await scoped(supabase.from('work_orders').select(WO_FIELDS)
      .eq('country', country).eq('asset_no', asset))
      .in('work_order_no', jobNumbers.slice(i, i + 25)).limit(100)) || []
    workOrders.push(...rows)
    if (rows.length >= 100) limited = true
  }
  // Then consider post-inspection tyre-specific job cards whose consumption
  // has not been imported yet. Do not display non-tyre workshop history.
  const recent = unwrap(await scoped(supabase.from('work_orders').select(WO_FIELDS)
    .eq('country', country).eq('asset_no', asset))
    .gte('opened_at', `${inspectionDate}T00:00:00`)
    .or('description.ilike.*tyre*,description.ilike.*tire*,description.ilike.*puncture*,notes.ilike.*tyre*,notes.ilike.*tire*')
    .order('opened_at', { ascending: false }).limit(100)) || []
  if (recent.length >= 100) limited = true
  const found = new Set(workOrders.map(w => w.id))
  for (const row of recent) if (!found.has(row.id)) {
    found.add(row.id); workOrders.push(row)
  }
  const relevantJobNumbers = [...new Set(workOrders.map(w => w.work_order_no).filter(Boolean))]
  const expenses = []
  for (let i = 0; i < relevantJobNumbers.length; i += 25) {
    const rows = unwrap(await scoped(supabase.from('parts_consumption').select(EXPENSE_FIELDS)
      .eq('country', country).eq('asset_code', asset))
      .in('work_order_no', relevantJobNumbers.slice(i, i + 25)).limit(250)) || []
    if (rows.length >= 250) limited = true
    expenses.push(...rows)
  }
  // The asset's OWN registered build decides the wheel layout both sides are read on
  // (tyrePositionService). Registered twice in one country: no layout is assumed.
  const [fleet, customLayouts, layoutHistory, positionMappings] = await Promise.all([
    scoped(supabase.from('vehicle_fleet').select('vehicle_type,axle_count').eq('country', country).eq('asset_no', asset)).limit(2),
    getCustomLayoutMap(),
    optionalRows(supabase.from('vehicle_diagram_config_versions')
      .select('vehicle_type,config,active,valid_from,valid_to,basis').order('valid_from', { ascending: true }).limit(500)),
    optionalRows(supabase.from('tyre_layout_position_mappings')
      .select('layout_key,erp_code,slot,active').eq('active', true).limit(500)),
  ])
  const fleetRows = unwrap(fleet) || []
  const machine = fleetRows.length === 1 ? fleetRows[0] : null
  const layoutContext = {
    vehicleType: machine?.vehicle_type || '',
    axleCount: machine?.axle_count ?? null,
    customLayouts,
    // The layout in force on the inspection day, and verified per-layout ERP spellings.
    layoutHistory: layoutHistory.map((v) => ({
      vehicleType: v.vehicle_type, config: v.config, active: v.active, validFrom: v.valid_from, validTo: v.valid_to, basis: v.basis,
    })),
    positionMappings,
  }
  const candidates = matchObservationToErp({ inspection, finding, workOrders, fitments, expenses, layoutContext })
  const existingJobs = new Set(workOrders.map(w => String(w.work_order_no || '').trim().toUpperCase()))
  const orphanTyreJobCards = jobNumbers.filter(number => !existingJobs.has(number.toUpperCase()))
  return {
    candidates, orphanTyreJobCards, evidenceLimited: limited,
    totals: { workOrders: workOrders.length, fitments: fitments.length, expenses: expenses.length },
  }
}

// Rows of a table that may not exist yet (its database change is not applied): none.
// Any other failure is a real error and is thrown.
async function optionalRows(query) {
  const res = await query
  if (res?.error) { if (isNotProvisioned(res.error)) return []; unwrap(res) }
  return res?.data || []
}

/**
 * Confirm a human-reviewed association. Database RPC revalidates tenant,
 * country, asset, candidate, and elevated permissions atomically.
 */
export async function confirmObservationErpLink({ actionId, workOrderId, note }) {
  if (!actionId || !workOrderId || !note?.trim()) throw new ServiceError('Action, job card, and review reason are required.')
  return unwrap(await supabase.rpc('confirm_observation_erp_link', {
    p_action_id: actionId, p_work_order_id: workOrderId, p_reason: note.trim(),
  }))
}
export async function rejectObservationErpSuggestion({ actionId, workOrderId, note }) {
  if (!actionId || !workOrderId || !note?.trim()) throw new ServiceError('A rejection reason is required.')
  return unwrap(await supabase.rpc('reject_observation_erp_link', {
    p_action_id: actionId, p_work_order_id: workOrderId, p_reason: note.trim(),
  }))
}
export async function getObservationErpLink(actionId) {
  if (!actionId) return null
  return unwrap(await supabase.from('observation_erp_links').select('id,action_id,work_order_id,reviewed_by,reviewed_at,decision_note,status,source_job_card,work_order_snapshot').eq('action_id',actionId).maybeSingle())
}

/** Append-only human decisions, with reviewer/date and exact ERP job card. */
export async function listObservationErpDecisions(actionId) {
  if (!actionId) return []
  return unwrap(await supabase.from('observation_erp_link_events')
    .select('id,decision,reason,source_job_card,work_order_snapshot,reviewer,created_at')
    .eq('action_id', actionId).order('created_at', { ascending: false }).limit(50)) || []
}

/**
 * The saved review state of one action: the confirmed link and the decision history.
 *
 * The review tables and functions ship in a database change that may not be applied yet.
 * That is reported as `provisioned: false`, NOT as "no link" and not as an error: the
 * evidence lookup above reads only existing ERP tables and still works, while Confirm and
 * Reject cannot. Any other failure is thrown, so a permission problem is never shown as
 * "not set up".
 */
export async function getObservationErpReviewState(actionId) {
  const decisions = await getErpDecisionAvailability()
  if (!actionId) return { provisioned: true, link: null, history: [], decisions }
  try {
    const [link, history] = await Promise.all([getObservationErpLink(actionId), listObservationErpDecisions(actionId)])
    return { provisioned: true, link, history, decisions }
  } catch (err) {
    if (isNotProvisioned(err)) return { provisioned: false, link: null, history: [], decisions }
    throw err
  }
}

/** Shown whenever a decision cannot be recorded because the database is not on the client's rules. */
export const ERP_DECISIONS_UNAVAILABLE_MESSAGE =
  'ERP confirmation is not available yet. Evidence can be reviewed, but a decision cannot be recorded until the database update is approved.'

/**
 * Can a Confirm or Reject be recorded right now?
 *
 * Only when the database runs the SAME validated wheel-matching rules as this client. The
 * database says which rules it runs through the read-only observation_erp_rules function:
 *   - function missing (the database is still on the earlier function)  -> not available
 *   - a different rules version (either side is ahead)                 -> not available
 *   - the call failed for any other reason                             -> not available (unknown)
 * Never assumed available. Evidence lookup does not depend on this.
 *
 * @returns {Promise<{available:boolean, reason:'ok'|'old_database'|'version_mismatch'|'unknown',
 *   canReview:boolean, canRequestException:boolean, canApproveException:boolean,
 *   databaseVersion:string|null, clientVersion:string}>}
 */
export async function getErpDecisionAvailability() {
  const none = (reason, databaseVersion = null) => ({
    available: false, reason, canReview: false, canRequestException: false, canApproveException: false, databaseVersion, clientVersion: ERP_RULES_VERSION,
  })
  let res
  try { res = await supabase.rpc('observation_erp_rules') } catch { return none('unknown') }
  if (res?.error) return none(isNotProvisioned(res.error) ? 'old_database' : 'unknown')
  const version = res?.data?.rules_version || null
  if (!version) return none('old_database')
  if (version !== ERP_RULES_VERSION) return none('version_mismatch', version)
  return {
    available: true, reason: 'ok', canReview: res.data.can_review === true,
    canRequestException: res.data.can_request_exception === true,
    canApproveException: res.data.can_approve_exception === true, databaseVersion: version, clientVersion: ERP_RULES_VERSION,
  }
}

/**
 * A documented serial exception (wheel unresolved, observed serial on the job card) always
 * takes TWO people. A reviewer asks; a different person who holds the separate permission
 * approves or refuses. The database enforces both the permission and "not the same person";
 * nothing is linked until the approval.
 */
export async function requestObservationErpSerialException({ actionId, workOrderId, note }) {
  if (!actionId || !workOrderId || String(note || '').trim().length < 20) {
    throw new ServiceError('A serial exception needs a written reason of at least 20 characters.')
  }
  return unwrap(await supabase.rpc('request_observation_erp_serial_exception', {
    p_action_id: actionId, p_work_order_id: workOrderId, p_reason: note.trim(),
  }))
}

/** Approve a pending exception request raised by somebody else. */
export async function approveObservationErpSerialException({ requestId, note }) {
  if (!requestId || String(note || '').trim().length < 5) {
    throw new ServiceError('Write an approval note of at least five characters.')
  }
  return unwrap(await supabase.rpc('approve_observation_erp_serial_exception', {
    p_request_id: requestId, p_note: note.trim(),
  }))
}

/** Refuse (an authorised person other than the requester) or withdraw (the requester). */
export async function closeObservationErpSerialException({ requestId, outcome, note }) {
  if (!requestId || !['refused', 'withdrawn'].includes(outcome) || String(note || '').trim().length < 5) {
    throw new ServiceError('Choose refuse or withdraw and write a note of at least five characters.')
  }
  return unwrap(await supabase.rpc('close_observation_erp_serial_exception', {
    p_request_id: requestId, p_outcome: outcome, p_note: note.trim(),
  }))
}

/** Exception requests recorded for one action, newest first. Read only. */
export async function listObservationErpExceptionRequests(actionId) {
  if (!actionId) return []
  const res = await supabase.from('observation_erp_exception_requests')
    .select('id, action_id, work_order_id, status, request_reason, requested_by, requested_at, decided_by, decided_at, decision_note')
    .eq('action_id', actionId).order('requested_at', { ascending: false }).limit(50)
  if (res.error) { if (isNotProvisioned(res.error)) return []; return unwrap(res) }
  return res.data || []
}

/** True when a Confirm or Reject failed only because the review functions do not exist yet. */
export const isErpReviewNotProvisioned = (err) => isNotProvisioned(err)

/**
 * Plain words for a Confirm or Reject the server refused.
 *
 * The server is the authority and can refuse a job card this screen offered: today the live
 * function finds the wheel with its own table, which differs from the position service in a
 * few cases (see POSITION_ROUND2.md). Those refusals arrive with code PT409, which the general
 * error text reads as "this record changed, refresh", which is wrong here. Only the server's
 * own known refusals are translated; anything else goes through toUserMessage unchanged, so
 * no database text reaches the screen.
 */
const REFUSALS = [
  [/predates the inspection/i, 'This job card was opened before the inspection, so it cannot be linked. It needs manual investigation.'],
  [/could not be matched on this vehicle|Unknown inspection tyre position/i, 'The server could not place the inspected wheel on this vehicle. The job card was not linked and stays pending manual review.'],
  [/No ERP tyre movement matches/i, 'The server found no tyre movement on this job card for the inspected wheel. The job card was not linked.'],
  [/already linked to (another|a different)/i, 'This action is already linked to a different job card.'],
  [/must match inspection tenant, country and asset/i, 'This job card does not belong to the same vehicle and country as the inspection.'],
  [/Only own inspection tyre actions/i, 'Only tyre damage actions raised from an inspection can be linked to a job card.'],
  [/Job card number missing/i, 'This job card has no number, so it cannot be linked.'],
  [/(Country|Site) is outside permitted scope/i, 'This job card is outside the countries or sites you can review.'],
  [/Decision and reason are required/i, 'Write a reason of at least five characters.'],
  [/approved by a different person/i, 'An exception must be approved by a different person than the one who asked for it.'],
  [/Not authorised to (confirm ERP evidence|approve a serial exception|refuse this exception request)/i, 'Your account is not allowed to record this decision.'],
  [/exception request (was already decided|for this job card is already waiting)/i, 'This exception request is already waiting for approval or was already decided.'],
  [/serial exception (does not apply|needs a written reason)/i, 'A serial exception cannot be recorded for this job card.'],
]
export function erpDecisionMessage(err) {
  const raw = String(err?.cause?.message || err?.message || '')
  // The database does not let this client record a decision (function not installed, or its
  // EXECUTE is withheld until the corrected rules are approved): say so, never a raw error.
  if (isNotProvisioned(err?.cause || err) || /permission denied for function/i.test(raw)) return ERP_DECISIONS_UNAVAILABLE_MESSAGE
  const hit = REFUSALS.find(([re]) => re.test(raw))
  return hit ? hit[1] : toUserMessage(err, 'The job card could not be linked. Please try again.')
}
