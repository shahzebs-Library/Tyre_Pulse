import { describe, it, expect } from 'vitest'
import { safeHref, safeImageSrc } from '../lib/safeUrl'

describe('safeHref', () => {
  it('allows http and https URLs unchanged', () => {
    expect(safeHref('http://example.com/a')).toBe('http://example.com/a')
    expect(safeHref('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c')
  })

  it('allows mailto URLs', () => {
    expect(safeHref('mailto:ops@fleet.io')).toBe('mailto:ops@fleet.io')
  })

  it('is case-insensitive on the scheme', () => {
    expect(safeHref('HTTPS://example.com')).toBe('HTTPS://example.com')
    expect(safeHref('MailTo:x@y.com')).toBe('MailTo:x@y.com')
  })

  it('allows relative references (path, query, fragment)', () => {
    expect(safeHref('/reports/42')).toBe('/reports/42')
    expect(safeHref('#section')).toBe('#section')
    expect(safeHref('reports/42?tab=1')).toBe('reports/42?tab=1')
    expect(safeHref('./a')).toBe('./a')
  })

  it('trims surrounding whitespace before evaluating', () => {
    expect(safeHref('  https://example.com  ')).toBe('https://example.com')
    expect(safeHref('  javascript:alert(1)  ')).toBeUndefined()
  })

  it('rejects javascript: scheme (including obfuscated casing)', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
    expect(safeHref('JavaScript:alert(1)')).toBeUndefined()
  })

  it('rejects vbscript: scheme', () => {
    expect(safeHref('vbscript:msgbox(1)')).toBeUndefined()
  })

  it('rejects data: URLs for hrefs', () => {
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined()
    expect(safeHref('data:image/png;base64,AAAA')).toBeUndefined()
  })

  it('rejects the relative-with-colon trick', () => {
    // A leading scheme-like token before a colon is treated as a scheme, not a path.
    expect(safeHref('foo:bar')).toBeUndefined()
    // But a colon after a path delimiter is a genuine relative reference.
    expect(safeHref('/a:b')).toBe('/a:b')
    expect(safeHref('a/b:c')).toBe('a/b:c')
  })

  it('rejects non-string and empty inputs', () => {
    expect(safeHref(null)).toBeUndefined()
    expect(safeHref(undefined)).toBeUndefined()
    expect(safeHref(123)).toBeUndefined()
    expect(safeHref('')).toBeUndefined()
    expect(safeHref('   ')).toBeUndefined()
  })
})

describe('safeImageSrc', () => {
  it('allows http and https image URLs', () => {
    expect(safeImageSrc('https://cdn.example.com/logo.png')).toBe('https://cdn.example.com/logo.png')
    expect(safeImageSrc('http://cdn.example.com/logo.png')).toBe('http://cdn.example.com/logo.png')
  })

  it('allows data:image/* URLs', () => {
    expect(safeImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(safeImageSrc('data:image/svg+xml;utf8,<svg/>')).toBe('data:image/svg+xml;utf8,<svg/>')
  })

  it('allows blob: object URLs', () => {
    expect(safeImageSrc('blob:https://app.fleet.io/9f-uuid')).toBe('blob:https://app.fleet.io/9f-uuid')
  })

  it('allows relative image references', () => {
    expect(safeImageSrc('/assets/logo.svg')).toBe('/assets/logo.svg')
  })

  it('rejects non-image data URLs and script schemes', () => {
    expect(safeImageSrc('data:text/html,<script>alert(1)</script>')).toBeUndefined()
    expect(safeImageSrc('javascript:alert(1)')).toBeUndefined()
    expect(safeImageSrc('mailto:x@y.com')).toBeUndefined()
    expect(safeImageSrc(null)).toBeUndefined()
    expect(safeImageSrc('')).toBeUndefined()
  })
})
