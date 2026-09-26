import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('react-chartjs-2', () => ({ Bar: () => null }))
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR' }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
}))
vi.mock('../lib/api/checklists', () => ({
  listTemplates: vi.fn(() => Promise.resolve([
    { id: 't1', name: 'Workshop Daily', status: 'published', require_approval: true, fields: [{ id: 'f1', type: 'boolean', label: 'Brakes OK' }] },
  ])),
  listSubmissions: vi.fn(() => Promise.resolve([
    { id: 1, template_id: 't1', status: 'approved', site: 'NHC', created_at: new Date().toISOString(), answers: { f1: 'Yes' } },
  ])),
}))
vi.mock('../lib/api/checklistSchedules', () => ({
  getComplianceMonitor: vi.fn(() => Promise.reject(Object.assign(new Error('boom'), { code: '42501' }))),
  getApprovalAgeMonitor: vi.fn(() => Promise.resolve([])),
}))
vi.mock('../lib/api/technicianScorecard', () => ({
  listWorkOrdersForScorecard: vi.fn(() => Promise.resolve([
    { id: 1, technician_name: 'Ali', status: 'Completed', priority: 'normal', created_at: '2026-09-01T00:00:00Z', completed_at: '2026-09-01T05:00:00Z', total_cost: 100 },
  ])),
  listSkills: vi.fn(() => Promise.resolve([])),
  listCerts: vi.fn(() => Promise.reject(new Error('denied'))),
  upsertSkill: vi.fn(), deleteSkill: vi.fn(), createCert: vi.fn(), deleteCert: vi.fn(),
}))
vi.mock('../lib/api/users', () => ({
  listProfiles: vi.fn(() => Promise.resolve([{ id: 'u1', full_name: 'Ali', role: 'Tyre Man' }])),
}))
vi.mock('../lib/api/orgUnits', () => ({
  UNIT_TYPES: ['company', 'country', 'site'],
  listUnits: vi.fn(() => Promise.resolve([
    { id: 'a', name: 'Company A', unit_type: 'company' },
    { id: 'b', name: 'Saudi', unit_type: 'country', parent_id: 'a' },
  ])),
  listAssignments: vi.fn(() => Promise.reject(new Error('nope'))),
  createUnit: vi.fn(), updateUnit: vi.fn(), deleteUnit: vi.fn(),
  createAssignment: vi.fn(), updateAssignment: vi.fn(), deleteAssignment: vi.fn(),
}))

import ChecklistInsights from '../pages/ChecklistInsights'
import TechnicianScorecard from '../pages/TechnicianScorecard'
import OrgHierarchy from '../pages/OrgHierarchy'

beforeEach(() => cleanup())

describe('workforce pages render', () => {
  it('ChecklistInsights shows KPIs, a template row and a failed monitor as unavailable', async () => {
    render(<MemoryRouter><ChecklistInsights /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('Workshop Daily').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Approval rate').length).toBeGreaterThan(0)
    expect(screen.getByText(/compliance monitor could not be read/)).toBeTruthy()
    expect(screen.getByText('1 question')).toBeTruthy()
  })

  it('TechnicianScorecard ranks technicians and reports a failed cert read', async () => {
    render(<MemoryRouter><TechnicianScorecard /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('Ali').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: /Certifications/ }))
    await waitFor(() => expect(screen.getByText(/Couldn't load competency records/)).toBeTruthy())
  })

  it('OrgHierarchy renders the tree and never shows a failed member read as zero', async () => {
    render(<MemoryRouter><OrgHierarchy /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('Company A').length).toBeGreaterThan(0))
    expect(screen.getByText(/Member counts show N\/A rather than zero/)).toBeTruthy()
    expect(screen.getAllByRole('tree').length).toBe(1)
  })
})
