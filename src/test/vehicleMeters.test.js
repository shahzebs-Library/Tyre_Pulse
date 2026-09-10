import { describe, it, expect } from 'vitest'
import { buildVehicleMeters, meterToday, meterSource, validateMeterDraft } from '../lib/vehicleMeters'

const vehicle = { id: 'v1', organisation_id: 'org', country: 'KSA', asset_no: 'TM651', vehicle_type: 'TR-MIXER', current_km: 111316 }
describe('vehicle meter identity and entry', () => {
  it('keeps same asset numbers in different countries and organisations separate', () => {
    const fleet = [vehicle, { ...vehicle, id: 'v2', country: 'UAE' }]
    const logs = [
      { ...vehicle, id: 'h1', engine_hours: 500, reading_date: '2026-09-09', created_at: '2026-09-09T08:00:00Z' },
      { ...vehicle, id: 'h2', country: 'UAE', engine_hours: 900, reading_date: '2026-09-10' },
      { ...vehicle, id: 'h3', organisation_id: 'other', engine_hours: 9999, reading_date: '2026-09-11' },
      { ...vehicle, id: 'h4', country: null, engine_hours: 9998, reading_date: '2026-09-11' },
    ]
    expect(buildVehicleMeters(fleet, [], logs).map(v => v.engineHours)).toEqual([500, 900])
  })
  it('supports both meters on mixers and hours on stationary equipment without fabricated zeroes', () => {
    const rows = buildVehicleMeters([vehicle, { ...vehicle, id: 'gen', asset_no: 'GEN1', vehicle_type: 'GENERATOR', current_km: null }], [], [])
    expect(rows[0]).toMatchObject({ supportsKm: true, supportsHours: true, engineHours: null })
    expect(rows[1]).toMatchObject({ supportsKm: false, supportsHours: true, km: null })
  })
  it('requires explicit meter choice for unknown assets and disables duplicate identities', () => {
    const unknown = { ...vehicle, vehicle_type: null, current_km: null }
    expect(buildVehicleMeters([unknown], [], [])[0]).toMatchObject({ supportsKm: false, supportsHours: false })
    expect(buildVehicleMeters([vehicle, { ...vehicle, id: 'duplicate' }], [], []).every(v => v.duplicate)).toBe(true)
  })
  it('uses the measurement date and then received timestamp for the latest hours', () => {
    const hours = [
      { ...vehicle, id: 'h1', reading_date: '2026-09-09', created_at: '2026-09-11T08:00:00Z', engine_hours: 300 },
      { ...vehicle, id: 'h2', reading_date: '2026-09-10', created_at: '2026-09-10T08:00:00Z', engine_hours: 400 },
      { ...vehicle, id: 'h3', reading_date: '2026-09-10', created_at: '2026-09-10T09:00:00Z', engine_hours: 450 },
    ]
    expect(buildVehicleMeters([vehicle], [], hours)[0].engineHours).toBe(450)
  })
  it('defaults to the country calendar day rather than the UTC date', () => {
    expect(meterToday('KSA', new Date('2026-09-09T22:00:00Z'))).toBe('2026-09-10')
  })
  it('rejects empty, negative, invalid, and future readings but accepts a real zero', () => {
    const base = { km: '', hours: '', date: meterToday('KSA') }
    expect(validateMeterDraft(base, vehicle)).not.toBe('')
    expect(validateMeterDraft({ ...base, hours: '-1' }, vehicle)).not.toBe('')
    expect(validateMeterDraft({ ...base, hours: 'Infinity' }, vehicle)).not.toBe('')
    expect(validateMeterDraft({ ...base, km: '10', date: '2999-01-01' }, vehicle)).not.toBe('')
    expect(validateMeterDraft({ ...base, hours: '0' }, vehicle)).toBe('')
  })
  it('never attributes an unknown source to Mobile or Telematics', () => {
    expect(meterSource(null)).toBe('Unknown')
    expect(meterSource('Mobile')).toBe('Mobile')
    expect(meterSource('Web Manual')).toBe('Web Manual')
    expect(meterSource('ksa_kms_upload')).toBe('Import')
  })
})
