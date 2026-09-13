import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DriverWorkspace from '../pages/DriverWorkspace'
import { validateFineResponse, signatureImage } from '../lib/driverWorkspace'

const api = vi.hoisted(() => ({ loadDriverWorkspace: vi.fn(), driverWorkspaceCommand: vi.fn(), driverWorkspaceOptions: vi.fn(), fineSignature: vi.fn(), evidenceUrl: vi.fn(), uploadFineEvidence: vi.fn() }))
vi.mock('../lib/api/driverWorkspace', () => api)
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'en', isRTL: false }) }))
vi.mock('../components/ui/PageHeader', () => ({ default: ({ title }) => <h1>{title}</h1> }))
vi.mock('../components/SignaturePad', () => ({ default: ({ onSave }) => <button onClick={() => onSave('data:image/png;base64,signature')}>Confirm drawing</button> }))
const fine = { id: 'fine-1', driver_id: 'driver-1', notice_reference: 'N1', authority: 'Authority', amount: 500, currency: 'SAR', paid_amount: 0, status: 'open', response_status: 'awaiting_response', version: 1, incident_at: '2026-01-01T08:00:00Z', responses: [], evidence: [] }
const data = { driver: { id: 'driver-1', driver_name: 'Driver', driver_id: 'EMP1' }, can_respond: true, can_review: false, can_manage: false, fines: [fine], balances: [], records: [], assignments: [], events: [], work: [] }
beforeEach(() => { vi.clearAllMocks(); api.loadDriverWorkspace.mockResolvedValue(data); api.driverWorkspaceOptions.mockResolvedValue([]); api.driverWorkspaceCommand.mockResolvedValue({}) })

describe('driver workspace', () => {
  it('shows the driver response and withholds staff controls', async () => {
    render(<MemoryRouter initialEntries={['/driver-workspace?driver=driver-1']}><DriverWorkspace /></MemoryRouter>)
    expect(await screen.findByText('Acknowledge and respond')).toBeInTheDocument()
    expect(screen.queryByText('Issue traffic fine')).not.toBeInTheDocument()
    expect(screen.queryByText('Review / record payment')).not.toBeInTheDocument()
  })
  it('submits the signed resolution against the exact notice version', async () => {
    render(<MemoryRouter initialEntries={['/driver-workspace?driver=driver-1']}><DriverWorkspace /></MemoryRouter>)
    fireEvent.click(await screen.findByText('Acknowledge and respond'))
    fireEvent.change(screen.getByLabelText('Preferred resolution'), { target: { value: 'company_recovery' } })
    fireEvent.change(screen.getByLabelText('Explanation / proposed arrangement'), { target: { value: 'Please arrange company payment for review' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('Draw signature')); fireEvent.click(screen.getByText('Confirm drawing'))
    fireEvent.click(screen.getByText('Submit'))
    await waitFor(() => expect(api.driverWorkspaceCommand).toHaveBeenCalledWith('respond_fine', expect.objectContaining({ driver_id: 'driver-1', fine_id: 'fine-1', version: 1, resolution: 'company_recovery', acknowledged: true, statement_version: 'receipt-v1', statement_language: 'en', signature: 'data:image/png;base64,signature' }), expect.any(String)))
  })
  it('shows an unavailable state rather than claiming an empty successful workspace', async () => {
    api.loadDriverWorkspace.mockRejectedValue(new Error('Unavailable'))
    render(<MemoryRouter><DriverWorkspace /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('No fines recorded for this driver.')).not.toBeInTheDocument()
  })
  it('requires payment references, explanations and acknowledgment', () => {
    const v = { resolution: 'already_paid', explanation: 'Paid today', signature: 'signed', acknowledged: true }
    expect(validateFineResponse(v)).toContain('payment reference')
    expect(validateFineResponse({ ...v, payment_reference: 'R1', acknowledged: false })).toBeTruthy()
    expect(validateFineResponse({ ...v, payment_reference: 'REF1' })).toBeNull()
    expect(validateFineResponse({ ...v, resolution: 'instalments' })).toBeNull()
    expect(signatureImage('<svg />')).toMatch(/^data:image\/svg\+xml/)
  })
})
