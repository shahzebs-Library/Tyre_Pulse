import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('../contexts/LanguageContext', async importOriginal => (await import('./workforceLanguageMock.js')).mockWorkforceLanguage(importOriginal))
import { render, cleanup, screen, waitFor, fireEvent, within } from '@testing-library/react'

const NOT_INSTALLED_TEXT = 'Team work tracking needs the latest database update before it can record work. Ask an administrator to apply it.'

vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({}) } }))
vi.mock('../lib/exportUtils', () => ({ exportToExcel: vi.fn(() => Promise.resolve()) }))
vi.mock('../lib/api/workforceAssignments', () => ({
  NOT_INSTALLED: 'Team work tracking needs the latest database update before it can record work. Ask an administrator to apply it.',
  OPERATIONAL_TABLES: { tyre_records: 'Tyre fitment / removal', work_orders: 'Job card' },
}))
vi.mock('../lib/api/technicianScorecard', () => ({
  listSkills: vi.fn(() => Promise.resolve([{ id: 's1', user_id: 'u2', skill_id: 'tyre_change', level: 2 }])),
}))
vi.mock('../lib/api/workforceEmployees', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    listEmployeeRecords: vi.fn(),
    listCertifications: vi.fn(),
    listTaskTypes: vi.fn(),
    listEmployeeHistory: vi.fn(() => Promise.resolve([])),
    saveEmployeeRecord: vi.fn(),
    saveTaskType: vi.fn(),
    addCertification: vi.fn(),
  }
})

import * as emp from '../lib/api/workforceEmployees'
import EmployeeDirectoryPanel, { buildHierarchy, buildDirectoryRows, filterDirectory } from '../components/workforce/EmployeeDirectoryPanel'

const profiles = [
  { id: 'u1', full_name: 'Aisha Manager', employee_id: 'E1', role: 'Manager', site: 'NHC' },
  { id: 'u2', full_name: 'Bilal Tech', employee_id: 'E2', role: 'Tyre Man', site: 'NHC' },
  { id: 'u3', full_name: 'Chen Tech', employee_id: 'E3', role: 'Tyre Man', site: 'JED' },
  { id: 'u4', full_name: 'Dina NoRecord', employee_id: 'E4', role: 'Tyre Man', site: 'JED' },
]
const records = [
  { profile_id: 'u1', designation: 'Workshop Manager', department: 'Workshop', team: 'Central', supervisor_id: null, sites: ['ALL'], employment_status: 'active' },
  { profile_id: 'u2', designation: 'Tyre Technician', department: 'Workshop', team: 'Central', supervisor_id: 'u1', sites: ['NHC'], employment_status: 'active' },
  { profile_id: 'u3', designation: 'Tyre Technician', department: 'Field', team: 'West', supervisor_id: 'u2', sites: ['JED'], employment_status: 'temporarily_unavailable', unavailable_until: '2099-01-01' },
]
const certs = [
  { id: 'c1', profile_id: 'u2', cert_type: 'forklift', expires_on: '2000-01-01' },
  { id: 'c2', profile_id: 'u3', cert_type: 'first aid', expires_on: '2099-01-01' },
]

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  emp.listEmployeeRecords.mockResolvedValue(records)
  emp.listCertifications.mockResolvedValue(certs)
  emp.listTaskTypes.mockResolvedValue([])
  emp.listEmployeeHistory.mockResolvedValue([])
})

const directoryCount = () => screen.getByTestId('directory-count').textContent

describe('EmployeeDirectoryPanel', () => {
  it('flags an account with no employee record instead of using the account role as a designation', async () => {
    render(<EmployeeDirectoryPanel profiles={profiles} isManager currentUserId="u1" />)
    await waitFor(() => expect(screen.getAllByText('Dina NoRecord').length).toBeGreaterThan(0))
    expect(screen.getAllByText('No employee record').length).toBeGreaterThan(0)
    expect(directoryCount()).toBe('Showing 4 of 4')
  })

  it('filters missing records, status, site and expired certificates', async () => {
    render(<EmployeeDirectoryPanel profiles={profiles} isManager currentUserId="u1" />)
    await waitFor(() => expect(directoryCount()).toBe('Showing 4 of 4'))
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'missing' } })
    expect(directoryCount()).toBe('Showing 1 of 4')
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'expired' } })
    expect(directoryCount()).toBe('Showing 1 of 4')
    expect(screen.getAllByText('Bilal Tech').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'temporarily_unavailable' } })
    expect(directoryCount()).toBe('Showing 1 of 4')
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } })
    // u1 carries the ALL sentinel, so it matches every site.
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'JED' } })
    expect(directoryCount()).toBe('Showing 3 of 4')
  })

  it('groups the team hierarchy by supervisor and lists people with no supervisor', async () => {
    render(<EmployeeDirectoryPanel profiles={profiles} isManager currentUserId="u1" />)
    await waitFor(() => expect(directoryCount()).toBe('Showing 4 of 4'))
    fireEvent.click(screen.getByRole('button', { name: /Team hierarchy/ }))
    const tree = screen.getByTestId('hierarchy-tree')
    expect(within(tree).getByText('Aisha Manager')).toBeTruthy()
    expect(within(tree).getByText('1 direct, 1 indirect')).toBeTruthy()
    expect(within(tree).getByText('Chen Tech')).toBeTruthy()
  })

  it('gives a non-manager a read-only view with no edit controls', async () => {
    render(<EmployeeDirectoryPanel profiles={profiles} isManager={false} currentUserId="u2" />)
    await waitFor(() => expect(screen.getAllByText('Bilal Tech').length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
    expect(screen.queryByRole('button', { name: /Task requirements/ })).toBeNull()
    // Dina has no visible record and is not the viewer, so she is not listed as "missing".
    expect(screen.queryByText('Dina NoRecord')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View Bilal Tech' }))
    await waitFor(() => expect(screen.getByTestId('employee-readonly')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Save changes/ })).toBeNull()
    expect(screen.queryByText('Add certificate')).toBeNull()
  })

  it('shows a validation error inline in the editor', async () => {
    emp.saveEmployeeRecord.mockImplementation(async form => emp.employeePayload(form))
    render(<EmployeeDirectoryPanel profiles={profiles} isManager currentUserId="u1" />)
    await waitFor(() => expect(screen.getAllByText('Dina NoRecord').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Dina NoRecord' }))
    const submit = await screen.findByRole('button', { name: /Create employee record/ })
    fireEvent.click(submit)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Designation is required/))
    expect(emp.saveEmployeeRecord).toHaveBeenCalledWith(expect.objectContaining({ profile_id: 'u4' }), { exists: false })
  })

  it('states the safety-critical rule and blocks a gate with nothing to check', async () => {
    render(<EmployeeDirectoryPanel profiles={profiles} isManager currentUserId="u1" />)
    await waitFor(() => expect(directoryCount()).toBe('Showing 4 of 4'))
    fireEvent.click(screen.getByRole('button', { name: /Task requirements/ }))
    expect(screen.getByText(/cannot be overridden/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Safety-critical'))
    expect(screen.getByText(/Safety-critical requires a skill or a certificate/)).toBeTruthy()
  })

  it('shows the not installed state', async () => {
    emp.listEmployeeRecords.mockRejectedValue(new Error(NOT_INSTALLED_TEXT))
    render(<EmployeeDirectoryPanel profiles={profiles} isManager currentUserId="u1" />)
    await waitFor(() => expect(screen.getByText(/Not installed yet/)).toBeTruthy())
  })

  it('reports a failed certificate read as not available, never as zero', async () => {
    emp.listCertifications.mockRejectedValue(new Error('denied'))
    render(<EmployeeDirectoryPanel profiles={profiles} isManager currentUserId="u1" />)
    await waitFor(() => expect(screen.getByText(/Certificates could not be read/)).toBeTruthy())
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(2)
  })
})

describe('pure helpers', () => {
  it('buildHierarchy survives a reporting loop', () => {
    const h = buildHierarchy([
      { profile_id: 'x', supervisor_id: 'y' }, { profile_id: 'y', supervisor_id: 'x' }, { profile_id: 'z', supervisor_id: null },
    ])
    expect(h.tree).toEqual([])
    expect(h.loops.sort()).toEqual(['x', 'y'])
    expect(h.unassigned).toEqual(['z'])
  })
  it('buildDirectoryRows marks unknown skills as not available', () => {
    const rows = buildDirectoryRows({ profiles, records, certs, skills: null, today: '2026-11-09' })
    expect(rows.every(r => r.skill_count === null)).toBe(true)
    expect(filterDirectory(rows, { search: 'tyre technician' }).length).toBe(2)
  })
})
