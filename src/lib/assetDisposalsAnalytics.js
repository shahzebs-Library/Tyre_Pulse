/**
 * assetDisposalsAnalytics - page-level helpers for /asset-disposals.
 *
 * The disposal maths live in `assetDisposal` (register, economics, summary,
 * findings) and `assetDisposalReliability`. This module holds the smaller
 * pieces the page used to compute inline: the filter option lists, the active
 * filter count, the zip of the register and reliability exports, the upload
 * preview counts, and the sort keys the register table needs.
 *
 * Pure, no I/O. Honest by construction: a machine with no breakdown row has NO
 * downtime value (null, sorted last), never zero days down.
 */

const txt = v => String(v ?? '').trim()

/** Distinct, sorted, non-blank values the filter selects offer. */
export function disposalFilterOptions(rows = []) {
  const uniq = key => [...new Set((rows || []).map(r => r?.[key]).filter(v => txt(v) !== ''))].sort()
  return { assetTypes: uniq('asset_type'), regions: uniq('region'), sites: uniq('site') }
}

/** How many filters narrow the register. `inRegister` counts only when not 'all'. */
export function countActiveFilters(filters = {}) {
  return Object.entries(filters || {}).filter(([k, v]) => (k === 'inRegister' ? v !== 'all' && v != null : !!v)).length
}

/**
 * One export, both halves. Register columns first; reliability columns the
 * register does not already carry are appended, zipped by index because both
 * engines map the SAME filtered array in the same order. A missing or malformed
 * reliability model leaves the register export alone rather than a sheet of
 * blank columns.
 */
export function mergeExportModel(base, rel) {
  if (!base || !Array.isArray(base.columns)) return { columns: [], head: [], rows: [] }
  if (!rel || !Array.isArray(rel.columns) || !Array.isArray(rel.rows)) return base
  const extra = rel.columns
    .map((k, i) => ({ key: k, head: (rel.head || [])[i] || k }))
    .filter(c => !base.columns.includes(c.key))
  return {
    columns: [...base.columns, ...extra.map(c => c.key)],
    head: [...(base.head || []), ...extra.map(c => c.head)],
    rows: (base.rows || []).map((o, i) => {
      const src = rel.rows[i] || {}
      const add = {}
      for (const c of extra) add[c.key] = src[c.key]
      return { ...o, ...add }
    }),
  }
}

/** Upload preview: rows new to the list vs rows that refresh an existing entry (asset code, case-insensitive). */
export function uploadPreviewCounts(rows = [], existing = []) {
  const known = new Set((existing || []).map(r => txt(r?.asset_no).toUpperCase()).filter(Boolean))
  const list = rows || []
  const added = list.filter(r => !known.has(txt(r?.asset_no).toUpperCase())).length
  return { total: list.length, added, refreshed: list.length - added }
}

/**
 * Sort key for the downtime column: days down now for an open breakdown, 0 for
 * a machine back in service, and null (sorted last, printed "Not recorded")
 * when the breakdown register has nothing on it.
 */
export function downtimeSortValue(entry) {
  if (!entry) return null
  if (entry.open > 0) {
    // Number(null) is 0 and 0 is finite: test for blank first.
    if (entry.currentDays == null || entry.currentDays === '') return null
    const d = Number(entry.currentDays)
    return Number.isFinite(d) ? d : null
  }
  return 0
}

/**
 * Share of the filtered list still counted as Active fleet. Null (N/A) on an
 * empty list - there is no rate to state, not a zero rate.
 */
export function stillActiveShare(totals) {
  if (totals?.assets == null || totals?.stillActive == null) return null
  const n = Number(totals.assets)
  const a = Number(totals.stillActive)
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(a)) return null
  return Math.round((a / n) * 1000) / 10
}

/** Dot colour class for a finding tone; the finding text itself carries the meaning. */
export function findingDotClass(tone) {
  if (tone === 'danger') return 'bg-red-400'
  if (tone === 'warning') return 'bg-amber-400'
  if (tone === 'info') return 'bg-sky-400'
  return 'bg-slate-400'
}
