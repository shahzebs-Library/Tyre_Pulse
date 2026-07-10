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

// Minimal harness that reproduces exactly the gating wiring added to
// Inspections.jsx: the panel drives a `wfLocked` flag via onStateChange, and
// the record's Save control is disabled while the workflow is active/locked.
function InspectionEditHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="inspection"
        entityId={record.id}
        entityLabel={record.asset_no || record.id}
        context={{
          pressure: record.pressure_reading,
          tread: record.tread_depth,
          odometer: record.odometer_km,
          site: record.site,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="Inspection Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>Save Changes</button>
    </div>
  )
}

const RECORD = { id: 'insp-1', asset_no: 'TM-101', pressure_reading: 95, tread_depth: 6, odometer_km: 42000, site: 'Riyadh' }

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Inspections approval wiring', () => {
  it('renders the Inspection Approval panel for a record', async () => {
    render(<InspectionEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Inspection Approval')).toBeInTheDocument(),
    )
  })

  it('keeps Save enabled when there is no active approval', async () => {
    render(<InspectionEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Inspection Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Save Changes' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables Save and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w1', status: 'pending', current_step: 0,
      steps: [{ name: 'Inspector Review', approver_role: 'inspector', require_signature: true }],
      entity_type: 'inspection', entity_id: 'insp-1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Inspector Review', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<InspectionEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables Save when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'inspection', entity_id: 'insp-1',
    })
    render(<InspectionEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled(),
    )
  })
})
