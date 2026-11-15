import { describe, it, expect } from 'vitest'
import { governedWindow, governedWindowLabel, GRID_BREAKDOWN_NOTE } from '../lib/governedWindow'

describe('governedWindow', () => {
  const now = new Date(2026, 10, 12)
  it('keeps a chosen window as given', () => {
    expect(governedWindow({ from: '2026-01-01', to: '2026-12-31' }, now))
      .toEqual({ from: '2026-01-01', to: '2026-12-31', allTime: false })
  })
  it('ends an open window today, in local time', () => {
    expect(governedWindow({ from: '2026-05-12' }, now).to).toBe('2026-11-12')
  })
  it('turns "no bounds" into an explicit all-time window, never an undefined date', () => {
    const w = governedWindow({}, now)
    expect(w.allTime).toBe(true)
    expect(w.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(governedWindowLabel(w)).toBe('all dates up to 2026-11-12')
  })
  it('labels a closed window with both days and no dash punctuation', () => {
    expect(governedWindowLabel(governedWindow({ from: '2026-01-01', to: '2026-03-31' }, now))).toBe('2026-01-01 to 2026-03-31')
    expect(GRID_BREAKDOWN_NOTE).not.toMatch(/[–—]/)
  })
})
