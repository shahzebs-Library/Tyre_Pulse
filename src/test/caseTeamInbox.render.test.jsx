import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/api/accidentOwnership', () => ({
  listMyAccidentTasks: vi.fn(async () => ({ ok: true, rows: [] })),
}))

import CaseTeamInbox from '../components/accidents/CaseTeamInbox'
import { LanguageProvider, useLanguage } from '../contexts/LanguageContext'

// The accidentOwnership namespace loads lazily; warm it once so synchronous
// queries see the real English strings rather than the humanised placeholder.
function WarmLocale() { const { t } = useLanguage(); return <span>{t('accidentOwnership.common.na')}</span> }
beforeAll(async () => { render(<LanguageProvider><WarmLocale /></LanguageProvider>); await screen.findByText('N/A'); cleanup() })

// CaseTeamInbox is built on accident_my_tasks(): "Assigned to me" and "For my
// team", overdue first, with honest loading / empty states.
const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('CaseTeamInbox (my accident tasks)', () => {
  it('shows loading when items is null', () => {
    wrap(<CaseTeamInbox items={null} />)
    expect(screen.getByText('Loading your tasks...')).toBeInTheDocument()
  })

  it('shows an honest empty state', () => {
    wrap(<CaseTeamInbox items={[]} />)
    expect(screen.getByText('Nothing waiting for you on accident cases.')).toBeInTheDocument()
  })

  it('splits mine from my team and puts overdue first', () => {
    const items = [
      { workstream_id: '1', accident_id: 'a1', reference_no: 'ACC-OK', workstream_key: 'repair', workstream_name: 'Repair', assigned_to_me: true, overdue: false, sla_state: 'running', days_in_step: 2, site: 'NHC', country: 'KSA' },
      { workstream_id: '2', accident_id: 'a2', reference_no: 'ACC-LATE', workstream_key: 'assessment', workstream_name: 'Technical Assessment', assigned_to_me: true, overdue: true, sla_state: 'breached', days_in_step: 5 },
      { workstream_id: '3', accident_id: 'a3', reference_no: 'ACC-TEAM', workstream_key: 'insurance', workstream_name: 'Insurance & Claim', assigned_to_me: false, owner_role: 'Admin', overdue: false, sla_state: 'none', days_in_step: 1 },
    ]
    wrap(<CaseTeamInbox items={items} />)
    const mine = screen.getByText(/Assigned to me/).closest('div')
    const rows = within(mine).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('ACC-LATE')
    expect(rows[0]).toHaveTextContent('Overdue')
    expect(rows[1]).toHaveTextContent('ACC-OK')
    const team = screen.getByText(/For my team/).closest('div')
    expect(within(team).getByText('Case ACC-TEAM')).toBeInTheDocument()
    expect(within(team).getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText(/3 open · 1 overdue/)).toBeInTheDocument()
    expect(rows[0].querySelector('a').getAttribute('href')).toBe('/accidents/a2?tab=workstreams')
  })

  it('compact mode lists at most five rows', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ workstream_id: String(i), accident_id: `a${i}`, reference_no: `R${i}`, workstream_key: 'repair', assigned_to_me: true, sla_state: 'none', days_in_step: i }))
    wrap(<CaseTeamInbox items={items} compact />)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })
})
