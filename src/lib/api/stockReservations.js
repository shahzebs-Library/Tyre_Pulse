import { supabase, unwrap, isMissingRelation } from './_client'

const text = (v, max = 200) => String(v ?? '').trim().slice(0, max)

export function normalizeReservationLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('At least one stock item is required.')
  const merged = new Map()
  for (const row of lines) {
    const stockId = text(row?.stock_id, 100)
    const qty = Number(row?.qty)
    if (!stockId) throw new Error('Every reservation line requires a stock item.')
    if (!Number.isFinite(qty) || qty <= 0 || qty > 100000) throw new Error('Reservation quantity must be greater than zero.')
    merged.set(stockId, (merged.get(stockId) || 0) + qty)
  }
  return [...merged].map(([stock_id, qty]) => ({ stock_id, qty }))
}

/**
 * Reserve stock atomically on the server. There is intentionally no read-then-
 * update fallback: it would oversubscribe inventory when two technicians save
 * together. Older tenants get an honest not-provisioned result.
 */
export async function reserveWorkOrderStock({ workOrderId, lines, idempotencyKey } = {}) {
  const id = text(workOrderId, 100)
  if (!id) throw new Error('A work order is required.')
  const normalized = normalizeReservationLines(lines)
  const key = text(idempotencyKey, 160) || `work-order:${id}:stock`
  try {
    const data = unwrap(await supabase.rpc('reserve_work_order_stock', {
      p_work_order_id: id,
      p_lines: normalized,
      p_idempotency_key: key,
    }))
    return { ok: true, data }
  } catch (error) {
    if (isMissingRelation(error)) return { ok: false, reason: 'not_provisioned' }
    throw error
  }
}

export async function releaseWorkOrderStock({ workOrderId, reason } = {}) {
  const id = text(workOrderId, 100)
  if (!id) throw new Error('A work order is required.')
  try {
    const data = unwrap(await supabase.rpc('release_work_order_stock', {
      p_work_order_id: id,
      p_reason: text(reason, 500) || null,
    }))
    return { ok: true, data }
  } catch (error) {
    if (isMissingRelation(error)) return { ok: false, reason: 'not_provisioned' }
    throw error
  }
}
