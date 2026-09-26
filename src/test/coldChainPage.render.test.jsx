import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Mounts the REAL Cold-Chain page over a mocked service: the register renders
 * through EnterpriseTable, the provisioning banner fires ONLY on a certain
 * "table missing" probe, and a failed read is stated with Retry.
 */
vi.mock('chart.js', () => ({ Chart: { register: () => {} }, CategoryScale: {}, LinearScale: {}, BarElement: {}, LineElement: {}, PointElement: {}, ArcElement: {}, Filler: {}, Tooltip: {}, Legend: {} }))
vi.mock('react-chartjs-2', () => ({ Bar: () => <div />, Doughnut: () => <div />, Line: () => <div /> }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA' }) }))

const h = vi.hoisted(() => ({ list: vi.fn(), probe: vi.fn() }))
vi.mock('../lib/api/coldChain', () => ({ listReadings: h.list, createReading: vi.fn(), updateReading: vi.fn(), deleteReading: vi.fn() }))
vi.mock('../lib/api/_client', () => ({ probeRelation: h.probe }))

import ColdChain from '../pages/ColdChain'

const renderPage = () => render(<MemoryRouter><ColdChain /></MemoryRouter>)
beforeEach(() => { cleanup(); h.list.mockReset(); h.probe.mockReset() })

describe('ColdChain page', () => {
  it('renders readings, a breach and a labelled edit action', async () => {
    h.list.mockResolvedValue([
      { id: 'r1', asset_no: 'REEFER-7', site: 'DC', temperature_c: -10, min_threshold_c: -20, max_threshold_c: -15, recorded_at: '2026-09-01T00:00:00Z' },
      { id: 'r2', asset_no: 'REEFER-7', site: 'DC', temperature_c: -18, min_threshold_c: -20, max_threshold_c: -15, recorded_at: '2026-09-01T01:00:00Z' },
    ])
    renderPage()
    await waitFor(() => expect(screen.getAllByText('REEFER-7').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Breach').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /Edit REEFER-7/ }).length).toBeGreaterThan(0)
    expect(screen.queryByText(/not enabled on this database/)).toBeNull()
  })

  it('shows the provisioning banner only on a certain missing-table answer', async () => {
    h.list.mockResolvedValue([])
    h.probe.mockResolvedValue({ exists: false, checked: true })
    renderPage()
    await waitFor(() => expect(screen.getByText(/not enabled on this database/)).toBeTruthy())
    cleanup()
    h.probe.mockResolvedValue({ exists: true, checked: false })
    renderPage()
    await waitFor(() => expect(h.probe).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/not enabled on this database/)).toBeNull()
  })

  it('states a failed read with Retry', async () => {
    h.list.mockRejectedValue(new Error('network down'))
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy())
  })
})
