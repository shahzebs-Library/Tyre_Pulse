import { describe, expect, it } from 'vitest'
import { groupObservationsByInspection } from '../lib/inspectionWorkspaceView'
import { observationReportId, observationRevision } from '../lib/observationReportPdf'

describe('observation register grouped by inspection', () => {
  const rows = [
    { key: 'a:front', inspectionId: 'a', day: '2026-11-12', asset_no: 'MP107', position: 'LHR1-O' },
    { key: 'a:rear', inspectionId: 'a', day: '2026-11-12', asset_no: 'MP107', position: 'RHR1-I' },
    { key: 'b:front', inspectionId: 'b', day: '2026-11-12', asset_no: 'MP108', position: 'LHF1' },
  ]
  it('shows one row for two damaged tyres in the same inspection', () => {
    const grouped = groupObservationsByInspection(rows)
    expect(grouped).toHaveLength(2)
    expect(grouped[0].findings.map((f) => f.position)).toEqual(['LHR1-O', 'RHR1-I'])
    expect(grouped[1].findings).toHaveLength(1)
  })
  it('does not accidentally merge separate inspection events on the same date', () => {
    expect(groupObservationsByInspection([
      { ...rows[0], inspectionId: 'a' },
      { ...rows[1], inspectionId: 'another-inspection', asset_no: 'MP107' },
    ])).toHaveLength(2)
  })
  it('does not mutate source findings', () => {
    const grouped = groupObservationsByInspection(rows)
    expect(rows[0].findings).toBeUndefined()
    expect(grouped[0]).not.toBe(rows[0])
  })
})
describe('observation audit reference', () => {
  it('links the export to its exact saved inspection ID', () => {
    expect(observationReportId({ id: '0ca4-a7b9' })).toBe('OBS-0CA4-A7B9')
  })
  it('records the latest available source revision timestamp', () => {
    expect(observationRevision({ created_at: '2026-11-11T12:00:00Z', updated_at: '2026-11-12T15:00:00Z' }))
      .toBe('2026-11-12T15:00:00Z')
  })
})
