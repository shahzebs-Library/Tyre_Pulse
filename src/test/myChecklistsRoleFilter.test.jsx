import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * "My Checklists" must show a person the checklists written FOR THEM.
 *
 * Assignments only exist once a schedule generates them, and no schedule exists
 * yet, so the published templates are what answers the question today. A
 * mechanic must see the workshop sheet and the untargeted safety walk, and must
 * NOT be offered the drivers' sheet; an Admin oversees the programme and sees
 * everything. This is TARGETING - it decides what a person is offered, not what
 * they could read.
 */

const TEMPLATES = [
  { id: 't-mech', name: 'Workshop Electrical Sheet', category: 'Workshop', icon: 'ClipboardCheck', fields: [], assignee_roles: ['Mechanic', 'Electrician'] },
  { id: 't-drv', name: 'Daily Vehicle Check', category: 'Vehicle Inspection', icon: '🚚', fields: [], assignee_roles: ['Driver'] },
  { id: 't-all', name: 'General Safety Walk', category: 'Safety', icon: null, fields: [], assignee_roles: null },
]

const ASSIGNMENTS = [
  { id: 'a-mech', template_id: 't-mech', template_name: 'Workshop Electrical Sheet', assignee_role: 'Mechanic', due_date: '2026-08-18', status: 'pending' },
  { id: 'a-drv', template_id: 't-drv', template_name: 'Daily Vehicle Check', assignee_role: 'Driver', due_date: '2026-08-18', status: 'pending' },
  { id: 'a-open', template_id: 't-all', template_name: 'General Safety Walk', assignee_role: null, due_date: '2026-08-18', status: 'pending' },
]

let ROLE = 'Mechanic'
let SUPER = false

vi.mock('react-router-dom', () => ({
  Link: ({ children, ...p }) => <a {...p}>{children}</a>,
  useNavigate: () => vi.fn(),
}))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'u1', role: ROLE }, isSuperAdmin: SUPER }),
}))
vi.mock('../lib/api/checklistSchedules', () => ({
  listAssignments: () => Promise.resolve(ASSIGNMENTS),
  skipAssignment: vi.fn(),
  generateNow: vi.fn(),
}))
vi.mock('../lib/api/checklists', () => ({
  listTemplates: () => Promise.resolve(TEMPLATES),
}))

import MyChecklists from '../pages/MyChecklists'

async function open(role, isSuper = false) {
  ROLE = role; SUPER = isSuper
  render(<MyChecklists />)
  await waitFor(() => expect(screen.getAllByText('General Safety Walk').length).toBeGreaterThan(0))
}

describe('MyChecklists role targeting', () => {
  it('offers a Mechanic the workshop sheet and the untargeted walk, not the drivers sheet', async () => {
    await open('Mechanic')
    expect(screen.getAllByText('Workshop Electrical Sheet').length).toBeGreaterThan(0)
    expect(screen.getAllByText('General Safety Walk').length).toBeGreaterThan(0)
    expect(screen.queryByText('Daily Vehicle Check')).toBeNull()
  })

  it('offers a Driver their own sheet and not the workshop one', async () => {
    await open('Driver')
    expect(screen.getAllByText('Daily Vehicle Check').length).toBeGreaterThan(0)
    expect(screen.queryByText('Workshop Electrical Sheet')).toBeNull()
  })

  it('an Admin oversees the programme and still sees every checklist', async () => {
    await open('Admin')
    expect(screen.getAllByText('Workshop Electrical Sheet').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Daily Vehicle Check').length).toBeGreaterThan(0)
  })

  it('a super admin sees everything whatever their role reads', async () => {
    await open('Reporter', true)
    expect(screen.getAllByText('Workshop Electrical Sheet').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Daily Vehicle Check').length).toBeGreaterThan(0)
  })

  it('names who a targeted checklist is for, and says nothing for an untargeted one', async () => {
    await open('Mechanic')
    expect(screen.getAllByText(/For: Mechanic, Electrician/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/For: Everyone/)).toBeNull()
  })

  it('does not print a raw lucide icon name on the card', async () => {
    await open('Mechanic')
    expect(screen.queryByText(/ClipboardCheck/)).toBeNull()
  })
})
