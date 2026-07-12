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

// Smoke-test the Goods Receipt (GRN) approval surface wired into the Procurement
// PO drawer in isolation. The GRN is a distinct approval booked against the same
// PO id as the purchase_order panel; the engine keys instances by
// (entity_type, entity_id) so the two coexist. context.value (the received PO
// value) is what the workflow's final-step condition routes on (auto-skips the
// finance sign-off when value < 10000). Mounting the whole Procurement page is
// impractical, so we exercise the added piece directly (mirrors
// stockIssuanceWorkflow.test.jsx).
function GoodsReceiptHarness({ po }) {
  const [grnLocked, setGrnLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="goods_receipt"
        entityId={po.id}
        entityLabel={po.po_number || po.id}
        context={{
          value: Number(po.total_amount) || 0,
          country: po.country ?? null,
          site: po.site ?? null,
          po_no: po.po_number ?? null,
        }}
        onStateChange={({ isActive, isLocked }) => setGrnLocked(!!(isActive || isLocked))}
        title="Goods Receipt (GRN)"
      />
      {grnLocked && <p>Goods receipt in approval</p>}
      <button disabled={grnLocked}>Post GRN</button>
    </div>
  )
}

const PO = {
  id: 'po-42',
  po_number: 'PO-2026-00042',
  total_amount: 24500,
  country: 'Saudi Arabia',
  site: 'Riyadh Depot',
  status: 'Ordered',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Goods Receipt (GRN) approval wiring', () => {
  it('renders the Goods Receipt (GRN) panel for a PO', async () => {
    render(<GoodsReceiptHarness po={PO} />)
    await waitFor(() =>
      expect(screen.getByText('Goods Receipt (GRN)')).toBeInTheDocument(),
    )
  })

  it('queries the workflow engine keyed by the goods_receipt entity type and PO id', async () => {
    render(<GoodsReceiptHarness po={PO} />)
    await waitFor(() =>
      expect(api.getWorkflowForEntity).toHaveBeenCalledWith('goods_receipt', 'po-42'),
    )
  })

  it('keeps Post GRN enabled and reports an inactive state when no approval is running', async () => {
    render(<GoodsReceiptHarness po={PO} />)
    await waitFor(() =>
      expect(screen.getByText('Goods Receipt (GRN)')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Post GRN' })).not.toBeDisabled()
    expect(screen.queryByText(/Goods receipt in approval/)).not.toBeInTheDocument()
  })

  it('reports an active state (disables Post GRN) when the workflow is pending', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'grn-w1', status: 'pending', current_step: 0,
      steps: [{ name: 'Store Keeper', approver_role: 'store_keeper', require_signature: true }],
      entity_type: 'goods_receipt', entity_id: 'po-42',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Store Keeper', created_at: '2026-07-11T08:00:00Z' },
    ])
    render(<GoodsReceiptHarness po={PO} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Post GRN' })).toBeDisabled(),
    )
    expect(screen.getByText(/Goods receipt in approval/)).toBeInTheDocument()
  })

  it('reports a locked state (disables Post GRN) when the workflow is approved', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'grn-w2', status: 'approved', current_step: 0,
      steps: [{ name: 'Finance', approver_role: 'finance' }],
      entity_type: 'goods_receipt', entity_id: 'po-42',
    })
    render(<GoodsReceiptHarness po={PO} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Post GRN' })).toBeDisabled(),
    )
  })
})
