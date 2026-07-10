import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'

// Mock the workflows API that EntityApprovalPanel + useEntityWorkflow depend on.
// The factory is hoisted so it must not close over outer variables; grab the
// mocked fns via the import below.
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

// Minimal harness that reproduces exactly the gating wiring added to the
// RecallTracker detail drawer: the panel drives a `wfLocked` flag via
// onStateChange, and the recall's Edit/Close/Delete controls are disabled while
// the workflow is active/locked. Mocking the whole heavy RecallTracker page
// (Chart.js, Supabase API) is impractical, so we smoke-test the added piece in
// isolation (mirrors workOrdersWorkflow.test.jsx).
function RecallEditHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="recall"
        entityId={record.id}
        entityLabel={record.recall_number || record.brand || record.id}
        context={{
          severity: record.severity,
          affected_count: record.affected_count ?? 0,
          brand: record.brand,
          status: record.status,
          country: record.country,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="Recall Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>Edit Recall</button>
    </div>
  )
}

const RECORD = {
  id: 'rcl-1',
  recall_number: 'RCL-2024-001',
  brand: 'Michelin',
  severity: 'Critical',
  affected_count: 42,
  status: 'Active',
  country: 'SA',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Recall approval wiring', () => {
  it('renders the Recall Approval panel for a record', async () => {
    render(<RecallEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Recall Approval')).toBeInTheDocument(),
    )
  })

  it('keeps Edit enabled when there is no active approval', async () => {
    render(<RecallEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Recall Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Edit Recall' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables Edit and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w1', status: 'pending', current_step: 0,
      steps: [{ name: 'Safety Officer', approver_role: 'safety_officer', require_signature: true }],
      entity_type: 'recall', entity_id: 'rcl-1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Safety Officer', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<RecallEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit Recall' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables Edit when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'recall', entity_id: 'rcl-1',
    })
    render(<RecallEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit Recall' })).toBeDisabled(),
    )
  })
})
