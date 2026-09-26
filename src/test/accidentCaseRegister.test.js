import { describe, it, expect } from 'vitest'
import {
  caseRegisterRows, caseRegisterOptions, filterCaseRegister, caseRegisterSummary,
  openAgeBands, caseRegisterExportRows, CASE_REGISTER_COLS,
} from '../lib/accidentCaseAnalytics'

const NOW = new Date('2026-09-26T00:00:00Z')
const cases = [
  { id: '1', case_no: 'ACC-1', asset_no: 'TM1', site: 'NHC', case_status: 'reported', created_at: '2026-09-20T00:00:00Z', sla_due_at: '2026-09-22T00:00:00Z', severity: 'minor' },
  { id: '2', reference_no: 'ACC-2', asset_no: 'TM2', site: 'JED', case_status: 'closed', created_at: '2026-09-01T00:00:00Z', release_date: '2026-09-11T00:00:00Z', reopened_flag: true },
  { id: '3', case_no: 'ACC-3', site: 'NHC', case_status: '', created_at: null, incident_date: '', sla_due_at: '2026-10-01T00:00:00Z' },
  { id: '4', case_no: 'ACC-4', site: 'NHC', created_at: '2026-05-01T00:00:00Z' },
]

describe('caseRegisterRows', () => {
  const rows = caseRegisterRows(cases, { now: NOW })
  it('measures age for open and closed cases', () => {
    expect(rows[0]).toMatchObject({ ref: 'ACC-1', state: 'open', ageDays: 6, sla: 'overdue' })
    expect(rows[1]).toMatchObject({ ref: 'ACC-2', state: 'closed', ageDays: 10, reopened: true, closureLabel: 'Fully closed', team: null })
  })
  it('keeps an unmeasurable age null and a missing SLA as none', () => {
    expect(rows[2]).toMatchObject({ ageDays: null, sla: 'on_track', statusLabel: 'Not recorded', team: 'Unassigned' })
    expect(rows[3].sla).toBe('none')
  })
  it('filters, summarises and bands', () => {
    expect(filterCaseRegister(rows, { state: 'open' })).toHaveLength(3)
    expect(filterCaseRegister(rows, { search: 'tm2' })).toHaveLength(1)
    expect(filterCaseRegister(rows, { site: 'NHC', sla: 'overdue' })).toHaveLength(1)
    const sum = caseRegisterSummary(rows)
    expect(sum).toMatchObject({ shown: 4, open: 3, overdue: 1, noSla: 1, reopened: 1, ageUnknown: 1 })
    expect(sum.avgOpenAge).toBe(77)
    expect(caseRegisterSummary([]).avgOpenAge).toBeNull()
    const bands = openAgeBands(rows)
    expect(bands.rows.map((b) => b.value)).toEqual([1, 0, 0, 1])
    expect(bands.unknown).toBe(1)
    expect(caseRegisterOptions(rows).sites).toEqual(['JED', 'NHC'])
  })
  it('exports N/A for unmeasured cells', () => {
    const out = caseRegisterExportRows(rows)
    expect(Object.keys(out[0])).toEqual([...CASE_REGISTER_COLS])
    expect(out[2].ageDays).toBe('N/A')
    expect(out[1].reopenedLabel).toBe('Yes')
  })
})
