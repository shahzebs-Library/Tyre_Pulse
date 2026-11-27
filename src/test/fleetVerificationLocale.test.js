import { describe, it, expect } from 'vitest'
import en from '../locales/en/fleetVerification.json'
import ar from '../locales/ar/fleetVerification.json'

const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]))

describe('fleetVerification locale parity', () => {
  it('ar has every en key', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort())
  })
  it('every flag the rules can raise has a label', () => {
    for (const f of ['asset_code_mismatch', 'chassis_invalid_chars', 'duplicate_plate', 'duplicate_chassis', 'plate_changed', 'chassis_changed', 'not_found', 'other_country']) {
      expect(en.flags[f]).toBeTruthy()
    }
  })
})
