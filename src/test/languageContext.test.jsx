import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { LanguageProvider, useLanguage } from '../contexts/LanguageContext'

function Probe() {
  const { t, language, isRTL, setLanguage } = useLanguage()
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span data-testid="rtl">{String(isRTL)}</span>
      <span data-testid="save">{t('common.save')}</span>
      <span data-testid="greet">{t('onboarding.welcome', { name: 'Sam' })}</span>
      <span data-testid="missing">{t('nope.not.here')}</span>
      <button onClick={() => setLanguage('ar')}>ar</button>
      <button onClick={() => setLanguage('en')}>en</button>
    </div>
  )
}

describe('LanguageContext', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('dir') })
  afterEach(() => cleanup())

  it('defaults to English and resolves namespaced keys', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>)
    expect(screen.getByTestId('lang').textContent).toBe('en')
    expect(screen.getByTestId('save').textContent).toBe('Save')
  })

  it('interpolates variables', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>)
    expect(screen.getByTestId('greet').textContent).toBe('Welcome, Sam')
  })

  it('returns the key itself for a missing translation', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>)
    expect(screen.getByTestId('missing').textContent).toBe('nope.not.here')
  })

  it('switches to Arabic, sets RTL, and translates', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>)
    act(() => { fireEvent.click(screen.getByText('ar')) })
    expect(screen.getByTestId('lang').textContent).toBe('ar')
    expect(screen.getByTestId('rtl').textContent).toBe('true')
    expect(screen.getByTestId('save').textContent).toBe('حفظ')
    expect(document.documentElement.getAttribute('dir')).toBe('rtl')
    expect(localStorage.getItem('tp_language')).toBe('ar')
  })

  it('restores document direction to LTR when switching back to English', () => {
    render(<LanguageProvider><Probe /></LanguageProvider>)
    act(() => { fireEvent.click(screen.getByText('ar')) })
    act(() => { fireEvent.click(screen.getByText('en')) })
    expect(document.documentElement.getAttribute('dir')).toBe('ltr')
    expect(screen.getByTestId('save').textContent).toBe('Save')
  })

  it('falls back to English strings when used outside a provider', () => {
    render(<Probe />)
    expect(screen.getByTestId('save').textContent).toBe('Save')
    expect(screen.getByTestId('lang').textContent).toBe('en')
  })

  it('every Arabic namespace mirrors the English key set', async () => {
    const en = import.meta.glob('../locales/en/*.json', { eager: true, import: 'default' })
    const ar = import.meta.glob('../locales/ar/*.json', { eager: true, import: 'default' })
    const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`])
    for (const [path, enMod] of Object.entries(en)) {
      const arMod = ar[path.replace('/en/', '/ar/')]
      expect(arMod, `missing Arabic file for ${path}`).toBeTruthy()
      const enKeys = keys(enMod).sort()
      const arKeys = keys(arMod).sort()
      expect(arKeys, `key mismatch in ${path}`).toEqual(enKeys)
    }
  })
})
