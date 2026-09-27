/**
 * erpImportAnalytics - pure presentation engine for the ERP Data Import page.
 *
 * It never changes what is imported: mapping, activity derivation and expense
 * validation stay in src/lib/erpImport.js. This module only summarises and
 * filters rows those functions already produced, so the page and its tests
 * agree on every count shown.
 *
 * No I/O; `now` is injectable wherever time matters.
 */

/** 'asset_no' -> 'Asset No'. */
export function humanizeKey(key) {
  return String(key || '')
    .split('_')
    .filter(Boolean)
    .map((w) => (w.length <= 2 && w !== 'no' ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
}

/** Flag tokens for one row. Mirrors what FlagCell renders. */
export function flagsOf(row, datasetKey) {
  const out = []
  if (!row) return out
  if (datasetKey === 'change') {
    out.push(row.is_active ? 'Active' : 'Old')
    if (row.chain_ok === false) out.push('Chain break')
  }
  if (datasetKey === 'expense' && row._hasChangeTab && !row.serial_in_change) out.push('No fitment')
  const warns = Array.isArray(row.warnings) ? row.warnings : []
  if (warns.length) out.push(`${warns.length} warning${warns.length === 1 ? '' : 's'}`)
  return out
}

/** A row that needs a human look before it is promoted. */
export function isFlagged(row, datasetKey) {
  if (!row) return false
  if (Array.isArray(row.warnings) && row.warnings.length > 0) return true
  if (datasetKey === 'change' && row.chain_ok === false) return true
  if (datasetKey === 'expense' && row._hasChangeTab && !row.serial_in_change) return true
  return false
}

/**
 * Counts over mapped (import tab) or saved (review tab) rows. `active` / `old`
 * are null outside the change log: they are not measurable there.
 */
export function summarizeRows(rows = [], datasetKey) {
  const list = Array.isArray(rows) ? rows : []
  let active = 0, warned = 0, chainBreaks = 0, noFitment = 0, flagged = 0
  for (const r of list) {
    if (r.is_active) active += 1
    if (Array.isArray(r.warnings) && r.warnings.length) warned += 1
    if (r.chain_ok === false) chainBreaks += 1
    if (r._hasChangeTab && !r.serial_in_change) noFitment += 1
    if (isFlagged(r, datasetKey)) flagged += 1
  }
  const isChange = datasetKey === 'change'
  return {
    rows: list.length,
    active: isChange ? active : null,
    old: isChange ? Math.max(0, list.length - active) : null,
    warned,
    chainBreaks: isChange ? chainBreaks : null,
    noFitment: datasetKey === 'expense' ? noFitment : null,
    flagged,
    flaggedPct: list.length ? Math.round((flagged / list.length) * 1000) / 10 : null,
  }
}

/**
 * Review-tab filter. `flag` keeps the page's original change-log semantics
 * (all | active | old | flagged) and extends 'flagged' to every dataset.
 */
export function filterReviewRows(rows = [], { search = '', flag = 'all', datasetKey } = {}) {
  let out = Array.isArray(rows) ? rows : []
  if (flag !== 'all') {
    if (datasetKey === 'change' && flag === 'active') out = out.filter((r) => r.is_active)
    else if (datasetKey === 'change' && flag === 'old') out = out.filter((r) => !r.is_active)
    else if (flag === 'flagged') out = out.filter((r) => isFlagged(r, datasetKey))
  }
  const q = String(search || '').trim().toLowerCase()
  if (q) out = out.filter((r) => Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(q)))
  return out
}

/** Flat rows for the review Excel export (same shape the page always wrote). */
export function reviewExportRows(rows = [], displayCols = [], datasetKey) {
  const cols = datasetKey === 'change' ? ['source_row', 'is_active', 'chain_ok', ...displayCols] : ['source_row', ...displayCols]
  const headers = cols.map((c) => (c === 'is_active' ? 'Active' : c === 'chain_ok' ? 'Chain OK' : c))
  const flat = (rows || []).map((r) => {
    const o = {}
    for (const c of cols) o[c] = c === 'is_active' ? (r.is_active ? 'Active' : 'Old') : r[c] ?? ''
    return o
  })
  return { cols, headers, flat }
}

/** Summary of saved batches. `latestAgeDays` is null when there are none. */
export function summarizeBatches(batches = [], now) {
  const list = Array.isArray(batches) ? batches : []
  const t = now instanceof Date ? now.getTime() : Date.now()
  let rows = 0
  let latest = null
  const countries = new Set()
  for (const b of list) {
    rows += Number(b.count) || 0
    if (b.country) countries.add(b.country)
    const ms = new Date(b.created_at).getTime()
    if (Number.isFinite(ms) && (latest == null || ms > latest)) latest = ms
  }
  return {
    batches: list.length,
    rows,
    countries: [...countries].sort(),
    latestAt: latest == null ? null : new Date(latest).toISOString(),
    latestAgeDays: latest == null ? null : Math.max(0, Math.floor((t - latest) / 86400000)),
  }
}

/** Honest cap note: how many rows a browser save would leave behind. */
export function capOverflow(total, cap) {
  const n = Number(total) || 0
  return Math.max(0, n - (Number(cap) || 0))
}

/** Share of a sheet's read rows that carried the dataset key. null when none read. */
export function matchRate(match) {
  if (!match || !match.read) return null
  const keyed = Number(match.keyed)
  if (!Number.isFinite(keyed)) return null
  return Math.round((keyed / match.read) * 1000) / 10
}
