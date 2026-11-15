// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import JSZip from 'jszip'

vi.mock('../lib/api/pdfCache', () => ({
  PDF_BUCKET: 'report-pdfs',
  isPdfCacheNotProvisioned: () => false,
  downloadPdfBytes: vi.fn(async (path) => new Blob([`stored:${path}`], { type: 'application/pdf' })),
  recordPdfDownload: vi.fn(async () => null),
  signedPdfUrl: vi.fn(),
}))

import { buildPdfZip } from '../lib/pdfCache/bulkZip'
import { sha256HexOfBytes } from '../lib/pdfCache/cacheKey'

const stored = async (path, name, extra = {}) => ({
  cached: true, stored: true, blob: null, fileName: name, note: null,
  file: { id: `id-${path}`, path, file_name: name, sha256: await sha256HexOfBytes(new Blob([`stored:${path}`])), generation: 1, immutable: true, cache_key: `key-${path}`, ...extra },
})

describe('bulk PDF ZIP', () => {
  it('includes stored and freshly generated reports, and lists every missing record with its reason', async () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ sourceId: id, label: `TM-${id}` }))
    let active = 0, peak = 0
    const ensure = vi.fn(async (item) => {
      active += 1; peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active -= 1
      if (item.sourceId === 'a') return stored('p/a.pdf', 'Tyre Insp TM400 EAST 10-Nov-26.pdf')
      if (item.sourceId === 'b') return stored('p/b.pdf', 'Tyre Insp TM400 EAST 10-Nov-26.pdf')        // same name as a
      if (item.sourceId === 'c') return { cached: false, stored: false, blob: new Blob(['fresh']), fileName: 'Tyre Insp TM401.pdf', file: null, note: 'Some photos could not be loaded, so this copy was not saved for reuse.' }
      if (item.sourceId === 'd') return stored('p/d.pdf', 'Tyre Insp TM402.pdf', { sha256: 'f'.repeat(64) })     // corrupt in storage
      throw new Error('This report is not available to your account, or the record no longer exists.')
    })
    const progress = []
    const out = await buildPdfZip({ type: 'tyre_inspection', items, ensure, onProgress: (p) => progress.push(p), now: new Date('2026-11-15T10:00:00Z') })

    expect(peak).toBeLessThanOrEqual(2)                    // bounded concurrency
    expect(out).toMatchObject({ included: 3, missing: 2 })
    const zip = await JSZip.loadAsync(await out.blob.arrayBuffer())
    const names = Object.keys(zip.files).sort()
    expect(names).toEqual(['Tyre Insp TM400 EAST 10-Nov-26 (2).pdf', 'Tyre Insp TM400 EAST 10-Nov-26.pdf', 'Tyre Insp TM401.pdf', 'manifest.csv', 'manifest.json'])
    expect(await zip.file('Tyre Insp TM401.pdf').async('string')).toBe('fresh')

    const manifest = JSON.parse(await zip.file('manifest.json').async('string'))
    expect(manifest).toMatchObject({ report_type: 'tyre_inspection', selected: 5, included: 3, missing: 2 })
    expect(manifest.reports.map((r) => [r.source_id, r.status])).toEqual([['a', 'included'], ['b', 'included'], ['c', 'included'], ['d', 'missing'], ['e', 'missing']])
    expect(manifest.reports[0]).toMatchObject({ revision: 'key-p/a.pdf', approved_revision: 'yes', origin: 'stored' })
    expect(manifest.reports[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.reports[2]).toMatchObject({ origin: 'generated, not stored' })
    expect(manifest.reports[2].reason).toMatch(/photos/)
    expect(manifest.reports[3].reason).toMatch(/integrity check/)
    expect(manifest.reports[4].reason).toMatch(/not available/)

    const csv = await zip.file('manifest.csv').async('string')
    expect(csv.split('\r\n')[0]).toBe('record,source_id,status,file_name,reason,revision,generation,approved_revision,sha256,bytes,origin')
    expect(csv.trim().split('\r\n')).toHaveLength(6)        // header + all five records, none dropped
    expect(progress.at(-1)).toMatchObject({ phase: 'zip', done: 5, total: 5 })
  })

  it('records over the limit are listed as missing, not dropped', async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ sourceId: `s${i}`, label: `R${i}` }))
    const ensure = vi.fn(async (item) => ({ cached: false, stored: true, blob: new Blob([item.sourceId]), fileName: `${item.sourceId}.pdf`, file: null }))
    const out = await buildPdfZip({ type: 'tyre_inspection', items, ensure, limit: 10 })
    expect(ensure).toHaveBeenCalledTimes(10)
    expect(out).toMatchObject({ included: 10, missing: 2 })
    expect(out.manifest.reports).toHaveLength(12)
    expect(out.manifest.reports[11].reason).toMatch(/Over the limit of 10/)
  })

  it('a cancelled download lists the rest as missing', async () => {
    let cancelled = false
    const items = Array.from({ length: 6 }, (_, i) => ({ sourceId: `s${i}` }))
    const ensure = vi.fn(async (item) => { if (item.sourceId === 's1') cancelled = true; return { blob: new Blob(['x']), fileName: `${item.sourceId}.pdf`, cached: false, stored: true } })
    const out = await buildPdfZip({ type: 'tyre_inspection', items, ensure, isCancelled: () => cancelled, concurrency: 1 })
    expect(out.included).toBe(2)
    expect(out.manifest.reports.filter((r) => r.reason === 'The download was cancelled.')).toHaveLength(4)
  })
})
