/**
 * Reading the classifier's decisions about your own uploaded data.
 *
 * The ERP export files every line under its own Spare / Trye / Oil column. The
 * app deliberately does not trust that: the category is decided by the ITEM, so
 * a real tyre the ERP filed under Spare lands in tyre, and a gearbox the ERP
 * dumped in the tyre column is moved out. The rule is right, but until now every
 * one of those decisions was invisible - the numbers simply differed from the
 * file and nobody could see where.
 *
 * These helpers turn the raw decision rows into the two things a person needs:
 * what changed about their file, and which of those changes deserve a second
 * look. Pure: no I/O, no dates, no randomness.
 */

export const MOVEMENTS = Object.freeze({
  MOVED: 'moved',
  KEPT: 'kept',
  UNLABELLED: 'unlabelled',
})

export const BUCKET_LABELS = Object.freeze({
  tyre: 'Tyres',
  oil: 'Oil and lubricants',
  spare: 'Spare parts',
  'not stated': 'Not stated in the file',
})

export const bucketLabel = (b) => BUCKET_LABELS[b] || b || 'N/A'

/**
 * Why the system decided what it did, in words rather than a code name. These
 * mirror `classified_by` on every transaction row.
 */
export const REASON_LABELS = Object.freeze({
  'reviewed-master': 'You decided this',
  'code-range': 'The item code says so',
  'description-lubricant': 'The description names a lubricant',
  'description-tyre': 'The description says tyre',
  'brand-and-size': 'A tyre brand with a tyre size',
  'non-tyre-part': 'The description names a mechanical part',
  accessory: 'A tyre accessory, not a tyre',
  'job-card': 'It was on a tyre job card',
  default: 'Nothing identified it',
})

export const reasonLabel = (r) => REASON_LABELS[r] || r || 'Unknown'

/**
 * Confidence at or below this was not really an identification. `default` sits
 * at 0.30 and is the fallback the whole review effort exists to shrink.
 */
export const WEAK_CONFIDENCE = 0.5

/**
 * Does this decision deserve a look before the money is trusted.
 *
 * Two honest triggers, and deliberately no others: nothing was identified, or
 * the file said one thing and a guess said another. A HIGH-confidence move is
 * not flagged - the item code saying "tyre" is the strongest signal there is,
 * and flagging those would bury the real problems under 1,300 correct rows.
 * Anything a human has already reviewed is never flagged again.
 */
export function needsAttention(row) {
  if (!row || row.reviewed) return false
  const conf = Number(row.confidence)
  // A confidence we cannot read is not a confident decision. This surface
  // exists to catch things, so an unreadable row is included rather than
  // quietly passed as fine.
  if (!Number.isFinite(conf)) return true
  if (conf <= WEAK_CONFIDENCE || row.decided_by === 'default') return true
  return row.movement === MOVEMENTS.MOVED && conf < 0.9
}

/** Short reason a row is flagged, so the badge is never unexplained. */
export function attentionReason(row) {
  if (!needsAttention(row)) return ''
  if (!Number.isFinite(Number(row.confidence))) return 'The evidence behind this one could not be read'
  if (row.decided_by === 'default' || Number(row.confidence) <= WEAK_CONFIDENCE) {
    return 'Nothing identified this item, so it fell to the default bucket'
  }
  return 'Moved away from what the file said, on weaker than usual evidence'
}

/**
 * One line describing a decision, used in the row and in the export.
 */
export function movementSentence(row) {
  if (!row) return ''
  if (row.movement === MOVEMENTS.UNLABELLED) {
    return `Your file left this blank. We filed it as ${bucketLabel(row.we_said).toLowerCase()}.`
  }
  if (row.movement === MOVEMENTS.KEPT) {
    return `Your file said ${bucketLabel(row.erp_said).toLowerCase()}. We agreed.`
  }
  return `Your file said ${bucketLabel(row.erp_said).toLowerCase()}. We filed it as ${bucketLabel(row.we_said).toLowerCase()}.`
}

/**
 * Totals for the strip above the table. Per country, ALWAYS - each country
 * reports in its own currency and adding them would produce a number that means
 * nothing. Returns [] rather than a zeroed row when there is nothing to report.
 */
export function summariseCountries(countries = []) {
  return (Array.isArray(countries) ? countries : [])
    .filter((c) => c && c.country)
    .map((c) => {
      const total = Number(c.total_rows) || 0
      return {
        ...c,
        moved_share: total ? (Number(c.moved_rows) || 0) / total : null,
        unlabelled_share: total ? (Number(c.unlabelled_rows) || 0) / total : null,
      }
    })
}

/**
 * The categories a person can pick when overriding. These are the master's own
 * vocabulary, not the three cost buckets, because the master is what the
 * decision is written to - and it carries detail the buckets cannot (a filter
 * and a gearbox are both "spare" money but are not the same thing).
 */
export const OVERRIDE_CATEGORIES = Object.freeze([
  { value: 'tyre', label: 'Tyre', bucket: 'tyre' },
  { value: 'lubricant', label: 'Oil or lubricant', bucket: 'oil' },
  { value: 'filter', label: 'Filter', bucket: 'spare' },
  { value: 'spare_part', label: 'Spare part', bucket: 'spare' },
  { value: 'fuel', label: 'Fuel', bucket: 'spare' },
  { value: 'consumable', label: 'Consumable', bucket: 'spare' },
  { value: 'service', label: 'Service', bucket: 'spare' },
  { value: 'labour', label: 'Labour', bucket: 'spare' },
  { value: 'capital', label: 'Capital item', bucket: 'spare' },
])

export const categoryBucket = (category) =>
  OVERRIDE_CATEGORIES.find((c) => c.value === category)?.bucket || 'spare'

/**
 * Would this override actually move any money? Choosing a category that lands
 * in the same bucket is a legitimate correction of the RECORD (a filter is not
 * a gearbox) but changes no total, and saying so stops the apply step looking
 * broken when it reports nothing moved.
 */
export function overrideMovesMoney(row, category) {
  if (!row || !category) return false
  return categoryBucket(category) !== row.we_said
}

/** Stable key for a decision row: one item code can appear under two movements. */
export const decisionKey = (row) =>
  `${row?.country || ''}|${row?.item_code || ''}|${row?.erp_said || ''}|${row?.we_said || ''}`
