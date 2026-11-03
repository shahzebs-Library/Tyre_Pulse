/**
 * observationTracking - has the tyre an observation is about already been replaced?
 *
 * One rule, borrowed whole from the Tyre Change Tracking report so the two can
 * never disagree: a tyre finding is resolved when a DIFFERENT tyre was fitted
 * on the same vehicle, at the same wheel, after the inspection date, according
 * to the uploaded fitment records (tyre_records). The matching is
 * `resolveFlag`; this file only turns an observation into the flag it reads.
 *
 *   replaced              - a newer tyre is on that wheel (date and serial shown)
 *   removed_not_replaced  - the tyre came off and nothing was fitted after it
 *   on_vehicle            - the same tyre is still fitted: still needs action
 *   unknown               - no fitment record covers that wheel, so we cannot tell
 *
 * "We could not tell" is never shown as "still fitted" or as "replaced".
 */
import { baseFlag, indexFitments, resolveFlag } from './tyreChangeTracking'

export const TYRE_NOW_META = {
  replaced: { label: 'Replaced', tone: 'good' },
  removed_not_replaced: { label: 'Removed, not replaced', tone: 'warn' },
  on_vehicle: { label: 'Still fitted', tone: 'bad' },
  unknown: { label: 'Not known', tone: 'muted' },
}

/** The tracking flag for one tyre observation. Null for notes and site observations. */
export function observationFlag(o) {
  if (!o || o.kind !== 'tyre') return null
  return baseFlag({
    source: 'user',
    kind: o.text,
    country: o.country,
    asset: o.asset_no,
    vehicleType: o.vehicleType,
    position: o.rawPosition || o.position,
    serial: o.serial || '',
    site: o.site,
    flaggedOn: o.day,
    origin: 'Inspection',
  })
}

/**
 * Attach `tyreNow` (resolveFlag's result) to every tyre observation. `fitments`
 * is null while the records are still loading or could not be read: then no
 * observation is given a status at all, rather than all of them reading "Not known".
 */
export function withTyreNow(list, fitments, { now = new Date() } = {}) {
  if (!Array.isArray(fitments)) return list || []
  const index = indexFitments(fitments)
  return (list || []).map((o) => {
    const flag = observationFlag(o)
    return flag ? { ...o, tyreNow: resolveFlag(flag, index, { now }) } : o
  })
}

/** Counts by tyre status. `open` is still fitted plus not known: nobody has shown it was dealt with. */
export function tyreNowSummary(list) {
  const out = { replaced: 0, removed_not_replaced: 0, on_vehicle: 0, unknown: 0, open: 0, tracked: 0 }
  for (const o of list || []) {
    const st = o?.tyreNow?.state
    if (!st) continue
    out.tracked += 1
    out[st] = (out[st] || 0) + 1
    if (st === 'on_vehicle' || st === 'unknown') out.open += 1
  }
  return out
}

/**
 * Filter by tyre status: 'all'; 'not_replaced' (the default view: everything except
 * findings whose tyre the records show was already changed, notes included);
 * 'open' (still fitted or not known); or one state.
 */
export function matchesTyreNow(o, filter) {
  if (!filter || filter === 'all') return true
  if (filter === 'not_replaced') return o?.tyreNow?.state !== 'replaced'
  if (o.kind !== 'tyre') return false
  const st = o?.tyreNow?.state
  if (filter === 'open') return st === 'on_vehicle' || st === 'unknown'
  return st === filter
}
