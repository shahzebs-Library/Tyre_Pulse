import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ── Mocks ────────────────────────────────────────────────────────────────────
// The page never touches Supabase directly — it talks to two API boundaries:
// the V95 workflow engine (`workflows`) and the aggregation service (`queue`).
vi.mock('../lib/api/workflows', () => ({
  getApprovalDashboard: vi.fn(),
  myPendingApprovals: vi.fn(),
  listStepEvents: vi.fn(),
  actOnWorkflow: vi.fn(),
  returnWorkflow: vi.fn(),
}))

vi.mock('../lib/api/approvalsQueue', () => ({
  listAccidentClosures: vi.fn(),
  listChecklistApprovals: vi.fn(),
  countDataIntakePending: vi.fn(),
  approveAccidentClosure: vi.fn(),
  rejectAccidentClosure: vi.fn(),
  decideChecklist: vi.fn(),
}))

// Auth is org-scoped server-side; the page only needs a session-shaped stub.
// An elevated role unlocks the non-workflow approve/reject actions.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u-1', role: 'Manager', full_name: 'Mona Manager' }, user: { id: 'u-1' } }),
}))

// Country scope defaults to "All" without a provider.
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'All' }),
}))

// framer-motion pulls in animation timing that is irrelevant here; render plain.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props) => {
    const { children, ...rest } = props
    delete rest.initial; delete rest.animate; delete rest.exit; delete rest.transition
    return <div {...rest}>{children}</div>
  } }),
  AnimatePresence: ({ children }) => <>{children}</>,
}))

import * as workflows from '../lib/api/workflows'
import * as queue from '../lib/api/approvalsQueue'
import Approvals from '../pages/Approvals'

const renderPage = () => render(<MemoryRouter><Approvals /></MemoryRouter>)

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
  metrics: { total_pending: 1, overdue: 1, returned: 2, rejected: 4, recently_approved: 5 },
  buckets: {
    pending: [makeInstance()],
    overdue: [makeInstance({ id: 'wi-2', entity_label: 'Vehicle XYZ-999 · Overdue', status: 'pending' })],
    returned: [makeInstance({ id: 'wi-3', entity_label: 'Returned Doc', status: 'returned' })],
    rejected: [makeInstance({ id: 'wi-4', entity_label: 'Rejected Doc', status: 'rejected' })],
    recently_approved: [makeInstance({ id: 'wi-5', entity_label: 'Approved Doc', status: 'approved', completed_at: '2026-07-05T12:00:00Z' })],
  },
}

const CLOSURE = {
  id: 'acc-1', asset_no: 'TRK-01', driver_name: 'Sam', accident_type: 'Collision',
  severity: 'High', incident_date: '2026-06-20', site: 'Riyadh', country: 'KSA',
  estimated_damage_cost: 12000, close_request_note: 'Repairs complete', close_requested_at: '2026-07-02T09:00:00Z',
}

const CHECKLIST = {
  id: 'cl-1', title: 'Daily Safety Check', template_name: 'Safety', asset_no: 'TRK-02',
  site: 'Jeddah', country: 'KSA', submitted_at: '2026-07-03T08:00:00Z', submitted_by: 'u-9',
  score_pct: 88, score_passed: true, approval_status: 'pending',
}

beforeEach(() => {
  vi.clearAllMocks()
  workflows.getApprovalDashboard.mockResolvedValue(DASHBOARD)
  workflows.myPendingApprovals.mockResolvedValue([{ id: 'wi-1' }])
  workflows.listStepEvents.mockResolvedValue([])
  workflows.actOnWorkflow.mockResolvedValue({ status: 'approved' })
  workflows.returnWorkflow.mockResolvedValue({ status: 'returned' })
  queue.listAccidentClosures.mockResolvedValue([CLOSURE])
  queue.listChecklistApprovals.mockResolvedValue([CHECKLIST])
  queue.countDataIntakePending.mockResolvedValue(2)
  queue.approveAccidentClosure.mockResolvedValue(undefined)
  queue.rejectAccidentClosure.mockResolvedValue(undefined)
  queue.decideChecklist.mockResolvedValue({ id: 'cl-1', approval_status: 'approved' })
})

afterEach(() => cleanup())

describe('Unified approval dashboard', () => {
  it('renders the unified metric strip across all sources', async () => {
    renderPage()
    expect(screen.getByText('Approval Dashboard')).toBeInTheDocument()

    // Source-specific metric cards exist.
    await waitFor(() => expect(screen.getByText('Workflows')).toBeInTheDocument())
    expect(screen.getByText('Closures')).toBeInTheDocument()
    expect(screen.getByText('Checklists')).toBeInTheDocument()

    // total_pending = 1 workflow + 1 closure + 1 checklist = 3.
    const pendingBadge = screen.getByText('3 pending')
    expect(pendingBadge).toBeInTheDocument()
  })

  it('merges workflow, accident-closure and checklist items into the pending queue', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Vehicle ABC-123 · Tyre Replacement')).toBeInTheDocument())
    expect(screen.getByText(/Closure request — TRK-01 · Collision/)).toBeInTheDocument()
    expect(screen.getByText('Daily Safety Check')).toBeInTheDocument()
  })

  it('deep-links to the data-intake approvals surface when batches are pending', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/2 data-intake batches awaiting approval/i)).toBeInTheDocument())
  })

  it('filters the queue by approval type', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Daily Safety Check')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/Filter by approval type/i), {
      target: { value: 'accident_closure' },
    })

    await waitFor(() => expect(screen.queryByText('Vehicle ABC-123 · Tyre Replacement')).not.toBeInTheDocument())
    expect(screen.queryByText('Daily Safety Check')).not.toBeInTheDocument()
    expect(screen.getByText(/Closure request — TRK-01 · Collision/)).toBeInTheDocument()
  })

  it('switches to workflow-only lifecycle buckets', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Vehicle ABC-123 · Tyre Replacement')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Rejected/i }))
    await waitFor(() => expect(screen.getByText('Rejected Doc')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Recently Approved/i }))
    await waitFor(() => expect(screen.getByText('Approved Doc')).toBeInTheDocument())
  })

  it('opens the workflow detail drawer and loads the approval trail', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Vehicle ABC-123 · Tyre Replacement')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Vehicle ABC-123 · Tyre Replacement'))
    await waitFor(() => expect(workflows.listStepEvents).toHaveBeenCalledWith('wi-1'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Decision')).toBeInTheDocument()
    expect(within(dialog).getByText('Approval History')).toBeInTheDocument()
  })

  it('approves an accident closure through the RLS-enforced RPC', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/Closure request — TRK-01/)).toBeInTheDocument())

    fireEvent.click(screen.getByText(/Closure request — TRK-01/))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Approve/i }))

    await waitFor(() => expect(queue.approveAccidentClosure).toHaveBeenCalledWith('acc-1'))
  })

  it('decides a checklist submission (approve locks it)', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Daily Safety Check')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Daily Safety Check'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Approve/i }))

    await waitFor(() => expect(queue.decideChecklist).toHaveBeenCalledWith('cl-1', expect.objectContaining({ approved: true })))
  })

  it('filters the list by search term with an honest empty state', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Vehicle ABC-123 · Tyre Replacement')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText(/Search entity, workflow or checklist/i), {
      target: { value: 'nonexistent-entity' },
    })

    await waitFor(() => expect(screen.getByText(/No approvals match your filters/i)).toBeInTheDocument())
  })

  it('degrades gracefully when only the workflow engine is down', async () => {
    workflows.getApprovalDashboard.mockRejectedValueOnce(new Error('function approval_dashboard does not exist'))
    renderPage()

    // Non-workflow sources still render, with a degraded banner (not a dead page).
    await waitFor(() => expect(screen.getByText(/Workflow engine is unavailable/i)).toBeInTheDocument())
    expect(screen.getByText(/Closure request — TRK-01/)).toBeInTheDocument()
  })

  it('shows the fatal error state only when every source fails', async () => {
    workflows.getApprovalDashboard.mockRejectedValueOnce(new Error('boom'))
    queue.listAccidentClosures.mockRejectedValueOnce(new Error('boom'))
    queue.listChecklistApprovals.mockRejectedValueOnce(new Error('boom'))
    renderPage()

    await waitFor(() => expect(screen.getByText(/Approval services unavailable/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
  })
})
