// Material Master reconciliation panels: the queue shows warnings, never offers
// a proposer their own approval, and the health card flags problem counts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const api = vi.hoisted(() => ({
  loadLinkCandidates: vi.fn(),
  loadLinkHealth: vi.fn(),
  proposeErpLink: vi.fn(),
  decideLink: vi.fn(),
  listApprovedOemParts: vi.fn(),
  createRequisitionsForParts: vi.fn(),
  loadOemPartDetail: vi.fn(),
}))
vi.mock('../lib/api/materialLinks', async (orig) => ({ ...(await orig()), ...api }))

import MaterialLinkQueuePanel from '../components/oem/MaterialLinkQueuePanel'
import MaterialLinkHealthCard from '../components/oem/MaterialLinkHealthCard'
import OemApprovedPartsPanel from '../components/oem/OemApprovedPartsPanel'
import { LanguageProvider } from '../contexts/LanguageContext'

const row = (o) => ({
  item_id: 'i1', country: 'UAE', item_code: '450115-O', item_name: 'GREASE MISC ITEMS', canonical_id: 'c1',
  company_sku: '450115-O', canonical_description: 'COMPRESSOR OIL 68', basis: 'exact_code', same_description: false,
  matched_value: '450115-O', alias_verified: null, candidate_count: 1, canonical_taken: false,
  proposal_id: null, proposal_status: null, proposed_by: null, total_count: 2, ...o,
})
const wrap = (el) => render(<MemoryRouter><LanguageProvider>{el}</LanguageProvider></MemoryRouter>)
const can = (c) => ['view', 'engineering_approve'].includes(c)

describe('MaterialLinkQueuePanel', () => {
  beforeEach(() => Object.values(api).forEach((f) => f.mockReset()))

  it('shows the different-description warning and hides Approve on my own proposal', async () => {
    api.loadLinkCandidates.mockResolvedValue({ status: 'ok', total: 2, rows: [
      row(),
      row({ item_id: 'i2', item_code: 'X2', proposal_id: 'p2', proposal_status: 'proposed', proposed_by: 'u1', same_description: true }),
    ] })
    wrap(<MaterialLinkQueuePanel scope={{ country: 'UAE' }} can={can} userId="u1" />)
    await waitFor(() => expect(screen.getByText(/Same code, different description/)).toBeTruthy())
    expect(screen.getByText('Proposed by you')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Withdraw/ })).toBeTruthy()
  })

  it('proposes through the service', async () => {
    api.loadLinkCandidates.mockResolvedValue({ status: 'ok', total: 1, rows: [row({ same_description: true })] })
    api.proposeErpLink.mockResolvedValue({ id: 'p', status: 'proposed' })
    wrap(<MaterialLinkQueuePanel scope={{ country: 'UAE' }} can={can} userId="u1" />)
    fireEvent.click(await screen.findByRole('button', { name: /Propose/ }))
    await waitFor(() => expect(api.proposeErpLink).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/second person must approve/)).toBeTruthy()
  })
})

describe('MaterialLinkHealthCard', () => {
  it('flags a cross-country link', async () => {
    api.loadLinkHealth.mockResolvedValue({ status: 'ok', health: { item_linked_twice: 0, sku_linked_twice_in_country: 0, cross_country_links: 1, oem_cross_country: 0, oem_live_duplicates: 0, links: 3508 } })
    wrap(<MaterialLinkHealthCard />)
    expect(await screen.findByText('Link problems found')).toBeTruthy()
  })
})

describe('OemApprovedPartsPanel', () => {
  it('shows the empty state when nothing is approved', async () => {
    api.listApprovedOemParts.mockResolvedValue({ status: 'ok', rows: [], truncated: false })
    wrap(<OemApprovedPartsPanel scope={{ country: 'KSA' }} can={can} />)
    expect(await screen.findByText(/No OEM link has been approved yet/)).toBeTruthy()
  })
})
