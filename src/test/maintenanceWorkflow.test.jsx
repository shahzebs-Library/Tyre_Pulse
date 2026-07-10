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
// MaintenanceCalendar event-detail modal: the panel drives a `wfLocked` flag via
// onStateChange, and the record's strongest mutation (the jump to edit the
// underlying maintenance record) is disabled while the workflow is active/locked.
// Mocking the whole heavy calendar page is impractical, so we smoke-test the
// added piece in isolation (mirrors workOrdersWorkflow.test.jsx).
function MaintenanceEventHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="maintenance_request"
        entityId={record.id}
        entityLabel={record.asset_no || record.title || record.id}
        context={{
          cost: record.estimated_cost ?? record.cost ?? null,
          priority: record.priority,
          downtime_hours: record.downtime_hours ?? null,
          asset_no: record.asset_no,
          site: record.site,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="Maintenance Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>View Work Order</button>
    </div>
  )
}

const RECORD = {
  id: 'mr-1',
  title: 'MC-1001',
  asset_no: 'TRK-42',
  estimated_cost: 3200,
  downtime_hours: 60, // downtime > 48h → Operations Manager (smart rule)
  priority: 'High',
  site: 'Riyadh',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Maintenance approval wiring', () => {
  it('renders the Maintenance Approval panel for a record', async () => {
    render(<MaintenanceEventHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Maintenance Approval')).toBeInTheDocument(),
    )
  })

  it('keeps the gated control enabled when there is no active approval', async () => {
    render(<MaintenanceEventHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Maintenance Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'View Work Order' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables the gated control and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w1', status: 'pending', current_step: 0,
      steps: [{ name: 'Operations Manager', approver_role: 'operations_manager', require_signature: true }],
      entity_type: 'maintenance_request', entity_id: 'mr-1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Operations Manager', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<MaintenanceEventHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'View Work Order' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables the gated control when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'maintenance_request', entity_id: 'mr-1',
    })
    render(<MaintenanceEventHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'View Work Order' })).toBeDisabled(),
    )
  })
})
