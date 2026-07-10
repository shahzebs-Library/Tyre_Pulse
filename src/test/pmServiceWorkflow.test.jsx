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
// InspectionPlanner ScheduleModal (edit mode): the panel drives a `wfLocked`
// flag via onStateChange, and the record's Save control is disabled while the
// workflow is active/locked. Mocking the whole heavy planner page is
// impractical, so we smoke-test the added piece in isolation (mirrors
// inspectionsWorkflow.test.jsx).
function PmServiceEditHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="pm_service"
        entityId={record.id}
        entityLabel={record.asset_no || record.id}
        context={{
          asset_no: record.asset_no,
          due_date: record.inspection_date,
          service_type: record.type,
          status: record.status,
          site: record.site,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="PM Service Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>Save</button>
    </div>
  )
}

const RECORD = {
  id: 'pm-1',
  asset_no: 'TM-101',
  inspection_date: '2026-07-15',
  type: 'Routine',
  status: 'Scheduled',
  site: 'Riyadh',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('PM Service approval wiring', () => {
  it('renders the PM Service Approval panel for a record', async () => {
    render(<PmServiceEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('PM Service Approval')).toBeInTheDocument(),
    )
  })

  it('keeps Save enabled when there is no active approval', async () => {
    render(<PmServiceEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('PM Service Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables Save and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w1', status: 'pending', current_step: 0,
      steps: [{ name: 'Maintenance Planner', approver_role: 'maintenance_planner', require_signature: true }],
      entity_type: 'pm_service', entity_id: 'pm-1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Maintenance Planner', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<PmServiceEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables Save when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'pm_service', entity_id: 'pm-1',
    })
    render(<PmServiceEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(),
    )
  })
})
