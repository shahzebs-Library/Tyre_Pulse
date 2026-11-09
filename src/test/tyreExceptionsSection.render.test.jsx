import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({
  auth: { profile: { id: 'u1', role: 'Manager' }, isSuperAdmin: false },
  get: vi.fn(),
  set: vi.fn(),
}))

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'All' }) }))
vi.mock('../lib/api/tyreExceptions', () => ({
  getTyreExceptionsV2: (...a) => h.get(...a),
  getAllTyreExceptionsV2: vi.fn(() => Promise.resolve({ rows: [], total: 0, truncated: false })),
  setTyreExceptionReview: (...a) => h.set(...a),
}))
vi.mock('../lib/exportUtils', () => ({ exportToExcel: vi.fn(), reportFileName: (...p) => p.join(' ') }))

import TyreExceptionsSection from '../components/reconciliation/TyreExceptionsSection'

const PAYLOAD = {
  total: 2,
  rotation_available: true,
  counts: [
    { kind: 'overlapping_fitment', country: 'KSA', n: 1, open: 1, accepted: 0, rejected: 0, deferred: 0, protected: 0 },
    { kind: 'price_assigned_twice', country: 'KSA', n: 1, open: 1, accepted: 0, rejected: 0, deferred: 0, protected: 1 },
  ],
  rows: [
    { exception_key: 'overlapping_fitment|r1', kind: 'overlapping_fitment', country: 'KSA', currency: 'SAR', record_ids: ['r1'],
      serial: 'YMA55310', asset: 'TM374', tyre_position: 'LHCI', reason: 'Fitment starts before an earlier fitment ended',
      proposed: 'Close the earlier fitment', impact_km: 12000, impact_cost: null, status: 'open', protected: false },
    { exception_key: 'price_assigned_twice|KSA|K507B403860', kind: 'price_assigned_twice', country: 'KSA', currency: 'SAR',
      record_ids: ['a', 'b'], serial: 'K507B403860', asset: 'MP111 / TM676', reason: 'One physical tyre carries 2 purchase prices',
      proposed: 'Keep the latest uploaded price', impact_km: null, impact_cost: 766, status: 'open', protected: true },
  ],
}

beforeEach(() => {
  h.get.mockReset().mockResolvedValue(PAYLOAD)
  h.set.mockReset().mockResolvedValue({ ok: true })
  h.auth = { profile: { id: 'u1', role: 'Manager' }, isSuperAdmin: false }
})

describe('TyreExceptionsSection', () => {
  it('shows counts, reasons, proposals and impact; protected rows have no review button', async () => {
    render(<TyreExceptionsSection />)
    expect(await screen.findByText('Close the earlier fitment')).toBeTruthy()
    expect(screen.getByText('12,000 km')).toBeTruthy()
    expect(screen.getByText('766 SAR')).toBeTruthy()
    expect(screen.getByText('Owner decision needed')).toBeTruthy()
    // one reviewable row -> exactly one Review button
    expect(screen.getAllByRole('button', { name: 'Review' })).toHaveLength(1)
  })

  it('a non-elevated role sees the list but no review action', async () => {
    h.auth = { profile: { id: 'u2', role: 'Tyre Man' }, isSuperAdmin: false }
    render(<TyreExceptionsSection />)
    await screen.findByText('Close the earlier fitment')
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull()
  })

  it('records a review through the RPC only and reloads', async () => {
    render(<TyreExceptionsSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
    fireEvent.click(screen.getByLabelText('Deferred'))
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'waiting for job card' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }))
    await waitFor(() => expect(h.set).toHaveBeenCalledWith({
      key: 'overlapping_fitment|r1', kind: 'overlapping_fitment', country: 'KSA', status: 'deferred', note: 'waiting for job card',
    }))
    await waitFor(() => expect(h.get.mock.calls.length).toBeGreaterThan(2))
  })

  it('shows an error with Retry instead of an empty list when the read fails', async () => {
    h.get.mockRejectedValue(new Error('boom'))
    render(<TyreExceptionsSection />)
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0)
    expect(screen.queryByText('No tyre exceptions in this scope.')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0)
  })

  it('filters by kind through the server, from page one', async () => {
    render(<TyreExceptionsSection />)
    await screen.findByText('Close the earlier fitment')
    fireEvent.change(screen.getByLabelText('Exception kind'), { target: { value: 'price_missing' } })
    await waitFor(() => expect(h.get).toHaveBeenCalledWith(expect.objectContaining({ kind: 'price_missing', offset: 0 })))
  })
})
