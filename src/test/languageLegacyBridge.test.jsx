import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { LanguageProvider, useLanguage } from '../contexts/LanguageContext'

/**
 * The legacy Arabic DOM bridge (uiTranslationMemory + a ~366 KB phrase memory)
 * must stay OFF the startup path: statically imported it cost every English user
 * ~100 KB gzip of first paint and a whole-document MutationObserver that did
 * nothing. It is now loaded only when Arabic is active, and still translates and
 * restores legacy text exactly as before.
 */

const SRC = readFileSync(join(process.cwd(), 'src/contexts/LanguageContext.jsx'), 'utf8')

function Probe() {
  const { setLanguage } = useLanguage()
  return (
    <div>
      <span data-testid="legacy">Sign In</span>
      <button onClick={() => setLanguage('ar')}>to-ar</button>
      <button onClick={() => setLanguage('en')}>to-en</button>
    </div>
  )
}

describe('legacy Arabic bridge is lazy', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => cleanup())

  it('is never statically imported by the language provider', () => {
    expect(SRC).not.toMatch(/^import[^\n]*uiTranslationMemory/m)
    expect(SRC).toMatch(/import\(['"]\.\.\/lib\/uiTranslationMemory['"]\)/)
  })

  it('still localises hard-coded legacy text in Arabic and restores it in English', async () => {
    render(<LanguageProvider><Probe /></LanguageProvider>)
    expect(screen.getByTestId('legacy').textContent).toBe('Sign In')
    act(() => { fireEvent.click(screen.getByText('to-ar')) })
    await waitFor(() => expect(screen.getByTestId('legacy').textContent).toBe('تسجيل الدخول'))
    act(() => { fireEvent.click(screen.getByText('to-en')) })
    await waitFor(() => expect(screen.getByTestId('legacy').textContent).toBe('Sign In'))
  })
})
