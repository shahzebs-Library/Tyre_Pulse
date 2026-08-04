import { compareVersions, isUpdateRequired } from '../lib/appVersion'

describe('compareVersions', () => {
  it('orders by each numeric segment', () => {
    expect(compareVersions('1.3.0', '1.3.1')).toBeLessThan(0)
    expect(compareVersions('1.3.1', '1.3.0')).toBeGreaterThan(0)
    expect(compareVersions('1.3.0', '1.3.0')).toBe(0)
  })
  it('treats missing segments as zero', () => {
    expect(compareVersions('1.3', '1.3.0')).toBe(0)
    expect(compareVersions('2', '1.9.9')).toBeGreaterThan(0)
  })
  it('does not compare segments as text', () => {
    // "10" must beat "9" - a string compare would get this backwards.
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
  })
  it('is safe on rubbish input', () => {
    expect(compareVersions('', '')).toBe(0)
    expect(compareVersions('abc', '0.0.0')).toBe(0)
  })
})

describe('isUpdateRequired', () => {
  it('blocks only a genuinely older build', () => {
    expect(isUpdateRequired('1.3.0', '1.3.1')).toBe(true)
    expect(isUpdateRequired('1.3.1', '1.3.1')).toBe(false)
    expect(isUpdateRequired('1.4.0', '1.3.1')).toBe(false)
  })

  // The safety property that matters most: a missing or broken minimum must
  // never lock a field user out of the app.
  it('never blocks when the minimum is absent or unusable', () => {
    expect(isUpdateRequired('1.3.0', null)).toBe(false)
    expect(isUpdateRequired('1.3.0', undefined)).toBe(false)
    expect(isUpdateRequired('1.3.0', '')).toBe(false)
    expect(isUpdateRequired('1.3.0', '   ')).toBe(false)
    expect(isUpdateRequired('1.3.0', 'latest')).toBe(false)
  })
})
