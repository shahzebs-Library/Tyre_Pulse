import { describe, it, expect } from 'vitest'
import { evaluateErpCandidate, matchObservationToErp, detectConfirmedErpDrift } from '../lib/erpObservationMatch'

const inspection = { id: 'i1', asset_no: 'MP107', country: 'KSA', inspection_date: '2026-11-10' }
const finding = { rawPosition: 'LHR1-O', serial: 'OLD-123' }
const workOrder = { id: 'j1', work_order_no: 'JC-101', asset_no: 'MP107', country: 'KSA', opened_at: '2026-11-11', description: 'Tyre replacement' }
const fitment = { asset_no: 'MP107', country: 'KSA', job_card: 'JC-101', position: 'LHR1-O', serial_no: 'OLD-123', removal_date: '2026-11-11' }
const expense = { asset_code: 'MP107', country: 'KSA', work_order_no: 'JC-101', item_description: 'Tyre', value_amount: 1000 }

describe('ERP to inspection evidence matcher', () => {
  const evaluate = (overrides = {}) => evaluateErpCandidate({
    inspection, finding, workOrder, fitments: [fitment], expenses: [expense], ...overrides,
  })
  it('suggests only same-asset and same-country job cards with tyre evidence', () => {
    const result = evaluate()
    expect(result.status).toBe('review')
    expect(result.eligibleToConfirm).toBe(true)
    expect(result.evidenceSummary).toMatchObject({ tyreRows: 1, expenseRows: 1, positionMatched: true, serialMatched: true })
  })
  it('never accepts evidence for another country even with matching asset and job card', () => {
    expect(evaluate({ workOrder: { ...workOrder, country: 'UAE' } }).eligibleToConfirm).toBe(false)
  })
  it('does not treat expense alone as proof of repair', () => {
    expect(evaluate({ fitments: [] }).eligibleToConfirm).toBe(false)
  })
  it('rejects a mismatching position and serial', () => {
    const result = evaluate({ fitments: [{ ...fitment, position: 'RHR2-I', serial_no: 'OTHER' }] })
    expect(result.status).toBe('conflict')
    expect(result.eligibleToConfirm).toBe(false)
  })
  it('does not match work that predates the inspection', () => {
    expect(evaluate({ workOrder: { ...workOrder, opened_at: '2026-11-09' } }).status).toBe('conflict')
  })
  it('requires a dated tyre movement after the observation', () => {
    expect(evaluate({ fitments: [{ ...fitment, removal_date: '2026-11-09' }] }).eligibleToConfirm).toBe(false)
    expect(evaluate({ fitments: [{ ...fitment, removal_date: null, issue_date: null }] }).eligibleToConfirm).toBe(false)
  })
  it('does not infer cost from tyre fitment or work order', () => {
    expect(evaluate({ expenses: [] }).evidenceSummary.expenseRows).toBe(0)
  })
  it('leaves ambiguous job dates unconfirmed', () => {
    expect(evaluate({ workOrder: { ...workOrder, opened_at: null, completed_at: null } }).eligibleToConfirm).toBe(false)
  })
  it('filters unrelated assets and keeps distinct job cards', () => {
    const matches = matchObservationToErp({ inspection, finding,
      workOrders: [{ ...workOrder, id: 'j2', asset_no: 'MP108' }, workOrder],
      fitments: [fitment], expenses: [expense] })
    expect(matches.map(m => m.workOrder.id)).toEqual(['j1'])
  })
})

describe('ERP evidence audit drift', () => {
  it('retains a clean review for an unchanged job card', () => {
    expect(detectConfirmedErpDrift(workOrder, { ...workOrder })).toEqual([])
  })
  it('flags ERP status or work description changes after confirmation', () => {
    expect(detectConfirmedErpDrift(workOrder, { ...workOrder, status: 'Completed', description: 'Different job' }))
      .toEqual(['status', 'description'])
  })
  it('requires re-verification if the originally confirmed job card disappears', () => {
    expect(detectConfirmedErpDrift(workOrder, null)).toContain('Confirmed ERP job card is unavailable')
  })
})
