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

// A minimal harness that reproduces exactly how WarrantyTracker.jsx wires the
// approval engine into its per-claim edit modal: it renders the shared
// EntityApprovalPanel for entityType="warranty_claim" and gates the claim's
// edit fields + Update/Delete controls on the panel's onStateChange callback.
// Rendering the full WarrantyTracker page (AuthContext, SettingsContext,
// TenantContext, router, supabase, chart.js, several API modules) is
// impractical for a unit test, so we smoke-test the added integration piece in
// isolation — the same gating pattern the page uses.
function WarrantyApprovalHarness({ claim }) {
  const [wfLocked, setWfLocked] = useState({ isActive: false, isLocked: false, status: null })
  const claimLocked = wfLocked.isActive || wfLocked.isLocked
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
      <EntityApprovalPanel
        entityType="warranty_claim"
        entityId={claim.id}
        entityLabel={claim.claim_no || claim.serial_number || claim.id}
        context={{
          claim_amount: Number(claim.credit_amount) || 0,
          status: claim.claim_status,
          brand: claim.brand,
          serial_number: claim.serial_number,
          country: claim.country,
        }}
        title="Warranty Approval"
        onStateChange={handleWfStateChange}
      />
      <fieldset disabled={claimLocked} className="contents">
        <input aria-label="Brand" defaultValue={claim.brand} />
        <select aria-label="Status" defaultValue={claim.claim_status}>
          <option>Submitted</option>
          <option>Approved</option>
          <option>Credit Issued</option>
        </select>
      </fieldset>
      <button
        type="button"
        disabled={claimLocked}
        title={claimLocked ? 'Locked — in approval' : undefined}
      >
        Update Claim
      </button>
    </div>
  )
}

const CLAIM = {
  id: 'war-1',
  claim_no: 'WAR-2026-00001',
  serial_number: 'SN-12345',
  brand: 'Michelin',
  claim_status: 'Submitted',
  credit_amount: 4200,
  country: 'KSA',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Warranty claims approval wiring', () => {
  it('renders the Warranty Approval panel for a warranty claim record', async () => {
    api.listDefinitionsForEntity.mockResolvedValue([
      { id: 'wf-war', name: 'Warranty Claim Flow', active: true, entity_type: 'warranty_claim' },
    ])
    render(<WarrantyApprovalHarness claim={CLAIM} />)

    await waitFor(() => expect(screen.getByText('Warranty Approval')).toBeInTheDocument())
    // Panel resolves warranty-claim-scoped definitions and offers to start one.
    expect(api.listDefinitionsForEntity).toHaveBeenCalledWith('warranty_claim')
    expect(await screen.findByText('Warranty Claim Flow')).toBeInTheDocument()
  })

  it('leaves the edit fields and Update control enabled when no approval is running', async () => {
    render(<WarrantyApprovalHarness claim={CLAIM} />)
    await waitFor(() => expect(screen.getByText('Warranty Approval')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Update Claim' })).not.toBeDisabled()
    expect(screen.getByLabelText('Brand')).not.toBeDisabled()
    expect(screen.getByLabelText('Status')).not.toBeDisabled()
  })

  it('disables edit/save while the warranty workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wf-inst-1',
      status: 'pending',
      current_step: 0,
      steps: [{ name: 'Supervisor Review', approver_role: 'manager' }],
      entity_type: 'warranty_claim',
      entity_id: 'war-1',
    })
    render(<WarrantyApprovalHarness claim={CLAIM} />)

    // Once the panel reports the active status via onStateChange, the claim's
    // edit fields and Update control must be locked out.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Update Claim' })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: 'Update Claim' })).toHaveAttribute('title', 'Locked — in approval')
    expect(screen.getByLabelText('Brand')).toBeDisabled()
    expect(screen.getByLabelText('Status')).toBeDisabled()
  })

  it('disables edit/save once the warranty workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wf-inst-2',
      status: 'approved',
      current_step: 0,
      steps: [{ name: 'Final Approval', approver_role: 'manager' }],
      entity_type: 'warranty_claim',
      entity_id: 'war-1',
    })
    render(<WarrantyApprovalHarness claim={CLAIM} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Update Claim' })).toBeDisabled(),
    )
    expect(screen.getByLabelText('Brand')).toBeDisabled()
  })
})
