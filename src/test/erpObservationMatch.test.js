import { describe, it, expect } from 'vitest'
import { evaluateErpCandidate, matchObservationToErp, detectConfirmedErpDrift } from '../lib/erpObservationMatch'

// A 6x4 truck: its rear wheels are numbered the same way in the app and in the ERP. (The asset
// code alone would read as a pump, where no rear ERP code is trusted without a verified mapping.)
const inspection = { id: 'i1', asset_no: 'MP107', country: 'KSA', inspection_date: '2026-11-10', vehicle_type: 'TRUCK 6X4' }
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
  it('does not expose unrelated historic work orders as observation candidates', () => {
    const earlier = { ...workOrder, id: 'historical', opened_at: '2024-12-01', description: 'Front bumper repair' }
    const results = matchObservationToErp({ inspection, finding, workOrders: [earlier],
      fitments: [], expenses: [{ ...expense, work_order_no: earlier.work_order_no }] })
    expect(results).toEqual([])
  })
  it('a pump rear wheel is never matched on an ERP code alone, even an identically spelled one', () => {
    const pump = { ...inspection, vehicle_type: 'PUMPS' }
    const args = { inspection: pump, finding: { rawPosition: 'R1Li' },
      workOrder, fitments: [{ ...fitment, position: 'LHR1-I', serial_no: 'NEW-1' }], expenses: [] }
    const result = evaluateErpCandidate(args)
    expect(result.eligibleToConfirm).toBe(false)
    expect(result.status).toBe('manual_review')
    const verified = evaluateErpCandidate({ ...args, layoutContext: { vehicleType: 'PUMPS',
      positionMappings: [{ layout_key: 'Concrete pump', erp_code: 'LHR1-I', slot: 'R1Li' }] } })
    expect(verified.eligibleToConfirm).toBe(true)
  })
  it('a pump FRONT wheel is matched on its code', () => {
    const pump = { ...inspection, vehicle_type: 'PUMPS' }
    const result = evaluateErpCandidate({ inspection: pump, finding: { rawPosition: 'F2L' },
      workOrder, fitments: [{ ...fitment, position: 'LHF2', serial_no: 'NEW-1' }], expenses: [] })
    expect(result.eligibleToConfirm).toBe(true)
  })
  it('resolves mixer first-rear positions to the centre axle, not pump positions', () => {
    const mixer = { ...inspection, vehicle_type: 'TR-MIXER' }
    const result = evaluateErpCandidate({ inspection: mixer, finding: { rawPosition: 'R1Li' },
      workOrder, fitments: [{ ...fitment, position: 'LHCI', serial_no: 'NEW-2' }], expenses: [] })
    expect(result.eligibleToConfirm).toBe(true)
  })
  it('filters unrelated assets and keeps distinct job cards', () => {
    const matches = matchObservationToErp({ inspection, finding,
      workOrders: [{ ...workOrder, id: 'j2', asset_no: 'MP108' }, workOrder],
      fitments: [fitment], expenses: [expense] })
    expect(matches.map(m => m.workOrder.id)).toEqual(['j1'])
  })
})

describe('wheel position goes through the shared position service', () => {
  const insp = { id: 'i2', asset_no: 'TM400', country: 'KSA', inspection_date: '2026-11-10', vehicle_type: 'TR-MIXER' }
  const wo = { id: 'j9', work_order_no: 'JC-900', asset_no: 'TM400', country: 'KSA', opened_at: '2026-11-12', description: 'Tyre change' }
  const row = (over = {}) => ({ asset_no: 'TM400', country: 'KSA', job_card: 'JC-900', position: 'RHCO', serial_no: 'NEW-555001', issue_date: '2026-11-12', ...over })
  const run = (finding, fitments, extra = {}) => evaluateErpCandidate({
    inspection: insp, finding, workOrder: wo, fitments, expenses: [], layoutContext: { vehicleType: 'TR-MIXER' }, ...extra,
  })

  it('an inspection slot id and an ERP code for the SAME wheel match (the production failure)', () => {
    const r = run({ rawPosition: 'R1Ro' }, [row()])
    expect(r.status).toBe('review')
    expect(r.eligibleToConfirm).toBe(true)
    expect(r.positionState).toBe('offered_for_review')
    expect(r.evidenceSummary.canonicalPosition).toBe('RHCO')
  })
  it('the same slot id on another machine is another wheel: no text substitution', () => {
    const trailer = { ...insp, asset_no: 'TR900', vehicle_type: 'TRAILER' }
    const r = evaluateErpCandidate({
      inspection: trailer, finding: { rawPosition: 'R1Ro' },
      workOrder: { ...wo, asset_no: 'TR900' }, fitments: [row({ asset_no: 'TR900' })],
      layoutContext: { vehicleType: 'TRAILER' },
    })
    expect(r.eligibleToConfirm).toBe(false)
    expect(r.status).toBe('manual_review')
  })
  it('a different wheel is a conflict, not a match', () => {
    const r = run({ rawPosition: 'R1Ro' }, [row({ position: 'RHRO' })])
    expect(r.status).toBe('conflict')
    expect(r.positionState).toBe('different_wheel')
  })
  it.each([
    ['ambiguous ERP code', { rawPosition: 'R1Ro' }, { position: 'RHR1-O' }, {}],
    ['missing ERP position', { rawPosition: 'R1Ro' }, { position: '' }, {}],
    ['missing observed position', { rawPosition: '' }, {}, {}],
    ['slot that is not on this machine', { rawPosition: 'RR' }, { position: 'RHRO' }, {}],
    ['unknown vehicle type', { rawPosition: 'FL' }, { position: 'LHF1' }, { inspection: { ...insp, asset_no: 'ZZ1', vehicle_type: '' }, workOrder: { ...wo, asset_no: 'ZZ1' }, layoutContext: {} }],
    ['tyreless equipment', { rawPosition: 'FL' }, { position: 'LHF1' }, { layoutContext: { vehicleType: 'GENERATOR' }, inspection: { ...insp, vehicle_type: '' } }],
  ])('%s stays pending manual review and cannot be confirmed', (_n, finding, over, extra) => {
    const asset = extra.inspection?.asset_no || 'TM400'
    const r = run(finding, [row({ ...over, asset_no: asset })], extra)
    expect(r.eligibleToConfirm).toBe(false)
    expect(r.status).toBe('manual_review')
    expect(r.positionState).toBe('pending_manual_review')
    expect(r.conflicts).toEqual([])
    expect(r.notes.length).toBeGreaterThan(0)
  })
  it('an inspection recorded on another wheel plan than the asset has is inconsistent', () => {
    const r = run({ rawPosition: 'R1Ro' }, [row()], { inspection: { ...insp, vehicle_type: 'TRAILER' } })
    expect(r.eligibleToConfirm).toBe(false)
    expect(r.positionState).toBe('inconsistent')
    expect(r.status).toBe('conflict')
  })
  it('a matching serial SUPPORTS but never confirms when the wheel cannot be read', () => {
    const r = run({ rawPosition: 'R1Ro', serial: 'OBS-900100' },
      [row({ position: '', serial_no: 'obs-900100', issue_date: '2026-08-01', removal_date: '2026-11-12' })])
    expect(r.eligibleToConfirm).toBe(false)
    expect(r.status).toBe('manual_review')
    expect(r.positionState).toBe('pending_manual_review')
    expect(r.evidenceSummary.serialMatched).toBe(true)
    expect(r.evidenceSummary.serialOnly).toBe(true)
    expect(r.serialExceptionPossible).toBe(true)
    expect(r.notes.join(' ')).toMatch(/serial alone does not allow confirmation/)
  })
  it('a serial exception is never possible for a different wheel, a weak serial or a matched wheel', () => {
    expect(run({ rawPosition: 'R1Ro', serial: 'OBS-900100' }, [row({ position: 'RHRO', serial_no: 'OBS-900100' })]).serialExceptionPossible).toBe(false)
    expect(run({ rawPosition: 'R1Ro', serial: 'DOT18E56' }, [row({ position: '', serial_no: 'DOT18E56', removal_date: '2026-11-12' })]).serialExceptionPossible).toBe(false)
    expect(run({ rawPosition: 'R1Ro', serial: 'OBS-900100' }, [row({ serial_no: 'OBS-900100' })]).serialExceptionPossible).toBe(false)
  })
  it('the ERP dual-rear spelling is pending on every layout until a mapping is verified for it', () => {
    const pending = run({ rawPosition: 'R1Lo' }, [row({ position: 'LHRCO' })])
    expect(pending.status).toBe('manual_review')
    const mapped = run({ rawPosition: 'R1Lo' }, [row({ position: 'LHRCO' })],
      { layoutContext: { vehicleType: 'TR-MIXER', positionMappings: [{ layout_key: 'Tri-mixer', erp_code: 'LHRCO', slot: 'R1Lo' }] } })
    expect(mapped.eligibleToConfirm).toBe(true)
  })
  it('a placeholder serial is not evidence', () => {
    const r = run({ rawPosition: 'R1Ro', serial: 'DOT18E56' },
      [row({ position: '', serial_no: 'DOT18E56', issue_date: '2026-08-01', removal_date: '2026-11-12' })])
    expect(r.eligibleToConfirm).toBe(false)
    expect(r.status).toBe('manual_review')
  })
  it('the observed serial on a different wheel blocks the match', () => {
    const r = run({ rawPosition: 'R1Ro', serial: 'OBS-900100' }, [row({ position: 'RHRO', serial_no: 'OBS-900100' })])
    expect(r.eligibleToConfirm).toBe(false)
    expect(r.positionState).toBe('inconsistent')
  })
  it('a replacement tyre with its own serial does not block a same-wheel match', () => {
    const r = run({ rawPosition: 'R1Ro', serial: 'OBS-900100' }, [row()])
    expect(r.eligibleToConfirm).toBe(true)
    expect(r.conflicts).toEqual([])
  })
  it('the 4 axle pump build decides the wheel: front axle 3 does not exist on it', () => {
    const pump = { ...insp, asset_no: 'MP300', vehicle_type: 'PUMPS' }
    const base = { inspection: pump, finding: { rawPosition: 'F3L' }, workOrder: { ...wo, asset_no: 'MP300' }, fitments: [row({ asset_no: 'MP300', position: 'LHF3' })] }
    expect(evaluateErpCandidate({ ...base, layoutContext: { vehicleType: 'PUMPS' } }).eligibleToConfirm).toBe(true)
    expect(evaluateErpCandidate({ ...base, layoutContext: { vehicleType: 'PUMPS', axleCount: 4 } }).status).toBe('manual_review')
  })
  it('evaluating never writes and never returns a confirmed state', () => {
    const inputs = { inspection: insp, finding: { rawPosition: 'R1Ro' }, workOrder: wo, fitments: [row()], expenses: [], layoutContext: { vehicleType: 'TR-MIXER' } }
    const frozen = JSON.stringify(inputs)
    const r = evaluateErpCandidate(inputs)
    expect(JSON.stringify(inputs)).toBe(frozen)
    expect(['review', 'manual_review', 'insufficient', 'conflict']).toContain(r.status)
    expect(JSON.stringify(r)).not.toMatch(/"confirmed"|"closed"/i)
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
