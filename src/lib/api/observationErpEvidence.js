/**
 * Scoped, bounded, read-only job-card evidence lookup. A query failure is NOT
 * treated as an empty match. Existing ERP records are the only data source.
 */
import { supabase, unwrap, ServiceError } from './_client'
import { matchObservationToErp } from '../erpObservationMatch'

const WO_FIELDS = 'id,work_order_no,asset_no,country,site,description,notes,status,opened_at,completed_at'
const TYRE_FIELDS = 'id,asset_no,country,serial_no,position,tyre_position,job_card,issue_date,removal_date,status'
const EXPENSE_FIELDS = 'id,country,asset_code,work_order_no,txn_date,issue_number,item_code,item_description,qty,tyre_amount,spare_parts_amount,oil_amount,total_amount,value_amount,source_row'

export async function findObservationErpEvidence({ inspection, finding }) {
  if (!inspection?.id || !inspection?.asset_no || !inspection?.country || !finding?.rawPosition) {
    throw new ServiceError('Saved inspection, country, asset, and tyre position are required for ERP matching.')
  }
  const country = inspection.country, asset = inspection.asset_no
  const [wo, tyre] = await Promise.all([
    supabase.from('work_orders').select(WO_FIELDS).eq('country', country).eq('asset_no', asset)
      .order('opened_at', { ascending: false }).limit(100),
    supabase.from('tyre_records').select(TYRE_FIELDS).eq('country', country).eq('asset_no', asset)
      .order('issue_date', { ascending: false }).limit(400),
  ])
  const workOrders = unwrap(wo) || [], fitments = unwrap(tyre) || []
  const jobNumbers = [...new Set(workOrders.map(w => w.work_order_no).filter(Boolean))].slice(0, 100)
  const expenses = []
  for (let i = 0; i < jobNumbers.length; i += 30) {
    const chunk = jobNumbers.slice(i, i + 30)
    const rows = await supabase.from('parts_consumption').select(EXPENSE_FIELDS)
      .eq('country', country).eq('asset_code', asset).in('work_order_no', chunk).limit(500)
    expenses.push(...(unwrap(rows) || []))
  }
  const candidates = matchObservationToErp({ inspection, finding, workOrders, fitments, expenses })
  const evidenceLimited = workOrders.length === 100 || fitments.length === 400 || expenses.length >= 500
  return { candidates, evidenceLimited, totals: { workOrders: workOrders.length, fitments: fitments.length, expenses: expenses.length } }
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
  return unwrap(await supabase.from('observation_erp_links').select('id,action_id,work_order_id,reviewed_by,reviewed_at,decision_note,status,source_job_card').eq('action_id',actionId).maybeSingle())
}

/** Append-only human decisions, with reviewer/date and exact ERP job card. */
export async function listObservationErpDecisions(actionId) {
  if (!actionId) return []
  return unwrap(await supabase.from('observation_erp_link_events')
    .select('id,decision,reason,source_job_card,reviewer,created_at')
    .eq('action_id', actionId).order('created_at', { ascending: false }).limit(50)) || []
}
