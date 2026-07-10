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

// Minimal harness reproducing exactly the gating wiring added to the
// RotationSchedule "Upcoming Schedule" detail drawer: the panel drives a
// `wfLocked` flag via onStateChange, and the open scheduled rotation's strongest
// mutation (Mark Completed) is disabled while the workflow is active/locked.
// Mocking the whole heavy RotationSchedule page is impractical, so we smoke-test
// the added piece in isolation (mirrors workOrdersWorkflow.test.jsx).
function RotationCompleteHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="tyre_rotation"
        entityId={record.id}
        entityLabel={record.asset || record.id}
        context={{
          asset_no: record.asset,
          due_date: record.scheduledDate,
          priority: record.priority,
          status: record.status,
          cost: Number(record.currentKm) || 0,
          site: record.site,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="Rotation Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>Mark Completed</button>
    </div>
  )
}

const RECORD = {
  id: 'rot-1',
  asset: 'TRK-4471',
  site: 'Riyadh',
  scheduledDate: '2026-07-20',
  priority: 'Critical',
  status: 'Open',
  currentKm: 182000,
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Rotation Schedule approval wiring', () => {
  it('renders the Rotation Approval panel for a scheduled rotation', async () => {
    render(<RotationCompleteHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Rotation Approval')).toBeInTheDocument(),
    )
  })

  it('keeps Mark Completed enabled when there is no active approval', async () => {
    render(<RotationCompleteHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Rotation Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Mark Completed' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables Mark Completed and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w1', status: 'pending', current_step: 0,
      steps: [{ name: 'Maintenance Planner', approver_role: 'maintenance_planner', require_signature: true }],
      entity_type: 'tyre_rotation', entity_id: 'rot-1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Maintenance Planner', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<RotationCompleteHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mark Completed' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables Mark Completed when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'tyre_rotation', entity_id: 'rot-1',
    })
    render(<RotationCompleteHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Mark Completed' })).toBeDisabled(),
    )
  })
})
