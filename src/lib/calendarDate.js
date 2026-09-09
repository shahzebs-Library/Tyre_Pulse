// Date-only database values represent calendar days, not UTC instants. Grid
// cells and timestamp events use the same browser-local calendar convention.
export function calendarDateKey(value) {
  if (!value) return null
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(value + 'T00:00:00Z')
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function adjacentCalendarDate(currentDate, selectedDay, view, direction) {
  const date = new Date(view === 'day' && selectedDay ? selectedDay : currentDate)
  if (view === 'month') {
    // A week/day view can leave the anchor on the 31st. Clamp before changing
    // month so February navigation cannot overflow into March.
    date.setDate(1)
    date.setMonth(date.getMonth() + direction)
  } else {
    date.setDate(date.getDate() + direction * (view === 'week' ? 7 : 1))
  }
  return date
}
