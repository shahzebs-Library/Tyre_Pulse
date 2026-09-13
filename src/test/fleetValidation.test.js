import { describe, it, expect } from 'vitest'
import { buildValidationChecklist, validationSummary, VALIDATION_ITEMS } from '../lib/fleetValidation'

describe('buildValidationChecklist', () => {
  it('fails every item when the incident carries nothing at all', () => {
    const items = buildValidationChecklist({})
    expect(items).toHaveLength(VALIDATION_ITEMS.length)
    // vehicle_type_matches passes vacuously with no asset and no reported type -
    // there is nothing to contradict, so it is NOT a fabricated failure.
    expect(items.filter((i) => !i.passed).map((i) => i.key)).toEqual([
      'asset_registered', 'driver_recorded', 'site_recorded', 'incident_date_recorded',
      'location_captured', 'photos_attached', 'authority_report_on_file',
    ])
  })

  it('passes asset_registered only with a real fleet match, never guessed', () => {
    expect(buildValidationChecklist({ asset: null }).find((i) => i.key === 'asset_registered').passed).toBe(false)
    expect(buildValidationChecklist({ asset: { asset_no: 'TM514' } }).find((i) => i.key === 'asset_registered').passed).toBe(true)
  })

  it('requires BOTH latitude and longitude for a passed GPS check', () => {
    expect(buildValidationChecklist({ acc: { latitude: 24.7 } }).find((i) => i.key === 'location_captured').passed).toBe(false)
    expect(buildValidationChecklist({ acc: { latitude: 24.7, longitude: 46.6 } }).find((i) => i.key === 'location_captured').passed).toBe(true)
  })

  it('only counts an authority report as on-file when report_status is available, not merely present', () => {
    expect(buildValidationChecklist({ authorityReports: [{ authority_type: 'police', report_status: 'pending' }] })
      .find((i) => i.key === 'authority_report_on_file').passed).toBe(false)
    expect(buildValidationChecklist({ authorityReports: [{ authority_type: 'police', report_status: 'available' }] })
      .find((i) => i.key === 'authority_report_on_file').passed).toBe(true)
  })

  it('vehicle_type_matches is a real, case-insensitive comparison against the fleet register', () => {
    const asset = { asset_no: 'TM514', vehicle_type: 'TR-MIXER' }
    expect(buildValidationChecklist({ acc: { vehicle_type: 'tr-mixer' }, asset }).find((i) => i.key === 'vehicle_type_matches').passed).toBe(true)
    expect(buildValidationChecklist({ acc: { vehicle_type: 'Pickup' }, asset }).find((i) => i.key === 'vehicle_type_matches').passed).toBe(false)
  })
})

describe('validationSummary', () => {
  it('reports honest counts and never divides by zero', () => {
    expect(validationSummary([])).toEqual({ total: 0, passed: 0, missing: 0, complete: false })
    const s = validationSummary([{ passed: true }, { passed: false }, { passed: true }])
    expect(s).toEqual({ total: 3, passed: 2, missing: 1, complete: false })
  })

  it('is complete only when every item passed', () => {
    expect(validationSummary([{ passed: true }, { passed: true }]).complete).toBe(true)
  })
})
