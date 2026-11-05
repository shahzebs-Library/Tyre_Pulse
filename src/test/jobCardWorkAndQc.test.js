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
