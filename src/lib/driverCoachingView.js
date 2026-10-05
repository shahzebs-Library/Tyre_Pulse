/**
 * driverCoachingView - pure view model for the redesigned Driver Coaching
 * page (/driver-coaching). Builds on driverCoachingAnalytics (the honest
 * score, where a scorecard with no safety and no fuel score is UNSCORED, not
 * 0) and shapes the mockup's sections: the coaching queue, the per-driver
 * profile and score trend, fleet behaviour trends and the headline tiles.
 *
 * The driver_coaching table records a scorecard per driver per period:
 * safety/fuel score, harsh events, idling minutes, distance, coaching status,
 * coach, notes and improvement %. It has NO site, vehicle, session date,
 * due date, speeding, seatbelt or phone-use column, so those mockup values
 * are reported as not recorded by the page rather than invented here.
 *
 * No I/O. Deterministic.
 */
import { scoreOf, STATUS_LABEL, COACHING_THRESHOLD } from './driverCoachingAnalytics'
import { toFiniteNumber } from './driverCoaching'

const name = (r) => String(r?.driver_name ?? '').trim()
const statusOf = (r) => {
  const s = String(r?.coaching_status ?? '').trim().toLowerCase()
  return STATUS_LABEL[s] ? s : 'none'
}
const round1 = (n) => Math.round(n * 10) / 10

/** Risk level from the blended score. Lower score = higher risk. */
export function riskLevel(score) {
  if (score == null) return 'unscored'
  if (score < COACHING_THRESHOLD) return 'high'
  if (score < 80) return 'medium'
  return 'low'
}
export const RISK_LABEL = { high: 'High risk', medium: 'Medium risk', low: 'Low risk', unscored: 'Not scored' }
export const RISK_OPTIONS = ['high', 'medium', 'low', 'unscored']

/** Sort key for a scorecard's period: the period text, then the created time. */
function periodKey(r) {
  return `${String(r?.period || '')}|${String(r?.created_at || '')}`
}

/** Harsh events per 100 km for one scorecard, or null when not measurable. */
export function harshPer100Km(r) {
  const h = toFiniteNumber(r?.harsh_events)
  const d = toFiniteNumber(r?.distance_km)
  if (h == null || d == null || d <= 0) return null
  return round1((h / d) * 100)
}

/**
 * The behaviours this scorecard actually evidences. Only harsh events and
 * idling are recorded; nothing is inferred beyond them.
 */
export function topBehaviours(r) {
  const out = []
  const h = toFiniteNumber(r?.harsh_events)
  const idle = toFiniteNumber(r?.idling_min)
  if (h != null && h > 0) out.push(`Harsh events (${h})`)
  if (idle != null && idle > 0) out.push(`Idling (${idle} min)`)
  return out
}

/** All scorecards of one driver, oldest period first. */
export function driverHistory(rows = [], driverName = '') {
  const key = String(driverName || '').trim().toLowerCase()
  if (!key) return []
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => name(r).toLowerCase() === key)
    .sort((a, b) => periodKey(a).localeCompare(periodKey(b)))
}

/**
 * Coaching queue: one entry per driver from the latest scorecard, highest risk
 * first (lowest score), unscored drivers last. `rank` is the queue position.
 */
export function buildCoachingQueue(rows = []) {
  const latest = new Map()
  const counts = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const n = name(r)
    if (!n) continue
    const k = n.toLowerCase()
    counts.set(k, (counts.get(k) || 0) + 1)
    const prev = latest.get(k)
    if (!prev || periodKey(r) > periodKey(prev)) latest.set(k, r)
  }
  const list = [...latest.entries()].map(([k, r]) => {
    const score = scoreOf(r)
    return {
      key: k,
      id: r.id,
      driver_name: name(r),
      score,
      risk: riskLevel(score),
      behaviours: topBehaviours(r),
      harshPer100: harshPer100Km(r),
      coach: String(r.coach || '').trim() || null,
      status: statusOf(r),
      period: r.period || null,
      scorecards: counts.get(k) || 0,
      row: r,
    }
  })
  list.sort((a, b) => (a.score ?? 1000) - (b.score ?? 1000) || a.driver_name.localeCompare(b.driver_name))
  return list.map((e, i) => ({ ...e, rank: i + 1 }))
}

export function filterQueue(queue = [], { risk = '', status = '', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return queue.filter((e) => {
    if (risk && e.risk !== risk) return false
    if (status && e.status !== status) return false
    if (q) {
      const hay = [e.driver_name, e.coach, e.period, e.row?.coaching_notes, e.row?.notes].map((v) => String(v || '')).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Score points across a driver's periods (scored scorecards only). */
export function scoreTrend(history = []) {
  return history
    .map((r) => ({ label: r.period || (r.created_at ? String(r.created_at).slice(0, 10) : 'N/A'), score: scoreOf(r), status: statusOf(r) }))
    .filter((p) => p.score != null)
}

/** The most recent scorecard that carries a coaching step, else the latest. */
export function latestSession(history = []) {
  if (!history.length) return null
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (statusOf(history[i]) !== 'none') return history[i]
  }
  return history[history.length - 1]
}

/** Totals for a driver's scorecards. A total with no reading is null. */
export function driverTotals(history = []) {
  const sum = (field) => {
    const vals = history.map((r) => toFiniteNumber(r?.[field])).filter((v) => v != null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null
  }
  return { distanceKm: sum('distance_km'), harshEvents: sum('harsh_events'), idlingMin: sum('idling_min'), scorecards: history.length }
}

/**
 * Headline tiles. Overdue coaching has no source (no session or due date is
 * recorded), so it is returned as null for the page to label honestly.
 */
export function coachingHeadline(rows = []) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => name(r))
  const queue = buildCoachingQueue(list)
  const coached = new Set(list.filter((r) => statusOf(r) === 'completed').map((r) => name(r).toLowerCase()))
  const improvements = list.map((r) => toFiniteNumber(r.improvement_pct)).filter((v) => v != null)
  return {
    drivers: queue.length,
    coachedDrivers: coached.size,
    highRisk: queue.filter((e) => e.risk === 'high').length,
    scored: queue.filter((e) => e.score != null).length,
    openFollowUps: list.filter((r) => ['recommended', 'scheduled'].includes(statusOf(r))).length,
    overdue: null,
    avgImprovementPct: improvements.length ? round1(improvements.reduce((a, b) => a + b, 0) / improvements.length) : null,
    improvementRecords: improvements.length,
  }
}

/**
 * Fleet behaviour per period (last `max` periods, oldest first): harsh events
 * per 100 km (over scorecards with both figures) and mean idling minutes.
 * `change` compares the first and last period that both have a value.
 */
export function behaviourTrends(rows = [], max = 6) {
  const byPeriod = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const p = String(r?.period || '').trim()
    if (!p) continue
    if (!byPeriod.has(p)) byPeriod.set(p, [])
    byPeriod.get(p).push(r)
  }
  const periods = [...byPeriod.keys()].sort().slice(-max)
  const harsh = []; const idling = []
  for (const p of periods) {
    let h = 0; let km = 0; let hasH = false
    const idle = []
    for (const r of byPeriod.get(p)) {
      const hv = toFiniteNumber(r.harsh_events)
      const dv = toFiniteNumber(r.distance_km)
      if (hv != null && dv != null && dv > 0) { h += hv; km += dv; hasH = true }
      const iv = toFiniteNumber(r.idling_min)
      if (iv != null) idle.push(iv)
    }
    harsh.push({ label: p, value: hasH ? round1((h / km) * 100) : null })
    idling.push({ label: p, value: idle.length ? round1(idle.reduce((a, b) => a + b, 0) / idle.length) : null })
  }
  const change = (series) => {
    const pts = series.filter((s) => s.value != null)
    if (pts.length < 2 || pts[0].value === 0) return null
    return Math.round(((pts[pts.length - 1].value - pts[0].value) / pts[0].value) * 100)
  }
  return {
    periods,
    harsh: { series: harsh, change: change(harsh) },
    idling: { series: idling, change: change(idling) },
  }
}
