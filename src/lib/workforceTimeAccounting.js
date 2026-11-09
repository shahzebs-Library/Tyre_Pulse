/**
 * Workforce daily time accounting - pure, deterministic, explainable.
 *
 * Mirrors the server guard in supabase/migrations/20261109170000_workforce_time_accounting.sql.
 * Rules:
 *  - Instants must be ISO 8601 strings WITH an offset or Z. A bare local time is ambiguous and is
 *    rejected rather than guessed (that is how timezone errors shift whole shifts by hours).
 *  - Overlapping entries are CLIPPED, never double counted: the entry that started first keeps the
 *    shared minutes and the overlap is reported. Duplicate rows (same id) are counted once.
 *  - Impossible intervals (end <= start, longer than 16 hours, in the future) are excluded and reported.
 *  - Shift minutes that no entry covers are 'not_recorded'. They are NEVER idle or unproductive:
 *    nobody recorded them, so nothing is known about them.
 *  - Employee-reported 'unassigned' time is a real, recorded category and is kept separate from
 *    'not_recorded'.
 * No personnel or disciplinary decision is made here.
 */

export const MAX_ENTRY_MINUTES = 16 * 60
export const FUTURE_TOLERANCE_MS = 5 * 60000
export const ASSIGNMENT_VARIANCE_TOLERANCE_MINUTES = 15

export const CATEGORY_GROUPS = Object.freeze(['work', 'support', 'waiting', 'break', 'not_recorded'])

export const CATEGORY_META = Object.freeze({
  productive: { label: 'Active work', group: 'work', needsReason: false },
  reporting: { label: 'Reporting and paperwork', group: 'support', needsReason: false },
  coordination: { label: 'Coordination', group: 'support', needsReason: false },
  training: { label: 'Training', group: 'support', needsReason: false },
  travel: { label: 'Travel between sites', group: 'support', needsReason: false },
  waiting_stock: { label: 'Waiting for stock', group: 'waiting', needsReason: false },
  waiting_equipment: { label: 'Waiting for equipment', group: 'waiting', needsReason: false },
  vehicle_unavailable: { label: 'Vehicle not available', group: 'waiting', needsReason: false },
  safety_hold: { label: 'Safety hold', group: 'waiting', needsReason: false },
  blocked: { label: 'Blocked (other reason)', group: 'waiting', needsReason: true },
  unassigned: { label: 'No work assigned (reported)', group: 'waiting', needsReason: false },
  break: { label: 'Approved break', group: 'break', needsReason: false },
  not_recorded: { label: 'Not recorded', group: 'not_recorded', needsReason: false, synthetic: true },
})

/** Categories an entry may carry (the DB CHECK). 'not_recorded' is computed, never stored. */
export const ENTRY_CATEGORIES = Object.freeze(Object.keys(CATEGORY_META).filter(k => !CATEGORY_META[k].synthetic))
/** Categories that capture a cause; the UI should offer a reason box for these. */
export const REASON_CATEGORIES = Object.freeze(['blocked', 'waiting_stock', 'waiting_equipment', 'vehicle_unavailable', 'safety_hold'])

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i
/** Epoch ms of an ISO instant that carries an explicit offset, else null. */
export function parseInstant (v) {
  if (typeof v !== 'string' || !ISO_WITH_ZONE.test(v.trim())) return null
  const n = Date.parse(v.trim())
  return Number.isFinite(n) ? n : null
}
const round = x => Math.round(x * 100) / 100
const mins = ms => ms / 60000

function emptyMinutes () {
  return Object.fromEntries(Object.keys(CATEGORY_META).map(k => [k, 0]))
}

/**
 * @param {object} p
 * @param {Array} p.entries   rows with category, started_at, ended_at, optional id, assignment_id, blocked_reason|reason
 * @param {string} [p.shiftStart] ISO instant; without a valid shift, not_recorded is null (unknown), not 0
 * @param {string} [p.shiftEnd]
 * @param {number} [p.assignmentsActiveMinutes] in-progress minutes from assignment events, for reconciliation
 * @param {number|string|Date} [p.now] reference time for the future-dated rule (defaults to Date.now())
 */
export function accountDay ({ entries = [], shiftStart = null, shiftEnd = null, assignmentsActiveMinutes = null, now = Date.now() } = {}) {
  const warnings = []
  const nowMs = now instanceof Date ? now.getTime() : (typeof now === 'string' ? Date.parse(now) : Number(now))
  const S = parseInstant(shiftStart); const E = parseInstant(shiftEnd)
  let shiftValid = S !== null && E !== null && E > S
  if ((shiftStart || shiftEnd) && !shiftValid) warnings.push({ type: 'invalid_shift', message: 'Shift start/end must be ISO instants with a timezone, end after start' })
  if (shiftValid && E - S > 24 * 3600000) { warnings.push({ type: 'invalid_shift', message: 'Shift longer than 24 hours' }); shiftValid = false }

  const seen = new Set(); const valid = []
  ;(Array.isArray(entries) ? entries : []).forEach((e, index) => {
    if (!e || typeof e !== 'object') { warnings.push({ type: 'invalid_entry', index, message: 'Empty entry' }); return }
    if (e.id != null) {
      if (seen.has(e.id)) { warnings.push({ type: 'duplicate_entry', index, id: e.id, message: 'Same entry listed twice; counted once' }); return }
      seen.add(e.id)
    }
    if (!ENTRY_CATEGORIES.includes(e.category)) { warnings.push({ type: 'unknown_category', index, id: e.id ?? null, message: `Unknown category ${e.category}` }); return }
    const from = parseInstant(e.started_at); const to = parseInstant(e.ended_at)
    if (from === null || to === null) { warnings.push({ type: 'invalid_interval', index, id: e.id ?? null, message: 'Missing time or timezone' }); return }
    if (to <= from) { warnings.push({ type: 'invalid_interval', index, id: e.id ?? null, message: 'Ends before it starts' }); return }
    if (to - from > MAX_ENTRY_MINUTES * 60000) { warnings.push({ type: 'too_long', index, id: e.id ?? null, message: 'Longer than 16 hours' }); return }
    if (Number.isFinite(nowMs) && (from > nowMs + FUTURE_TOLERANCE_MS || to > nowMs + FUTURE_TOLERANCE_MS)) {
      warnings.push({ type: 'future', index, id: e.id ?? null, message: 'Recorded in the future' }); return
    }
    if (CATEGORY_META[e.category].needsReason && !String(e.blocked_reason ?? e.reason ?? '').trim()) {
      warnings.push({ type: 'reason_missing', index, id: e.id ?? null, message: 'Blocked time without a reason' })
    }
    valid.push({ index, id: e.id ?? null, category: e.category, assignmentId: e.assignment_id ?? null, from, to })
  })

  // Earliest start owns shared minutes. All earlier entries start at or before this one, so their
  // union from this start onward is one contiguous span ending at `claimedUntil`.
  valid.sort((a, b) => a.from - b.from || b.to - a.to || a.index - b.index)
  const overlaps = []; const kept = []
  let claimedUntil = -Infinity; let owner = null
  for (const v of valid) {
    if (v.from < claimedUntil) {
      const shared = Math.min(v.to, claimedUntil) - v.from
      overlaps.push({ index: v.index, id: v.id, with_index: owner.index, with_id: owner.id, minutes: round(mins(shared)) })
    }
    const start = Math.max(v.from, claimedUntil)
    if (v.to > start) kept.push({ ...v, start, end: v.to })
    if (v.to > claimedUntil) { claimedUntil = v.to; owner = v }
  }
  for (const o of overlaps) warnings.push({ type: 'overlap', index: o.index, id: o.id, minutes: o.minutes, message: `Overlaps another activity by ${o.minutes} min; counted once` })

  const minutes = emptyMinutes()
  let recordedMs = 0; let inShiftMs = 0; let linkedMs = 0; let linkedActiveMs = 0
  for (const k of kept) {
    const d = k.end - k.start
    minutes[k.category] += mins(d)
    recordedMs += d
    if (shiftValid) inShiftMs += Math.max(0, Math.min(k.end, E) - Math.max(k.start, S))
    if (k.assignmentId) { linkedMs += d; if (k.category === 'productive') linkedActiveMs += d }
  }
  const shiftMs = shiftValid ? E - S : null
  const notRecordedMs = shiftValid ? Math.max(0, shiftMs - inShiftMs) : null
  minutes.not_recorded = notRecordedMs === null ? null : mins(notRecordedMs)
  for (const k of Object.keys(minutes)) if (minutes[k] !== null) minutes[k] = round(minutes[k])

  const groups = Object.fromEntries(CATEGORY_GROUPS.map(g => [g, 0]))
  for (const [k, meta] of Object.entries(CATEGORY_META)) {
    if (minutes[k] === null) { groups[meta.group] = null; continue }
    if (groups[meta.group] !== null) groups[meta.group] = round(groups[meta.group] + minutes[k])
  }
  if (notRecordedMs > 0) warnings.push({ type: 'not_recorded', minutes: round(mins(notRecordedMs)), message: `${round(mins(notRecordedMs))} min of the shift has no recorded activity (unknown, not idle)` })

  let assignmentVariance = null
  if (assignmentsActiveMinutes !== null && assignmentsActiveMinutes !== undefined) {
    if (typeof assignmentsActiveMinutes === 'number' && Number.isFinite(assignmentsActiveMinutes) && assignmentsActiveMinutes >= 0) {
      assignmentVariance = round(mins(linkedActiveMs) - assignmentsActiveMinutes)
      if (Math.abs(assignmentVariance) > ASSIGNMENT_VARIANCE_TOLERANCE_MINUTES) {
        warnings.push({ type: 'assignment_time_mismatch', minutes: assignmentVariance, message: `Recorded work on assignments differs from assignment progress by ${assignmentVariance} min` })
      }
    } else warnings.push({ type: 'invalid_assignment_minutes', message: 'Assignment minutes must be a non-negative number' })
  }

  const excluded = warnings.filter(w => ['invalid_entry', 'duplicate_entry', 'unknown_category', 'invalid_interval', 'too_long', 'future'].includes(w.type)).length
  return {
    minutes,
    groups,
    recorded_minutes: round(mins(recordedMs)),
    shift_minutes: shiftMs === null ? null : round(mins(shiftMs)),
    recorded_in_shift_minutes: shiftValid ? round(mins(inShiftMs)) : null,
    outside_shift_minutes: shiftValid ? round(mins(recordedMs - inShiftMs)) : null,
    not_recorded_minutes: notRecordedMs === null ? null : round(mins(notRecordedMs)),
    coverage_pct: shiftValid ? round(100 * inShiftMs / shiftMs) : null,
    active_work_minutes: minutes.productive,
    assignment_linked_minutes: round(mins(linkedMs)),
    assignment_active_work_minutes: round(mins(linkedActiveMs)),
    unlinked_active_work_minutes: round(minutes.productive - mins(linkedActiveMs)),
    assignment_variance_minutes: assignmentVariance,
    overlaps,
    overlap_minutes: round(overlaps.reduce((n, o) => n + o.minutes, 0)),
    excluded_entries: excluded,
    warnings,
  }
}

export function categoryLabel (category) {
  return CATEGORY_META[category]?.label ?? String(category ?? '')
}
