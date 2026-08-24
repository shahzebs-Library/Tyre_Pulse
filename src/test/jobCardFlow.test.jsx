import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import JobCardFlow, { fmtHours } from '../components/workorders/JobCardFlow'

// Fixed clock. A "running" gap grows against the real clock, so a test that used
// Date.now() would drift between runs.
const NOW = Date.parse('2026-08-24T12:00:00Z')
const at = s => new Date(s).toISOString()

describe('fmtHours', () => {
  it('returns N/A for an unmeasurable value, never a number', () => {
    expect(fmtHours(null)).toBe('N/A')
    expect(fmtHours(undefined)).toBe('N/A')
    expect(fmtHours('abc')).toBe('N/A')
  })

  it('reads in hours and minutes below one day', () => {
    expect(fmtHours(6.5)).toBe('6h 30m')
    expect(fmtHours(23.99)).toMatch(/^23h/)
  })

  it('switches to days at the 24 hour boundary', () => {
    expect(fmtHours(24)).toBe('1d')
    expect(fmtHours(28)).toBe('1d 4h')
  })

  it('reads in minutes under an hour', () => {
    expect(fmtHours(0.5)).toBe('30m')
  })
})

describe('JobCardFlow honesty rules', () => {
  it('says the flow has not started rather than showing stage one', () => {
    render(<JobCardFlow row={{ status: 'New' }} now={NOW} />)
    expect(screen.getByText(/Flow not started/i)).toBeTruthy()
  })

  it('renders an unmeasurable gap as Not measurable, never as a zero', () => {
    // No Production Out, so "waiting for workshop" cannot be measured. Showing
    // 0 would say the asset waited no time at all, which is a different claim.
    render(<JobCardFlow row={{ status: 'Completed', started_at: at('2026-08-20T06:00:00Z'), completed_at: at('2026-08-20T09:00:00Z') }} now={NOW} />)
    expect(screen.getAllByText(/Not measurable/i).length).toBeGreaterThan(0)

    // The measurable gap is present and correct, so the tile is not blank.
    expect(screen.getByText('3h')).toBeTruthy()
  })

  it('marks a still-running gap as counting', () => {
    render(<JobCardFlow row={{ status: 'In Progress', production_out_at: at('2026-08-24T06:00:00Z') }} now={NOW} />)
    expect(screen.getAllByText(/and counting/i).length).toBeGreaterThan(0)
  })

  it('reports a reversed pair as a data error rather than a duration', () => {
    render(<JobCardFlow
      row={{ status: 'Completed', started_at: at('2026-08-21T10:00:00Z'), completed_at: at('2026-08-20T10:00:00Z') }}
      now={NOW} />)
    expect(screen.getAllByText(/Data error/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/Timestamps out of order/i)).toBeTruthy()
  })

  it('says no waiting cause was recorded instead of showing three zeros', () => {
    render(<JobCardFlow
      row={{ status: 'Completed', production_out_at: at('2026-08-20T06:00:00Z'), started_at: at('2026-08-20T16:00:00Z') }}
      now={NOW} />)
    expect(screen.getByText(/No waiting cause recorded/i)).toBeTruthy()
  })

  it('splits a recorded wait into parts, manpower and unaccounted', () => {
    render(<JobCardFlow
      row={{
        status: 'Completed',
        production_out_at: at('2026-08-20T06:00:00Z'),
        started_at: at('2026-08-20T16:00:00Z'),   // 10h wait
        waiting_parts_hours: 6,
        waiting_manpower_hours: 2,
      }}
      now={NOW} />)
    expect(screen.getByText(/Waiting for parts/i)).toBeTruthy()
    expect(screen.getByText(/Unaccounted/i)).toBeTruthy()
    expect(screen.getByText('6h')).toBeTruthy()   // parts
    // 2h appears TWICE on purpose: manpower is 2h, and the unaccounted
    // remainder is also 2h (a 10h wait less 6h parts less 2h manpower).
    expect(screen.getAllByText('2h')).toHaveLength(2)
  })

  it('shows only the total in compact mode', () => {
    render(<JobCardFlow
      row={{
        status: 'Completed',
        production_out_at: at('2026-08-20T06:00:00Z'),
        production_in_at: at('2026-08-21T12:00:00Z'),
      }}
      now={NOW} compact />)
    expect(screen.getByText(/Total downtime/i)).toBeTruthy()
    expect(screen.queryByText(/Why it waited/i)).toBeNull()
  })
})

describe('JobCardDetail smoke', () => {
  it('renders the whole card without a context provider', async () => {
    const { default: JobCardDetail } = await import('../components/workorders/JobCardDetail')
    const row = {
      work_order_no: 'GCKR/JC/1332/0526',
      asset_no: 'TM100',
      status: 'Completed',
      production_out_at: at('2026-08-20T06:00:00Z'),
      production_in_at: at('2026-08-21T12:00:00Z'),
      custom_data: {
        raised_by: '10012679',
        erp_reported_cost: { spare_parts: 120.5 },
        line_items: [{ task: 'Tyre Puncture', action: 'REPAIRED', qty: '2.00' }],
      },
    }
    render(<JobCardDetail row={row} now={NOW} currency="SAR" canEdit={false} />)
    expect(screen.getByText(/Card completeness/i)).toBeTruthy()
    expect(screen.getByText(/As reported by the ERP/i)).toBeTruthy()
    expect(screen.getByText(/Job card task lines/i)).toBeTruthy()
    expect(screen.getByText('Tyre Puncture')).toBeTruthy()
    // A field nobody filled reads as "Not recorded", never blank and never 0.
    expect(screen.getAllByText(/Not recorded/i).length).toBeGreaterThan(0)
  })

  it('renders nothing when there is no row', async () => {
    const { default: JobCardDetail } = await import('../components/workorders/JobCardDetail')
    const { container } = render(<JobCardDetail row={null} now={NOW} />)
    expect(container.textContent).toBe('')
  })
})
