/**
 * OCR Scanner service — the single seam between the CV Inspection / OCR Scanner
 * page (/ocr-scanner) and Supabase (table `ocr_scans`, V197). Keeps an explicit
 * column list (least-privilege selects), null-safe country scoping, and input
 * validation. RLS enforces org isolation; this layer never trusts client input
 * blindly.
 *
 * Mirrors odometerLogs.js. A missing `ocr_scans` relation (org has not run the
 * migration) degrades listing to an empty array so the page can render its
 * "apply the migration" empty state instead of erroring.
 *
 * The real OCR/CV extraction runs via an external provider not yet connected:
 * this layer stores and validates records honestly (no fabricated extraction).
 * `extracted_fields` is accepted as a JSON object as-is (or null); confidence,
 * when supplied, is validated to the 0..1 range a provider score lives in.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { toFiniteNumber } from '../ocrScanner'
import { safeHref } from '../safeUrl'

/** Scheme-guard a URL on write: safe → the string, anything unsafe/blank → null. */
const asUrl = (v) => { const s = safeHref(v); return s === undefined ? null : s }

export const COLS =
  'id,organisation_id,country,scan_type,asset_no,image_url,extracted_text,' +
  'extracted_fields,confidence,review_status,reviewed_by,corrected_value,' +
  'notes,created_by,created_at,updated_at'

const SCAN_TYPES = new Set([
  'tyre_sidewall', 'dot_code', 'registration', 'odometer', 'document', 'vin', 'other',
])
const REVIEW_STATUSES = new Set([
  'pending', 'auto_extracted', 'needs_review', 'confirmed', 'rejected',
])

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('ocr_scans'))
  )
}

const asText = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max))

/** Whitelist a scan_type; throws on an unknown/missing value. */
function asScanType(v) {
  const s = asText(v, 40)
  if (!s || !SCAN_TYPES.has(s)) {
    throw new Error(`scan_type must be one of: ${[...SCAN_TYPES].join(', ')}.`)
  }
  return s
}

/** Whitelist a review_status; falls back to 'pending' when absent. */
function asReviewStatus(v, fallback = 'pending') {
  if (v == null || v === '') return fallback
  const s = String(v).trim().toLowerCase()
  if (!REVIEW_STATUSES.has(s)) {
    throw new Error(`review_status must be one of: ${[...REVIEW_STATUSES].join(', ')}.`)
  }
  return s
}

/** Validate a 0..1 confidence score; null when absent. Throws when out of range. */
function asConfidence(v) {
  if (v == null || v === '') return null
  const n = toFiniteNumber(v)
  if (n == null) throw new Error('Confidence must be a number between 0 and 1.')
  if (n < 0 || n > 1) throw new Error('Confidence must be between 0 and 1.')
  return n
}

/** Accept extracted_fields as a JSON object as-is, or null. Rejects other shapes. */
function asFields(v) {
  if (v == null || v === '') return null
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return null
    try {
      const parsed = JSON.parse(t)
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      throw new Error('Extracted fields must be valid JSON (an object).')
    }
    throw new Error('Extracted fields must be a JSON object.')
  }
  if (typeof v === 'object') return v
  throw new Error('Extracted fields must be a JSON object.')
}

/**
 * List scans (newest first by created_at). Optional `country` filter. Returns []
 * when the table has not been provisioned yet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listOcrScans({ country, limit = 500 } = {}) {
  try {
    let q = supabase.from('ocr_scans').select(COLS)
    q = applyCountry(q, country)
    return unwrap(
      await q
        .order('created_at', { ascending: false })
        .limit(limit),
    ) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getOcrScan(id) {
  return unwrap(await supabase.from('ocr_scans').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create a scan record. Requires a scan_type. Extraction fields are stored
 * exactly as provided (no fabrication): a record created before a provider is
 * connected simply carries null extraction and a 'pending' review status.
 */
export async function createOcrScan(values = {}) {
  const payload = {
    scan_type: asScanType(values.scan_type),
    asset_no: asText(values.asset_no, 120),
    image_url: asUrl(asText(values.image_url, 2000)),
    extracted_text: values.extracted_text ? String(values.extracted_text).slice(0, 20000) : null,
    extracted_fields: asFields(values.extracted_fields),
    confidence: asConfidence(values.confidence),
    review_status: asReviewStatus(values.review_status),
    reviewed_by: asText(values.reviewed_by, 200),
    corrected_value: asText(values.corrected_value, 2000),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('ocr_scans').insert(payload).select(COLS).single())
}

/**
 * Patch a scan. Strips immutable/ownership fields; coerces each field present so
 * the stored value never drifts from the validated shape.
 */
export async function updateOcrScan(id, patch = {}) {
  const clean = {}
  if (patch.scan_type !== undefined) clean.scan_type = asScanType(patch.scan_type)
  if (patch.asset_no !== undefined) clean.asset_no = asText(patch.asset_no, 120)
  if (patch.image_url !== undefined) clean.image_url = asUrl(asText(patch.image_url, 2000))
  if (patch.extracted_text !== undefined) {
    clean.extracted_text = patch.extracted_text ? String(patch.extracted_text).slice(0, 20000) : null
  }
  if (patch.extracted_fields !== undefined) clean.extracted_fields = asFields(patch.extracted_fields)
  if (patch.confidence !== undefined) clean.confidence = asConfidence(patch.confidence)
  if (patch.review_status !== undefined) clean.review_status = asReviewStatus(patch.review_status)
  if (patch.reviewed_by !== undefined) clean.reviewed_by = asText(patch.reviewed_by, 200)
  if (patch.corrected_value !== undefined) clean.corrected_value = asText(patch.corrected_value, 2000)
  if (patch.notes !== undefined) clean.notes = patch.notes ? String(patch.notes).slice(0, 8000) : null
  if (patch.country !== undefined) clean.country = patch.country ?? null

  return unwrap(await supabase.from('ocr_scans').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteOcrScan(id) {
  return unwrap(await supabase.from('ocr_scans').delete().eq('id', id))
}
