/**
 * metricGovernance.js - pure rules for editing the governed metric registry.
 *
 * Completeness (which governance fields a definition is missing), validation
 * of a draft before it is saved, the next formula version number, and the
 * status vocabulary that matches the metric_registry CHECK
 * (certified | draft | deprecated, or not set). No I/O.
 */

export const METRIC_STATUSES = ['certified', 'draft', 'deprecated']
export const STATUS_LABEL = { certified: 'Certified', draft: 'Draft', deprecated: 'Deprecated', none: 'Not reviewed' }
export const STATUS_TONE = { certified: 'good', draft: 'info', deprecated: 'warning', none: 'quiet' }

/** The fields a governed definition needs before it can be trusted. */
export const REQUIRED_FIELDS = [
  ['business_owner', 'Business owner'],
  ['source_table', 'Source table'],
  ['refresh_sla', 'Refresh SLA'],
  ['unit', 'Unit'],
  ['description', 'Description'],
]

const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

export function statusOf(row) {
  const s = row?.status
  return METRIC_STATUSES.includes(s) ? s : 'none'
}

/** Missing governance fields, plus a 0-100 completeness score. */
export function completeness(row) {
  const missing = REQUIRED_FIELDS.filter(([k]) => blank(row?.[k])).map(([, label]) => label)
  const score = Math.round(((REQUIRED_FIELDS.length - missing.length) / REQUIRED_FIELDS.length) * 100)
  return { missing, score }
}

/** The next version number: highest existing + 1, or 1. */
export function nextVersion(versions) {
  const nums = (Array.isArray(versions) ? versions : []).map((v) => Number(v?.version)).filter(Number.isFinite)
  return nums.length ? Math.max(...nums) + 1 : 1
}

const ID_RE = /^[a-z][a-z0-9_]{1,62}$/

/** Validate a metric draft. Returns an error sentence or ''. */
export function validateMetricDraft(d, { isNew = false, existingIds = [] } = {}) {
  const id = String(d?.metric_id || '').trim()
  if (isNew) {
    if (!ID_RE.test(id)) return 'The metric id must be lower case letters, digits or underscores, starting with a letter.'
    if (existingIds.includes(id)) return 'A metric with this id already exists.'
  }
  if (blank(d?.name)) return 'Give the metric a name.'
  if (String(d.name).length > 120) return 'The name is too long (120 characters at most).'
  if (d?.status && !METRIC_STATUSES.includes(d.status)) return 'Unknown status.'
  if (d?.status === 'certified') {
    const { missing } = completeness(d)
    if (missing.length) return `A certified metric needs: ${missing.join(', ')}.`
  }
  return ''
}

/** Validate a new formula version. */
export function validateVersionDraft(v) {
  if (blank(v?.formula)) return 'Write the formula.'
  if (blank(v?.change_note) || String(v.change_note).trim().length < 3) return 'Say what changed (at least 3 characters).'
  if (v?.effective_from && !/^\d{4}-\d{2}-\d{2}$/.test(v.effective_from)) return 'Use a date for Effective from.'
  return ''
}

/** "a, b , c" -> ['a','b','c'] (empty -> null so the column stays NULL). */
export function parseList(text) {
  const parts = String(text || '').split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts : null
}

/** Only the editable registry columns, trimmed; blank strings become null. */
export function draftToRow(d) {
  const txt = (v) => (blank(v) ? null : String(v).trim())
  return {
    metric_id: String(d.metric_id || '').trim(),
    name: txt(d.name),
    description: txt(d.description),
    business_owner: txt(d.business_owner),
    unit: txt(d.unit),
    source_module: txt(d.source_module),
    source_table: txt(d.source_table),
    refresh_sla: txt(d.refresh_sla),
    currency_handling: txt(d.currency_handling),
    dashboards: Array.isArray(d.dashboards) ? (d.dashboards.length ? d.dashboards : null) : parseList(d.dashboards),
    status: METRIC_STATUSES.includes(d.status) ? d.status : null,
  }
}
