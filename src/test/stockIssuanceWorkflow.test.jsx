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
// StockManagement movement-history modal: the panel drives a `wfLocked` flag via
// onStateChange, and the record's ledger-post (Log Movement / stock issuance)
// control is disabled while the workflow is active/locked. Mocking the whole heavy
// StockManagement page is impractical, so we smoke-test the added piece in
// isolation (mirrors workOrdersWorkflow.test.jsx).
function StockIssuanceHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="stock_issue"
        entityId={record.id}
        entityLabel={record.description || record.site || record.id}
        context={{
          quantity: record.stock_qty,
          value: record.reorder_qty ?? record.min_level,
          movement_type: 'issue',
          site: record.site,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="Stock Issuance Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>Log Movement</button>
    </div>
  )
}

const RECORD = {
  id: 'stk-1',
  site: 'Riyadh Depot',
  description: '315/80R22.5 Steer',
  stock_qty: 24,
  min_level: 5,
  critical_level: 3,
  reorder_qty: 30,
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Stock Issuance approval wiring', () => {
  it('renders the Stock Issuance Approval panel for a record', async () => {
    render(<StockIssuanceHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Stock Issuance Approval')).toBeInTheDocument(),
    )
  })

  it('keeps Log Movement enabled when there is no active approval', async () => {
    render(<StockIssuanceHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Stock Issuance Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Log Movement' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables Log Movement and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w1', status: 'pending', current_step: 0,
      steps: [{ name: 'Store Manager', approver_role: 'store_manager', require_signature: true }],
      entity_type: 'stock_issue', entity_id: 'stk-1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Store Manager', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<StockIssuanceHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Log Movement' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables Log Movement when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'stock_issue', entity_id: 'stk-1',
    })
    render(<StockIssuanceHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Log Movement' })).toBeDisabled(),
    )
  })
})
