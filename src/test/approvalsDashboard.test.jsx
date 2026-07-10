import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'

// ── Mocks ────────────────────────────────────────────────────────────────────
// Mock the workflows API boundary — the page never touches Supabase directly.
vi.mock('../lib/api/workflows', () => ({
  getApprovalDashboard: vi.fn(),
  myPendingApprovals: vi.fn(),
  listStepEvents: vi.fn(),
  actOnWorkflow: vi.fn(),
  returnWorkflow: vi.fn(),
}))

// Auth is org-scoped server-side; the page only needs a session-shaped stub.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u-1', role: 'manager' }, user: { id: 'u-1' } }),
}))

// framer-motion pulls in animation timing that is irrelevant here; render plain.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props) => {
    const { children, ...rest } = props
    // Strip motion-only props that React would warn about.
    delete rest.initial; delete rest.animate; delete rest.exit; delete rest.transition
    return <div {...rest}>{children}</div>
  } }),
  AnimatePresence: ({ children }) => <>{children}</>,
}))

import * as workflows from '../lib/api/workflows'
import Approvals from '../pages/Approvals'

// ── Fixtures ──────────────────────────────────────────────────────────────────
const makeInstance = (over = {}) => ({
  id: 'wi-1',
  definition_name: 'Tyre Replacement Approval',
  entity_type: 'tyre_replacement',
  entity_id: '42',
  entity_label: 'Vehicle ABC-123 · Tyre Replacement',
  steps: [{ name: 'Supervisor Review', approver_role: 'manager', sla_hours: 24 }],
  current_step: 0,
  status: 'pending',
  started_at: '2026-07-01T10:00:00Z',
  step_started_at: '2026-07-01T10:00:00Z',
  completed_at: null,
  ...over,
})

const DASHBOARD = {
  metrics: {
    total_pending: 3,
    overdue: 1,
    returned: 2,
    rejected: 4,
    recently_approved: 5,
    avg_approval_time_hours: 8.5,
  },
  buckets: {
    pending: [makeInstance()],
    overdue: [makeInstance({ id: 'wi-2', entity_label: 'Vehicle XYZ-999 · Overdue', status: 'pending' })],
    returned: [makeInstance({ id: 'wi-3', entity_label: 'Returned Doc', status: 'returned' })],
    rejected: [makeInstance({ id: 'wi-4', entity_label: 'Rejected Doc', status: 'rejected' })],
    recently_approved: [makeInstance({ id: 'wi-5', entity_label: 'Approved Doc', status: 'approved', completed_at: '2026-07-05T12:00:00Z' })],
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  workflows.getApprovalDashboard.mockResolvedValue(DASHBOARD)
  workflows.myPendingApprovals.mockResolvedValue([{ id: 'wi-1' }])
  workflows.listStepEvents.mockResolvedValue([])
  workflows.actOnWorkflow.mockResolvedValue({ status: 'approved' })
  workflows.returnWorkflow.mockResolvedValue({ status: 'returned' })
})

afterEach(() => cleanup())

describe('Approvals dashboard', () => {
  it('renders the metric strip from the dashboard payload', async () => {
    render(<Approvals />)

    // Header renders immediately.
    expect(screen.getByText('Approval Dashboard')).toBeInTheDocument()

    // Metrics resolve after the RPC.
    await waitFor(() => expect(screen.getByText('8.5h')).toBeInTheDocument())

    // Avg approval time card + its label.
    expect(screen.getByText('Avg Approval Time')).toBeInTheDocument()
    // Rejected count (4) surfaces in the metric strip.
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('renders each bucket with its instances and switches on tab click', async () => {
    render(<Approvals />)

    // Default (pending) bucket row.
    await waitFor(() =>
      expect(screen.getByText('Vehicle ABC-123 · Tyre Replacement')).toBeInTheDocument(),
    )

    // Switch to the Rejected bucket.
    fireEvent.click(screen.getByRole('button', { name: /Rejected/i }))
    await waitFor(() => expect(screen.getByText('Rejected Doc')).toBeInTheDocument())

    // Switch to Recently Approved.
    fireEvent.click(screen.getByRole('button', { name: /Recently Approved/i }))
    await waitFor(() => expect(screen.getByText('Approved Doc')).toBeInTheDocument())
  })

  it('opens the detail drawer and loads the approval trail on row click', async () => {
    render(<Approvals />)
    await waitFor(() =>
      expect(screen.getByText('Vehicle ABC-123 · Tyre Replacement')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByText('Vehicle ABC-123 · Tyre Replacement'))

    // Trail fetched for the opened instance.
    await waitFor(() => expect(workflows.listStepEvents).toHaveBeenCalledWith('wi-1'))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    // Actionable instance shows the Decision panel + the immutable history section.
    expect(within(dialog).getByText('Decision')).toBeInTheDocument()
    expect(within(dialog).getByText('Approval History')).toBeInTheDocument()
  })

  it('filters the list by search term', async () => {
    render(<Approvals />)
    await waitFor(() =>
      expect(screen.getByText('Vehicle ABC-123 · Tyre Replacement')).toBeInTheDocument(),
    )

    fireEvent.change(screen.getByPlaceholderText(/Search entity or workflow/i), {
      target: { value: 'nonexistent-entity' },
    })

    await waitFor(() =>
      expect(screen.getByText(/No workflows match your filters/i)).toBeInTheDocument(),
    )
  })

  it('shows the friendly error state when getApprovalDashboard rejects', async () => {
    workflows.getApprovalDashboard.mockRejectedValueOnce(
      new Error('function approval_dashboard does not exist'),
    )
    render(<Approvals />)

    await waitFor(() =>
      expect(screen.getByText(/Approval engine not yet provisioned/i)).toBeInTheDocument(),
    )
    // Retry affordance is present and the raw message is surfaced for diagnostics.
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
    expect(screen.getByText(/approval_dashboard does not exist/i)).toBeInTheDocument()
  })

  it('recovers from the error state on Retry', async () => {
    workflows.getApprovalDashboard
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(DASHBOARD)

    render(<Approvals />)
    await waitFor(() =>
      expect(screen.getByText(/Approval engine not yet provisioned/i)).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: /Retry/i }))
    await waitFor(() =>
      expect(screen.getByText('Vehicle ABC-123 · Tyre Replacement')).toBeInTheDocument(),
    )
  })
})
