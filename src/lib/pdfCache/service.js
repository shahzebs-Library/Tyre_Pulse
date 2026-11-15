/**
 * getOrCreatePdf: generate a report PDF once, store it, and reuse it.
 *
 *   lookup  -> ready?  hand back the stored file (no generation, no photo downloads)
 *   claim   -> this browser is the one generator: run the EXISTING generator, upload
 *              the bytes, mark the job complete
 *           -> somebody else is generating: wait for them, bounded
 *   failure -> recorded with bounded retries; the person still gets a plain message
 *
 * The generator is passed in and is not changed by caching: the same function that
 * used to save the file now returns its bytes.
 *
 * Before the database migration is applied (or if the bucket is missing) every path
 * falls back to generating directly, so this code is safe to ship first.
 */
import * as api from '../api/pdfCache'
import { sha256HexOfBytes } from './cacheKey'
import { templateVersionFor } from './templates'
import { reasonMessage, LEASE_SECONDS } from './state'

const POLL_MS = 2000
const DEFAULT_WAIT_MS = 90_000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class PdfCacheError extends Error {
  constructor(message, reason) { super(message); this.name = 'PdfCacheError'; this.reason = reason || null }
}

const toBlob = (bytes) => (bytes instanceof Blob ? bytes : new Blob([bytes], { type: 'application/pdf' }))

/** Save a Blob under a file name (the same thing jsPDF's doc.save does). */
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName || 'Report.pdf'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function navigateDownload(url) {
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function runGenerator(generate) {
  const out = await generate()
  if (!out || !out.bytes) throw new Error('The report generator returned nothing.')
  const blob = toBlob(out.bytes)
  if (!blob.size) throw new Error('The report generator returned an empty file.')
  return { blob, fileName: out.fileName || null, warnings: Array.isArray(out.warnings) ? out.warnings : [] }
}

/**
 * @param {object}   p
 * @param {string}   p.type         report type (REPORT_TYPES)
 * @param {string}   p.sourceId     id of the source record
 * @param {string}   p.brandingRev  from brandingRevision()
 * @param {string}  [p.clientRev]   from clientRevision(), '' when none
 * @param {string}   p.fileName     download name (existing convention; never part of the key)
 * @param {() => Promise<{bytes: ArrayBuffer|Blob, fileName?: string, warnings?: string[]}>} p.generate
 * @param {boolean} [p.interactive] a person is waiting (default). Background callers pass false and respect backoff.
 * @param {boolean} [p.regenerate]  make a new generation even though one is stored (manager / admin)
 * @param {string}  [p.reason]      required to replace an approved revision
 * @param {(s: string) => void} [p.onStatus] 'checking' | 'generating' | 'waiting' | 'saving' | 'ready'
 * @param {() => boolean} [p.canGenerate] false when the caller can no longer draw the report (stored copies are still served)
 * @returns {Promise<{ file: object|null, blob: Blob|null, fileName: string, cached: boolean, stored: boolean, note: string|null }>}
 */
export async function getOrCreatePdf(p) {
  const { type, sourceId, brandingRev, clientRev = '', fileName, generate, interactive = true,
    regenerate = false, reason = null, onStatus = () => {}, waitMs = DEFAULT_WAIT_MS, canGenerate = () => true } = p
  const req = { type, sourceId, template: p.template || templateVersionFor(type), brandingRev, clientRev }

  const direct = async (note) => {
    onStatus('generating')
    const g = await runGenerator(generate)
    return { file: null, blob: g.blob, fileName: g.fileName || fileName, cached: false, stored: false, note }
  }

  let look
  try {
    onStatus('checking')
    look = await api.lookupPdf(req)
  } catch (err) {
    if (api.isPdfCacheNotProvisioned(err)) return direct(null)
    if (!interactive) throw err
    // The cache is an optimisation. If it cannot be reached, the person still gets the report.
    return direct('The stored copy could not be checked, so this report was prepared again.')
  }
  if (!look?.ok) throw new PdfCacheError(reasonMessage(look?.reason), look?.reason)
  if (look.state === 'ready' && !regenerate) {
    onStatus('ready')
    return { file: look.file, blob: null, fileName: look.file.file_name || fileName, cached: true, stored: true, note: null }
  }
  if (!interactive && (look.state === 'failed' || look.state === 'retry_scheduled' || look.state === 'processing')) {
    throw new PdfCacheError('The report is not ready yet.', look.state)
  }

  // Nothing stored and this caller can no longer draw it (the page that holds the renderer
  // was closed): say so before taking a job that would only be recorded as a failure.
  if (!canGenerate()) throw new PdfCacheError('This report is not stored yet. Open the inspections page and download it again to prepare it.', 'cannot_generate')

  const deadline = Date.now() + waitMs
  for (;;) {
    let claim
    try {
      claim = regenerate
        ? await api.regeneratePdf(req, { fileName, reason, leaseSeconds: LEASE_SECONDS })
        : await api.claimPdf(req, { fileName, leaseSeconds: LEASE_SECONDS, retry: interactive })
    } catch (err) {
      if (api.isPdfCacheNotProvisioned(err) || interactive) return direct(null)
      throw err
    }
    if (!claim?.ok) throw new PdfCacheError(reasonMessage(claim?.reason), claim?.reason)

    if (claim.state === 'ready') {
      onStatus('ready')
      return { file: claim.file, blob: null, fileName: claim.file.file_name || fileName, cached: true, stored: true, note: null }
    }
    if (claim.state === 'processing') {
      // Somebody else is generating this exact revision. Wait for their file instead of making a second one.
      onStatus('waiting')
      let ready = null
      while (Date.now() < deadline) {
        await sleep(POLL_MS)
        const again = await api.lookupPdf(req).catch(() => null)
        if (again?.ok && again.state === 'ready') { ready = again.file; break }
        if (again?.ok && again.state !== 'processing') break    // released, failed or expired: try to claim
      }
      if (ready) {
        onStatus('ready')
        return { file: ready, blob: null, fileName: ready.file_name || fileName, cached: true, stored: true, note: null }
      }
      if (Date.now() >= deadline) {
        if (!interactive) throw new PdfCacheError('The report is still being prepared.', 'processing')
        return direct('Another person is still preparing this report, so a separate copy was prepared for you.')
      }
      continue
    }
    if (claim.state !== 'claimed') {
      // failed / retry_scheduled for a background caller
      throw new PdfCacheError('The report could not be prepared earlier and will be retried later.', claim.state)
    }

    // This browser is the generator.
    const fileId = claim.file_id
    const beat = setInterval(() => { api.heartbeatPdf(fileId, LEASE_SECONDS).catch(() => {}) }, 60_000)
    try {
      onStatus('generating')
      let g
      try { g = await runGenerator(generate) }
      catch (err) {
        await api.failPdf(fileId, { error: 'generator_error', retryable: true }).catch(() => {})
        throw err
      }
      if (g.warnings.length) {
        // An incomplete document (for example a photo that would not load) must never
        // become the stored copy. Hand it to the person, release the job, store nothing.
        await api.failPdf(fileId, { error: 'evidence_incomplete', retryable: true, countAttempt: false }).catch(() => {})
        return { file: null, blob: g.blob, fileName: g.fileName || fileName, cached: false, stored: false,
          note: 'Some photos could not be loaded, so this copy was not saved for reuse. Download again to retry.' }
      }
      onStatus('saving')
      try {
        const sha256 = await sha256HexOfBytes(g.blob)
        await api.uploadPdf(claim.path, g.blob)
        const done = await api.completePdf(fileId, { sha256, bytes: g.blob.size })
        if (!done?.ok) throw new PdfCacheError(reasonMessage(done?.reason), done?.reason)
        onStatus('ready')
        return {
          file: { id: fileId, bucket: claim.bucket, path: claim.path, file_name: claim.file_name, bytes: g.blob.size,
            sha256, generation: claim.generation, immutable: !!done.immutable },
          blob: g.blob, fileName: g.fileName || claim.file_name || fileName, cached: false, stored: true, note: null,
        }
      } catch (err) {
        await api.failPdf(fileId, { error: err?.reason || 'store_error', retryable: true }).catch(() => {})
        // The document itself is fine. Do not make the person wait for storage.
        return { file: null, blob: g.blob, fileName: g.fileName || fileName, cached: false, stored: false,
          note: 'The report was prepared but could not be saved for reuse. It will be prepared again next time.' }
      }
    } finally {
      clearInterval(beat)
    }
  }
}

/**
 * Give the result of getOrCreatePdf to the person.
 * A stored file starts downloading from a short-lived signed link (no bytes pass through
 * this page); a file generated just now is saved from memory.
 */
export async function deliverPdf(result, { via = 'single' } = {}) {
  if (result.blob) {
    saveBlob(result.blob, result.fileName)
  } else if (result.file) {
    const url = await api.signedPdfUrl(result.file.path, { downloadName: result.file.file_name || result.fileName })
    navigateDownload(url)
  }
  if (result.file?.id) api.recordPdfDownload(result.file.id, via)
}

/** Open a stored file in a new tab (View PDF). Returns false when there is nothing stored to open. */
export async function viewStoredPdf(file) {
  if (!file?.path) return false
  const url = await api.signedPdfUrl(file.path)
  window.open(url, '_blank', 'noopener,noreferrer')
  if (file.id) api.recordPdfDownload(file.id, 'view')
  return true
}

/** Stored bytes with the checksum verified. Throws when the file does not match its recorded sha256. */
export async function fetchVerifiedPdf(file) {
  const blob = await api.downloadPdfBytes(file.path)
  if (file.sha256) {
    const actual = await sha256HexOfBytes(blob)
    if (actual !== file.sha256) throw new PdfCacheError('The stored report failed its integrity check.', 'checksum_mismatch')
  }
  return blob
}

/**
 * Bulk download gate. The server enforces the company's limit and answers with the records
 * this account may see; anything else is listed as missing in the manifest and never requested.
 * Returns { limit, allowed } where allowed is null when the server path is not set up yet.
 */
export async function authorizeBulk(type, sourceIds, fallbackLimit) {
  const ids = [...new Set((sourceIds || []).map(String))]
  const res = await api.requestBulkPdf(type, ids)
  if (res === null) return { limit: fallbackLimit, allowed: null }
  if (!res.ok) {
    const msg = res.reason === 'over_limit' && res.limit
      ? `Up to ${res.limit} reports can be downloaded at once. Select fewer records and download again.`
      : reasonMessage(res.reason)
    throw new PdfCacheError(msg, res.reason)
  }
  return { limit: res.limit, allowed: new Set((res.allowed || []).map(String)) }
}

/**
 * Retention housekeeping, run quietly in an administrator's browser. The database only MARKS
 * working copies whose retention time is up; this removes those objects through the Storage API
 * (the storage policy refuses anything unmarked or approved) and records each purge.
 * Never throws. Returns the number of copies purged.
 */
export async function sweepPdfRetention(limit = 20) {
  try {
    const due = await api.listPdfPurgeDue(limit)
    if (!due.length) return 0
    await api.removePdfObjects(due.map((d) => d.path)).catch(() => [])
    let purged = 0
    for (const d of due) {
      const r = await api.confirmPdfPurge(d.id)   // refuses while the object still exists
      if (r?.ok) purged += 1
    }
    return purged
  } catch { return 0 }
}
