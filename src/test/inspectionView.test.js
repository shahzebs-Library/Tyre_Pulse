import { describe, it, expect } from 'vitest'
import {
  normalizeTyreConditions, inspectionStats, tyreReadingRows,
  pressureFlagAvailable, pressureDeviation, readingText,
  inspectionMeta, inspectionSummary, isComplete,
} from '../lib/inspectionView'

describe('normalizeTyreConditions', () => {
  it('reads the web object shape', () => {
    const n = normalizeTyreConditions({ tyre_conditions: { FL: { condition: 'Good', pressure: 100, treadDepth: 12 } } })
    expect(n.FL).toMatchObject({ risk: 'good', pressure: 100, tread: 12, condition: 'Good' })
  })

  it('reads the mobile array shape and its pressure_psi / tread_depth_mm names', () => {
    const n = normalizeTyreConditions({
      tyre_conditions: [{ position: 'RL', condition: 'Wear', pressure_psi: 88, tread_depth_mm: 4 }],
    })
    expect(n.RL).toMatchObject({ risk: 'warning', pressure: 88, tread: 4 })
  })

  it('reads a bare condition string as a position value', () => {
    expect(normalizeTyreConditions({ tyre_conditions: { FR: 'Damage' } }).FR.risk).toBe('critical')
  })

  it('parses a JSON string, and gives up honestly on junk', () => {
    expect(normalizeTyreConditions({ tyre_conditions: '{"FL":{"condition":"Good"}}' }).FL.risk).toBe('good')
    expect(normalizeTyreConditions({ tyre_conditions: 'not json' })).toEqual({})
    expect(normalizeTyreConditions(null)).toEqual({})
  })

  // A reading of 0 PSI is not a reading, it is an empty box; but it must never
  // be invented as a number either.
  it('treats a missing or zero reading as not recorded, never as 0', () => {
    const n = normalizeTyreConditions({ tyre_conditions: { FL: { condition: 'Good', pressure: 0 } } })
    expect(n.FL.pressure).toBeNull()
    expect(n.FL.tread).toBeNull()
  })
})

describe('inspectionStats', () => {
  it('averages only what was recorded and returns null when nothing was', () => {
    const s = inspectionStats(normalizeTyreConditions({ tyre_conditions: { FL: { condition: 'Good' } } }))
    expect(s.total).toBe(1)
    expect(s.avgPressure).toBeNull()
    expect(s.avgTread).toBeNull()
    expect(s.lowTread).toBeNull()
  })

  it('counts by risk band and finds the lowest tread', () => {
    const s = inspectionStats(normalizeTyreConditions({
      tyre_conditions: {
        FL: { condition: 'Good', pressure: 100, tread: 10 },
        FR: { condition: 'Damage', pressure: 100, tread: 3 },
      },
    }))
    expect(s.counts).toMatchObject({ good: 1, critical: 1 })
    expect(s.lowTread).toEqual({ pos: 'FR', value: 3 })
    expect(s.avgPressure).toBe(100)
  })
})

describe('pressure vs the vehicle median', () => {
  const build = (pressures) => inspectionStats(normalizeTyreConditions({
    tyre_conditions: Object.fromEntries(pressures.map((p, i) => [`P${i}`, { condition: 'Good', pressure: p }])),
  }))

  // A median of one or two readings is noise, not a reference.
  it('needs four readings before it will compare anything', () => {
    expect(pressureFlagAvailable(build([100, 100, 100]))).toBe(false)
    expect(pressureFlagAvailable(build([100, 100, 100, 100]))).toBe(true)
    expect(pressureDeviation(50, build([100, 100, 100]))).toBeNull()
  })

  it('flags only a reading more than 15% off that median', () => {
    const s = build([100, 100, 100, 100])
    expect(pressureDeviation(110, s).check).toBe(false)
    expect(pressureDeviation(120, s)).toMatchObject({ check: true, pct: 20, direction: 'over' })
    expect(pressureDeviation(80, s)).toMatchObject({ check: true, pct: 20, direction: 'under' })
  })
})

describe('tyreReadingRows', () => {
  it('shows only positions that carry something recorded', () => {
    const { rows } = tyreReadingRows({
      tyre_conditions: {
        FL: { condition: 'Good', pressure: 100 },
        FR: {},                       // untouched wheel
        RL: { notes: 'valve leaking' }, // a note alone is content
      },
    })
    expect(rows.map((r) => r.position).sort()).toEqual(['FL', 'RL'])
  })

  it('falls back to the risk label when no condition word was written', () => {
    const { rows } = tyreReadingRows({ tyre_conditions: { FL: { pressure: 100 } } })
    expect(rows[0].condition).toBe('No Data')
  })
})

describe('readingText', () => {
  it('says a missing reading was not recorded rather than printing zero', () => {
    expect(readingText(null, ' PSI')).toBe('Not recorded')
    expect(readingText(100, ' PSI')).toBe('100 PSI')
  })
})

describe('inspectionMeta / inspectionSummary / isComplete', () => {
  it('omits facts the record does not carry', () => {
    const labels = inspectionMeta({ asset_no: 'TM100', status: 'Done' }).map(([l]) => l)
    expect(labels).toContain('Asset')
    expect(labels).not.toContain('Site')
    expect(labels).not.toContain('Meters')
  })

  it('combines odometer and hour meter into one meters line', () => {
    const meta = inspectionMeta({ odometer_km: 1000, hour_meter: 50 })
    expect(meta.find(([l]) => l === 'Meters')[1]).toBe('1,000 km  |  50 hrs')
  })

  // Nulls, not zeros: "we have not loaded it" is not "it recorded nothing".
  it('returns nulls for a missing row', () => {
    expect(inspectionSummary(null)).toEqual({
      positions: null, recorded: null, damaged: null, avgPressure: null, lowTread: null,
    })
  })

  it('reads completeness off the record status', () => {
    expect(isComplete({ status: 'Done' })).toBe(true)
    expect(isComplete({ status: 'approved' })).toBe(true)
    expect(isComplete({ status: 'In Progress' })).toBe(false)
    expect(isComplete(null)).toBe(false)
  })
})
