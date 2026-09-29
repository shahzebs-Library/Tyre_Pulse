/**
 * odometerLogsView.js - pure view engine for the redesigned Odometer Logs page
 * (src/pages/OdometerLogs.jsx). No I/O, no React. `today` is always passed in as
 * the country-local YYYY-MM-DD so every figure is deterministic.
 *
 * Rules stated on screen and kept honest here:
 *   - There is NO approval column on odometer_logs / engine_hours_logs. A saved
 *     reading is accepted; a reading below the previous one is accepted but
 *     flagged (V340) and waits for an Admin review. The status of a reading is
 *     therefore Accepted, Awaiting Admin review, Reviewed by Admin, or
 *     Suspicious jump (a client-side check below). Never "Approved".
 *   - Suspicious jump: kilometres rose by at least `jumpMinKm` AND by more than
 *     `maxKmPerDay` per elapsed day (minimum one day); engine hours rose by more
 *     than `maxHoursPerDay` per elapsed day. Only dated readings are compared.
 *   - Missing reading: a vehicle that uses a meter and has no dated reading in
 *     the last `missingDays` days (or has never had one).
 *   - Distance travelled: positive kilometre increases between consecutive
 *     dated readings of the same vehicle, excluding decreases and suspicious
 *     jumps, credited to the date of the later reading.
 *   - Data accuracy: share of readings in view that pass both checks (not
 *     awaiting review, not a suspicious jump). N/A when there are no readings.
 */
import { meterSource } from './vehicleMeters'

export const DEFAULT_VIEW_SETTINGS = Object.freeze({
  missingDays: 30,
  maxKmPerDay: 1500,
  jumpMinKm: 3000,
  maxHoursPerDay: 24,
})

const LIMITS = {
  missingDays: [1, 365],
  maxKmPerDay: [100, 20000],
  jumpMinKm: [0, 100000],
  maxHoursPerDay: [1, 24],
}

/** Clamp and fill a settings object; unknown or junk values fall back to defaults. */
export function normalizeViewSettings(raw) {
  const out = { ...DEFAULT_VIEW_SETTINGS }
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const n = Number(raw?.[key])
    if (raw?.[key] !== '' && raw?.[key] != null && Number.isFinite(n)) out[key] = Math.min(max, Math.max(min, Math.round(n)))
  }
  return out
}

const MS_DAY = 86400000
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const dayMs = (iso) => (ISO_DAY.test(String(iso || '').slice(0, 10)) ? Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) : NaN)
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10)
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v))
export const readingKey = (r) => `${r?.kind}:${r?.id}`
const assetKey = (r) => `${r?.organisation_id ?? ''}|${r?.country ?? ''}|${String(r?.asset_no || '').trim().toUpperCase()}`

/* ---------------------------------------------------------------- sources */

export const SOURCE_GROUPS = [
  { key: 'telematics', label: 'Telematics', color: '#2563eb' },
  { key: 'manual', label: 'Manual', color: '#16a34a' },
  { key: 'mobile', label: 'Mobile app', color: '#f59e0b' },
  { key: 'other', label: 'Other (import, tyre change, not recorded)', color: '#94a3b8' },
]

/** Telematics / Manual / Mobile app, or 'other' for imports and unrecorded sources. */
export function sourceGroup(source) {
  const s = meterSource(source)
  if (s === 'Telematics') return 'telematics'
  if (s === 'Mobile') return 'mobile'
  if (s === 'Web Manual' || s === 'Manual entry') return 'manual'
  return 'other'
}

export const sourceGroupLabel = (source) => SOURCE_GROUPS.find((g) => g.key === sourceGroup(source)).label.replace(/ \(.*\)$/, '')

/** Donut segments; the "Other" slice is shown only when it holds readings. */
export function sourceDistribution(rows) {
  const counts = { telematics: 0, manual: 0, mobile: 0, other: 0 }
  for (const r of rows || []) counts[sourceGroup(r.source)]++
  return SOURCE_GROUPS
    .filter((g) => g.key !== 'other' || counts.other > 0)
    .map((g) => ({ key: g.key, label: g.label, color: g.color, count: counts[g.key] }))
}

/* ---------------------------------------------------------------- series */

/** Per vehicle and meter kind, dated readings in time order. */
function seriesByAsset(rows) {
  const map = new Map()
  for (const r of rows || []) {
    if (num(r?.value) == null || !Number.isFinite(dayMs(r?.reading_date))) continue
    const key = `${r.kind}|${assetKey(r)}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(r)
  }
  for (const list of map.values()) {
    list.sort((a, b) => String(a.reading_date).localeCompare(String(b.reading_date))
      || String(a.created_at || '').localeCompare(String(b.created_at || ''))
      || num(a.value) - num(b.value))
  }
  return map
}

/** Consecutive pairs: { prev, cur, delta, days, perDay, jump }. */
function pairs(rows, settings) {
  const s = normalizeViewSettings(settings)
  const out = []
  for (const list of seriesByAsset(rows).values()) {
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]; const cur = list[i]
      const delta = num(cur.value) - num(prev.value)
      const days = Math.round((dayMs(cur.reading_date) - dayMs(prev.reading_date)) / MS_DAY)
      const perDay = delta / Math.max(days, 1)
      const jump = cur.kind === 'hours'
        ? delta > 0 && perDay > s.maxHoursPerDay
        : delta >= s.jumpMinKm && perDay > s.maxKmPerDay
      out.push({ prev, cur, delta, days, perDay, jump })
    }
  }
  return out
}

/** Suspicious jumps, newest first. Each carries the reading and the one before it. */
export function findJumps(rows, settings) {
  return pairs(rows, settings)
    .filter((p) => p.jump)
    .map((p) => ({
      key: readingKey(p.cur), reading: p.cur, previous: p.prev, kind: p.cur.kind,
      delta: p.delta, days: p.days, perDay: Math.round(p.perDay * 10) / 10,
    }))
    .sort((a, b) => String(b.reading.reading_date).localeCompare(String(a.reading.reading_date)))
}

/* ---------------------------------------------------------------- status */

export const STATUS_META = {
  accepted: { label: 'Accepted', tone: 'good' },
  review: { label: 'Awaiting Admin review', tone: 'warn' },
  reviewed: { label: 'Reviewed by Admin', tone: 'info' },
  jump: { label: 'Suspicious jump', tone: 'bad' },
}

/** accepted | review | reviewed | jump. The server flag wins over the client check. */
export function readingStatus(r, jumpKeys) {
  if (r?.flagged && !r?.reviewed) return 'review'
  if (r?.flagged && r?.reviewed) return 'reviewed'
  if (jumpKeys?.has?.(readingKey(r))) return 'jump'
  return 'accepted'
}

/** Readings awaiting an Admin review (V340 accept-but-flag). */
export const approvalQueue = (rows) => (rows || []).filter((r) => r.flagged && !r.reviewed)

/* ---------------------------------------------------------------- missing */

const latestDated = (v) => [v?.kmLog?.reading_date, v?.hoursLog?.reading_date]
  .filter((d) => Number.isFinite(dayMs(d))).sort().at(-1) || null

/**
 * Vehicles that use a meter and have no dated reading within `missingDays`.
 * daysSince is null when the vehicle has never had a dated reading.
 */
export function missingReadings(vehicles, today, settings) {
  const s = normalizeViewSettings(settings)
  const t = dayMs(today)
  const out = []
  for (const v of vehicles || []) {
    if (!v?.supportsKm && !v?.supportsHours) continue
    const last = latestDated(v)
    const daysSince = last && Number.isFinite(t) ? Math.round((t - dayMs(last)) / MS_DAY) : null
    if (last == null || daysSince > s.missingDays) out.push({ vehicle: v, lastDate: last, daysSince })
  }
  return out.sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity) || String(a.vehicle.asset_no).localeCompare(String(b.vehicle.asset_no)))
}

/* ---------------------------------------------------------------- KPIs */

export function viewKpis({ rows, vehicles, jumps, missing }) {
  const list = rows || []
  const jumpKeys = new Set((jumps || []).map((j) => j.key))
  const review = approvalQueue(list).length
  const failing = list.filter((r) => (r.flagged && !r.reviewed) || jumpKeys.has(readingKey(r))).length
  const reporting = new Set(list.map(assetKey)).size
  return {
    total: list.length,
    vehicles: (vehicles || []).length,
    reporting,
    missing: (missing || []).length,
    jumps: jumpKeys.size,
    review,
    accuracyPct: list.length ? Math.round(((list.length - failing) / list.length) * 1000) / 10 : null,
  }
}

/* ---------------------------------------------------------------- distance */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`

/** Bucket list for a grain ending `today`: daily 30 days, weekly 12 (Monday start), monthly 12. */
export function distanceBuckets(grain, today) {
  const t = dayMs(today)
  if (!Number.isFinite(t)) return []
  const out = []
  if (grain === 'monthly') {
    const d = new Date(t)
    for (let i = 11; i >= 0; i--) {
      const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1))
      const key = isoOf(m.getTime()).slice(0, 7)
      out.push({ key, label: `${MONTHS[m.getUTCMonth()]} ${String(m.getUTCFullYear()).slice(2)}` })
    }
    return out
  }
  if (grain === 'weekly') {
    const dow = (new Date(t).getUTCDay() + 6) % 7
    const monday = t - dow * MS_DAY
    for (let i = 11; i >= 0; i--) {
      const key = isoOf(monday - i * 7 * MS_DAY)
      out.push({ key, label: dayLabel(key) })
    }
    return out
  }
  for (let i = 29; i >= 0; i--) {
    const key = isoOf(t - i * MS_DAY)
    out.push({ key, label: dayLabel(key) })
  }
  return out
}

function bucketOf(grain, iso) {
  if (grain === 'monthly') return iso.slice(0, 7)
  if (grain === 'weekly') {
    const t = dayMs(iso)
    return isoOf(t - ((new Date(t).getUTCDay() + 6) % 7) * MS_DAY)
  }
  return iso.slice(0, 10)
}

/**
 * Distance travelled per bucket. { points: [{key,label,km}], total, measured }
 * measured = kilometre increases counted; 0 means the chart has nothing to show.
 */
export function distanceSeries(rows, grain, today, settings) {
  const buckets = distanceBuckets(grain, today)
  const totals = new Map(buckets.map((b) => [b.key, 0]))
  let measured = 0
  for (const p of pairs((rows || []).filter((r) => r.kind === 'km'), settings)) {
    if (p.delta <= 0 || p.jump) continue
    const key = bucketOf(grain, String(p.cur.reading_date).slice(0, 10))
    if (!totals.has(key)) continue
    totals.set(key, totals.get(key) + p.delta)
    measured++
  }
  const points = buckets.map((b) => ({ ...b, km: Math.round(totals.get(b.key)) }))
  return { points, total: points.reduce((s, p) => s + p.km, 0), measured }
}

/* ---------------------------------------------------------------- exports */

export function readingExportRows(rows, jumpKeys) {
  return (rows || []).map((r) => ({
    reading_date: r.reading_date || '',
    fleet_no: r.asset_no || '',
    registration: r.registration_no || '',
    make_model: [r.make, r.model].filter(Boolean).join(' ') || '',
    odometer_km: r.kind === 'km' ? num(r.value) : '',
    engine_hours: r.kind === 'hours' ? num(r.value) : '',
    location: r.site || '',
    country: r.country || '',
    source: sourceGroupLabel(r.source),
    status: STATUS_META[readingStatus(r, jumpKeys)].label,
  }))
}

/**
 * Anomalies tab: server-flagged readings (lower than the previous one, V340)
 * plus client-side suspicious jumps. A reading that is both appears once, as
 * the server flag, because that is the one an Admin must act on.
 */
export function anomalyRows(rows, jumps) {
  const out = []
  const seen = new Set()
  for (const r of rows || []) {
    if (!r.flagged) continue
    seen.add(readingKey(r))
    out.push({ key: readingKey(r), type: 'regression', label: 'Lower than previous reading', reading: r, detail: r.flag_reason || 'Saved below the last recorded reading' })
  }
  for (const j of jumps || []) {
    if (seen.has(j.key)) continue
    const unit = j.kind === 'hours' ? 'hours' : 'km'
    out.push({
      key: j.key, type: 'jump', label: 'Suspicious jump', reading: j.reading,
      detail: `Up ${Math.round(j.delta).toLocaleString('en-US')} ${unit} in ${j.days} day${j.days === 1 ? '' : 's'} (about ${Math.round(j.perDay).toLocaleString('en-US')} ${unit} a day)`,
    })
  }
  return out.sort((a, b) => String(b.reading.reading_date || '').localeCompare(String(a.reading.reading_date || '')))
}
