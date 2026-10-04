import { describe, it, expect } from 'vitest'
import { parseConfigNumber, parseConfigBool, projectMonthEnd, percentile, validateCap, aiControlImpact } from '../lib/aiUsageControls'

describe('aiUsageControls', () => {
  it('parses config numbers stored bare or quoted, unknown as null', () => {
    expect(parseConfigNumber('20')).toBe(20)
    expect(parseConfigNumber('"12.5"')).toBe(12.5)
    expect(parseConfigNumber(null)).toBeNull()
    expect(parseConfigNumber('abc')).toBeNull()
  })
  it('parses booleans and keeps unknown as null', () => {
    expect(parseConfigBool('true')).toBe(true)
    expect(parseConfigBool('"false"')).toBe(false)
    expect(parseConfigBool(undefined)).toBeNull()
    expect(parseConfigBool('maybe')).toBeNull()
  })
  it('projects month-end spend in a straight line and refuses on day 1', () => {
    const r = projectMonthEnd(10, new Date(Date.UTC(2026, 9, 10)))
    expect(r.daysInMonth).toBe(31)
    expect(r.projected).toBeCloseTo(31)
    expect(projectMonthEnd(5, new Date(Date.UTC(2026, 9, 1))).projected).toBeNull()
    expect(projectMonthEnd(null, new Date(Date.UTC(2026, 9, 10))).projected).toBeNull()
  })
  it('computes nearest-rank percentiles and null when empty', () => {
    expect(percentile([100, 200, 300, 400], 50)).toBe(200)
    expect(percentile([100, 200, 300, 400], 95)).toBe(400)
    expect(percentile([null, 'x'], 50)).toBeNull()
  })
  it('validates caps', () => {
    expect(validateCap('')).toMatch(/Enter a number/)
    expect(validateCap('-1')).toMatch(/positive/)
    expect(validateCap('2.5', { integer: true })).toMatch(/whole/)
    expect(validateCap('0')).toBeNull()
    expect(validateCap('50')).toBeNull()
  })
  it('describes each control in plain words', () => {
    expect(aiControlImpact('pause').tone).toBe('danger')
    expect(aiControlImpact('budget', { budget: 20, next: 0 }).change).toMatch(/no cap/)
    expect(aiControlImpact('rate', { rateLimit: 10, next: 5 }).change).toMatch(/5 a minute/)
  })
})
