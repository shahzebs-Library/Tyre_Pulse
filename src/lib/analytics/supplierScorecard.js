// ─────────────────────────────────────────────────────────────────────────────
// supplierScorecard.js - Pure supplier scorecard (no AI tokens, no network).
// Joins tyre_records + warranty_claims + purchase_orders by supplier.
// Cost is ACTUAL only (cost_per_tyre); missing → 0, never a settings default.
// ─────────────────────────────────────────────────────────────────────────────

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Actual cost of one tyre_records row: cost_per_tyre × qty (qty defaults to 1). */
function tyreSpend(r) {
  return num(r?.cost_per_tyre) * (r?.qty == null ? 1 : num(r.qty))
}

/** CPK for one tyre_records row, or null when km data is missing/invalid. */
function recordCpk(r) {
  if (!r) return null
  const fit = r.km_at_fitment
  const rem = r.km_at_removal
  if (fit == null || rem == null) return null
  const kmRun = num(rem) - num(fit)
  if (kmRun <= 0) return null
  return num(r.cost_per_tyre) / kmRun
}

/** Normalise a raw supplier label; empty/nullish → 'Unknown'. */
function supKey(v) {
  const s = (v == null ? '' : String(v)).trim()
  return s || 'Unknown'
}

/** PO supplier label: supplier_name first, then vendor_name. */
function poKey(po) {
  return supKey(po?.supplier_name ?? po?.vendor_name)
}

/** On-time = actual_delivery present AND actual_delivery <= expected_delivery. */
function isOnTime(po) {
  if (!po?.actual_delivery || !po?.expected_delivery) return null
  const a = new Date(po.actual_delivery)
  const e = new Date(po.expected_delivery)
  if (isNaN(a.getTime()) || isNaN(e.getTime())) return null
  return a.getTime() <= e.getTime()
}

const APPROVED = new Set(['approved'])

/**
 * Compute a per-supplier scorecard from actual operational data.
 * @param {{tyres?:Array, warranty?:Array, purchaseOrders?:Array}} input
 * @returns {{ suppliers: Array, totals: object }}
 */
export function computeSupplierScorecard({ tyres = [], warranty = [], purchaseOrders = [] } = {}) {
  const tyreRows = Array.isArray(tyres) ? tyres : []
  const warrantyRows = Array.isArray(warranty) ? warranty : []
  const poRows = Array.isArray(purchaseOrders) ? purchaseOrders : []

  const map = new Map()
  const acc = (name) => {
    const key = supKey(name)
    if (!map.has(key)) {
      map.set(key, {
        supplier: key, tyreCount: 0, totalSpend: 0, cpkSum: 0, cpkN: 0,
        warrantyClaims: 0, warrantyCredit: 0, poTotal: 0, poOnTime: 0,
      })
    }
    return map.get(key)
  }

  for (const r of tyreRows) {
    const a = acc(r?.supplier)
    a.tyreCount += 1
    a.totalSpend += tyreSpend(r)
    const cpk = recordCpk(r)
    if (cpk != null) { a.cpkSum += cpk; a.cpkN += 1 }
  }

  for (const w of warrantyRows) {
    const a = acc(w?.supplier)
    a.warrantyClaims += 1
    if (APPROVED.has(String(w?.claim_status ?? '').trim().toLowerCase())) {
      a.warrantyCredit += num(w?.credit_amount)
    }
  }

  for (const po of poRows) {
    const a = acc(poKey(po))
    const ot = isOnTime(po)
    if (ot != null) { a.poTotal += 1; if (ot) a.poOnTime += 1 }
  }

  const rows = Array.from(map.values()).map((a) => {
    const avgCpk = a.cpkN ? a.cpkSum / a.cpkN : null
    const failureRate = a.tyreCount ? a.warrantyClaims / a.tyreCount : null
    const warrantyRecoveryRate = a.warrantyClaims ? a.warrantyCredit / a.warrantyClaims : null
    const onTimeRate = a.poTotal ? a.poOnTime / a.poTotal : null
    return {
      supplier: a.supplier, tyreCount: a.tyreCount, totalSpend: a.totalSpend, avgCpk,
      failureRate, warrantyClaims: a.warrantyClaims, warrantyCredit: a.warrantyCredit,
      warrantyRecoveryRate, poTotal: a.poTotal, onTimeRate,
    }
  })

  // Composite score (0-100, higher = better); missing sub-metrics excluded from
  // that supplier's weighted mean so absent data doesn't penalise.
  const cpks = rows.map((r) => r.avgCpk).filter((v) => v != null && v > 0)
  const bestCpk = cpks.length ? Math.min(...cpks) : null
  const recos = rows.map((r) => r.warrantyRecoveryRate).filter((v) => v != null)
  const maxReco = recos.length ? Math.max(...recos) : null
  const WEIGHTS = { cpk: 0.30, fail: 0.30, recov: 0.15, ot: 0.25 }
  const clamp = (v) => Math.max(0, Math.min(100, v))

  rows.forEach((r) => {
    const parts = []
    if (r.avgCpk != null && r.avgCpk > 0 && bestCpk != null) parts.push([clamp((bestCpk / r.avgCpk) * 100), WEIGHTS.cpk])
    if (r.failureRate != null) parts.push([clamp(100 - r.failureRate * 100), WEIGHTS.fail])
    if (r.warrantyRecoveryRate != null && maxReco && maxReco > 0) parts.push([clamp((r.warrantyRecoveryRate / maxReco) * 100), WEIGHTS.recov])
    if (r.onTimeRate != null) parts.push([clamp(r.onTimeRate * 100), WEIGHTS.ot])
    const wSum = parts.reduce((s, [, w]) => s + w, 0)
    r.score = wSum ? Math.round(parts.reduce((s, [v, w]) => s + v * w, 0) / wSum) : 0
  })

  rows.sort((a, b) => b.score - a.score || b.tyreCount - a.tyreCount)
  rows.forEach((r, i) => { r.rank = i + 1 })

  const totals = {
    supplierCount: rows.length,
    totalSpend: rows.reduce((s, r) => s + r.totalSpend, 0),
    totalTyres: rows.reduce((s, r) => s + r.tyreCount, 0),
    totalWarrantyClaims: rows.reduce((s, r) => s + r.warrantyClaims, 0),
    totalWarrantyCredit: rows.reduce((s, r) => s + r.warrantyCredit, 0),
  }
  return { suppliers: rows, totals }
}

export default computeSupplierScorecard
