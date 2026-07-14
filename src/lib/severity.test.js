import { describe, it, expect } from 'vitest'
import {
  SEVERITY, SEVERITY_LEVELS, SEVERITY_RANK, SEVERITY_OPTS, SEVERITY_META,
  normalizeSeverity, severityRank, bySeverityDesc, isAtLeast,
  severityBadgeClass, severityColor, severityFromAccidentDamage,
  isVehicleOffRoad, normalizeVorStatus, VOR_STATUS,
} from './severity'

describe('normalizeSeverity', () => {
  it('accepts canonical labels case-insensitively', () => {
    expect(normalizeSeverity('Critical')).toBe('Critical')
    expect(normalizeSeverity('critical')).toBe('Critical')
    expect(normalizeSeverity('HIGH')).toBe('High')
    expect(normalizeSeverity('medium')).toBe('Medium')
    expect(normalizeSeverity('Low')).toBe('Low')
  })

  it('folds synonyms onto the ladder', () => {
    expect(normalizeSeverity('severe')).toBe('Critical')
    expect(normalizeSeverity('total loss')).toBe('Critical')
    expect(normalizeSeverity('major')).toBe('High')
    expect(normalizeSeverity('urgent')).toBe('High')
    expect(normalizeSeverity('moderate')).toBe('Medium')
    expect(normalizeSeverity('warning')).toBe('Medium')
    expect(normalizeSeverity('normal')).toBe('Medium')
    expect(normalizeSeverity('minor')).toBe('Low')
    expect(normalizeSeverity('cosmetic')).toBe('Low')
    expect(normalizeSeverity('info')).toBe('Info')
  })

  it('maps numeric scales (1..5)', () => {
    expect(normalizeSeverity(1)).toBe('Low')
    expect(normalizeSeverity(2)).toBe('Medium')
    expect(normalizeSeverity(3)).toBe('High')
    expect(normalizeSeverity(4)).toBe('Critical')
    expect(normalizeSeverity(5)).toBe('Critical')
    expect(normalizeSeverity('3')).toBe('High')
  })

  it('returns the fallback for unknown / empty input', () => {
    expect(normalizeSeverity(null)).toBeNull()
    expect(normalizeSeverity('')).toBeNull()
    expect(normalizeSeverity('banana')).toBeNull()
    expect(normalizeSeverity('banana', 'Low')).toBe('Low')
    expect(normalizeSeverity(undefined, SEVERITY.MEDIUM)).toBe('Medium')
  })
})

describe('ranking + sorting', () => {
  it('ranks worst-highest', () => {
    expect(severityRank('Critical')).toBe(4)
    expect(severityRank('High')).toBe(3)
    expect(severityRank('Medium')).toBe(2)
    expect(severityRank('Low')).toBe(1)
    expect(severityRank('Info')).toBe(0)
    expect(severityRank('unknown')).toBe(0)
  })

  it('SEVERITY_RANK matches SEVERITY_META rank', () => {
    for (const lvl of SEVERITY_LEVELS) {
      expect(SEVERITY_RANK[lvl]).toBe(SEVERITY_META[lvl].rank)
    }
  })

  it('bySeverityDesc sorts worst-first', () => {
    const rows = [{ s: 'Low' }, { s: 'Critical' }, { s: 'Medium' }, { s: 'high' }]
    const sorted = [...rows].sort(bySeverityDesc((r) => r.s)).map((r) => r.s)
    expect(sorted).toEqual(['Critical', 'high', 'Medium', 'Low'])
  })

  it('isAtLeast compares across variants', () => {
    expect(isAtLeast('major', 'Medium')).toBe(true) // High >= Medium
    expect(isAtLeast('low', 'High')).toBe(false)
    expect(isAtLeast('Critical', 'Critical')).toBe(true)
  })

  it('SEVERITY_OPTS covers the actionable levels in order', () => {
    expect(SEVERITY_OPTS.map((o) => o.value)).toEqual(['Critical', 'High', 'Medium', 'Low'])
  })
})

describe('presentation helpers', () => {
  it('badge + colour resolve for any variant and fall back safely', () => {
    expect(severityBadgeClass('critical')).toContain('red')
    expect(severityBadgeClass('minor')).toContain('green')
    expect(severityBadgeClass('nonsense')).toBe(SEVERITY_META.Low.badge)
    expect(severityColor('major')).toBe(SEVERITY_META.High.hex)
    expect(severityColor('nonsense')).toBe(SEVERITY_META.Low.hex)
  })
})

describe('accident damage bridge', () => {
  it('maps damage severity onto the unified ladder', () => {
    expect(severityFromAccidentDamage('Minor')).toBe('Low')
    expect(severityFromAccidentDamage('Major')).toBe('High')
    expect(severityFromAccidentDamage('Total Loss')).toBe('Critical')
    expect(severityFromAccidentDamage('')).toBe('Medium')
    expect(severityFromAccidentDamage('', 'Low')).toBe('Low')
  })
})

describe('VOR — vehicle off road', () => {
  it('detects explicit boolean flags on a record', () => {
    expect(isVehicleOffRoad({ vor: true })).toBe(true)
    expect(isVehicleOffRoad({ off_road: true })).toBe(true)
    expect(isVehicleOffRoad({ grounded: true })).toBe(true)
    expect(isVehicleOffRoad({ vor: false, status: 'Active' })).toBe(false)
  })

  it('detects out-of-service status strings', () => {
    expect(isVehicleOffRoad('VOR')).toBe(true)
    expect(isVehicleOffRoad('Off Road')).toBe(true)
    expect(isVehicleOffRoad('out of service')).toBe(true)
    expect(isVehicleOffRoad({ status: 'Grounded' })).toBe(true)
    expect(isVehicleOffRoad({ availability: 'On Road' })).toBe(false)
    expect(isVehicleOffRoad('Active')).toBe(false)
  })

  it('does NOT infer VOR from severity alone (honest)', () => {
    expect(isVehicleOffRoad({ severity: 'Critical' })).toBe(false)
  })

  it('normalizeVorStatus yields canonical labels', () => {
    expect(normalizeVorStatus('breakdown')).toBe(VOR_STATUS.OFF_ROAD)
    expect(normalizeVorStatus('running')).toBe(VOR_STATUS.ON_ROAD)
    expect(normalizeVorStatus(null)).toBe(VOR_STATUS.ON_ROAD)
  })
})
