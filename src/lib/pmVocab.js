/**
 * pmVocab.js — THE single source of truth for every Preventive Maintenance (PM)
 * vocabulary in the app (option lists, label maps, DB token converters).
 *
 * Mirrors accidentVocab.js: lowercase DB tokens are canonical, label maps carry
 * the friendly display strings, and toDb* / canon* helpers fold case, whitespace
 * and display labels back onto the stored token. Do NOT re-declare any of these
 * in a component or service — import from here.
 *
 * DB RULE: pm asset_category / priority / outcome / meter_source are stored as
 * lowercase tokens. NEVER write a UI label straight to those columns — always
 * convert through toDbAssetCategory / toDbPriority / toDbOutcome / toDbMeterSource.
 */

/** Normalise a value to a lowercase, single-spaced, trimmed key. */
const key = (v) => String(v ?? '').toLowerCase().trim().replace(/\s+/g, ' ')

// ── Asset category ────────────────────────────────────────────────────────────
export const ASSET_CATEGORIES = ['vehicle', 'generator', 'plant', 'machinery', 'equipment', 'other']

export const ASSET_CATEGORY_LABELS = {
  vehicle: 'Vehicle',
  generator: 'Generator',
  plant: 'Plant',
  machinery: 'Machinery',
  equipment: 'Equipment',
  other: 'Other',
}

// Reverse lookup: friendly label -> token (built from the label map).
const ASSET_CATEGORY_FROM_LABEL = Object.fromEntries(
  Object.entries(ASSET_CATEGORY_LABELS).map(([token, label]) => [key(label), token]),
)

/** Fold a category value (token or label, any case/whitespace) to a token, or
 *  null when empty / unrecognised (honest: an unknown value is never bucketed). */
export const canonAssetCategory = (v) => {
  const k = key(v)
  if (!k) return null
  if (ASSET_CATEGORIES.includes(k)) return k
  return ASSET_CATEGORY_FROM_LABEL[k] || null
}

/** Writer: same resolution as canon; null for empty / unknown. */
export const toDbAssetCategory = (v) => canonAssetCategory(v)

// ── PM priority ───────────────────────────────────────────────────────────────
export const PM_PRIORITIES = ['low', 'medium', 'high', 'critical']

export const PM_PRIORITY_META = {
  low: { label: 'Low', tone: 'slate' },
  medium: { label: 'Medium', tone: 'sky' },
  high: { label: 'High', tone: 'amber' },
  critical: { label: 'Critical', tone: 'red' },
}

const PM_PRIORITY_FROM_LABEL = Object.fromEntries(
  Object.entries(PM_PRIORITY_META).map(([token, meta]) => [key(meta.label), token]),
)

/** Writer: fold to a priority token, defaulting to 'medium' for empty / unknown. */
export const toDbPriority = (v) => {
  const k = key(v)
  if (!k) return 'medium'
  if (PM_PRIORITIES.includes(k)) return k
  return PM_PRIORITY_FROM_LABEL[k] || 'medium'
}

// ── PM outcome ────────────────────────────────────────────────────────────────
export const PM_OUTCOMES = ['completed', 'partial', 'deferred', 'failed']

export const PM_OUTCOME_META = {
  completed: { label: 'Completed', tone: 'green' },
  partial: { label: 'Partial', tone: 'amber' },
  deferred: { label: 'Deferred', tone: 'slate' },
  failed: { label: 'Failed', tone: 'red' },
}

const PM_OUTCOME_FROM_LABEL = Object.fromEntries(
  Object.entries(PM_OUTCOME_META).map(([token, meta]) => [key(meta.label), token]),
)

/** Writer: fold to an outcome token, defaulting to 'completed' for empty / unknown. */
export const toDbOutcome = (v) => {
  const k = key(v)
  if (!k) return 'completed'
  if (PM_OUTCOMES.includes(k)) return k
  return PM_OUTCOME_FROM_LABEL[k] || 'completed'
}

// ── Meter source ──────────────────────────────────────────────────────────────
export const METER_SOURCES = ['odometer', 'engine_hours', 'none']

export const METER_SOURCE_LABELS = {
  odometer: 'Odometer (km)',
  engine_hours: 'Engine hours',
  none: 'No meter',
}

const METER_SOURCE_FROM_LABEL = Object.fromEntries(
  Object.entries(METER_SOURCE_LABELS).map(([token, label]) => [key(label), token]),
)

/** Writer: fold to a meter-source token, defaulting to 'none' for empty / unknown. */
export const toDbMeterSource = (v) => {
  const k = key(v).replace(/\s+/g, '_')
  if (!k) return 'none'
  if (METER_SOURCES.includes(k)) return k
  return METER_SOURCE_FROM_LABEL[key(v)] || 'none'
}

/** Unit for a meter source: 'km' for odometer, 'h' for engine hours, '' otherwise. */
export const meterUnit = (source) => {
  const s = toDbMeterSource(source)
  if (s === 'odometer') return 'km'
  if (s === 'engine_hours') return 'h'
  return ''
}
