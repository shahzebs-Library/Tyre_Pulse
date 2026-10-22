/**
 * AI Tyre Inspection: pure domain layer.
 *
 * Separation of concerns:
 * - Inspector declaration is immutable evidence.
 * - A photograph is a reference, not a numerical tread gauge.
 * - A gauge reading is authoritative only after validation and authorization.
 * - Model output is advisory until an authorized human reviews it.
 *
 * No direct network, clock, storage, or React dependency in this module.
 */
import { calculateTread, conditionRequiresAnalysis, forecastTread } from './aiTyreInspection'

export const ANALYSIS_STATES = Object.freeze(['not_requested', 'pending', 'processing', 'completed', 'review_required', 'failed'])
export const REVIEW_STATES = Object.freeze(['unreviewed', 'accepted', 'rejected', 'corrected'])
export const MEASUREMENT_SOURCES = Object.freeze(['manual_gauge', 'digital_gauge', 'calibrated_device'])
export const DEFECT_TYPES = Object.freeze([
  'uneven_wear', 'shoulder_wear', 'center_wear', 'tread_wear', 'sidewall_cut',
  'tread_cut', 'cracking', 'bulge', 'exposed_cord', 'suspected_separation',
  'embedded_object', 'puncture_evidence', 'other_visible_damage', 'uncertain',
])
export const SEVERITIES = Object.freeze(['none', 'low', 'moderate', 'high', 'urgent', 'unknown'])
export const POSITIONS = Object.freeze(['inner', 'center', 'outer'])

const asObject = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {}
const trimmed = v => typeof v === 'string' ? v.trim() : ''
const present = v => v !== null && v !== undefined && v !== ''
const numeric = v => present(v) && Number.isFinite(Number(v)) ? Number(v) : null
const cleanText = (v, max = 400) => trimmed(v).slice(0, max)

export function normalizePositionConditions(record) {
  let raw = record?.tyre_conditions
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { raw = {} }
  }
  return asObject(raw)
}

export function normalizePhotographs(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(normalizePhotographs)
  if (typeof value === 'object') {
    return normalizePhotographs(value.ref || value.path || value.uri || value.url)
  }
  if (typeof value !== 'string') return []
  const v = value.trim()
  if (!v) return []
  if (v.startsWith('[')) {
    try {
      const parsed = JSON.parse(v)
      if (Array.isArray(parsed)) return normalizePhotographs(parsed)
    } catch { /* original is preserved below */ }
  }
  return [v]
}

export function inspectablePhotoRefs(inspection) {
  const result = []
  const seen = new Set()
  const conditions = normalizePositionConditions(inspection)
  for (const [position, item] of Object.entries(conditions)) {
    const entry = asObject(item)
    const condition = cleanText(entry.condition || entry.status || entry.risk, 100)
    if (!conditionRequiresAnalysis(condition)) continue
    const photos = [
      ...normalizePhotographs(entry.photo),
      ...normalizePhotographs(entry.photos),
      ...normalizePhotographs(entry.photo_refs),
      ...normalizePhotographs(entry.evidence),
    ]
    for (const ref of photos) {
      const key = position + ':' + ref
      if (seen.has(key)) continue
      seen.add(key)
      result.push({ inspectionId: inspection.id, position, condition, ref })
    }
  }
  return result
}

export function summarizeEvidence(inspection) {
  const conditions = normalizePositionConditions(inspection)
  const allPositions = Object.entries(conditions)
  const abnormal = allPositions.filter(([, item]) =>
    conditionRequiresAnalysis(asObject(item).condition || asObject(item).status))
  const photos = inspectablePhotoRefs(inspection)
  const coveredPositions = new Set(photos.map(item => item.position))
  return {
    positions: allPositions.length,
    abnormalPositions: abnormal.length,
    defectPhotos: photos.length,
    abnormalPositionsWithPhotos: coveredPositions.size,
    abnormalPositionsMissingPhotos: abnormal
      .map(([position]) => position)
      .filter(position => !coveredPositions.has(position)),
    photos,
  }
}

export function validateGaugeMeasurement(input) {
  const value = asObject(input)
  const errors = {}
  const source = trimmed(value.source)
  if (!MEASUREMENT_SOURCES.includes(source)) errors.source = 'Select a verified measurement source.'
  const original = numeric(value.originalMm)
  const minimum = numeric(value.minimumMm)
  if (original === null || original <= 0 || original > 100) errors.originalMm = 'Enter a valid original tread depth.'
  if (minimum === null || minimum < 0 || minimum >= (original ?? 0)) {
    errors.minimumMm = 'The minimum must be lower than original tread depth.'
  }
  const depths = POSITIONS.map(position => [position, numeric(value[position + 'Mm'])])
  if (depths.every(([, depth]) => depth === null)) {
    errors.depth = 'Measure at least one tread position with a physical gauge.'
  }
  for (const [position, depth] of depths) {
    if (depth !== null && (depth < 0 || depth > 100 || (original !== null && depth > original))) {
      errors[position + 'Mm'] = 'The depth must be within the physically possible range.'
    }
  }
  const odometer = numeric(value.odometerKm)
  if (present(value.odometerKm) && (odometer === null || odometer < 0)) {
    errors.odometerKm = 'Enter a valid odometer or leave it blank.'
  }
  if (!trimmed(value.inspectionId)) errors.inspectionId = 'An inspection is required.'
  if (!trimmed(value.position)) errors.position = 'A tyre position is required.'
  if (!trimmed(value.measuredAt) || Number.isNaN(Date.parse(value.measuredAt))) {
    errors.measuredAt = 'A valid measurement date is required.'
  }
  return { valid: Object.keys(errors).length === 0, errors }
}

export function measurementReading(input) {
  const valid = validateGaugeMeasurement(input)
  if (!valid.valid) return { ...valid, reading: null }
  const depths = POSITIONS.map(position => numeric(input[position + 'Mm'])).filter(v => v !== null)
  const worstMm = Math.min(...depths)
  const meanMm = depths.reduce((a,b) => a+b, 0) / depths.length
  const tread = calculateTread({
    originalMm: input.originalMm,
    measuredMm: worstMm,
    minimumMm: input.minimumMm,
  })
  const spreadMm = Math.max(...depths) - Math.min(...depths)
  return {
    valid: true,
    errors: {},
    reading: {
      ...tread,
      worstMm,
      averageMm: Math.round(meanMm * 100) / 100,
      spreadMm: Math.round(spreadMm * 100) / 100,
      unevenDepthWarning: depths.length > 1 && spreadMm >= 2,
      source: input.source,
      measuredPositions: depths.length,
      assumption: 'Worst measured groove used for conservative remaining-usable-tread calculation.',
    },
  }
}

export function buildMeasurementHistory(rows, position, serial) {
  const list = (rows || [])
    .filter(row => (!position || row.tyre_position === position))
    .filter(row => (!serial || !row.tyre_serial || row.tyre_serial === serial))
    .map(row => {
      const entry = {
        inspectionId: row.inspection_id,
        position: row.tyre_position,
        tyreSerial: row.tyre_serial,
        source: row.source,
        measuredAt: row.measured_at,
        odometerKm: numeric(row.odometer_km),
        originalMm: numeric(row.original_mm),
        minimumMm: numeric(row.minimum_mm),
        innerMm: numeric(row.inner_mm),
        centerMm: numeric(row.center_mm),
        outerMm: numeric(row.outer_mm),
      }
      return { ...entry, ...measurementReading({
        ...entry, inspectionId: entry.inspectionId,
        position: entry.position, measuredAt: entry.measuredAt,
      }) }
    })
    .filter(item => item.valid)
    .sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt))
  return list
}

export function latestVerifiedReading(history) {
  return (history || []).filter(item => item.valid && item.reading)
    .slice().sort((a,b) => Date.parse(b.measuredAt)-Date.parse(a.measuredAt))[0] || null
}

export function computePositionTrend(history) {
  const valid = (history || []).filter(r => r.valid && r.reading && r.odometerKm !== null)
  const latest = latestVerifiedReading(valid)
  if (!latest || valid.length < 2) return null
  const serials = new Set(valid.map(r => r.tyreSerial).filter(Boolean))
  if (serials.size > 1) return null
  return forecastTread(
    valid.map(r => ({ odometerKm:r.odometerKm, measuredMm:r.reading.worstMm })),
    latest.minimumMm,
  )
}

export function normalizeAiFinding(raw) {
  const item = asObject(raw)
  const defects = Array.isArray(item.defects) ? item.defects.slice(0, 12) : []
  const safeDefects = defects.map(v => {
    const defect = asObject(v)
    const code = DEFECT_TYPES.includes(defect.type) ? defect.type : 'uncertain'
    return {
      type: code,
      description: cleanText(defect.description, 450),
      severity: SEVERITIES.includes(defect.severity) ? defect.severity : 'unknown',
      visibleEvidence: cleanText(defect.visibleEvidence, 450),
    }
  })
  return {
    assessable: item.assessable === true,
    reason: cleanText(item.reason, 400),
    defects: item.assessable === true ? safeDefects : [],
    recommendation: cleanText(item.recommendation, 700),
    humanReviewRequired: true,
    exactTreadDepthMm: null,
    remainingTreadLifeKm: null,
    photoIsPhysicalMeasurement: false,
    source: 'ai_visual_observation',
  }
}

export function compareInspectorWithAi(condition, analysis) {
  const normalized = normalizeAiFinding(analysis)
  if (!normalized.assessable) {
    return { status:'unable_to_assess', message:normalized.reason || 'Better photographs required.' }
  }
  const abnormal = conditionRequiresAnalysis(condition)
  const aiDefects = normalized.defects.filter(d => d.type !== 'uncertain' && d.severity !== 'none')
  if (!abnormal && aiDefects.length) {
    return { status:'discrepancy', message:'AI detected a possible defect but inspector condition is not abnormal.' }
  }
  if (abnormal && !aiDefects.length) {
    return { status:'review', message:'Inspector recorded a defect that the model could not confirm visually.' }
  }
  return { status:'consistent', message:'No obvious disagreement; qualified review remains required.' }
}

export function inspectionReviewSummary(inspection, jobs, measurements) {
  const evidence = summarizeEvidence(inspection)
  const queue = (jobs || []).filter(j => j.inspection_id === inspection?.id)
  const depths = (measurements || []).filter(m => m.inspection_id === inspection?.id)
  const pending = queue.filter(j => j.status === 'pending' || j.status === 'processing')
  const reviewed = queue.filter(j => REVIEW_STATES.includes(j.review_status) && j.review_status !== 'unreviewed')
  const failed = queue.filter(j => j.status === 'failed')
  return {
    ...evidence,
    queued: queue.length,
    pending: pending.length,
    reviewed: reviewed.length,
    failed: failed.length,
    physicallyMeasured: depths.length,
    inspectionId: inspection?.id,
    complete: queue.length > 0 && queue.every(j => j.status === 'completed') && reviewed.length === queue.length,
    disclaimer: 'AI observations do not certify tyre safety or replace a physical inspection.',
  }
}

export function reportableFinding(job) {
  if (!job || job.status !== 'completed') return null
  const normalized = normalizeAiFinding(job.analysis)
  return {
    inspectionId: job.inspection_id,
    position: cleanText(job.tyre_position, 80),
    photoRef: job.photo_ref,
    modelVersion: cleanText(job.model_version, 120),
    reviewStatus: job.review_status || 'unreviewed',
    reviewerNote: cleanText(job.reviewer_note, 800),
    analyzedAt: job.updated_at,
    analysis: normalized,
  }
}

export function reportableMeasurement(row) {
  const result = measurementReading({
    inspectionId:row.inspection_id, position:row.tyre_position,
    originalMm:row.original_mm, minimumMm:row.minimum_mm,
    innerMm:row.inner_mm, centerMm:row.center_mm, outerMm:row.outer_mm,
    source:row.source, odometerKm:row.odometer_km, measuredAt:row.measured_at,
  })
  return result.valid ? {
    position:row.tyre_position,
    tyreSerial:row.tyre_serial,
    measuredAt:row.measured_at,
    source:row.source,
    innerMm:row.inner_mm,
    centerMm:row.center_mm,
    outerMm:row.outer_mm,
    ...result.reading,
  } : null
}
