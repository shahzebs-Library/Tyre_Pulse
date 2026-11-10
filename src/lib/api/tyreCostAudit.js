/**
 * tyreCostAudit service - reads for the tyre cost audit rules (src/lib/tyreCostAudit.js).
 *
 * This file is shared with the Tyre Cost Audit dashboard work. Each block below is
 * self-contained so the two can be merged without touching each other.
 */
import { supabase, fetchAllOrThrow } from './_client'
import { buildPriceIndex } from '../tyreCostAudit'

// ── BLOCK: import preview price index (loadPriceIndex) ──────────────────────────

/** Most months one preview will read; a file spanning more is unusual and bounded. */
export const PRICE_INDEX_MAX_MONTHS = 24
/** Hard stop on rows read per preview (tyre lines only, so far below the table size). */
export const PRICE_INDEX_MAX_ROWS = 20000

const PRICE_LINE_COLS = 'id, country, item_code, event_date, item_description, line_cost, qty_n'

/** 'YYYY-MM' -> [first day, first day of next month) as ISO dates; null when invalid. */
export function monthBounds(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''))
  if (!m) return null
  const y = Number(m[1]); const mo = Number(m[2])
  if (mo < 1 || mo > 12) return null
  const next = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`
  return { from: `${m[1]}-${m[2]}-01`, to: next }
}

/** Stored tyre lines -> the shape buildPriceIndex reads. */
export function toPriceLines(rows = []) {
  return rows.map((r) => ({
    id: r.id, country: r.country, itemCode: r.item_code, date: r.event_date,
    description: r.item_description, value: r.line_cost, qty: r.qty_n,
  }))
}

/**
 * Stored tyre expense lines for the given months of one country (the months present in
 * an uploaded file). Returns the raw lines and the same-month price index built from them.
 * Throws on a failed read so the caller can say the index is unavailable instead of
 * presenting "no price found".
 * @param {{ country:string, months:string[] }} args
 * @returns {Promise<{ lines:object[], index:Map, truncated:boolean, months:string[] }>}
 */
export async function loadPriceIndex({ country, months } = {}) {
  const valid = [...new Set((months || []).filter((m) => monthBounds(m)))].sort().slice(0, PRICE_INDEX_MAX_MONTHS)
  if (!country || !valid.length) return { lines: [], index: buildPriceIndex([]), truncated: false, months: valid }
  const lines = []
  let truncated = false
  for (const m of valid) {
    const b = monthBounds(m)
    const rows = await fetchAllOrThrow((from, to) => supabase
      .from('parts_consumption')
      .select(PRICE_LINE_COLS)
      .eq('country', country)
      .eq('cost_category', 'tyre')
      .gt('line_cost', 0)
      .gt('qty_n', 0)
      .gte('event_date', b.from)
      .lt('event_date', b.to)
      .order('event_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to), { max: PRICE_INDEX_MAX_ROWS })
    if (rows.truncated) truncated = true
    lines.push(...toPriceLines(rows))
    if (lines.length >= PRICE_INDEX_MAX_ROWS) { truncated = true; break }
  }
  return { lines, index: buildPriceIndex(lines), truncated, months: valid }
}

// ── END BLOCK: loadPriceIndex ───────────────────────────────────────────────────
