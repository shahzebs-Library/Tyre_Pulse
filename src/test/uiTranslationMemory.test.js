import { describe, expect, it } from 'vitest'
import { localiseLegacyDom, translateLegacyText, legacyTranslationCount } from '../lib/uiTranslationMemory'

describe('legacy Arabic UI translation memory', () => {
  it('builds a substantial memory from paired locale catalogs', () => {
    expect(legacyTranslationCount).toBeGreaterThan(3000)
  })

  it('translates hard-coded catalog text and preserves whitespace', () => {
    expect(translateLegacyText('  Sign In  ')).toBe('  تسجيل الدخول  ')
  })

  it('localises text and accessible attributes and can restore English', () => {
    const host = document.createElement('section')
    host.innerHTML = '<button title="Sign In" aria-label="Sign In"> Sign In </button><input placeholder="Enter your password">'
    localiseLegacyDom(host, true)
    expect(host.textContent.trim()).toBe('تسجيل الدخول')
    expect(host.querySelector('button').title).toBe('تسجيل الدخول')
    expect(host.querySelector('input').placeholder).toBe('أدخل كلمة المرور')

    localiseLegacyDom(host, false)
    expect(host.textContent.trim()).toBe('Sign In')
    expect(host.querySelector('button').title).toBe('Sign In')
  })
})
