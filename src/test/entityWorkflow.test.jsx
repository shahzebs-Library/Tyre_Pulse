import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// Mock the workflows API the hook/panel depend on (factory is hoisted, so it
// must not close over outer variables — grab the mocks via the import below).
vi.mock('../lib/api/workflows', () => ({
  getWorkflowForEntity: vi.fn(),
  listDefinitionsForEntity: vi.fn(),
  listStepEvents: vi.fn(),
  myPendingApprovals: vi.fn(),
  startWorkflow: vi.fn(),
  actOnWorkflow: vi.fn(),
  returnWorkflow: vi.fn(),
}))

import * as api from '../lib/api/workflows'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('EntityApprovalPanel', () => {
  it('offers to start an approval when none exists and a definition is configured', async () => {
    api.listDefinitionsForEntity.mockResolvedValue([
      { id: 'd1', name: 'Daily Inspection', active: true, entity_type: 'inspection' },
    ])
    render(<EntityApprovalPanel entityType="inspection" entityId="i1" />)
    await waitFor(() => expect(screen.getByText('Start approval')).toBeInTheDocument())
    expect(screen.getByText('Daily Inspection')).toBeInTheDocument()
  })

  it('shows a friendly hint when no workflow is configured', async () => {
    render(<EntityApprovalPanel entityType="inspection" entityId="i1" />)
    await waitFor(() =>
      expect(screen.getByText(/No approval workflow is configured/i)).toBeInTheDocument(),
    )
  })

  it('renders the status badge + trail for an active instance', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w1', status: 'pending', current_step: 0,
      steps: [{ name: 'Inspector Review', approver_role: 'inspector', require_signature: true }],
      entity_type: 'inspection', entity_id: 'i1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Inspector Review', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<EntityApprovalPanel entityType="inspection" entityId="i1" />)
    await waitFor(() => expect(screen.getByText(/pending/i)).toBeInTheDocument())
  })

  it('reports locked/active state to the parent via onStateChange', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w2', status: 'approved', current_step: 0, steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'inspection', entity_id: 'i1',
    })
    const onStateChange = vi.fn()
    render(<EntityApprovalPanel entityType="inspection" entityId="i1" onStateChange={onStateChange} />)
    await waitFor(() =>
      expect(onStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'approved', isLocked: true }),
      ),
    )
  })
})
