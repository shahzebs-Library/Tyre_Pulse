import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'

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
}))

import ConsoleIncidents from '../console/pages/ConsoleIncidents'

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
})
