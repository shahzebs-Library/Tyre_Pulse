import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('../components/workorders/JobCardDetail', () => ({ default: ({ row, canEdit }) => <p>Work order {row.work_order_no}: {canEdit ? 'editable' : 'read only'}</p> }))
import OperationalApprovalDetails from '../components/workflow/OperationalApprovalDetails'
it('shows the immutable job card snapshot, never the current changed source', () => {
  render(<OperationalApprovalDetails entityType="work_order" document={{ source_snapshot: { work_order_no: 'Original' }, current_source_snapshot: { work_order_no: 'Changed' } }} />)
  expect(screen.getByText('Work order Original: read only')).toBeInTheDocument()
  expect(screen.queryByText(/Changed/)).not.toBeInTheDocument()
})
it('shows exact tyre action, positions and submitted serial without current-source substitution', () => {
  render(<OperationalApprovalDetails entityType="tyre_change" document={{ payload: { action: 'replace', position: 'F1L', serial_no: 'NEW-SERIAL', removal_reason: 'Sidewall damage' }, source_snapshot: { vehicle: { asset_no: 'TM1' }, source_tyre: { serial_no: 'OLD-SERIAL', position: 'F1L' } }, current_source_snapshot: { source_tyre: { serial_no: 'CHANGED' } } }} />)
  expect(screen.getByRole('heading', { name: 'Replace tyre' })).toBeInTheDocument()
  expect(screen.getByText('NEW-SERIAL')).toBeInTheDocument()
  expect(screen.getByText('OLD-SERIAL · F1L')).toBeInTheDocument()
  expect(screen.queryByText(/CHANGED/)).not.toBeInTheDocument()
})
