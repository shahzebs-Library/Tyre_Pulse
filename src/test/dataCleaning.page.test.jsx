import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ api: {
  countTyreRecords: vi.fn(), listUncleanedSites: vi.fn(), listPendingRecords: vi.fn(),
  listCleanedRecords: vi.fn(), listPendingForApproveAll: vi.fn(), correctTyreRecords: vi.fn(),
  classificationChange: vi.fn((record, result, undo) => ({ id: record.id, result, undo })),
} }))
vi.mock('../lib/api', () => ({ dataCleaning: h.api }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'Admin' } }) }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))
vi.mock('../components/ui/PageHeader', () => ({ default: ({ title }) => <h1>{title}</h1> }))
import DataCleaning from '../pages/DataCleaning'
const record = { id: 'a', asset_no: 'TEST-1', description: 'Puncture', remarks: null, cleaned: false }
beforeEach(() => {
  vi.clearAllMocks()
  h.api.countTyreRecords.mockResolvedValue({ count: 1, error: null })
  h.api.listUncleanedSites.mockResolvedValue({ data: [], error: null })
  h.api.listPendingRecords.mockResolvedValue({ data: [record], count: 1, error: null })
  h.api.listCleanedRecords.mockResolvedValue({ data: [{ ...record, cleaned: true, category: 'Puncture', risk_level: 'Medium' }], error: null })
  h.api.correctTyreRecords.mockResolvedValue(['a'])
})
describe('Administration cleaning outcomes', () => {
  it('does not turn an Approve All read failure into an empty successful sweep', async () => {
    h.api.listPendingForApproveAll.mockResolvedValue({ data: null, error: new Error('Denied') })
    render(<DataCleaning />)
    fireEvent.click(await screen.findByRole('button', { name: /Approve All 1/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve All', exact: true }))
    await screen.findByText(/Approval stopped:/)
    expect(h.api.correctTyreRecords).not.toHaveBeenCalled()
    expect(h.api.listPendingForApproveAll).toHaveBeenCalledWith(expect.objectContaining({ country: 'KSA' }))
  })
  it('shows a failed transaction and clears saving state', async () => {
    h.api.correctTyreRecords.mockRejectedValue(new Error('Rejected'))
    render(<DataCleaning />)
    await screen.findByText(/TEST-1/)
    fireEvent.click(screen.getByRole('button', { name: 'Select All' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve 1', exact: true }))
    await screen.findByText(/0 record\(s\) confirmed. Correction stopped:/)
    await waitFor(() => expect(screen.queryByText('Saving...')).toBeNull())
  })
  it('undo uses the transaction and retains classification history', async () => {
    render(<DataCleaning />)
    fireEvent.click(screen.getByRole('button', { name: 'Already Cleaned' }))
    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }))
    await screen.findByText('Classification reverted; history retained')
    expect(h.api.correctTyreRecords).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ country: 'KSA', action: 'undo' }))
  })
})
