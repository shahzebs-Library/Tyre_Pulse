/**
 * Technician Scorecard — pure helpers (no I/O) that turn a flat list of
 * `work_orders` into a ranked, per-technician performance leaderboard.
 *
 * All functions are currency-agnostic and deterministic: they return raw
 * numbers only (the page formats for display) and never read the wall clock,
 * so the ranking logic lives in exactly one unit-tested place.
 *
 * Metrics per technician:
 *   - jobs            total work orders assigned
 *   - completed       work orders with status "Completed"
 *   - open            active work orders (Open / In Progress / Awaiting Parts)
 *   - cancelled       cancelled work orders
 *   - completionRate  completed / jobs  (%)
 *   - avgTurnaround   mean (completed_at - created_at) in DAYS over completed jobs
 *   - totalCost       Σ total_cost
 *   - avgCostPerJob   totalCost / jobs
 *   - score           composite 0–100 (see COMPOSITE_WEIGHTS)
 *   - rank            1-based position after sorting by score desc
 */

const UNASSIGNED = 'Unassigned'
const OPEN_STATUSES = new Set(['open', 'in progress', 'awaiting parts'])
const MS_PER_DAY = 24 * 3600 * 1000

/**
 * Composite score weights. Completion is weighted highest (throughput quality),
 * then turnaround speed (lower is better), then raw volume (experience/load).
 */
export const COMPOSITE_WEIGHTS = { completion: 0.5, turnaround: 0.3, volume: 0.2 }

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : Number(v)) || 0
const round1 = (v) => Math.round(v * 10) / 10

/** Turnaround for one work order, in DAYS. Null unless both dates valid & ordered. */
export function turnaroundDays(order) {
  if (!order?.created_at || !order?.completed_at) return null
  const start = new Date(order.created_at).getTime()
  const end = new Date(order.completed_at).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  const diff = (end - start) / MS_PER_DAY
  return diff < 0 ? null : round1(diff)
}

const statusKey = (o) => (o?.status || '').toString().trim().toLowerCase()

/**
 * Group work orders by technician and compute per-technician KPIs, a composite
 * score and a rank. Pure — pass the already-fetched rows.
 *
 * @param {Array<object>} workOrders  rows selected from `work_orders`
 * @returns {{ rows: Array<object>, totals: object }}
 */
export function summarizeTechnicians(workOrders) {
  const list = Array.isArray(workOrders) ? workOrders : []
  const map = new Map()

  for (const o of list) {
    const name = (o?.technician_name || o?.assigned_to || '').toString().trim() || UNASSIGNED
    let t = map.get(name)
    if (!t) {
      t = {
        technician: name,
        jobs: 0,
        completed: 0,
        open: 0,
        cancelled: 0,
        totalCost: 0,
        _taSum: 0,
        _taN: 0,
      }
      map.set(name, t)
    }
    t.jobs += 1
    t.totalCost += num(o?.total_cost)

    const s = statusKey(o)
    if (s === 'completed') {
      t.completed += 1
      const ta = turnaroundDays(o)
      if (ta != null) { t._taSum += ta; t._taN += 1 }
    } else if (s === 'cancelled') {
      t.cancelled += 1
    } else if (OPEN_STATUSES.has(s)) {
      t.open += 1
    }
  }

  const prelim = [...map.values()].map((t) => {
    const completionRate = t.jobs ? round1((t.completed / t.jobs) * 100) : 0
    const avgTurnaround = t._taN ? round1(t._taSum / t._taN) : null
    const avgCostPerJob = t.jobs ? Math.round(t.totalCost / t.jobs) : 0
    return {
      technician: t.technician,
      jobs: t.jobs,
      completed: t.completed,
      open: t.open,
      cancelled: t.cancelled,
      completionRate,
      avgTurnaround,
      totalCost: Math.round(t.totalCost),
      avgCostPerJob,
    }
  })

  // Normalisation bounds for the composite score.
  const maxJobs = prelim.reduce((m, r) => Math.max(m, r.jobs), 0) || 1
  const taValues = prelim.map((r) => r.avgTurnaround).filter((v) => v != null)
  const maxTa = taValues.length ? Math.max(...taValues, 1) : 1

  const scored = prelim.map((r) => {
    const volumeNorm = r.jobs / maxJobs                 // 0..1, higher better
    const taNorm = r.avgTurnaround == null ? 0.5 : r.avgTurnaround / maxTa // 0..1, lower better
    const score = Math.round(
      r.completionRate * COMPOSITE_WEIGHTS.completion +
      (1 - taNorm) * 100 * COMPOSITE_WEIGHTS.turnaround +
      volumeNorm * 100 * COMPOSITE_WEIGHTS.volume,
    )
    return { ...r, score }
  })

  scored.sort((a, b) =>
    b.score - a.score ||
    b.completionRate - a.completionRate ||
    b.jobs - a.jobs ||
    a.technician.localeCompare(b.technician),
  )
  scored.forEach((r, i) => { r.rank = i + 1 })

  return { rows: scored, totals: computeTotals(scored) }
}

/** Fleet-wide roll-up across the per-technician rows. */
export function computeTotals(rows) {
  const list = Array.isArray(rows) ? rows : []
  const technicians = list.length
  const totalJobs = list.reduce((s, r) => s + r.jobs, 0)
  const totalCompleted = list.reduce((s, r) => s + r.completed, 0)
  const totalOpen = list.reduce((s, r) => s + r.open, 0)
  const totalCost = list.reduce((s, r) => s + r.totalCost, 0)

  const avgCompletionRate = totalJobs ? round1((totalCompleted / totalJobs) * 100) : 0

  const taRows = list.filter((r) => r.avgTurnaround != null)
  const avgTurnaround = taRows.length
    ? round1(taRows.reduce((s, r) => s + r.avgTurnaround, 0) / taRows.length)
    : null

  return {
    technicians,
    totalJobs,
    totalCompleted,
    totalOpen,
    totalCost,
    avgCompletionRate,
    avgTurnaround,
  }
}

/** Rating badge derived from completion rate — presentation-agnostic label. */
export function completionRating(rate) {
  if (rate >= 95) return 'Excellent'
  if (rate >= 85) return 'Good'
  if (rate >= 70) return 'Average'
  return 'Needs Improvement'
}

// ============================================================================
// Technician Competency engine (ported from tyre_saas "Technician Skills Matrix")
// ----------------------------------------------------------------------------
// Deepens the scorecard from a pure work-order leaderboard into a competency
// platform: a versioned skill/cert taxonomy, proficiency banding, certification
// expiry logic, a skills matrix roll-up, an SLA-breach model derived from
// work-order priority + timestamps, and a skills-gap analysis. All pure and
// deterministic; wall-clock is injected (nowMs) so tests are stable.
// ============================================================================

const MS_PER_DAY_C = 86400000

/**
 * Skill taxonomy. Each entry: { skill_id, name, category, max_level }.
 * Categories group the matrix: core (everyday tyre work), hardware (bay
 * equipment), specialist (advanced/emerging), management (supervisory).
 */
export const SKILL_CATALOGUE = [
  { skill_id: 'tyre_change', name: 'Tyre Fitting & Removal', category: 'core', max_level: 3 },
  { skill_id: 'tyre_repair', name: 'Tyre Repair (Puncture/Section)', category: 'core', max_level: 3 },
  { skill_id: 'inspection_adv', name: 'Advanced Tyre Inspection', category: 'core', max_level: 3 },
  { skill_id: 'rotation_plan', name: 'Rotation Planning', category: 'core', max_level: 3 },
  { skill_id: 'wheel_balancing', name: 'Wheel Balancing', category: 'hardware', max_level: 3 },
  { skill_id: 'wheel_alignment', name: 'Wheel Alignment', category: 'hardware', max_level: 3 },
  { skill_id: 'tpms_service', name: 'TPMS Diagnostics & Service', category: 'specialist', max_level: 3 },
  { skill_id: 'rfid_ops', name: 'RFID Tyre Tagging & Ops', category: 'specialist', max_level: 3 },
  { skill_id: 'retread_prep', name: 'Retread Preparation', category: 'specialist', max_level: 3 },
  { skill_id: 'commercial_tyres', name: 'Commercial / OTR Tyres', category: 'specialist', max_level: 3 },
  { skill_id: 'electric_vehicles', name: 'EV Tyre Handling', category: 'specialist', max_level: 3 },
  { skill_id: 'supervisory', name: 'Workshop Supervision', category: 'management', max_level: 3 },
]

/**
 * Certification taxonomy. Each entry: { cert_id, name, issuer, validity_years }.
 * `validity_years` drives auto-computed expiry (issue_date + validity_years).
 */
export const CERT_CATALOGUE = [
  { cert_id: 'gcc_gso_g26', name: 'GCC GSO G26 Tyre Standard', issuer: 'GCC Standardization Organization', validity_years: 3 },
  { cert_id: 'uae_rta', name: 'UAE RTA Tyre Fitter', issuer: 'Roads & Transport Authority', validity_years: 2 },
  { cert_id: 'dot_basic', name: 'DOT Basic Tyre Service', issuer: 'US Department of Transportation', validity_years: 3 },
  { cert_id: 'tpms', name: 'TPMS Service Certification', issuer: 'Tire Industry Association', validity_years: 2 },
  { cert_id: 'bridgestone', name: 'Bridgestone Certified Technician', issuer: 'Bridgestone', validity_years: 2 },
  { cert_id: 'michelin', name: 'Michelin Certified Technician', issuer: 'Michelin', validity_years: 2 },
  { cert_id: 'continental', name: 'Continental Certified Technician', issuer: 'Continental', validity_years: 2 },
  { cert_id: 'gcc_ohs', name: 'GCC Occupational Health & Safety', issuer: 'GCC OHS Council', validity_years: 1 },
  { cert_id: 'first_aid', name: 'Workplace First Aid', issuer: 'Red Crescent', validity_years: 2 },
]

/** Proficiency level → human label. */
export const LEVEL_LABELS = { 1: 'Basic', 2: 'Proficient', 3: 'Expert' }

/** Lifecycle band → display label. */
export const LIFECYCLE_BAND_LABELS = {
  expert: 'Expert',
  proficient: 'Proficient',
  developing: 'Developing',
  needs_training: 'Needs Training',
  unrated: 'Unrated',
}

const SKILL_BY_ID = new Map(SKILL_CATALOGUE.map((s) => [s.skill_id, s]))
const CERT_BY_ID = new Map(CERT_CATALOGUE.map((c) => [c.cert_id, c]))

/** Look up a catalogue skill by id (undefined when unknown). */
export const skillById = (id) => SKILL_BY_ID.get(id)
/** Look up a catalogue cert by id (undefined when unknown). */
export const certById = (id) => CERT_BY_ID.get(id)

/**
 * Certification expiry status. `nowMs` is injectable for deterministic tests.
 * @param {string|Date|null} expiryDate
 * @param {number} [nowMs=Date.now()]
 * @returns {{ days: number|null, status: 'expired'|'warning'|'valid'|'unknown' }}
 *   status: 'unknown' (no date) · 'expired' (past) · 'warning' (<60 days) · 'valid'.
 */
export function certExpiryStatus(expiryDate, nowMs = Date.now()) {
  if (!expiryDate) return { days: null, status: 'unknown' }
  const exp = new Date(expiryDate).getTime()
  if (Number.isNaN(exp)) return { days: null, status: 'unknown' }
  const days = Math.floor((exp - nowMs) / MS_PER_DAY_C)
  if (days < 0) return { days, status: 'expired' }
  if (days < 60) return { days, status: 'warning' }
  return { days, status: 'valid' }
}

/**
 * Compute a certificate's expiry date from an issue date + a validity window.
 * Pure date math (UTC-safe); returns an ISO yyyy-mm-dd string or null.
 */
export function computeExpiry(issueDate, validityYears) {
  if (!issueDate || validityYears == null) return null
  const d = new Date(issueDate)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCFullYear(d.getUTCFullYear() + Number(validityYears))
  return d.toISOString().slice(0, 10)
}

/**
 * Composite technician lifecycle score (0–100) from delivery signals:
 *   volume (completed jobs, capped 500 → 40 pts) + quality (pass/completion
 *   rate → 50 pts) + certification breadth (capped 5 → 10 pts).
 * A technician with no completed work and a zero pass rate is 'unrated'.
 * @param {{ completed?:number, passRate?:number, certCount?:number }} input
 * @returns {{ score:number|null, band:string, label:string }}
 */
export function lifecycleScore({ completed = 0, passRate = 0, certCount = 0 } = {}) {
  const comp = num(completed)
  const pass = num(passRate)
  const certs = num(certCount)
  if (comp === 0 && pass === 0) {
    return { score: null, band: 'unrated', label: LIFECYCLE_BAND_LABELS.unrated }
  }
  const score = Math.min(
    100,
    Math.round(
      (Math.min(comp, 500) / 500) * 40 +
      (pass / 100) * 50 +
      Math.min(certs, 5) * 2,
    ),
  )
  const band =
    score >= 85 ? 'expert' :
    score >= 70 ? 'proficient' :
    score >= 50 ? 'developing' :
    'needs_training'
  return { score, band, label: `${LIFECYCLE_BAND_LABELS[band]} — ${score}/100` }
}

/**
 * Roll skill rows up into a per-skill matrix: L1/L2/L3 counts + total, joined
 * to the catalogue name/category. Sorted by total holders desc, then name.
 * Rows are `{ skill_id, level }` (extra fields ignored). Unknown skill_ids are
 * still bucketed (name falls back to the id) so nothing is silently dropped.
 * @param {Array<{skill_id?:string, level?:number}>} skillRows
 */
export function skillsMatrix(skillRows) {
  const list = Array.isArray(skillRows) ? skillRows : []
  const map = new Map()
  for (const r of list) {
    const id = (r?.skill_id || '').toString().trim()
    if (!id) continue
    let bucket = map.get(id)
    if (!bucket) {
      const cat = SKILL_BY_ID.get(id)
      bucket = {
        skill_id: id,
        name: cat?.name || id,
        category: cat?.category || 'other',
        l1: 0, l2: 0, l3: 0, total: 0,
      }
      map.set(id, bucket)
    }
    const lvl = Math.max(1, Math.min(3, Math.round(num(r?.level)) || 1))
    bucket[`l${lvl}`] += 1
    bucket.total += 1
  }
  return [...map.values()].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name),
  )
}

/** SLA response-time targets (hours) by work-order priority. */
export const SLA_HOURS = { emergency: 1, urgent: 4, high: 8, normal: 24, low: 72 }

/**
 * Whether a work order breached its priority SLA. If completed, judged on the
 * actual completion time; if still open, judged against `nowMs`. Unknown
 * priority or a missing created_at → treated as NOT breached (no target).
 * @param {string} priority
 * @param {string|Date} createdAt
 * @param {string|Date|null} completedAt
 * @param {number} [nowMs=Date.now()]
 * @returns {boolean}
 */
export function slaBreached(priority, createdAt, completedAt, nowMs = Date.now()) {
  const key = (priority || '').toString().trim().toLowerCase()
  const hours = SLA_HOURS[key]
  if (hours == null) return false
  if (!createdAt) return false
  const start = new Date(createdAt).getTime()
  if (Number.isNaN(start)) return false
  const due = start + hours * 3600 * 1000
  if (completedAt) {
    const end = new Date(completedAt).getTime()
    if (Number.isNaN(end)) return false
    return end > due
  }
  return nowMs > due
}

/**
 * SLA compliance % over a set of work orders. Only orders with a known priority
 * and a valid created_at are considered; returns null when none qualify.
 * @param {Array<object>} orders
 * @param {number} [nowMs=Date.now()]
 * @returns {number|null}
 */
export function slaCompliancePct(orders, nowMs = Date.now()) {
  const list = Array.isArray(orders) ? orders : []
  let considered = 0
  let breached = 0
  for (const o of list) {
    const key = (o?.priority || '').toString().trim().toLowerCase()
    if (SLA_HOURS[key] == null || !o?.created_at) continue
    considered += 1
    if (slaBreached(o.priority, o.created_at, o.completed_at, nowMs)) breached += 1
  }
  if (considered === 0) return null
  return round1(((considered - breached) / considered) * 100)
}

/**
 * Skills a technician does NOT yet hold — the catalogue minus the held ids.
 * Returns the catalogue entries (so the UI has name + category), catalogue order.
 * @param {Array<string>} userSkillIds
 */
export function skillsGap(userSkillIds) {
  const held = new Set((Array.isArray(userSkillIds) ? userSkillIds : []).map((v) => String(v)))
  return SKILL_CATALOGUE.filter((s) => !held.has(s.skill_id))
}
