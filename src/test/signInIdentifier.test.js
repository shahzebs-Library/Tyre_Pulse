import { describe, it, expect } from 'vitest'
import {
  normalizeSignInIdentifier, splitSignInIdentifier, hasCompanyCode,
  isValidCompanyCode, syntheticSignInEmail, signInSlug,
} from '../lib/signInIdentifier'

describe('normalizeSignInIdentifier', () => {
  it('leaves a bare username and an email exactly as typed (trimmed)', () => {
    expect(normalizeSignInIdentifier('  ali.k ')).toBe('ali.k')
    expect(normalizeSignInIdentifier(' Ali@Company.com ')).toBe('Ali@Company.com')
    expect(normalizeSignInIdentifier('10234')).toBe('10234')
  })
  it('turns a backslash into a slash and removes spaces around the first slash', () => {
    expect(normalizeSignInIdentifier('ACME \\ ali')).toBe('ACME/ali')
    expect(normalizeSignInIdentifier('ACME / ali')).toBe('ACME/ali')
    expect(normalizeSignInIdentifier('acme/ali')).toBe('acme/ali')
  })
  it('a slash at the start does not make a company code (mirrors the SQL split)', () => {
    expect(normalizeSignInIdentifier('/ali')).toBe('/ali')
    expect(splitSignInIdentifier('/ali')).toEqual({ companyCode: null, name: 'ali' })
  })
  it('handles blanks and non-strings', () => {
    expect(normalizeSignInIdentifier('')).toBe('')
    expect(normalizeSignInIdentifier(null)).toBe('')
    expect(normalizeSignInIdentifier(undefined)).toBe('')
  })
})

describe('splitSignInIdentifier', () => {
  it('splits on the FIRST slash only', () => {
    expect(splitSignInIdentifier('ACME/ali/x')).toEqual({ companyCode: 'ACME', name: 'ali/x' })
  })
  it('a bare name has no code, an email has no code', () => {
    expect(splitSignInIdentifier('ali')).toEqual({ companyCode: null, name: 'ali' })
    expect(splitSignInIdentifier('a/b@c.com')).toEqual({ companyCode: null, name: 'a/b@c.com' })
  })
  it('hasCompanyCode needs both parts', () => {
    expect(hasCompanyCode('ACME/ali')).toBe(true)
    expect(hasCompanyCode('ACME/')).toBe(false)
    expect(hasCompanyCode('ali')).toBe(false)
  })
})

describe('company code shape and made-up address', () => {
  it('accepts the same code shape as admin_set_org_sign_in_code', () => {
    expect(isValidCompanyCode('ACME')).toBe(true)
    expect(isValidCompanyCode('green-concrete')).toBe(true)
    expect(isValidCompanyCode('A')).toBe(false)
    expect(isValidCompanyCode('-ACME')).toBe(false)
    expect(isValidCompanyCode('AC ME')).toBe(false)
  })
  it('keeps today’s address when there is no code', () => {
    expect(syntheticSignInEmail('Ali.K')).toBe('ali.k@users.tyrepulse.app')
  })
  it('adds the company code for an invited account', () => {
    expect(syntheticSignInEmail('Ali K', 'ACME')).toBe('ali.k+acme@users.tyrepulse.app')
  })
  it('never produces an empty local part', () => {
    expect(signInSlug('***')).toBe('user')
    expect(syntheticSignInEmail('***', '***')).toBe('user@users.tyrepulse.app')
  })
})
