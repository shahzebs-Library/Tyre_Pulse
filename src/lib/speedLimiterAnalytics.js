/**
 * Speed Limiter compliance analytics - pure helpers (no I/O, deterministic).
 *
 * Speed governors ("speed limiters") are a GCC legal requirement: every heavy
 * asset must carry a working, correctly-set governor and it must be re-verified
 * / re-calibrated periodically (annually in most GCC jurisdictions). The
 * `speed_limiters` table (V153) carries the real columns:
 *   asset_no, limit_kph (numeric), device_id, last_verified_at (date),
 *   status ('active'|'disabled'|'fault'), site, notes, country.
 *
 * IMPORTANT (honesty): the table has NO dedicated calibration-expiry column. We
 * DERIVE a next-verification-due date = last_verified_at + a tunable
 * re-verification interval (default 365 days) rather than inventing a column.
 * Records with no last_verified_at are surfaced as "Not verified" - never
 * assumed compliant.
 *
 * Every time-dependent function accepts an injectable `asOf` so results are
 * fully unit-testable and free of ambient state.
 */

export const SPEED_LIMITER_STATUSES = ['active', 'disabled', 'fault']

export const SPEED_LIMITER_STATUS_META = {
  active: { label: 'Active', tone: 'green' },
  disabled: { label: 'Disabled', tone: 'slate' },
  fault: { label: 'Fault', tone: 'red' },
}

/** Default GCC re-verification / re-calibration cadence (days). Tunable. */
export const DEFAULT_REVERIFY_DAYS = 365
/** Default "expiring soon" horizon before the next-due date (days). Tunable. */
export const DEFAULT_EXPIRING_SOON_DAYS = 30

/** Verification bands derived from last_verified_at + the re-verify interval. */
export const VERIFICATION_BANDS = ['valid', 'expiring', 'expired', 'unverified']

export const VERIFICATION_BAND_META = {
  valid: { label: 'Verified', tone: 'green' },
  expiring: { label: 'Expiring soon', tone: 'amber' },
  expired: { label: 'Verification overdue', tone: 'red' },
  unverified: { label: 'Not verified', tone: 'slate' },
}

const MS_PER_DAY = 86400000

/** Coerce a value to a finite number, or null. */
export function toNumber(value) {
  if (value === '' || value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/** Parse a date-like value into a Date at UTC midnight, or null when invalid. */
export function parseDate(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const s = String(value).trim()
  if (!s) return null
  // Date-only strings (YYYY-MM-DD) parse as UTC midnight already.
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Whole-day difference (b - a), or null when either is unparseable. */
export function daysBetween(a, b) {
  const da = parseDate(a)
  const db = parseDate(b)
  if (!da || !db) return null
  return Math.round((db.getTime() - da.getTime()) / MS_PER_DAY)
}

/**
 * Next verification-due date for a limiter = last_verified_at + reverifyDays.
 * Returns null when the record was never verified.
 */
export function nextDueDate(row, reverifyDays = DEFAULT_REVERIFY_DAYS) {
  const verified = parseDate(row?.last_verified_at)
  if (!verified) return null
  const days = toNumber(reverifyDays) ?? DEFAULT_REVERIFY_DAYS
  return new Date(verified.getTime() + days * MS_PER_DAY)
}

/**
 * Days until the next verification is due (negative = overdue). Null when the
 * record was never verified.
 */
export function daysToNextDue(row, { asOf = new Date(), reverifyDays = DEFAULT_REVERIFY_DAYS } = {}) {
  const due = nextDueDate(row, reverifyDays)
  if (!due) return null
  const ref = parseDate(asOf) || new Date()
  return Math.round((due.getTime() - ref.getTime()) / MS_PER_DAY)
}

/**
 * Verification band for a single limiter:
 *   unverified - no last_verified_at
 *   expired    - next-due date already passed
 *   expiring   - next-due within `expiringSoonDays`
 *   valid      - otherwise
 */
export function verificationBand(
  row,
  { asOf = new Date(), reverifyDays = DEFAULT_REVERIFY_DAYS, expiringSoonDays = DEFAULT_EXPIRING_SOON_DAYS } = {},
) {
  const days = daysToNextDue(row, { asOf, reverifyDays })
  if (days == null) return 'unverified'
  if (days < 0) return 'expired'
  const soon = toNumber(expiringSoonDays) ?? DEFAULT_EXPIRING_SOON_DAYS
  if (days <= soon) return 'expiring'
  return 'valid'
}

/**
 * A limiter is compliant when it is fitted (status active) AND its verification
 * is current (band valid or expiring soon). Fault, disabled, expired-verification
 * and never-verified are all non-compliant.
 */
export function isCompliant(row, opts = {}) {
  if (row?.status !== 'active') return false
  const band = verificationBand(row, opts)
  return band === 'valid' || band === 'expiring'
}

/** Human reason a limiter is non-compliant, or null when it is compliant. */
export function nonComplianceReason(row, opts = {}) {
  if (row?.status === 'fault') return 'Limiter in fault'
  if (row?.status === 'disabled') return 'Limiter disabled'
  const band = verificationBand(row, opts)
  if (band === 'unverified') return 'Never verified'
  if (band === 'expired') return 'Verification overdue'
  return null
}

/**
 * Roll a list of limiters into a compliance summary. All time-dependent buckets
 * accept the same injectable `asOf` / thresholds.
 *
 * @returns {{
 *   total:number, byStatus:{active:number,disabled:number,fault:number},
 *   faults:number, disabled:number, avgLimit:number|null,
 *   byBand:{valid:number,expiring:number,expired:number,unverified:number},
 *   verified:number, unverified:number, expired:number, expiringSoon:number,
 *   compliant:number, nonCompliant:number, complianceRate:number|null,
 *   verifiedRate:number|null, sites:number, devices:number
 * }}
 */
export function summarizeSpeedLimiters(rows = [], opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  const byStatus = { active: 0, disabled: 0, fault: 0 }
  const byBand = { valid: 0, expiring: 0, expired: 0, unverified: 0 }
  let limitSum = 0
  let limitCount = 0
  let compliant = 0
  const sites = new Set()
  const devices = new Set()

  for (const r of list) {
    if (byStatus[r?.status] != null) byStatus[r.status] += 1
    const band = verificationBand(r, opts)
    if (byBand[band] != null) byBand[band] += 1
    const limit = toNumber(r?.limit_kph)
    if (limit != null) { limitSum += limit; limitCount += 1 }
    if (isCompliant(r, opts)) compliant += 1
    if (r?.site) sites.add(String(r.site).trim())
    if (r?.device_id) devices.add(String(r.device_id).trim())
  }

  const total = list.length
  return {
    total,
    byStatus,
    faults: byStatus.fault,
    disabled: byStatus.disabled,
    avgLimit: limitCount ? Math.round((limitSum / limitCount) * 10) / 10 : null,
    byBand,
    verified: byBand.valid + byBand.expiring + byBand.expired,
    unverified: byBand.unverified,
    expired: byBand.expired,
    expiringSoon: byBand.expiring,
    compliant,
    nonCompliant: total - compliant,
    complianceRate: total ? Math.round((compliant / total) * 1000) / 10 : null,
    verifiedRate: total ? Math.round(((byBand.valid + byBand.expiring + byBand.expired) / total) * 1000) / 10 : null,
    sites: sites.size,
    devices: devices.size,
  }
}

/**
 * Distribution of governed set-speeds (limit_kph). Returns [{ limit, count }]
 * sorted by limit ascending. Records without a limit are grouped under null.
 */
export function setSpeedDistribution(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()
  for (const r of list) {
    const limit = toNumber(r?.limit_kph)
    const key = limit == null ? null : limit
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()]
    .map(([limit, count]) => ({ limit, count }))
    .sort((a, b) => {
      if (a.limit == null) return 1
      if (b.limit == null) return -1
      return a.limit - b.limit
    })
}

/**
 * Per-site fleet coverage: how many fleet assets carry an ACTIVE governed
 * limiter. `fleet` is a list of { asset_no, site } (e.g. vehicle_fleet rows);
 * `limiters` is the speed_limiters list. Coverage is honest - when no fleet
 * data is supplied, `bySite` still reports registered limiters but coverage
 * ratios are null (we cannot know the denominator).
 *
 * @returns {{
 *   bySite: Array<{ site:string, fleet:number, registered:number, active:number,
 *                   uncovered:number, coverage:number|null }>,
 *   overall: { fleet:number, registered:number, active:number, coverage:number|null },
 *   missingLimiter: string[],   // fleet asset_no with NO limiter row
 *   hasFleet: boolean
 * }}
 */
export function bySiteCoverage(limiters = [], fleet = []) {
  const lims = Array.isArray(limiters) ? limiters : []
  const flt = Array.isArray(fleet) ? fleet : []
  const hasFleet = flt.length > 0

  const norm = (v) => String(v ?? '').trim()
  const siteOf = (v) => norm(v) || 'Unassigned'

  // Index limiters by asset_no: does the asset have any / an active limiter.
  const anyByAsset = new Map()   // asset_no -> true
  const activeByAsset = new Map()
  for (const l of lims) {
    const a = norm(l?.asset_no)
    if (!a) continue
    anyByAsset.set(a, true)
    if (l?.status === 'active') activeByAsset.set(a, true)
  }

  const bucket = new Map() // site -> { fleet, registered, active, assets:Set }
  const ensure = (site) => {
    const key = siteOf(site)
    if (!bucket.has(key)) bucket.set(key, { site: key, fleet: 0, registered: 0, active: 0 })
    return bucket.get(key)
  }

  const missingLimiter = []
  if (hasFleet) {
    for (const v of flt) {
      const a = norm(v?.asset_no)
      const b = ensure(v?.site)
      b.fleet += 1
      if (a && anyByAsset.has(a)) b.registered += 1
      else if (a) missingLimiter.push(a)
      if (a && activeByAsset.has(a)) b.active += 1
    }
  } else {
    // No fleet reference: report limiters grouped by their own site.
    for (const l of lims) {
      const b = ensure(l?.site)
      b.registered += 1
      if (l?.status === 'active') b.active += 1
    }
  }

  const bySite = [...bucket.values()]
    .map((b) => ({
      ...b,
      uncovered: hasFleet ? Math.max(0, b.fleet - b.active) : 0,
      coverage: hasFleet && b.fleet ? Math.round((b.active / b.fleet) * 1000) / 10 : null,
    }))
    .sort((a, b) => {
      // Worst coverage first when we have fleet data, else most limiters first.
      if (hasFleet) {
        const ca = a.coverage == null ? 101 : a.coverage
        const cb = b.coverage == null ? 101 : b.coverage
        if (ca !== cb) return ca - cb
      }
      return b.registered - a.registered
    })

  const totalFleet = flt.length
  const activeAssets = hasFleet
    ? flt.filter((v) => activeByAsset.has(norm(v?.asset_no))).length
    : activeByAsset.size
  const registeredAssets = hasFleet
    ? flt.filter((v) => anyByAsset.has(norm(v?.asset_no))).length
    : anyByAsset.size

  return {
    bySite,
    overall: {
      fleet: totalFleet,
      registered: registeredAssets,
      active: activeAssets,
      coverage: hasFleet && totalFleet ? Math.round((activeAssets / totalFleet) * 1000) / 10 : null,
    },
    missingLimiter,
    hasFleet,
  }
}

/**
 * Non-compliant limiters (fault / disabled / verification overdue / never
 * verified), each tagged with a reason and days-to-next-due, sorted with the
 * most urgent first (faults, then most-overdue verification).
 */
export function nonCompliantList(rows = [], opts = {}) {
  const list = Array.isArray(rows) ? rows : []
  return list
    .map((r) => ({
      row: r,
      reason: nonComplianceReason(r, opts),
      band: verificationBand(r, opts),
      daysToDue: daysToNextDue(r, opts),
    }))
    .filter((x) => x.reason != null)
    .sort((a, b) => {
      // Faults are the most urgent.
      const fa = a.row?.status === 'fault' ? 0 : 1
      const fb = b.row?.status === 'fault' ? 0 : 1
      if (fa !== fb) return fa - fb
      // Then by soonest / most-overdue due date (null = never verified last).
      const da = a.daysToDue == null ? Infinity : a.daysToDue
      const db = b.daysToDue == null ? Infinity : b.daysToDue
      return da - db
    })
}

/**
 * Sort limiters by soonest verification expiry first. Overdue (negative days)
 * float to the top; never-verified records sink to the bottom.
 * `direction` 'asc' (soonest first, default) or 'desc'.
 */
export function sortByExpiry(rows = [], { direction = 'asc', ...opts } = {}) {
  const list = Array.isArray(rows) ? [...rows] : []
  const dir = direction === 'desc' ? -1 : 1
  return list.sort((a, b) => {
    const da = daysToNextDue(a, opts)
    const db = daysToNextDue(b, opts)
    const va = da == null ? Infinity : da
    const vb = db == null ? Infinity : db
    if (va === vb) return 0
    // never-verified (Infinity) always last regardless of direction
    if (va === Infinity) return 1
    if (vb === Infinity) return -1
    return (va - vb) * dir
  })
}

/**
 * Filter a limiter list by status / site / verification band / free-text search
 * (asset, device, site, notes) and an optional last_verified_at date range.
 */
export function filterSpeedLimiters(rows = [], filters = {}) {
  const list = Array.isArray(rows) ? rows : []
  const { status = 'all', site = '', band = 'all', search = '', from = '', to = '' } = filters
  const q = String(search || '').trim().toLowerCase()
  const fromD = parseDate(from)
  const toD = parseDate(to)
  const bandOpts = filters // reuse asOf/reverifyDays/expiringSoonDays if provided

  return list.filter((r) => {
    if (status !== 'all' && r?.status !== status) return false
    if (site && String(r?.site ?? '').trim() !== String(site).trim()) return false
    if (band !== 'all' && verificationBand(r, bandOpts) !== band) return false
    if (fromD || toD) {
      const v = parseDate(r?.last_verified_at)
      if (!v) return false
      if (fromD && v.getTime() < fromD.getTime()) return false
      if (toD && v.getTime() > toD.getTime()) return false
    }
    if (q) {
      const hay = `${r?.asset_no || ''} ${r?.device_id || ''} ${r?.site || ''} ${r?.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}
