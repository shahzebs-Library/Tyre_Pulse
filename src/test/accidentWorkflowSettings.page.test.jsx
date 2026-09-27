import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({
  depts: [{ id: 1, name: 'HSE', code: 'HSE', active: true, sort_order: 1 }],
  rules: [{ id: 'r1', name: 'Silent rule', active: true, priority: 5, departments: [], to_roles: [] }],
  templates: [{ id: 't1', key: 'reported', name: 'Reported', subject: 'x', body_html: '{{site}}', active: true, approved: true }],
  deptError: null,
  setEnabled: vi.fn(),
}))

vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'Admin' }, isSuperAdmin: false }) }))
vi.mock('../components/ui/PageHeader', () => ({ default: ({ title }) => <h1>{title}</h1> }))
vi.mock('../lib/api/accidentWorkflow', () => ({
  listDepartments: async () => { if (h.deptError) throw h.deptError; return h.depts },
  createDepartment: vi.fn(), updateDepartment: vi.fn(), deleteDepartment: vi.fn(),
  listRoutingRules: async () => h.rules,
  createRoutingRule: vi.fn(), updateRoutingRule: vi.fn(), deleteRoutingRule: vi.fn(),
  listEmailTemplates: async () => h.templates,
  updateEmailTemplate: vi.fn(),
  getAccidentEmailsEnabled: async () => false,
  setAccidentEmailsEnabled: (...a) => h.setEnabled(...a),
  getAccidentEmailConfig: async () => ({ to: 'ops@example.com', cc: '', subjectPrefix: '' }),
  setAccidentEmailConfig: vi.fn(),
}))

import AccidentWorkflowSettings from '../pages/AccidentWorkflowSettings'

function mount(path = '/accident-workflow-settings') {
  return render(<MemoryRouter initialEntries={[path]}><AccidentWorkflowSettings /></MemoryRouter>)
}

beforeEach(() => { h.deptError = null; h.setEnabled.mockReset() })

describe('AccidentWorkflowSettings page', () => {
  it('shows the KPI strip and flags a rule that reaches nobody', async () => {
    mount()
    expect(await screen.findAllByText('1 of 1', {}, { timeout: 5000 })).toHaveLength(2)
    expect(screen.getByText('Templates ready')).toBeInTheDocument()
    expect(await screen.findByText(/reach nobody/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Departments/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('opens the tab named in ?tab= and keeps delivery OFF until confirmed', async () => {
    mount('/accident-workflow-settings?tab=delivery')
    const toggle = await screen.findByRole('switch', { name: 'Accident email delivery' })
    await waitFor(() => expect(toggle).toBeEnabled())
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    expect(await screen.findByText('Turn on emails')).toBeInTheDocument()
    expect(h.setEnabled).not.toHaveBeenCalled()
  })

  it('renders a failed section read as an error with Retry, not as empty', async () => {
    h.deptError = { code: '42501', message: 'permission denied' }
    mount()
    expect(await screen.findByText('This section could not be loaded.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument()
    expect(screen.queryByText('No departments configured yet.')).not.toBeInTheDocument()
  })
})
