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
// KnowledgeBase document detail drawer: the panel drives a `wfLocked` flag via
// onStateChange, and the document's Delete control is disabled while the
// workflow is active/locked. Mocking the whole heavy KnowledgeBase page is
// impractical, so we smoke-test the added piece in isolation (mirrors
// workOrdersWorkflow.test.jsx).
function DocumentDeleteHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="document"
        entityId={record.id}
        entityLabel={record.title || record.doc_type || record.id}
        context={{
          doc_type: record.doc_type,
          asset_no: record.asset_no,
          tags: record.tags,
          site: record.site,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="Document Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>Delete</button>
    </div>
  )
}

const RECORD = {
  id: 'doc-1',
  title: 'Tyre Pressure SOP - Heavy Fleet',
  doc_type: 'sop',
  asset_no: 'RMX-042',
  tags: ['inflation', 'pressure'],
  site: 'Riyadh',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Document (Knowledge Base) approval wiring', () => {
  it('renders the Document Approval panel for a record', async () => {
    render(<DocumentDeleteHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Document Approval')).toBeInTheDocument(),
    )
  })

  it('keeps Delete enabled when there is no active approval', async () => {
    render(<DocumentDeleteHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Document Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables Delete and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w1', status: 'pending', current_step: 0,
      steps: [{ name: 'Compliance Officer', approver_role: 'compliance', require_signature: true }],
      entity_type: 'document', entity_id: 'doc-1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Compliance Officer', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<DocumentDeleteHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables Delete when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'document', entity_id: 'doc-1',
    })
    render(<DocumentDeleteHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled(),
    )
  })
})
