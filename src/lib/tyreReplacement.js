/**
 * tyreReplacement.js - in-file ordering of tyre fitments per wheel.
 *
 * An ERP tyre file can carry more than one fitment for the SAME wheel (asset +
 * position): the tyre fitted in January and the one that replaced it in March.
 * Only the latest of them is on the wheel now. The earlier ones ended the day
 * the next one went on, so they are loaded as removed fitments with that end
 * date, and only the latest is offered to the database replacement check
 * (public.tyre_import_reconcile -> _tyre_close_replaced), which closes the tyre
 * already on the wheel when the evidence is clear.
 *
 * Kilometres follow the shared rule (src/lib/tyreKm.js): the next tyre's fitting
 * reading is the earlier tyre's removal reading only when it is a real reading
 * (not blank, not the "1" placeholder) and not below the earlier fitting
 * reading. Otherwise it stays unknown, never zero.
 */

const norm = (v) => String(v ?? '').trim()
const upperNoSpace = (v) => norm(v).toUpperCase().replace(/\s+/g, '')
const day = (v) => norm(v).slice(0, 10)
const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Wheel identity used everywhere in the import: asset + position. */
export function wheelKey(row) {
  const asset = upperNoSpace(row?.asset_no)
  const pos = norm(row?.tyre_position ?? row?.position).toUpperCase()
  if (!asset || !pos || pos === '0') return ''
  return `${asset}|${pos}`
}

/** True when the row describes a tyre still on the wheel (no removal date). */
export function isCurrentFitment(row) {
  return !norm(row?.removal_date)
}

/**
 * Order the CURRENT fitments of each wheel and close all but the latest.
 * Rows are returned as new objects; the input is not mutated.
 *
 * @param {object[]} rows mapped tyre rows (asset_no, position|tyre_position,
 *   issue_date, km_at_fitment, removal_date, status, serial_no)
 * @returns {{ rows: object[], chained: number, latest: object[] }}
 *   rows    - all rows, earlier same-wheel current fitments now closed
 *   chained - how many earlier fitments were closed in-file
 *   latest  - the one current fitment per wheel (what is on the wheel now)
 */
export function chainFitmentsPerWheel(rows = []) {
  const out = rows.map((r) => ({ ...r }))
  const byWheel = new Map()
  out.forEach((r, i) => {
    if (!isCurrentFitment(r)) return
    const k = wheelKey(r)
    if (!k || !day(r.issue_date)) return
    if (!byWheel.has(k)) byWheel.set(k, [])
    byWheel.get(k).push(i)
  })
  let chained = 0
  const latest = []
  for (const idxs of byWheel.values()) {
    // Oldest first; a tie keeps file order so the later line in the file wins.
    idxs.sort((a, b) => (day(out[a].issue_date) < day(out[b].issue_date) ? -1
      : day(out[a].issue_date) > day(out[b].issue_date) ? 1 : a - b))
    for (let j = 0; j < idxs.length - 1; j += 1) {
      const cur = out[idxs[j]]
      const next = out[idxs[j + 1]]
      cur.removal_date = day(next.issue_date)
      cur.status = 'Removed'
      const fit = num(cur.km_at_fitment)
      const nextFit = num(next.km_at_fitment)
      if (nextFit != null && nextFit > 1 && (fit == null || nextFit >= fit)) cur.km_at_removal = nextFit
      chained += 1
    }
    latest.push(out[idxs[idxs.length - 1]])
  }
  return { rows: out, chained, latest }
}

/** Plain-English label for each replacement-check outcome. */
export const REPLACEMENT_STATUS_LABEL = Object.freeze({
  closed: 'Old tyre closed',
  would_close: 'Old tyre would be closed',
  no_previous: 'Wheel was empty',
  not_applicable: 'No wheel or date to check',
  same_tyre: 'Same tyre already on the wheel',
  ambiguous_multiple_active: 'Wheel already has two tyres - needs review',
  ambiguous_previous_undated: 'Current tyre has no fitting date - needs review',
  ambiguous_not_later: 'Uploaded tyre is older than the one on the wheel - needs review',
  ambiguous_backdated: 'A later tyre is already recorded on this wheel - needs review',
  ambiguous_same_day_stale: 'Same-day upload looks older than the tyre on the wheel - needs review',
  error: 'Could not check - needs review',
})

/** Summarise an RPC result into counts a person can read. */
export function summariseReconcile(result) {
  const counts = result?.counts || {}
  const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0)
  const review = Object.entries(counts)
    .filter(([k]) => k.startsWith('ambiguous') || k === 'error' || k === 'same_tyre')
    .reduce((a, [, v]) => a + (Number(v) || 0), 0)
  return {
    total,
    closed: (Number(counts.closed) || 0) + (Number(counts.would_close) || 0),
    emptyWheel: Number(counts.no_previous) || 0,
    review,
    moved: Number(result?.moved_from_other_vehicle) || 0,
  }
}
