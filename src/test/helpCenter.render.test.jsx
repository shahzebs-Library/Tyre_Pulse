import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import en from '../locales/en/shell.json'
const h = vi.hoisted(() => ({ auth: {}, tickets: vi.fn(), problems: vi.fn() }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => h.auth }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))
vi.mock('../contexts/WorkspaceNavigationContext', () => ({ useWorkspaceNavigation: () => [{ to: '/inspections' }] }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ language: 'en', t: key => key.split('.').slice(1).reduce((value, part) => value?.[part], en) || key }) }))
vi.mock('../lib/api/support', async importOriginal => ({ ...(await importOriginal()), listTickets: (...args) => h.tickets(...args) }))
vi.mock('../lib/api/userIssues', () => ({ listMyIssues: (...args) => h.problems(...args) }))
vi.mock('../components/support/ReportProblemDialog', () => ({ default: ({ open, onClose }) => open ? <div role="dialog" aria-label="Report a problem"><button onClick={onClose}>Close report</button></div> : null }))
import HelpCenter from '../pages/HelpCenter'
function show(url = '/help') { return render(<MemoryRouter initialEntries={[url]}><HelpCenter /></MemoryRouter>) }
beforeEach(() => {
  h.auth = { user: { id: 'me' }, profile: { id: 'me', role: 'Inspector' } }
  h.tickets.mockReset().mockResolvedValue([]); h.problems.mockReset().mockResolvedValue([])
})
afterEach(cleanup)

describe('Help & Support user view', () => {
  it('shows permitted guides and reads only personal request sources', async () => {
    show()
    expect(screen.getByRole('button', { name: /Inspections & checklists/ })).toBeInTheDocument()
    await screen.findByText('No requests yet')
  })
  it('shows genuine empty state and never grants triage via URL parameters', async () => {
    show('/help?section=triage')
    await screen.findByText('No requests yet')
    expect(h.tickets).toHaveBeenCalledWith({ mine: true, limit: 5 })
    expect(h.problems).toHaveBeenCalledWith('me', { limit: 5 })
    expect(screen.queryByRole('button', { name: 'Team ticket triage' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull()
    expect(screen.queryByText('Tyre records & serial tracking')).toBeNull()
  })
  it('keeps partial errors visible alongside successfully loaded own reports', async () => {
    h.tickets.mockRejectedValue(new Error('unavailable'))
    h.problems.mockResolvedValue([{ id: 'p1', description: 'Inspection will not sync', status: 'new', created_at: '2026-10-18' }])
    show()
    await screen.findByText('Inspection will not sync')
    expect(screen.getByRole('alert')).toHaveTextContent('incomplete')
    expect(screen.queryByText('No requests yet')).toBeNull()
    expect(screen.getByRole('link', { name: 'View update' })).toHaveAttribute('href', '/my-problems?issue=p1')
    h.tickets.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
  it('searches accessible articles and opens the real report flow', async () => {
    show()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search guides, modules or common questions' }), { target: { value: 'sync' } })
    expect(screen.getByRole('button', { name: /What should I do if an inspection will not sync/ })).toBeInTheDocument()
    expect(screen.queryByText('How do I import data from Excel or my ERP?')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
    expect(screen.getByRole('dialog', { name: 'Report a problem' })).toBeInTheDocument()
  })
  it('refreshes personal reports when the report dialog closes', async () => {
    show()
    await screen.findByText('No requests yet')
    fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
    h.problems.mockResolvedValue([{ id: 'new-report', description: 'Newly submitted report', status: 'new', created_at: '2026-10-18' }])
    fireEvent.click(screen.getByRole('button', { name: 'Close report' }))
    await screen.findByText('Newly submitted report')
  })

  it('does not show database setup commands when support is unavailable', async () => {
    const error = new Error('missing relation'); error.code = '42P01'
    h.tickets.mockRejectedValue(error)
    show('/help?section=tickets')
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('temporarily unavailable')
    expect(document.body.textContent).not.toMatch(/MIGRATIONS|CREATE TABLE|Apply.*sql/i)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

})
