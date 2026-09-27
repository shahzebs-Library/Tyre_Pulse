import { describe, it, expect } from 'vitest'
import {
  scoreInstalledFleet, riskSites, filterRiskRows, riskExportRows,
  filterReadings, readingRows, readingExportRows, RISK_EXPORT_COLS,
} from '../lib/heatIntelligenceAnalytics'
import { assessFleetRisk } from '../lib/heatIntelligence'

const NOW = new Date('2026-09-27T00:00:00Z')

function tyre(i, over = {}) {
  return { id: i, serial_no: `S${i}`, asset_no: `TM${i % 7}`, site: i % 2 ? 'NHC' : 'JED', size: '315/80R22.5', tread_depth: 1, pressure_reading: 70, issue_date: '2019-01-01', ...over }
}

describe('heatIntelligenceAnalytics', () => {
  it('scores every installed tyre, not only the top 30', () => {
    const records = Array.from({ length: 45 }, (_, i) => tyre(i))
    records.push(tyre(99, { removal_date: '2026-01-01' }))
    const { rows, summary } = scoreInstalledFleet(records, { ambient_c: 48, now: NOW })
    expect(rows).toHaveLength(45)
    expect(summary.fleet_size).toBe(45)
    expect(assessFleetRisk(records, { ambient_c: 48, now: NOW }).high_risk_tyres).toHaveLength(30)
    // Same scoring as the locked engine.
    const engine = assessFleetRisk(records, { ambient_c: 48, now: NOW })
    expect(summary.bands).toEqual(engine.risk_summary)
    expect(summary.fleet_risk_score).toBe(engine.fleet_risk_score)
    expect(rows[0].risk_score).toBeGreaterThanOrEqual(rows[44].risk_score)
  })

  it('fleet risk score is N/A for an empty fleet and coverage is reported', () => {
    expect(scoreInstalledFleet([], { ambient_c: 30 }).summary.fleet_risk_score).toBeNull()
    const { summary } = scoreInstalledFleet([tyre(1), tyre(2, { tread_depth: null, pressure_reading: null })], { ambient_c: 30, now: NOW })
    expect(summary.with_tread).toBe(1)
    expect(summary.with_pressure).toBe(1)
    expect(summary.unmeasured).toBe(1)
  })

  it('filters by level, at-risk, site and search', () => {
    const { rows } = scoreInstalledFleet([tyre(1), tyre(2), tyre(3, { tread_depth: 12, pressure_reading: 105, issue_date: '2026-09-01' })], { ambient_c: 20, now: NOW })
    expect(riskSites(rows)).toEqual(['JED', 'NHC'])
    expect(filterRiskRows(rows, { site: 'JED' }).map((r) => r.serial)).toEqual(['S2'])
    expect(filterRiskRows(rows, { search: 's3' })).toHaveLength(1)
    const atRisk = filterRiskRows(rows, { level: 'at_risk' })
    expect(atRisk.every((r) => r.risk_score >= 30)).toBe(true)
    expect(filterRiskRows(rows, { level: 'low' }).every((r) => r.risk_level === 'low')).toBe(true)
  })

  it('export rows carry every column and N/A for missing readings', () => {
    const { rows } = scoreInstalledFleet([tyre(1, { tread_depth: null })], { ambient_c: 40, now: NOW })
    const [row] = riskExportRows(rows)
    expect(Object.keys(row)).toEqual(RISK_EXPORT_COLS)
    expect(row.tread_mm).toBe('N/A')
  })

  it('reading helpers classify, filter and export the log', () => {
    const readings = [
      { id: 1, asset_no: 'TM1', tyre_position: 'FL', temperature_c: 120, ambient_c: 45, country: 'UAE', notes: 'hot run' },
      { id: 2, asset_no: 'TM2', tyre_position: 'RR', temperature_c: 60, ambient_c: null, country: 'KSA' },
    ]
    const shaped = readingRows(readings)
    expect(shaped[0].rise_c).toBe(75)
    expect(shaped[1].rise_c).toBeNull()
    expect(shaped[0].band_rank).toBeGreaterThan(shaped[1].band_rank)
    expect(filterReadings(readings, { search: 'hot' })).toHaveLength(1)
    expect(filterReadings(readings, { country: 'KSA' })).toHaveLength(1)
    expect(filterReadings(readings, { status: shaped[0].band })).toHaveLength(1)
    const exp = readingExportRows(readings)
    expect(exp[1].rise_c).toBe('')
    expect(exp[0].status).toBe(shaped[0].band_label)
  })
})
