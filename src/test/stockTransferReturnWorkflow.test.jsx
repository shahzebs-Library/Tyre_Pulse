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

// Harnesses reproduce exactly the gating wiring added to StockManagement:
//  - the inter-site Transfer tab drives `transferWfLocked` and disables the
//    "Transfer stock" post while the tyre_transfer workflow is active/locked;
//  - the movement/history modal drives `returnWfLocked` and disables the
//    "Log Movement" post for a return while tyre_return is active/locked.
// Mocking the whole heavy StockManagement page is impractical, so we smoke-test
// the added pieces in isolation (mirrors stockIssuanceWorkflow.test.jsx).

function TransferHarness({ record, toSite, qty }) {
  const [transferWfLocked, setTransferWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="tyre_transfer"
        entityId={record.id}
        entityLabel={`${record.site} → ${toSite}`}
        context={{
          qty: Number(qty) || 0,
          from_site: record.site,
          to_site: toSite,
          country: 'SA',
          description: record.description,
        }}
        title="Inter-site Transfer Approval"
        onStateChange={({ isActive, isLocked }) => setTransferWfLocked(!!(isActive || isLocked))}
      />
      {transferWfLocked && <p>Transfer locked — in approval</p>}
      <button disabled={transferWfLocked}>Transfer stock</button>
    </div>
  )
}

function ReturnHarness({ record, qty }) {
  const [returnWfLocked, setReturnWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="tyre_return"
        entityId={record.id}
        entityLabel={record.description || record.site || record.id}
        context={{
          qty: Number(qty) || 0,
          site: record.site,
          country: 'SA',
          description: record.description,
        }}
        onStateChange={({ isActive, isLocked }) => setReturnWfLocked(!!(isActive || isLocked))}
        title="Tyre Return Authorization"
      />
      {returnWfLocked && <p>Return locked — in approval</p>}
      <button disabled={returnWfLocked}>Log Movement</button>
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

describe('Inter-site Transfer approval wiring', () => {
  it('renders the Inter-site Transfer Approval panel for a source record', async () => {
    render(<TransferHarness record={RECORD} toSite="Jeddah Depot" qty={12} />)
    await waitFor(() =>
      expect(screen.getByText('Inter-site Transfer Approval')).toBeInTheDocument(),
    )
  })

  it('keeps Transfer stock enabled when there is no active approval', async () => {
    render(<TransferHarness record={RECORD} toSite="Jeddah Depot" qty={12} />)
    await waitFor(() =>
      expect(screen.getByText('Inter-site Transfer Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Transfer stock' })).not.toBeDisabled()
    expect(screen.queryByText(/Transfer locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables Transfer stock and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wt1', status: 'pending', current_step: 0,
      steps: [{ name: 'Store Manager', approver_role: 'store_manager', require_signature: true }],
      entity_type: 'tyre_transfer', entity_id: 'stk-1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Store Manager', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<TransferHarness record={RECORD} toSite="Jeddah Depot" qty={12} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Transfer stock' })).toBeDisabled(),
    )
    expect(screen.getByText(/Transfer locked — in approval/)).toBeInTheDocument()
  })

  it('disables Transfer stock when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wt2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'tyre_transfer', entity_id: 'stk-1',
    })
    render(<TransferHarness record={RECORD} toSite="Jeddah Depot" qty={12} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Transfer stock' })).toBeDisabled(),
    )
  })
})

describe('Tyre Return approval wiring', () => {
  it('renders the Tyre Return Authorization panel for a return', async () => {
    render(<ReturnHarness record={RECORD} qty={6} />)
    await waitFor(() =>
      expect(screen.getByText('Tyre Return Authorization')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Log Movement' })).not.toBeDisabled()
  })

  it('disables Log Movement and shows the lock hint when the return workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wr1', status: 'pending', current_step: 0,
      steps: [{ name: 'Warehouse Lead', approver_role: 'warehouse_lead', require_comment: true }],
      entity_type: 'tyre_return', entity_id: 'stk-1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Warehouse Lead', created_at: '2026-07-11T09:00:00Z' },
    ])
    render(<ReturnHarness record={RECORD} qty={6} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Log Movement' })).toBeDisabled(),
    )
    expect(screen.getByText(/Return locked — in approval/)).toBeInTheDocument()
  })

  it('disables Log Movement when the return workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wr2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'tyre_return', entity_id: 'stk-1',
    })
    render(<ReturnHarness record={RECORD} qty={6} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Log Movement' })).toBeDisabled(),
    )
  })
})
