/**
 * Bulk ZIP of report PDFs.
 *
 * Built in the browser from the STORED PDFs (verified against their recorded sha256).
 * A report that is not stored yet is generated through the same getOrCreatePdf path,
 * at most two at a time. Every selected record appears in manifest.csv and
 * manifest.json: either as included, or as missing with the reason. Nothing is
 * dropped silently.
 *
 * Why the browser and not a server job: the inspection PDF can only be drawn in a
 * browser, the stored files are already compressed (the ZIP only stores them), and
 * 100 reports of about 0.3 MB is about 30 MB, which a browser handles. The server
 * job design for larger exports is in docs/pdf/PDF_ARCHITECTURE_AUDIT.md.
 */
import { fetchVerifiedPdf } from './service'
import { sha256HexOfBytes } from './cacheKey'
import { REPORT_LABELS } from './templates'
import { csvCell } from '../csvSafe.js'

export const DEFAULT_BULK_LIMIT = 50
export const MAX_BULK_LIMIT = 500
export const BULK_CONCURRENCY = 2

/**
 * The configured limit: any whole number from 1 to 500, 50 when nothing usable is set.
 * MIRROR: public.pdf_cache_effective_settings (the server enforces the same range).
 */
export function resolveBulkLimit(configured) {
  const n = Math.floor(Number(configured))
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_BULK_LIMIT
  return Math.min(MAX_BULK_LIMIT, n)
}

/** Two records can share a file name (same asset, site and day). Keep both. */
export function uniqueName(name, used) {
  const clean = String(name || 'Report.pdf').replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').trim() || 'Report.pdf'
  if (!used.has(clean.toLowerCase())) { used.add(clean.toLowerCase()); return clean }
  const dot = clean.toLowerCase().endsWith('.pdf') ? clean.length - 4 : clean.length
  for (let i = 2; ; i++) {
    const next = `${clean.slice(0, dot)} (${i})${clean.slice(dot)}`
    if (!used.has(next.toLowerCase())) { used.add(next.toLowerCase()); return next }
  }
}

export const MANIFEST_COLUMNS = Object.freeze(['record', 'source_id', 'status', 'file_name', 'reason', 'revision',
  'generation', 'approved_revision', 'sha256', 'bytes', 'origin'])

export function manifestCsv(rows) {
  const lines = [MANIFEST_COLUMNS.join(',')]
  for (const r of rows) lines.push(MANIFEST_COLUMNS.map((c) => csvCell(r[c])).join(','))
  return lines.join('\r\n') + '\r\n'
}

async function pool(items, size, worker) {
  let next = 0
  const run = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, items.length)) }, run))
}

/**
 * @param {object} p
 * @param {string} p.type
 * @param {Array<{sourceId: string, label?: string}>} p.items   the selected records
 * @param {(item) => Promise<object>} p.ensure  returns a getOrCreatePdf result for one record
 * @param {number} [p.limit]       records above the limit are listed as missing, not dropped
 * @param {Set<string>|null} [p.allowed]  ids the server authorised for this account (null = not checked);
 *                                 a record outside it is listed as missing and never requested
 * @param {(progress: {done: number, total: number, phase: string}) => void} [p.onProgress]
 * @param {() => boolean} [p.isCancelled]
 * @returns {Promise<{ blob: Blob, manifest: object, included: number, missing: number }>}
 */
export async function buildPdfZip({ type, items, ensure, limit = DEFAULT_BULK_LIMIT, allowed = null, concurrency = BULK_CONCURRENCY,
  onProgress = () => {}, isCancelled = () => false, now = new Date() }) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const used = new Set()
  const rows = new Array(items.length)
  const within = items.slice(0, limit)
  let done = 0

  items.slice(limit).forEach((item, k) => {
    rows[limit + k] = { record: item.label || item.sourceId, source_id: item.sourceId, status: 'missing',
      reason: `Over the limit of ${limit} reports for one download. Select fewer records and download again.` }
  })

  await pool(within, concurrency, async (item, i) => {
    const base = { record: item.label || item.sourceId, source_id: item.sourceId }
    if (isCancelled()) { rows[i] = { ...base, status: 'missing', reason: 'The download was cancelled.' }; return }
    if (allowed && !allowed.has(String(item.sourceId))) {
      rows[i] = { ...base, status: 'missing', reason: 'This report is not available to your account.' }
      done += 1; onProgress({ done, total: within.length, phase: 'reports' })
      return
    }
    try {
      const r = await ensure(item)
      const blob = r.blob || await fetchVerifiedPdf(r.file)
      const name = uniqueName(r.fileName || r.file?.file_name, used)
      // bytes, not a Blob: the same code then runs in the browser and under test
      zip.file(name, new Uint8Array(await blob.arrayBuffer()), { compression: 'STORE', date: now })
      rows[i] = { ...base, status: 'included', file_name: name, reason: r.note || '',
        revision: r.file?.cache_key || r.cacheKey || '', generation: r.file?.generation ?? '',
        approved_revision: r.file ? (r.file.immutable ? 'yes' : 'no') : '',
        sha256: r.file?.sha256 || await sha256HexOfBytes(blob), bytes: blob.size,
        origin: r.cached ? 'stored' : r.stored ? 'generated and stored' : 'generated, not stored' }
    } catch (err) {
      rows[i] = { ...base, status: 'missing', reason: String(err?.message || 'The report could not be prepared.').slice(0, 300) }
    } finally {
      done += 1
      onProgress({ done, total: within.length, phase: 'reports' })
    }
  })

  const included = rows.filter((r) => r.status === 'included').length
  const manifest = {
    report_type: type, report_label: REPORT_LABELS[type] || type, generated_at: now.toISOString(),
    selected: items.length, included, missing: items.length - included, limit, reports: rows,
  }
  zip.file('manifest.csv', manifestCsv(rows), { date: now })
  zip.file('manifest.json', JSON.stringify(manifest, null, 2), { date: now })
  onProgress({ done, total: within.length, phase: 'zip' })
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE', streamFiles: true })
  const blob = new Blob([bytes], { type: 'application/zip' })
  return { blob, manifest, included, missing: items.length - included }
}
