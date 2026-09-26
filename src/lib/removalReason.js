/**
 * Removal-reason hygiene.
 *
 * About 820 UAE tyre_records carry a tyre BRAND in `removal_reason` (ROADX,
 * FIREMAX, LONGMARCH, ROCK HOLDER, VGLORY...) from a column misalignment on
 * import, while `brand` itself is already populated. Left alone, ROADX ranks as
 * one of the fleet's top "reasons a tyre was removed". The column is NOT
 * cleared (owner decision); readers that group or chart removal reasons skip a
 * value that is really a brand.
 *
 * The brand list is the classifier's own TYRE_BRANDS (one list, no second copy)
 * plus the two brands the catalog does not carry. Both sides are compared in
 * alphanumeric-only lower case, so ROCK HOLDER == rockholder and
 * VGLORY == v-glory.
 *
 * MIRROR: SQL get_report_tyre_maintenance (MIGRATIONS_V614) applies the same
 * rule over brain_tokens('tyre_brand'). Change both together.
 */
import { TYRE_BRANDS } from './classificationBrain'

export const EXTRA_BRAND_REASONS = Object.freeze(['rock holder', 'vglory'])

const squash = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

const BRAND_KEYS = new Set(
  [...TYRE_BRANDS, ...EXTRA_BRAND_REASONS].map(squash).filter(Boolean),
)

/** True when a removal_reason value is actually a tyre brand, not a reason. */
export function isBrandNotReason(value) {
  const k = squash(value)
  return k !== '' && BRAND_KEYS.has(k)
}

/**
 * The removal reason fit for grouping: trimmed text, or null when it is blank
 * or is a brand (a brand there means no reason was recorded).
 */
export function cleanRemovalReason(value) {
  if (value == null) return null
  const s = String(value).trim()
  if (!s || isBrandNotReason(s)) return null
  return s
}
