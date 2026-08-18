import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * What the CARDS actually render.
 *
 * Two live templates store the lucide component name 'ClipboardCheck' in
 * `checklist_templates.icon`, and the card used to print that string as text -
 * so a checklist card literally read "ClipboardCheck". These tests drive the
 * real Checklists page and assert (a) no raw icon name ever reaches the screen,
 * (b) an emoji still renders as an emoji, and (c) the "For:" chip appears only
 * for a checklist that names roles - a chip reading "Everyone" on every card is
 * noise, so its ABSENCE is part of the contract.
 */

const TEMPLATES = [
  // The real shape of the seeded rows: a lucide component name, not an emoji.
  {
    id: 't-lucide', name: 'Workshop Electrical Sheet', category: 'Workshop',
    icon: 'ClipboardCheck', version: 1, fields: [], assignee_roles: ['Mechanic', 'Electrician'],
  },
  // Somebody's emoji choice, which must survive untouched.
  {
    id: 't-emoji', name: 'Daily Vehicle Check', category: 'Vehicle Inspection',
    icon: '🚚', version: 1, fields: [], assignee_roles: ['Driver'],
  },
  // Untargeted: the pre-V591 state every existing template is in.
  {
    id: 't-open', name: 'General Safety Walk', category: 'Safety',
    icon: null, version: 1, fields: [], assignee_roles: null,
  },
]

vi.mock('react-router-dom', () => ({
  Link: ({ children, ...p }) => <a {...p}>{children}</a>,
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(''), vi.fn()],
}))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: 'Admin' }, isSuperAdmin: false }),
}))
vi.mock('../contexts/TenantContext', () => ({ useTenant: () => ({ branding: null }) }))
vi.mock('../lib/api/checklists', () => ({
  listTemplates: () => Promise.resolve(TEMPLATES),
  listSubmissions: () => Promise.resolve([]),
  getSubmission: vi.fn(),
}))
vi.mock('../lib/checklistPdf', () => ({ renderChecklistPdf: vi.fn() }))
vi.mock('../components/checklist/ChecklistViewerDrawer', () => ({ default: () => null }))
vi.mock('../components/checklist/MonthlyGridPanel', () => ({ default: () => null }))

import Checklists from '../pages/Checklists'

describe('Checklists template cards', () => {
  it('never prints a raw icon name as text', async () => {
    render(<Checklists />)
    await waitFor(() => expect(screen.getByText('Workshop Electrical Sheet')).toBeInTheDocument())
    // The bug, stated as an assertion: the stored value must not be readable.
    expect(screen.queryByText(/ClipboardCheck/)).toBeNull()
  })

  it('still renders an emoji icon as the emoji', async () => {
    render(<Checklists />)
    await waitFor(() => expect(screen.getByText('Daily Vehicle Check')).toBeInTheDocument())
    expect(screen.getByText('🚚')).toBeInTheDocument()
  })

  it('shows a For: chip naming every targeted role', async () => {
    render(<Checklists />)
    await waitFor(() => expect(screen.getByText('Workshop Electrical Sheet')).toBeInTheDocument())
    expect(screen.getByText(/For: Mechanic, Electrician/)).toBeInTheDocument()
    expect(screen.getByText(/For: Driver/)).toBeInTheDocument()
  })

  it('shows NO chip for an untargeted checklist', async () => {
    render(<Checklists />)
    await waitFor(() => expect(screen.getByText('General Safety Walk')).toBeInTheDocument())
    // Exactly two chips for three cards: the untargeted one contributes none.
    expect(screen.queryAllByText(/^For: /)).toHaveLength(2)
    expect(screen.queryByText(/Everyone/)).toBeNull()
  })
})
