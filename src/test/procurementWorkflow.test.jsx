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

// Minimal harness reproducing exactly how Procurement.jsx wires the approval
// engine into its purchase-order detail drawer: it renders the shared
// EntityApprovalPanel for entityType="purchase_order" and gates the PO
// edit/save controls on the panel's onStateChange(isActive/isLocked) callback.
// Mounting the whole Procurement page (Auth/Settings/Tenant/Language contexts,
// chart.js, jsPDF, xlsx, the procurement API) is impractical for a unit test,
// so we smoke-test the added integration piece in isolation — the same gating
// the page applies via `poLocked = wfLocked.isActive || wfLocked.isLocked`.
function ProcurementApprovalHarness({ po }) {
  const [wfLocked, setWfLocked] = useState({ isActive: false, isLocked: false, status: null })
  const poLocked = wfLocked.isActive || wfLocked.isLocked
  const handleWfStateChange = useCallback((next) => {
    setWfLocked(prev =>
      prev.isActive === next.isActive &&
      prev.isLocked === next.isLocked &&
      prev.status === next.status
        ? prev
        : next,
    )
  }, [])

  return (
    <div>
      <button
        type="button"
        disabled={poLocked}
        title={poLocked ? 'Locked — in approval' : undefined}
      >
        Edit PO
      </button>
      <button
        type="button"
        disabled={poLocked}
        title={poLocked ? 'Locked — in approval' : undefined}
      >
        Save Changes
      </button>
      <EntityApprovalPanel
        entityType="purchase_order"
        entityId={po.id}
        entityLabel={po.po_number || po.id}
        context={{
          total_amount: Number(po.total_amount) || 0,
          status: po.status,
          priority: po.priority,
          supplier: po.vendor_name,
          item_count: (po.items || []).length,
        }}
        title="Purchase Approval"
        onStateChange={handleWfStateChange}
      />
    </div>
  )
}

const PO = {
  id: 'po-1',
  po_number: 'PO-2026-00042',
  vendor_name: 'Bridgestone MENA',
  status: 'Submitted',
  priority: 'High',
  total_amount: 42000,
  items: [{ brand: 'Bridgestone', size: '295/80R22.5', quantity: 12, unit_price: 3500 }],
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Procurement approval wiring', () => {
  it('renders the Purchase Approval panel for a purchase-order record', async () => {
    api.listDefinitionsForEntity.mockResolvedValue([
      { id: 'wf-po', name: 'Purchase Request Flow', active: true, entity_type: 'purchase_order' },
    ])
    render(<ProcurementApprovalHarness po={PO} />)

    await waitFor(() => expect(screen.getByText('Purchase Approval')).toBeInTheDocument())
    // Panel resolves purchase_order-scoped definitions and offers to start one.
    expect(api.listDefinitionsForEntity).toHaveBeenCalledWith('purchase_order')
    expect(await screen.findByText('Purchase Request Flow')).toBeInTheDocument()
  })

  it('leaves the PO edit/save controls enabled when no approval is running', async () => {
    render(<ProcurementApprovalHarness po={PO} />)
    await waitFor(() => expect(screen.getByText('Purchase Approval')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Edit PO' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save Changes' })).not.toBeDisabled()
  })

  it('disables PO edit/save while the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wf-inst-1',
      status: 'pending',
      current_step: 0,
      steps: [{ name: 'Store Keeper', approver_role: 'manager' }],
      entity_type: 'purchase_order',
      entity_id: 'po-1',
    })
    render(<ProcurementApprovalHarness po={PO} />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit PO' })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit PO' })).toHaveAttribute('title', 'Locked — in approval')
  })

  it('disables PO edit/save once the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wf-inst-2',
      status: 'approved',
      current_step: 0,
      steps: [{ name: 'Purchase Order', approver_role: 'director' }],
      entity_type: 'purchase_order',
      entity_id: 'po-1',
    })
    render(<ProcurementApprovalHarness po={PO} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit PO' })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  })
})
