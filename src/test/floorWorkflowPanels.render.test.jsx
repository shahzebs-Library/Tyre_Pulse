import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({
  listPutawayCandidates: vi.fn(),
  startPutaway: vi.fn(),
  finishPutaway: vi.fn(),
  loadPickList: vi.fn(),
  confirmPick: vi.fn(),
  loadHandover: vi.fn(),
}))
vi.mock('../lib/api/floorWorkflow', () => api)
vi.mock('../lib/exportUtils', () => ({ exportToExcel: vi.fn(), exportToPdf: vi.fn(), reportFileName: (...p) => p.join(' ') }))

import { LanguageProvider } from '../contexts/LanguageContext'
import PutawayPanel from '../components/inventory/PutawayPanel'
import PickingPanel from '../components/inventory/PickingPanel'
import HandoverPanel from '../components/inventory/HandoverPanel'

const wrap = (ui) => render(<LanguageProvider>{ui}</LanguageProvider>)
const yes = () => true
const scope = { country: 'KSA', site: 'all' }

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()) })

describe('floor workflow panels', () => {
  it('put-away hides itself behind the transfer permission', () => {
    wrap(<PutawayPanel scope={scope} can={(c) => c !== 'transfer'} />)
    expect(screen.getByText(/needs the inventory transfer permission/i)).toBeTruthy()
    expect(api.listPutawayCandidates).not.toHaveBeenCalled()
  })

  it('put-away lists receiving-area stock and runs dispatch then receive', async () => {
    api.listPutawayCandidates.mockResolvedValue({
      status: 'ok', total: 1,
      rows: [{ id: 'st1', item_code: 'TYR-1', description: 'Tyre', site: 'NHC', country: 'KSA', location_id: 'wh', location_code: 'WH', qty_on_hand: 5, qty_reserved: 0 }],
      locations: [
        { id: 'wh', code: 'WH', location_type: 'warehouse', site: 'NHC', country: 'KSA', active: true },
        { id: 'b1', code: 'B01', parent_id: 'wh', location_type: 'bin', site: 'NHC', country: 'KSA', active: true },
      ],
    })
    api.startPutaway.mockResolvedValue({ transferId: 't1', ref: 'TRF-1' })
    api.finishPutaway.mockResolvedValue({ status: 'completed' })
    wrap(<PutawayPanel scope={scope} can={yes} />)
    fireEvent.click(await screen.findByText('TYR-1'))
    fireEvent.change(screen.getByLabelText('Bin or shelf'), { target: { value: 'b1' } })
    fireEvent.click(screen.getByRole('button', { name: /Put away$/ }))
    await waitFor(() => expect(api.finishPutaway).toHaveBeenCalledWith('t1', expect.any(String)))
    expect(api.startPutaway.mock.calls[0][0]).toMatchObject({ targetId: 'b1', qty: 5 })
    expect(await screen.findByText(/Put away into WH > B01/)).toBeTruthy()
  })

  it('picking builds the list and confirms a pick through the issue', async () => {
    api.loadPickList.mockResolvedValue({
      status: 'ok', jobCard: 'JC1', workOrder: null,
      lines: [{ key: 'r:r1', source: 'reservation', reservationId: 'r1', stockId: 'st1', itemCode: 'A', site: 'NHC', locationPath: 'B01', qty: 2, onHand: 4 }],
    })
    api.confirmPick.mockResolvedValue({ movement_id: 'm1' })
    wrap(<PickingPanel scope={scope} can={yes} />)
    fireEvent.change(screen.getByLabelText('Job card number'), { target: { value: 'JC1' } })
    fireEvent.click(screen.getByRole('button', { name: /Build pick list/ }))
    fireEvent.change(await screen.findByLabelText(/Handed to/), { target: { value: 'Tech One' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirm pick/ }))
    await waitFor(() => expect(api.confirmPick).toHaveBeenCalled())
    expect(api.confirmPick.mock.calls[0][0]).toMatchObject({ reservationId: 'r1', qty: 2, sourceDocType: 'job_card', sourceDocId: 'JC1' })
    expect(api.confirmPick.mock.calls[0][0].reason).toMatch(/Handed to: Tech One/)
  })

  it('picking without the issue permission shows no confirm button', async () => {
    api.loadPickList.mockResolvedValue({
      status: 'ok', jobCard: 'JC1', workOrder: null,
      lines: [{ key: 'r:r1', source: 'reservation', reservationId: 'r1', stockId: 'st1', itemCode: 'A', site: 'NHC', locationPath: 'B01', qty: 2 }],
    })
    wrap(<PickingPanel scope={scope} can={(c) => c !== 'issue'} />)
    fireEvent.change(screen.getByLabelText('Job card number'), { target: { value: 'JC1' } })
    fireEvent.click(screen.getByRole('button', { name: /Build pick list/ }))
    expect(await screen.findByText(/needs the inventory issue permission/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Confirm pick/ })).toBeNull()
  })

  it('handover shows who gave and who received, and flags a missing receiver', async () => {
    api.loadHandover.mockResolvedValue({
      status: 'ok', jobCard: 'JC1', issuedCount: 2, missingReceiver: 1,
      rows: [
        { id: 'm1', kind: 'Issued', itemCode: 'A', qty: 2, givenBy: 'Keeper', receivedBy: 'Tech One', postedAt: null },
        { id: 'm2', kind: 'Issued', itemCode: 'A', qty: 1, givenBy: 'Keeper', receivedBy: null, postedAt: null },
      ],
      items: [{ itemCode: 'A', issued: 3, returned: 0, net: 3 }],
    })
    wrap(<HandoverPanel scope={scope} can={yes} />)
    fireEvent.change(screen.getByLabelText('Job card number'), { target: { value: 'JC1' } })
    fireEvent.click(screen.getByRole('button', { name: /Show handover/ }))
    expect(await screen.findByText('Tech One')).toBeTruthy()
    expect(screen.getByText(/do not name who received/)).toBeTruthy()
  })
})
