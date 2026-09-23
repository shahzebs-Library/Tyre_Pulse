// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { calendarDateKey, adjacentCalendarDate } from '../lib/calendarDate'

describe('maintenance calendar day keys', () => {
  it.each(['Asia/Riyadh', 'Asia/Dubai', 'America/Los_Angeles'])('matches date-only events to their visible grid day in %s', (timezone) => {
    const source = `import { calendarDateKey } from ${JSON.stringify(new URL('../lib/calendarDate.js', import.meta.url).href)};
      const cell = new Date(2026, 8, 9);
      process.stdout.write(JSON.stringify([calendarDateKey(cell), calendarDateKey('2026-09-09')]));`
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      env: { ...process.env, TZ: timezone }, encoding: 'utf8',
    })
    expect(JSON.parse(result)).toEqual(['2026-09-09', '2026-09-09'])
  })

  it('handles absent or invalid dates without manufacturing a calendar event', () => {
    expect(calendarDateKey(null)).toBeNull()
    expect(calendarDateKey('not a date')).toBeNull()
    expect(calendarDateKey('2026-02-30')).toBeNull()
  })

  it('moves from the selected day instead of the hidden month anchor', () => {
    const monthAnchor = new Date(2026, 8, 1)
    const selected = new Date(2026, 8, 9)
    expect(calendarDateKey(adjacentCalendarDate(monthAnchor, selected, 'day', 1))).toBe('2026-09-10')
    expect(calendarDateKey(adjacentCalendarDate(monthAnchor, selected, 'day', -1))).toBe('2026-09-08')
    expect(selected.getDate()).toBe(9)
  })

  it('does not skip February when changing months from the 31st', () => {
    expect(calendarDateKey(adjacentCalendarDate(new Date(2026, 0, 31), null, 'month', 1))).toBe('2026-02-01')
    expect(calendarDateKey(adjacentCalendarDate(new Date(2026, 2, 31), null, 'month', -1))).toBe('2026-02-01')
  })
})
