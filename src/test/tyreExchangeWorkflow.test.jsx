import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useState, useCallback } from 'react'

// Mock the workflows API the hook/panel depend on. The factory is hoisted, so
// it must not close over outer variables — mocks are grabbed via the import.
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

// A minimal harness that reproduces exactly how TyreExchange.jsx wires the
// Approval & Workflow Engine into the Chain-of-Custody replacement record: it
// renders the shared EntityApprovalPanel for entityType="tyre_change" and gates
// the record's return / write-off mutation controls on the panel's
// onStateChange(isActive/isLocked) callback. Rendering the full TyreExchange
// page (AuthContext, SettingsContext, TenantContext, supabase, chart.js, the
// exchange API) is impractical for a unit test, so we smoke-test the added
// integration piece in isolation — the same pattern the page uses.
function TyreReplacementHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  const handleWfStateChange = useCallback((s) => {
    setWfLocked(!!(s?.isActive || s?.isLocked))
  }, [])
  const rowLocked = wfLocked // single record in this harness

  return (
    <div>
      <EntityApprovalPanel
        entityType="tyre_change"
        entityId={record.id}
        entityLabel={record.serial}
        context={{
          replacement_cost: record.replacement_cost,
          reason: record.reason,
          asset_no: record.asset_no,
          position: record.position,
          site: record.site,
        }}
        onStateChange={handleWfStateChange}
        title="Tyre Replacement Approval"
      />
      <button
        type="button"
        disabled={rowLocked}
        title={rowLocked ? 'Locked — in approval' : 'Mark as Returned'}
      >
        Returned
      </button>
      <button
        type="button"
        disabled={rowLocked}
        title={rowLocked ? 'Locked — in approval' : 'Write Off'}
      >
        Write Off
      </button>
    </div>
  )
}

// replacement_cost > 5000 SAR → the smart rule routes to Fleet Manager approval.
const RECORD = {
  id: 'tc-1',
  serial: 'SN-777',
  asset_no: 'TM-042',
  position: 'Drive',
  site: 'Riyadh',
  replacement_cost: 7500,
  reason: 'Sidewall damage',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('TyreExchange replacement approval wiring', () => {
  it('renders the Tyre Replacement Approval panel for a tyre_change record', async () => {
    api.listDefinitionsForEntity.mockResolvedValue([
      { id: 'wf-tc', name: 'Tyre Replacement Flow', active: true, entity_type: 'tyre_change' },
    ])
    render(<TyreReplacementHarness record={RECORD} />)

    await waitFor(() =>
      expect(screen.getByText('Tyre Replacement Approval')).toBeInTheDocument(),
    )
    // Panel resolves tyre_change-scoped definitions and offers to start one.
    expect(api.listDefinitionsForEntity).toHaveBeenCalledWith('tyre_change')
    expect(await screen.findByText('Tyre Replacement Flow')).toBeInTheDocument()
  })

  it('leaves the record mutation controls enabled when no approval is running', async () => {
    render(<TyreReplacementHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Tyre Replacement Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Returned' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Write Off' })).not.toBeDisabled()
  })

  it('locks return / write-off while the replacement workflow is pending', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wf-inst-1',
      status: 'pending',
      current_step: 0,
      steps: [{ name: 'Supervisor Approval', approver_role: 'manager' }],
      entity_type: 'tyre_change',
      entity_id: 'tc-1',
    })
    render(<TyreReplacementHarness record={RECORD} />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Returned' })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: 'Write Off' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Returned' }))
      .toHaveAttribute('title', 'Locked — in approval')
  })

  it('keeps the record locked once the replacement workflow is approved', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wf-inst-2',
      status: 'approved',
      current_step: 0,
      steps: [{ name: 'Inspector Verification', approver_role: 'inspector' }],
      entity_type: 'tyre_change',
      entity_id: 'tc-1',
    })
    render(<TyreReplacementHarness record={RECORD} />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Returned' })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: 'Write Off' })).toBeDisabled()
  })
})
