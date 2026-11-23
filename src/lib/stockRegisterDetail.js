/**
 * Stock register detail: joins each stock row to its Material Master item and to
 * real consumption.
 *
 * - The catalogue item is matched on the ERP item code (`material_master.item_code`,
 *   reached through `stock_records.item_id`) = `material_canonical.company_sku`.
 *   That text match holds for 3,507 of 3,508 catalogue items today. The proper link
 *   table (`material_canonical_items`) is still empty; when it is filled this match
 *   becomes the fallback, not the rule.
 * - Usage comes from the ERP issue lines (`parts_consumption`), because almost no
 *   consumption is posted through stock movements. A rate is per site when the
 *   site issued the item, else per country. Days of cover are only stated for a
 *   site rate: a country rate cannot say how long one site's stock lasts.
 *
 * Pure functions: no I/O. Unknown values stay null (shown as N/A), never 0.
 */
import { brandLine, partTypeOf, oemNumbers, skuKey } from './inventory/materialCatalogView'

export const USAGE_MONTHS = 12

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const siteKey = (v) => String(v ?? '').trim().toUpperCase()

/** Item code of a register row: the linked ERP item, then the quick-entry code. */
export function registerItemCode(r) {
  return skuKey(r?.item?.item_code) || skuKey(r?.custom_data?.stock_item?.code) || null
}

/** Map of company SKU -> catalogue facts for the register. */
export function buildCatalogIndex(canonical = [], variants = [], aliases = []) {
  const vBy = new Map()
  for (const v of variants || []) {
    if (!v?.canonical_id) continue
    if (!vBy.has(v.canonical_id)) vBy.set(v.canonical_id, [])
    vBy.get(v.canonical_id).push(v)
  }
  const aBy = new Map()
  for (const a of aliases || []) {
    if (!a?.canonical_id) continue
    if (!aBy.has(a.canonical_id)) aBy.set(a.canonical_id, [])
    aBy.get(a.canonical_id).push(a)
  }
  const out = new Map()
  for (const m of canonical || []) {
    const sku = skuKey(m?.company_sku)
    if (!sku) continue
    const vs = vBy.get(m.id) || []
    out.set(sku, {
      canonicalId: m.id,
      name: m.description || null,
      category: m.category || null,
      brand: brandLine(m) || brandFromVariants(vs),
      partType: partTypeOf(vs),
      oem: oemNumbers(aBy.get(m.id) || [], vs),
      status: m.status || null,
    })
  }
  return out
}

function brandFromVariants(vs) {
  for (const v of vs || []) {
    const b = String(v?.brand || v?.manufacturer || '').trim()
    if (b) return b
  }
  return null
}

/** Usage totals over the window: by code+site and by code (whole country). */
export function buildUsageIndex(lines = []) {
  const bySite = new Map()
  const byCode = new Map()
  for (const l of lines || []) {
    const code = skuKey(l?.item_code)
    if (!code) continue
    const q = num(l.qty_n ?? l.qty)
    if (q === null || q <= 0) continue
    const k = `${code}|${siteKey(l.site)}`
    bySite.set(k, (bySite.get(k) || 0) + q)
    byCode.set(code, (byCode.get(code) || 0) + q)
  }
  return { bySite, byCode }
}

/** Usage for one register row, or null when the row has no item code. */
export function usageFor(r, usage, months = USAGE_MONTHS) {
  const code = registerItemCode(r)
  if (!code || !usage) return null
  const site = usage.bySite.get(`${code}|${siteKey(r.site)}`)
  const country = usage.byCode.get(code)
  const qty = num(r.stock_qty ?? r.qty_on_hand)
  if (site) {
    const avgPerMonth = +(site / months).toFixed(2)
    const daysRemaining = avgPerMonth > 0 && qty !== null ? Math.round((qty / avgPerMonth) * 30) : null
    return { scope: 'site', avgPerMonth, daysRemaining }
  }
  if (country) return { scope: 'country', avgPerMonth: +(country / months).toFixed(2), daysRemaining: null }
  return { scope: 'none', avgPerMonth: 0, daysRemaining: null }
}

/**
 * Velocity map in the shape the register already uses ({ [id]: { avgPerMonth,
 * daysRemaining, scope } }), built from ERP usage. Rows without an item code are
 * left out so the legacy tyre-issue velocity can still apply to them.
 */
export function buildErpVelocityMap(records = [], usage, months = USAGE_MONTHS) {
  const out = {}
  for (const r of records || []) {
    const u = usageFor(r, usage, months)
    if (u) out[r.id] = u
  }
  return out
}

/** Catalogue facts for one register row (null when the code is not catalogued). */
export function catalogFor(r, index) {
  const code = registerItemCode(r)
  if (!code || !index) return null
  return index.get(code) || null
}

/** Counts for the honesty line above the register. */
export function registerCoverage(records = [], index, usage) {
  let noCode = 0; let catalogued = 0; let withUsage = 0
  for (const r of records || []) {
    const code = registerItemCode(r)
    if (!code) { noCode += 1; continue }
    if (index?.has(code)) catalogued += 1
    if (usage?.byCode.has(code)) withUsage += 1
  }
  return { total: (records || []).length, noCode, catalogued, withUsage }
}
