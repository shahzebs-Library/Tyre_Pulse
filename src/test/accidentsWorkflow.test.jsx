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

// A minimal harness that reproduces exactly how Accidents.jsx wires the
// approval engine into its accident detail view: it renders the shared
// EntityApprovalPanel for entityType="accident" and gates an accident edit
// control on the panel's onStateChange(isActive/isLocked) callback. Rendering
// the full Accidents page (AuthContext, SettingsContext, router, supabase,
// chart.js, ~20 API modules) is impractical for a unit test, so we smoke-test
// the added integration piece in isolation — the same pattern the page uses.
function AccidentApprovalHarness({ accident }) {
  const [wfLocked, setWfLocked] = useState({ isActive: false, isLocked: false, status: null })
  const detailLocked = wfLocked.isActive || wfLocked.isLocked
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
        disabled={detailLocked}
        title={detailLocked ? 'Locked — in approval' : undefined}
      >
        Edit
      </button>
      <EntityApprovalPanel
        entityType="accident"
        entityId={accident.id}
        entityLabel={accident.insurance_claim_no || accident.policy_no || accident.asset_no || accident.id}
        context={{
          severity: accident.severity,
          is_major: ['Major', 'Total Loss'].includes(accident.severity),
          estimated_cost: Number(accident.repair_cost) || 0,
          repair_cost: Number(accident.repair_cost) || 0,
          country: accident.country,
        }}
        title="Accident Approval"
        onStateChange={handleWfStateChange}
      />
    </div>
  )
}

const ACCIDENT = {
  id: 'acc-1',
  insurance_claim_no: 'CLM-2026-001',
  asset_no: 'TM-001',
  severity: 'Major',
  repair_cost: 8000,
  country: 'KSA',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Accidents approval wiring', () => {
  it('renders the Accident Approval panel for an accident record', async () => {
    api.listDefinitionsForEntity.mockResolvedValue([
      { id: 'wf-acc', name: 'Accident Claim Flow', active: true, entity_type: 'accident' },
    ])
    render(<AccidentApprovalHarness accident={ACCIDENT} />)

    await waitFor(() => expect(screen.getByText('Accident Approval')).toBeInTheDocument())
    // Panel resolves accident-scoped definitions and offers to start one.
    expect(api.listDefinitionsForEntity).toHaveBeenCalledWith('accident')
    expect(await screen.findByText('Accident Claim Flow')).toBeInTheDocument()
  })

  it('leaves the edit control enabled when no approval is running', async () => {
    render(<AccidentApprovalHarness accident={ACCIDENT} />)
    await waitFor(() => expect(screen.getByText('Accident Approval')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Edit' })).not.toBeDisabled()
  })

  it('disables the edit control while the accident workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wf-inst-1',
      status: 'pending',
      current_step: 0,
      steps: [{ name: 'Insurance Approval', approver_role: 'manager' }],
      entity_type: 'accident',
      entity_id: 'acc-1',
    })
    render(<AccidentApprovalHarness accident={ACCIDENT} />)

    // Once the panel reports the active status up via onStateChange, the
    // accident's edit control must be locked out.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveAttribute('title', 'Locked — in approval')
  })

  it('disables the edit control once the accident workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'wf-inst-2',
      status: 'approved',
      current_step: 0,
      steps: [{ name: 'Final Inspection', approver_role: 'manager' }],
      entity_type: 'accident',
      entity_id: 'acc-1',
    })
    render(<AccidentApprovalHarness accident={ACCIDENT} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled(),
    )
  })
})
