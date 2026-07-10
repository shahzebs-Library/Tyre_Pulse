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

// Minimal harness reproducing the gating wiring added to the Tyre Scrap
// Disposal Log: the expanded row hosts <EntityApprovalPanel/>, which drives a
// `wfLocked` flag via onStateChange, and the record's scrap-status mutation
// (Dispose) is disabled while the workflow is active/locked. Mocking the whole
// heavy analytics page is impractical, so we smoke-test the added piece in
// isolation (mirrors workOrdersWorkflow.test.jsx).
function ScrapRowHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="tyre_scrap"
        entityId={record.id}
        entityLabel={record.serial_number || record.asset_no || record.id}
        context={{
          scrap_cost: record.cost_per_tyre != null
            ? Number(record.cost_per_tyre) * (Number(record.qty) || 1)
            : null,
          reason: record.removal_reason,
          brand: record.brand,
          quantity: Number(record.qty) || 1,
          site: record.site,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="Scrap Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>Dispose</button>
    </div>
  )
}

const RECORD = {
  id: 'scrap-1',
  serial_number: 'TY-99001',
  asset_no: 'VH-42',
  brand: 'Bridgestone',
  cost_per_tyre: 6000, // > 5,000 → Fleet Manager approval (smart rule)
  qty: 1,
  removal_reason: 'Sidewall',
  site: 'Riyadh',
  risk_level: 'Critical',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Tyre Scrap approval wiring', () => {
  it('renders the Scrap Approval panel for a record', async () => {
    render(<ScrapRowHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Scrap Approval')).toBeInTheDocument(),
    )
  })

  it('keeps Dispose enabled when there is no active approval', async () => {
    render(<ScrapRowHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Scrap Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Dispose' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables Dispose and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wf1', status: 'pending', current_step: 0,
      steps: [{ name: 'Fleet Manager', approver_role: 'fleet_manager', require_signature: true }],
      entity_type: 'tyre_scrap', entity_id: 'scrap-1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Fleet Manager', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<ScrapRowHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Dispose' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables Dispose when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wf2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'tyre_scrap', entity_id: 'scrap-1',
    })
    render(<ScrapRowHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Dispose' })).toBeDisabled(),
    )
  })
})
