/**
 * Rotation Schedule view engine (pure, no I/O). Shapes tyre_rotations rows and
 * the rotationScheduleAnalytics output into what the redesigned page shows.
 *
 * Rotation type, positions and technician are real tyre_rotations columns
 * (rotation_type, from_positions, to_positions, technician_id, technician_name).
 * An older row may still carry the interim notes header line
 * ("Rotation: Cross | From: FL, FR | To: RR, RL | Technician: A. Name"); parsePlan
 * reads that as a fallback only. A row with neither reports the plan as not
 * recorded, never a guessed pattern.
 *
 * Nothing here fabricates a figure: a value that cannot be measured is null
 * and the page renders N/A.
 */

// Industry-standard patterns. 'Front to Rear' is stored as token 'standard' and 'Forward Cross' as 'cross'
// (their original tokens), so older rows keep their meaning. Legacy labels 'Standard'/'Cross' still map.
import { layoutSlotsFor, layoutForAsset, resolveLayoutKey } from './vehicleTyreLayout'
import { legacyPositionCode, describePosition } from './tyrePositions'

export const ROTATION_TYPES = ['Front to Rear', 'Forward Cross', 'Rearward Cross', 'Side to Side', 'X Pattern', 'Custom']

/** UI label to the tyre_rotations.rotation_type CHECK token, and back. */
export const TYPE_TOKEN = {
  'Front to Rear': 'standard', 'Forward Cross': 'cross', 'Rearward Cross': 'rearward_cross',
  'Side to Side': 'side_to_side', 'X Pattern': 'x_pattern', Custom: 'custom',
}
const TOKEN_TYPE = Object.fromEntries(Object.entries(TYPE_TOKEN).map(([k, v]) => [v, k]))
/** Earlier labels, still accepted on read and write. */
const LEGACY_LABEL = { standard: 'standard', cross: 'cross', front_to_rear: 'standard', forward_cross: 'cross' }

/** Label (or already a token) to the DB token; null when unknown or blank. */
export function typeToToken(type) {
  if (type == null) return null
  const s = String(type).trim()
  if (TYPE_TOKEN[s]) return TYPE_TOKEN[s]
  const low = s.toLowerCase().replace(/[\s-]+/g, '_')
  if (TOKEN_TYPE[low]) return low
  return LEGACY_LABEL[low] || null
}

/** DB token (or a legacy label) to the UI label; null when unknown or blank. */
export function tokenToType(token) {
  if (token == null) return null
  const low = String(token).trim().toLowerCase().replace(/[\s-]+/g, '_')
  return TOKEN_TYPE[low] || TOKEN_TYPE[LEGACY_LABEL[low]] || null
}
/**
 * Old plans (before positions followed the vehicle map) stored a generic
 * four-corner vocabulary. Still read and labelled; new plans use the
 * vehicle's own GCC position codes (LHF1, RHCO, LHR1-O, ...).
 */
export const LEGACY_POSITIONS = ['FL', 'FR', 'RL', 'RR']
const CORNER_LABEL = { FL: 'Front left', FR: 'Front right', RL: 'Rear left', RR: 'Rear right', Spare: 'Spare' }
/** Back-compat name for the legacy four-corner vocabulary. */
export const POSITION_OPTIONS = [...LEGACY_POSITIONS, 'Spare']
export const POSITION_LABEL = CORNER_LABEL

/**
 * The wheel positions of one vehicle, in the GCC codes the tyre register and
 * the tyre map use, from the same layout the diagram draws (4- vs 5-axle
 * pumps included). Empty for tyreless equipment or when no vehicle is chosen.
 */
export function positionOptionsFor(vehicleType, assetNo, country) {
  if (!vehicleType && !assetNo) return []
  const key = layoutForAsset(resolveLayoutKey(vehicleType, assetNo), assetNo, country)
  return layoutSlotsFor(vehicleType, assetNo, country).map((id) => legacyPositionCode(key, id))
}

/** A readable name for any stored position (GCC code or legacy corner). */
export function positionLabel(code) {
  if (!code) return ''
  if (CORNER_LABEL[code]) return CORNER_LABEL[code]
  return describePosition(code)
}

/** Side, front/rear and order of a position, for the rotation patterns. */
function positionShape(code) {
  const c = String(code || '').toUpperCase()
  if (c === 'SPARE') return null
  const legacy = c.match(/^([FR])([LR])$/)
  if (legacy) return { side: legacy[2], front: legacy[1] === 'F', axle: 1, outer: 0 }
  const m = c.match(/^(LH|RH)(F|C|R)(\d?)(?:-?([OI]))?$/)
  if (!m) return null
  const side = m[1] === 'LH' ? 'L' : 'R'
  const front = m[2] === 'F'
  // Rear order: centre drive axle before rear, then axle number, outer first.
  const axle = (m[2] === 'C' ? 0 : m[2] === 'R' ? 10 : 0) + (m[3] ? Number(m[3]) : 1)
  return { side, front, axle, outer: m[4] === 'I' ? 1 : 0 }
}

function mirrorCode(code) {
  const c = String(code)
  if (/^LH/i.test(c)) return `RH${c.slice(2)}`
  if (/^RH/i.test(c)) return `LH${c.slice(2)}`
  const legacy = c.match(/^([FR])([LR])$/i)
  if (legacy) return `${legacy[1]}${legacy[2].toUpperCase() === 'L' ? 'R' : 'L'}`
  return c
}

/**
 * Where each tyre moves for a pattern, over all positions on the vehicle.
 * Fronts pair with the rear positions in order on each side (outer before
 * inner); a position with no partner stays where it is.
 */
export function patternMap(type, options = []) {
  const t = TOKEN_TYPE[typeToToken(type)] || type
  if (!['Front to Rear', 'Forward Cross', 'Rearward Cross', 'Side to Side', 'X Pattern'].includes(t)) return null
  const shapes = options.map((code) => ({ code, s: positionShape(code) })).filter((x) => x.s)
  const map = {}
  if (t === 'Side to Side') {
    for (const { code } of shapes) map[code] = options.includes(mirrorCode(code)) ? mirrorCode(code) : code
    return map
  }
  const lists = (side, front) => shapes
    .filter((x) => x.s.side === side && x.s.front === front)
    .sort((a, b) => a.s.axle - b.s.axle || a.s.outer - b.s.outer)
    .map((x) => x.code)
  const F = { L: lists('L', true), R: lists('R', true) }
  const R = { L: lists('L', false), R: lists('R', false) }
  const other = (side) => (side === 'L' ? 'R' : 'L')
  for (const side of ['L', 'R']) {
    const n = Math.min(F[side].length, R[side].length, F[other(side)].length, R[other(side)].length)
    for (let i = 0; i < n; i += 1) {
      const f = F[side][i]
      const r = R[side][i]
      if (t === 'Front to Rear') { map[f] = r; map[r] = f }
      if (t === 'Forward Cross') { map[f] = r; map[r] = F[other(side)][i] }
      if (t === 'Rearward Cross') { map[r] = f; map[f] = R[other(side)][i] }
      if (t === 'X Pattern') { map[f] = R[other(side)][i]; map[r] = F[other(side)][i] }
    }
  }
  return map
}

/** Kept for callers that read the four-corner pattern table directly. */
export const PATTERNS = Object.fromEntries(
  ['Front to Rear', 'Forward Cross', 'Rearward Cross', 'Side to Side', 'X Pattern']
    .map((t) => [t, patternMap(t, LEGACY_POSITIONS)]),
)

export const VIEW_STATUSES = ['Scheduled', 'In Progress', 'Completed', 'Overdue']


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
export function newPositionsFor(type, current = [], options = null) {
  const all = options && options.length ? options : (current.every((p) => LEGACY_POSITIONS.includes(p) || p === 'Spare') ? LEGACY_POSITIONS : current)
  const map = patternMap(type, all)
  if (!map) return null
  return current.map((p) => map[p] || p)
}

const cleanList = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
  .map((s) => String(s).trim()).filter(Boolean)

/** Legacy read fallback: the interim plan header line some old notes carry. */
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
    if (key === 'rotation') out.type = tokenToType(val) || val || null
    else if (key === 'from') out.from = cleanList(val)
    else if (key === 'to') out.to = cleanList(val)
    else if (key === 'technician') out.technician = val || null
  }
  return out
}

/**
 * The rotation plan of a schedule row. Reads the real columns; falls back to the
 * legacy notes header only when the row has none of them.
 */
export function planOf(row = {}) {
  const from = cleanList(row.fromPositions)
  const to = cleanList(row.toPositions)
  const type = tokenToType(row.rotationType)
  const technician = row.technicianName ? String(row.technicianName).trim() || null : null
  if (type || from.length || to.length || technician) {
    return { recorded: from.length > 0 || to.length > 0, type, from, to, technician, freeNotes: String(row.notes || '').trim() }
  }
  const legacy = parsePlan(row.notes)
  return legacy.recorded ? legacy : { ...legacy, freeNotes: String(row.notes || '').trim() }
}

/** Attachments list from the jsonb column; never throws on a malformed value. */
export function attachmentsOf(row = {}) {
  const list = Array.isArray(row.attachments) ? row.attachments : []
  return list.filter((a) => a && typeof a === 'object' && typeof a.path === 'string' && a.path)
}

/**
 * Map the form to tyre_rotations columns. Technician from the list stores the
 * id and name; a typed name stores the name only.
 */
export function planColumns(form = {}, technicians = []) {
  const name = String(form.technician || '').trim()
  const match = name ? technicians.find((t) => String(t.name || '').trim().toLowerCase() === name.toLowerCase()) : null
  return {
    rotation_type: typeToToken(form.type),
    from_positions: cleanList(form.from),
    to_positions: cleanList(form.to),
    technician_id: match?.id || null,
    technician_name: name || null,
    notes: String(form.notes || '').trim() || null,
  }
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
  if (from.length === to.length) return from.map((f, i) => `${positionLabel(f)} to ${positionLabel(to[i])}`).join(', ')
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
    const plan = planOf(s)
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
