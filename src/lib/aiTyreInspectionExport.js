/**
 * Per-vehicle AI tyre inspection Excel export: pure row building + a thin writer.
 * Kept out of the page so column/value accuracy is unit-tested.
 */
import { describeSeries } from './tyreMeasurementEngine'

export const INSPECTION_EXPORT_COLUMNS = Object.freeze([
  ['vehicle', 'Vehicle'], ['site', 'Site / location'], ['date', 'Inspection date'],
  ['inspector', 'Inspector'], ['inspection_id', 'Inspection ID'],
  ['position', 'Tyre position (fleet map)'], ['internal_position', 'Stored slot ID'],
  ['condition', 'Inspector condition'], ['photos', 'Linked photograph count'],
  ['photo_references', 'Photo reference(s)'], ['ai_status', 'AI status'],
  ['review_status', 'Supervisor review'], ['assessable', 'Image assessable'],
  ['findings', 'AI visible findings'], ['severity', 'Finding severity'],
  ['recommendation', 'Recommended action'], ['model', 'AI model'],
  ['measured_mm', 'Verified minimum tread mm'], ['remaining_mm', 'Remaining usable mm'],
  ['remaining_percent', 'Remaining percent'], ['measurement_status', 'Measurement verification'],
  ['wear_rate', 'Wear rate (from repeated gauge readings)'],
  ['km_to_limit', 'Estimated km to minimum depth'],
  ['replace_soon', 'Replace soon'], ['uneven_wear', 'Uneven wear hint (indicative)'],
])

/**
 * @param {object} p
 * @param {object} p.inspection
 * @param {{position:string, condition:string, calculation:object}[]} p.readings one per tyre position
 * @param {object[]} p.analysisJobs ai_tyre_inspection_jobs for this inspection
 * @param {{allPhotos:{position:string, ref:string}[]}} p.evidence
 * @param {(position:string)=>string} p.positionLabel stored slot -> canonical code
 * @param {Map<string,object>} [p.seriesByPosition] engine series keyed by stored position
 */
export function buildInspectionExportRows({ inspection, readings, analysisJobs = [], evidence, positionLabel, seriesByPosition = new Map() }) {
  return (readings || []).map(item => {
    const findings = analysisJobs.filter(job => job.tyre_position === item.position)
    const photos = (evidence?.allPhotos || []).filter(photo => photo.position === item.position)
    const reading = item.calculation
    const series = seriesByPosition.get(item.position)
    const d = series ? describeSeries(series) : null
    const nm = 'Not measured'
    return {
      vehicle: inspection.asset_no || '', site: inspection.site || '',
      date: inspection.inspection_date || '', inspector: inspection.inspector || '',
      inspection_id: inspection.id, position: positionLabel(item.position), internal_position: item.position,
      condition: item.condition, photos: photos.length,
      photo_references: photos.map(photo => photo.ref).join(' | '),
      ai_status: findings.length ? findings.map(job => job.status).join('; ') : 'Not requested',
      review_status: findings.map(job => job.review_status || 'unreviewed').join('; ') || 'Not reviewed',
      assessable: findings.map(job => job.analysis?.assessable === true ? 'Yes' : 'No').join('; '),
      findings: findings.flatMap(job => (job.analysis?.defects || []).map(defect => [defect.type, defect.description, defect.visibleEvidence].filter(Boolean).join(': '))).join(' | '),
      severity: findings.flatMap(job => (job.analysis?.defects || []).map(defect => defect.severity)).join('; '),
      recommendation: findings.map(job => job.analysis?.recommendation || '').filter(Boolean).join(' | '),
      model: findings.map(job => job.model_version || '').filter(Boolean).join('; '),
      measured_mm: reading.valid ? reading.reading.worstMm : nm,
      remaining_mm: reading.valid ? reading.reading.remainingMm : '',
      remaining_percent: reading.valid ? reading.reading.remainingPercent : '',
      measurement_status: reading.valid ? 'Recorded physical measurement' : 'Measurement required',
      wear_rate: d ? d.rate : nm,
      km_to_limit: d ? d.kmLeft : nm,
      replace_soon: series && series.replace.flag !== null ? (series.replace.flag ? 'Yes: ' + series.replace.reasons.join(' ') : 'No') : nm,
      uneven_wear: series && series.hints.length ? series.hints.map(h => h.label).join('; ') : (series ? 'None indicated' : nm),
    }
  })
}

export async function exportInspectionExcel(params) {
  const { exportToExcel, reportFileName, reportDateLabel } = await import('./exportUtils')
  const rows = buildInspectionExportRows(params)
  const { inspection } = params
  exportToExcel(
    rows,
    INSPECTION_EXPORT_COLUMNS.map(([key]) => key),
    INSPECTION_EXPORT_COLUMNS.map(([, header]) => header),
    reportFileName('AI Tyre Inspection ' + (inspection.asset_no || 'vehicle'), inspection.inspection_date || 'inspection', reportDateLabel()),
  )
  return rows
}
