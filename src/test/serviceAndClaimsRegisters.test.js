import { describe, it, expect } from 'vitest'
import {
  serviceEventRow, serviceEventExportRow, SERVICE_EVENT_EXPORT_COLS, SERVICE_EVENT_EXPORT_HEADERS,
} from '../lib/tyreServiceEventsAnalytics'
import {
  distinctFieldValues, engineHoursRow, engineHoursExportRow, anomalyRowIds,
  ENGINE_HOURS_EXPORT_COLS, ENGINE_HOURS_EXPORT_HEADERS,
} from '../lib/engineHoursAnalytics'
import {
  filterInsuranceClaims, insuranceClaimRow, headlineRates, insurerRows, analyzeInsuranceClaims,
} from '../lib/insuranceClaimsAnalytics'
import {
  filterRetreadClaims, retreadClaimRow, honestRecoveryRate, vendorRows, claimDayKey,
} from '../lib/retreadClaimsAnalytics'

const NOW = new Date('2026-09-27T12:00:00Z')

describe('tyre service events register rows', () => {
  it('keeps unmeasured tread/pressure/cost as null, not 0', () => {
    const r = serviceEventRow({ id: 1, event_type: 'repair', event_date: '2026-09-01T10:00:00Z', tread_depth: '', pressure: null, cost: '0' })
    expect(r.treadValue).toBeNull()
    expect(r.pressureValue).toBeNull()
    expect(r.costValue).toBe(0)
    expect(r.day).toBe('2026-09-01')
    expect(r.typeLabel).toBeTruthy()
  })
  it('exports N/A for blanks and matches the header count', () => {
    const x = serviceEventExportRow({ event_type: 'inspection' })
    expect(x.tread_depth).toBe('N/A')
    expect(x.cost).toBe('N/A')
    expect(x.event_date).toBe('N/A')
    expect(SERVICE_EVENT_EXPORT_COLS).toHaveLength(SERVICE_EVENT_EXPORT_HEADERS.length)
    expect(Object.keys(x).sort()).toEqual([...SERVICE_EVENT_EXPORT_COLS].sort())
  })
})

describe('engine hours register rows', () => {
  const rows = [
    { id: 'a', asset_no: 'GEN-2', engine_hours: 100, reading_date: '2026-08-01', site: 'NHC' },
    { id: 'b', asset_no: 'GEN-2', engine_hours: 80, reading_date: '2026-09-01', site: 'NHC' },
    { id: 'c', asset_no: 'GEN-10', engine_hours: '', reading_date: '2026-09-02', site: ' ' },
  ]
  it('lists distinct non-blank values in natural order', () => {
    expect(distinctFieldValues(rows, 'asset_no')).toEqual(['GEN-2', 'GEN-10'])
    expect(distinctFieldValues(rows, 'site')).toEqual(['NHC'])
    expect(distinctFieldValues(null, 'site')).toEqual([])
  })
  it('flags the meter drop and keeps a blank reading null', () => {
    const ids = anomalyRowIds(rows)
    expect(engineHoursRow(rows[1], ids).isAnomaly).toBe(true)
    expect(engineHoursRow(rows[0], ids).isAnomaly).toBe(false)
    expect(engineHoursRow(rows[2], ids).hours).toBeNull()
    const x = engineHoursExportRow(rows[2], ids)
    expect(x.engine_hours).toBe('N/A')
    expect(x.site).toBe('N/A')
    expect(ENGINE_HOURS_EXPORT_COLS).toHaveLength(ENGINE_HOURS_EXPORT_HEADERS.length)
  })
})

describe('insurance claims register helpers', () => {
  const rows = [
    { id: 1, claim_no: 'CLM-1', insurer: 'Tawuniya', status: 'open', incident_date: '2026-07-01', amount_claimed: 1000, amount_settled: null },
    { id: 2, claim_no: 'CLM-2', insurer: 'Walaa', status: 'settled', incident_date: '2026-09-10', amount_claimed: 500, amount_settled: 400 },
    { id: 3, claim_no: 'CLM-3', insurer: 'Walaa', status: 'rejected', amount_claimed: '' },
  ]
  it('filters by status, insurer, search and date, excluding undated rows only when bounded', () => {
    expect(filterInsuranceClaims(rows, { status: 'open' }).map((r) => r.id)).toEqual([1])
    expect(filterInsuranceClaims(rows, { insurer: 'Walaa' }).map((r) => r.id)).toEqual([2, 3])
    expect(filterInsuranceClaims(rows, { search: 'clm-2' }).map((r) => r.id)).toEqual([2])
    expect(filterInsuranceClaims(rows, { from: '2026-09-01' }).map((r) => r.id)).toEqual([2])
    expect(filterInsuranceClaims(rows, {}).length).toBe(3)
    expect(filterInsuranceClaims(null, {})).toEqual([])
  })
  it('derives age, outstanding and delay; an unclaimed amount is N/A not 0', () => {
    const r1 = insuranceClaimRow(rows[0], NOW)
    expect(r1.outstanding).toBe(1000)
    expect(r1.ageDays).toBeGreaterThan(30)
    expect(r1.isDelayed).toBe(true)
    expect(r1.settled).toBeNull()
    const r3 = insuranceClaimRow(rows[2], NOW)
    expect(r3.claimed).toBeNull()
    expect(r3.outstanding).toBeNull()
    expect(r3.ageDays).toBeNull()
  })
  it('reports N/A rates when nothing is measurable', () => {
    const empty = headlineRates(analyzeInsuranceClaims([], { now: NOW }))
    expect(empty.recoveryRate).toBeNull()
    expect(empty.approvalRate).toBeNull()
    const full = headlineRates(analyzeInsuranceClaims(rows, { now: NOW }))
    expect(full.recoveryRate).toBe(27)
    expect(full.approvalRate).toBe(50)
    const ins = insurerRows(analyzeInsuranceClaims([{ insurer: 'X', amount_claimed: 0 }], { now: NOW }))
    expect(ins[0].recoveryPct).toBeNull()
  })
})

describe('retread claims register helpers', () => {
  const rows = [
    { id: 1, claim_no: 'RTC-1', vendor: 'A', status: 'open', claim_date: '2026-08-05', cost: 300, amount_recovered: null },
    { id: 2, claim_no: 'RTC-2', vendor: 'B', status: 'settled', claim_date: '2026-09-05', cost: '', amount_recovered: 50 },
    { id: 3, claim_no: 'RTC-3', vendor: 'B', status: 'rejected', claim_date: null, reason: 'separation' },
  ]
  it('filters by status, vendor, search and date', () => {
    expect(filterRetreadClaims(rows, { vendor: 'B' }).map((r) => r.id)).toEqual([2, 3])
    expect(filterRetreadClaims(rows, { search: 'separation' }).map((r) => r.id)).toEqual([3])
    expect(filterRetreadClaims(rows, { from: '2026-09-01' }).map((r) => r.id)).toEqual([2])
    expect(filterRetreadClaims(rows, { to: '2026-08-31', status: 'open' }).map((r) => r.id)).toEqual([1])
  })
  it('keeps unrecorded money null and derives outstanding only from a recorded cost', () => {
    const r1 = retreadClaimRow(rows[0])
    expect(r1.outstanding).toBe(300)
    expect(r1.recoveredValue).toBeNull()
    const r2 = retreadClaimRow(rows[1])
    expect(r2.costValue).toBeNull()
    expect(r2.outstanding).toBeNull()
    expect(claimDayKey('not a date')).toBe('')
  })
  it('recovery is N/A without a cost', () => {
    expect(honestRecoveryRate(50, 0)).toBeNull()
    expect(honestRecoveryRate(50, 200)).toBe(25)
    expect(vendorRows([{ key: 'B', cost: 0, recovered: 50 }])[0].recoveryPct).toBeNull()
  })
})
