import { describe, it, expect } from 'vitest'
import {
  normaliseSignature, isUsableSignature, resolveSignature, SIGNATURE_MAX_LEN,
} from '../lib/savedSignature'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1 L9 9"/></svg>'
const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('normaliseSignature', () => {
  it('accepts BOTH capture formats - the SVG the checklist pad draws and the data URL the canvas pad draws', () => {
    // Refusing either one would make a signature drawn on one screen unusable
    // on another, which is the bug SignatureView already had to fix once.
    expect(normaliseSignature(SVG)).toBe(SVG)
    expect(normaliseSignature(PNG)).toBe(PNG)
  })

  it('trims surrounding whitespace rather than storing it', () => {
    expect(normaliseSignature(`  ${SVG}  `)).toBe(SVG)
  })

  it('returns null for nothing at all, so an empty pad never counts as a signature', () => {
    expect(normaliseSignature(null)).toBeNull()
    expect(normaliseSignature(undefined)).toBeNull()
    expect(normaliseSignature('')).toBeNull()
    expect(normaliseSignature('   ')).toBeNull()
    expect(normaliseSignature(123)).toBeNull()
    expect(normaliseSignature({ svg: SVG })).toBeNull()
  })

  it('refuses an arbitrary string - it would be shown to a reader as though it were a signature', () => {
    expect(normaliseSignature('approved by me')).toBeNull()
    expect(normaliseSignature('https://example.com/sig.png')).toBeNull()
  })

  it('refuses a value the database column would refuse, so the screen never offers to save one', () => {
    const tooBig = `${SVG}${'x'.repeat(SIGNATURE_MAX_LEN)}`
    expect(tooBig.length).toBeGreaterThan(SIGNATURE_MAX_LEN)
    expect(normaliseSignature(tooBig)).toBeNull()
  })

  it('isUsableSignature agrees with normaliseSignature', () => {
    expect(isUsableSignature(SVG)).toBe(true)
    expect(isUsableSignature('')).toBe(false)
  })
})

describe('resolveSignature', () => {
  it('a freshly drawn mark wins over the saved one', () => {
    expect(resolveSignature({ saved: SVG, drawn: PNG })).toEqual({ value: PNG, source: 'drawn' })
  })

  it('falls back to the saved mark and SAYS it is the saved one', () => {
    // The source is not decoration: the screen prints it, so a mark that
    // appeared is never mistaken for the app signing on someone's behalf.
    expect(resolveSignature({ saved: SVG, drawn: null })).toEqual({ value: SVG, source: 'saved' })
  })

  it('reports nothing when neither exists', () => {
    expect(resolveSignature({})).toEqual({ value: null, source: 'none' })
    expect(resolveSignature({ saved: '  ', drawn: '' })).toEqual({ value: null, source: 'none' })
  })

  it('a cleared pad falls back to the saved mark rather than to nothing', () => {
    expect(resolveSignature({ saved: SVG, drawn: '' }).source).toBe('saved')
  })
})
