/**
 * erpSyncAnalytics - pure engine for the ERP Sync load-history panel.
 *
 * Three real sources, each summarised honestly:
 *   - import_batches (every in-app upload, by module),
 *   - upload coverage (per country and feed: when data last arrived),
 *   - expense_import_rejects (lines the upload guard refused).
 * Rejected lines carry money in their own country's currency, so values are
 * never totalled here; only counts are.
 */
import { importRowOutcome } from './api/importHistory'

const DAY = 86400000
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

const MODULE_LABELS = {
  fleet: 'Fleet register', tyre: 'Tyre records', stock: 'Stock', accident: 'Accidents', inspection: 'Inspections',
  workorder: 'Work orders', warranty: 'Warranty claims', gatepass: 'Gate passes', supplier: 'Suppliers', driver: 'Drivers',
  parts_expense: 'Expense lines',
}
export function moduleLabel(m) {
  return MODULE_LABELS[m] || String(m || 'Unknown').replaceAll('_', ' ')
}

/** Per module totals over the batch history. */
export function batchFeedSummary(batches = []) {
  const map = new Map()
  for (const b of batches) {
    const key = b.module || 'unknown'
    const row = map.get(key) || { module: key, label: moduleLabel(key), batches: 0, rows: 0, imported: 0, errors: 0, duplicates: 0, done: 0, unfinished: 0, nothing: 0, undone: 0, lastAt: null }
    row.batches += 1
    row.rows += num(b.total_rows)
    row.imported += num(b.imported_rows)
    row.errors += num(b.error_rows)
    row.duplicates += num(b.duplicate_rows)
    const outcome = importRowOutcome(b)
    if (row[outcome] != null && outcome !== 'unknown') row[outcome] += 1
    if (b.created_at && (!row.lastAt || b.created_at > row.lastAt)) row.lastAt = b.created_at
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')))
}

export function historyKpis(batches = [], rejects = [], freshness = []) {
  const outcomes = batches.map(importRowOutcome)
  return {
    batches: batches.length,
    imported: batches.reduce((s, b) => s + num(b.imported_rows), 0),
    unfinished: outcomes.filter(o => o === 'unfinished').length,
    nothing: outcomes.filter(o => o === 'nothing').length,
    rejects: rejects.length,
    staleFeeds: freshness.filter(f => f.band === 'stale' || f.band === 'silent').length,
  }
}

/** Freshness band from days since the last data. */
export function freshnessBand(daysSince) {
  if (daysSince == null) return 'never'
  if (daysSince <= 2) return 'fresh'
  if (daysSince <= 7) return 'stale'
  return 'silent'
}

/**
 * Flatten upload coverage detail (countries[].sources[]) into feed rows.
 * @param {{countries:Array, today?:string}} detail
 */
export function feedFreshness(detail, now = Date.now()) {
  const out = []
  for (const c of detail?.countries || []) {
    for (const src of c.sources || []) {
      let days = src.days_since_last != null ? num(src.days_since_last) : null
      if (days == null && src.last_data_date) {
        const t = new Date(`${String(src.last_data_date).slice(0, 10)}T00:00:00`).getTime()
        if (Number.isFinite(t)) days = Math.max(0, Math.floor((now - t) / DAY))
      }
      out.push({
        country: c.country, src: src.src, label: src.label || src.src,
        lastDate: src.last_data_date ? String(src.last_data_date).slice(0, 10) : null,
        daysSince: days, band: freshnessBand(days),
        missingDays: src.expect_daily ? num(src.missing_count) : null,
        expectDaily: !!src.expect_daily, rows: src.total_rows != null ? num(src.total_rows) : null,
      })
    }
  }
  const rank = { silent: 0, stale: 1, never: 2, fresh: 3 }
  return out.sort((a, b) => rank[a.band] - rank[b.band] || (b.daysSince ?? -1) - (a.daysSince ?? -1))
}

/** Rejected expense lines grouped by reason and by the country pair. */
export function rejectSummary(rejects = []) {
  const reasons = {}; const pairs = {}
  for (const r of rejects) {
    const reason = r.reject_reason || 'Country mismatch (reason not recorded)'
    reasons[reason] = (reasons[reason] || 0) + 1
    const pair = `${r.uploaded_country || 'Unknown'} upload, belongs to ${r.detected_country || 'Unknown'}`
    pairs[pair] = (pairs[pair] || 0) + 1
  }
  const toList = o => Object.entries(o).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
  return { total: rejects.length, byReason: toList(reasons), byPair: toList(pairs) }
}

export function filterBatches(batches = [], { module = 'all', outcome = 'all', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return batches.filter(b => (module === 'all' || (b.module || 'unknown') === module)
    && (outcome === 'all' || importRowOutcome(b) === outcome)
    && (!q || `${b.module || ''} ${b.sheet || ''} ${b.country || ''} ${b.source_system || ''}`.toLowerCase().includes(q)))
}

export function batchExportRows(batches = []) {
  return batches.map(b => ({
    created_at: b.created_at ? String(b.created_at).replace('T', ' ').slice(0, 16) : 'N/A',
    module: moduleLabel(b.module),
    country: b.country || 'N/A',
    sheet: b.sheet || 'N/A',
    total_rows: num(b.total_rows),
    imported_rows: num(b.imported_rows),
    error_rows: num(b.error_rows),
    duplicate_rows: num(b.duplicate_rows),
    outcome: importRowOutcome(b),
  }))
}
