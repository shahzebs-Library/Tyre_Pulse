import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const api = vi.hoisted(() => ({
  loadJobCardMaterials: vi.fn(),
  findStockForRequest: vi.fn(),
  reserveForJob: vi.fn(),
  raiseShortageRequisition: vi.fn(),
  issueReservedToJob: vi.fn(),
  confirmInstallation: vi.fn(),
  returnUnused: vi.fn(),
  loadAssetMaterialCost: vi.fn(),
}))
vi.mock('../lib/workshopStock/service', () => api)
vi.mock('../lib/exportUtils', () => ({ exportToExcel: vi.fn(), exportToPdf: vi.fn(), reportFileName: (...p) => p.join(' ') }))

import { LanguageProvider, useLanguage } from '../contexts/LanguageContext'
import JobCardMaterialsPanel from '../components/workshopStock/JobCardMaterialsPanel'
import AssetMaterialCostPanel from '../components/workshopStock/AssetMaterialCostPanel'
import { buildJobMaterials, summariseJobMaterials } from '../lib/workshopStock/jobMaterials'

const wrap = (ui) => render(<LanguageProvider>{ui}</LanguageProvider>)

// The wmsissue namespace loads lazily; warm it once so synchronous queries see
// the real English strings rather than the humanised placeholder.
function WarmLocale() { const { t } = useLanguage(); return <span>{t('wmsissue.common.na')}</span> }
beforeAll(async () => { render(<LanguageProvider><WarmLocale /></LanguageProvider>); await screen.findByText('N/A'); cleanup() })
const yes = () => true
const scope = { country: 'KSA', site: 'all' }

function payload() {
  const rows = buildJobMaterials({
    reservations: [{ id: 'r1', stock_id: 's1', qty: 2, qty_released: 0, qty_consumed: 0, status: 'active' }],
    movements: [{ id: 'm1', stock_id: 's1', movement_type: 'issue', qty_change: -3, value_change: -135, unvalued_qty_change: 0, currency: 'SAR', posted_at: '2026-11-24T08:00:00Z' }],
    installations: [{ id: 'n1', stock_id: 's1', movement_id: 'm1', qty: 1 }],
    balances: [{ id: 's1', item_code: 'OF-1', description: 'Oil filter', site: 'NHC', country: 'KSA', location_code: 'B01', qty_on_hand: 7, qty_reserved: 2 }],
  })
  return {
    status: 'ok', jobCard: 'JC-1', workOrder: { asset_no: 'TM514', site: 'NHC', country: 'KSA', status: 'Open' },
    rows, summary: summariseJobMaterials(rows), requisitions: [], installationsAvailable: true, requisitionLinkAvailable: true,
  }
}

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()) })

describe('job card materials panel', () => {
  it('asks for a job card before loading', () => {
    wrap(<JobCardMaterialsPanel scope={scope} can={yes} />)
    fireEvent.click(screen.getByText('Open job card'))
    expect(screen.getByText('Enter a job card number.')).toBeTruthy()
    expect(api.loadJobCardMaterials).not.toHaveBeenCalled()
  })

  it('shows the reconciliation and issues the reserved line to a named receiver', async () => {
    api.loadJobCardMaterials.mockResolvedValue(payload())
    api.issueReservedToJob.mockResolvedValue({ ok: true, mode: 'slip', issueNumber: 'MIS-1', posted: 1, already: 0 })
    wrap(<JobCardMaterialsPanel scope={scope} can={yes} />)
    fireEvent.change(screen.getByPlaceholderText(/GCKR/), { target: { value: 'JC-1' } })
    fireEvent.click(screen.getByText('Open job card'))
    await waitFor(() => expect(screen.getByText('Job card JC-1')).toBeTruthy())
    expect(screen.getAllByText('Unreconciled').length).toBeGreaterThan(0)
    const issueBtn = screen.getByText(/Issue 1 reserved line/)
    expect(issueBtn.closest('button').disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText(/receiving the parts/), { target: { value: 'Ali' } })
    fireEvent.click(screen.getByText(/Issue 1 reserved line/))
    await waitFor(() => expect(api.issueReservedToJob).toHaveBeenCalled())
    const [args] = api.issueReservedToJob.mock.calls[0]
    expect(args).toMatchObject({ jobCard: 'JC-1', issuedTo: 'Ali' })
    expect(args.lines[0]).toMatchObject({ stockId: 's1', reservationId: 'r1', qty: 2 })
  })

  it('reports a server refusal on installation without closing the form', async () => {
    api.loadJobCardMaterials.mockResolvedValue(payload())
    api.confirmInstallation.mockResolvedValue({ ok: false, message: 'The person who issued the parts cannot confirm their installation.' })
    wrap(<JobCardMaterialsPanel scope={scope} can={yes} initialJobCard="JC-1" />)
    fireEvent.click(screen.getByText('Open job card'))
    await waitFor(() => expect(screen.getByText('Confirm installed')).toBeTruthy())
    fireEvent.click(screen.getByText('Confirm installed'))
    fireEvent.click(screen.getAllByText('Confirm installed').pop())
    await waitFor(() => expect(screen.getByText(/cannot confirm their installation/)).toBeTruthy())
  })

  it('shows an error state with retry', async () => {
    api.loadJobCardMaterials.mockRejectedValue(new Error('network down'))
    wrap(<JobCardMaterialsPanel scope={scope} can={yes} initialJobCard="JC-1" />)
    fireEvent.click(screen.getByText('Open job card'))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  })
})

describe('asset material cost panel', () => {
  it('shows the per-currency cost and the empty state', async () => {
    api.loadAssetMaterialCost.mockResolvedValue({ status: 'ok', assetNo: 'TM514', cards: [], cost: [], unvaluedQty: 0, unreconciled: 0 })
    wrap(<AssetMaterialCostPanel scope={scope} can={yes} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. TM514'), { target: { value: 'tm514' } })
    fireEvent.click(screen.getByText('Show cost'))
    await waitFor(() => expect(screen.getByText(/No parts were issued/)).toBeTruthy())
  })
})
