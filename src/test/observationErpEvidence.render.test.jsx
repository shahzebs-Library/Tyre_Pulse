import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const api = vi.hoisted(() => ({
  findObservationErpEvidence: vi.fn(),
  confirmObservationErpLink: vi.fn(),
  rejectObservationErpSuggestion: vi.fn(),
  getObservationErpLink: vi.fn(),
  listObservationErpDecisions: vi.fn(),
  getObservationErpReviewState: vi.fn(),
  isErpReviewNotProvisioned: vi.fn((e) => e?.code === 'PGRST202'),
}))
vi.mock('../lib/api/observationErpEvidence', () => api)

const { default: ObservationErpEvidence } = await import('../components/inspections/ObservationErpEvidence')

const observation = {
  key: 'o1', rawPosition: 'R1Ro', actionRecord: { id: 'a1', status: 'Open' },
  row: { id: 'i1', asset_no: 'TM400', country: 'KSA', inspection_date: '2026-11-10' },
}
const wo = { id: 'w1', work_order_no: 'JC-1', description: 'Tyre change', status: 'Completed', opened_at: '2026-11-12' }
const candidate = (over = {}) => ({
  workOrder: wo, fitments: [], expenses: [], reasons: [], conflicts: [], notes: [],
  status: 'review', eligibleToConfirm: true, relevant: true,
  evidenceSummary: { tyreRows: 1, expenseRows: 0, canonicalPosition: 'RHCO' }, ...over,
})
const ready = (c) => ({ candidates: [c], orphanTyreJobCards: [], evidenceLimited: false, totals: {} })
const show = () => render(<MemoryRouter><ObservationErpEvidence observation={observation} /></MemoryRouter>)

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset?.())
  api.isErpReviewNotProvisioned.mockImplementation((e) => e?.code === 'PGRST202')
  api.getObservationErpReviewState.mockResolvedValue({ provisioned: true, link: null, history: [] })
  api.findObservationErpEvidence.mockResolvedValue(ready(candidate()))
})

describe('ERP evidence panel', () => {
  it('offers review when the wheel is matched and the review is set up', async () => {
    show()
    expect(await screen.findByText('Ready for engineer review')).toBeTruthy()
    expect(screen.getByText('Wheel on this vehicle: RHCO')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review and link job card' })).toBeTruthy()
    expect(screen.queryByText(/not set up yet/)).toBeNull()
  })

  it('shows pending manual review for a position that could not be resolved, with no confirm', async () => {
    api.findObservationErpEvidence.mockResolvedValue(ready(candidate({
      status: 'manual_review', eligibleToConfirm: false,
      notes: ['The ERP numbers the axles differently from this vehicle layout'],
      evidenceSummary: { tyreRows: 1, expenseRows: 0, canonicalPosition: null },
    })))
    show()
    fireEvent.click(await screen.findByText(/Items needing investigation/))
    expect(await screen.findByText('Pending manual review')).toBeTruthy()
    expect(screen.getByText(/stays pending manual review/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review and link job card' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm this job card' })).toBeNull()
  })

  it('says review is not set up, still shows the evidence, and offers no Confirm or Reject', async () => {
    api.getObservationErpReviewState.mockResolvedValue({ provisioned: false, link: null, history: [] })
    show()
    expect(await screen.findByText(/ERP evidence review is not set up yet/)).toBeTruthy()
    expect(await screen.findByText('JC-1')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Review and link job card' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Confirm this job card' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reject with reason' })).toBeNull()
    expect(api.confirmObservationErpLink).not.toHaveBeenCalled()
  })

  it('a confirm that finds the function missing switches to the not set up note, with no raw error', async () => {
    api.confirmObservationErpLink.mockRejectedValue({ code: 'PGRST202', message: 'Could not find the function public.confirm_observation_erp_link' })
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Review and link job card' }))
    fireEvent.change(screen.getByLabelText(/Why does this job card resolve/), { target: { value: 'Same wheel, reviewed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm this job card' }))
    expect(await screen.findByText(/ERP evidence review is not set up yet/)).toBeTruthy()
    expect(screen.queryByText(/Could not find the function/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm this job card' })).toBeNull()
  })

  it('a link state that cannot be read for another reason blocks confirmation and says so', async () => {
    api.getObservationErpReviewState.mockRejectedValue({ code: '42501' })
    show()
    expect(await screen.findByText(/could not be checked, so confirmation is unavailable/)).toBeTruthy()
    expect(screen.queryByText(/not set up yet/)).toBeNull()
  })
})
