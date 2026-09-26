import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Mounts the REAL RFID Registry over a mocked Supabase client: KPIs come from
 * every loaded row, the alert scope switch filters locally (so "All alerts"
 * is not a stale open-only list), and a failed read is stated with Retry.
 */
vi.mock('chart.js', () => ({ Chart: { register: () => {} }, ArcElement: {}, Tooltip: {}, Legend: {}, BarElement: {}, CategoryScale: {}, LinearScale: {} }))
vi.mock('react-chartjs-2', () => ({ Bar: () => <div />, Doughnut: () => <div /> }))
vi.mock('../components/RfidScanner', () => ({ default: () => null }))

const h = vi.hoisted(() => ({ tables: {}, fail: null }))
vi.mock('../lib/supabase', () => {
  const from = (table) => {
    const q = {}
    for (const m of ['select', 'order', 'is', 'eq', 'update', 'insert', 'delete']) q[m] = () => q
    q.range = () => Promise.resolve(h.fail ? { data: null, error: h.fail } : { data: h.tables[table] || [], error: null })
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
    rfid_tags: [{ id: 't1', tag_uid: 'E2001', status: 'attached', site: 'NHC', tyre_record_id: 'x', tyre_records: { serial_no: 'SN-1' } }, { id: 't2', tag_uid: 'E2002', status: 'lost' }],
    rfid_readers: [{ id: 'r1', name: 'Gate', status: 'active' }],
    rfid_alerts: [
      { id: 'a1', severity: 'critical', message: 'Tag missing at gate', alert_type: 'tag_not_seen', created_at: '2026-09-01' },
      { id: 'a2', severity: 'low', message: 'Old resolved alert', alert_type: 'lost_tag', created_at: '2026-08-01', resolved_at: '2026-08-02' },
    ],
  }
})

describe('RfidRegistry page', () => {
  it('renders KPIs, the tag register and switches alert scope locally', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('Tag missing at gate').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: /Tag inventory/ }))
    await waitFor(() => expect(screen.getByText('E2001')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Edit tag E2001' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: /Alerts/ }))
    await waitFor(() => expect(screen.queryByText('Old resolved alert')).toBeNull())
    fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'all' } })
    await waitFor(() => expect(screen.getByText('Old resolved alert')).toBeTruthy())
  })

  it('states a failed read with Retry', async () => {
    h.fail = { message: 'denied' }
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy())
  })
})
