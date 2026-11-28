import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import WashRecordViewer from '../components/washing/WashRecordViewer'

const h = vi.hoisted(() => ({ verify: vi.fn(async () => ({ ok: true })) }))
vi.mock('../lib/api/washRecords', () => ({
  listWashCorrections: vi.fn(async () => []),
  verifyWashRecord: h.verify,
}))
vi.mock('../lib/storageRefs', () => ({ resolveStorageUrl: vi.fn(async () => null) }))

const row = {
  id: 'w1', asset_no: 'TM514', wash_date: '2026-11-27', created_by: 'driver-1',
  verification_status: 'pending',
  wash_details: { version: 1, chemical_status: 'none', chemicals: [], areas: ['engine_bay'], views: ['left'] },
}

describe('wash supervisor verification on the web', () => {
  it('a supervisor verifies a driver wash and sees the next due date', async () => {
    const onVerified = vi.fn()
    render(<WashRecordViewer row={row} onClose={() => {}} profile={{ id: 'sup-1', role: 'Fleet Supervisor' }} onVerified={onVerified} />)
    expect(screen.getByTestId('wash-verification')).toHaveTextContent('Waiting for a supervisor to verify')
    expect(screen.getByTestId('wash-next-due')).toHaveTextContent('Next wash due 2026-12-04')
    expect(screen.getByText('Engine bay')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Verify this wash' }))
    await waitFor(() => expect(h.verify).toHaveBeenCalledWith('w1', ''))
    await waitFor(() => expect(screen.getByTestId('wash-verification')).toHaveTextContent('Wash verified'))
    expect(onVerified).toHaveBeenCalled()
  })

  it('the driver who logged it gets no verify button', () => {
    render(<WashRecordViewer row={row} onClose={() => {}} profile={{ id: 'driver-1', role: 'Fleet Supervisor' }} />)
    expect(screen.queryByRole('button', { name: 'Verify this wash' })).not.toBeInTheDocument()
    expect(screen.getByText(/another supervisor must verify/)).toBeInTheDocument()
  })

  it('a supervisor entry needs no check', () => {
    render(<WashRecordViewer row={{ ...row, verification_status: 'not_required', verified_by: 'driver-1' }} onClose={() => {}} profile={{ id: 'sup-1', role: 'Manager' }} />)
    expect(screen.getByTestId('wash-verification')).toHaveTextContent('No check needed: logged by a supervisor')
    expect(screen.queryByRole('button', { name: 'Verify this wash' })).not.toBeInTheDocument()
  })
})
