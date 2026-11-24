/**
 * Emergency purchase justification (owner decision C, 2026-11-24).
 *
 * The database is the boundary: trigger trg_po_controls (_po_emergency_normalise,
 * migration 20261124130000) refuses an emergency purchase order whose
 * justification is incomplete, resolves the asset / job card in the PO's
 * company and country, and stamps who requested it. These helpers only mirror
 * those rules so the form can say what is missing before saving.
 */

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

export const categoryLabel = (v) => EMERGENCY_CATEGORIES.find((c) => c.value === v)?.label || (v ? String(v) : 'N/A')

const txt = (v) => String(v ?? '').trim()
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * Check a justification form. Returns { ok, errors: {field: message}, first }.
 * @param {object} f        form (EMPTY_EMERGENCY shape)
 * @param {object} ctx      { currency: PO currency, supplier: supplier name or id, country }
 */
export function validateEmergency(f = {}, ctx = {}) {
  const errors = {}
  if (!EMERGENCY_CATEGORIES.some((c) => c.value === f.category)) errors.category = 'Choose why this is an emergency.'
  if (f.category === 'other' && txt(f.categoryNote).length < OTHER_NOTE_MIN) {
    errors.categoryNote = `Describe the emergency in at least ${OTHER_NOTE_MIN} characters.`
  }
  if (!txt(f.assetNo) && !txt(f.jobCardNo)) errors.asset = 'Name the affected asset number or job card.'
  const hours = num(f.downtimeHours)
  if (f.downtimeHours !== '' && f.downtimeHours != null && (hours === null || hours < 0)) errors.downtimeHours = 'Downtime hours must be zero or more.'
  if (hours === null && txt(f.impact).length < IMPACT_TEXT_MIN) {
    errors.impact = `Give the downtime hours, or describe the impact of waiting in at least ${IMPACT_TEXT_MIN} characters.`
  }
  if (txt(f.routeReason).length < ROUTE_REASON_MIN) {
    errors.routeReason = `Explain why the normal approval route could not be used (at least ${ROUTE_REASON_MIN} characters).`
  }
  const est = num(f.estValue)
  if (est === null || est <= 0) errors.estValue = 'Enter the estimated value.'
  const cur = txt(f.estCurrency || ctx.currency).toUpperCase()
  if (!/^[A-Z]{3}$/.test(cur)) errors.estCurrency = 'Choose the currency of the estimated value.'
  else if (ctx.currency && cur !== String(ctx.currency).toUpperCase()) {
    errors.estCurrency = `The order is in ${String(ctx.currency).toUpperCase()}. The estimate must use the same currency; currencies are not converted.`
  }
  if (!txt(ctx.supplier)) errors.supplier = 'Choose or type the supplier.'
  if (!txt(ctx.country)) errors.country = 'Choose the country of the order.'
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
export function impactText(po = {}) {
  const hours = num(po.emergency_downtime_hours)
  const parts = []
  if (hours !== null) parts.push(`${hours.toLocaleString('en-US')} h downtime`)
  if (txt(po.emergency_impact)) parts.push(txt(po.emergency_impact))
  return parts.join('; ') || 'N/A'
}

export function estimateText(po = {}) {
  const v = num(po.emergency_est_value)
  if (v === null) return 'No estimate'
  return `${po.emergency_est_currency || po.currency || ''} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim()
}

/** Ordered label / value pairs for showing the full justification. */
export function justificationFields(po = {}) {
  return [
    ['Reason category', po.emergency_category === 'other' && po.emergency_category_note
      ? `Other: ${po.emergency_category_note}` : categoryLabel(po.emergency_category)],
    ['Affected asset', po.emergency_asset_no || 'N/A'],
    ['Job card', po.emergency_job_card_no || 'N/A'],
    ['Impact of waiting', impactText(po)],
    ['Why the normal approval route could not be used', po.emergency_reason || 'N/A'],
    ['Estimated value', estimateText(po)],
    ['Supplier', po.supplier_name || po.vendor_name || 'N/A'],
    ['Requested by', po.emergency_requested_by_name || 'N/A'],
    ['Attachment', po.emergency_attachment_path || 'None'],
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
