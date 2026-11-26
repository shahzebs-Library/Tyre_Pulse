/**
 * Emergency purchase justification (owner decision C, 2026-11-24).
 *
 * The database is the boundary: trigger trg_po_controls (_po_emergency_normalise,
 * migration 20261124130000) refuses an emergency purchase order whose
 * justification is incomplete, resolves the asset / job card in the PO's
 * company and country, and stamps who requested it. These helpers only mirror
 * those rules so the form can say what is missing before saving.
 *
 * Text is English unless the caller passes `t` (see src/lib/wmsText.js).
 * Exports call without `t`, so files stay English.
 */
import { textFn } from '../wmsText'

export const EMERGENCY_CATEGORIES = Object.freeze([
  { value: 'breakdown', label: 'Breakdown' },
  { value: 'safety', label: 'Safety' },
  { value: 'production_stoppage', label: 'Production stoppage' },
  { value: 'customer_commitment', label: 'Customer commitment' },
  { value: 'other', label: 'Other' },
])

export const ROUTE_REASON_MIN = 30
export const IMPACT_TEXT_MIN = 10
export const OTHER_NOTE_MIN = 10

export const EMPTY_EMERGENCY = Object.freeze({
  category: '', categoryNote: '', assetNo: '', jobCardNo: '', downtimeHours: '', impact: '',
  routeReason: '', estValue: '', estCurrency: '', attachmentPath: '',
})

export const categoryLabel = (v, t) => {
  const tx = textFn(t)
  if (EMERGENCY_CATEGORIES.some((c) => c.value === v)) return tx(`wmsmsgprocure.emergency.cat.${v}`)
  return v ? String(v) : tx('wmsmsgprocure.common.na')
}

const txt = (v) => String(v ?? '').trim()
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * Check a justification form. Returns { ok, errors: {field: message}, first }.
 * @param {object} f        form (EMPTY_EMERGENCY shape)
 * @param {object} ctx      { currency: PO currency, supplier: supplier name or id, country, t? }
 */
export function validateEmergency(f = {}, ctx = {}) {
  const tx = textFn(ctx.t)
  const e = (key, vars) => tx(`wmsmsgprocure.emergency.err.${key}`, vars)
  const errors = {}
  if (!EMERGENCY_CATEGORIES.some((c) => c.value === f.category)) errors.category = e('category')
  if (f.category === 'other' && txt(f.categoryNote).length < OTHER_NOTE_MIN) {
    errors.categoryNote = e('categoryNote', { min: OTHER_NOTE_MIN })
  }
  if (!txt(f.assetNo) && !txt(f.jobCardNo)) errors.asset = e('asset')
  const hours = num(f.downtimeHours)
  if (f.downtimeHours !== '' && f.downtimeHours != null && (hours === null || hours < 0)) errors.downtimeHours = e('downtimeHours')
  if (hours === null && txt(f.impact).length < IMPACT_TEXT_MIN) {
    errors.impact = e('impact', { min: IMPACT_TEXT_MIN })
  }
  if (txt(f.routeReason).length < ROUTE_REASON_MIN) {
    errors.routeReason = e('routeReason', { min: ROUTE_REASON_MIN })
  }
  const est = num(f.estValue)
  if (est === null || est <= 0) errors.estValue = e('estValue')
  const cur = txt(f.estCurrency || ctx.currency).toUpperCase()
  if (!/^[A-Z]{3}$/.test(cur)) errors.estCurrency = e('estCurrency')
  else if (ctx.currency && cur !== String(ctx.currency).toUpperCase()) {
    errors.estCurrency = e('estCurrencyMismatch', { currency: String(ctx.currency).toUpperCase() })
  }
  if (!txt(ctx.supplier)) errors.supplier = e('supplier')
  if (!txt(ctx.country)) errors.country = e('country')
  const keys = Object.keys(errors)
  return { ok: keys.length === 0, errors, first: keys.length ? errors[keys[0]] : null }
}

/** Purchase order columns for a complete justification (requested-by is stamped by the server). */
export function emergencyColumns(f = {}, ctx = {}) {
  const hours = num(f.downtimeHours)
  return {
    is_emergency: true,
    emergency_category: f.category || null,
    emergency_category_note: f.category === 'other' ? txt(f.categoryNote) || null : txt(f.categoryNote) || null,
    emergency_asset_no: txt(f.assetNo).toUpperCase().replace(/\s+/g, '') || null,
    emergency_job_card_no: txt(f.jobCardNo) || null,
    emergency_downtime_hours: hours,
    emergency_impact: txt(f.impact) || null,
    emergency_reason: txt(f.routeReason),
    emergency_est_value: num(f.estValue),
    emergency_est_currency: (txt(f.estCurrency) || txt(ctx.currency)).toUpperCase() || null,
    emergency_attachment_path: txt(f.attachmentPath) || null,
  }
}

/** One plain line describing the impact of waiting. */
export function impactText(po = {}, t) {
  const tx = textFn(t)
  const hours = num(po.emergency_downtime_hours)
  const parts = []
  if (hours !== null) parts.push(tx('wmsmsgprocure.emergency.downtime', { hours: hours.toLocaleString('en-US') }))
  if (txt(po.emergency_impact)) parts.push(txt(po.emergency_impact))
  return parts.join('; ') || tx('wmsmsgprocure.common.na')
}

export function estimateText(po = {}, t) {
  const v = num(po.emergency_est_value)
  if (v === null) return textFn(t)('wmsmsgprocure.emergency.noEstimate')
  return `${po.emergency_est_currency || po.currency || ''} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim()
}

/** Ordered label / value pairs for showing the full justification. */
export function justificationFields(po = {}, t) {
  const tx = textFn(t)
  const f = (key) => tx(`wmsmsgprocure.emergency.f.${key}`)
  const na = tx('wmsmsgprocure.common.na')
  return [
    [f('category'), po.emergency_category === 'other' && po.emergency_category_note
      ? tx('wmsmsgprocure.emergency.otherNote', { note: po.emergency_category_note }) : categoryLabel(po.emergency_category, t)],
    [f('asset'), po.emergency_asset_no || na],
    [f('jobCard'), po.emergency_job_card_no || na],
    [f('impact'), impactText(po, t)],
    [f('route'), po.emergency_reason || na],
    [f('estimate'), estimateText(po, t)],
    [f('supplier'), po.supplier_name || po.vendor_name || na],
    [f('requestedBy'), po.emergency_requested_by_name || na],
    [f('attachment'), po.emergency_attachment_path || tx('wmsmsgprocure.common.none')],
  ]
}

export const EMERGENCY_EXPORT_HEADERS = Object.freeze([
  'Emergency', 'Emergency category', 'Affected asset', 'Job card', 'Downtime hours', 'Impact of waiting',
  'Why normal route not used', 'Estimated value', 'Estimate currency', 'Requested by', 'Declared at', 'Attachment',
  'Post-approved by', 'Post-approved at',
])

/** Export columns for one purchase order (blank when it is not an emergency purchase). */
export function emergencyExportValues(po = {}) {
  if (!po.is_emergency) return { 'Emergency': 'No' }
  const hours = num(po.emergency_downtime_hours)
  return {
    'Emergency': 'Yes',
    'Emergency category': po.emergency_category === 'other' && po.emergency_category_note
      ? `Other: ${po.emergency_category_note}` : categoryLabel(po.emergency_category),
    'Affected asset': po.emergency_asset_no || '',
    'Job card': po.emergency_job_card_no || '',
    'Downtime hours': hours === null ? '' : hours,
    'Impact of waiting': po.emergency_impact || '',
    'Why normal route not used': po.emergency_reason || '',
    // text with its currency so no export summary ever adds SAR, AED and EGP together
    'Estimated value': num(po.emergency_est_value) === null ? '' : estimateText(po),
    'Estimate currency': po.emergency_est_currency || '',
    'Requested by': po.emergency_requested_by_name || '',
    'Declared at': po.emergency_declared_at || '',
    'Attachment': po.emergency_attachment_path || '',
    'Post-approved by': po.emergency_approved_by || '',
    'Post-approved at': po.emergency_approved_at || '',
  }
}
