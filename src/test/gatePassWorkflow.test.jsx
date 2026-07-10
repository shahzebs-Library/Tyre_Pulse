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
// GatePass clearance panel: the panel drives a `wfLocked` flag via onStateChange,
// and the record's Issue-Gate-Pass control is disabled while the workflow is
// active/locked. Mocking the whole heavy GatePass page is impractical, so we
// smoke-test the added piece in isolation (mirrors workOrdersWorkflow.test.jsx).
function GatePassClearanceHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="gate_pass"
        entityId={record.id}
        entityLabel={record.asset_no || record.id}
        context={{
          purpose: 'Vehicle handover / gate release',
          asset_no: record.asset_no,
          inspection_id: record.id,
          inspection_type: record.inspection_type,
          destination: null,
          site: record.site,
          pass_date: record.pass_date,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="Gate Pass Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>Issue Gate Pass</button>
    </div>
  )
}

const RECORD = {
  id: 'insp-1',
  asset_no: 'ABC-123',
  inspection_type: 'Daily Tyre',
  site: 'Riyadh',
  pass_date: '2026-07-10',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Gate Pass approval wiring', () => {
  it('renders the Gate Pass Approval panel for a record', async () => {
    render(<GatePassClearanceHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Gate Pass Approval')).toBeInTheDocument(),
    )
  })

  it('keeps Issue Gate Pass enabled when there is no active approval', async () => {
    render(<GatePassClearanceHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Gate Pass Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Issue Gate Pass' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables Issue Gate Pass and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w1', status: 'pending', current_step: 0,
      steps: [{ name: 'Gate Supervisor', approver_role: 'supervisor', require_signature: true }],
      entity_type: 'gate_pass', entity_id: 'insp-1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Gate Supervisor', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<GatePassClearanceHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Issue Gate Pass' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables Issue Gate Pass when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'gate_pass', entity_id: 'insp-1',
    })
    render(<GatePassClearanceHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Issue Gate Pass' })).toBeDisabled(),
    )
  })
})
