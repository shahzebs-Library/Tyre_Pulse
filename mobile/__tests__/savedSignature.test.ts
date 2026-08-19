/**
 * The rules around a person's remembered signature, on the phone.
 *
 * These pin the two things that would be dangerous to get wrong: a mark drawn
 * NOW must beat the saved one, and a value that is not actually a drawing must
 * never be stored or attached as though it were.
 *
 * This module is a MIRROR of src/lib/savedSignature.js - the web and the phone
 * write the same `user_signatures` row - so the cases here are deliberately the
 * same shape as the web suite. If one side changes, both change.
 */
import {
  normaliseSignature, isUsableSignature, resolveSignature, SIGNATURE_MAX_LEN,
} from '../lib/savedSignature'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'
const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('normaliseSignature', () => {
  it('accepts both capture formats, because both screens are real', () => {
    // The checklist path draws SVG, the canvas pad emits a data URL, and
    // SignatureView renders both. Refusing one would make a mark drawn on one
    // screen unusable on another.
    expect(normaliseSignature(SVG)).toBe(SVG)
    expect(normaliseSignature(PNG)).toBe(PNG)
  })

  it('refuses anything that is not a drawing', () => {
    // Storing this would put an arbitrary string in front of a reader as though
    // it were somebody's signature.
    expect(normaliseSignature('Ahmed')).toBeNull()
    expect(normaliseSignature('<script>alert(1)</script>')).toBeNull()
    expect(normaliseSignature('https://example.com/sig.png')).toBeNull()
    expect(normaliseSignature('')).toBeNull()
    expect(normaliseSignature(null)).toBeNull()
    expect(normaliseSignature(42)).toBeNull()
  })

  it('refuses a value the database column would refuse', () => {
    // Mirrors user_signatures_len_chk. Offering to save something the server
    // throws away tells someone their signature is stored when it is not.
    const huge = `${SVG}${'x'.repeat(SIGNATURE_MAX_LEN)}`
    expect(normaliseSignature(huge)).toBeNull()
  })

  it('trims, so a pad that emits trailing whitespace still works', () => {
    expect(normaliseSignature(`  ${SVG}  `)).toBe(SVG)
    expect(isUsableSignature(`  ${SVG}  `)).toBe(true)
  })
})

describe('resolveSignature', () => {
  it('a mark drawn now beats the saved one', () => {
    // Someone who has just taken the trouble to redraw must not have it
    // silently replaced by their old mark.
    expect(resolveSignature({ saved: SVG, drawn: PNG }))
      .toEqual({ value: PNG, source: 'drawn' })
  })

  it('falls back to the saved mark, and SAYS it is the saved one', () => {
    // The source is not decoration: the screen prints it. Without it, "my
    // signature came from somewhere" is indistinguishable from the app signing
    // on someone's behalf.
    expect(resolveSignature({ saved: SVG })).toEqual({ value: SVG, source: 'saved' })
  })

  it('reports nothing rather than inventing a mark', () => {
    expect(resolveSignature({})).toEqual({ value: null, source: 'none' })
    expect(resolveSignature({ saved: 'Ahmed', drawn: '   ' }))
      .toEqual({ value: null, source: 'none' })
  })
})
