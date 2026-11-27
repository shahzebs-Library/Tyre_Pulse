import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const api = vi.hoisted(() => ({
  findObservationErpEvidence: vi.fn(),
  confirmObservationErpLink: vi.fn(),
  rejectObservationErpSuggestion: vi.fn(),
  getObservationErpLink: vi.fn(),
  listObservationErpDecisions: vi.fn(),
  getObservationErpReviewState: vi.fn(),
  isErpReviewNotProvisioned: vi.fn((e) => e?.code === 'PGRST202'),
  ERP_DECISIONS_UNAVAILABLE_MESSAGE: 'ERP confirmation is not available yet. Evidence can be reviewed, but a decision cannot be recorded until the database update is approved.',
  erpDecisionMessage: vi.fn(() => 'The server found no tyre movement on this job card for the inspected wheel. The job card was not linked.'),
}))
vi.mock('../lib/api/observationErpEvidence', () => api)

const { default: ObservationErpEvidence } = await import('../components/inspections/ObservationErpEvidence')
const { LanguageProvider, useLanguage } = await import('../contexts/LanguageContext')

// The inspections namespace loads lazily; warm it once so synchronous queries
// see the real English strings rather than the humanised placeholder.
function WarmLocale() { const { t } = useLanguage(); return <span>{t('inspections.erp.refresh')}</span> }
beforeAll(async () => { render(<LanguageProvider><WarmLocale /></LanguageProvider>); await screen.findByText('Refresh'); cleanup() })

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
const OK = { available: true, reason: 'ok', canReview: true, canRequestException: true, canApproveException: false }
const show = () => render(<MemoryRouter><ObservationErpEvidence observation={observation} /></MemoryRouter>)

beforeEach(() => {
  Object.values(api).forEach((f) => f?.mockReset?.())
  api.isErpReviewNotProvisioned.mockImplementation((e) => e?.code === 'PGRST202')
  api.erpDecisionMessage.mockImplementation(() => 'The server found no tyre movement on this job card for the inspected wheel. The job card was not linked.')
  api.getObservationErpReviewState.mockResolvedValue({ provisioned: true, link: null, history: [], decisions: OK })
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
    api.getObservationErpReviewState.mockResolvedValue({ provisioned: false, link: null, history: [], decisions: OK })
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

  it('when the server refuses a confirm the screen offered, its plain message is shown and nothing is linked', async () => {
    api.confirmObservationErpLink.mockRejectedValue({ code: 'PT409', message: 'This record changed since you opened it.' })
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Review and link job card' }))
    fireEvent.change(screen.getByLabelText(/Why does this job card resolve/), { target: { value: 'Same wheel, reviewed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm this job card' }))
    expect(await screen.findByText(/found no tyre movement on this job card/)).toBeTruthy()
    expect(screen.queryByText(/record changed/)).toBeNull()
    expect(screen.queryByText(/Linked job card/)).toBeNull()
    expect(api.getObservationErpLink).not.toHaveBeenCalled()
  })

  it.each([
    ['old database', { available: false, reason: 'old_database' }],
    ['version mismatch', { available: false, reason: 'version_mismatch', databaseVersion: 'position-service-1' }],
    ['availability unknown', { available: false, reason: 'unknown' }],
  ])('%s: evidence is shown, the agreed message is shown, no Confirm or Reject is offered', async (_n, decisions) => {
    api.getObservationErpReviewState.mockResolvedValue({ provisioned: true, link: null, history: [], decisions })
    show()
    expect(await screen.findByText('ERP confirmation is not available yet. Evidence can be reviewed, but a decision cannot be recorded until the database update is approved.')).toBeTruthy()
    expect(await screen.findByText('JC-1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review and link job card' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm this job card' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reject with reason' })).toBeNull()
  })

  it('no decision is offered while the availability is still being checked', async () => {
    api.getObservationErpReviewState.mockReturnValue(new Promise(() => {}))
    show()
    expect(await screen.findByText('JC-1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review and link job card' })).toBeNull()
  })

  it('serial only evidence shows that a serial alone does not confirm, with no Confirm', async () => {
    api.findObservationErpEvidence.mockResolvedValue(ready(candidate({
      status: 'manual_review', eligibleToConfirm: false, serialExceptionPossible: true,
      evidenceSummary: { tyreRows: 1, expenseRows: 0, canonicalPosition: null, serialOnly: true },
    })))
    show()
    fireEvent.click(await screen.findByText(/Items needing investigation/))
    expect(await screen.findByText(/A serial alone does not confirm the work/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review and link job card' })).toBeNull()
  })

  it('a link state that cannot be read for another reason blocks confirmation and says so', async () => {
    api.getObservationErpReviewState.mockRejectedValue({ code: '42501' })
    show()
    expect(await screen.findByText(/could not be checked, so confirmation is unavailable/)).toBeTruthy()
    expect(screen.queryByText(/not set up yet/)).toBeNull()
  })

  it('production today (interim lock, rules function missing): plain status note, evidence still shown, no decision buttons', async () => {
    api.getObservationErpReviewState.mockResolvedValue({ provisioned: true, link: null, history: [],
      decisions: { available: false, reason: 'old_database', canReview: false, canRequestException: false, canApproveException: false } })
    show()
    expect(await screen.findByText(api.ERP_DECISIONS_UNAVAILABLE_MESSAGE)).toBeTruthy()
    expect(await screen.findByText('JC-1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review and link job card' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm this job card' })).toBeNull()
    expect(screen.queryByText(/permission denied|42501|PGRST202/i)).toBeNull()
  })

  it('a confirm refused with 42501 (EXECUTE withheld) turns into the plain status note, never a raw error', async () => {
    api.confirmObservationErpLink.mockRejectedValue({ code: '42501', message: 'permission denied for function observation_erp_decide' })
    api.erpDecisionMessage.mockImplementation(() => api.ERP_DECISIONS_UNAVAILABLE_MESSAGE)
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Review and link job card' }))
    fireEvent.change(screen.getByLabelText(/Why does this job card resolve/), { target: { value: 'Same wheel, reviewed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm this job card' }))
    expect(await screen.findByText(api.ERP_DECISIONS_UNAVAILABLE_MESSAGE)).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Confirm this job card' })).toBeNull())
    expect(screen.queryByText(/permission denied|42501/i)).toBeNull()
    expect(api.getObservationErpLink).not.toHaveBeenCalled()
  })
})
