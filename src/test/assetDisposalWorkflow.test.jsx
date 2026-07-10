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

// EntityApprovalPanel pulls in useLanguage-free children, but ApprovalStatusBadge
// etc. are self-contained. No i18n provider needed for the smoke test.
import * as api from '../lib/api/workflows'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'

// Minimal harness that reproduces exactly the gating wiring added to the Asset
// Management disposal surface (the asset detail drawer): the panel drives a
// `wfLocked` flag via onStateChange, and the record's disposal/edit control is
// disabled while the workflow is active/locked. Mocking the whole heavy
// AssetManagement page is impractical, so we smoke-test the added piece in
// isolation (mirrors workOrdersWorkflow.test.jsx).
function AssetDisposalHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="asset_disposal"
        entityId={record.id ?? record.asset_no}
        entityLabel={record.asset_no || record.id}
        context={{
          book_value: Number(record._ytdCost) || 0,
          disposal_reason: record.active === false ? 'inactive' : null,
          asset_type: record.vehicle_type || null,
          site: record.site || null,
          country: record.country || null,
          worst_risk: record._worstRisk || null,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="Asset Disposal Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>Edit asset</button>
    </div>
  )
}

const RECORD = {
  id: 'asset-1',
  asset_no: 'TRK-4471',
  vehicle_type: 'Tipper',
  site: 'Riyadh',
  country: 'KSA',
  active: true,
  _ytdCost: 8200, // book_value > 5,000 → Fleet Manager step (smart rule)
  _worstRisk: 'High',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Asset Disposal approval wiring', () => {
  it('renders the Asset Disposal Approval panel for an asset', async () => {
    render(<AssetDisposalHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Asset Disposal Approval')).toBeInTheDocument(),
    )
  })

  it('keeps the Edit asset control enabled when there is no active approval', async () => {
    render(<AssetDisposalHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Asset Disposal Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Edit asset' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables Edit and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w1', status: 'pending', current_step: 0,
      steps: [{ name: 'Fleet Manager', approver_role: 'fleet_manager', require_signature: true }],
      entity_type: 'asset_disposal', entity_id: 'asset-1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Fleet Manager', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<AssetDisposalHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit asset' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables Edit when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'asset_disposal', entity_id: 'asset-1',
    })
    render(<AssetDisposalHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit asset' })).toBeDisabled(),
    )
  })
})
