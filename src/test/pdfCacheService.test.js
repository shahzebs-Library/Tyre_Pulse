// @vitest-environment node
/**
 * getOrCreatePdf against an in-memory stand-in for the database functions. The stand-in
 * follows the same rules as the SQL draft (one current row per key, one generator, lease,
 * bounded retries); the SQL itself is tested on the staging database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const backend = vi.hoisted(() => {
  const b = {
    provisioned: true, rows: new Map(), objects: new Map(), events: [], user: 'u1', sourceRev: 'r1', seq: 0,
    key: (req) => [req.type, req.sourceId, req.template, req.brandingRev, req.clientRev || '', b.sourceRev].join('|'),
    reset() { b.provisioned = true; b.rows.clear(); b.objects.clear(); b.events = []; b.user = 'u1'; b.sourceRev = 'r1'; b.seq = 0; b.failUpload = false; b.refuse = null },
  }
  return b
})

vi.mock('../lib/api/pdfCache', () => {
  const np = () => { const e = new Error('not set up'); e.code = 'PDF_CACHE_NOT_PROVISIONED'; return e }
  const fileOf = (r) => ({ id: r.id, bucket: 'report-pdfs', path: r.path, file_name: r.file_name, bytes: r.bytes, sha256: r.sha256, generation: 1, immutable: false })
  return {
    PDF_BUCKET: 'report-pdfs',
    isPdfCacheNotProvisioned: (e) => e?.code === 'PDF_CACHE_NOT_PROVISIONED',
    lookupPdf: vi.fn(async (req) => {
      if (!backend.provisioned) throw np()
      if (backend.refuse) return { ok: false, reason: backend.refuse }
      const r = backend.rows.get(backend.key(req))
      return { ok: true, state: r ? r.status : 'missing', cache_key: backend.key(req), file: r ? fileOf(r) : null, previous: null }
    }),
    claimPdf: vi.fn(async (req, { fileName, retry } = {}) => {
      if (!backend.provisioned) throw np()
      const k = backend.key(req)
      let r = backend.rows.get(k)
      if (!r) { r = { id: `f${++backend.seq}`, status: 'processing', owner: backend.user, path: `org/${req.type}/${req.sourceId}/${k}.pdf`, file_name: fileName, attempts: 0 }; backend.rows.set(k, r) }
      else if (r.status === 'ready') return { ok: true, state: 'ready', file: fileOf(r) }
      else if (r.status === 'processing' && r.owner !== backend.user) return { ok: true, state: 'processing', file_id: r.id }
      else if ((r.status === 'failed' || r.status === 'retry_scheduled') && !retry) return { ok: true, state: r.status, file_id: r.id }
      else { r.status = 'processing'; r.owner = backend.user }
      backend.events.push('claimed')
      return { ok: true, state: 'claimed', file_id: r.id, bucket: 'report-pdfs', path: r.path, file_name: r.file_name, generation: 1 }
    }),
    regeneratePdf: vi.fn(async (req, { fileName }) => {
      const k = backend.key(req)
      const r = { id: `f${++backend.seq}`, status: 'processing', owner: backend.user, path: `org/x/${k}.g2.pdf`, file_name: fileName, attempts: 0 }
      backend.rows.set(k, r); backend.events.push('regenerate_requested')
      return { ok: true, state: 'claimed', file_id: r.id, bucket: 'report-pdfs', path: r.path, file_name: r.file_name, generation: 2 }
    }),
    heartbeatPdf: vi.fn(async () => ({ ok: true })),
    uploadPdf: vi.fn(async (path, blob) => { if (backend.failUpload) throw new Error('storage down'); backend.objects.set(path, blob) }),
    completePdf: vi.fn(async (id, { sha256, bytes }) => {
      const r = [...backend.rows.values()].find((x) => x.id === id)
      if (!backend.objects.has(r.path)) return { ok: false, reason: 'file_missing' }
      if (backend.objects.get(r.path).size !== bytes) return { ok: false, reason: 'size_mismatch' }
      Object.assign(r, { status: 'ready', sha256, bytes }); backend.events.push('generated')
      return { ok: true, state: 'ready', file_id: id, current: true, immutable: false }
    }),
    failPdf: vi.fn(async (id, { countAttempt = true, error } = {}) => {
      const r = [...backend.rows.values()].find((x) => x.id === id)
      r.status = countAttempt ? 'retry_scheduled' : 'queued'; r.owner = null; r.last_error = error
      backend.events.push(countAttempt ? 'retry_scheduled' : 'released')
      return { ok: true, state: r.status }
    }),
    recordPdfDownload: vi.fn(async () => ({ ok: true })),
    signedPdfUrl: vi.fn(async (path) => `https://signed.example/${path}`),
    downloadPdfBytes: vi.fn(async (path) => backend.objects.get(path)),
  }
})

import * as api from '../lib/api/pdfCache'
import { getOrCreatePdf, fetchVerifiedPdf, PdfCacheError } from '../lib/pdfCache/service'
import { sha256HexOfBytes } from '../lib/pdfCache/cacheKey'

const REQ = { type: 'tyre_inspection', sourceId: 'src-1', brandingRev: 'b-1', fileName: 'Tyre Insp TM400.pdf' }
const pdf = (text = '%PDF-1.3 synthetic') => new TextEncoder().encode(text).buffer
const gen = (text) => vi.fn(async () => ({ bytes: pdf(text), fileName: 'Tyre Insp TM400.pdf', warnings: [] }))

beforeEach(() => { backend.reset(); vi.clearAllMocks() })

describe('getOrCreatePdf', () => {
  it('first request generates once, uploads and stores; the second is served from storage without generating', async () => {
    const generate = gen()
    const first = await getOrCreatePdf({ ...REQ, generate })
    expect(first).toMatchObject({ cached: false, stored: true, note: null })
    expect(first.blob.size).toBeGreaterThan(0)
    expect(first.file.sha256).toBe(await sha256HexOfBytes(pdf()))
    expect(generate).toHaveBeenCalledTimes(1)
    expect(api.uploadPdf).toHaveBeenCalledTimes(1)

    const second = await getOrCreatePdf({ ...REQ, generate })
    expect(second).toMatchObject({ cached: true, stored: true, blob: null })
    expect(second.file.path).toBe(first.file.path)
    expect(generate).toHaveBeenCalledTimes(1)            // no regeneration
    expect(api.claimPdf).toHaveBeenCalledTimes(1)         // the repeat needed one lookup and nothing else
    expect(api.uploadPdf).toHaveBeenCalledTimes(1)
  })

  it('two simultaneous requests produce one generation', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    const slow = vi.fn(async () => { await gate; return { bytes: pdf(), warnings: [] } })
    const other = gen('never used')
    const a = getOrCreatePdf({ ...REQ, generate: slow })
    await vi.waitFor(() => expect(slow).toHaveBeenCalled())
    backend.user = 'u2'
    const b = getOrCreatePdf({ ...REQ, generate: other, waitMs: 20_000 })
    await vi.waitFor(() => expect(api.claimPdf).toHaveBeenCalledTimes(2))     // the second person has been told to wait
    release()
    const [ra, rb] = await Promise.all([a, b])
    expect(ra).toMatchObject({ cached: false, stored: true })
    expect(rb).toMatchObject({ cached: true, stored: true })
    expect(other).not.toHaveBeenCalled()
    expect(backend.rows.size).toBe(1)
    expect(backend.events.filter((e) => e === 'generated')).toHaveLength(1)
  })

  it('a changed source is a new revision; the unchanged one stays served from storage', async () => {
    const generate = gen()
    await getOrCreatePdf({ ...REQ, generate })
    backend.sourceRev = 'r2'                              // the inspection was edited
    const again = await getOrCreatePdf({ ...REQ, generate })
    expect(again.cached).toBe(false)
    expect(generate).toHaveBeenCalledTimes(2)
    expect(backend.rows.size).toBe(2)
  })

  it('branding or client-derived content changes make a new revision', async () => {
    const generate = gen()
    await getOrCreatePdf({ ...REQ, generate })
    await getOrCreatePdf({ ...REQ, brandingRev: 'b-2', generate })
    await getOrCreatePdf({ ...REQ, clientRev: 'c-9', generate })
    expect(generate).toHaveBeenCalledTimes(3)
  })

  it('before the migration is applied it generates directly, exactly as before', async () => {
    backend.provisioned = false
    const generate = gen()
    const r = await getOrCreatePdf({ ...REQ, generate })
    expect(r).toMatchObject({ cached: false, stored: false, file: null, note: null })
    expect(r.blob.size).toBeGreaterThan(0)
    expect(api.claimPdf).not.toHaveBeenCalled()
    expect(api.uploadPdf).not.toHaveBeenCalled()
  })

  it('a refusal from the server is a plain message and nothing is generated', async () => {
    backend.refuse = 'not_available'
    const generate = gen()
    await expect(getOrCreatePdf({ ...REQ, generate })).rejects.toMatchObject({ name: 'PdfCacheError', reason: 'not_available' })
    await expect(getOrCreatePdf({ ...REQ, generate })).rejects.toThrow(/not available to your account/)
    expect(generate).not.toHaveBeenCalled()
  })

  it('a copy with missing evidence is handed over but never stored', async () => {
    const generate = vi.fn(async () => ({ bytes: pdf(), warnings: ['photo_unavailable'] }))
    const r = await getOrCreatePdf({ ...REQ, generate })
    expect(r).toMatchObject({ cached: false, stored: false, file: null })
    expect(r.note).toMatch(/not saved for reuse/)
    expect(api.uploadPdf).not.toHaveBeenCalled()
    expect(api.failPdf).toHaveBeenCalledWith('f1', expect.objectContaining({ countAttempt: false }))
    // next time, with the photo back, it is generated again and stored
    const ok = await getOrCreatePdf({ ...REQ, generate: gen() })
    expect(ok.stored).toBe(true)
  })

  it('a generator failure is recorded for retry and reported', async () => {
    const generate = vi.fn(async () => { throw new Error('canvas failed') })
    await expect(getOrCreatePdf({ ...REQ, generate })).rejects.toThrow('canvas failed')
    expect(api.failPdf).toHaveBeenCalledWith('f1', expect.objectContaining({ retryable: true }))
    // a person pressing the button again is allowed to retry at once
    const r = await getOrCreatePdf({ ...REQ, generate: gen() })
    expect(r.stored).toBe(true)
    // a background caller respects the backoff instead
    backend.reset()
    await expect(getOrCreatePdf({ ...REQ, generate })).rejects.toThrow()
    await expect(getOrCreatePdf({ ...REQ, generate: gen(), interactive: false })).rejects.toBeInstanceOf(PdfCacheError)
  })

  it('a storage failure still gives the person the report, and records the failed job', async () => {
    backend.failUpload = true
    const r = await getOrCreatePdf({ ...REQ, generate: gen() })
    expect(r).toMatchObject({ stored: false, cached: false })
    expect(r.blob.size).toBeGreaterThan(0)
    expect(r.note).toMatch(/could not be saved for reuse/)
    expect(backend.events).toContain('retry_scheduled')
  })

  it('regenerate makes a new generation even though one is stored', async () => {
    const generate = gen()
    await getOrCreatePdf({ ...REQ, generate })
    const r = await getOrCreatePdf({ ...REQ, generate, regenerate: true, reason: 'logo missing' })
    expect(r).toMatchObject({ cached: false, stored: true })
    expect(r.file.generation).toBe(2)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('a stored file that does not match its recorded sha256 is refused', async () => {
    const first = await getOrCreatePdf({ ...REQ, generate: gen() })
    await expect(fetchVerifiedPdf(first.file)).resolves.toBeInstanceOf(Blob)
    backend.objects.set(first.file.path, new Blob(['tampered']))
    await expect(fetchVerifiedPdf(first.file)).rejects.toMatchObject({ reason: 'checksum_mismatch' })
  })

  it('a caller that can no longer draw is served stored copies but never takes a job', async () => {
    const generate = gen()
    await getOrCreatePdf({ ...REQ, generate })
    const stored = await getOrCreatePdf({ ...REQ, generate, canGenerate: () => false })
    expect(stored.cached).toBe(true)
    await expect(getOrCreatePdf({ ...REQ, sourceId: 'src-2', generate, canGenerate: () => false })).rejects.toMatchObject({ reason: 'cannot_generate' })
    expect(api.claimPdf).toHaveBeenCalledTimes(1)          // only the very first request ever claimed
    expect(backend.rows.size).toBe(1)
  })

  it('reports each stage to the caller', async () => {
    const seen = []
    await getOrCreatePdf({ ...REQ, generate: gen(), onStatus: (s) => seen.push(s) })
    expect(seen).toEqual(['checking', 'generating', 'saving', 'ready'])
    seen.length = 0
    await getOrCreatePdf({ ...REQ, generate: gen(), onStatus: (s) => seen.push(s) })
    expect(seen).toEqual(['checking', 'ready'])
  })
})
