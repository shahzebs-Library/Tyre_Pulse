/**
 * Builds the cache request (type, source, branding revision, client revision, file
 * name) for the two wired reports. The file name follows the existing conventions and
 * is never part of the key.
 */
import { brandingForPdf } from '../inspectionChecklistReport'
import { getDiagramBg } from '../api/brandLogo'
import { inspectionReportFileNameForRow } from '../inspectionFileName'
import { observationReportFileName } from '../observationReportPdf'
import { brandingRevision, clientRevision } from './cacheKey'
import { REPORT_TYPES } from './templates'

const MEMO_MS = 5 * 60 * 1000
const memo = new Map()

async function memoised(key, build) {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value
  const value = await build()
  memo.set(key, { at: Date.now(), value })
  return value
}

/** Test hook. */
export function clearRequestMemo() { memo.clear() }

const brandKey = (branding, company) => [branding?.logo_url || '', branding?.accent_color || branding?.primary_color || '',
  branding?.footer_text || '', company || ''].join('|')

/** Inspection report: tenant branding (with the console logo fallback), company name, diagram background. */
export function inspectionBrandingRev({ branding, company }) {
  return memoised('ins|' + brandKey(branding, company), async () => brandingRevision({
    branding: await brandingForPdf(branding), company,
    diagramBg: (await getDiagramBg().catch(() => '')) || '#000000',
  }))
}

/** Observation report: it is drawn with the console logo only (no tenant branding is passed to it). */
export function observationBrandingRev() {
  return memoised('obs', async () => brandingRevision({ branding: await brandingForPdf(null) }))
}

export async function inspectionPdfRequest(row, { branding, company }) {
  return {
    type: REPORT_TYPES.INSPECTION, sourceId: row.id, clientRev: '',
    brandingRev: await inspectionBrandingRev({ branding, company }),
    fileName: inspectionReportFileNameForRow(row),
  }
}

/** What the browser derives and prints in the observation report, reduced to a revision. */
export function observationClientDoc(findings = []) {
  return findings.map((f) => ({
    key: f.key ?? null, kind: f.kind ?? null, position: f.position ?? null, text: f.text ?? null,
    severity: f.severity ?? null, tone: f.tone ?? null, pressure: f.pressure ?? null, tread: f.tread ?? null,
    remarks: f.remarks ?? null, photo: f.photo ?? null, tyreNow: f.tyreNow?.state ?? null,
    action: f.actionRecord ? [f.actionRecord.id, f.actionRecord.status ?? null] : null,
  }))
}

export async function observationPdfRequest(inspection, findings) {
  return {
    type: REPORT_TYPES.OBSERVATION, sourceId: inspection.id,
    clientRev: await clientRevision(observationClientDoc(findings)),
    brandingRev: await observationBrandingRev(),
    fileName: observationReportFileName(inspection),
  }
}
