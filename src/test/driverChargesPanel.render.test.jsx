import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DriverChargesPanel from '../components/driver/DriverChargesPanel'

const api = vi.hoisted(() => ({ listDriverCharges: vi.fn(), getDriverCharge: vi.fn(), driverChargeSources: vi.fn(), driverChargeCommand: vi.fn() }))
vi.mock('../lib/api/driverCharges', () => api)
vi.mock('../lib/api/driverWorkspace', () => ({ driverWorkspaceOptions: vi.fn(() => Promise.resolve([])) }))
vi.mock('../components/SignaturePad', () => ({ default: ({ onSave }) => <button onClick={() => onSave('data:image/png;base64,' + 'A'.repeat(120))}>Confirm drawing</button> }))

const row = { id: 'c1', charge_no: 'DC-2026-00001', category: 'missing_item', amount: 250, currency: 'SAR', deducted_amount: 0, outstanding: 250, status: 'notified', version: 3 }
const detail = {
  access: 'driver', actions: ['charge_respond'],
  charge: { ...row, basis: 'Fire extinguisher missing at handover.', source_type: 'none', source_summary: {}, created_at: '2026-01-05T10:00:00Z' },
  driver: { id: 'd1', driver_name: 'Driver A' }, evidence: [], signatures: [], decisions: [], appeal: null, instalments: [], events: [],
  statements: { 'deduction-consent-v1': 'I give my written consent for it to be recovered by deduction.', 'receipt-dispute-v1': 'Receipt only.' },
  settings: { cap_pct: 20, appeal_window_days: 7 },
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listDriverCharges.mockResolvedValue({ rows: [row] })
  api.getDriverCharge.mockResolvedValue(detail)
  api.driverChargeCommand.mockResolvedValue({ id: 'c1' })
})

describe('driver charges panel', () => {
  it('lists charges with outstanding per currency and hides issue for the driver', async () => {
    render(<DriverChargesPanel driverId="d1" canIssue={false} />)
    expect(await screen.findByText(/DC-2026-00001/)).toBeInTheDocument()
    expect(screen.getByText('Outstanding SAR 250.00')).toBeInTheDocument()
    expect(screen.queryByText('Issue charge')).not.toBeInTheDocument()
    expect(api.listDriverCharges).toHaveBeenCalledWith(expect.objectContaining({ driver_id: 'd1' }), 0)
  })

  it('driver accepts with the server consent text and a signature against the exact version', async () => {
    render(<DriverChargesPanel driverId="d1" canIssue={false} />)
    fireEvent.click(await screen.findByText(/DC-2026-00001/))
    fireEvent.click(await screen.findByRole('button', { name: 'Respond and sign' }))
    expect(screen.getByText(/written consent/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Read and confirm')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('Draw signature')); fireEvent.click(screen.getByText('Confirm drawing'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(api.driverChargeCommand).toHaveBeenCalled())
    const [action, payload] = api.driverChargeCommand.mock.calls[0]
    expect(action).toBe('charge_respond')
    expect(payload).toMatchObject({ driver_id: 'd1', charge_id: 'c1', version: 3, response: 'accept', statement_version: 'deduction-consent-v1', acknowledged: true })
  })

  it('shows a retry on load failure', async () => {
    api.listDriverCharges.mockRejectedValueOnce(new Error('boom'))
    render(<DriverChargesPanel driverId="d1" canIssue />)
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
