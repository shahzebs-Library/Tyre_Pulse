/**
 * Rotation Schedule view engine (pure, no I/O). Shapes tyre_rotations rows and
 * the rotationScheduleAnalytics output into what the redesigned page shows.
 *
 * The schedule table (tyre_rotations) has NO column for rotation type,
 * positions or technician. The planner stores those facts in the notes as one
 * readable header line ("Rotation: Cross | From: FL, FR | To: RR, RL |
 * Technician: A. Name") followed by the free notes, and this module reads them
 * back. A row without that line (older rows, auto-scheduled rows) reports the
 * plan as not recorded, never a guessed pattern.
 *
 * Nothing here fabricates a figure: a value that cannot be measured is null
 * and the page renders N/A.
 */

export const ROTATION_TYPES = ['Standard', 'Cross', 'Side to Side', 'Custom']
export const POSITION_OPTIONS = ['FL', 'FR', 'RL', 'RR', 'Spare']
export const POSITION_LABEL = { FL: 'Front left', FR: 'Front right', RL: 'Rear left', RR: 'Rear right', Spare: 'Spare' }
export const VIEW_STATUSES = ['Scheduled', 'In Progress', 'Completed', 'Overdue']

/** Rotation patterns: where the tyre at each position moves to. */
export const PATTERNS = {
  Standard: { FL: 'RL', FR: 'RR', RL: 'FL', RR: 'FR' },
  Cross: { FL: 'RR', FR: 'RL', RL: 'FR', RR: 'FL' },
  'Side to Side': { FL: 'FR', FR: 'FL', RL: 'RR', RR: 'RL' },
}

const NOTE_PREFIX = 'Rotation:'

const pad = (n) => String(n).padStart(2, '0')
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Local-time parse of a YYYY-MM-DD (or ISO) value; null when unreadable. */
export function parseDay(v) {
  if (!v) return null
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** New positions for a pattern; Custom (or unknown) returns null so the user picks. */
export function newPositionsFor(type, current = []) {
  const map = PATTERNS[type]
  if (!map) return null
  return current.map((p) => map[p] || p)
}

const cleanList = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
  .map((s) => String(s).trim()).filter(Boolean)

/** Compose the notes text carrying the plan header plus free notes. */
export function encodePlan({ type, from = [], to = [], technician, notes } = {}) {
  const parts = [`${NOTE_PREFIX} ${type || 'Custom'}`]
  if (from.length) parts.push(`From: ${from.join(', ')}`)
  if (to.length) parts.push(`To: ${to.join(', ')}`)
  if (technician && String(technician).trim()) parts.push(`Technician: ${String(technician).trim().replace(/\|/g, '/')}`)
  const header = parts.join(' | ')
  const free = String(notes || '').trim()
  return free ? `${header}\n${free}` : header
}

/** Read the plan header back out of the notes. */
export function parsePlan(notes) {
  const text = String(notes || '')
  const [first, ...rest] = text.split('\n')
  if (!first.trim().startsWith(NOTE_PREFIX)) {
    return { recorded: false, type: null, from: [], to: [], technician: null, freeNotes: text.trim() }
  }
  const out = { recorded: true, type: null, from: [], to: [], technician: null, freeNotes: rest.join('\n').trim() }
  for (const seg of first.split('|')) {
    const [k, ...v] = seg.split(':')
    const key = k.trim().toLowerCase()
    const val = v.join(':').trim()
    if (key === 'rotation') out.type = val || null
    else if (key === 'from') out.from = cleanList(val)
    else if (key === 'to') out.to = cleanList(val)
    else if (key === 'technician') out.technician = val || null
  }
  return out
}

/**
 * Derived schedule number. tyre_rotations has no number column, so the
 * register shows ROT-<year>-<first 6 of the id>. Stable, not a sequence.
 */
export function scheduleNo(row = {}) {
  const d = parseDay(row.scheduledDate) || parseDay(row.createdAt)
  const year = d ? d.getFullYear() : 'NA'
  const id = String(row.id || '').replace(/-/g, '').slice(0, 6).toUpperCase() || 'NEW'
  return `ROT-${year}-${id}`
}

/** Display status: Completed, In Progress, Overdue (open and date passed) or Scheduled. */
export function scheduleStatus(row = {}, now = new Date()) {
  const s = String(row.status || '').trim().toLowerCase()
  if (s === 'completed') return 'Completed'
  if (s === 'in progress') return 'In Progress'
  const d = parseDay(row.scheduledDate)
  if (d && d < startOfDay(now)) return 'Overdue'
  return 'Scheduled'
}

export const STATUS_TONE = { Scheduled: 'info', 'In Progress': 'warn', Completed: 'good', Overdue: 'bad' }

/** Positions arrow text, e.g. "FL -> RL" or "FL, FR -> RR, RL"; null when not recorded. */
export function positionsText(list = []) {
  return list.length ? list.join(', ') : null
}

export function movesText(from = [], to = []) {
  if (!from.length || !to.length) return null
  if (from.length === to.length) return from.map((f, i) => `${POSITION_LABEL[f] || f} to ${POSITION_LABEL[to[i]] || to[i]}`).join(', ')
  return `${from.join(', ')} to ${to.join(', ')}`
}

/**
 * Join schedule rows to the fleet register and the per-vehicle analytics so the
 * register can show type, brand and filter on them.
 */
export function enrichSchedules(schedules = [], { fleetByAsset = new Map(), vehiclesByAsset = new Map(), now = new Date() } = {}) {
  return schedules.map((s) => {
    const fleet = fleetByAsset.get(s.asset) || null
    const vehicle = vehiclesByAsset.get(s.asset) || null
    const brands = [...new Set((vehicle?.activeTyres || []).map((t) => String(t.brand || '').trim()).filter(Boolean))]
    const plan = parsePlan(s.notes)
    return {
      ...s,
      no: scheduleNo(s),
      viewStatus: scheduleStatus(s, now),
      plan,
      vehicleType: fleet?.vehicle_type || null,
      make: fleet?.make || null,
      model: fleet?.model || null,
      brands,
      serials: (vehicle?.activeTyres || []).map((t) => t.serial_no || t.serial_number).filter(Boolean),
      brand: brands.length === 1 ? brands[0] : brands.length > 1 ? 'Mixed' : null,
    }
  })
}

/** Filter the enriched register. Every filter value 'All' or '' means no filter. */
export function filterSchedules(rows = [], f = {}) {
  const q = String(f.search || '').trim().toLowerCase()
  const from = parseDay(f.from)
  const to = parseDay(f.to)
  return rows.filter((r) => {
    if (f.site && f.site !== 'All' && r.site !== f.site) return false
    if (f.vehicleType && f.vehicleType !== 'All' && r.vehicleType !== f.vehicleType) return false
    if (f.position && f.position !== 'All' && !r.plan.from.includes(f.position) && !r.plan.to.includes(f.position)) return false
    if (f.brand && f.brand !== 'All' && !r.brands.includes(f.brand)) return false
    if (f.status && f.status !== 'All' && r.viewStatus !== f.status) return false
    const d = parseDay(r.scheduledDate)
    if (from && (!d || d < from)) return false
    if (to && (!d || d > to)) return false
    if (q) {
      const serials = (r.serials || []).join(' ')
      const hay = [r.asset, r.no, r.site, r.vehicleType, r.plan.technician, serials].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Sorted distinct non-empty values for a filter select. */
export function optionsOf(rows = [], pick) {
  return [...new Set(rows.flatMap((r) => {
    const v = pick(r)
    return Array.isArray(v) ? v : [v]
  }).map((v) => (v == null ? '' : String(v).trim())).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/**
 * KPI strip. lifeIncreasePct compares measured life of rotated against never
 * rotated tyres; costSaving is the analytics "life value at risk" (the saving
 * available by rotating the tyres not on schedule), shown only for a single
 * country so currencies are never blended.
 */
export function buildScheduleKpis(schedules = [], analytics = {}, { country = 'All', currency = null, now = new Date() } = {}) {
  const month = now.getMonth(); const year = now.getFullYear()
  let dueThisMonth = 0; let completed = 0; let overdue = 0
  for (const s of schedules) {
    const st = scheduleStatus(s, now)
    if (st === 'Completed') { completed++; continue }
    if (st === 'Overdue') overdue++
    const d = parseDay(s.scheduledDate)
    if (d && d.getMonth() === month && d.getFullYear() === year) dueThisMonth++
  }
  const w = Number(analytics.avgLifeWith); const wo = Number(analytics.avgLifeWithout)
  const lifeIncreasePct = w > 0 && wo > 0 ? Math.round(((w - wo) / wo) * 100) : null
  const single = country && country !== 'All'
  const value = analytics.lifeValueTotal
  const costSaving = single && value != null && Number.isFinite(Number(value)) ? { value: Number(value), currency } : null
  return {
    total: schedules.length,
    dueThisMonth,
    completed,
    overdue,
    lifeIncreasePct,
    lifeReason: lifeIncreasePct == null ? 'Needs removed tyres with fitment and removal odometers, both rotated and never rotated.' : `Rotated tyres ${Math.round(w).toLocaleString('en-US')} km against ${Math.round(wo).toLocaleString('en-US')} km never rotated.`,
    costSaving,
    costReason: !single
      ? 'Choose one country: money is never added across currencies.'
      : costSaving ? 'Potential saving from rotating the tyres on vehicles not on schedule, measured from this fleet.'
        : 'Needs a measured life gain from rotation plus tyre prices.',
  }
}

/** Per-vehicle rotation history from detected position changes, newest first. */
export function vehicleHistory(vehicle) {
  return (vehicle?.rotationEvents || []).map((e) => ({
    date: e.date || null, from: e.from, to: e.to, serial: e.serial, km: e.km ?? null,
  }))
}

/**
 * Next recommended rotation for a vehicle. Estimated km = last rotation km plus
 * the interval. A date is given only when the vehicle's own odometer history
 * gives a daily distance (two readings at least 30 days apart).
 */
export function nextRecommendation(vehicle, records = [], interval, now = new Date()) {
  if (!vehicle) return null
  const estimatedKm = vehicle.lastRotationKm != null ? vehicle.lastRotationKm + interval : null
  const pts = records
    .map((r) => ({ d: parseDay(r.issue_date), k: Number(r.km_at_fitment) }))
    .filter((p) => p.d && Number.isFinite(p.k) && p.k > 0)
    .sort((a, b) => a.d - b.d)
  let kmPerDay = null
  if (pts.length >= 2) {
    const a = pts[0]; const b = pts[pts.length - 1]
    const days = (b.d - a.d) / 86400000
    if (days >= 30 && b.k > a.k) kmPerDay = (b.k - a.k) / days
  }
  let date = null
  if (vehicle.dueInKm != null) {
    if (vehicle.dueInKm <= 0) date = isoDay(startOfDay(now))
    else if (kmPerDay) {
      const d = startOfDay(now); d.setDate(d.getDate() + Math.ceil(vehicle.dueInKm / kmPerDay))
      date = isoDay(d)
    }
  }
  return { estimatedKm, date, kmPerDay, overdue: vehicle.dueInKm != null && vehicle.dueInKm <= 0 }
}

/** Month grid (weeks of 7 days, Sunday first) with the schedules on each day. */
export function calendarMonth(rows = [], monthDate = new Date()) {
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const start = new Date(first); start.setDate(1 - first.getDay())
  const byDay = new Map()
  for (const r of rows) {
    const d = parseDay(r.scheduledDate)
    if (!d) continue
    const k = isoDay(d)
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k).push(r)
  }
  const weeks = []
  const cur = new Date(start)
  for (let w = 0; w < 6; w++) {
    const days = []
    for (let i = 0; i < 7; i++) {
      const k = isoDay(cur)
      days.push({ key: k, day: cur.getDate(), inMonth: cur.getMonth() === first.getMonth(), items: byDay.get(k) || [] })
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(days)
    if (cur.getMonth() !== first.getMonth() && w >= 3) break
  }
  return { label: first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), weeks }
}

/** Fleet-wide detected rotations for the History tab, newest first. */
export function fleetHistory(vehicles = []) {
  const out = []
  for (const v of vehicles) {
    for (const e of v.rotationEvents || []) out.push({ asset: v.asset, site: v.site, serial: e.serial, from: e.from, to: e.to, date: e.date || null, km: e.km ?? null })
  }
  return out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
}

/** Average tread by position from real readings; null when no tread is recorded. */
export function treadByPosition(records = []) {
  const acc = {}
  let n = 0
  for (const r of records) {
    const t = r.tread_depth
    if (t === null || t === undefined || t === '') continue
    const v = Number(t)
    if (!Number.isFinite(v)) continue
    const pos = String(r.position || 'Unknown').trim() || 'Unknown'
    ;(acc[pos] ||= []).push(v)
    n++
  }
  if (!n) return null
  return Object.entries(acc)
    .map(([position, xs]) => ({ position, avg: xs.reduce((s, x) => s + x, 0) / xs.length, count: xs.length }))
    .sort((a, b) => a.position.localeCompare(b.position))
}

/** Validate the create/edit form. Returns an error message or ''. */
export function validatePlan(form = {}) {
  if (!String(form.asset || '').trim()) return 'Choose a vehicle or asset.'
  if (!form.from?.length) return 'Choose at least one current position.'
  if (!form.to?.length) return 'Choose the new positions.'
  if (form.from.length !== form.to.length) return 'Each current position needs one new position.'
  if (!parseDay(form.scheduledDate)) return 'Choose a scheduled date.'
  if (!String(form.site || '').trim()) return 'Choose a site.'
  return ''
}
