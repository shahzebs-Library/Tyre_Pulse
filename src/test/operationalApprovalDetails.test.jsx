import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
const { resolveStorageUrl } = vi.hoisted(() => ({ resolveStorageUrl: vi.fn() }))
vi.mock('../lib/storageRefs', () => ({ resolveStorageUrl }))
vi.mock('../components/workorders/JobCardDetail', () => ({ default: ({ row, canEdit }) => <p>{row.description} {canEdit ? 'editable' : 'read only'}</p> }))
import OperationalApprovalDetails from '../components/workflow/OperationalApprovalDetails'

afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks(); resolveStorageUrl.mockResolvedValue('https://example.test/signed-photo.jpg') })

describe('operational approval evidence', () => {
  it('shows exact tyre action, positions and submitted serial without current-source substitution', () => {
    render(<OperationalApprovalDetails entityType="tyre_change" document={{ payload: { action: 'replace', position: 'F1L', serial_no: 'NEW-SERIAL', removal_reason: 'Sidewall damage' }, source_snapshot: { vehicle: { asset_no: 'TM1' }, source_tyre: { serial_no: 'OLD-SERIAL', position: 'F1L' } }, current_source_snapshot: { source_tyre: { serial_no: 'CHANGED' } } }} />)
    expect(screen.getByRole('heading', { name: 'Replace tyre' })).toBeInTheDocument()
    expect(screen.getByText('NEW-SERIAL')).toBeInTheDocument()
    expect(screen.getByText('OLD-SERIAL · F1L')).toBeInTheDocument()
    expect(screen.queryByText(/CHANGED/)).not.toBeInTheDocument()
  })
  it('renders the submitted work order and request reason without substituting current values', () => {
    render(<OperationalApprovalDetails entityType="work_order" document={{ payload: { reason: 'Fix brakes before dispatch' }, source_snapshot: { description: 'Submitted job card' }, current_source_snapshot: { description: 'Changed job card' } }} />)
    expect(screen.getByText('Submitted job card read only')).toBeInTheDocument()
    expect(screen.getByText('Fix brakes before dispatch')).toBeInTheDocument()
    expect(screen.queryByText(/Changed job card/)).not.toBeInTheDocument()
  })

  it('shows the submitted tyre dimensions, reason, identities and signed photos', async () => {
    render(<OperationalApprovalDetails entityType="tyre_change" document={{ source_snapshot: { source_tyre: { asset_number: 'TRUCK-1', serial_no: 'OLD-1', tyre_position: 'L1' } }, payload: { action: 'replace', size: '315/80R22.5', tread_depth: 0, request_reason: 'Sidewall damaged', photos: ['tp-storage://tyres/evidence.jpg'] } }} />)
    expect(screen.getByText('315/80R22.5')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('Sidewall damaged')).toBeInTheDocument()
    expect(screen.getByText('TRUCK-1 · OLD-1 · L1')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Request photo 1' })).toHaveAttribute('src', 'https://example.test/signed-photo.jpg')
    expect(resolveStorageUrl).toHaveBeenCalledWith('tp-storage://tyres/evidence.jpg')
  })

  it('reports unavailable evidence instead of silently dropping the submitted photo', async () => {
    resolveStorageUrl.mockRejectedValue(new Error('Storage unavailable'))
    render(<OperationalApprovalDetails entityType="tyre_change" document={{ payload: { photos: ['tp-storage://tyres/evidence.jpg'] } }} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Photo could not be loaded')
  })

  it('reports image delivery failures after signing', async () => {
    render(<OperationalApprovalDetails entityType="tyre_change" document={{ payload: { photos: ['tp-storage://tyres/evidence.jpg'] } }} />)
    fireEvent.error(await screen.findByRole('img'))
    expect(screen.getByRole('alert')).toHaveTextContent('Photo could not be loaded')
  })
})
