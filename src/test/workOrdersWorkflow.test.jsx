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
// WorkOrders detail drawer: the panel drives a `wfLocked` flag via onStateChange,
// and the record's Edit/Save control is disabled while the workflow is
// active/locked. Mocking the whole heavy WorkOrders page is impractical, so we
// smoke-test the added piece in isolation (mirrors inspectionsWorkflow.test.jsx).
function WorkOrderEditHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="work_order"
        entityId={record.id}
        entityLabel={record.work_order_no || record.id}
        context={{
          total_cost: Number(record.total_cost) || 0,
          downtime_hours: Number(record.breakdown_hours) || 0,
          status: record.status,
          priority: record.priority,
          site: record.site,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="Work Order Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>Save Changes</button>
    </div>
  )
}

const RECORD = {
  id: 'wo-1',
  work_order_no: 'WO-1001',
  total_cost: 3200,
  breakdown_hours: 60, // downtime > 48h → Operations Manager (smart rule)
  status: 'In Progress',
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

describe('Work Orders approval wiring', () => {
  it('renders the Work Order Approval panel for a record', async () => {
    render(<WorkOrderEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Work Order Approval')).toBeInTheDocument(),
    )
  })

  it('keeps Save enabled when there is no active approval', async () => {
    render(<WorkOrderEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Work Order Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Save Changes' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables Save and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w1', status: 'pending', current_step: 0,
      steps: [{ name: 'Operations Manager', approver_role: 'operations_manager', require_signature: true }],
      entity_type: 'work_order', entity_id: 'wo-1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Operations Manager', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<WorkOrderEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables Save when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'work_order', entity_id: 'wo-1',
    })
    render(<WorkOrderEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled(),
    )
  })
})
