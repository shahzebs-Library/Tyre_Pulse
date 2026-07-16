/**
 * selfHealing.js - pure engine for the console Self-Healing module (Admin Control
 * Module 2). NO Supabase, NO React: deterministic functions that turn raw scan
 * results into a plain-English findings summary.
 *
 * SAFETY CONTRACT: this module never decides to DELETE or MUTATE anything. It only
 * classifies findings by severity and marks whether a SAFE, already-guarded fix
 * exists for them in the reconciliation layer:
 *   - orphan assets      -> warning, fixable (backfill the missing asset row)
 *   - duplicate tyres    -> warning, fixable ONLY because the reconciliation RPC
 *                           refuses to merge unless the rows are byte-identical
 *   - serial conflicts   -> info, read-only (a serial on two assets is a legitimate
 *                           tyre MOVEMENT between vehicles, never auto-touched)
 *   - stale sites        -> warning, read-only (a site silent for a while is flagged,
 *                           not "fixed" - it needs a human/data action)
 *   - predictive anomaly -> info, read-only (surface for review, never auto-resolve)
 *
 * All outputs degrade to honest empty results when there is nothing to report.
 */

/** A group (site) silent for this many days or more counts as stale. */
export const STALE_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/** Fixed severity mapping for each finding category (single source). */
const FINDING_SEVERITY = {
  orphans: 'warning',
  duplicates: 'warning',
  serialConflicts: 'info',
  stale: 'warning',
  anomalies: 'info',
}

/** Human labels for each finding category. */
const FINDING_LABEL = {
  orphans: 'Orphan assets',
  duplicates: 'Duplicate tyres',
  serialConflicts: 'Serial conflicts',
  stale: 'Stale sites',
  anomalies: 'Predictive anomalies',
}

/** Which categories carry a safe, already-guarded fix. */
const FINDING_FIXABLE = {
  orphans: true,
  duplicates: true,
  serialConflicts: false,
  stale: false,
  anomalies: false,
}

/**
 * Severity for a finding key. Unknown keys default to the least alarming band.
 * @param {string} key
 * @returns {'critical'|'warning'|'info'}
 */
export function severityForFinding(key) {
  return FINDING_SEVERITY[key] || 'info'
}

/**
 * Find groups (default: sites) that have gone silent for STALE_DAYS or more.
 *
 * `rows` is expected to be the latest activity per group ([{ site, created_at }]),
 * but the function is defensive: if a group appears more than once it keeps the
 * most recent timestamp, ignores rows with no group or an unparseable date, and
 * never throws.
 *
 * @param {Array<object>} rows
 * @param {object}  [opts]
 * @param {number|string|Date} [opts.now=Date.now()]  reference "now"
 * @param {string}  [opts.key='site']         grouping field
 * @param {string}  [opts.dateField='created_at'] last-activity field
 * @returns {Array<{ group: string, lastSeen: string, daysStale: number }>}
 *   sorted most-stale first
 */
export function detectStaleGroups(rows, { now = Date.now(), key = 'site', dateField = 'created_at' } = {}) {
  const nowMs = typeof now === 'number' ? now : new Date(now).getTime()
  const ref = Number.isFinite(nowMs) ? nowMs : Date.now()

  const latest = new Map() // group -> { t, raw }
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object') continue
    const group = r[key]
    if (group == null || group === '') continue
    const raw = r[dateField]
    if (!raw) continue
    const t = new Date(raw).getTime()
    if (Number.isNaN(t)) continue
    const prev = latest.get(group)
    if (!prev || t > prev.t) latest.set(group, { t, raw })
  }

  const out = []
  for (const [group, v] of latest) {
    const daysStale = Math.floor((ref - v.t) / DAY_MS)
    if (daysStale >= STALE_DAYS) {
      out.push({ group: String(group), lastSeen: v.raw, daysStale })
    }
  }
  return out.sort((a, b) => b.daysStale - a.daysStale)
}

/** Count helper: array length, or a numeric passthrough. */
function countOf(x) {
  if (Array.isArray(x)) return x.length
  const n = Number(x)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Roll raw scan buckets into a single findings summary. Honest and empty when
 * every bucket is empty (total 0, all severities 0, every item count 0).
 *
 * @param {object} [buckets]
 * @param {Array}  [buckets.orphans]
 * @param {Array}  [buckets.duplicates]
 * @param {Array}  [buckets.serialConflicts]
 * @param {Array}  [buckets.stale]
 * @param {Array}  [buckets.anomalies]
 * @returns {{
 *   total: number,
 *   bySeverity: { critical: number, warning: number, info: number },
 *   items: Array<{ key: string, label: string, severity: string, count: number, fixable: boolean }>
 * }}
 */
export function summarizeFindings({
  orphans = [],
  duplicates = [],
  serialConflicts = [],
  stale = [],
  anomalies = [],
} = {}) {
  const counts = {
    orphans: countOf(orphans),
    duplicates: countOf(duplicates),
    serialConflicts: countOf(serialConflicts),
    stale: countOf(stale),
    anomalies: countOf(anomalies),
  }

  const items = Object.keys(FINDING_LABEL).map((key) => ({
    key,
    label: FINDING_LABEL[key],
    severity: severityForFinding(key),
    count: counts[key],
    // Duplicates are only ever offered for merge because the reconciliation RPC
    // itself refuses non-identical rows; here we simply gate on there being any.
    fixable: FINDING_FIXABLE[key] && counts[key] > 0,
  }))

  const bySeverity = { critical: 0, warning: 0, info: 0 }
  let total = 0
  for (const it of items) {
    total += it.count
    if (bySeverity[it.severity] != null) bySeverity[it.severity] += it.count
  }

  return { total, bySeverity, items }
}
