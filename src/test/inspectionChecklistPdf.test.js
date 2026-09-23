import { describe, expect, it } from 'vitest'
import { checklistPdfModel } from '../lib/inspectionChecklistPdf'
import { inspectionDiagramModel } from '../lib/inspectionView'
import { layoutSlotsFor, resolveLayoutKey } from '../lib/vehicleTyreLayout'

describe('checklist PDF matches recorded inspection', () => {
  const row = {
    vehicle_type: 'Tri-mixer', asset_no: 'TM514', scheduled_date: '2026-09-08',
    tyre_conditions: [{ position: 'R1Lo', label: 'LHCO', pressure: '110', condition: 'Puncture', treadDepth: '' }],
  }

  it('uses the same mixer centre code as the diagram without rewriting the record', () => {
    const before = JSON.stringify(row)
    const pdf = checklistPdfModel(row)
    const diagram = inspectionDiagramModel(row)
    expect(pdf.rows[0].position).toBe('LHCO')
    expect(pdf.rows[0].position).toBe(diagram.readings[0].code)
    expect(diagram.tyreData.R1Lo.risk).toBe('critical')
    expect(diagram.subLabels.R1Lo).toContain('110 PSI')
    expect(JSON.stringify(row)).toBe(before)
  })

  it('does not request tread when the form did not record it', () => {
    expect(checklistPdfModel(row).includeTread).toBe(false)
  })

  it('preserves historical mobile readings and maps their canonical keys to the same wheel', () => {
    const mobile = { ...row, tyre_conditions: { LHCO: { pressure_psi: 108, tread_depth_mm: 8, condition: 'Damaged' } } }
    const pdf = checklistPdfModel(mobile)
    expect(pdf.includeTread).toBe(true)
    expect(pdf.rows).toEqual([{ position: 'LHCO', pressure: 108, treadDepth: 8, condition: 'Damaged' }])
    expect(inspectionDiagramModel(mobile).subLabels.R1Lo).toContain('108 PSI')
  })

  it('derives labels for legacy entries without a saved display label', () => {
    const pdf = checklistPdfModel({ ...row, tyre_conditions: { R1Lo: { pressure: 110 } } })
    expect(pdf.rows[0].position).toBe('LHCO')
  })

  it('reads saved JSON findings when tyre_conditions is absent', () => {
    const pdf = checklistPdfModel({ ...row, tyre_conditions: null, findings: JSON.stringify(row.tyre_conditions) })
    expect(pdf.rows[0].position).toBe('LHCO')
    expect(checklistPdfModel({ ...row, tyre_conditions: null, findings: 'A note' }).rows).toEqual([])
  })

  it('dates the signature using the recorded inspection, never the download day', () => {
    expect(checklistPdfModel(row).inspectionDate).toBe('2026-09-08')
    expect(checklistPdfModel({ ...row, inspection_date: '2026-09-07', completed_date: '2026-09-09' }).inspectionDate).toBe('2026-09-07')
    expect(checklistPdfModel({ tyre_conditions: [] }).inspectionDate).toBeNull()
  })

  it('keeps the checklist and saved PDF on the asset-resolved mixer layout for generic fleet types', () => {
    const vehicleType = resolveLayoutKey('Vehicle', 'TM514')
    const positions = layoutSlotsFor('Vehicle', 'TM514')
    const saved = { ...row, vehicle_type: vehicleType, tyre_conditions: positions.map(position => ({ position, pressure: 110, condition: 'Good' })) }
    expect(positions).toHaveLength(12)
    const diagram = inspectionDiagramModel(saved)
    expect(diagram.slots).toEqual(positions)
    expect(checklistPdfModel(saved).rows.map(r => r.position)).toEqual(diagram.readings.map(r => r.code))
  })
})
