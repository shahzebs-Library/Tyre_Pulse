/**
 * uploadDataAnalytics - pure presentation engine for the Upload Data wizard.
 *
 * The wizard's parsing, mapping and upload semantics live in the page and the
 * import libraries and are NOT changed here. This module only turns state the
 * wizard already holds into the KPI strip, the quality verdicts and the table
 * rows it renders, so every figure is testable.
 *
 * HONESTY RULES: a figure with nothing to measure is null (N/A), never 0.
 */

export function resultNumber(v) {
  const n = Number(v || 0)
  return Number.isFinite(n) ? n : 0
}

/** Rows the upload accounted for (added + skipped + dropped exact copies). */
export function rowsHandled(result) {
  if (!result) return 0
  if (result.pending) return resultNumber(result.submitted)
  return resultNumber(result.added) + resultNumber(result.skipped) + resultNumber(result.dupesSkipped)
}

/**
 * KPI figures for the mapping / preview steps.
 * @param {{headers:string[], rows:any[], mapping:Record<string,string|undefined>, fields:{key:string,required?:boolean}[], skipCount?:number}} s
 */
export function fileSummary({ headers = [], rows = [], mapping = {}, fields = [], skipCount = 0 } = {}) {
  const required = fields.filter((f) => f.required)
  const mappedFields = fields.filter((f) => mapping[f.key]).length
  const used = new Set(Object.values(mapping || {}).filter(Boolean))
  const unmapped = headers.filter((h) => !used.has(h)).length
  const rowCount = Array.isArray(rows) ? rows.length : 0
  return {
    rows: rowCount,
    columns: headers.length,
    mappedFields,
    totalFields: fields.length,
    requiredMapped: required.filter((f) => mapping[f.key]).length,
    requiredTotal: required.length,
    complete: required.every((f) => mapping[f.key]),
    unmapped,
    toUpload: Math.max(0, rowCount - (Number(skipCount) || 0)),
  }
}

/** 'good' | 'partial' | 'poor' for one data-quality row. */
export function qualityVerdict(qf) {
  if (!qf) return 'poor'
  if (qf.required && qf.fillPct < 50) return 'poor'
  if (qf.fillPct >= 90 && !qf.invalid && !qf.dupes) return 'good'
  if (qf.fillPct >= 50) return 'partial'
  return qf.required ? 'poor' : 'partial'
}

export const QUALITY_LABEL = { good: 'Good', partial: 'Check', poor: 'Poor' }

export function summarizeQuality(quality = []) {
  const list = Array.isArray(quality) ? quality : []
  let invalid = 0, dupes = 0, lowRequired = 0, issues = 0, fill = 0
  for (const q of list) {
    invalid += Number(q.invalid) || 0
    dupes += Number(q.dupes) || 0
    if (q.required && q.fillPct < 50) lowRequired += 1
    if (qualityVerdict(q) !== 'good') issues += 1
    fill += Number(q.fillPct) || 0
  }
  return {
    fields: list.length,
    issues,
    invalid,
    dupes,
    lowRequired,
    avgFill: list.length ? Math.round(fill / list.length) : null,
  }
}

export function filterQuality(quality = [], { search = '', onlyIssues = false } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (quality || []).filter((qf) => {
    if (onlyIssues && qualityVerdict(qf) === 'good') return false
    if (!q) return true
    return String(qf.label || '').toLowerCase().includes(q) || String(qf.key || '').toLowerCase().includes(q)
  })
}

/**
 * Raw sheet preview rows for the header-row picker. Each row carries its
 * 1-based sheet row, a role relative to the chosen header row, and c0..cN.
 */
export function rawPreviewRows(aoa = [], headerRowIdx = 0, maxRows = 8, maxCols = 12) {
  const src = (Array.isArray(aoa) ? aoa : []).slice(0, maxRows)
  let width = 0
  for (const r of src) width = Math.max(width, Math.min(maxCols, (r || []).length))
  const rows = src.map((r, ri) => {
    const o = {
      _row: ri + 1,
      _role: ri === headerRowIdx ? 'header' : ri < headerRowIdx ? 'above' : 'data',
    }
    for (let ci = 0; ci < width; ci++) {
      const c = (r || [])[ci]
      o[`c${ci}`] = c == null || c === '' ? '' : String(c).slice(0, 40)
    }
    return o
  })
  return { rows, width }
}

/** Spreadsheet column letter for a 0-based index: 0 -> A, 26 -> AA. */
export function columnLetter(i) {
  let n = Number(i) + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Flatten the exact-copy check into table rows. */
export function dupReviewRows(dupCheck, skipIds = new Set()) {
  if (!dupCheck) return []
  const all = [
    ...(dupCheck.exact || []).map((x) => ({ ...x, kind: 'exact' })),
    ...(dupCheck.changed || []).map((x) => ({ ...x, kind: 'changed' })),
    ...(dupCheck.conflicts || []).map((x) => ({ ...x, kind: 'history' })),
  ]
  return all.map(({ idx, row = {}, existing = {}, kind }) => ({
    idx,
    fileRow: idx + 1,
    serial: row.serial_no ?? '',
    fileAsset: row.asset_no ?? '',
    fileDate: row.issue_date ?? '',
    dbAsset: existing.asset_no ?? '',
    dbDate: existing.issue_date ?? '',
    kind,
    action: skipIds.has(idx) ? 'drop' : 'import',
  }))
}

export const DUP_KIND_LABEL = { exact: 'Exact copy', changed: 'Changed same fitment', history: 'Serial history' }

/** Normalise the per-row skip log into table rows. */
export function skipLogRows(skipLog = []) {
  return (Array.isArray(skipLog) ? skipLog : []).map((e, i) => ({
    id: i,
    row: e?.row ?? null,
    serial: e?.serial_no ?? e?.serial ?? '',
    reason: e?.error ?? e?.reason ?? 'Not recorded',
  }))
}
