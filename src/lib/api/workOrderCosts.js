/**
 * Work order cost ledger service. Every write is a database function
 * (work_order_cost_*); the table itself is read-only to the client.
 *
 * Before the ledger draft is applied the table and functions do not exist. Every
 * function here then answers "not available" instead of failing: reads return
 * { available:false, entries:null } and writes throw CostLedgerUnavailable with a
 * plain sentence. Nothing here ever writes work_orders.
 */
import { supabase, ServiceError, isMissingRelation } from './_client'
import { COST_LEDGER_UNAVAILABLE } from '../workOrderCosts'

const COLS = 'id,work_order_id,entry_kind,category,item_code,description,quantity,unit_cost,amount,currency,' +
  'source,source_ref,reason,status,reconciliation,reconciliation_note,reverses_entry_id,created_by,created_at,' +
  'submitted_at,decided_by,decided_at,decision_note,reversed_by,reversed_at,reversal_reason'
const MISSING = new Set(['PGRST202', 'PGRST205', '42883', '42P01'])
const missing = (error) => !!error && (MISSING.has(error.code) || isMissingRelation(error))

export class CostLedgerUnavailable extends ServiceError {
  constructor() { super(COST_LEDGER_UNAVAILABLE); this.name = 'CostLedgerUnavailable'; this.unavailable = true }
}

/**
 * Entries of one work order, oldest first.
 * @returns {Promise<{available:boolean, entries:object[]|null}>} entries is null when
 *   the ledger is not installed or could not be read (never an empty list by guess).
 */
export async function listCostEntries(workOrderId) {
  if (!workOrderId) return { available: false, entries: null }
  try {
    const { data, error } = await supabase.from('work_order_cost_entries').select(COLS)
      .eq('work_order_id', workOrderId).order('created_at', { ascending: true }).order('id').limit(500)
    if (missing(error)) return { available: false, entries: null }
    if (error) return { available: true, entries: null }
    return { available: true, entries: data || [] }
  } catch {
    return { available: false, entries: null }
  }
}

async function call(fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (missing(error)) throw new CostLedgerUnavailable()
  if (error) throw new ServiceError(error.message, error.code, error)
  return data
}

/** Enter a DRAFT cost. Never an approved cost. */
export function addCostEntry(workOrderId, e = {}) {
  return call('work_order_cost_add', {
    p_job_id: workOrderId, p_kind: e.kind || 'additional', p_category: e.category || 'parts',
    p_item_code: e.itemCode || null, p_description: e.description, p_quantity: e.quantity ?? null,
    p_unit_cost: e.unitCost ?? null, p_amount: e.amount ?? null, p_source: e.source || 'manual',
    p_source_ref: e.sourceRef || null, p_reason: e.reason, p_reverses: e.reverses || null,
    p_client_uuid: e.clientUuid || null,
  })
}
export const submitCostEntry = (id) => call('work_order_cost_submit', { p_entry_id: id })
export const decideCostEntry = (id, decision, note) => call('work_order_cost_decide', { p_entry_id: id, p_decision: decision, p_note: note || null })
export const withdrawCostEntry = (id, note) => call('work_order_cost_withdraw', { p_entry_id: id, p_note: note || null })
export const reverseCostEntry = (id, reason) => call('work_order_cost_reverse', { p_entry_id: id, p_reason: reason })
