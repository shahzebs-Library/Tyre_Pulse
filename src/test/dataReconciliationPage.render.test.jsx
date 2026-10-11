import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Mounts the real Data Reconciliation page over a mocked reconciliation
 * service (the self-loading sections are stubbed) and proves: the three core
 * registers render through EnterpriseTable, the KPI strip reads real counts,
 * a failed read is stated with Retry and its KPI reads N/A (never 0), and the
 * guarded fix still goes through a confirmation before the RPC.
 */

const h = vi.hoisted(() => ({
  orphans: vi.fn(), dupes: vi.fn(), conflicts: vi.fn(), merge: vi.fn(), backfill: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  dataReconciliation: {
    listOrphanAssets: h.orphans,
    listDuplicateTyres: h.dupes,
    listSerialConflicts: h.conflicts,
    mergeDuplicate: h.merge,
    backfillAsset: h.backfill,
    backfillAllOrphanAssets: vi.fn(),
  },
}))
// One literal vi.mock per section: vitest hoists vi.mock statically, so a loop
// with a template path never applied and the real sections rendered.
vi.mock('../components/reconciliation/BrandGapSection', () => ({ default: () => null }))
vi.mock('../components/reconciliation/TyreLearningSection', () => ({ default: () => null }))
vi.mock('../components/reconciliation/TyrePriceSection', () => ({ default: () => null }))
vi.mock('../components/reconciliation/JobcardDateSection', () => ({ default: () => null }))
vi.mock('../components/reconciliation/DupKeyTyresSection', () => ({ default: () => null }))
vi.mock('../components/reconciliation/SerialMultiAssetSection', () => ({ default: () => null }))
vi.mock('../components/reconciliation/FreetextTyreSection', () => ({ default: () => null }))
vi.mock('../components/reconciliation/TyreLifeCapSection', () => ({ default: () => null }))
vi.mock('../components/reconciliation/DataQualityScorecard', () => ({ default: () => null }))
vi.mock('../components/reconciliation/AssetMasterSection', () => ({ default: () => null }))
vi.mock('../components/reconciliation/DataTrustSection', () => ({ default: () => null }))

import DataReconciliation from '../pages/DataReconciliation'

const renderPage = () => render(<MemoryRouter><DataReconciliation /></MemoryRouter>)

beforeEach(() => {
  cleanup()
  h.orphans.mockResolvedValue([{ asset_no: 'TM900', vehicle_type: 'MIXER', country: 'KSA', tyres: 6 }])
  h.dupes.mockResolvedValue([{ serial: 'SER1', asset_no: 'TM1', copies: 3, keep_id: 'k', remove_ids: ['a', 'b'] }])
  h.conflicts.mockResolvedValue([{ serial: 'MOVE1', vehicles: [{ asset_no: 'A', date: '2026-01-01' }, { asset_no: 'B', date: '2026-03-01' }] }])
  h.merge.mockResolvedValue({})
})

describe('DataReconciliation page', () => {
  it('fills the KPI strip from the three reads', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Removable copies')).toBeTruthy())
    await waitFor(() => expect(screen.getAllByText('2').length).toBeGreaterThan(0))
    expect(screen.getByText('Tyres on orphans')).toBeTruthy()
  })

  it('renders the registers and merges only after confirmation', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Integrity' }))
    await waitFor(() => expect(screen.getAllByText('SER1').length).toBeGreaterThan(0))
    expect(screen.getAllByText('MOVE1').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: /Merge \(keep newest\)/ })[0])
    expect(h.merge).not.toHaveBeenCalled()
    await screen.findByRole('dialog')
    fireEvent.click(screen.getAllByRole('button', { name: /Merge \(keep newest\)/ }).at(-1))
    await waitFor(() => expect(h.merge).toHaveBeenCalledWith('k', ['a', 'b']))
  })

  it('states a failed read with Retry and never counts it as zero', async () => {
    h.orphans.mockRejectedValue(new Error('boom'))
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Completeness' }))
    await waitFor(() => expect(screen.getByText('Could not load this section')).toBeTruthy())
    expect(screen.getAllByRole('button', { name: /Retry/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0)
    expect(screen.queryByText('Every asset is registered')).toBeNull()
  })
})
