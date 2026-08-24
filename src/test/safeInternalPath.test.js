import { describe, it, expect } from 'vitest'
import { safeInternalPath } from '../lib/safeUrl'

/**
 * A route target that comes from DATA must stay inside the app. These are the
 * shapes behind the react-router open-redirect advisory (CVE-2025-68470 and its
 * backslash bypass); rejecting them here closes the class whatever router
 * version is installed.
 *
 * The backslash cases are built with String.fromCharCode(92) rather than an
 * escape, because a literal backslash in this file is easy to mangle when the
 * test is edited by a script and a half-escaped case would pass vacuously.
 */
const BS = String.fromCharCode(92)

describe('safeInternalPath', () => {
  it('allows a normal in-app path', () => {
    expect(safeInternalPath('/work-orders')).toBe('/work-orders')
    expect(safeInternalPath('/tyre-passport/ABC%20123')).toBe('/tyre-passport/ABC%20123')
    expect(safeInternalPath('/a?b=1#c')).toBe('/a?b=1#c')
  })

  it('rejects a protocol-relative target (the classic open redirect)', () => {
    expect(safeInternalPath('//evil.com')).toBeUndefined()
    expect(safeInternalPath('//evil.com/path')).toBeUndefined()
  })

  it('rejects the BACKSLASH bypass, which browsers normalise to a slash', () => {
    // /\evil.com , \\evil.com , \/evil.com - all reach //evil.com in a browser.
    expect(safeInternalPath('/' + BS + 'evil.com')).toBeUndefined()
    expect(safeInternalPath(BS + BS + 'evil.com')).toBeUndefined()
    expect(safeInternalPath(BS + '/evil.com')).toBeUndefined()
  })

  it('rejects any scheme, including a script one', () => {
    expect(safeInternalPath('javascript:alert(1)')).toBeUndefined()
    expect(safeInternalPath('https://evil.com')).toBeUndefined()
    expect(safeInternalPath('data:text/html,<script>')).toBeUndefined()
  })

  it('rejects a relative or bare host, which resolves against the current route', () => {
    expect(safeInternalPath('evil.com')).toBeUndefined()
    expect(safeInternalPath('../admin')).toBeUndefined()
  })

  it('rejects non-strings and blanks rather than guessing', () => {
    for (const v of [null, undefined, 0, {}, [], '', '   ']) {
      expect(safeInternalPath(v)).toBeUndefined()
    }
  })

  it('passes a safe path through byte-for-byte, never rewriting it', () => {
    // The check normalises backslashes internally to decide, but must return the
    // ORIGINAL string so a legitimate path is not silently altered.
    const p = '/report/abc-123_XYZ'
    expect(safeInternalPath(p)).toBe(p)
  })

  it('the backslash fixtures are real backslashes, not a mangled escape', () => {
    // Guards the guard: if BS ever stopped being a backslash the cases above
    // would quietly test '/evil.com' and pass for the wrong reason.
    expect(BS).toBe('\\')
    expect(('/' + BS + 'evil.com').length).toBe(10)   // "/" + "\" + "evil.com"
  })
})
