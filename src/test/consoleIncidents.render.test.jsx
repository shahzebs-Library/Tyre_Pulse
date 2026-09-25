import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-chartjs-2', () => ({ Bar: () => null, Doughnut: () => null, Line: () => null }))
vi.mock('../console/components/ui/charts', () => {
  const pal = { critical: '#f00', high: '#f80', medium: '#fa0', low: '#999', good: '#0f0' }
  return {
    TrendChart: ({ summary }) => <div data-testid="trend">{summary}</div>,
    BarsChart: ({ summary }) => <div data-testid="bars">{summary}</div>,
    STATUS: { dark: pal, light: pal },
    useChartTheme: () => 'dark',
  }
})

const h = vi.hoisted(() => ({
  incidents: [],
  signals: { logs: { ok: true, rows: [] }, trust: { ok: false, rows: [] } },
}))

vi.mock('../lib/api/platformIncidents', () => ({
  listIncidents: vi.fn(() => Promise.resolve(h.incidents)),
  loadIncidentSignals: vi.fn(() => Promise.resolve(h.signals)),
  openIncident: vi.fn(() => Promise.resolve('new-id')),
  postIncidentUpdate: vi.fn(() => Promise.resolve({})),
  reassignCommander: vi.fn(() => Promise.resolve({ ok: true })),
  savePostmortem: vi.fn(() => Promise.resolve({ ok: true })),
  listCommanderProfiles: vi.fn(() => Promise.resolve([
    { id: 's1', full_name: 'Anum', is_super_admin: true, locked: false },
    { id: 's2', full_name: 'Waqas', is_super_admin: true, locked: false },
  ])),
}))

import ConsoleIncidents from '../console/pages/ConsoleIncidents'
import { reassignCommander, savePostmortem } from '../lib/api/platformIncidents'

afterEach(() => { cleanup(); h.incidents = [] })

describe('ConsoleIncidents', () => {
  it('shows operational status, N/A for unmeasured MTTR and an unreadable signal source', async () => {
    render(<ConsoleIncidents />)
    expect(await screen.findByText('All systems operational')).toBeTruthy()
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0)
    expect(screen.getByText(/could not be read/)).toBeTruthy()
  })

  it('reports an outage and opens the detail timeline', async () => {
    h.incidents = [{
      id: 'i1', title: 'Login down', severity: 'sev1', status: 'investigating', impact: 'Nobody can sign in',
      affected_modules: ['auth'], started_at: new Date(Date.now() - 3600000).toISOString(),
      acknowledged_at: null, resolved_at: null, commander_name: 'Anum', source_type: 'manual',
      updates: [{ id: 'u1', status: 'investigating', message: 'Incident opened.', author_name: 'Anum', created_at: new Date(Date.now() - 3600000).toISOString() }],
    }]
    render(<ConsoleIncidents />)
    expect(await screen.findByText('Major outage')).toBeTruthy()
    fireEvent.click(screen.getByText('Login down'))
    expect(await screen.findByText('Incident opened.')).toBeTruthy()
    expect(screen.getByText('Post an update')).toBeTruthy()
  })

  it('opens the new incident form', async () => {
    render(<ConsoleIncidents />)
    await screen.findByText('All systems operational')
    fireEvent.click(screen.getAllByText('Open incident')[0])
    expect(await screen.findByText(/notify every super admin/)).toBeTruthy()
  })

  it('reassigns the commander with a reason', async () => {
    h.incidents = [{
      id: 'i2', title: 'Reports slow', severity: 'sev3', status: 'identified', commander: 's1', commander_name: 'Anum',
      affected_modules: [], started_at: new Date(Date.now() - 3600000).toISOString(), updates: [],
    }]
    render(<ConsoleIncidents />)
    fireEvent.click(await screen.findByText('Reports slow'))
    expect(await screen.findByText(/Nobody assigned|Current:/)).toBeTruthy()
    expect(screen.getByText(/can be written once the incident is resolved/)).toBeTruthy()
    const sel = await screen.findByDisplayValue('Hand over to')
    fireEvent.change(sel, { target: { value: 's2' } })
    fireEvent.change(screen.getByLabelText('Handover reason'), { target: { value: 'end of my shift' } })
    fireEvent.click(screen.getByText('Reassign'))
    await waitFor(() => expect(reassignCommander).toHaveBeenCalledWith('i2', 's2', 'end of my shift'))
  })

  it('shows a recorded postmortem and saves an edit on a resolved incident', async () => {
    h.incidents = [{
      id: 'i3', title: 'Export broke', severity: 'sev2', status: 'resolved', commander: 's1', commander_name: 'Anum',
      affected_modules: [], started_at: new Date(Date.now() - 7200000).toISOString(),
      resolved_at: new Date(Date.now() - 3600000).toISOString(), updates: [],
      postmortem_summary: 'The exporter ran out of memory', postmortem_root_cause: 'Unbounded read',
      postmortem_actions: [{ action: 'Page the read', owner: 'Ops', due: '2026-10-01', done: false }],
      postmortem_at: new Date().toISOString(), postmortem_by_name: 'Anum',
    }]
    render(<ConsoleIncidents />)
    await screen.findByText('All systems operational')
    fireEvent.click(screen.getByRole('tab', { name: /Resolved/ }))
    fireEvent.click(await screen.findByText('Export broke'))
    expect(await screen.findByText('The exporter ran out of memory')).toBeTruthy()
    expect(screen.getByText('Page the read')).toBeTruthy()
    fireEvent.click(screen.getByText('Edit postmortem'))
    fireEvent.click(screen.getByText('Save postmortem'))
    await waitFor(() => expect(savePostmortem).toHaveBeenCalled())
    expect(savePostmortem.mock.calls[0][0]).toBe('i3')
  })
})
