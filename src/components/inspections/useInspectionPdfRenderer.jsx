/**
 * Draws the approved Vehicle Tyres Inspection Report for one inspection and returns
 * its bytes.
 *
 * This is the SAME sequence the inspections page ran inside an effect: mount the live
 * tyre map and the Vehicle Overview board off screen, gather photos, expected life,
 * AI findings, the inspection ordinal and the signer names, then call
 * exportInspectionDetailPdf. Nothing about the document changed. The only differences:
 *   - the generator is asked not to save (`save: false`) and its bytes are returned, so
 *     the PDF cache can store them and a bulk export can zip them;
 *   - more than one inspection can be drawn at a time (each job has its own off-screen
 *     host), which the bulk export uses with a bound of two.
 *
 * `warnings` lists evidence that could not be loaded. A document with warnings is still
 * handed to the person but is never stored as the reusable copy.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import InspectionDiagram from '../inspection/InspectionDiagram'
import * as inspectionsApi from '../../lib/api/inspections'
import { readInspectionAnalysis } from '../../lib/api/aiTyreInspection'
import { exportInspectionDetailPdf } from '../../lib/exportUtils'
import { brandingForPdf } from '../../lib/inspectionChecklistReport'
import { displayPositionCode, inspectionTypeHint } from '../../lib/tyreBay'
import { positionLabelMap } from '../../lib/inspectionView'
import { resolveStorageUrl } from '../../lib/storageRefs'
import { getTyreRunningLife } from '../../lib/api/tyreRunningLife'
import { shapeRunningLife } from '../../lib/tyreRunningLife'
import { resolveInspectionSigners } from '../../lib/api/profileDirectory'
import { getDiagramBg } from '../../lib/api/brandLogo'
import { vehiclePhoto } from '../../lib/vehiclePhoto'
import { inspectionReportFileNameForRow } from '../../lib/inspectionFileName'

const RUNNING_LIFE_TTL_MS = 120000
let seq = 0

async function drawInspectionPdf(row, { branding, company, host }) {
  const warnings = []
  // Photos captured during the inspection: per-position tp-storage refs (mobile) + the
  // row-level photo, resolved to signed URLs.
  const photoRefs = []
  // The SAME labels the on-screen photo grid prints (positionLabelMap), so the downloaded
  // copy and the record on screen cannot name one wheel two different ways.
  const posLabels = positionLabelMap(row)
  // Array-shaped tyre_conditions (web checklist) key by index; use the entry's own
  // position so a photo is never captioned "0", "1"...
  const tcEntries = Array.isArray(row.tyre_conditions)
    ? row.tyre_conditions.map((d) => [d && (d.position || d.label) ? String(d.position || d.label) : '', d])
    : Object.entries(row.tyre_conditions || {})
  for (const [pos, d] of tcEntries) {
    const ref = d && typeof d === 'object' ? (d.photo_url || d.photo_uri) : null
    if (ref) photoRefs.push({ label: posLabels[pos] || displayPositionCode(inspectionTypeHint(row), pos) || pos || 'Tyre photo', ref })
  }
  if (row.photo_data) photoRefs.push({ label: 'Inspection photo', ref: row.photo_data })
  const photos = (await Promise.all(photoRefs.map(async (p) => {
    try { const url = await resolveStorageUrl(p.ref); return url ? { label: p.label, url } : null }
    catch { return null }
  }))).filter(Boolean)
  if (photos.length < photoRefs.length) warnings.push('photo_unresolved')

  // Expected life for this asset's fitted tyres (best-effort), asked for BY ASSET.
  let lifeRows = []
  if (row.asset_no) {
    try {
      const payload = await getTyreRunningLife({ country: row.country, maxAgeMs: RUNNING_LIFE_TTL_MS, asset: row.asset_no })
      lifeRows = shapeRunningLife(payload).rows
    } catch { lifeRows = [] }
  }

  // The ACTUAL app diagram and the Vehicle Overview board, rendered off screen.
  const svgEl = host?.querySelector('[data-pdf-map] svg[data-tyre-map]') || null
  const boardEl = host?.querySelector('[data-pdf-board] .tb') || null
  const diagramBg = (await getDiagramBg().catch(() => '')) || '#000000'
  const aiJobs = await readInspectionAnalysis([row.id]).catch(() => [])
  // Counted on inspection_date only; a row without one gets no ordinal.
  const inspectionNo = await inspectionsApi.countAssetInspections(row.asset_no, {
    country: row.country, upTo: row.inspection_date,
  })
  // "Full Name (EMP-ID)" from the same profiles read the app uses everywhere.
  const signers = await resolveInspectionSigners({ approvedBy: row.approved_by, createdBy: row.created_by })
    .catch(() => undefined)

  const doc = await exportInspectionDetailPdf(row, {
    branding: await brandingForPdf(branding), company, photos, lifeRows, svgEl, boardEl, diagramBg, inspectionNo,
    vehiclePhotoUrl: vehiclePhoto(row), aiFindings: aiJobs.filter((j) => j.status === 'completed'),
    signers, save: false, warnings,
  })
  return { bytes: doc.output('arraybuffer'), fileName: inspectionReportFileNameForRow(row), warnings }
}

/**
 * @returns {{ render: (row: object) => Promise<{bytes: ArrayBuffer, fileName: string, warnings: string[]}>, hosts: JSX.Element, canRender: () => boolean }}
 * Render `hosts` once anywhere in the page. `canRender()` is false once that page is gone.
 */
export function useInspectionPdfRenderer({ branding, company }) {
  const [jobs, setJobs] = useState([])
  const started = useRef(new Set())
  const hostEls = useRef(new Map())
  const ctx = useRef({ branding, company })
  ctx.current = { branding, company }
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const render = useCallback((row) => new Promise((resolve, reject) => {
    if (!row?.id) { reject(new Error('A saved inspection is required.')); return }
    if (!alive.current) { reject(new Error('The page was closed before this report could be prepared.')); return }
    seq += 1
    setJobs((list) => [...list, { key: `pdfjob-${seq}`, row, resolve, reject }])
  }), [])

  useEffect(() => {
    for (const job of jobs) {
      if (started.current.has(job.key)) continue
      started.current.add(job.key)
      // one frame for the off-screen diagrams to mount and lay out before capture
      setTimeout(async () => {
        try {
          job.resolve(await drawInspectionPdf(job.row, { ...ctx.current, host: hostEls.current.get(job.key) || null }))
        } catch (err) { job.reject(err) }
        finally {
          started.current.delete(job.key)
          hostEls.current.delete(job.key)
          if (alive.current) setJobs((list) => list.filter((j) => j.key !== job.key))
        }
      }, 80)
    }
  }, [jobs])

  // A page that goes away must not leave callers waiting for ever.
  const jobsRef = useRef(jobs)
  jobsRef.current = jobs
  useEffect(() => () => {
    for (const job of jobsRef.current) {
      if (!started.current.has(job.key)) job.reject(new Error('The page was closed before this report could be prepared.'))
    }
  }, [])

  const hosts = jobs.map((job) => (
    <div
      key={job.key}
      ref={(el) => { if (el) hostEls.current.set(job.key, el) }}
      aria-hidden
      style={{ position: 'fixed', left: -9999, top: 0, width: 520, opacity: 0, pointerEvents: 'none' }}
    >
      <div data-pdf-map style={{ width: 360 }}>
        <InspectionDiagram inspection={job.row} showReadings={false} width={340} />
      </div>
      {/* 440px: the narrowest width that keeps twin wheels side by side, so the
          vehicle picture stays a supporting element, not the biggest thing. */}
      <div data-pdf-board>
        <InspectionDiagram inspection={job.row} showReadings={false} width={440} variant="board" />
      </div>
    </div>
  ))

  const canRender = useCallback(() => alive.current, [])
  return { render, hosts, canRender }
}
