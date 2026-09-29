import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Mounts the REAL RFID Registry over a mocked Supabase client on the live
 * V132 tag shape: KPIs and states come from every loaded row (duplicates are
 * derived), the alert scope switch filters locally, read success rate stays
 * N/A, and a failed read is stated with Retry.
 */
vi.mock('../components/RfidScanner', () => ({ default: () => null }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'All' }) }))

const h = vi.hoisted(() => ({ tables: {}, fail: null }))
vi.mock('../lib/supabase', () => {
  const from = (table) => {
    const q = {}
    for (const m of ['select', 'order', 'is', 'eq', 'or', 'update', 'insert', 'delete', 'limit', 'ilike']) q[m] = () => q
    const res = () => Promise.resolve(h.fail ? { data: null, error: h.fail } : { data: h.tables[table] || [], error: null })
    q.range = res
    q.in = res
    return q
  }
  return { supabase: { from } }
})

import RfidRegistry from '../pages/RfidRegistry'

const renderPage = () => render(<MemoryRouter><RfidRegistry /></MemoryRouter>)
beforeEach(() => {
  cleanup()
  h.fail = null
  h.tables = {
    rfid_tags: [
      { id: 't1', tag_id: 'E2001', tyre_serial: 'SN-1', site: 'NHC', status: 'active', created_at: '2026-09-01T08:00:00Z' },
      { id: 't2', tag_id: 'E2002', status: 'unassigned', created_at: '2026-09-02T08:00:00Z' },
      { id: 't3', tag_id: 'e2002', asset_no: 'TM514', status: 'active', created_at: '2026-09-03T08:00:00Z' },
    ],
    tyre_records: [{ serial_no: 'SN-1', brand: 'Triangle', size: '315/80R22.5' }],
    vehicle_fleet: [{ asset_no: 'TM514', make: 'Sany', model: 'Mixer', vehicle_type: 'TR-MIXER' }],
    rfid_readers: [{ id: 'r1', name: 'Gate', status: 'active' }],
    rfid_read_events: [],
    rfid_alerts: [
      { id: 'a1', tag_id: 't1', severity: 'critical', message: 'Tag missing at gate', alert_type: 'tag_not_seen', created_at: '2026-09-01' },
      { id: 'a2', severity: 'low', message: 'Old resolved alert', alert_type: 'lost_tag', created_at: '2026-08-01', resolved_at: '2026-08-02' },
    ],
  }
})

describe('RfidRegistry page', () => {
  it('renders the register, derived states and switches alert scope locally', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('E2001').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: 'Edit tag E2001' })).toBeTruthy()
    expect(screen.getAllByText('Duplicate').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Triangle').length).toBeGreaterThan(0)
    expect(screen.getByText('Read success rate').closest('.cc-kpi').textContent).toContain('N/A')
    fireEvent.click(screen.getByRole('tab', { name: /Not found/ }))
    await waitFor(() => expect(screen.getByText('Tag missing at gate')).toBeTruthy())
    expect(screen.queryByText('Old resolved alert')).toBeNull()
    fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'all' } })
    await waitFor(() => expect(screen.getByText('Old resolved alert')).toBeTruthy())
  })

  it('shows an honest empty scan activity state', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/No reader scans recorded in the last 30 days/)).toBeTruthy())
    const scan = screen.getByRole('region', { name: 'Scan RFID Tag' })
    expect(within(scan).getByText(/cannot talk to a handheld reader directly/)).toBeTruthy()
  })

  it('states a failed read with Retry', async () => {
    h.fail = { message: 'denied' }
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy())
  })
})
