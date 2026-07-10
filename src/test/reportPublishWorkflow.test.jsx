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
// ScheduledReports edit modal: the panel drives a `wfLocked` flag via
// onStateChange, and the schedule's Save control is disabled while the workflow
// is active/locked. Mocking the whole heavy ScheduledReports page is impractical,
// so we smoke-test the added piece in isolation (mirrors workOrdersWorkflow.test.jsx).
function ReportPublishEditHarness({ record }) {
  const [wfLocked, setWfLocked] = useState(false)
  return (
    <div>
      <EntityApprovalPanel
        entityType="report_publish"
        entityId={record.id}
        entityLabel={record.name || record.report_type || record.id}
        context={{
          report_type: record.report_type,
          frequency: record.frequency,
          recipients: record.recipients,
          status: record.active ? 'active' : 'inactive',
          site: record.site,
        }}
        onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
        title="Report Publishing Approval"
      />
      {wfLocked && <p>Locked — in approval</p>}
      <button disabled={wfLocked}>Save Schedule</button>
    </div>
  )
}

const RECORD = {
  id: 'rs-1',
  name: 'Weekly Executive Summary',
  report_type: 'executive',
  frequency: 'weekly',
  recipients: ['ceo@fleet.com', 'ops@fleet.com'],
  active: true,
  site: 'Riyadh',
}

beforeEach(() => {
  vi.clearAllMocks()
  api.getWorkflowForEntity.mockResolvedValue(null)
  api.listDefinitionsForEntity.mockResolvedValue([])
  api.listStepEvents.mockResolvedValue([])
  api.myPendingApprovals.mockResolvedValue([])
})

describe('Report Publishing approval wiring', () => {
  it('renders the Report Publishing Approval panel for a schedule', async () => {
    render(<ReportPublishEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Report Publishing Approval')).toBeInTheDocument(),
    )
  })

  it('keeps Save enabled when there is no active approval', async () => {
    render(<ReportPublishEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByText('Report Publishing Approval')).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Save Schedule' })).not.toBeDisabled()
    expect(screen.queryByText(/Locked — in approval/)).not.toBeInTheDocument()
  })

  it('disables Save and shows the lock hint when the workflow is active (pending)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w1', status: 'pending', current_step: 0,
      steps: [{ name: 'Executive Sign-off', approver_role: 'executive', require_signature: true }],
      entity_type: 'report_publish', entity_id: 'rs-1',
    })
    api.listStepEvents.mockResolvedValue([
      { id: 1, action: 'started', step_name: 'Executive Sign-off', created_at: '2026-07-10T09:00:00Z' },
    ])
    render(<ReportPublishEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Schedule' })).toBeDisabled(),
    )
    expect(screen.getByText(/Locked — in approval/)).toBeInTheDocument()
  })

  it('disables Save when the workflow is approved (locked)', async () => {
    api.getWorkflowForEntity.mockResolvedValue({
      id: 'w2', status: 'approved', current_step: 0,
      steps: [{ name: 'X', approver_role: 'admin' }],
      entity_type: 'report_publish', entity_id: 'rs-1',
    })
    render(<ReportPublishEditHarness record={RECORD} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Schedule' })).toBeDisabled(),
    )
  })
})
