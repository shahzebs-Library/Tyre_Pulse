/**
 * consolePeopleControls - pure helpers for the rebuilt People screens
 * (Users editor, Sessions and devices, Support sessions, Account deletions,
 * Organisations, Incidents). No I/O; every figure that cannot be measured
 * comes back null so the page can print "N/A" with a reason, never a fake 0.
 *
 * MOBILE = FLUTTER ONLY (owner rule). A device row is classed by its push
 * token: an Expo token belongs to the retired Expo app (read-only history),
 * anything else is the Flutter app (FCM).
 */

export const APP_LABEL = {
  flutter: 'Flutter app',
  retired_expo: 'Retired app (read-only)',
  unknown: 'Unknown app',
}

/** Days since a timestamp, or null when it is missing or unparseable. */
export function daysSince(value, now = Date.now()) {
  const t = value ? Date.parse(value) : NaN
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((now - t) / 86400000))
}

/** A device that has not checked in for this many days is called idle. */
export const DEVICE_IDLE_DAYS = 30

/**
 * Headline figures over the device list (admin_list_user_devices rows).
 * `flutterActive` counts devices that can actually receive push today.
 */
export function deviceSummary(rows = [], now = Date.now()) {
  const out = {
    total: 0, flutter: 0, flutterActive: 0, retired: 0, retiredActive: 0, stopped: 0,
    idle: 0, people: 0, flutterPeople: 0, versions: {},
  }
  const people = new Set()
  const flutterPeople = new Set()
  for (const d of rows || []) {
    if (!d) continue
    out.total += 1
    if (d.user_id) people.add(d.user_id)
    if (d.revoked) out.stopped += 1
    const age = daysSince(d.last_seen_at, now)
    if (!d.revoked && age !== null && age > DEVICE_IDLE_DAYS) out.idle += 1
    if (d.app === 'flutter') {
      out.flutter += 1
      if (!d.revoked) {
        out.flutterActive += 1
        if (d.user_id) flutterPeople.add(d.user_id)
        const v = d.app_version || 'Not reported'
        out.versions[v] = (out.versions[v] || 0) + 1
      }
    } else if (d.app === 'retired_expo') {
      out.retired += 1
      if (!d.revoked) out.retiredActive += 1
    }
  }
  out.people = people.size
  out.flutterPeople = flutterPeople.size
  return out
}

/** Filter device rows by app, state and a free-text search over name/username. */
export function filterDevices(rows = [], { app = 'all', state = 'all', search = '' } = {}, now = Date.now()) {
  const q = String(search || '').trim().toLowerCase()
  return (rows || []).filter((d) => {
    if (app !== 'all' && d.app !== app) return false
    if (state === 'active' && d.revoked) return false
    if (state === 'stopped' && !d.revoked) return false
    if (state === 'idle') {
      const age = daysSince(d.last_seen_at, now)
      if (d.revoked || age === null || age <= DEVICE_IDLE_DAYS) return false
    }
    if (!q) return true
    return `${d.full_name || ''} ${d.username || ''} ${d.role || ''}`.toLowerCase().includes(q)
  })
}

/** Plain-English refusal from admin_delete_empty_org. */
export function deleteOrgRefusal(res) {
  if (res?.reason === 'has_members') return 'This organisation still has members, so it was not deleted. Move or remove them first.'
  if (res?.reason === 'has_records') return `This organisation still holds records (${String(res.table || 'a table').replace(/_/g, ' ')}), so it was not deleted. Archive it instead.`
  if (res?.reason === 'referenced') return 'Another record still points at this organisation, so it was not deleted. Archive it instead.'
  if (res?.reason === 'not_found') return 'This organisation no longer exists.'
  return 'The organisation could not be deleted.'
}

/**
 * Whether the Delete action may be offered for an organisation, from the
 * per-organisation figures (admin_org_overview). Unknown figures mean no.
 */
export function canOfferOrgDelete(stats) {
  if (!stats) return { ok: false, reason: 'Member and record counts could not be read, so delete is not offered.' }
  const nums = ['members', 'vehicles', 'tyre_records', 'job_cards', 'expense_lines', 'inspections'].map((k) => Number(stats[k]))
  if (nums.some((n) => !Number.isFinite(n))) return { ok: false, reason: 'Some counts could not be read, so delete is not offered.' }
  if (nums[0] > 0) return { ok: false, reason: `${nums[0]} member${nums[0] === 1 ? '' : 's'} still belong to it.` }
  const records = nums.slice(1).reduce((a, b) => a + b, 0)
  if (records > 0) return { ok: false, reason: `${records} record${records === 1 ? '' : 's'} still belong to it. Archive it instead.` }
  return { ok: true, reason: 'No members and no records.' }
}

/** Ages of open deletion requests, oldest first, plus how many breach `limitDays`. */
export function deletionAgeing(rows = [], limitDays = 30, now = Date.now()) {
  const open = (rows || []).filter((r) => r && (r.status === 'pending' || r.status === 'processing'))
  const ages = open.map((r) => daysSince(r.requested_at, now)).filter((n) => n !== null).sort((a, b) => b - a)
  const resolved = (rows || []).filter((r) => r && (r.status === 'completed' || r.status === 'rejected') && r.processed_at && r.requested_at)
  const turn = resolved.map((r) => (Date.parse(r.processed_at) - Date.parse(r.requested_at)) / 86400000).filter((n) => Number.isFinite(n) && n >= 0)
  return {
    open: open.length,
    oldest: ages.length ? ages[0] : null,
    breaching: ages.filter((a) => a > limitDays).length,
    medianTurnaround: turn.length ? median(turn) : null,
  }
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  const v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  return Math.round(v * 10) / 10
}

/** Short masked device id ("...ab12") or null. */
export function deviceTail(tail) {
  const s = String(tail ?? '').trim()
  return s ? `...${s}` : null
}

/** Severity re-grade check, mirroring incident_change_severity. */
export function severityChangeError({ from, to, reason, status }) {
  if (status === 'resolved') return 'A resolved incident cannot be re-graded.'
  if (!['sev1', 'sev2', 'sev3', 'sev4'].includes(to)) return 'Pick a severity.'
  if (to === from) return 'Pick a different severity.'
  const r = String(reason || '').trim()
  if (r.length < 5) return 'Give a reason of at least 5 characters.'
  if (r.length > 500) return 'Keep the reason under 500 characters.'
  return null
}
