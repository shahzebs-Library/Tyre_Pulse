import { describe, it, expect } from 'vitest'
import {
  emptyCountryAddress, fromOrgBranding, isBlankAddress, indexByCountry,
  buildCountryAddressList, resolveAddress, formatAddressLine,
  COUNTRY_ADDRESS_FIELDS,
} from '../lib/api/countryAddresses'

const branding = {
  legal_name: 'Global Fleet Co', address: 'HQ Tower, Dubai',
  contact_email: 'hq@fleet.com', contact_phone: '+971 1', website: 'fleet.com',
}

describe('emptyCountryAddress', () => {
  it('has the country plus every editable field blank', () => {
    const a = emptyCountryAddress('KSA')
    expect(a.country).toBe('KSA')
    for (const f of COUNTRY_ADDRESS_FIELDS) expect(a[f]).toBe('')
  })
})

describe('fromOrgBranding', () => {
  it('maps org branding onto the country-address shape', () => {
    const a = fromOrgBranding('UAE', branding)
    expect(a).toMatchObject({
      country: 'UAE', legal_name: 'Global Fleet Co', address_line: 'HQ Tower, Dubai',
      contact_email: 'hq@fleet.com', contact_phone: '+971 1', website: 'fleet.com',
    })
    expect(a.city).toBe('') // unmapped fields stay blank
  })
  it('tolerates null branding', () => {
    expect(fromOrgBranding('KSA', null).legal_name).toBe('')
  })
})

describe('isBlankAddress', () => {
  it('true for empty / whitespace-only, false once any field has content', () => {
    expect(isBlankAddress(null)).toBe(true)
    expect(isBlankAddress(emptyCountryAddress('KSA'))).toBe(true)
    expect(isBlankAddress({ ...emptyCountryAddress('KSA'), city: '  ' })).toBe(true)
    expect(isBlankAddress({ ...emptyCountryAddress('KSA'), city: 'Riyadh' })).toBe(false)
  })
})

describe('indexByCountry', () => {
  it('indexes case/space-insensitively', () => {
    const m = indexByCountry([{ country: ' ksa ', city: 'Riyadh' }])
    expect(m.get('ksa').city).toBe('Riyadh')
  })
})

describe('buildCountryAddressList', () => {
  it('lists every configured country, prefilling from org when unsaved', () => {
    const list = buildCountryAddressList(['KSA', 'UAE'], [], branding)
    expect(list.map((r) => r.country)).toEqual(['KSA', 'UAE'])
    expect(list.every((r) => r.prefilled && !r.saved)).toBe(true)
    expect(list[0].address_line).toBe('HQ Tower, Dubai') // org fallback
  })

  it('marks a country with a saved non-blank row as saved (not prefilled)', () => {
    const rows = [{ country: 'KSA', city: 'Riyadh', address_line: 'King Fahd Rd' }]
    const list = buildCountryAddressList(['KSA', 'UAE'], rows, branding)
    const ksa = list.find((r) => r.country === 'KSA')
    expect(ksa.saved).toBe(true)
    expect(ksa.prefilled).toBe(false)
    expect(ksa.city).toBe('Riyadh')
    expect(ksa.address_line).toBe('King Fahd Rd') // NOT overwritten by org
  })

  it('appends stored countries that are not in the configured list', () => {
    const rows = [{ country: 'Egypt', city: 'Cairo' }]
    const list = buildCountryAddressList(['KSA'], rows, branding)
    expect(list.map((r) => r.country)).toEqual(['KSA', 'Egypt'])
  })

  it('de-duplicates the configured list case-insensitively', () => {
    const list = buildCountryAddressList(['KSA', 'ksa'], [], branding)
    expect(list).toHaveLength(1)
  })
})

describe('resolveAddress', () => {
  it('returns the saved country row when it has content (source=country)', () => {
    const rows = [{ country: 'KSA', city: 'Riyadh' }]
    const r = resolveAddress('KSA', rows, branding)
    expect(r.source).toBe('country')
    expect(r.city).toBe('Riyadh')
  })
  it('falls back to the org address when no saved row (source=org)', () => {
    const r = resolveAddress('Qatar', [], branding)
    expect(r.source).toBe('org')
    expect(r.address_line).toBe('HQ Tower, Dubai')
  })
  it('falls back to org when the saved row is blank', () => {
    const r = resolveAddress('KSA', [{ country: 'KSA' }], branding)
    expect(r.source).toBe('org')
  })
})

describe('formatAddressLine', () => {
  it('joins present parts and skips blanks', () => {
    expect(formatAddressLine({ address_line: 'King Fahd Rd', city: 'Riyadh', region: '', postal_code: '11564', country: 'KSA' }))
      .toBe('King Fahd Rd, Riyadh, 11564, KSA')
    expect(formatAddressLine(null)).toBe('')
  })
})
