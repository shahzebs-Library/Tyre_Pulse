import { describe, it, expect } from 'vitest'
import { generalDefectFor, actionRowsForInspection, applyPlanToRow } from '../lib/inspectionTyreFlags'
import { previousMeterReadings, recentFindings } from '../lib/inspectionWorkspaceView'
import { safeFilePart, extensionFor, photoBaseName, uniqueNames } from '../lib/photoDownload'

describe('generalDefectFor', () => {
  it('builds a whole-inspection item from the remarks, priority from severity', () => {
    const d = generalDefectFor({ id: 'i1', asset_no: 'TM514', title: 'Site walk', severity: 'High', findings: 'Oil leak near LHF1' })
    expect(d.key).toBe('general')
    expect(d.priority).toBe('High')
    expect(d.title).toBe('Site walk on TM514')
    expect(d.description).toContain('Oil leak near LHF1')
  })

  it('never invents High: blank severity is Medium', () => {
    expect(generalDefectFor({ asset_no: 'X' }).priority).toBe('Medium')
    expect(generalDefectFor(null)).toBe(null)
  })

  it('produces a valid action row linked to the inspection, with the raiser plan applied', () => {
    const insp = { id: 'i1', asset_no: 'TM514', site: 'NHC', country: 'KSA', findings: 'Cracked rim', odometer_km: 1200 }
    const [row] = actionRowsForInspection(insp, [generalDefectFor(insp)])
    expect(row).toMatchObject({ source_type: 'inspection', source_id: 'i1', source_detail: 'general', asset_no: 'TM514', status: 'Open' })
    expect(row.description).toContain('Odometer: 1,200 km')
    const planned = applyPlanToRow(row, { comment: 'Check spare first', assignee: { name: 'Ali' }, due_date: '2026-11-10' })
    expect(planned.assigned_to).toBe('Ali')
    expect(planned.due_date).toBe('2026-11-10')
    expect(planned.description).toContain('Check spare first')
  })
})

describe('previousMeterReadings', () => {
  const rows = [
    { id: 'a', asset_no: 'TM514', inspection_date: '2026-11-01', odometer_km: 5000, hour_meter: 300 },
    { id: 'b', asset_no: 'tm514 ', inspection_date: '2026-10-01', odometer_km: 4000, hour_meter: null },
    { id: 'c', asset_no: 'TM514', inspection_date: '2026-12-01', odometer_km: 9000, hour_meter: 900 },
    { id: 'd', asset_no: 'MP001', inspection_date: '2026-11-02', odometer_km: 1 },
  ]
  it('takes the newest earlier reading of the same vehicle, never a later one or another vehicle', () => {
    expect(previousMeterReadings(rows, { id: 'x', asset_no: 'TM514', inspection_date: '2026-11-05' })).toEqual({ km: 5000, hours: 300 })
  })
  it('ignores the record being edited', () => {
    expect(previousMeterReadings(rows, { id: 'a', asset_no: 'TM514', inspection_date: '2026-11-01' })).toEqual({ km: 4000, hours: null })
  })
  it('returns null when there is nothing to compare', () => {
    expect(previousMeterReadings(rows, { id: 'x', asset_no: 'ZZ9' })).toBe(null)
    expect(previousMeterReadings(rows, { id: 'x' })).toBe(null)
  })
})

describe('recentFindings carries the stored position key', () => {
  it('so a finding can find its own photo', () => {
    const row = { id: 'i1', asset_no: 'TM1', inspection_date: '2026-11-01', vehicle_type: 'TR-MIXER', tyre_conditions: { LHF1: { condition: 'Damaged', notes: 'Cut on sidewall' } } }
    const [f] = recentFindings([row])
    expect(f.positionKey).toBeTruthy()
    expect(f.inspectionId).toBe('i1')
  })
})

describe('photo download names', () => {
  it('strips characters a file system refuses', () => {
    expect(safeFilePart('TM/514: "LHF1"')).toBe('TM 514 LHF1')
  })
  it('picks the extension from the type, then the URL', () => {
    expect(extensionFor('image/png', 'x.jpg')).toBe('png')
    expect(extensionFor('', 'https://x/a/b.webp?token=1')).toBe('webp')
    expect(extensionFor('', 'https://x/a')).toBe('jpg')
  })
  it('names a photo by asset, what it shows and the day', () => {
    expect(photoBaseName({ asset_no: 'TM514', inspection_date: '2026-11-08' }, { label: 'LHF1' })).toBe('TM514 LHF1 2026-11-08')
  })
  it('keeps names unique inside a zip', () => {
    expect(uniqueNames(['a.jpg', 'a.jpg', 'b.jpg', 'A.jpg'])).toEqual(['a.jpg', 'a (2).jpg', 'b.jpg', 'A (3).jpg'])
  })
})
