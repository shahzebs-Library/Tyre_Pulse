import { describe, it, expect } from 'vitest'
import { jobCardWorkAndQc } from '../lib/assetHistory'

describe('jobCardWorkAndQc', () => {
  it('reads the card\'s own QC Remarks and Job Done Description', () => {
    const r = { work_order_no: 'GCKR/JC/3614/1026', custom_data: { 'QC Remarks': 'WORN OUT', 'Job Done Description': 'CHANGED PTO SHAFT' } }
    expect(jobCardWorkAndQc(r, new Map())).toEqual({ workDone: 'CHANGED PTO SHAFT', qcRemarks: 'WORN OUT' })
  })
  it('falls back to the actions on the same card\'s task lines, deduplicated', () => {
    const r = { work_order_no: 'GCKR/JC/1324/0526', custom_data: {} }
    const lines = new Map([['GCKR/JC/1324/0526', [{ action: 'REPLACED TYRE' }, { action: 'replaced tyre' }, { action: 'AIR PIPE REPAIRED' }]]])
    expect(jobCardWorkAndQc(r, lines)).toEqual({ workDone: 'REPLACED TYRE; AIR PIPE REPAIRED', qcRemarks: null })
  })
  it('uses lines kept inside custom_data, and never invents a value', () => {
    expect(jobCardWorkAndQc({ work_order_no: 'X', custom_data: { line_items: [{ action: 'AIR PIPE REPAIRED' }] } }, new Map()).workDone).toBe('AIR PIPE REPAIRED')
    expect(jobCardWorkAndQc({ work_order_no: 'Y' }, new Map())).toEqual({ workDone: null, qcRemarks: null })
  })
})

import { tableFilterEvents, tableFilterOptions } from '../lib/vehicleHistoryView'

describe('tableFilterEvents', () => {
  const rows = [
    { id: 1, source: 'job_card', type: 'repair', typeLabel: 'Repair', day: '2026-07-01', title: 'Job card GCKR/JC/1', site: 'NHC', workDone: 'CHANGED PTO SHAFT', qcRemarks: 'WORN OUT', value: 500, currency: 'SAR' },
    { id: 2, source: 'job_card', type: 'repair', typeLabel: 'Repair', day: '2026-06-01', title: 'Job card GCKR/JC/2', site: 'JED', workDone: null, qcRemarks: null },
    { id: 3, source: 'wash', type: 'wash', typeLabel: 'Wash', day: '2026-05-01', title: 'Wash', site: 'NHC' },
  ]
  it('searches every column including work done and QC', () => {
    expect(tableFilterEvents(rows, { q: 'pto' }).map(r => r.id)).toEqual([1])
    expect(tableFilterEvents(rows, { q: 'worn out' }).map(r => r.id)).toEqual([1])
    expect(tableFilterEvents(rows, { q: '2026-06' }).map(r => r.id)).toEqual([2])
    expect(tableFilterEvents(rows, { q: 'sar' }).map(r => r.id)).toEqual([1])
  })
  it('filters by type, site and recorded / not recorded', () => {
    expect(tableFilterEvents(rows, { type: 'wash' }).map(r => r.id)).toEqual([3])
    expect(tableFilterEvents(rows, { site: 'NHC' }).map(r => r.id)).toEqual([1, 3])
    expect(tableFilterEvents(rows, { qc: 'has' }).map(r => r.id)).toEqual([1])
    expect(tableFilterEvents(rows, { work: 'none' }).map(r => r.id)).toEqual([2])
  })
  it('lists options from the rows', () => {
    expect(tableFilterOptions(rows)).toEqual({ types: [{ value: 'repair', label: 'Repair' }, { value: 'wash', label: 'Wash' }], sites: ['JED', 'NHC'] })
  })
})
