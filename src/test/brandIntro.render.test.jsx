import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => ({
      'common.intro.label': 'Tyre Pulse intro',
      'common.intro.skip': 'Skip',
      'common.intro.skipLabel': 'Skip intro',
      'common.intro.tagline': 'FLEET TYRE OPERATIONS',
      'common.intro.secondary': 'إدارة إطارات الأسطول',
    }[k] ?? k),
    isRTL: false,
  }),
}))

import BrandIntro, { INTRO_SEEN_KEY, INTRO_DURATION_MS } from '../components/brand/BrandIntro'

function setReducedMotion(on) {
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: on && q.includes('reduce'),
    media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }))
}

describe('BrandIntro', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    setReducedMotion(false)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows on the first visit and records that it was seen', () => {
    render(<BrandIntro />)
    expect(screen.getByTestId('brand-intro')).toBeTruthy()
    expect(screen.getByText('TYRE')).toBeTruthy()
    expect(screen.getByText('FLEET TYRE OPERATIONS')).toBeTruthy()
    expect(window.localStorage.getItem(INTRO_SEEN_KEY)).toBe('1')
  })

  it('does not show on a later visit', () => {
    window.localStorage.setItem(INTRO_SEEN_KEY, '1')
    render(<BrandIntro />)
    expect(screen.queryByTestId('brand-intro')).toBeNull()
  })

  it('does not show when disabled (signed-in user)', () => {
    render(<BrandIntro enabled={false} />)
    expect(screen.queryByTestId('brand-intro')).toBeNull()
  })

  it('removes itself after six seconds', () => {
    render(<BrandIntro />)
    act(() => { vi.advanceTimersByTime(INTRO_DURATION_MS + 50) })
    expect(screen.queryByTestId('brand-intro')).toBeNull()
  })

  it('Skip is a focusable button that dismisses it', () => {
    render(<BrandIntro />)
    const skip = screen.getByRole('button', { name: 'Skip intro' })
    expect(skip.tagName).toBe('BUTTON')
    skip.focus()
    expect(document.activeElement).toBe(skip)
    fireEvent.click(skip)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByTestId('brand-intro')).toBeNull()
  })

  it('Escape dismisses it', () => {
    render(<BrandIntro />)
    fireEvent.keyDown(window, { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByTestId('brand-intro')).toBeNull()
  })

  it('reduced motion shows the finished logo for about a second, then fades', () => {
    setReducedMotion(true)
    render(<BrandIntro />)
    const word = document.querySelector('.tp-intro__word')
    expect(Number(word.style.opacity)).toBe(1)
    act(() => { vi.advanceTimersByTime(900) })
    expect(screen.getByTestId('brand-intro')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(700) })
    expect(screen.queryByTestId('brand-intro')).toBeNull()
  })
})
