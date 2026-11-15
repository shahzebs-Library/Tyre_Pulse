// @vitest-environment node
/**
 * Merge gate for the stored-PDF branch: until the drafts 20261117090000 / 091000 / 093000
 * are applied (no report_pdf_files table, no report-pdfs bucket, no pdf_cache_* functions),
 * every PDF download must behave exactly as on main: generated in the browser, no error,
 * nothing stored, nothing queued.
 *
 * Unlike pdfCacheService.test.js this uses the REAL data-access module and the REAL
 * isNotProvisioned check. Only the Supabase client is replaced, answering every call with
 * the error PostgREST / Storage gives when the object does not exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sb = vi.hoisted(() => ({ code: '42P01', calls: [] }))

vi.mock('../lib/supabase', () => {
  const pgErr = () => ({ code: sb.code, message: `relation or function missing (${sb.code})`, details: null, hint: null })
  const query = () => {
    const q = {}
    for (const m of ['select', 'eq', 'is', 'order', 'limit']) q[m] = () => q
    q.then = (res, rej) => Promise.resolve({ data: null, error: pgErr() }).then(res, rej)
    return q
  }
  const bucketErr = () => ({ message: 'Bucket not found', statusCode: '404' })
  return {
    supabase: {
      rpc: vi.fn(async (name) => { sb.calls.push(['rpc', name]); return { data: null, error: pgErr() } }),
      from: vi.fn((t) => { sb.calls.push(['from', t]); return query() }),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async () => { sb.calls.push(['storage', 'upload']); return { data: null, error: bucketErr() } }),
          remove: vi.fn(async () => { sb.calls.push(['storage', 'remove']); return { data: null, error: bucketErr() } }),
          download: vi.fn(async () => { sb.calls.push(['storage', 'download']); return { data: null, error: bucketErr() } }),
          createSignedUrl: vi.fn(async () => { sb.calls.push(['storage', 'sign']); return { data: null, error: bucketErr() } }),
        })),
      },
    },
  }
})

import * as api from '../lib/api/pdfCache'
import { getOrCreatePdf, deliverPdf, authorizeBulk, sweepPdfRetention } from '../lib/pdfCache/service'

const CODES = ['42P01', 'PGRST205', 'PGRST202', '42883']
const req = { type: 'inspection', sourceId: 'a1', template: 'inspection@1', brandingRev: 'b', clientRev: '' }

beforeEach(() => { sb.calls = [] })

describe.each(CODES)('drafts not applied (%s)', (code) => {
  beforeEach(() => { sb.code = code })

  it('every throwing RPC wrapper raises the recognised not-provisioned error', async () => {
    const throwing = [
      () => api.lookupPdf(req),
      () => api.claimPdf(req, { fileName: 'x.pdf' }),
      () => api.heartbeatPdf('f1'),
      () => api.completePdf('f1', { sha256: 'a', bytes: 1 }),
      () => api.failPdf('f1'),
      () => api.regeneratePdf(req, { fileName: 'x.pdf', reason: 'r' }),
      () => api.updatePdfSettings({ bulkLimit: 50 }),
    ]
    for (const call of throwing) {
      const err = await call().then(() => null, (e) => e)
      expect(err).toBeTruthy()
      expect(api.isPdfCacheNotProvisioned(err)).toBe(true)
      expect(err.message).not.toMatch(/relation|function|42P01|PGRST/)
    }
  })

  it('every quiet wrapper degrades to its documented empty answer', async () => {
    expect(await api.recordPdfDownload('f1')).toBeNull()
    expect(await api.getPdfSettings()).toBeNull()
    expect(await api.requestBulkPdf('inspection', ['a1'])).toBeNull()
    expect(await api.listPdfPurgeDue()).toEqual([])
    expect(await api.confirmPdfPurge('f1')).toBeNull()
    expect(await api.listPendingPdfRequests('inspection')).toEqual([])
    expect(await api.closePdfRequest('inspection', 'a1')).toBeNull()
    expect(await api.listPdfVersions('inspection', 'a1')).toEqual([])
  })

  it('a single download is generated in the browser exactly once, nothing stored or queued', async () => {
    const generate = vi.fn(async () => ({ bytes: new Uint8Array([37, 80, 68, 70]), fileName: 'Inspection.pdf' }))
    const statuses = []
    const res = await getOrCreatePdf({ ...req, fileName: 'Inspection.pdf', generate, onStatus: (s) => statuses.push(s) })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(res).toMatchObject({ file: null, cached: false, stored: false, note: null, fileName: 'Inspection.pdf' })
    expect(res.blob.size).toBe(4)
    expect(statuses).toEqual(['checking', 'generating'])
    // Only the one lookup was attempted: no claim, no upload, no queue write.
    expect(sb.calls).toEqual([['rpc', 'pdf_cache_lookup']])
  })

  it('a background (non-interactive) caller also falls back silently', async () => {
    const generate = vi.fn(async () => ({ bytes: new Uint8Array([1]) }))
    const res = await getOrCreatePdf({ ...req, fileName: 'O.pdf', generate, interactive: false })
    expect(res.stored).toBe(false)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('bulk gate defers to the client-side limit and lets every record through', async () => {
    const gate = await authorizeBulk('inspection', ['a1', 'a2', 'a1'], 50)
    expect(gate).toEqual({ limit: 50, allowed: null })
  })

  it('retention sweep does nothing and never touches storage', async () => {
    expect(await sweepPdfRetention(20)).toBe(0)
    expect(sb.calls.some(([k]) => k === 'storage')).toBe(false)
  })
})

describe('missing bucket (tables present, storage not set up)', () => {
  it('upload error is recognised as not provisioned', async () => {
    const err = await api.uploadPdf('p.pdf', new Blob([new Uint8Array([1])])).then(() => null, (e) => e)
    expect(api.isPdfCacheNotProvisioned(err)).toBe(true)
  })
})

describe('deliverPdf after a fallback', () => {
  it('saves the in-memory file and asks for no signed link or audit row', async () => {
    const saved = []
    globalThis.URL.createObjectURL = () => 'blob:x'
    globalThis.URL.revokeObjectURL = () => {}
    globalThis.document = { createElement: () => ({ click() { saved.push(this.download) }, remove() {} }), body: { appendChild() {} } }
    try {
      await deliverPdf({ blob: new Blob([new Uint8Array([1])]), fileName: 'I.pdf', file: null })
    } finally { delete globalThis.document }
    expect(saved).toEqual(['I.pdf'])
    expect(sb.calls).toEqual([])
  })
})
