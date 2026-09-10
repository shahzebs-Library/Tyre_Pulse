const DAY_MS = 86400000
export const MAX_PLANNER_BATCH = 500

function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('Enter a valid date.')
  }
  const result = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) {
    throw new RangeError('Enter a valid date.')
  }
  return result
}

export function todayStr(now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new RangeError('Enter a valid date.')
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function addDays(date, count) {
  if (!Number.isInteger(count)) throw new RangeError('Day offset must be a whole number.')
  const result = dateValue(date)
  result.setUTCDate(result.getUTCDate() + count)
  return result.toISOString().slice(0, 10)
}

export function diffDays(start, end) {
  return (dateValue(end).getTime() - dateValue(start).getTime()) / DAY_MS
}

export function weekStart(date) {
  return addDays(date, -dateValue(date).getUTCDay())
}

export function monthBounds(date, offset = 0) {
  if (!Number.isInteger(offset)) throw new RangeError('Month offset must be a whole number.')
  const start = dateValue(date)
  start.setUTCDate(1)
  start.setUTCMonth(start.getUTCMonth() + offset)
  const next = new Date(start)
  next.setUTCMonth(next.getUTCMonth() + 1)
  return { start: start.toISOString().slice(0, 10), end: addDays(next.toISOString().slice(0, 10), -1) }
}

export function buildScheduleDates(start, end, workingDays = [0, 1, 2, 3, 4, 5, 6]) {
  const span = diffDays(start, end)
  if (span < 0) throw new RangeError('End date must be on or after the start date.')
  if (span >= 366) throw new RangeError('Choose a date range of 366 days or fewer.')
  if (!Array.isArray(workingDays) || !workingDays.length || workingDays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new RangeError('Select at least one valid working day.')
  }
  const dates = Array.from({ length: span + 1 }, (_, index) => addDays(start, index))
    .filter(date => workingDays.includes(dateValue(date).getUTCDay()))
  if (!dates.length) throw new RangeError('No selected working days fall in this date range.')
  return dates
}

export function getInspectionGap(lastDate, today, interval) {
  dateValue(today)
  if (!Number.isFinite(interval) || interval <= 0) throw new RangeError('Inspection interval must be positive.')
  if (!lastDate) return { days_since: null, days_overdue: null, status: 'No History' }
  const daysSince = diffDays(lastDate, today)
  if (daysSince < 0) return { days_since: null, days_overdue: null, status: 'No History' }
  return {
    days_since: daysSince,
    days_overdue: Math.max(0, daysSince - interval),
    status: daysSince > interval ? 'Overdue' : daysSince > interval * 0.75 ? 'Due Soon' : 'On Track',
  }
}

const normalized = value => String(value || '').trim().toLowerCase()
const scheduleDate = item => item.inspection_date || item.scheduled_date || ''
const cancelled = item => normalized(item.status) === 'cancelled' || normalized(item.status) === 'canceled'

export function getScheduleCompletion(schedule, { start, end, today, inspectorName } = {}) {
  dateValue(start)
  dateValue(end)
  dateValue(today)
  const due = schedule.filter(item => !cancelled(item)
    && scheduleDate(item) >= start && scheduleDate(item) <= end && scheduleDate(item) <= today
    && (inspectorName === undefined || item.inspector_name === inspectorName))
  const completed = due.filter(item => normalized(item.status) === 'completed').length
  return { due: due.length, completed, rate: due.length ? Math.round(completed / due.length * 100) : null }
}

export function getFleetCoverage(assets, inspections, { today, interval }) {
  const cutoff = addDays(today, -interval)
  const assetKey = item => JSON.stringify([normalized(item.country), item.asset_no])
  const known = new Set(assets.filter(asset => asset.asset_no).map(assetKey))
  const covered = new Set(inspections.filter(item => known.has(assetKey(item))
    && item.inspection_date >= cutoff && item.inspection_date <= today).map(assetKey)).size
  return { total: known.size, covered, rate: known.size ? Math.round(covered / known.size * 100) : null }
}

// Advisory client-side conflicts; database access controls remain authoritative.
export function findScheduleConflicts(items, existing = []) {
  const conflicts = []
  const seen = existing.filter(item => !items.some(candidate => candidate.id && candidate.id === item.id))
  for (const item of items) {
    if (cancelled(item)) continue
    for (const other of seen) {
      if (cancelled(other) || !scheduleDate(item) || scheduleDate(item) !== scheduleDate(other)) continue
      const itemCountry = normalized(item.country)
      const otherCountry = normalized(other.country)
      if (itemCountry && itemCountry !== 'all' && otherCountry && otherCountry !== 'all' && itemCountry !== otherCountry) continue
      if (normalized(item.asset_no) && normalized(item.asset_no) === normalized(other.asset_no)) {
        conflicts.push({ type: 'asset', item, existing: other })
      }
      if (normalized(item.inspector_name) && normalized(item.inspector_name) === normalized(other.inspector_name)
        && item.inspection_time && other.inspection_time
        && item.inspection_time.slice(0, 5) === other.inspection_time.slice(0, 5)) {
        conflicts.push({ type: 'inspector', item, existing: other })
      }
    }
    seen.push(item)
  }
  return conflicts
}
