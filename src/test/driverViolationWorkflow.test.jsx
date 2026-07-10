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

// Minimal harness reproducing the gating wiring added to the DriverManagement
// detail drawer: the panel drives a `wfLocked` flag via onStateChange, and the
// driver record's formal PDF disciplinary export is disabled while the workflow
// is active/locked. Mounting the full analytics-heavy page (Chart.js + Supabase)
// is impractical, so we smoke-test the added piece in isolation (mirrors
// workOrdersWorkflow.test.jsx).
function DriverViolationHarness({ driver }) {
  const [wfLocked, setWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="driver_violation"
        entityId={driver.name}
        entityLabel={driver.name}
        context={{
          severity: driver.severity,
          violation_type: 'tyre_cost_risk',
          points: driver.riskScore,
          failure_rate: driver.failureRate,
          site: driver.site,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="Driver Violation Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>Export PDF</button>
    </div>
  )
}

const DRIVER = {
  name: 'Ahmed Al-Rashid',
  riskScore: 78,          // high composite risk → disciplinary review candidate
  severity: 'Poor',
  failureRate: 42.5,
  site: 'Riyadh',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Driver Violation approval wiring', () => {
  it('renders the Driver Violation Approval panel for a driver', async () => {
    render(<DriverViolationHarness driver={DRIVER} />)
    await waitFor(() =>
      expect(screen.getByText('Driver Violation Approval')).toBeInTheDocument(),
    )
  })

  it('keeps the PDF export enabled when there is no active approval', async () => {
    render(<DriverViolationHarness driver={DRIVER} />)
    await waitFor(() =>
      expect(screen.getByText('Driver Violation Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Export PDF' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables the PDF export and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w1', status: 'pending', current_step: 0,
      steps: [{ name: 'Fleet Manager', approver_role: 'fleet_manager', require_signature: true }],
      entity_type: 'driver_violation', entity_id: 'Ahmed Al-Rashid',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Fleet Manager', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<DriverViolationHarness driver={DRIVER} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables the PDF export when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'driver_violation', entity_id: 'Ahmed Al-Rashid',
    })
    render(<DriverViolationHarness driver={DRIVER} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled(),
    )
  })
})
