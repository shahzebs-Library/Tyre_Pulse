import { describe, it, expect } from 'vitest'
import {
  toFiniteNumber, hasInfringement, summariseTachograph, byDriver,
  DAILY_DRIVE_LIMIT_MIN,
} from '../lib/tachographRecords'

describe('tachographRecords — toFiniteNumber', () => {
  it('parses numeric strings and numbers, rejecting non-numeric input', () => {
    expect(toFiniteNumber(540)).toBe(540)
    expect(toFiniteNumber('600')).toBe(600)
    expect(toFiniteNumber('540 min')).toBe(540)
    expect(toFiniteNumber('')).toBeNull()
    expect(toFiniteNumber(null)).toBeNull()
    expect(toFiniteNumber(undefined)).toBeNull()
    expect(toFiniteNumber('abc')).toBeNull()
  })
})

describe('tachographRecords — hasInfringement', () => {
  it('is false with no count and driving within the limit', () => {
    expect(hasInfringement({ infringement_count: 0, driving_min: 480 })).toBe(false)
    expect(hasInfringement({ driving_min: DAILY_DRIVE_LIMIT_MIN })).toBe(false)
    expect(hasInfringement({})).toBe(false)
    expect(hasInfringement(null)).toBe(false)
  })

  it('triggers when infringement_count > 0', () => {
    expect(hasInfringement({ infringement_count: 1, driving_min: 100 })).toBe(true)
    expect(hasInfringement({ infringement_count: '3' })).toBe(true)
  })

  it('triggers when driving_min exceeds the daily limit', () => {
    expect(hasInfringement({ infringement_count: 0, driving_min: DAILY_DRIVE_LIMIT_MIN + 1 })).toBe(true)
    expect(hasInfringement({ driving_min: 600 })).toBe(true)
  })
})

describe('tachographRecords — summariseTachograph', () => {
  const rows = [
    { driver_name: 'A', driving_min: 480, infringement_count: 0, status: 'downloaded' },
    { driver_name: 'A', driving_min: 600, infringement_count: 0, status: 'flagged' },
    { driver_name: 'B', driving_min: 300, infringement_count: 2, status: 'reviewed' },
  ]

  it('returns a zeroed summary for empty / non-array input', () => {
    expect(summariseTachograph([])).toEqual({
      totalRecords: 0, distinctDrivers: 0, totalDrivingHours: 0,
      totalInfringements: 0, flaggedCount: 0, overDriveDays: 0,
    })
    expect(summariseTachograph(null).totalRecords).toBe(0)
  })

  it('counts records, distinct drivers, driving hours, infringements, flags, over-limit days', () => {
    const s = summariseTachograph(rows)
    expect(s.totalRecords).toBe(3)
    expect(s.distinctDrivers).toBe(2)
    expect(s.totalDrivingHours).toBe(23) // (480+600+300)/60 = 23
    expect(s.totalInfringements).toBe(2)
    expect(s.flaggedCount).toBe(1)
    expect(s.overDriveDays).toBe(1) // only the 600-min row exceeds 540
  })
})

describe('tachographRecords — byDriver', () => {
  it('returns [] for empty / non-array input', () => {
    expect(byDriver([])).toEqual([])
    expect(byDriver(null)).toEqual([])
  })

  it('ignores rows without a driver name', () => {
    expect(byDriver([{ driving_min: 100 }, { driver_name: '  ' }])).toEqual([])
  })

  it('aggregates per driver and sorts by infringements descending', () => {
    const rows = [
      { driver_name: 'A', driving_min: 480, infringement_count: 0 },
      { driver_name: 'A', driving_min: 600, infringement_count: 0 }, // over-limit → +1
      { driver_name: 'B', driving_min: 300, infringement_count: 3 },
    ]
    const result = byDriver(rows)
    expect(result).toHaveLength(2)
    expect(result[0].driver_name).toBe('B')
    expect(result[0].infringements).toBe(3)
    expect(result[1].driver_name).toBe('A')
    expect(result[1].records).toBe(2)
    expect(result[1].drivingMin).toBe(1080)
    expect(result[1].infringements).toBe(1) // over-limit day counts once
  })

  it('prefers explicit infringement_count over the over-limit fallback', () => {
    const rows = [{ driver_name: 'A', driving_min: 600, infringement_count: 5 }]
    expect(byDriver(rows)[0].infringements).toBe(5)
  })

  it('trims and groups equivalent driver names', () => {
    const rows = [
      { driver_name: 'A', driving_min: 100 },
      { driver_name: ' A ', driving_min: 200 },
    ]
    const result = byDriver(rows)
    expect(result).toHaveLength(1)
    expect(result[0].records).toBe(2)
    expect(result[0].drivingMin).toBe(300)
  })

  it('breaks infringement ties by record count descending', () => {
    const rows = [
      { driver_name: 'Solo', infringement_count: 0, driving_min: 100 },
      { driver_name: 'Busy', infringement_count: 0, driving_min: 100 },
      { driver_name: 'Busy', infringement_count: 0, driving_min: 100 },
    ]
    expect(byDriver(rows).map((d) => d.driver_name)).toEqual(['Busy', 'Solo'])
  })
})

describe('tachographRecords — DAILY_DRIVE_LIMIT_MIN', () => {
  it('is the EU 9-hour daily driving limit in minutes', () => {
    expect(DAILY_DRIVE_LIMIT_MIN).toBe(540)
  })
})
