/**
 * vehicleHistoryAnalytics.js - pure engine behind the Vehicle History page.
 *
 * Everything the page used to compute inline (red flags, misuse score, the
 * per-vehicle roll-up rows, the scoped summary strip and the timeline rows)
 * lives here so it can be tested without a browser or a database.
 *
 * Rules:
 *  - No I/O. The caller passes records, anomalies, the fleet map and the
 *    expense-grid map in; `now` is injectable where time matters.
 *  - Honest nulls. A figure that cannot be measured is null (the page renders
 *    N/A), never a fabricated zero.
 *  - Anomalies and red flags always evaluate FULL history; only the roll-up
 *    numbers are windowed by the date range.
 */
import { ANOMALY_TYPES } from './anomalyEngine'

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ── Red flags ────────────────────────────────────────────────────────────────

/** Local red flags: suspiciously low km on removal, non-sequential odometer. */
export function computeLocalRedFlags(assetRecords = []) {
  const flags = []
  const sorted = [...assetRecords]
    .filter(r => r.issue_date)
    .sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date)))

  sorted.forEach(r => {
    const kmFit = num(r.km_at_fitment)
    const kmRem = num(r.km_at_removal)
    if (kmFit !== null && kmRem !== null && kmRem > 0 && kmFit > 0) {
      const km = kmRem - kmFit
      if (km >= 0 && km < 500) {
        flags.push({
          type: 'LOW_KM_USAGE',
          severity: 'high',
          record_ids: [r.id],
          records: [r],
          message: `Suspiciously low mileage: tyre removed after only ${km} km, possible theft or misuse`,
          detail: `Asset ${r.asset_no}, fitment: ${kmFit} km, removal: ${kmRem} km on ${r.issue_date}`,
        })
      }
    }
  })

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    const prevRem = num(prev.km_at_removal)
    const currFit = num(curr.km_at_fitment)
    if (prevRem !== null && currFit !== null && prevRem > 0 && currFit > 0 && currFit < prevRem) {
      flags.push({
        type: 'INCONSISTENT_KM',
        severity: 'high',
        record_ids: [prev.id, curr.id],
        records: [prev, curr],
        message: 'Odometer inconsistency detected: km readings are not sequential, possible tampering',
        detail: `Previous removal: ${prevRem} km (${prev.issue_date}), next fitment: ${currFit} km (${curr.issue_date})`,
      })
    }
  }
  return flags
}

/** 0..100 misuse risk score. */
export function computeMisuseScore(anomalies = [], highRiskCount = 0, totalCount = 0, spanMonths = 0) {
  let score = 0
  score += Math.min(40, anomalies.length * 20)
  if (totalCount > 0 && highRiskCount / totalCount > 0.5) score += 20
  const avgDays = totalCount > 1 ? (spanMonths * 30) / totalCount : Infinity
  if (avgDays < 30) score += 20
  if (anomalies.some(a => a.type === ANOMALY_TYPES.SERIAL_REUSE)) score += 20
  if (anomalies.some(a => a.type === ANOMALY_TYPES.DUPLICATE_ENTRY)) score += 10
  return Math.min(100, score)
}

/** Policy flags that need the fleet master row (monthly budget, expected km). */
export function computeFleetPolicyFlags(assetRecords = [], fleetRecord = null) {
  const flags = []
  if (!fleetRecord) return flags

  const budget = num(fleetRecord.monthly_tyre_budget)
  if (budget) {
    const byMonth = {}
    assetRecords.forEach(r => {
      if (!r.issue_date) return
      const month = String(r.issue_date).slice(0, 7)
      ;(byMonth[month] ||= []).push(r)
    })
    Object.entries(byMonth).forEach(([month, recs]) => {
      const spend = recs.reduce((s, r) => s + (num(r.cost_per_tyre) || 0) * (num(r.qty) || 1), 0)
      if (spend > budget) {
        flags.push({
          type: 'BUDGET_BREACH',
          severity: 'high',
          record_ids: recs.map(r => r.id),
          records: recs,
          message: `Monthly budget exceeded in ${month}: spent ${spend.toLocaleString()} vs budget ${budget.toLocaleString()}`,
          detail: `${recs.length} tyre record(s) in ${month}, total cost: ${spend.toLocaleString()}`,
        })
      }
    })
  }

  const expected = num(fleetRecord.expected_km_per_tyre)
  if (expected) {
    const threshold = expected * 0.4
    assetRecords.forEach(r => {
      const kmFit = num(r.km_at_fitment)
      const kmRem = num(r.km_at_removal)
      if (kmFit !== null && kmRem !== null && kmRem > kmFit) {
        const km = kmRem - kmFit
        if (km < threshold) {
          flags.push({
            type: 'LOW_KM_VS_POLICY',
            severity: 'high',
            record_ids: [r.id],
            records: [r],
            message: `Tyre removed after only ${km.toLocaleString()} km, below 40% of policy threshold (${Math.round(threshold).toLocaleString()} km)`,
            detail: `Expected: ${expected.toLocaleString()} km, actual: ${km.toLocaleString()} km on ${r.issue_date}`,
          })
        }
      }
    })
  }
  return flags
}

// ── Windowing / grouping ─────────────────────────────────────────────────────

/** Records whose issue_date falls inside [from, to] (YYYY-MM-DD, inclusive). */
export function windowRecords(records = [], from = '', to = '') {
  if (!from && !to) return records
  return records.filter(r => {
    const d = r.issue_date ? String(r.issue_date).slice(0, 10) : ''
    if (!d) return false
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })
}

export function groupByAsset(records = []) {
  const m = {}
  records.forEach(r => { (m[r.asset_no] ||= []).push(r) })
  return m
}

export function sitesOf(records = []) {
  return [...new Set(records.map(r => r.site).filter(Boolean))].sort()
}

/** Anomalies that belong to one asset (serial reuse spans several assets). */
export function anomaliesForAsset(anomalies = [], assetNo) {
  return anomalies.filter(a => (a.type === ANOMALY_TYPES.SERIAL_REUSE
    ? Array.isArray(a.assets) && a.assets.includes(assetNo)
    : a.asset_no === assetNo))
}

/**
 * Enrich computeAssetMetrics() output with flags, misuse score and the
 * authoritative per-asset cost. `gridByAsset.map` is the expense-grid Map;
 * it is ignored while a date range is active (the grid covers full history).
 */
export function buildVehicleRows({
  assetMetrics = [], anomalies = [], fleetMap = {}, gridByAsset = null,
  fullRecordsByAsset = {}, rangeActive = false,
} = {}) {
  return assetMetrics.map(asset => {
    const assetAnomalies = anomaliesForAsset(anomalies, asset.assetNo)
    const fleetRecord = fleetMap[asset.assetNo] || null
    const flagRecords = fullRecordsByAsset[asset.assetNo] || asset.records || []
    const localFlags = computeLocalRedFlags(flagRecords)
    const policyFlags = computeFleetPolicyFlags(flagRecords, fleetRecord)
    const allFlags = [...assetAnomalies, ...localFlags, ...policyFlags]
    const misuseScore = computeMisuseScore(assetAnomalies, asset.highRiskCount, asset.count, asset.spanMonths)
    const avgDays = asset.count > 1 ? Math.round((asset.spanMonths * 30) / asset.count) : null
    const gridCost = rangeActive ? null : gridByAsset?.map?.get?.(String(asset.assetNo ?? '').trim().toUpperCase())
    const totalCost = gridCost != null ? gridCost : asset.totalCost
    return {
      ...asset, totalCost, anomalies: assetAnomalies, localFlags, policyFlags,
      allFlags, misuseScore, avgDays, fleetRecord,
    }
  })
}

/** Population filters (search + site). The summary strip computes over this. */
export function scopeVehicleRows(rows = [], { search = '', site = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return rows.filter(r =>
    (!q || String(r.assetNo || '').toLowerCase().includes(q)) &&
    (!site || (r.sites || []).includes(site)))
}

/** Anomaly filter + default ordering for the table. */
export function filterVehicleRows(rows = [], { anomaly = 'all', sortBy = 'misuse' } = {}) {
  let out = rows
  if (anomaly === 'has') out = out.filter(r => r.allFlags.length > 0)
  else if (anomaly === 'clean') out = out.filter(r => r.allFlags.length === 0)
  const copy = [...out]
  if (sortBy === 'misuse') copy.sort((a, b) => b.misuseScore - a.misuseScore)
  if (sortBy === 'cost') copy.sort((a, b) => (b.totalCost || 0) - (a.totalCost || 0))
  if (sortBy === 'count') copy.sort((a, b) => b.count - a.count)
  if (sortBy === 'date') copy.sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')))
  return copy
}

export const MISUSE_BANDS = [
  { max: 25, key: 'low', label: 'Low' },
  { max: 50, key: 'moderate', label: 'Moderate' },
  { max: 75, key: 'elevated', label: 'Elevated' },
  { max: 100, key: 'high', label: 'High' },
]

/** Named band so the score never relies on colour alone. */
export function misuseBand(score) {
  const s = num(score)
  if (s === null) return null
  return MISUSE_BANDS.find(b => s <= b.max) || MISUSE_BANDS[MISUSE_BANDS.length - 1]
}

/**
 * Summary strip. `costTotal` is the authoritative fleet tyre spend from the
 * expense grid; it only applies when the view is the whole unwindowed fleet.
 */
export function summarizeVehicles(scopedRows = [], { costTotal = null, rangeActive = false, scopeActive = false } = {}) {
  const useGrid = !rangeActive && !scopeActive && costTotal != null
  const rowCosts = scopedRows.map(r => r.totalCost).filter(v => v != null && Number.isFinite(Number(v)))
  return {
    vehicles: scopedRows.length,
    withAnomalies: scopedRows.filter(r => r.allFlags.length > 0).length,
    highMisuse: scopedRows.filter(r => r.misuseScore >= 51).length,
    totalCost: useGrid ? Number(costTotal) : (rowCosts.length ? rowCosts.reduce((s, v) => s + Number(v), 0) : null),
    costBasis: useGrid ? 'grid' : 'records',
  }
}

// ── Timeline (per-vehicle detail) ────────────────────────────────────────────

/** Oldest-first timeline rows with measured km and cost (null when unknown). */
export function timelineRows(records = [], flaggedIds = new Set()) {
  return [...records]
    .sort((a, b) => String(a.issue_date || '').localeCompare(String(b.issue_date || '')))
    .map(r => {
      const fit = num(r.km_at_fitment)
      const rem = num(r.km_at_removal)
      const unit = num(r.cost_per_tyre)
      const qty = num(r.qty) || 1
      return {
        id: r.id,
        issue_date: r.issue_date || null,
        brand: r.brand || null,
        serial_no: r.serial_no || null,
        description: r.description || null,
        category: r.category || null,
        risk_level: r.risk_level || null,
        cost: unit === null ? null : unit * qty,
        km_run: fit !== null && rem !== null && rem >= fit ? rem - fit : null,
        qty,
        site: r.site || null,
        remarks: r.remarks_cleaned || r.remarks || null,
        flagged: flaggedIds.has(r.id),
      }
    })
}
