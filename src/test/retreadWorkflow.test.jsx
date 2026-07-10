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

// A minimal harness that reproduces exactly how RetreadManagement.jsx wires the
// Approval & Workflow Engine into the retread casing detail drawer: it renders
// the shared EntityApprovalPanel for entityType="retread" and gates the record's
// strongest mutation — the per-record casing export (the retread send-out
// artifact a vendor acts on) — on the panel's onStateChange(isActive/isLocked)
// callback. Rendering the full RetreadManagement page (AuthContext,
// SettingsContext, TenantContext, supabase, chart.js) is impractical for a unit
// test, so we smoke-test the added integration piece in isolation — the same
// gating the page uses.
function RetreadApprovalHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  const handleWfStateChange = useCallback((s) => {
    setWfLocked(!!(s?.isActive || s?.isLocked))
  }, [])

  function handleExportCasing() {
    if (wfLocked) return // early-return when locked — server remains the boundary
  }

  return (
    <div>
      <EntityApprovalPanel
        entityType="retread"
        entityId={record.id}
        entityLabel={record.serial_number || record.asset_no || record.id}
        context={{
          retread_cost: record.cost_per_tyre,
          vendor: record.brand,
          serial_no: record.serial_number,
          casing_condition: record.risk_level,
          site: record.site,
        }}
        onStateChange={handleWfStateChange}
        title="Retread Approval"
      />
      <button
        type="button"
        onClick={handleExportCasing}
        disabled={wfLocked}
        title={wfLocked ? 'Locked — in approval' : 'Export casing record'}
      >
        Export Casing
      </button>
    </div>
  )
}

// retread_cost above threshold → the smart rule routes to Fleet Manager approval.
const RECORD = {
  id: 'rt-1',
  serial_number: 'RTD-555',
  asset_no: 'TR-018',
  brand: 'Bridgestone',
  site: 'Jeddah',
  risk_level: 'Medium',
  cost_per_tyre: 6200,
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('RetreadManagement casing approval wiring', () => {
  it('renders the Retread Approval panel for a retread record', async () => {
    api.listDefinitionsForEntity.mockResolvedValue([
      { id: 'wf-rt', name: 'Retread Send-out Flow', active: true, entity_type: 'retread' },
    ])
    render(<RetreadApprovalHarness record={RECORD} />)

    await waitFor(() =>
      expect(screen.getByText('Retread Approval')).toBeInTheDocument(),
    )
    // Panel resolves retread-scoped definitions and offers to start one.
    expect(api.listDefinitionsForEntity).toHaveBeenCalledWith('retread')
    expect(await screen.findByText('Retread Send-out Flow')).toBeInTheDocument()
  })

  it('leaves the casing export enabled when no approval is running', async () => {
    render(<RetreadApprovalHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Retread Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Export Casing' })).not.toBeDisabled()
  })

  it('locks the casing export while the retread workflow is pending', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wf-inst-1',
      status: 'pending',
      current_step: 0,
      steps: [{ name: 'Fleet Manager Approval', approver_role: 'manager' }],
      entity_type: 'retread',
      entity_id: 'rt-1',
    })
    render(<RetreadApprovalHarness record={RECORD} />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export Casing' })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: 'Export Casing' }))
      .toHaveAttribute('title', 'Locked — in approval')
  })

  it('keeps the casing export locked once the retread workflow is approved', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wf-inst-2',
      status: 'approved',
      current_step: 0,
      steps: [{ name: 'Procurement Verification', approver_role: 'manager' }],
      entity_type: 'retread',
      entity_id: 'rt-1',
    })
    render(<RetreadApprovalHarness record={RECORD} />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export Casing' })).toBeDisabled(),
    )
  })
})
