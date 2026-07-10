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
// WorkshopManagement JobDrawer: the panel drives a `wfLocked` flag via
// onStateChange, and the record's strongest per-record action (Export Job Card)
// is disabled while the workflow is active/locked. Mocking the whole heavy
// WorkshopManagement page is impractical, so we smoke-test the added piece in
// isolation (mirrors workOrdersWorkflow.test.jsx).
function WorkshopQaHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="workshop_qa"
        entityId={record.id}
        entityLabel={record.work_order_no || record.asset_no || record.id}
        context={{
          score: record.score ?? record.quality_score,
          status: record.status,
          workshop: record.site,
          work_type: record.work_type,
          total_cost: Number(record.total_cost) || 0,
          site: record.site,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="Workshop QA Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>Export Job Card</button>
    </div>
  )
}

const RECORD = {
  id: 'wo-77',
  work_order_no: 'WO-2077',
  asset_no: 'ASSET-9',
  site: 'Jeddah',
  work_type: 'Inspection',
  status: 'Completed',
  quality_score: 92,
  total_cost: 4100,
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Workshop QA approval wiring', () => {
  it('renders the Workshop QA Approval panel for a record', async () => {
    render(<WorkshopQaHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Workshop QA Approval')).toBeInTheDocument(),
    )
  })

  it('keeps Export enabled when there is no active approval', async () => {
    render(<WorkshopQaHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Workshop QA Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Export Job Card' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables Export and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w1', status: 'pending', current_step: 0,
      steps: [{ name: 'QA Manager', approver_role: 'qa_manager', require_signature: true }],
      entity_type: 'workshop_qa', entity_id: 'wo-77',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'QA Manager', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<WorkshopQaHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export Job Card' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables Export when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'workshop_qa', entity_id: 'wo-77',
    })
    render(<WorkshopQaHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export Job Card' })).toBeDisabled(),
    )
  })
})
