import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import CaseTeamInbox from '../components/accidents/CaseTeamInbox'

// CaseTeamInbox is purely presentational (Phase 4 team inbox): it is fed a ready
// `items` array and never fetches. These tests pin the three honest states
// (loading / empty / rows), the overdue-first ordering, and that it never throws
// on partial rows.

const yesterday = () => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString()
}
const nextWeek = () => {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toISOString()
}

describe('CaseTeamInbox honest states + ordering', () => {
  it('renders a loading state when items is null (nothing known yet)', () => {
    render(<CaseTeamInbox items={null} />)
    expect(screen.getByText("My team's accident cases")).toBeInTheDocument()
    expect(screen.getByText('Loading cases...')).toBeInTheDocument()
  })

  it('renders an empty state for an empty array', () => {
    render(<CaseTeamInbox items={[]} />)
    expect(screen.getByText('No cases assigned to your team.')).toBeInTheDocument()
    expect(screen.queryByText('Loading cases...')).not.toBeInTheDocument()
  })

  it('renders a row per case with a status pill and due badge', () => {
    const items = [
      {
        accident_id: 'a1', case_no: 'ACC-2026-001', workstream_key: 'insurance_claim',
        status: 'in_progress', owner_role: 'Insurance Officer', team: 'Insurance',
        site: 'NHC', country: 'KSA', due_at: nextWeek(),
      },
    ]
    render(<CaseTeamInbox items={items} />)
    expect(screen.getByText('Case ACC-2026-001')).toBeInTheDocument()
    expect(screen.getByText('Insurance claim')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('Insurance')).toBeInTheDocument()
    expect(screen.getByText('NHC, KSA')).toBeInTheDocument()
    // one <li> row
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('sorts overdue cases first regardless of input order', () => {
    const items = [
      {
        accident_id: 'ontime', case_no: 'ACC-OK', workstream_key: 'repair',
        status: 'open', team: 'Workshop', country: 'UAE', due_at: nextWeek(),
      },
      {
        accident_id: 'late', case_no: 'ACC-LATE', workstream_key: 'final_inspection',
        status: 'open', team: 'Workshop', country: 'UAE', due_at: yesterday(),
      },
    ]
    render(<CaseTeamInbox items={items} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    // The overdue case sorts to the top.
    expect(within(rows[0]).getByText('Case ACC-LATE')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Case ACC-OK')).toBeInTheDocument()
    // Overdue summary badge reflects the single overdue case.
    expect(screen.getByText('1 overdue')).toBeInTheDocument()
  })

  it('never throws on partial / malformed rows and shows honest fallbacks', () => {
    const items = [
      {}, // no fields at all
      { accident_id: 'a2', status: 'mystery_status', due_at: 'not-a-date' },
    ]
    expect(() => render(<CaseTeamInbox items={items} />)).not.toThrow()
    // Unknown status renders its raw token honestly rather than being dropped.
    expect(screen.getByText('mystery_status')).toBeInTheDocument()
    // An unparseable / missing due date reads as "No due date", never overdue.
    expect(screen.getAllByText('No due date').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
