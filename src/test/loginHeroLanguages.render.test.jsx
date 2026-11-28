import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    language: 'en',
    setLanguage: () => {},
    languages: [
      { code: 'en', label: 'English', native: 'English' },
      { code: 'ar', label: 'Arabic', native: 'العربية' },
      { code: 'ur', label: 'Urdu', native: 'اردو' },
    ],
  }),
}))

import LoginHero from '../components/auth/login/LoginHero'

describe('LoginHero language switch', () => {
  it('names each language once; Urdu is not a second "English" button', () => {
    render(<LoginHero />)
    const group = screen.getByRole('group')
    const labels = [...group.querySelectorAll('button')].map((b) => b.textContent)
    expect(labels).toEqual(['English', 'عربي', 'اردو'])
  })
})
