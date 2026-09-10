import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ get: vi.fn(), request: vi.fn() }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u', org_id: 'org' } }) }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }))
vi.mock('../lib/api/workOrderApprovals', () => ({ getWorkOrderApproval: h.get, requestWorkOrderApproval: h.request }))
vi.mock('../lib/api/approvalDecisions', () => ({ isApprovalReviewUnavailable: error => error?.code === 'PGRST202' }))
vi.mock('../components/workflow/ApprovalReview', () => ({ default: ({ entityType, entityId }) => <p>Review {entityType}:{entityId}</p> }))
import WorkOrderApprovalGate from '../components/workorders/WorkOrderApprovalGate'
const data = { mode: 'enforced', can_submit: true, can_execute: false, request_id: null, review: null, work_order: { id: 'wo1' } }
beforeEach(() => { vi.clearAllMocks(); h.get.mockResolvedValue(data) })
it('fails closed for unknown execution authority instead of treating errors as legacy', async () => {
  h.get.mockRejectedValue({ code: '42501' }); const onGateChange = vi.fn()
  render(<WorkOrderApprovalGate orderId="wo1" onGateChange={onGateChange} legacy={<p>Legacy</p>} />)
  await screen.findByRole('alert')
  expect(screen.queryByText('Legacy')).not.toBeInTheDocument()
  expect(onGateChange).toHaveBeenLastCalledWith({ canExecute: false })
})
it('uses the request ID for review and allows execution after approval', async () => {
  h.get.mockResolvedValue({ ...data, can_submit: false, can_execute: true, request_id: 'request1', review: { status: 'approved' } })
  const onGateChange = vi.fn()
  render(<WorkOrderApprovalGate orderId="wo1" onGateChange={onGateChange} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Review approval request' }))
  expect(screen.getByText('Review work_order:request1')).toBeInTheDocument()
  expect(onGateChange).toHaveBeenLastCalledWith({ canExecute: true, lockEdits: false })
})
it('keeps one operation ID and exact reason after a submission timeout', async () => {
  h.request.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({ ...data, can_submit: false, request_id: 'r1', review: { status: 'pending' } })
  render(<WorkOrderApprovalGate orderId="wo1" />)
  fireEvent.change(await screen.findByLabelText('Submission reason'), { target: { value: 'Repair safely' } })
  fireEvent.click(screen.getByRole('button', { name: 'Request approval' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Retry the same request' }))
  await waitFor(() => expect(h.request).toHaveBeenCalledTimes(2))
  expect(h.request.mock.calls[1]).toEqual(h.request.mock.calls[0])
})
it('preserves the legacy panel only for an explicit absent RPC', async () => {
  h.get.mockRejectedValue({ code: 'PGRST202' })
  render(<WorkOrderApprovalGate orderId="wo1" legacy={<p>Legacy</p>} />)
  expect(await screen.findByText('Legacy')).toBeInTheDocument()
})
