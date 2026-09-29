/**
 * serialTrackerView - pure view logic for the redesigned Serial Tracker page
 * (/serial-tracker). No I/O, no React. Lifecycle maths (price, days in
 * service, active) stay in serialTrackerAnalytics; this module turns one
 * serial's tyre records into the mockup's blocks: status pill, current
 * assignment, movement history and life and usage series.
 *
 * Honesty rules:
 *   - A serial is not a unique tyre id; the records are fitments of it.
 *   - Distance is taken from the record (total_km, else removal minus fitment
 *     odometer). A missing or non-positive reading is null, never 0.
 *   - Nothing is invented for columns tyre_records does not carry (pattern,
 *     load index, speed rating, DOT, temperature, who fitted the tyre).
 */

/** Status token on tyre_records -> the label and tone the page shows. */
export const STATUS_META = {
  Active: { label: 'Installed', tone: 'good' },
  Removed: { label: 'Removed', tone: 'info' },
  Scrapped: { label: 'Disposed', tone: 'bad' },
}

/** Status filter options: the stored value and the label the page uses. */
export const STATUS_OPTIONS = Object.entries(STATUS_META).map(([value, m]) => ({ value, label: m.label }))

export function statusMeta(status, { scrapped = false } = {}) {
  if (scrapped) return STATUS_META.Scrapped
  const key = String(status || '').trim()
  return STATUS_META[key] || { label: key || 'Unknown', tone: 'muted' }
}

/** Trim spaces, tabs and line breaks: serials are stored padded on some imports. */
export function cleanSerial(v) {
  return String(v ?? '').replace(/^[\s\t\r\n]+|[\s\t\r\n]+$/g, '')
}

/** Same serial once padding and case are ignored. */
export function sameSerial(a, b) {
  const x = cleanSerial(a).toUpperCase()
  return x !== '' && x === cleanSerial(b).toUpperCase()
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const dateOf = (r) => r?.issue_date || r?.fitment_date || null
const positionOf = (r) => cleanSerial(r?.position || r?.tyre_position) || null

/** Distance one fitment ran, or null when it was not measured. */
export function recordKm(r) {
  const total = num(r?.total_km)
  if (total != null && total > 0) return total
  const a = num(r?.km_at_fitment)
  const b = num(r?.km_at_removal)
  if (a != null && b != null && b > a) return b - a
  return null
}

/** The fitment the tyre is on now: the latest Active record, else null. */
export function currentAssignment(records) {
  const list = Array.isArray(records) ? records : []
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i]
    if (String(r?.status || '').trim() === 'Active') {
      return {
        asset_no: r.asset_no || null,
        vehicle_type: r.vehicle_type || null,
        position: positionOf(r),
        installed: dateOf(r),
        site: r.site || null,
        country: r.country || null,
      }
    }
  }
  return null
}

export const HISTORY_TABS = [
  { key: 'all', label: 'All history' },
  { key: 'installation', label: 'Installation' },
  { key: 'replacement', label: 'Replacement' },
  { key: 'inspection', label: 'Inspections' },
  { key: 'repair', label: 'Repairs' },
  { key: 'transfer', label: 'Transfers' },
  { key: 'disposal', label: 'Disposal' },
  { key: 'records', label: 'Records' },
]

/**
 * Movement events for one serial, newest first. `records` ordered oldest first.
 * A fitment on a different vehicle from the one before is a transfer; the first
 * fitment and a refit on the same vehicle are installations; a removal date is a
 * replacement event; a scrap mark is the disposal.
 */
export function historyEvents(records, { scrapMark = null } = {}) {
  const list = Array.isArray(records) ? records : []
  const out = []
  let prev = null
  list.forEach((r, i) => {
    const d = dateOf(r)
    const moved = prev && prev.asset_no && r.asset_no && prev.asset_no !== r.asset_no
    if (d) {
      out.push({
        id: `${r.id ?? i}-in`,
        date: d,
        type: moved ? 'transfer' : 'installation',
        label: moved ? 'Transfer' : 'Installation',
        from: moved ? (prev.site || prev.asset_no) : null,
        to: r.site || null,
        vehicle: r.asset_no || null,
        position: positionOf(r),
        remarks: r.remarks || null,
      })
    }
    if (r.removal_date) {
      out.push({
        id: `${r.id ?? i}-out`,
        date: r.removal_date,
        type: 'replacement',
        label: 'Removal',
        from: r.asset_no || null,
        to: null,
        vehicle: r.asset_no || null,
        position: positionOf(r),
        remarks: r.removal_reason || r.reason_for_removal || null,
      })
    }
    prev = r
  })
  if (scrapMark) {
    out.push({
      id: 'scrap',
      date: scrapMark.created_at || null,
      type: 'disposal',
      label: 'Disposal',
      from: null,
      to: null,
      vehicle: null,
      position: null,
      remarks: scrapMark.reason || null,
      by: scrapMark.scrapped_by_name || null,
    })
  }
  return out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
}

export function filterEvents(events, tab) {
  if (!tab || tab === 'all' || tab === 'records') return events
  return events.filter((e) => e.type === tab)
}

export function eventCounts(events) {
  const c = { all: events.length }
  for (const e of events) c[e.type] = (c[e.type] || 0) + 1
  return c
}

export const USAGE_TABS = [
  { key: 'km', label: 'KM trend' },
  { key: 'wear', label: 'Wear trend' },
  { key: 'temperature', label: 'Temperature' },
  { key: 'pressure', label: 'Pressure' },
]

/**
 * Life and usage for one serial. Series points are per fitment, dated by the
 * fitment. Total life sums the measured fitments; `measured` says how many of
 * the records carried a distance, so a partial total is never read as complete.
 */
export function lifeUsage(records) {
  const list = Array.isArray(records) ? records : []
  const km = []
  const wear = []
  const pressure = []
  let total = 0
  let measured = 0
  for (const r of list) {
    const d = dateOf(r)
    const k = recordKm(r)
    if (k != null) { total += k; measured++; if (d) km.push({ date: d, value: k }) }
    const t = num(r.tread_depth)
    if (t != null && t >= 0 && d) wear.push({ date: d, value: t })
    const p = num(r.pressure_reading)
    if (p != null && p > 0 && d) pressure.push({ date: d, value: p })
  }
  const last = list[list.length - 1]
  const current = last && String(last.status || '').trim() === 'Active' ? recordKm(last) : null
  return {
    totalKm: measured ? total : null,
    currentKm: current,
    measured,
    records: list.length,
    series: { km, wear, pressure, temperature: [] },
  }
}

/** SVG polyline geometry for a small series chart; null below two points. */
export function sparkPath(points, { width = 300, height = 110, pad = 8 } = {}) {
  const pts = (points || []).filter((p) => Number.isFinite(Number(p.value)))
  if (pts.length < 2) return null
  const vals = pts.map((p) => Number(p.value))
  const max = Math.max(...vals)
  const min = Math.min(0, ...vals)
  const span = max - min || 1
  const step = (width - pad * 2) / (pts.length - 1)
  const coords = pts.map((p, i) => [pad + i * step, height - pad - ((Number(p.value) - min) / span) * (height - pad * 2)])
  return {
    line: coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '),
    coords,
    max,
    min,
  }
}

/** Photo URLs recorded on the serial's records (jsonb array of strings or {url}). */
export function recordPhotos(records) {
  const out = []
  for (const r of Array.isArray(records) ? records : []) {
    const p = r?.photos
    if (!Array.isArray(p)) continue
    for (const x of p) {
      const url = typeof x === 'string' ? x : x?.url || x?.path || null
      if (url && !out.includes(url)) out.push(url)
    }
  }
  return out
}
