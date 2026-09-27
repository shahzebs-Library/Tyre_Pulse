/**
 * driverCoachingAnalytics - pure view-model engine for the Driver
 * Leaderboard & Coaching page (/driver-coaching).
 *
 * Builds on `src/lib/driverCoaching.js` (the weighted overallScore) but fixes
 * one honesty gap at the view layer: a scorecard with NEITHER a safety nor a
 * fuel score is UNSCORED (null), not a score of 0. The base helper returns 0
 * there, which would rank such a driver last and flag them for coaching on no
 * evidence. Here unscored records are excluded from ranks/averages and
 * counted separately.
 *
 * No I/O. Deterministic.
 */
import { overallScore, toFiniteNumber } from './driverCoaching'
import { searchRows, sortRows, buildExport } from './consoleTable'

export const COACHING_THRESHOLD = 60
export const STATUS_OPTIONS = ['none', 'recommended', 'scheduled', 'completed']
export const STATUS_LABEL = {
  none: 'No coaching', recommended: 'Recommended', scheduled: 'Scheduled', completed: 'Completed',
}

const name = (r) => String(r?.driver_name ?? '').trim()
const status = (r) => {
  const s = String(r?.coaching_status ?? '').trim().toLowerCase()
  return STATUS_OPTIONS.includes(s) ? s : 'none'
}

/** Blended score, or null when no component score was recorded. */
export function scoreOf(r) {
  if (toFiniteNumber(r?.safety_score) == null && toFiniteNumber(r?.fuel_score) == null) return null
  return overallScore(r)
}

export function scoreBand(score) {
  if (score == null) return 'unscored'
  if (score >= 80) return 'good'
  if (score >= COACHING_THRESHOLD) return 'watch'
  return 'poor'
}

/**
 * One entry per driver: the scorecard from the latest period (period strings
 * compare lexically, e.g. 2026-09 > 2026-08), scored records only. Ranked
 * best-first; ties break on distance, then name.
 */
export function honestLeaderboard(rows = []) {
  const byDriver = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const n = name(r)
    const sc = scoreOf(r)
    if (!n || sc == null) continue
    const key = n.toLowerCase()
    const prev = byDriver.get(key)
    if (!prev || String(r.period || '') > String(prev.row.period || '')) byDriver.set(key, { row: r, score: sc })
  }
  const list = [...byDriver.values()].map(({ row, score }) => ({
    id: row.id,
    driver_name: name(row),
    overallScore: score,
    period: row.period || null,
    harsh_events: toFiniteNumber(row.harsh_events),
    distance_km: toFiniteNumber(row.distance_km),
    coaching_status: status(row),
  }))
  list.sort((a, b) => b.overallScore - a.overallScore
    || (b.distance_km ?? 0) - (a.distance_km ?? 0)
    || a.driver_name.localeCompare(b.driver_name))
  return list.map((e, i) => ({ ...e, rank: i + 1 }))
}

export function rankIndex(board = []) {
  const m = new Map()
  for (const b of board) m.set(b.driver_name.toLowerCase(), b.rank)
  return m
}

/** Records needing coaching: explicit recommended/scheduled, or scored below threshold. */
export function needsCoaching(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => name(r))
    .map((r) => ({ ...r, _score: scoreOf(r), _status: status(r) }))
    .filter((r) => r._status === 'recommended' || r._status === 'scheduled' || (r._score != null && r._score < COACHING_THRESHOLD))
    .sort((a, b) => (a._score ?? 101) - (b._score ?? 101))
}

export function enrichCoaching(rows = [], board = honestLeaderboard(rows)) {
  const ranks = rankIndex(board)
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    ...r,
    _score: scoreOf(r),
    _status: status(r),
    _rank: ranks.get(name(r).toLowerCase()) ?? null,
  }))
}

export function periodOptions(rows = []) {
  return [...new Set(rows.map((r) => r?.period).filter(Boolean))].sort().reverse()
}

export function filterCoaching(enriched = [], { status: st = '', period = '', band = '', search = '' } = {}) {
  const list = enriched.filter((r) => {
    if (st && r._status !== st) return false
    if (period && r.period !== period) return false
    if (band && scoreBand(r._score) !== band) return false
    return true
  })
  const searched = searchRows(list, search, ['driver_name', 'period', 'coach', 'coaching_notes', 'notes'])
  return sortRows(searched, { key: '_score', dir: 'desc' })
}

export function coachingKpis(rows = []) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => name(r))
  const board = honestLeaderboard(list)
  const scores = board.map((b) => b.overallScore)
  const flagged = new Set(needsCoaching(list).map((r) => name(r).toLowerCase()))
  const byStatus = { none: 0, recommended: 0, scheduled: 0, completed: 0 }
  for (const r of list) byStatus[status(r)] += 1
  const pipeline = byStatus.recommended + byStatus.scheduled + byStatus.completed
  const improvements = list.map((r) => toFiniteNumber(r.improvement_pct)).filter((v) => v != null)
  let harsh = 0; let km = 0; let exposure = 0
  for (const r of list) {
    const h = toFiniteNumber(r.harsh_events)
    const d = toFiniteNumber(r.distance_km)
    if (h != null && d != null && d > 0) { harsh += h; km += d; exposure += 1 }
  }
  return {
    records: list.length,
    driversScored: board.length,
    unscored: list.filter((r) => scoreOf(r) == null).length,
    avgScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    topScore: scores.length ? scores[0] : null,
    bottomScore: scores.length ? scores[scores.length - 1] : null,
    needsCoaching: flagged.size,
    byStatus,
    completionPct: pipeline ? Math.round((byStatus.completed / pipeline) * 1000) / 10 : null,
    avgImprovementPct: improvements.length ? Math.round((improvements.reduce((a, b) => a + b, 0) / improvements.length) * 10) / 10 : null,
    harshPer1000Km: km > 0 ? Math.round((harsh / km) * 1000 * 100) / 100 : null,
    exposureRecords: exposure,
  }
}

/** Score distribution for the band bars. */
export function bandDistribution(board = []) {
  const out = { good: 0, watch: 0, poor: 0 }
  for (const b of board) out[scoreBand(b.overallScore)] += 1
  return out
}

export const COACHING_EXPORT_COLUMNS = [
  { key: 'rank', header: 'Rank', value: (r) => r._rank ?? 'N/A' },
  { key: 'driver_name', header: 'Driver' },
  { key: 'overall', header: 'Overall', value: (r) => r._score ?? 'N/A' },
  { key: 'safety_score', header: 'Safety', value: (r) => toFiniteNumber(r.safety_score) ?? 'N/A' },
  { key: 'fuel_score', header: 'Fuel', value: (r) => toFiniteNumber(r.fuel_score) ?? 'N/A' },
  { key: 'harsh_events', header: 'Harsh events', value: (r) => toFiniteNumber(r.harsh_events) ?? 'N/A' },
  { key: 'idling_min', header: 'Idling (min)', value: (r) => toFiniteNumber(r.idling_min) ?? 'N/A' },
  { key: 'distance_km', header: 'Distance (km)', value: (r) => toFiniteNumber(r.distance_km) ?? 'N/A' },
  { key: 'coaching_status', header: 'Coaching', value: (r) => STATUS_LABEL[r._status] },
  { key: 'coach', header: 'Coach' },
  { key: 'improvement_pct', header: 'Improvement %', value: (r) => toFiniteNumber(r.improvement_pct) ?? 'N/A' },
  { key: 'period', header: 'Period' },
]

export function coachingExport(filtered = []) {
  return buildExport(filtered, COACHING_EXPORT_COLUMNS)
}
