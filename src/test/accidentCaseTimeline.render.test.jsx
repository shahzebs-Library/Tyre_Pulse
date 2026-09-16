import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// Renders the REAL /accidents/:id/timeline page over a mocked feed and pins the
// M1 parity contract: SLA-met badge, a chevron on every row opening the detail
// drawer, the delivery-log column set, honest status labels, the sub-detail
// chips, the three tabs + five filters, the two action buttons, and the
// "Manage recipient groups" row being live for an Admin and disabled for others.

const ACC = {
  id: 'acc-1', reference_no: 'ACC-2026-0148', asset_no: 'CP-045', country: 'KSA', site: 'NHC',
  incident_date: '2026-08-28T09:12:00Z', created_at: '2026-08-28T09:12:00Z', status: 'under_review',
}

const h = vi.hoisted(() => ({ navSpy: vi.fn(), profile: { id: 'u1', role: 'Manager', full_name: 'Ops Manager' } }))

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'acc-1' }),
  useNavigate: () => h.navSpy,
}))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: h.profile }) }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      const b = { select: () => b, eq: () => b, single: () => Promise.resolve({ data: ACC, error: null }) }
      return b
    },
  },
}))
vi.mock('../components/accidents/CaseSlaHeader', () => ({ default: () => <div data-testid="sla-header" /> }))
vi.mock('../lib/api/accidentCase', () => ({ loadCase: () => Promise.resolve({ workstreams: [] }) }))
vi.mock('../lib/api/accidentCommunications', () => ({
  logCommunication: vi.fn(() => Promise.resolve({})),
  COMMS_CHANNELS: ['in_app', 'email_out', 'comment'],
}))

const FEED = {
  entries: [
    { id: 'genesis-acc-1', at: '2026-08-28T09:12:00Z', category: 'actions', title: 'Accident reported', subtitle: 'by Ibrahim Noor', detail: 'GPS · 3 photos attached', status: 'completed', iconKey: 'report', actor: 'Ibrahim Noor', relatedTab: 'overview', chips: ['Verified 2/3'], durationMs: null },
    { id: 'comm-c1', at: '2026-08-28T10:05:00Z', category: 'emails', title: 'Documents package sent', subtitle: 'to Insurance', detail: 'Email', status: 'completed', iconKey: 'mail', actor: 'Ms. Fatima', relatedTab: 'log', chips: ['3 recipients'], durationMs: 53 * 60000 },
    { id: 'sla-s1', at: '2026-08-28T12:00:00Z', category: 'sla', title: 'Vendor receipt', subtitle: '', detail: 'SLA met', status: 'completed', iconKey: 'sla', slaMet: true, actor: null, relatedTab: 'handover', chips: [], durationMs: 115 * 60000 },
  ],
  notifications: [
    { id: 'c1', occurred_at: '2026-08-28T10:05:00Z', channel: 'email_out', direction: 'outbound', subject: 'Documents package sent', to_party: 'Insurance', workstream_key: 'insurance' },
    { id: 'c2', occurred_at: '2026-08-28T09:40:00Z', channel: 'comment', direction: 'internal', subject: 'Timeline note', author_name: 'Mr. Ajay' },
  ],
  participants: [{ name: 'Ms. Fatima', roles: ['Recipient'] }],
  groupCounts: new Map([['insurance', 3]]),
  evidence: [],
}
vi.mock('../lib/api/caseTimelineFeed', () => ({ loadCaseTimeline: () => Promise.resolve(FEED) }))

import AccidentCaseTimeline from '../pages/AccidentCaseTimeline'

async function renderPage() {
  render(<AccidentCaseTimeline />)
  await screen.findByRole('heading', { name: /Case timeline/i })
}

describe('AccidentCaseTimeline (/accidents/:id/timeline) - M1 parity', () => {
  beforeEach(() => { h.navSpy.mockClear(); h.profile = { id: 'u1', role: 'Manager', full_name: 'Ops Manager' } })

  it('shows the three tabs, the five filters and the two action buttons', async () => {
    await renderPage()
    for (const t of ['Timeline', 'Notifications', 'Participants']) expect(screen.getByRole('tab', { name: t })).toBeInTheDocument()
    for (const f of ['All', 'Actions', 'Documents', 'SLA', 'Emails']) expect(screen.getByRole('button', { name: f })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add timeline note/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Notify participants/i })).toBeInTheDocument()
  })

  it('renders an "SLA met" badge on the met SLA row only, plus the sub-detail chips', async () => {
    await renderPage()
    const badges = screen.getAllByTestId('sla-met-badge')
    expect(badges).toHaveLength(1)
    expect(badges[0]).toHaveTextContent('SLA met')
    expect(screen.getByText('Verified 2/3')).toBeInTheDocument()
    expect(screen.getByText('3 recipients')).toBeInTheDocument()
  })

  it('every timeline row carries a chevron that opens the right-hand detail drawer with actor + related tab', async () => {
    await renderPage()
    const rows = screen.getAllByTestId('timeline-row')
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(within(row).getByRole('button', { name: /Open details for/i })).toBeInTheDocument()

    fireEvent.click(within(rows[1]).getByRole('button', { name: /Open details for Documents package sent/i }))
    const drawer = await screen.findByRole('dialog', { name: /Timeline entry details/i })
    expect(within(drawer).getByText('Ms. Fatima')).toBeInTheDocument()
    fireEvent.click(within(drawer).getByRole('button', { name: /Open related tab/i }))
    expect(h.navSpy).toHaveBeenCalledWith('/accidents/acc-1?tab=log', { state: { openTab: 'log' } })
  })

  it('delivery log = Trigger | Recipients | Channel | Status | Time | row menu, with honest labels', async () => {
    await renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Notifications' }))
    const table = await screen.findByTestId('delivery-log')
    const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent.trim())
    expect(headers).toEqual(['Trigger', 'Recipients', 'Channel', 'Status', 'Time', 'Actions'])

    // Group + derivable count; a manual note has no recipient -> Not set.
    expect(within(table).getByText('Insurance · 3')).toBeInTheDocument()
    expect(within(table).getByText('Not set')).toBeInTheDocument()
    // Channel tokens are plain words; status is Sent / Logged, never a fake Delivered n/n.
    expect(within(table).getByText('Email')).toBeInTheDocument()
    expect(within(table).getByText('Comment')).toBeInTheDocument()
    expect(within(table).getByText('Sent')).toBeInTheDocument()
    expect(within(table).getByText('Logged')).toBeInTheDocument()
    expect(within(table).queryByText(/Delivered \d+\/\d+/)).toBeNull()

    // Row menu: copy / open related tab.
    const menus = within(table).getAllByRole('button', { name: /Row actions/i })
    expect(menus).toHaveLength(2)
    fireEvent.click(menus[0])
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /Copy/i })).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Open related tab/i }))
    expect(h.navSpy).toHaveBeenCalledWith('/accidents/acc-1?tab=insurance_claim', { state: { openTab: 'insurance_claim' } })
  })

  it('"Manage recipient groups" is disabled with a tooltip for a non-admin', async () => {
    await renderPage()
    const row = screen.getByRole('button', { name: /Manage recipient groups/i })
    expect(row).toBeDisabled()
    expect(row.getAttribute('title')).toMatch(/Only an Admin/i)
    expect(screen.getByText(/Recipients are set by Admin per event and role/i)).toBeInTheDocument()
  })

  it('"Manage recipient groups" routes an Admin to the accident routing rules', async () => {
    h.profile = { id: 'a1', role: 'Admin' }
    await renderPage()
    const row = screen.getByRole('button', { name: /Manage recipient groups/i })
    expect(row).not.toBeDisabled()
    fireEvent.click(row)
    await waitFor(() => expect(h.navSpy).toHaveBeenCalledWith('/accident-workflow-settings'))
  })
})
