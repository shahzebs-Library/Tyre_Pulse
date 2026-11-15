/**
 * An acknowledged sheet was signed with the fault recorded on purpose, so the
 * viewer must not tell the reader to correct it or send it back.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../lib/checklist/checklistMarks', () => ({
  canClose: () => ({ ok: false, blocking: [{ id: 'brakes', label: 'Brakes', value: 'Not OK' }] }),
}))

import BlockingMarksNotice, {
  blockingHint, HINT_OPEN, HINT_ACKNOWLEDGED, HINT_RESOLVED, HINT_EXCEPTION,
} from '../components/checklist/BlockingMarksNotice'

describe('blockingHint', () => {
  it('keeps the correction advice for a sheet still in approval', () => {
    expect(blockingHint(null)).toBe(HINT_OPEN)
    expect(blockingHint({ approval_status: 'pending' })).toBe(HINT_OPEN)
    expect(blockingHint({ approval_status: 'pending_area_manager' })).toBe(HINT_OPEN)
  })
  it('says the fault is tracked as a corrective action when acknowledged', () => {
    expect(blockingHint({ approval_status: 'acknowledged' })).toBe(HINT_ACKNOWLEDGED)
    expect(blockingHint({ approval_status: 'acknowledged', ack_fault_state: 'fault_open' })).toBe(HINT_ACKNOWLEDGED)
  })
  it('names an approved exception', () => {
    expect(blockingHint({ approval_status: 'acknowledged', ack_fault_state: 'exception' })).toBe(HINT_EXCEPTION)
  })
  it('names a resolved fault', () => {
    expect(blockingHint({ approval_status: 'acknowledged', ack_fault_state: 'fault_resolved' })).toBe(HINT_RESOLVED)
  })
})

describe('BlockingMarksNotice', () => {
  it('does not say "send the sheet back" on an acknowledged sheet', () => {
    render(<BlockingMarksNotice template={{}} answers={{}} submission={{ approval_status: 'acknowledged' }} />)
    expect(screen.queryByText(/send the sheet back/i)).toBeNull()
    expect(screen.getByText(HINT_ACKNOWLEDGED)).toBeTruthy()
  })
  it('shows "Closed by an approved exception." for compliant by exception', () => {
    render(<BlockingMarksNotice template={{}} answers={{}} submission={{ approval_status: 'acknowledged', ack_fault_state: 'exception' }} />)
    expect(screen.getByText('Closed by an approved exception.')).toBeTruthy()
  })
  it('keeps the correction advice without a submission', () => {
    render(<BlockingMarksNotice template={{}} answers={{}} />)
    expect(screen.getByText(/send the sheet back/i)).toBeTruthy()
  })
})
