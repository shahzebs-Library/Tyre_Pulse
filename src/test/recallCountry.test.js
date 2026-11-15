import { describe, it, expect, vi } from 'vitest'
import { normaliseRecallCountry, recallCountryChoices, resolveRecallCountry } from '../lib/recallCountry'

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
  it('a country outside the user scope is not accepted', () => {
    expect(resolveRecallCountry({ formCountry: 'Egypt', choices: ['KSA'] }).country).toBe('KSA')
    expect(resolveRecallCountry({ formCountry: 'Egypt', choices: ['KSA', 'UAE'] }).needsChoice).toBe(true)
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
