import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DriverChargesPanel from '../components/driver/DriverChargesPanel'

const api = vi.hoisted(() => ({ listDriverCharges: vi.fn(), getDriverCharge: vi.fn(), driverChargeSources: vi.fn(), driverChargeCommand: vi.fn() }))
vi.mock('../lib/api/driverCharges', () => api)
vi.mock('../lib/api/driverWorkspace', () => ({ driverWorkspaceOptions: vi.fn(() => Promise.resolve([])) }))
vi.mock('../lib/storageRefs', () => ({ resolveStorageUrlMap: vi.fn(refs => Promise.resolve(Object.fromEntries(refs.map(r => [r, `https://signed.example/${r.length}`])))) }))
vi.mock('../components/SignaturePad', () => ({ default: ({ onSave }) => <button onClick={() => onSave('data:image/png;base64,' + 'A'.repeat(120))}>Confirm drawing</button> }))

const row = { id: 'c1', charge_no: 'DC-2026-00001', category: 'missing_item', amount: 250, currency: 'SAR', deducted_amount: 0, outstanding: 250, status: 'notified', version: 3 }
const detail = {
  access: 'driver', actions: ['charge_respond'],
  charge: { ...row, basis: 'Fire extinguisher missing at handover.', source_type: 'none', source_summary: {}, created_at: '2026-01-05T10:00:00Z' },
  driver: { id: 'd1', driver_name: 'Driver A' }, evidence: [], signatures: [], decisions: [], appeal: null, instalments: [], events: [],
  statements: {
    'deduction-consent-v2': { en: 'I agree that the company may take this amount from my salary.', ar: 'أوافق على أن تخصم الشركة هذا المبلغ من راتبي.', ur: 'میں اجازت دیتا ہوں کہ کمپنی یہ رقم میری تنخواہ سے کاٹے۔' },
    'receipt-dispute-v2': { en: 'Receipt only.', ar: 'استلام فقط.', ur: 'صرف وصولی۔' },
  },
  settings: { cap_pct: 20, appeal_window_days: 7, country_rule: { rule: 'ksa_labour_law', statutory: true }, objection_last_day: null },
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
    expect(screen.getByText(/take this amount from my salary/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Read and confirm')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('Draw signature')); fireEvent.click(screen.getByText('Confirm drawing'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(api.driverChargeCommand).toHaveBeenCalled())
    const [action, payload] = api.driverChargeCommand.mock.calls[0]
    expect(action).toBe('charge_respond')
    expect(payload).toMatchObject({ driver_id: 'd1', charge_id: 'c1', version: 3, response: 'accept', statement_version: 'deduction-consent-v2', statement_language: 'en', acknowledged: true })
  })

  it('the driver sees the photos and can sign the statement in Urdu', async () => {
    api.getDriverCharge.mockResolvedValue({ ...detail, evidence: [{ id: 'e1', kind: 'photo', ref: 'tp-storage://tyre-photos/modules/driver-charge/a/1.jpg', label: 'Broken mirror' }] })
    render(<DriverChargesPanel driverId="d1" canIssue={false} />)
    fireEvent.click(await screen.findByText(/DC-2026-00001/))
    fireEvent.click(await screen.findByRole('button', { name: 'Respond and sign' }))
    expect((await screen.findAllByAltText('Broken mirror')).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Statement language'), { target: { value: 'ur' } })
    const statement = screen.getByText('میں اجازت دیتا ہوں کہ کمپنی یہ رقم میری تنخواہ سے کاٹے۔')
    expect(statement).toHaveAttribute('dir', 'rtl')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('Draw signature')); fireEvent.click(screen.getByText('Confirm drawing'))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(api.driverChargeCommand).toHaveBeenCalled())
    expect(api.driverChargeCommand.mock.calls[0][1]).toMatchObject({ statement_version: 'deduction-consent-v2', statement_language: 'ur' })
  })

  it('shows why a deduction cannot be scheduled instead of a Schedule button', async () => {
    api.getDriverCharge.mockResolvedValue({ ...detail, access: 'finance', actions: ['charge_schedule', 'charge_waive'],
      charge: { ...detail.charge, status: 'finance_approved', driver_response: 'disputed', country: 'KSA', category: 'other' },
      settings: { ...detail.settings, schedule_block: { code: 'consent_required', article: '92', message: 'Saudi Labour Law (Article 92): needs written consent.' } } })
    render(<DriverChargesPanel driverId="d1" canIssue={false} />)
    fireEvent.click(await screen.findByText(/DC-2026-00001/))
    expect(await screen.findByText(/Article 92/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Schedule deduction' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Waive charge' })).toBeInTheDocument()
  })

  it('shows a retry on load failure', async () => {
    api.listDriverCharges.mockRejectedValueOnce(new Error('boom'))
    render(<DriverChargesPanel driverId="d1" canIssue />)
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
