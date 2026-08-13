/**
 * Asset breakdowns - the machines that are down right now, and for how long.
 *
 * The owner's monthly asset sheet carries a breakdown tab beside the master
 * list: which machine is out of service, what is wrong with it, how many days
 * it has been down, when it is expected back, and whether the repair is being
 * done in-house or sent outside. Until now none of that reached the system, so
 * "why is availability low this month" had no answer beyond a status word on
 * the register.
 *
 * This module is pure - no I/O, deterministic, `now` always injected - so the
 * page, the export and the tests all read the same arithmetic.
 *
 * THE ONE RULE WORTH KEEPING: a machine is DOWN until somebody records that it
 * came back. `returned_to_service` is the only thing that closes a breakdown -
 * never the expected return date passing. A date that slipped is exactly the
 * case the register exists to surface, and treating it as a return would hide
 * the worst machines in the fleet.
 */

/** Days a breakdown has been open, or how long it took if it is closed. */
export function downDays(row, now = Date.now()) {
  if (!row) return null
  if (row.returned_to_service) {
    const start = toTime(row.reported_on)
    const end = toTime(row.returned_on)
    if (start == null || end == null) return num(row.breakdown_days)
    return Math.max(0, Math.round((end - start) / 86400000))
  }
  // Open: measure from the reported date to today. The sheet's own
  // `breakdown_days` is the figure at the moment the file was taken, so it goes
  // stale; it is the fallback only when no start date was recorded.
  const start = toTime(row.reported_on)
  if (start == null) return num(row.breakdown_days)
  return Math.max(0, Math.round((now - start) / 86400000))
}

/**
 * Days until the promised return. Negative means the promise has already been
 * missed, which is a different and more urgent thing than "due soon".
 */
export function daysToReturn(row, now = Date.now()) {
  const due = toTime(row?.expected_return)
  if (due == null) return null
  return Math.round((due - startOfDay(now)) / 86400000)
}

/** Is this breakdown past the date somebody said it would be back? */
export function isOverdue(row, now = Date.now()) {
  if (!row || row.returned_to_service) return false
  const d = daysToReturn(row, now)
  return d != null && d < 0
}

export const SEVERITY_BANDS = [
  { key: 'critical', label: 'Down over 30 days', min: 31 },
  { key: 'high', label: 'Down 8 to 30 days', min: 8 },
  { key: 'medium', label: 'Down 2 to 7 days', min: 2 },
  { key: 'low', label: 'Down under 2 days', min: 0 },
]

/** Which band a breakdown falls into, by how long it has been down. */
export function severityOf(row, now = Date.now()) {
  if (!row || row.returned_to_service) return null
  const d = downDays(row, now)
  if (d == null) return null
  return SEVERITY_BANDS.find((b) => d >= b.min)?.key || 'low'
}

export const EMPTY_BREAKDOWN_FILTERS = Object.freeze({
  search: '', site: '', repairLocation: '', severity: '', state: 'open',
})

/**
 * Apply the on-screen filters. `state` defaults to OPEN because a breakdown
 * register that opens on every breakdown ever recorded answers a historical
 * question, not the operational one.
 */
export function filterBreakdowns(rows = [], filters = {}, now = Date.now()) {
  const f = { ...EMPTY_BREAKDOWN_FILTERS, ...(filters || {}) }
  const q = String(f.search || '').trim().toLowerCase()
  return (rows || []).filter((r) => {
    if (!r) return false
    if (f.state === 'open' && r.returned_to_service) return false
    if (f.state === 'returned' && !r.returned_to_service) return false
    if (f.state === 'overdue' && !isOverdue(r, now)) return false
    if (f.site && String(r.site || '') !== f.site) return false
    if (f.repairLocation && String(r.repair_location || '') !== f.repairLocation) return false
    if (f.severity && severityOf(r, now) !== f.severity) return false
    if (q) {
      const hay = [r.asset_no, r.details, r.remark, r.site, r.repair_location]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * Headline numbers over whatever rows are passed in - so a filtered table and
 * its tiles always describe the same machines.
 *
 * `avgDownDays` and `worst` are null when nothing is open, never 0: "no
 * machines are down" and "machines are down for no time" are opposite claims.
 */
export function breakdownSummary(rows = [], now = Date.now()) {
  const list = rows || []
  const open = list.filter((r) => r && !r.returned_to_service)
  const days = open.map((r) => downDays(r, now)).filter((d) => d != null)
  const overdue = open.filter((r) => isOverdue(r, now))
  const outside = open.filter((r) => String(r.repair_location || '').toLowerCase() === 'out')
  const waitingParts = open.filter((r) => /part/i.test(String(r.remark || '')))
  return {
    total: list.length,
    open: open.length,
    returned: list.length - open.length,
    overdue: overdue.length,
    outsideWorkshop: outside.length,
    waitingParts: waitingParts.length,
    assets: new Set(open.map((r) => r.asset_no).filter(Boolean)).size,
    avgDownDays: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null,
    totalDownDays: days.length ? days.reduce((a, b) => a + b, 0) : null,
    worst: days.length ? Math.max(...days) : null,
  }
}

/** Open breakdowns per band, worst first, for the severity strip. */
export function severityBands(rows = [], now = Date.now()) {
  const open = (rows || []).filter((r) => r && !r.returned_to_service)
  return SEVERITY_BANDS.map((b) => ({
    ...b,
    count: open.filter((r) => severityOf(r, now) === b.key).length,
  }))
}

/** Group open breakdowns by any column, biggest first. Blank reads honestly. */
export function byGroup(rows = [], key, now = Date.now()) {
  const open = (rows || []).filter((r) => r && !r.returned_to_service)
  const map = new Map()
  for (const r of open) {
    const k = String(r?.[key] || '').trim() || 'Not recorded'
    const cur = map.get(k) || { key: k, count: 0, days: 0 }
    cur.count += 1
    cur.days += downDays(r, now) || 0
    map.set(k, cur)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.days - a.days)
}

/**
 * Machines that have broken down more than once. A repeat is the signal that
 * separates a bad day from a bad machine, which is the whole point of keeping
 * the history rather than only the current state.
 */
export function repeatOffenders(rows = [], now = Date.now()) {
  const map = new Map()
  for (const r of rows || []) {
    if (!r?.asset_no) continue
    const cur = map.get(r.asset_no) || { asset_no: r.asset_no, breakdowns: 0, days: 0, open: 0, site: r.site }
    cur.breakdowns += 1
    cur.days += downDays(r, now) || 0
    if (!r.returned_to_service) cur.open += 1
    map.set(r.asset_no, cur)
  }
  return [...map.values()].filter((a) => a.breakdowns > 1)
    .sort((a, b) => b.breakdowns - a.breakdowns || b.days - a.days)
}

/**
 * Plain-English findings. Emits NOTHING when there is nothing to say - a panel
 * that always prints a warning is a panel nobody reads.
 */
export function breakdownFindings(rows = [], summary = null, now = Date.now()) {
  const s = summary || breakdownSummary(rows, now)
  const out = []
  if (!s.open) return out
  if (s.overdue) {
    out.push({
      tone: 'danger',
      text: `${s.overdue} machine${s.overdue === 1 ? ' is' : 's are'} past the date they were promised back.`,
    })
  }
  const stuck = (rows || []).filter((r) => !r?.returned_to_service && (downDays(r, now) || 0) > 30)
  if (stuck.length) {
    out.push({
      tone: 'danger',
      text: `${stuck.length} machine${stuck.length === 1 ? '' : 's'} down over 30 days: ${stuck.slice(0, 4).map((r) => r.asset_no).join(', ')}${stuck.length > 4 ? ' and more' : ''}.`,
    })
  }
  if (s.waitingParts) {
    out.push({
      tone: 'warning',
      text: `${s.waitingParts} repair${s.waitingParts === 1 ? ' is' : 's are'} held up waiting for parts, not for workshop time.`,
    })
  }
  if (s.outsideWorkshop) {
    out.push({
      tone: 'info',
      text: `${s.outsideWorkshop} machine${s.outsideWorkshop === 1 ? ' is' : 's are'} at an outside workshop.`,
    })
  }
  const repeats = repeatOffenders(rows, now)
  if (repeats.length) {
    out.push({
      tone: 'warning',
      text: `${repeats.length} machine${repeats.length === 1 ? ' has' : 's have'} broken down more than once: ${repeats.slice(0, 4).map((a) => a.asset_no).join(', ')}.`,
    })
  }
  return out
}

/** Rows shaped for Excel/PDF, matching what the table shows. */
export function breakdownExportRows(rows = [], now = Date.now()) {
  const columns = [
    'asset_no', 'site', 'details', 'down_days', 'reported_on', 'expected_return',
    'days_to_return', 'repair_location', 'remark', 'state',
  ]
  const headers = [
    'Asset', 'Site', 'Fault', 'Days down', 'Down since', 'Expected back',
    'Days to return', 'Repaired at', 'Note', 'State',
  ]
  return {
    columns,
    headers,
    rows: (rows || []).map((r) => ({
      asset_no: r.asset_no || '',
      site: r.site || 'Not recorded',
      details: r.details || 'Not recorded',
      down_days: downDays(r, now) ?? 'N/A',
      reported_on: r.reported_on || 'N/A',
      expected_return: r.expected_return || 'N/A',
      days_to_return: daysToReturn(r, now) ?? 'N/A',
      repair_location: repairLabel(r.repair_location),
      remark: r.remark || '',
      state: r.returned_to_service ? 'Back in service'
        : isOverdue(r, now) ? 'Overdue' : 'Under repair',
    })),
  }
}

/**
 * ONE MACHINE'S DOWNTIME, for a screen that is asking a different question.
 *
 * The disposal committee is deciding whether a machine is worth keeping. How
 * long it has been standing still is one of the strongest arguments either way,
 * and it lives here rather than there - a machine down 218 days waiting for a
 * part from China is a scrap conversation, and a machine that has never missed
 * a day is not, however old it looks on paper.
 *
 * Keyed by asset code, UPPER and space-stripped, because that is the identity
 * every other register in this system uses.
 */
export function breakdownsByAsset(rows = [], now = Date.now()) {
  const out = new Map()
  for (const r of rows || []) {
    const key = String(r?.asset_no || '').toUpperCase().replace(/\s+/g, '')
    if (!key) continue
    const days = downDays(r, now)
    const open = !r.returned_to_service
    const cur = out.get(key) || {
      asset_no: key, breakdowns: 0, open: 0, daysTotal: 0,
      currentDays: null, overdue: false, fault: '', repairLocation: '', lastReportedOn: '',
    }
    cur.breakdowns += 1
    cur.daysTotal += days || 0
    if (open) {
      cur.open += 1
      // The LONGEST open breakdown speaks for the machine: if two are open, the
      // one that has been standing longest is the one the decision turns on.
      if (days != null && (cur.currentDays == null || days > cur.currentDays)) {
        cur.currentDays = days
        cur.fault = String(r.details || '').trim()
        cur.repairLocation = String(r.repair_location || '').trim()
      }
      if (isOverdue(r, now)) cur.overdue = true
    }
    const on = String(r.reported_on || '').slice(0, 10)
    if (on && on > cur.lastReportedOn) cur.lastReportedOn = on
    out.set(key, cur)
  }
  return out
}

/**
 * Attach each register row's downtime, WITHOUT inventing a figure for a machine
 * that has none.
 *
 * A machine with no breakdown row gets `breakdown: null`, and the screen prints
 * "Not recorded". Zero days would be a claim - that it has never broken down -
 * and the breakdown register only started being kept this month, so it is a
 * claim the data cannot support. `down` is the sort key so an unmeasured
 * machine sinks rather than sorting as the healthiest in the fleet.
 */
export function mergeBreakdowns(registerRows = [], breakdownRows = [], now = Date.now()) {
  const index = breakdownsByAsset(breakdownRows, now)
  if (!index.size) return registerRows || []
  return (registerRows || []).map((r) => {
    const key = String(r?.asset_no || '').toUpperCase().replace(/\s+/g, '')
    const hit = key ? index.get(key) : null
    return hit ? { ...r, breakdown: hit, down: hit.currentDays } : { ...r, breakdown: null, down: null }
  })
}

/**
 * MACHINES THE DISPOSAL COMMITTEE HAS NEVER SEEN.
 *
 * Measured when this was built: not one of the machines currently broken down
 * is on the disposal register, and the worst of them has been standing for 218
 * days waiting on a part from China. That machine is a scrap conversation
 * nobody is having, because the two lists were kept in separate rooms.
 *
 * So this is the link that carries the value: an open breakdown that has run
 * past the register's own "down over 30 days" band and whose machine is NOT on
 * the disposal list. It PROPOSES; it never adds anything. Whether a machine
 * leaves the fleet is the committee's decision, and a system that quietly filed
 * a machine as a disposal because it was waiting for a part would be making
 * that decision for them.
 *
 * The threshold reuses SEVERITY_BANDS rather than inventing a second number.
 */
export function disposalCandidatesFromBreakdowns(breakdownRows = [], registerRows = [], {
  minDays = SEVERITY_BANDS.find((b) => b.key === 'critical')?.min ?? 31,
  now = Date.now(),
} = {}) {
  const onList = new Set(
    (registerRows || [])
      .map((r) => String(r?.asset_no || '').toUpperCase().replace(/\s+/g, ''))
      .filter(Boolean),
  )
  const out = []
  for (const [key, entry] of breakdownsByAsset(breakdownRows, now)) {
    if (onList.has(key)) continue
    if (!(entry.open > 0)) continue
    if (entry.currentDays == null || entry.currentDays < minDays) continue
    out.push(entry)
  }
  return out.sort((a, b) => (b.currentDays ?? 0) - (a.currentDays ?? 0))
}

/** One line a person can read, or '' when there is genuinely nothing to say. */
export function downtimeNote(entry) {
  if (!entry) return ''
  if (entry.open > 0 && entry.currentDays != null) {
    const overdue = entry.overdue ? ', past its promised return' : ''
    return `Down ${entry.currentDays} day${entry.currentDays === 1 ? '' : 's'}${overdue}`
  }
  if (entry.open > 0) return 'Down now, start date not recorded'
  if (entry.breakdowns > 0) {
    return `Back in service, ${entry.breakdowns} breakdown${entry.breakdowns === 1 ? '' : 's'} on record`
  }
  return ''
}

/** The sheet writes In/Out; people read words. */
export function repairLabel(v) {
  const s = String(v || '').trim().toLowerCase()
  if (s === 'in') return 'In-house workshop'
  if (s === 'out') return 'Outside workshop'
  return 'Not recorded'
}

/* ---------------------------------------------------------------- helpers */

function num(v) {
  // Number(null) is 0 AND 0 is finite, so a bare Number()+isFinite turns "no
  // reading was recorded" into a real reading of zero days down. The blank
  // check has to come first.
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toTime(v) {
  if (!v) return null
  const t = Date.parse(String(v).length <= 10 ? `${v}T00:00:00Z` : v)
  return Number.isFinite(t) ? t : null
}

function startOfDay(now) {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
