import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CaseTeamList from '../components/accidents/CaseTeamList'
import { LanguageProvider, useLanguage } from '../contexts/LanguageContext'

// The accidentOwnership namespace loads lazily; warm it once so synchronous
// queries see the real English strings.
function WarmLocale() { const { t } = useLanguage(); return <span>{t('accidentOwnership.common.na')}</span> }
beforeAll(async () => { render(<LanguageProvider><WarmLocale /></LanguageProvider>); await screen.findByText('N/A'); cleanup() })

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>)
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString() }

// The full team list (every open case step routed to the teams) is kept on the
// Accident Cases page beside "My accident tasks" (owner, 2026-11-28).
describe('CaseTeamList (all open case steps by team)', () => {
  it('shows loading when items is null', () => {
    wrap(<CaseTeamList items={null} />)
    expect(screen.getByText('All open case steps by team')).toBeInTheDocument()
    expect(screen.getByText('Loading case steps...')).toBeInTheDocument()
  })

  it('shows an honest empty state', () => {
    wrap(<CaseTeamList items={[]} />)
    expect(screen.getByText('No open case steps for any team.')).toBeInTheDocument()
  })

  it('renders every team step, overdue first, linked to its case', () => {
    const items = [
      { accident_id: 'a1', case_no: 'ACC-OK', workstream_key: 'repair', status: 'in_progress', team: 'Workshop', site: 'NHC', country: 'KSA', due_at: day(7) },
      { accident_id: 'a2', case_no: 'ACC-LATE', workstream_key: 'assessment', status: 'open', owner_role: 'Insurance Officer', due_at: day(-2) },
      { accident_id: 'a3', case_no: 'ACC-NODUE', workstream_key: 'insurance', status: 'weird_token', team: 'Insurance' },
    ]
    wrap(<CaseTeamList items={items} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Case ACC-LATE')
    expect(rows[0]).toHaveTextContent(/Overdue/)
    expect(screen.getByText('1 overdue')).toBeInTheDocument()
    expect(screen.getByText('3 steps')).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('Workshop')).toBeInTheDocument()
    expect(screen.getByText('NHC, KSA')).toBeInTheDocument()
    // an unknown status still renders honestly with its raw text
    expect(screen.getByText('weird_token')).toBeInTheDocument()
    expect(screen.getByText('No due date')).toBeInTheDocument()
    expect(rows[0].querySelector('a')).toHaveAttribute('href', '/accidents/a2?tab=workstreams')
  })
})

describe('Accident Cases page keeps both lists', () => {
  it('mounts My accident tasks, the holdings board and the full team list', async () => {
    const { readFileSync } = await import('fs')
    const src = readFileSync('src/pages/AccidentCases.jsx', 'utf8')
    expect(src).toMatch(/<CaseTeamInbox \/>/)
    expect(src).toMatch(/<AccidentHoldingsBoard \/>/)
    expect(src).toMatch(/<CaseTeamList items=\{[^}]*board\?\.inbox/)
  })
})
