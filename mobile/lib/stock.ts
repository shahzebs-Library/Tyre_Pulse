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

export interface NewStockInput {
  /** Tyre size token, e.g. "315/80R22.5". Prefixed into the description so the
   *  existing size-parse filter (extractTyreSize) buckets the new row. */
  size: string
  /** Optional extra description (brand / notes) appended after the size. */
  description?: string | null
  site: string
  qty: number
  /** Reorder thresholds are ADMIN-ONLY. Omit (leave undefined) to keep the
   *  columns out of the insert entirely so the server-side defaults govern;
   *  pass a number (or null) only for admin callers. */
  minLevel?: number | null
  criticalLevel?: number | null
  country?: string | null
  userId?: string | null
}

export interface NewStockResult {
  id: string | null
}

/**
 * Compose the stored `description` from a tyre size + optional free text.
 * stock_records has NO dedicated `size` column - size lives inside the
 * free-text description (e.g. "315/80R22.5 Double Coin"), and the Stock screen
 * derives the size filter by parsing it back out. Prefixing the size keeps that
 * parse working for rows created here.
 */
export function composeStockDescription(size: string, description?: string | null): string {
  const sz = (size || '').trim()
  const rest = (description || '').trim()
  if (!sz) return rest
  // Avoid doubling the size if the user already typed it into the description.
  if (rest.toUpperCase().startsWith(sz.toUpperCase())) return rest
  return rest ? `${sz} ${rest}` : sz
}

/**
 * Create a new stock record for a given tyre size + site. The size is embedded
 * into `description` (no size column exists) so it is immediately usable in the
 * size filter. organisation_id/country are governed by DB defaults + RLS; we
 * still stamp the caller's country (matching other mobile-created rows) and the
 * derived stock_status. A best-effort Initial movement ledger row is posted.
 *
 * Creating a NEW record needs connectivity (unlike count/adjust there is no
 * existing row to reconcile against and no create RPC), so a failure is thrown
 * for the caller to surface rather than silently queued.
 */
export async function createStockRecord(input: NewStockInput): Promise<NewStockResult> {
  const qty = Math.max(0, Math.floor(Number(input.qty) || 0))
  // Thresholds are admin-only: an undefined level is OMITTED from the insert so
  // the server-side column defaults apply; only explicit values are written.
  const hasMin = input.minLevel !== undefined
  const hasCrit = input.criticalLevel !== undefined
  const min = hasMin && input.minLevel != null ? Math.max(0, Math.floor(Number(input.minLevel))) : null
  const crit = hasCrit && input.criticalLevel != null ? Math.max(0, Math.floor(Number(input.criticalLevel))) : null
  const description = composeStockDescription(input.size, input.description)
  const nowIso = new Date().toISOString()
  const siteName = input.site.trim()
  const row: Record<string, unknown> = {
    site: siteName,
    description,
    stock_qty: qty,
    stock_status: statusFor(qty, min, crit),
    country: input.country ?? null,
    updated_by: input.userId ?? null,
    updated_at: nowIso,
  }
  if (hasMin) row.min_level = min
  if (hasCrit) row.critical_level = crit
  const { data, error } = await supabase
    .from('stock_records')
    .insert(row)
    .select('id')
    .single()
  if (error) throw error
  const id: string | null = (data as any)?.id ?? null
  // Best-effort audit movement (Initial). Never blocks the create.
  if (id) {
    try {
      await supabase.from('stock_movements').insert({
        stock_id: id,
        site: siteName,
        description,
        movement_type: 'Initial',
        qty_before: 0,
        qty_change: qty,
        qty_after: qty,
        reason: 'Initial stock entry (mobile)',
        created_by: input.userId ?? null,
      })
    } catch { /* audit is best-effort */ }
  }
  return { id }
}

/**
 * Distinct site (location) names from the fleet master (`vehicle_fleet.site`),
 * for the add-stock location picker. RLS scopes rows to the caller's org and
 * country. Deduped + sorted, capped at 100 options. Returns [] on any failure
 * so the picker degrades honestly to free-text entry.
 */
export async function listStockSites(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('vehicle_fleet')
      .select('site')
      .not('site', 'is', null)
      .order('site')
      .limit(2000)
    if (error) throw error
    const seen = new Set<string>()
    for (const r of (data ?? []) as { site: string | null }[]) {
      const v = r.site?.trim()
      if (v) seen.add(v)
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b)).slice(0, 100)
  } catch {
    return []
  }
}

export { statusFor }
