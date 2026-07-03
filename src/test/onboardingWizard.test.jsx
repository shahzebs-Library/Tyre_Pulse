import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// ── Mocks ────────────────────────────────────────────────────────────────────
const navigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}))

let authValue = { profile: null, user: null }
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => authValue,
}))

const setActiveCountry = vi.fn()
let settingsValue = { activeCountry: 'All', setActiveCountry }
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => settingsValue,
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
  COUNTRY_LABEL: { KSA: 'KSA', UAE: 'UAE', Egypt: 'EGY' },
  COUNTRY_CURRENCY: { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' },
}))

import OnboardingWizard, { hasCompletedOnboarding } from '../components/OnboardingWizard'

function setAuth(profile, user) { authValue = { profile, user } }

describe('OnboardingWizard', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    navigate.mockClear()
    setActiveCountry.mockClear()
    settingsValue = { activeCountry: 'All', setActiveCountry }
  })

  it('does not render when there is no profile', () => {
    setAuth(null, null)
    render(<OnboardingWizard />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('auto-opens on first run for a fresh user and greets by first name', () => {
    setAuth({ role: 'Admin', full_name: 'Jane Smith' }, { id: 'u1' })
    render(<OnboardingWizard />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/Welcome, Jane/)).toBeInTheDocument()
  })

  it('does not auto-open once onboarding is completed for that user', () => {
    localStorage.setItem('tp_onboarded_v1_u1', '1')
    setAuth({ role: 'Admin', full_name: 'Jane Smith' }, { id: 'u1' })
    render(<OnboardingWizard />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the country step for an Admin (no locked scope)', async () => {
    setAuth({ role: 'Admin', full_name: 'Jane Smith' }, { id: 'u1' })
    render(<OnboardingWizard />)
    // welcome → role → country
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    expect(await screen.findByText(/Choose your data scope/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('All Countries'))
    expect(setActiveCountry).toHaveBeenCalledWith('All')
  })

  it('skips the country step for a non-admin with a locked country', async () => {
    setAuth({ role: 'Tyre Man', full_name: 'Omar', country: 'KSA' }, { id: 'u2' })
    render(<OnboardingWizard />)
    // welcome → role → (no country) → features
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    expect(await screen.findByText('Jump straight to')).toBeInTheDocument()
    expect(screen.queryByText(/Choose your data scope/)).toBeNull()
  })

  it('completes the tour, persists the flag, and navigates to the primary destination', () => {
    setAuth({ role: 'Tyre Man', full_name: 'Omar', country: 'KSA' }, { id: 'u2' })
    render(<OnboardingWizard />)
    fireEvent.click(screen.getByText('Next')) // → role
    fireEvent.click(screen.getByText('Next')) // → features
    fireEvent.click(screen.getByText('Next')) // → finish
    // Primary CTA for Tyre Man is "Open Checklist" → /inspections
    fireEvent.click(screen.getByText('Open Checklist'))
    expect(hasCompletedOnboarding('u2')).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/inspections')
  })

  it('Skip marks onboarding complete without navigating', () => {
    setAuth({ role: 'Manager', full_name: 'Lee' }, { id: 'u3' })
    render(<OnboardingWizard />)
    fireEvent.click(screen.getByText('Skip tour'))
    expect(hasCompletedOnboarding('u3')).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('replays when the tp:onboarding:replay event fires after completion', () => {
    localStorage.setItem('tp_onboarded_v1_u4', '1')
    setAuth({ role: 'Reporter', full_name: 'Sam' }, { id: 'u4' })
    render(<OnboardingWizard />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent(window, new Event('tp:onboarding:replay'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
