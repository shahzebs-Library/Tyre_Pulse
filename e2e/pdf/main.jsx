/**
 * PDF timing harness page. Exposes window.__h for the Playwright driver (run.mjs).
 * It mounts the REAL useInspectionPdfRenderer hook, so each generation goes through the
 * same off-screen diagram capture and the same exportInspectionDetailPdf as the app.
 */
import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import { useInspectionPdfRenderer } from '../../src/components/inspections/useInspectionPdfRenderer'
import InspectionDiagram from '../../src/components/inspection/InspectionDiagram'
import { getOrCreatePdf, fetchVerifiedPdf } from '../../src/lib/pdfCache/service'
import { inspectionPdfRequest, observationPdfRequest, clearRequestMemo } from '../../src/lib/pdfCache/reportRequests'
import { sha256HexOfBytes } from '../../src/lib/pdfCache/cacheKey'
import { buildPdfZip } from '../../src/lib/pdfCache/bulkZip'
import { shrinkImageForPdf } from '../../src/lib/pdfImage'
import { exportInspectionDetailPdf } from '../../src/lib/exportUtils'
import { downloadObservationReport } from '../../src/lib/observationReportPdf'
import * as pdfApi from '../../src/lib/api/pdfCache'
import { fake } from './fakeSupabase'

const SIG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><path d="M10 70 C 60 10, 90 90, 140 40 S 220 80, 290 30" fill="none" stroke="#111" stroke-width="3"/></svg>'
const SLOTS = { 4: ['FL', 'FR', 'RL', 'RR'], 12: ['F1L', 'F1R', 'F2L', 'F2R', 'R1Lo', 'R1Li', 'R1Ri', 'R1Ro', 'R2Lo', 'R2Li', 'R2Ri', 'R2Ro'] }

/** A synthetic inspection with n tyre photos (4, 12 or 14). */
export function syntheticInspection(n, id = '11111111-2222-4333-8444-000000000000') {
  const type = n <= 4 ? 'PICKUP' : n <= 12 ? 'TR-MIXER' : 'PUMPS'
  const tc = {}
  for (let i = 0; i < n; i++) {
    const pos = (SLOTS[n <= 4 ? 4 : 12][i]) || `P${i + 1}`
    tc[pos] = { checked: true, position: pos, condition: i % 5 === 0 ? 'Worn' : i % 7 === 0 ? 'Damaged' : 'Good',
      pressure_psi: 100 + (i % 9), tread_mm: 9 - (i % 4), photo_url: `tp-storage://tyre-photos/synthetic/photo_${(i % 14) + 1}.jpg` }
  }
  return {
    id: id.slice(0, -2) + String(n).padStart(2, '0'), title: 'Synthetic inspection', asset_no: `SYN${n}`, site: 'SYNTHETIC YARD', country: 'KSA',
    vehicle_type: type, inspection_type: 'Tyre Inspection', inspection_date: '2026-11-10', status: 'Done', approval_status: 'approved',
    approved_at: '2026-11-11T08:00:00Z', inspector: 'Synthetic Tyreman', inspector_signature: SIG, approver_signature: SIG,
    odometer_km: 123456, hour_meter: 4321, findings: 'Steer axle wear noted.', notes: 'Synthetic record for timing only.',
    tyre_conditions: tc,
  }
}

function findingsFor(row) {
  return Object.entries(row.tyre_conditions).filter(([, d]) => d.condition !== 'Good').map(([pos, d], i) => ({
    key: `${row.id}:${pos}`, kind: 'tyre', position: pos, rawPosition: pos, text: `${d.condition} tyre`, severity: i % 2 ? 'High' : 'Medium',
    tone: i % 2 ? 'bad' : 'warn', pressure: d.pressure_psi, tread: d.tread_mm, remarks: 'Synthetic remark', photo: d.photo_url,
    tyreNow: { state: 'on_vehicle' }, actionRecord: null, row,
  }))
}

const api = {}
function Harness() {
  const { render, hosts } = useInspectionPdfRenderer({ branding: null, company: 'Synthetic Fleet Co' })
  const [obsRow, setObsRow] = React.useState(null)
  const obsRef = React.useRef(null)
  useEffect(() => {
    api.render = render
    api.mountObs = (row) => new Promise((r) => { setObsRow(row); setTimeout(() => r(obsRef.current), 150) })
    window.__ready = true
  }, [render])
  return (<div>{hosts}<div ref={obsRef} style={{ position: 'fixed', left: -9999, top: 0 }}>{obsRow && <InspectionDiagram inspection={obsRow} width={360} showReadings={false} variant="board" />}</div></div>)
}
createRoot(document.getElementById('root')).render(<Harness />)

// ---- instrumentation: time spent downloading photos (request start to body read)
const net = { ms: 0, n: 0, bytes: 0 }
const realFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  if (!/\/photos\//.test(url)) return realFetch(input, init)
  const t0 = performance.now()
  const res = await realFetch(input, init)
  const blob = await res.blob()
  net.ms += performance.now() - t0; net.n += 1; net.bytes += blob.size
  return new Response(blob, { status: res.status, headers: res.headers })
}
const resetNet = () => { net.ms = 0; net.n = 0; net.bytes = 0 }
const ms = (t0) => Math.round(performance.now() - t0)

window.__h = {
  fake,
  /** Cold cost of loading the PDF libraries (first call in a fresh page only). */
  async libLoad() { const t0 = performance.now(); await Promise.all([import('jspdf'), import('jspdf-autotable'), import('qrcode')]); return ms(t0) },
  /** Decode + resize cost of n photos on their own (the same shrink the generator uses). */
  async shrinkOnly(n) {
    const urls = Array.from({ length: n }, (_, i) => `/photos/photo_${(i % 14) + 1}.jpg`)
    const datas = await Promise.all(urls.map(async (u) => { const b = await (await realFetch(u)).blob(); return new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b) }) }))
    const t0 = performance.now()
    for (const d of datas) await shrinkImageForPdf(d, 'JPEG')
    return ms(t0)
  },
  /** One full generation through the real hook. */
  async generate(n) {
    resetNet()
    const t0 = performance.now()
    const out = await api.render(syntheticInspection(n))
    const total = ms(t0)
    const tOut = performance.now(); const sha = await sha256HexOfBytes(out.bytes); const hashMs = ms(tOut)
    return { photos: n, totalMs: total, photoDownloadMs: Math.round(net.ms), photoRequests: net.n, photoBytes: net.bytes, pdfBytes: out.bytes.byteLength, warnings: out.warnings, sha256Ms: hashMs, sha }
  },
  /** First download (miss -> generate -> store) versus repeat (hit) through getOrCreatePdf. */
  async flow(n, latency) {
    fake.reset(); fake.latency = latency; clearRequestMemo()
    const row = syntheticInspection(n)
    const run = async () => {
      fake.calls = []
      const t0 = performance.now()
      const req = await inspectionPdfRequest(row, { branding: null, company: 'Synthetic Fleet Co' })
      const r = await getOrCreatePdf({ ...req, generate: () => api.render(row) })
      let url = null
      if (!r.blob) url = await pdfApi.signedPdfUrl(r.file.path, { downloadName: r.file.file_name })   // what deliverPdf does before the browser starts the download
      return { ms: ms(t0), cached: r.cached, stored: r.stored, note: r.note, calls: [...fake.calls], hasUrl: !!url, file: r.file }
    }
    const first = await run()
    const second = await run()
    const third = await run()
    const verified = await fetchVerifiedPdf(second.file).then((b) => b.size).catch((e) => String(e.message))
    return { photos: n, latency, first, second, third, verifiedBytes: verified }
  },
  /** Two people press Download for the same inspection at the same moment. */
  async concurrent(n, latency) {
    fake.reset(); fake.latency = latency; clearRequestMemo()
    const row = syntheticInspection(n)
    const req = await inspectionPdfRequest(row, { branding: null, company: 'Synthetic Fleet Co' })
    let gens = 0
    const one = (user) => { fake.user = user; return getOrCreatePdf({ ...req, generate: () => { gens += 1; return api.render(row) }, waitMs: 60000 }) }
    const a = one('user-1')
    await new Promise((r) => setTimeout(r, latency * 2 + 30))
    const b = one('user-2')
    const [ra, rb] = await Promise.all([a, b])
    return { generations: gens, a: { cached: ra.cached, stored: ra.stored }, b: { cached: rb.cached, stored: rb.stored }, rows: fake.rows.size }
  },
  /** Bulk ZIP of `count` inspections of which `storedCount` are already stored. */
  async bulk(count, storedCount, latency) {
    fake.reset(); fake.latency = latency; clearRequestMemo()
    const rows = Array.from({ length: count }, (_, i) => ({ ...syntheticInspection(4), id: `22222222-2222-4333-8444-${String(i).padStart(12, '0')}`, asset_no: `SYN${i}` }))
    const ensure = async (row) => { const req = await inspectionPdfRequest(row, { branding: null, company: 'Synthetic Fleet Co' }); return getOrCreatePdf({ ...req, generate: () => api.render(row) }) }
    for (const row of rows.slice(0, storedCount)) await ensure(row)
    const t0 = performance.now()
    const out = await buildPdfZip({ type: 'tyre_inspection', items: rows.map((row) => ({ sourceId: row.id, label: row.asset_no, row })), ensure: (item) => ensure(item.row), limit: 100 })
    return { count, storedCount, ms: ms(t0), zipBytes: out.blob.size, included: out.included, missing: out.missing }
  },
  /** Bytes of the observation report through the current generator (save: false). */
  async observation(n) {
    const row = syntheticInspection(n)
    const host = await api.mountObs(row)
    resetNet()
    const t0 = performance.now()
    const warnings = []
    const doc = await downloadObservationReport(row, findingsFor(row), { svgEl: host?.querySelector('svg[data-tyre-map]') || host?.querySelector('svg'), save: false, warnings })
    const bytes = doc.output('arraybuffer')
    const req = await observationPdfRequest(row, findingsFor(row))
    return { photos: findingsFor(row).length, totalMs: ms(t0), photoDownloadMs: Math.round(net.ms), pdfBytes: bytes.byteLength, warnings, bytes: Array.from(new Uint8Array(bytes)), clientRev: req.clientRev }
  },
  /** Inspection report bytes with and without the new options, for the layout-unchanged proof. */
  async inspectionBytes(n, withWarnings) {
    const row = syntheticInspection(n)
    const photos = Object.entries(row.tyre_conditions).map(([pos]) => ({ label: pos, url: `/photos/photo_${(Object.keys(row.tyre_conditions).indexOf(pos) % 14) + 1}.jpg` }))
    const opts = { company: 'Synthetic Fleet Co', photos, lifeRows: [], save: false }
    if (withWarnings) opts.warnings = []
    const doc = await exportInspectionDetailPdf(row, opts)
    return Array.from(new Uint8Array(doc.output('arraybuffer')))
  },
  /** The observation report as the ORIGINAL code path saved it (doc.save intercepted). */
  async observationSaved(n) {
    const { default: JsPdf } = await import('jspdf')
    const row = syntheticInspection(n)
    const host = await api.mountObs(row)
    const realSave = JsPdf.API.save
    let saved = null, name = null
    JsPdf.API.save = function (fileName) { saved = this.output('arraybuffer'); name = fileName; return this }
    try { await downloadObservationReport(row, findingsFor(row), { svgEl: host?.querySelector('svg[data-tyre-map]') || host?.querySelector('svg') }) }
    finally { JsPdf.API.save = realSave }
    return { name, bytes: Array.from(new Uint8Array(saved)) }
  },
}
