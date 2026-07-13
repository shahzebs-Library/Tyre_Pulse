/**
 * Stock service — daily tyre-stock counts and quick adjustments.
 *
 * Every change goes through the SAME guarded, audited DB RPCs the web uses, so
 * the stock_movements ledger and audit trail stay complete no matter where the
 * change originates:
 *   • set_stock_count()     — absolute daily stock-take (V214)
 *   • post_stock_movement() — delta adjust up/down (existing)
 * Both compute the balance server-side (race-safe) and block cross-org writes.
 *
 * Offline fallback: if the RPC can't reach the server, the change is queued as
 * an absolute STOCK_ADJUST (record queue) so a field count is never lost; it
 * syncs to stock_records when back online (ledger row is added by the online
 * path only).
 */
import { supabase } from './supabase'
import { saveCommand } from './recordQueue'

function statusFor(qty: number, min: number | null, crit: number | null): string {
  if (crit != null && qty <= crit) return 'Critical'
  if (min != null && qty <= min) return 'Low'
  return 'OK'
}

// A network/transport failure (vs a server rejection we must surface). Postgres
// errors carry a `code`; fetch/transport failures do not.
function isOffline(err: any): boolean {
  const msg = (err?.message || '').toLowerCase()
  return !err?.code && (
    msg.includes('network') || msg.includes('fetch') || msg.includes('timeout') ||
    msg.includes('failed to') || msg.includes('offline')
  )
}

export interface StockChangeResult {
  qtyAfter: number | null
  status: string | null
  offline: boolean
}

export interface StockContext {
  minLevel: number | null
  criticalLevel: number | null
  userId?: string | null
}

/**
 * Daily stock-take: set the exact counted quantity. Prefers the audited
 * set_stock_count RPC; falls back to an offline absolute STOCK_ADJUST.
 */
export async function setStockCount(
  stockId: string,
  count: number,
  reason: string | null,
  ctx: StockContext,
): Promise<StockChangeResult> {
  try {
    const { data, error } = await supabase.rpc('set_stock_count', {
      p_stock_id: stockId,
      p_count: Math.max(0, Math.floor(count)),
      p_reason: reason || null,
    })
    if (error) throw error
    const payload: any = data ?? {}
    return { qtyAfter: payload.qty_after ?? count, status: payload.stock_status ?? null, offline: false }
  } catch (e: any) {
    if (!isOffline(e)) throw e
    const next = Math.max(0, Math.floor(count))
    await saveCommand('STOCK_ADJUST', {
      id: stockId,
      stock_qty: next,
      stock_status: statusFor(next, ctx.minLevel, ctx.criticalLevel),
      updated_by: ctx.userId ?? null,
      updated_at: new Date().toISOString(),
    })
    return { qtyAfter: next, status: statusFor(next, ctx.minLevel, ctx.criticalLevel), offline: true }
  }
}

/**
 * Quick +/- adjustment by a signed delta. Prefers the audited
 * post_stock_movement RPC (adjustment_up / adjustment_down); falls back to an
 * offline absolute STOCK_ADJUST computed from the last-known qty.
 */
export async function adjustStock(
  stockId: string,
  delta: number,
  currentQty: number,
  ctx: StockContext,
  reason: string | null = null,
): Promise<StockChangeResult> {
  const magnitude = Math.abs(delta)
  if (magnitude === 0) return { qtyAfter: currentQty, status: null, offline: false }
  try {
    const { data, error } = await supabase.rpc('post_stock_movement', {
      p_stock_id: stockId,
      p_type: delta > 0 ? 'adjustment_up' : 'adjustment_down',
      p_qty: magnitude,
      p_reason: reason || null,
      p_reference: null,
    })
    if (error) throw error
    const payload: any = data ?? {}
    return { qtyAfter: payload.qty_after ?? currentQty + delta, status: payload.stock_status ?? null, offline: false }
  } catch (e: any) {
    if (!isOffline(e)) throw e
    const next = Math.max(0, currentQty + delta)
    await saveCommand('STOCK_ADJUST', {
      id: stockId,
      stock_qty: next,
      stock_status: statusFor(next, ctx.minLevel, ctx.criticalLevel),
      updated_by: ctx.userId ?? null,
      updated_at: new Date().toISOString(),
    })
    return { qtyAfter: next, status: statusFor(next, ctx.minLevel, ctx.criticalLevel), offline: true }
  }
}

export { statusFor }
