import { describe, expect, it } from 'vitest'
import { localiseLegacyDom, observeLegacyDom, translateLegacyText, legacyTranslationCount } from '../lib/uiTranslationMemory'

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

  it('does not restore stale render values while English observation is enabled', async () => {
    const host = document.createElement('section')
    host.innerHTML = '<span title="Title">Title</span>'
    const stop = observeLegacyDom(host, false)
    try {
      const label = host.firstChild
      label.firstChild.nodeValue = 'Supplier Management'
      label.title = 'Supplier Management'
      await Promise.resolve()
      await Promise.resolve()
      expect(label.textContent).toBe('Supplier Management')
      expect(label.title).toBe('Supplier Management')
    } finally { stop() }
  })

  it('preserves a new React value instead of restoring the bridge previous text or attribute', () => {
    const host = document.createElement('section')
    host.innerHTML = '<button title="Sign In">Sign In</button>'
    localiseLegacyDom(host, true)
    const button = host.firstChild
    button.firstChild.nodeValue = 'Save'
    button.title = 'Save'
    localiseLegacyDom(host, false)
    expect(button.textContent).toBe('Save')
    expect(button.title).toBe('Save')
  })

  it('never claims ownership of already translated React text', () => {
    const host = document.createElement('section')
    const arabic = translateLegacyText('Save')
    host.textContent = arabic
    localiseLegacyDom(host, true)
    host.firstChild.nodeValue = 'Save'
    localiseLegacyDom(host, false)
    expect(host.textContent).toBe('Save')
  })
})
