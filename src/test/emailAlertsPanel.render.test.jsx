import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({
  getEmailEventSettings: vi.fn(),
  setEmailEventSetting: vi.fn(),
  sendTestEmail: vi.fn(),
  listOrgPeople: vi.fn(),
}))
vi.mock('../lib/api/emailSettings', async () => {
  const real = await vi.importActual('../lib/api/emailSettings')
  return { ...real, ...api }
})

import en from '../locales/en/emailAlerts.json'
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (key, vars) => {
      const v = key.replace(/^emailAlerts\./, '').split('.').reduce((o, k) => o?.[k], en)
      return typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (m, k) => vars?.[k] ?? m) : key
    },
  }),
}))

import EmailAlertsPanel from '../components/settings/EmailAlertsPanel'

const rows = [
  { event_key: 'accident.reported', optional: false, assignee_based: false, enabled: true, recipient_roles: [], recipient_user_ids: [], external_addresses: ['tpe@example.sa'], include_assignee: true },
  { event_key: 'digest.daily', optional: true, assignee_based: false, enabled: true, recipient_roles: ['Admin'], recipient_user_ids: [], external_addresses: [], include_assignee: true },
]

describe('EmailAlertsPanel', () => {
  beforeEach(() => {
    api.getEmailEventSettings.mockResolvedValue(rows)
    api.listOrgPeople.mockResolvedValue([{ id: 'u1', full_name: 'Sara Manager', role: 'Manager' }])
    api.setEmailEventSetting.mockResolvedValue({ enabled: true })
    api.sendTestEmail.mockResolvedValue(true)
  })

  it('renders every email type and filters by prefix', async () => {
    render(<EmailAlertsPanel eventPrefix="accident." />)
    expect(await screen.findByText('Accident reported')).toBeInTheDocument()
    expect(screen.queryByText('Daily morning summary')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('tpe@example.sa')).toBeInTheDocument()
  })

  it('blocks saving a synthetic address and saves a valid one', async () => {
    render(<EmailAlertsPanel />)
    const box = await screen.findByDisplayValue('tpe@example.sa')
    fireEvent.change(box, { target: { value: 'driver@users.tyrepulse.app' } })
    expect(await screen.findByText(/cannot receive email/)).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'claims@insurer.com, tpe@example.sa' } })
    fireEvent.click(screen.getAllByRole('button', { name: /^Save$/ })[0])
    await waitFor(() => expect(api.setEmailEventSetting).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'accident.reported', external: ['claims@insurer.com', 'tpe@example.sa'],
    })))
  })

  it('shows an error with retry when settings cannot load', async () => {
    api.getEmailEventSettings.mockRejectedValueOnce(new Error('boom'))
    render(<EmailAlertsPanel />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(await screen.findByText('Daily morning summary')).toBeInTheDocument()
  })

  it('sends a test email', async () => {
    render(<EmailAlertsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /test email/ }))
    expect(await screen.findByText(/Test queued/)).toBeInTheDocument()
  })
})
