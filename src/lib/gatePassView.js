/**
 * gatePassView - pure view engine for the redesigned Gate Pass page.
 *
 * The `gate_passes` table was built as a daily EXIT clearance log: one row per
 * decision, status Cleared / Denied / Pending, linked to the day's tyre
 * inspection. It has no direction, driver, purpose or expected times of its
 * own. The redesigned page records those in the row's existing `custom_data`
 * jsonb (no migration), and this module reads them back:
 *
 *   custom_data.direction        'inward' | 'outward'. A row without it is a
 *                                legacy exit clearance, read as OUTWARD.
 *   custom_data.driver_name / driver_id / purpose
 *   custom_data.expected_in_at / expected_out_at   ISO timestamps
 *   custom_data.checked_in_at / checked_in_by      inward arrival
 *   custom_data.checked_out_at / checked_out_by / exit_pass_id  inward departure
 *   custom_data.created_by / pre_approval
 *
 * Status on screen (viewStatus):
 *   Denied                                   -> rejected
 *   outward + Cleared                        -> checked_out (the release is the exit)
 *   inward  + checked_out_at                 -> checked_out
 *   inward  + checked_in_at (not out)        -> in_yard, or overstay when the
 *                                               expected out time has passed
 *   inward  + Approved (not yet arrived)     -> approved
 *   anything else                            -> pending
 *
 * OVERSTAY RULE: an inward pass that has checked in, has not checked out, and
 * whose expected out time is earlier than now. A pass with no expected out
 * time can never be an overstay: there is nothing to overstay.
 *
 * Nothing reads the clock: `now` is always injected.
 */

const str = (v) => (v == null ? '' : String(v))
const cd = (p) => (p && p.custom_data && typeof p.custom_data === 'object' ? p.custom_data : {})
const ts = (v) => {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}
const nowMs = (now) => (now instanceof Date ? now.getTime() : Number(now))

export const VIEW_STATUS_META = {
  pending: { label: 'Pending approval', tone: 'warn' },
  approved: { label: 'Approved', tone: 'info' },
  in_yard: { label: 'In yard', tone: 'orange' },
  overstay: { label: 'Overstay', tone: 'bad' },
  checked_out: { label: 'Checked out', tone: 'info' },
  checked_in: { label: 'Checked in', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
}

export const TABS = [
  { key: 'all', label: 'All gate passes' },
  { key: 'inward', label: 'Inward' },
  { key: 'outward', label: 'Outward' },
  { key: 'in_yard', label: 'In yard' },
  { key: 'overstay', label: 'Overstay' },
  { key: 'rejected', label: 'Rejected' },
]

export const PURPOSES = [
  'Material delivery', 'Site work', 'Project mobilization', 'Inspection', 'Concrete pour',
  'Power support', 'Tyre replacement', 'Equipment mobilization', 'Maintenance', 'Other',
]

export const OVERSTAY_RULE = 'Overstay means a vehicle checked in on an inward pass, has not checked out, and its expected out time has passed. A pass with no expected out time is never counted as overstay.'
export const DIRECTION_RULE = 'Passes recorded before inward and outward were tracked are exit clearances, so they count as outward.'

export function direction(p) {
  return cd(p).direction === 'inward' ? 'inward' : 'outward'
}

/** Short display reference derived from the record id (the table has no pass number column). */
export function passRef(p) {
  const id = str(p?.id).replace(/-/g, '')
  if (!id) return 'N/A'
  const year = (p?.pass_date || p?.created_at || '').slice(0, 4)
  return `GP-${year ? `${year}-` : ''}${id.slice(0, 8).toUpperCase()}`
}

export function checkedInAt(p) { return direction(p) === 'inward' ? ts(cd(p).checked_in_at) : null }

export function checkedOutAt(p) {
  if (direction(p) === 'inward') return ts(cd(p).checked_out_at)
  return p?.status === 'Cleared' ? (ts(p?.cleared_at) ?? ts(p?.created_at)) : null
}

export function expectedOutAt(p) { return ts(cd(p).expected_out_at) }
export function expectedInAt(p) { return ts(cd(p).expected_in_at) }

export function isInYard(p) {
  return direction(p) === 'inward' && p?.status !== 'Denied' && checkedInAt(p) != null && ts(cd(p).checked_out_at) == null
}

export function isOverstay(p, now) {
  if (!isInYard(p)) return false
  const exp = expectedOutAt(p)
  return exp != null && exp < nowMs(now)
}

export function viewStatus(p, now) {
  if (p?.status === 'Denied') return 'rejected'
  if (direction(p) === 'outward') return p?.status === 'Cleared' ? 'checked_out' : 'pending'
  if (ts(cd(p).checked_out_at) != null) return 'checked_out'
  if (checkedInAt(p) != null) return isOverstay(p, now) ? 'overstay' : 'in_yard'
  if (p?.status === 'Approved') return 'approved'
  return 'pending'
}

/** KPI tallies over a set of passes. */
export function gateKpis(passes = [], now) {
  const list = Array.isArray(passes) ? passes : []
  let checkedIn = 0; let checkedOut = 0; let inYard = 0; let overstay = 0; let rejected = 0; let pending = 0
  for (const p of list) {
    const s = viewStatus(p, now)
    if (checkedInAt(p) != null) checkedIn += 1
    if (s === 'checked_out') checkedOut += 1
    if (s === 'in_yard' || s === 'overstay') inYard += 1
    if (s === 'overstay') overstay += 1
    if (s === 'rejected') rejected += 1
    if (s === 'pending' || s === 'approved') pending += 1
  }
  return { total: list.length, checkedIn, checkedOut, inYard, overstay, rejected, pending }
}

export function tabMatches(p, tab, now) {
  switch (tab) {
    case 'inward': return direction(p) === 'inward'
    case 'outward': return direction(p) === 'outward'
    case 'in_yard': return isInYard(p)
    case 'overstay': return isOverstay(p, now)
    case 'rejected': return p?.status === 'Denied'
    default: return true
  }
}

export function tabCounts(passes = [], now) {
  const out = {}
  for (const t of TABS) out[t.key] = (Array.isArray(passes) ? passes : []).filter((p) => tabMatches(p, t.key, now)).length
  return out
}

/** Tab + free-text search + purpose + pending-only filter. */
export function filterGatePasses(passes = [], { tab = 'all', search = '', purpose = '', pendingOnly = false } = {}, now) {
  const q = str(search).trim().toLowerCase()
  return (Array.isArray(passes) ? passes : []).filter((p) => {
    if (!tabMatches(p, tab, now)) return false
    const c = cd(p)
    if (purpose && str(c.purpose).toLowerCase() !== purpose.toLowerCase()) return false
    if (pendingOnly) { const s = viewStatus(p, now); if (s !== 'pending' && s !== 'approved') return false }
    if (!q) return true
    return [passRef(p), p?.asset_no, p?.site, p?.denial_reason, p?.notes, c.driver_name, c.driver_id, c.purpose]
      .some((v) => str(v).toLowerCase().includes(q))
  })
}

/** Initials for an avatar: never a photo of a person. */
export function initials(name) {
  const parts = str(name).trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/**
 * Timeline steps from real timestamps only. state: 'done' | 'todo' | 'skipped'.
 * `names` maps a profile id to a display name; unknown actors stay blank.
 */
export function timeline(p, names = {}) {
  const c = cd(p)
  const who = (id) => (id && names[id]) || ''
  const inward = direction(p) === 'inward'
  const created = ts(p?.created_at)
  const denied = p?.status === 'Denied'
  const approvedAt = ts(p?.cleared_at)
  const steps = [{ key: 'created', label: 'Created', at: created, by: who(c.created_by), state: created != null ? 'done' : 'todo' }]
  if (denied) {
    steps.push({ key: 'approved', label: 'Rejected', at: created, by: '', state: 'done', tone: 'bad', note: p?.denial_reason || '' })
  } else if (inward && !c.pre_approval && approvedAt == null) {
    steps.push({ key: 'approved', label: 'Approved', at: null, by: '', state: 'skipped', note: 'Not required' })
  } else {
    steps.push({ key: 'approved', label: 'Approved', at: approvedAt, by: who(p?.cleared_by), state: approvedAt != null ? 'done' : 'todo' })
  }
  if (inward) {
    const inAt = ts(c.checked_in_at)
    const outAt = ts(c.checked_out_at)
    steps.push({ key: 'checked_in', label: 'Checked in', at: inAt, by: who(c.checked_in_by), state: inAt != null ? 'done' : 'todo' })
    steps.push({ key: 'in_yard', label: 'In yard', at: inAt, by: '', state: inAt != null ? 'done' : 'todo' })
    steps.push({ key: 'checked_out', label: 'Checked out', at: outAt, by: who(c.checked_out_by), state: outAt != null ? 'done' : 'todo' })
  } else {
    const outAt = p?.status === 'Cleared' ? (approvedAt ?? created) : null
    steps.push({ key: 'checked_in', label: 'Checked in', at: null, by: '', state: 'skipped', note: 'Exit pass' })
    steps.push({ key: 'in_yard', label: 'In yard', at: null, by: '', state: 'skipped', note: 'Exit pass' })
    steps.push({ key: 'checked_out', label: 'Checked out', at: outAt, by: who(p?.cleared_by), state: outAt != null ? 'done' : 'todo' })
  }
  if (denied) for (const s of steps.slice(2)) { s.state = 'skipped'; s.note = 'Rejected' }
  return steps
}

/** Profile ids referenced by a set of passes, for one name lookup. */
export function actorIds(passes = []) {
  const s = new Set()
  for (const p of Array.isArray(passes) ? passes : []) {
    const c = cd(p)
    for (const id of [p?.cleared_by, c.created_by, c.checked_in_by, c.checked_out_by]) if (id) s.add(id)
  }
  return [...s]
}

/** Custom data for a new pass from the New Gate Pass form. */
export function newPassCustomData(form, { userId, nowIso } = {}) {
  const inward = form.direction === 'inward'
  const out = {
    direction: inward ? 'inward' : 'outward',
    driver_name: str(form.driverName).trim() || null,
    driver_id: str(form.driverId).trim() || null,
    purpose: str(form.purpose).trim() || null,
    expected_in_at: form.expectedIn ? new Date(form.expectedIn).toISOString() : null,
    expected_out_at: form.expectedOut ? new Date(form.expectedOut).toISOString() : null,
    pre_approval: !!form.preApproval,
    created_by: userId || null,
  }
  if (inward && !form.preApproval) { out.checked_in_at = nowIso; out.checked_in_by = userId || null }
  return out
}

/** Validation for the New Gate Pass form; returns an error string or ''. */
export function validateNewPass(form) {
  if (!str(form.assetNo).trim()) return 'Enter the vehicle or asset.'
  if (form.direction === 'inward') {
    if (!str(form.driverName).trim()) return 'Enter the driver or operator.'
    if (!str(form.purpose).trim()) return 'Choose a purpose.'
  }
  if (form.expectedIn && form.expectedOut && Date.parse(form.expectedOut) < Date.parse(form.expectedIn)) {
    return 'Expected out time must be after the expected in time.'
  }
  return ''
}

export const GATE_EXPORT_COLUMNS = [
  { key: 'ref', header: 'Gate Pass No' },
  { key: 'date', header: 'Date' },
  { key: 'time', header: 'Time' },
  { key: 'type', header: 'Type' },
  { key: 'asset_no', header: 'Vehicle / Asset' },
  { key: 'driver', header: 'Driver / Operator' },
  { key: 'site', header: 'Site' },
  { key: 'purpose', header: 'Purpose' },
  { key: 'status', header: 'Status' },
  { key: 'reason', header: 'Denial Reason' },
]

const p2 = (n) => String(n).padStart(2, '0')
function localDate(t) { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` }
function localTime(t) { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}` }

export function gateExportRows(passes = [], now) {
  return (Array.isArray(passes) ? passes : []).map((p) => {
    const t = ts(p?.created_at)
    const c = cd(p)
    return {
      ref: passRef(p),
      date: t != null ? localDate(t) : (p?.pass_date || ''),
      time: t != null ? localTime(t) : '',
      type: direction(p) === 'inward' ? 'Inward' : 'Outward',
      asset_no: p?.asset_no || '',
      driver: [c.driver_name, c.driver_id ? `ID ${c.driver_id}` : ''].filter(Boolean).join(', '),
      site: p?.site || '',
      purpose: c.purpose || '',
      status: VIEW_STATUS_META[viewStatus(p, now)].label,
      reason: p?.denial_reason || '',
    }
  })
}

/** Shift an inclusive YYYY-MM-DD range by its own length (dir = -1 | 1). */
export function shiftRange(from, to, dir) {
  const a = Date.parse(`${from}T00:00:00`); const b = Date.parse(`${to}T00:00:00`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { from, to }
  const days = Math.round((b - a) / 86_400_000) + 1
  const move = (iso) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + dir * days); return localDate(d.getTime()) }
  return { from: move(from), to: move(to) }
}
