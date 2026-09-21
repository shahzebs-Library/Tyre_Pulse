import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DriverFineRegister from '../components/driver/DriverFineRegister'

const api = vi.hoisted(() => ({ loadDriverFineRegister: vi.fn(), runDriverFineReminders: vi.fn() }))
const reports = vi.hoisted(() => ({ exportDriverFineRegisterExcel: vi.fn(), exportDriverFineRegisterPdf: vi.fn() }))
vi.mock('../lib/api/driverWorkspace', () => api)
vi.mock('../lib/driverFineReports', () => reports)

const row = { id: 'fine-1', driver_id: 'driver-1', notice_reference: 'N-1', authority: 'Traffic authority', driver_name: 'Driver One', employee_id: 'E-1', asset_no: 'TRK-1', currency: 'SAR', amount: 500, balance: 500, status: 'open', review_stage: 'supervisor', due_date: '2026-09-20', overdue: true }

beforeEach(() => {
  vi.clearAllMocks()
  api.loadDriverFineRegister.mockResolvedValue({ rows: [row] })
  api.runDriverFineReminders.mockResolvedValue({ sent: 2, skipped: 1 })
})

describe('driver fine register', () => {
  it('applies staff filters and opens the selected driver', async () => {
    const open = vi.fn()
    render(<DriverFineRegister canRunReminders onOpenDriver={open} />)
    expect(await screen.findByText('N-1')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Review stage'), { target: { value: 'supervisor' } })
    fireEvent.click(screen.getByLabelText('Overdue only'))
    fireEvent.click(screen.getByText('Apply filters'))
    await waitFor(() => expect(api.loadDriverFineRegister).toHaveBeenLastCalledWith(expect.objectContaining({ review_stage: 'supervisor', overdue: true }), 0))
    fireEvent.click(screen.getByText('Open case'))
    expect(open).toHaveBeenCalledWith('driver-1')
  })

  it('runs idempotent reminder dispatch and reports the result', async () => {
    render(<DriverFineRegister canRunReminders onOpenDriver={vi.fn()} />)
    await screen.findByText('N-1')
    fireEvent.click(screen.getByText('Run due reminders'))
    expect(await screen.findByText('Reminder run complete: 2 sent, 1 skipped.')).toBeInTheDocument()
  })
})
