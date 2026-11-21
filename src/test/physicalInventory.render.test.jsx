// Physical inventory section: honest "not set up" before the draft migration is
// applied, and a capture that saves then clears the form for the next item.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({
  listSessions: vi.fn(),
  listCaptures: vi.fn(),
  recordCapture: vi.fn(),
  searchMaterials: vi.fn(),
  loadDashboard: vi.fn(),
}))
vi.mock('../lib/api/physicalInventory', async (orig) => ({ ...(await orig()), ...api }))
vi.mock('../lib/api/inventory', async (orig) => ({
  ...(await orig()),
  listLocations: vi.fn().mockResolvedValue({ status: 'ok', rows: [] }),
}))
vi.mock('../lib/api/sites', () => ({ listSites: vi.fn().mockResolvedValue([{ name: 'NHC' }]) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u1', organisation_id: 'org1' } }) }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ appSettings: {}, activeCountry: 'KSA' }) }))

import PhysicalInventorySection from '../components/inventory/PhysicalInventorySection'
import { LanguageProvider } from '../contexts/LanguageContext'

const SCOPE = { country: 'KSA', site: 'all' }
const ui = () => render(<LanguageProvider><PhysicalInventorySection scope={SCOPE} can={() => true} userId="u1" /></LanguageProvider>)

describe('PhysicalInventorySection', () => {
  beforeEach(() => Object.values(api).forEach((f) => f.mockReset()))

  it('says "not set up" instead of an empty list before the migration exists', async () => {
    api.listSessions.mockResolvedValue({ status: 'not_provisioned', rows: [], total: 0 })
    ui()
    await screen.findByText(/not set up/i)
  })

  it('resumes an open session and saves a capture, then is ready for the next item', async () => {
    api.listSessions.mockResolvedValue({ status: 'ok', rows: [{ id: 's1', reference: 'PI-20261121-ABC', site: 'NHC', country: 'KSA', status: 'open', started_at: '2026-11-21T08:00:00Z' }], total: 1 })
    api.listCaptures.mockResolvedValue({ status: 'ok', rows: [], total: 0 })
    api.recordCapture.mockResolvedValue({ id: 'c1', temp_ref: 'UNK-261121-AAAA0000', identification_status: 'pending_review' })
    ui()
    fireEvent.click(await screen.findByRole('button', { name: /resume/i }))
    const qty = await screen.findByLabelText('Quantity')
    fireEvent.change(qty, { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: /save and next/i }))
    await waitFor(() => expect(api.recordCapture).toHaveBeenCalledTimes(1))
    const payload = api.recordCapture.mock.calls[0][0]
    expect(payload).toMatchObject({ session_id: 's1', quantity: 4, kind: 'unidentified' })
    expect(payload.client_uuid).toMatch(/^[0-9a-f-]{36}$/)
    await screen.findByText(/UNK-261121-AAAA0000/)
    expect(screen.getByLabelText('Quantity').value).toBe('')
  })
})
