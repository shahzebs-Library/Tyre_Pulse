/**
 * dataIntakeHistoryAnalytics.js - pure analytics over the import batch history
 * (no I/O, deterministic).
 *
 * The OUTCOME of a batch is not re-derived here: it comes from
 * `importRowOutcome` in lib/api/importHistory.js, the one place that decides
 * whether "0 imported" means undone, never approved, or nothing to import.
 *
 * HONESTY NOTES
 * - Row totals only add the batches that actually recorded the figure. When no
 *   batch in scope recorded a column the total is null (N/A), never 0.
 * - The import rate is null when no rows were read.
 * - A REPEAT FILE is the same sha256 uploaded as more than one batch. Batches
 *   whose file carries no fingerprint cannot be compared and are counted as such
 *   rather than assumed unique.
 * - "Stale" means never approved and older than N days, measured from the batch
 *   creation time against an injectable `now`.
 */
import { importRowOutcome, OUTCOME_META } from './api/importHistory'

const MS_PER_DAY = 86400000

/** Outcome keys in display order. */
export const OUTCOME_ORDER = ['done', 'undone', 'unfinished', 'nothing', 'unknown']

/** Default "never approved for more than N days" threshold. */
export const STALE_DAYS = 7

function toMs(v) {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function sumKnown(rows, key) {
  let seen = false
  let total = 0
  for (const r of rows) {
    const n = num(r[key])
    if (n == null) continue
    seen = true
    total += n
  }
  return seen ? total : null
}

function pct(part, whole) {
  if (part == null || !whole) return null
  return Math.round((part / whole) * 1000) / 10
}

/** Map of file id -> { name, sha256, size } from a fingerprint list. */
export function indexFiles(files) {
  const m = new Map()
  for (const f of files || []) {
    if (!f?.id) continue
    const sha = f.sha256 ? String(f.sha256).trim().toLowerCase() : ''
    m.set(f.id, { name: f.original_filename || null, sha256: sha || null, size: num(f.size_bytes) })
  }
  return m
}

/**
 * Enrich batches with their outcome, file identity, repeat count and age.
 * @param {object[]} batches rows from imports.listBatches
 * @param {Map|object[]} files index from indexFiles, or the raw fingerprint list
 * @param {{now?:Date|string}} opts
 */
export function enrichBatches(batches, files, { now } = {}) {
  const fileIdx = files instanceof Map ? files : indexFiles(files)
  const list = Array.isArray(batches) ? batches.filter(Boolean) : []
  const shaCount = new Map()
  for (const b of list) {
    const sha = fileIdx.get(b.file_id)?.sha256
    if (sha) shaCount.set(sha, (shaCount.get(sha) || 0) + 1)
  }
  const nowT = toMs(now ?? new Date()) ?? Date.now()
  return list.map((b) => {
    const outcome = importRowOutcome(b)
    const file = fileIdx.get(b.file_id) || null
    const sha = file?.sha256 || null
    const created = toMs(b.created_at)
    return {
      ...b,
      outcome,
      outcomeLabel: OUTCOME_META[outcome]?.label || 'Unknown',
      fileName: file?.name || null,
      sha256: sha,
      repeatCount: sha ? shaCount.get(sha) : null,
      isRepeat: sha ? shaCount.get(sha) > 1 : false,
      ageDays: created == null ? null : Math.max(0, Math.floor((nowT - created) / MS_PER_DAY)),
    }
  })
}

/** Batches grouped by identical file content, only groups of 2 or more, biggest first. */
export function repeatFileGroups(rows) {
  const m = new Map()
  for (const r of rows || []) {
    if (!r.sha256) continue
    if (!m.has(r.sha256)) m.set(r.sha256, [])
    m.get(r.sha256).push(r)
  }
  return [...m.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([sha256, list]) => {
      const sorted = [...list].sort((a, b) => (toMs(a.created_at) ?? 0) - (toMs(b.created_at) ?? 0))
      return {
        sha256,
        fileName: sorted.find((r) => r.fileName)?.fileName || null,
        uploads: list.length,
        firstAt: sorted[0]?.created_at ?? null,
        lastAt: sorted[sorted.length - 1]?.created_at ?? null,
        importedTwice: list.filter((r) => r.outcome === 'done').length > 1,
        batchIds: sorted.map((r) => r.id),
      }
    })
    .sort((a, b) => b.uploads - a.uploads || String(a.fileName).localeCompare(String(b.fileName)))
}

/**
 * Headline KPIs for a set of enriched batches.
 * @param {object[]} rows output of enrichBatches
 * @param {{staleDays?:number}} opts
 */
export function summarizeIntake(rows, { staleDays = STALE_DAYS } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const byOutcome = Object.fromEntries(OUTCOME_ORDER.map((k) => [k, 0]))
  for (const r of list) byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1
  const rowsRead = sumKnown(list, 'total_rows')
  const rowsImported = sumKnown(list, 'imported_rows')
  const rowsFailed = sumKnown(list, 'error_rows')
  const rowsDuplicate = sumKnown(list, 'duplicate_rows')
  const fingerprinted = list.filter((r) => r.sha256).length
  const groups = repeatFileGroups(list)
  const stale = list.filter((r) => r.outcome === 'unfinished' && r.ageDays != null && r.ageDays >= staleDays).length
  return {
    total: list.length,
    byOutcome,
    rowsRead,
    rowsImported,
    rowsFailed,
    rowsDuplicate,
    importRate: pct(rowsImported, rowsRead),
    failRate: pct(rowsFailed, rowsRead),
    repeatFiles: groups.length,
    repeatUploads: groups.reduce((s, g) => s + g.uploads, 0),
    importedTwice: groups.filter((g) => g.importedTwice).length,
    fingerprinted,
    fingerprintCoverage: pct(fingerprinted, list.length),
    staleDays,
    staleUnfinished: stale,
  }
}

/** Batches per module with imported/read rows, most batches first. */
export function moduleBreakdown(rows) {
  const m = new Map()
  for (const r of rows || []) {
    const key = r.module || 'Unknown'
    if (!m.has(key)) m.set(key, [])
    m.get(key).push(r)
  }
  return [...m.entries()]
    .map(([module, list]) => {
      const rowsRead = sumKnown(list, 'total_rows')
      const rowsImported = sumKnown(list, 'imported_rows')
      return {
        module,
        batches: list.length,
        done: list.filter((r) => r.outcome === 'done').length,
        rowsRead,
        rowsImported,
        importRate: pct(rowsImported, rowsRead),
      }
    })
    .sort((a, b) => b.batches - a.batches || a.module.localeCompare(b.module))
}

/**
 * Filter enriched batches.
 * outcome/module/status: value or ''; repeatOnly: only repeat-file batches.
 */
export function filterBatches(rows, { search = '', outcome = '', module = '', status = '', repeatOnly = false } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (rows || []).filter((r) => {
    if (outcome && r.outcome !== outcome) return false
    if (module && r.module !== module) return false
    if (status && r.import_status !== status) return false
    if (repeatOnly && !r.isRepeat) return false
    if (!q) return true
    return [r.module, r.country, r.import_status, r.fileName, r.id, r.outcomeLabel, r.sha256]
      .some((v) => String(v || '').toLowerCase().includes(q))
  })
}

export const BATCH_EXPORT_COLS = ['created', 'module', 'country', 'file', 'outcome', 'status', 'read', 'imported', 'failed', 'duplicates', 'repeat', 'batch']
export const BATCH_EXPORT_HEADERS = ['Uploaded', 'Module', 'Country', 'File', 'Outcome', 'Status', 'Rows read', 'Rows imported', 'Rows failed', 'Duplicates', 'Same file uploads', 'Batch ID']

/** Export rows; unknown values read N/A rather than 0. */
export function batchExportRows(rows) {
  const na = (v) => (num(v) == null ? 'N/A' : num(v))
  return (rows || []).map((r) => ({
    created: r.created_at ? String(r.created_at).slice(0, 16).replace('T', ' ') : 'N/A',
    module: r.module || 'N/A',
    country: r.country || 'N/A',
    file: r.fileName || 'N/A',
    outcome: r.outcomeLabel,
    status: r.import_status || 'N/A',
    read: na(r.total_rows),
    imported: na(r.imported_rows),
    failed: na(r.error_rows),
    duplicates: na(r.duplicate_rows),
    repeat: r.repeatCount == null ? 'N/A' : r.repeatCount,
    batch: r.id,
  }))
}
