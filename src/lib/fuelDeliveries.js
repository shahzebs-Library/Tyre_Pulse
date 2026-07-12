/**
 * Pure, dependency-free fuel-delivery analytics. No Supabase, no React — kept
 * unit-testable and reusable across the page, exports and any future reporting.
 *
 * `summarizeDeliveries` reduces a set of delivery rows into the headline KPIs
 * shown on the /fuel-delivery page: total number of deliveries, total litres
 * delivered, total spend, and the blended average price per litre.
 */

/** Coerce a possibly-string/null numeric field to a finite number (else 0). */
function num(v) {
  if (v === '' || v == null) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Summarise delivery rows into headline KPIs.
 *
 * Cancelled deliveries are excluded from litres/cost totals (they never
 * physically happened) but are still counted toward the total record count so
 * the table and the KPI tile agree. Average price per litre is the blended
 * rate (total cost ÷ total litres), which is more accurate than averaging the
 * per-row unit prices.
 *
 * @param {Array<object>} rows
 * @returns {{ totalDeliveries:number, totalLitres:number, totalCost:number, avgPricePerLitre:number }}
 */
export function summarizeDeliveries(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let totalLitres = 0
  let totalCost = 0
  for (const r of list) {
    if (r?.status === 'cancelled') continue
    totalLitres += num(r?.litres)
    totalCost += num(r?.total_cost)
  }
  const avgPricePerLitre = totalLitres > 0 ? totalCost / totalLitres : 0
  return {
    totalDeliveries: list.length,
    totalLitres: Math.round(totalLitres * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    avgPricePerLitre: Math.round(avgPricePerLitre * 1000) / 1000,
  }
}
