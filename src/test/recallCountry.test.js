import { describe, it, expect, vi } from 'vitest'
import { normaliseRecallCountry, recallCountryChoices, resolveRecallCountry, recallWritableCountries, recallHasNoWritableCountry } from '../lib/recallCountry'

describe('normaliseRecallCountry', () => {
  it('keeps one clean country name', () => {
    expect(normaliseRecallCountry(' KSA ')).toBe('KSA')
  })
  it('never returns an array: several countries give null, exactly one gives that one', () => {
    expect(normaliseRecallCountry(['KSA', 'UAE', 'Egypt'])).toBeNull()
    expect(normaliseRecallCountry(['UAE'])).toBe('UAE')
    expect(normaliseRecallCountry([])).toBeNull()
  })
  it('rejects the All view, blanks and a stored JSON array string', () => {
    expect(normaliseRecallCountry('All')).toBeNull()
    expect(normaliseRecallCountry('')).toBeNull()
    expect(normaliseRecallCountry(null)).toBeNull()
    expect(normaliseRecallCountry('["KSA","UAE"]')).toBeNull()
  })
})

describe('recallCountryChoices', () => {
  it('uses the allowed context when present, else the full list, without repeats', () => {
    expect(recallCountryChoices([{ country: 'KSA' }, { country: 'KSA' }], ['KSA', 'UAE', 'Egypt'])).toEqual(['KSA'])
    expect(recallCountryChoices([], ['KSA', 'UAE', 'Egypt'])).toEqual(['KSA', 'UAE', 'Egypt'])
    expect(recallCountryChoices(undefined, ['KSA'])).toEqual(['KSA'])
  })
})

describe('resolveRecallCountry', () => {
  const choices = ['KSA', 'UAE', 'Egypt']
  it('takes the form value first', () => {
    expect(resolveRecallCountry({ formCountry: 'UAE', activeCountry: 'KSA', choices })).toEqual({ country: 'UAE', needsChoice: false })
  })
  it('falls back to the active country', () => {
    expect(resolveRecallCountry({ formCountry: '', activeCountry: 'egypt', choices })).toEqual({ country: 'Egypt', needsChoice: false })
  })
  it('on the All view with several countries the user must choose', () => {
    expect(resolveRecallCountry({ formCountry: '', activeCountry: 'All', choices })).toEqual({ country: null, needsChoice: true })
  })
  it('a user with exactly one country never has to choose', () => {
    expect(resolveRecallCountry({ activeCountry: 'All', choices: ['KSA'] })).toEqual({ country: 'KSA', needsChoice: false })
  })
  it('the profile country ARRAY (the old defect) is never accepted as a value', () => {
    expect(resolveRecallCountry({ formCountry: ['KSA', 'UAE', 'Egypt'], activeCountry: 'All', choices })).toEqual({ country: null, needsChoice: true })
  })
  it('a country outside the user scope is not accepted, and is never silently swapped for another', () => {
    // Editing a recall filed under Egypt as a KSA-only user must NOT quietly move it to KSA.
    expect(resolveRecallCountry({ formCountry: 'Egypt', choices: ['KSA'] })).toEqual({ country: null, needsChoice: true, outOfScope: 'Egypt' })
    expect(resolveRecallCountry({ formCountry: 'Egypt', choices: ['KSA', 'UAE'] })).toMatchObject({ needsChoice: true, outOfScope: 'Egypt' })
    // An empty form still falls back to the only country.
    expect(resolveRecallCountry({ formCountry: '', choices: ['KSA'] })).toEqual({ country: 'KSA', needsChoice: false })
  })
})

describe('recalls service never writes a country array', () => {
  it('createRecall and updateRecall send one country or null', async () => {
    const sent = []
    vi.resetModules()
    vi.doMock('../lib/supabase', () => {
      const b = {
        select: () => b, single: () => Promise.resolve({ data: {}, error: null }),
        insert: (v) => { sent.push(v); return b }, update: (v) => { sent.push(v); return b },
        eq: () => b, then: (f, r) => Promise.resolve({ data: null, error: null }).then(f, r),
      }
      return { supabase: { from: () => b } }
    })
    const api = await import('../lib/api/recalls')
    await api.createRecall({ recall_number: 'SYN-1', country: ['KSA', 'UAE', 'Egypt'] })
    await api.createRecall({ recall_number: 'SYN-2', country: ['UAE'] })
    await api.updateRecall('id-1', { country: 'KSA' })
    await api.updateRecall('id-1', { status: 'Closed' })
    expect(sent.map(s => s.country)).toEqual([null, 'UAE', 'KSA', undefined])
    expect('country' in sent[3]).toBe(false)
    vi.doUnmock('../lib/supabase')
  })
})

describe('RecallTracker page source', () => {
  it('does not send the profile country list into recalls.country and offers a country picker', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/pages/RecallTracker.jsx', 'utf8').replace(/\r/g, '')
    expect(src).not.toMatch(/country:\s*[^\n]*profile\??\.country/)
    expect(src).toMatch(/country:\s*recallCountry,/)
    expect(src).toMatch(/id="rc-country"/)
    expect(src).toMatch(/Choose the country this recall applies to/)
  })
})

describe('recallWritableCountries mirrors the recalls_country_write policy', () => {
  it('super admin and the all sentinel may write every country', () => {
    expect(recallWritableCountries({ is_super_admin: true, country: null })).toEqual({ all: true, countries: [] })
    expect(recallWritableCountries({ role: 'Manager', country: ['KSA', ' ALL '] })).toEqual({ all: true, countries: [] })
  })
  it('a plain Admin is NOT exempt: only their own countries (the D1 retest case)', () => {
    expect(recallWritableCountries({ role: 'Admin', is_super_admin: false, country: ['KSA'] })).toEqual({ all: false, countries: ['KSA'] })
  })
  it('dedupes case-insensitively and skips blanks', () => {
    expect(recallWritableCountries({ country: ['KSA', 'ksa', '', null, 'UAE'] }).countries).toEqual(['KSA', 'UAE'])
  })
  it('no profile yet means unknown, not refused', () => {
    expect(recallWritableCountries(null)).toBeNull()
    expect(recallHasNoWritableCountry(null)).toBe(false)
  })
  it('a non-super profile with no country can write no country', () => {
    expect(recallHasNoWritableCountry({ role: 'Admin', country: null })).toBe(true)
    expect(recallHasNoWritableCountry({ role: 'Admin', country: [] })).toBe(true)
    expect(recallHasNoWritableCountry({ is_super_admin: true, country: null })).toBe(false)
  })
})

describe('recallCountryChoices narrows to what the database accepts', () => {
  const all = [{ country: 'Egypt' }, { country: 'KSA' }, { country: 'UAE' }]
  it('plain Admin with KSA is offered KSA only, even though the context lists every country', () => {
    expect(recallCountryChoices(all, ['KSA', 'UAE', 'Egypt'], { role: 'Admin', country: ['KSA'] })).toEqual(['KSA'])
  })
  it('super admin keeps every country', () => {
    expect(recallCountryChoices(all, [], { is_super_admin: true })).toEqual(['Egypt', 'KSA', 'UAE'])
  })
  it('falls back to the profile spelling when the register does not name the country', () => {
    expect(recallCountryChoices(all, [], { country: ['Saudi Arabia'] })).toEqual(['Saudi Arabia'])
  })
  it('a one-country admin never has to choose on the All view', () => {
    const choices = recallCountryChoices(all, [], { role: 'Admin', country: ['UAE'] })
    expect(resolveRecallCountry({ activeCountry: 'All', choices })).toEqual({ country: 'UAE', needsChoice: false })
  })
})

describe('updateRecall reports a silently refused update', () => {
  it('throws 42501 when RLS changed zero rows, passes when a row changed', async () => {
    let rows = []
    vi.resetModules()
    vi.doMock('../lib/supabase', () => {
      const b = {
        update: () => b, eq: () => b, select: () => b,
        then: (f, r) => Promise.resolve({ data: rows, error: null }).then(f, r),
      }
      return { supabase: { from: () => b } }
    })
    const api = await import('../lib/api/recalls')
    await expect(api.updateRecall('x', { status: 'Closed' })).rejects.toMatchObject({ code: '42501' })
    rows = [{ id: 'x' }]
    await expect(api.updateRecall('x', { status: 'Closed' })).resolves.toEqual([{ id: 'x' }])
    vi.doUnmock('../lib/supabase')
  })
})

describe('RecallTracker page narrows countries by profile and names refusals', () => {
  it('passes the profile to the choices and maps 42501', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/pages/RecallTracker.jsx', 'utf8').replace(/\r/g, '')
    expect(src).toMatch(/recallCountryChoices\(allowedContext, COUNTRIES, profile\)/)
    expect(src).toMatch(/e\?\.code === '42501'/)
    expect(src).toMatch(/recallHasNoWritableCountry\(profile\)/)
  })
})
