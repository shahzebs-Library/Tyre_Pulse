import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
const mocks = vi.hoisted(() => ({ context: vi.fn(), request: vi.fn(), execute: vi.fn() }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'actor', org_id: 'org' } }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }))
vi.mock('../lib/api/tyreChangeApprovals', async importOriginal => ({ ...await importOriginal(), getTyreChangeApprovalContext: mocks.context, requestTyreChangeApproval: mocks.request, executeApprovedTyreChange: mocks.execute }))
vi.mock('../components/workflow/ApprovalReview', () => ({ default: ({ entityId }) => <p>Review request {entityId}</p> }))
import TyreChangeApprovals from '../components/workflow/TyreChangeApprovals'

const props = { asset: { id: 'vehicle', asset_no: 'TM1' }, tyres: [{ id: 'tyre', serial_no: 'OLD', position: 'LF', status: 'Active' }], positions: [{ code: 'LF' }] }
const context = { mode: 'enforced', can_submit: true, vehicle: props.asset, requests: [] }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.context.mockResolvedValue(context) })
afterEach(cleanup)
async function fill() {
  fireEvent.click(await screen.findByRole('button', { name: 'Request tyre change' }))
  fireEvent.change(screen.getByLabelText('Current tyre'), { target: { value: 'tyre' } })
  fireEvent.change(screen.getByLabelText('Replacement serial'), { target: { value: 'NEW' } })
  fireEvent.change(screen.getByLabelText('Reason for the change'), { target: { value: 'Worn tread' } })
}
describe('pre-execution tyre workflow', () => {
  it('fails closed on denied context and only absent RPC permits legacy actions', async () => {
    mocks.context.mockRejectedValue({ code: '42501', message: 'Denied' })
    const mode = vi.fn()
    const view = render(<TyreChangeApprovals {...props} onModeChange={mode} />)
    await screen.findByRole('alert')
    expect(mode).toHaveBeenLastCalledWith('error')
    expect(screen.queryByRole('button', { name: 'Request tyre change' })).not.toBeInTheDocument()
    view.unmount()
    mocks.context.mockRejectedValue({ code: 'PGRST202' })
    render(<TyreChangeApprovals {...props} onModeChange={mode} />)
    await waitFor(() => expect(mode).toHaveBeenLastCalledWith('legacy'))
  })
  it('persists the exact request for a lost-response retry after remount without executing tyres', async () => {
    mocks.request.mockRejectedValueOnce(new Error('Lost connection')).mockResolvedValueOnce({ id: 'request' })
    const view = render(<TyreChangeApprovals {...props} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Submit for approval' }))
    await screen.findAllByText('Lost connection')
    const intent = mocks.request.mock.calls[0][0]
    expect(intent.p_change).toMatchObject({ action: 'replace', removed_record_id: 'tyre', position: 'LF', serial_no: 'NEW' })
    view.unmount()
    render(<TyreChangeApprovals {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Retry saved operation' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry saved operation' }).at(-1))
    await screen.findByText(/Request submitted/)
    expect(mocks.request.mock.calls[1][0]).toEqual(intent)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
  it('reviews the request id and retries execution using one durable operation id', async () => {
    mocks.context.mockResolvedValue({ ...context, requests: [{ id: 'request-42', action: 'remove', status: 'approved', can_execute: true }] })
    mocks.execute.mockRejectedValueOnce(new Error('Lost connection')).mockResolvedValueOnce({ ok: true })
    const done = vi.fn()
    render(<TyreChangeApprovals {...props} onExecuted={done} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Review request' }))
    expect(screen.getByText('Review request request-42')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Execute approved change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm execution' }))
    await screen.findAllByText('Lost connection')
    expect(done).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm execution' }))
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1))
    expect(mocks.execute.mock.calls[1][0]).toEqual(mocks.execute.mock.calls[0][0])
    expect(mocks.execute.mock.calls[0][0].p_request_id).toBe('request-42')
  })
})
