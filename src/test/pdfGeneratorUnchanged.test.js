/**
 * Caching must not change the approved inspection report. The only edit inside the
 * generator is a caller-side list of evidence that could not be embedded; this proves the
 * drawn document is the same with and without it (real jsPDF, no mocks). The browser
 * harness (e2e/pdf/run.mjs) repeats the comparison with photos, the live diagram and the
 * observation report, page by page.
 */
import { describe, it, expect } from 'vitest'
import { inflateSync } from 'node:zlib'
import { exportInspectionDetailPdf } from '../lib/exportUtils'

const streams = (doc) => {
  const raw = doc.output()
  const parts = []
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { parts.push(inflateSync(Buffer.from(m[1], 'binary')).toString('latin1')) } catch { parts.push(`raw:${m[1].length}`) }
  }
  return parts
}

const ROW = {
  id: '11111111-2222-4333-8444-555555555555', title: 'Synthetic', vehicle_type: 'TR-MIXER', asset_no: 'SYN12', site: 'SYNTHETIC YARD',
  inspection_date: '2026-11-10', status: 'Done', approval_status: 'approved', approved_at: '2026-11-11T08:00:00Z',
  inspector: 'Synthetic Tyreman', odometer_km: 123456, findings: 'Steer axle wear noted.',
  tyre_conditions: { F1L: { condition: 'Worn', pressure_psi: 101, tread_mm: 6 }, F1R: { condition: 'Good', pressure_psi: 104 }, R1Lo: { condition: 'Damaged', pressure_psi: 80 } },
}

describe('inspection report generator is unchanged by caching', () => {
  it('draws the same content streams with and without the warnings list', async () => {
    const a = await exportInspectionDetailPdf(ROW, { save: false, company: 'Synthetic Fleet Co' })
    const warnings = []
    const b = await exportInspectionDetailPdf(ROW, { save: false, company: 'Synthetic Fleet Co', warnings })
    const sa = streams(a), sb = streams(b)
    expect(sa.length).toBeGreaterThan(1)
    expect(sb).toEqual(sa)
    expect(b.internal.getNumberOfPages()).toBe(a.internal.getNumberOfPages())
    expect(warnings).toEqual([])                          // nothing was missing, nothing is reported
  })

  it('reports a photo that could not be embedded, and still draws the page', async () => {
    const warnings = []
    const doc = await exportInspectionDetailPdf(ROW, {
      save: false, warnings, photos: [{ label: 'F1L', url: 'http://127.0.0.1:9/unreachable.jpg' }],
    })
    expect(warnings).toEqual(['photo_unavailable'])
    expect(streams(doc).join('\n')).toContain('Image unavailable')
  })

  it('returns bytes a cache can store', async () => {
    const doc = await exportInspectionDetailPdf(ROW, { save: false })
    const bytes = doc.output('arraybuffer')
    expect(bytes.byteLength).toBeGreaterThan(2000)
    expect(new TextDecoder('latin1').decode(new Uint8Array(bytes).slice(0, 5))).toBe('%PDF-')
  })
})
