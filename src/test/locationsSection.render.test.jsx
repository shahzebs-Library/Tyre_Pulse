import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

const api = vi.hoisted(() => ({
  rows: [{ id: 'wh1', organisation_id: 'o', country: 'KSA', site: 'NHC', parent_id: null, location_type: 'warehouse', code: 'WH1', name: 'Main', label_code: 'TP:LOC:wh1', active: true }],
  bulk: vi.fn(),
  save: vi.fn(),
}))

vi.mock('../lib/api/inventory', () => ({
  listLocations: () => Promise.resolve({ status: 'ok', rows: api.rows, truncated: false }),
  saveLocation: (...a) => api.save(...a),
  bulkCreateLocations: (...a) => api.bulk(...a),
  newIdempotencyKey: () => `k-${Math.random()}`,
}))
vi.mock('../lib/api/sites', () => ({ listSites: () => Promise.resolve([{ name: 'NHC', country: 'KSA' }, { name: 'DIRIYAH', country: 'KSA' }]) }))
const auth = { profile: { id: 'u1', role: 'Manager' }, isSuperAdmin: false }
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => auth }))

import LocationsSection from '../components/inventory/LocationsSection'
import { LanguageProvider } from '../contexts/LanguageContext'

const renderIt = () => render(<LanguageProvider><LocationsSection scope={{ country: 'KSA', site: 'all' }} /></LanguageProvider>)

beforeEach(() => {
  api.bulk.mockReset(); api.save.mockReset()
  auth.profile = { id: 'u1', role: 'Manager' }
})

describe('Locations section', () => {
  it('bulk setup previews with a server dry run and saves only after Create', async () => {
    api.bulk.mockImplementation((payload, key, opts) => Promise.resolve(opts?.dryRun
      ? { dry_run: true, created: payload.nodes.length, existing: 0, nodes: payload.nodes.map((n) => ({ ref: n.ref, code: n.code, status: 'new' })) }
      : { dry_run: false, created: payload.nodes.length, existing: 0, nodes: [] }))
    renderIt()
    fireEvent.click(await screen.findByRole('button', { name: /Bulk setup/ }))
    const dialog = await screen.findByRole('dialog')
    const selects = within(dialog).getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: 'NHC' } })
    fireEvent.change(within(dialog).getAllByRole('combobox')[1], { target: { value: 'wh1' } })
    fireEvent.change(within(dialog).getByLabelText(/Racks/), { target: { value: 'A' } })
    fireEvent.change(within(dialog).getByLabelText(/Shelves per rack/), { target: { value: '2' } })
    fireEvent.change(within(dialog).getByLabelText(/Bins per shelf/), { target: { value: '2' } })
    expect(within(dialog).getByText(/1 racks, 2 shelves and 4 bins/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /Preview/ }))
    await within(dialog).findByText('WH1-A-01-02')
    expect(api.bulk).toHaveBeenCalledTimes(1)
    const [payload, , opts] = api.bulk.mock.calls[0]
    expect(opts).toEqual({ dryRun: true })
    expect(payload).toMatchObject({ country: 'KSA', site: 'NHC', parent_id: 'wh1' })
    expect(payload.nodes).toHaveLength(7)
    fireEvent.click(within(dialog).getByRole('button', { name: /Create 7 locations/ }))
    await waitFor(() => expect(api.bulk).toHaveBeenCalledTimes(2))
    expect(api.bulk.mock.calls[1][2]?.dryRun).toBeFalsy()
    expect(await screen.findByText(/Saved: 7 created/)).toBeTruthy()
  })

  it('the single form picks an existing store and never offers a free-text site', async () => {
    renderIt()
    fireEvent.click(await screen.findByRole('button', { name: /Add location/ }))
    const dialog = await screen.findByRole('dialog')
    const store = within(dialog).getAllByRole('combobox')[0]
    expect(store.tagName).toBe('SELECT')
    expect(within(store).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose...', 'NHC (KSA)', 'DIRIYAH (KSA)'])
  })

  it('hides write buttons for a role the server would refuse', async () => {
    auth.profile = { id: 'u2', role: 'Store Keeper' }
    renderIt()
    await screen.findByText('WH1')
    expect(screen.queryByRole('button', { name: /Bulk setup/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Add location/ })).toBeNull()
    expect(screen.getByText(/needs an Admin, Manager or Director/)).toBeTruthy()
  })
})
