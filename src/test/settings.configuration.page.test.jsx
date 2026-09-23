import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  load: { data: [], error: null },
  save: { data: { saved: 3 }, error: null },
  refresh: vi.fn(),
  profile: { id: 'admin-1', organisation_id: 'org-1', role: 'Admin', full_name: 'Administrator', username: 'admin' },
  user: { id: 'admin-1', email: 'admin@example.test' },
  settings: { company_name: '', currency: '', cost_per_tyre: '' },
}))
vi.mock('../lib/api/_client', () => ({ supabase: {
  rpc: (...args) => h.rpc(...args),
  from: () => {
    const query = { then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject) }
    for (const method of ['select', 'order', 'limit', 'eq']) query[method] = () => query
    return query
  },
} }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: h.profile, user: h.user, mfaEnabled: false, setMfaEnabled: vi.fn() }) }))
vi.mock('../contexts/SettingsContext', () => ({ COUNTRIES: ['KSA', 'UAE', 'Egypt'], useSettings: () => ({ appSettings: h.settings, refreshSettings: h.refresh, activeCountry: 'KSA', setActiveCountry: vi.fn() }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: key => key }) }))
vi.mock('../components/LanguageSwitcher', () => ({ default: () => null }))
vi.mock('../components/ReleaseNotes', () => ({ default: () => null }))
vi.mock('../components/settings/AppearancePanel', () => ({ default: () => null }))
vi.mock('../components/settings/MySignaturePanel', () => ({ default: () => null }))
vi.mock('../components/settings/FeatureFlagsPanel', () => ({ default: () => null }))
vi.mock('../components/TwoFactorSetup', () => ({ default: () => null }))
vi.mock('../lib/emailService', () => ({ sendReportEmail: vi.fn() }))
vi.mock('../lib/api/notificationPreferences', () => ({ getMyPreferences: async () => ({}) }))
vi.mock('../lib/api/accountDeletion', () => ({ listMyDeletionRequests: async () => [] }))
vi.mock('../lib/accountRecovery', () => ({
  getRecoveryContacts: async () => ({}), RECOVERY_SMS_ENABLED: false,
  recoveryDestinationIsValid: vi.fn(), removeRecoveryContact: vi.fn(),
  requestRecoveryContactVerification: vi.fn(), verifyRecoveryContact: vi.fn(),
}))

import Settings from '../pages/Settings'
const configured = [
  { key: 'company_name', value: '"Verified Fleet"' },
  { key: 'currency', value: '"AED"' },
  { key: 'cost_per_tyre', value: '1500' },
]
function mount() { return render(<MemoryRouter><Settings /></MemoryRouter>) }
const saveCalls = () => h.rpc.mock.calls.filter(([name]) => name === 'save_organisation_configuration')
beforeEach(() => {
  localStorage.clear()
  h.load = { data: configured, error: null }
  h.save = { data: { saved: 3 }, error: null }
  h.refresh.mockReset().mockResolvedValue(undefined)
  h.rpc.mockReset().mockImplementation(async (name, args) => {
    if (name === 'save_organisation_configuration') return h.save
    return args.p_namespace === 'settings' ? h.load : { data: [], error: null }
  })
})

describe('Settings configuration persistence', () => {
  it('blocks submission after the initial configuration read fails, including direct form submission', async () => {
    h.load = { data: null, error: { code: '42501', message: 'permission denied' } }
    mount()
    await screen.findByText('You do not have permission to do that.')
    const button = screen.getByRole('button', { name: 'Save App Settings' })
    expect(button).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Retry loading settings' })).toBeInTheDocument()
    fireEvent.submit(button.closest('form'))
    expect(saveCalls()).toHaveLength(0)
    expect(screen.queryByText('Settings saved')).not.toBeInTheDocument()
  }, 15000)

  it('never reports success when the atomic RPC rejects the save', async () => {
    h.save = { data: null, error: { code: '42501', message: 'permission denied' } }
    mount()
    const button = screen.getByRole('button', { name: 'Save App Settings' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await screen.findByText('You do not have permission to do that.')
    expect(saveCalls()).toHaveLength(1)
    expect(h.refresh).not.toHaveBeenCalled()
    expect(screen.queryByText('Settings saved')).not.toBeInTheDocument()
  }, 15000)

  it('sends all three verified keys once and confirms success only after refresh', async () => {
    mount()
    const button = screen.getByRole('button', { name: 'Save App Settings' })
    await waitFor(() => expect(button).toBeEnabled())
    expect(screen.getByLabelText('Company Name')).toHaveValue('Verified Fleet')
    fireEvent.click(button)
    await screen.findByText('Settings saved')
    expect(saveCalls()).toEqual([['save_organisation_configuration', {
      p_namespace: 'settings',
      p_values: [
        { key: 'cost_per_tyre', value: '1500' },
        { key: 'company_name', value: '"Verified Fleet"' },
        { key: 'currency', value: '"AED"' },
      ],
    }]])
    expect(h.refresh).toHaveBeenCalledTimes(1)
  }, 15000)

  it('does not report success for an incomplete server confirmation', async () => {
    h.save = { data: { saved: 2 }, error: null }
    mount()
    const button = screen.getByRole('button', { name: 'Save App Settings' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await screen.findByText('The server did not confirm every settings change. Reload before retrying.')
    expect(h.refresh).not.toHaveBeenCalled()
    expect(screen.queryByText('Settings saved')).not.toBeInTheDocument()
  }, 15000)
})
