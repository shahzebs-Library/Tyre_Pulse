/**
 * Inspection plan adherence and spreadsheet intake.
 *
 * ONE definition of a plan's state lives here and in SQL
 * `public.inspection_plan_state()`. They are a MIRROR PAIR - change both
 * together; `src/test/schedulePlan.test.js` pins the shared case table.
 *
 * Nothing here touches the network. The board reads adherence from the server
 * (state derived live, so it cannot go stale) and uses `planState` only for
 * rows it already holds, such as an upload preview.
 */
import { addDays, diffDays } from './inspectionPlanner'

const DAY_MS = 86400000
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)

export const MAX_PLAN_UPLOAD_ROWS = 1000
export const DEFAULT_GRACE_DAYS = 2
export const DEFAULT_PLAN_TIME = '08:00'

/** Ordered worst-first, which is the order a planner needs to act in. */
export const PLAN_STATES = ['Missed', 'Due', 'Started', 'Upcoming', 'Done', 'Cancelled']

export const PLAN_STATE_META = {
  Missed: { tone: 'danger', label: 'Missed', hint: 'The window closed with no inspection on this vehicle.' },
  Due: { tone: 'warning', label: 'Due now', hint: 'Inside its window today and not yet inspected.' },
  Started: { tone: 'info', label: 'Started', hint: 'An inspection exists but is not finished.' },
  Upcoming: { tone: 'quiet', label: 'Upcoming', hint: 'Planned for a date still ahead.' },
  Done: { tone: 'good', label: 'Done', hint: 'A finished inspection landed inside the window.' },
  Cancelled: { tone: 'quiet', label: 'Cancelled', hint: 'Called off by a planner.' },
}

const lower = value => String(value ?? '').trim().toLowerCase()
export const planTone = state => PLAN_STATE_META[state]?.tone || 'quiet'

/**
 * MIRROR of SQL inspection_plan_state(). Done beats Started beats Missed.
 * `today` is a YYYY-MM-DD string so the caller owns the clock.
 */
export function planState(plan, today) {
  if (!plan || typeof today !== 'string') return 'Upcoming'
  if (lower(plan.status) === 'cancelled' || lower(plan.status) === 'canceled') return 'Cancelled'
  const matched = plan.matched_status
  const date = plan.scheduled_date || plan.inspection_date || ''
  if (matched == null && !date) return 'Upcoming'
  if (lower(matched) === 'done') return 'Done'
  if (matched != null) return 'Started'
  // Number(null) is 0 and 0 is finite, so a null grace would silently become a
  // zero-day window and read as Missed a day early. SQL coalesces to the
  // default; this must too, or the two mirrors disagree.
  const raw = plan.grace_days
  const grace = raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw))
    ? DEFAULT_GRACE_DAYS
    : Number(raw)
  if (today > addDays(date, grace)) return 'Missed'
  if (today >= date) return 'Due'
  return 'Upcoming'
}

/** Headline counts. `adherence` is null - never 0 - when nothing has come due. */
export function summarizeAdherence(rows) {
  const list = Array.isArray(rows) ? rows : []
  const tally = { planned: 0, Missed: 0, Due: 0, Started: 0, Upcoming: 0, Done: 0, Cancelled: 0 }
  let onTime = 0
  for (const row of list) {
    const state = row?.plan_state || 'Upcoming'
    if (tally[state] === undefined) continue
    tally[state] += 1
    tally.planned += 1
    if (state === 'Done' && Number(row?.days_late || 0) === 0) onTime += 1
  }
  // Only plans whose window has closed can be judged. Upcoming and Cancelled
  // are excluded, or a plan made for next week would count against today.
  const judged = tally.Done + tally.Missed
  return {
    ...tally,
    judged,
    onTime,
    adherence: judged ? Math.round((tally.Done / judged) * 100) : null,
    openWork: tally.Due + tally.Started,
  }
}

/** Group adherence by any dimension: 'site', 'assigned_name', 'team'. */
export function adherenceBy(rows, key, { fallback = 'Not set' } = {}) {
  const groups = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = String(row?.[key] ?? '').trim() || fallback
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(row)
  }
  return [...groups.entries()]
    .map(([name, list]) => ({ name, ...summarizeAdherence(list) }))
    .sort((a, b) => b.Missed - a.Missed || b.planned - a.planned || a.name.localeCompare(b.name))
}

// -- Spreadsheet intake ------------------------------------------------------

/**
 * The upload sheet. Deliberately short: only two columns are required, so a
 * supervisor can plan a week from a hand-typed sheet. Everything else has a
 * safe default or is filled from the fleet register.
 */
export const PLAN_COLUMNS = [
  { key: 'asset_no', header: 'Asset Code', required: true, hint: 'Fleet code, e.g. TM514' },
  { key: 'scheduled_date', header: 'Planned Date', required: true, hint: 'DD-MM-YYYY or YYYY-MM-DD' },
  { key: 'assigned_name', header: 'Assign To', required: false, hint: 'Person who must do it' },
  { key: 'team', header: 'Team', required: false, hint: 'Crew name, free text' },
  { key: 'inspection_time', header: 'Time', required: false, hint: 'Defaults to 08:00' },
  { key: 'inspection_type', header: 'Type', required: false, hint: 'Defaults to Routine' },
  { key: 'priority', header: 'Priority', required: false, hint: 'High / Medium / Low' },
  { key: 'site', header: 'Site', required: false, hint: 'Filled from the fleet register when blank' },
  { key: 'grace_days', header: 'Grace Days', required: false, hint: 'Days late still counted as done (default 2)' },
  { key: 'notes', header: 'Notes', required: false, hint: 'Optional instruction for the crew' },
]

const headerToken = text => String(text).replace(/[^a-z0-9]/gi, '').toLowerCase()

const HEADER_LOOKUP = (() => {
  const map = new Map()
  const add = (text, key) => map.set(headerToken(text), key)
  for (const column of PLAN_COLUMNS) add(column.header, column.key)
  // Spellings a real sheet uses.
  add('asset', 'asset_no'); add('assetno', 'asset_no'); add('assetcode', 'asset_no')
  add('vehicle', 'asset_no'); add('vehicleno', 'asset_no'); add('fleetno', 'asset_no')
  add('date', 'scheduled_date'); add('plandate', 'scheduled_date'); add('scheduleddate', 'scheduled_date')
  add('inspectiondate', 'scheduled_date'); add('duedate', 'scheduled_date')
  add('inspector', 'assigned_name'); add('assignedto', 'assigned_name'); add('assignee', 'assigned_name')
  add('technician', 'assigned_name'); add('name', 'assigned_name')
  add('crew', 'team'); add('teamname', 'team'); add('group', 'team')
  add('location', 'site'); add('project', 'site')
  add('inspectiontype', 'inspection_type'); add('worktype', 'inspection_type')
  add('remarks', 'notes'); add('comment', 'notes'); add('comments', 'notes')
  return map
})()

/** Map a raw sheet row (header -> value) onto plan keys, tolerating spellings. */
export function normalizePlanRow(raw) {
  const out = {}
  for (const [header, value] of Object.entries(raw || {})) {
    const key = HEADER_LOOKUP.get(headerToken(header))
    if (key && out[key] === undefined) out[key] = value
  }
  return out
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function iso(y, m, d) {
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Parse a planned date DAY-FIRST.
 *
 * This fleet writes DD-MM-YYYY. A bare `new Date(str)` reads that MONTH-first
 * and silently files 07-09-2026 as 9 July instead of 7 September, so every
 * ambiguous value is read day-first here and a 2-digit year pivots on 2000.
 * Excel serial numbers are accepted because a spreadsheet often hands one over.
 */
export function parsePlanDate(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null
    return iso(value.getFullYear(), value.getMonth() + 1, value.getDate())
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 1 || value > 80000) return null
    const probe = new Date(EXCEL_EPOCH_UTC + Math.round(value) * DAY_MS)
    return iso(probe.getUTCFullYear(), probe.getUTCMonth() + 1, probe.getUTCDate())
  }
  const text = String(value).trim()
  if (!text) return null
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (match) return iso(Number(match[1]), Number(match[2]), Number(match[3]))
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/)
  if (match) {
    const year = Number(match[3])
    return iso(year < 100 ? 2000 + year : year, Number(match[2]), Number(match[1]))
  }
  match = text.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2}|\d{4})$/)
  if (match) {
    const month = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase()) + 1
    const year = Number(match[3])
    return month ? iso(year < 100 ? 2000 + year : year, month, Number(match[1])) : null
  }
  return null
}

export function parsePlanTime(value) {
  if (value == null || value === '') return DEFAULT_PLAN_TIME
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440)
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  }
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hours = Number(match[1])
  const mins = Number(match[2])
  if (hours > 23 || mins > 59) return null
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

const PRIORITIES = {
  high: 'High', critical: 'High', urgent: 'High',
  medium: 'Medium', med: 'Medium', normal: 'Medium',
  low: 'Low',
}

/**
 * Resolve a typed name to a real account.
 * Exact full name, then username, then employee number. An ambiguous match is
 * reported rather than guessed, so a plan is never silently handed to the
 * wrong person.
 */
export function resolvePerson(name, people) {
  const needle = lower(name)
  if (!needle) return { person: null, reason: 'blank' }
  const list = Array.isArray(people) ? people : []
  for (const field of ['full_name', 'username', 'employee_id']) {
    const hits = list.filter(person => lower(person?.[field]) === needle)
    if (hits.length === 1) return { person: hits[0], reason: 'matched' }
    if (hits.length > 1) return { person: null, reason: 'ambiguous' }
  }
  return { person: null, reason: 'unknown' }
}

/** A stable, human-readable batch reference for one upload. */
export function buildPlanRef(now = new Date(), suffix = '') {
  const pad = n => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `PLAN-${stamp}${suffix ? `-${suffix}` : ''}`
}

/**
 * Validate and resolve an uploaded sheet.
 * Every row comes back either ready or with the reason it is not, so nothing
 * is dropped silently. `assets` and `people` are lookup lists, not queries.
 */
export function parsePlanRows(rawRows, { assets = [], people = [], today, horizonDays = 365 } = {}) {
  const fleet = new Map()
  for (const asset of Array.isArray(assets) ? assets : []) {
    const key = lower(asset?.asset_no)
    if (key && !fleet.has(key)) fleet.set(key, asset)
  }
  const seen = new Set()
  const rows = []
  for (const [index, raw] of (Array.isArray(rawRows) ? rawRows : []).entries()) {
    const mapped = normalizePlanRow(raw)
    const problems = []
    const assetNo = String(mapped.asset_no ?? '').trim().toUpperCase()
    const date = parsePlanDate(mapped.scheduled_date)
    const time = parsePlanTime(mapped.inspection_time)
    const graceRaw = mapped.grace_days
    const grace = graceRaw === '' || graceRaw == null ? DEFAULT_GRACE_DAYS : Number(graceRaw)
    const match = fleet.get(lower(assetNo))
    const assignName = String(mapped.assigned_name ?? '').trim()
    const resolved = assignName ? resolvePerson(assignName, people) : { person: null, reason: 'blank' }

    if (!assetNo) problems.push('Asset Code is required.')
    else if (!match) problems.push(`${assetNo} is not in the fleet register.`)
    if (mapped.scheduled_date == null || mapped.scheduled_date === '') problems.push('Planned Date is required.')
    else if (!date) problems.push('Planned Date could not be read. Use DD-MM-YYYY.')
    else if (today) {
      if (date < today) problems.push('Planned Date is in the past.')
      else if (diffDays(today, date) > horizonDays) problems.push('Planned Date is more than a year ahead.')
    }
    if (time === null) problems.push('Time could not be read. Use HH:MM.')
    if (!Number.isInteger(grace) || grace < 0 || grace > 30) problems.push('Grace Days must be a whole number from 0 to 30.')
    if (assignName && resolved.reason === 'unknown') problems.push(`No account matches "${assignName}".`)
    if (assignName && resolved.reason === 'ambiguous') problems.push(`More than one account is named "${assignName}".`)

    if (assetNo && date) {
      const dedupeKey = `${assetNo}|${date}`
      if (seen.has(dedupeKey)) problems.push('The same vehicle is planned twice on this date in this sheet.')
      else seen.add(dedupeKey)
    }

    rows.push({
      // +2: a spreadsheet's first data row sits under the header row.
      rowNumber: index + 2,
      ready: problems.length === 0,
      problems,
      asset_no: assetNo,
      scheduled_date: date,
      inspection_time: time ?? DEFAULT_PLAN_TIME,
      assigned_name: assignName,
      assigned_to: resolved.person?.id ?? null,
      inspector_name: resolved.person?.full_name || assignName || null,
      team: String(mapped.team ?? '').trim() || null,
      inspection_type: String(mapped.inspection_type ?? '').trim() || 'Routine',
      priority: PRIORITIES[lower(mapped.priority)] || (mapped.priority ? String(mapped.priority).trim() : 'Medium'),
      site: String(mapped.site ?? '').trim() || match?.site || null,
      vehicle_type: match?.vehicle_type || null,
      grace_days: Number.isInteger(grace) ? grace : DEFAULT_GRACE_DAYS,
      notes: String(mapped.notes ?? '').trim() || null,
    })
  }
  const ready = rows.filter(row => row.ready)
  return {
    rows,
    ready,
    summary: {
      total: rows.length,
      ready: ready.length,
      blocked: rows.length - ready.length,
      unassigned: ready.filter(row => !row.assigned_to).length,
      overLimit: rows.length > MAX_PLAN_UPLOAD_ROWS,
    },
  }
}

/** The sheet a planner downloads: headers plus one worked example row. */
export function planTemplateRows(sample = {}) {
  const example = {
    asset_no: sample.asset_no || 'TM514',
    scheduled_date: sample.scheduled_date || '25-09-2026',
    assigned_name: sample.assigned_name || 'SALMAN AHMED',
    team: 'Crew A',
    inspection_time: DEFAULT_PLAN_TIME,
    inspection_type: 'Routine',
    priority: 'High',
    site: sample.site || 'NHC',
    grace_days: DEFAULT_GRACE_DAYS,
    notes: 'Check steer axle pressures',
  }
  return [Object.fromEntries(PLAN_COLUMNS.map(column => [column.header, example[column.key] ?? '']))]
}
