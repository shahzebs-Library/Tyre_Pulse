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
// SupplierManagement contract modal: the panel drives a `wfLocked` flag via
// onStateChange, and the contract's Save control is disabled while the workflow
// is active/locked. Mocking the whole heavy SupplierManagement page is
// impractical, so we smoke-test the added piece in isolation (mirrors
// workOrdersWorkflow.test.jsx).
function SupplierContractHarness({ contract }) {
  const [wfLocked, setWfLocked] = useState(false)
  const contractValue =
    contract.price_per_unit != null && contract.min_order != null
      ? Number(contract.price_per_unit) * Number(contract.min_order)
      : (contract.price_per_unit != null ? Number(contract.price_per_unit) : null)
  return (
    <div>
      <EntityApprovalPanel
        entityType="supplier"
        entityId={contract.id}
        entityLabel={contract.supplier_name || contract.id}
        context={{
          contract_value: contractValue,
          price_per_unit: contract.price_per_unit != null ? Number(contract.price_per_unit) : null,
          min_order: contract.min_order != null ? Number(contract.min_order) : null,
          payment_terms: contract.payment_terms || null,
          status: contract.status,
          country: contract.country,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="Supplier Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>Save</button>
    </div>
  )
}

const CONTRACT = {
  id: 'contract-1',
  supplier_name: 'Michelin',
  price_per_unit: 1200,
  min_order: 40, // contract_value = 48,000 → high-value approval routing
  payment_terms: 'Net 30',
  status: 'Active',
  country: 'Saudi Arabia',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Supplier approval wiring', () => {
  it('renders the Supplier Approval panel for a contract', async () => {
    render(<SupplierContractHarness contract={CONTRACT} />)
    await waitFor(() =>
      expect(screen.getByText('Supplier Approval')).toBeInTheDocument(),
    )
  })

  it('keeps Save enabled when there is no active approval', async () => {
    render(<SupplierContractHarness contract={CONTRACT} />)
    await waitFor(() =>
      expect(screen.getByText('Supplier Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables Save and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w1', status: 'pending', current_step: 0,
      steps: [{ name: 'Procurement Manager', approver_role: 'procurement_manager', require_signature: true }],
      entity_type: 'supplier', entity_id: 'contract-1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Procurement Manager', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<SupplierContractHarness contract={CONTRACT} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables Save when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'supplier', entity_id: 'contract-1',
    })
    render(<SupplierContractHarness contract={CONTRACT} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled(),
    )
  })
})
