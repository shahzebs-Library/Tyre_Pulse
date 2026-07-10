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
// FuelEfficiency "Fuel Savings Opportunities" review modal: the panel drives a
// `wfLocked` flag via onStateChange, and the reviewed vehicle's strongest action
// (Issue Exception Report) is disabled while the workflow is active/locked.
// FuelEfficiency is aggregated read-only analytics, so — as DriverManagement did
// by driver name — the fuel exception is keyed by asset_no. Mocking the whole
// heavy Chart.js page is impractical, so we smoke-test the added piece in
// isolation (mirrors workOrdersWorkflow.test.jsx / driverViolationWorkflow).
function FuelExceptionReviewHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="fuel_exception"
        entityId={record.asset_no}
        entityLabel={record.asset_no}
        context={{
          variance: record.avgDevPct,
          cost: Math.round(record.totalExtraCostMonth || 0),
          deviation_pct: record.avgDevPct,
          compliance_pct: record.compliancePct,
          avg_tread_mm: record.avgTread,
          annual_cost: Math.round(record.annualExtraCost || 0),
          site: record.site,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="Fuel Exception Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>Issue Exception Report</button>
    </div>
  )
}

const RECORD = {
  asset_no: 'TRK-4471',
  site: 'Riyadh',
  compliancePct: 62.5,
  avgDevPct: 18.3, // heavy pressure deviation → fuel-waste anomaly
  avgTread: 2.8,
  totalExtraCostMonth: 640,
  annualExtraCost: 7680,
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Fuel Exception approval wiring', () => {
  it('renders the Fuel Exception Approval panel for a vehicle exception', async () => {
    render(<FuelExceptionReviewHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Fuel Exception Approval')).toBeInTheDocument(),
    )
  })

  it('keeps Issue Exception Report enabled when there is no active approval', async () => {
    render(<FuelExceptionReviewHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Fuel Exception Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Issue Exception Report' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables Issue Exception Report and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'fw1', status: 'pending', current_step: 0,
      steps: [{ name: 'Operations Manager', approver_role: 'operations_manager', require_signature: true }],
      entity_type: 'fuel_exception', entity_id: 'TRK-4471',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Operations Manager', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<FuelExceptionReviewHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Issue Exception Report' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables Issue Exception Report when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'fw2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'fuel_exception', entity_id: 'TRK-4471',
    })
    render(<FuelExceptionReviewHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Issue Exception Report' })).toBeDisabled(),
    )
  })
})
