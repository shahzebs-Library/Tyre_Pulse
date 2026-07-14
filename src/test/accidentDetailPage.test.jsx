import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

// Regression guard for the `/accidents/:id` detail page. A ReferenceError once
// shipped here: the Overview/Claim/Parts tabs called a bare `formatCurrency(...)`
// while the symbol was imported only under an alias, so opening any accident
// crashed at render (build + suite stayed green because nothing rendered the
// tabs and the route's <Safe> boundary swallowed it). These tests render the
// real page and switch through the currency-bearing tabs so any such crash
// fails the suite.

const ACC = {
  id: 'acc-1', asset_no: 'MP-1042', site: 'GCC Plant', country: 'KSA',
  severity: 'Major', status: 'under_review', closure_status: 'open',
  incident_date: '2026-05-01', created_at: '2026-05-01T08:00:00Z',
  repair_cost: 12000, parts_cost: 3000, recovered_amount: 5000,
  claim_amount: 15000, claim_approved_amount: 9000, deductible: 500,
  claim_status: 'filed', recovery_status: 'partial', recovery_source: 'insurer',
  driver_name: 'A. Khan', insurer: 'Gulf Insurance', policy_no: 'POL-99',
  description: 'Rear-ended at depot gate.', custom_data: null, photos: [],
}
const PARTS = [{ id: 'p1', part_name: 'Bumper', quantity: 1, unit_cost: 800, total_cost: 800, status: 'fitted' }]

function makeBuilder(result) {
  const b = {
    select: () => b,
    eq: () => b,
    order: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
  }
  return b
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      if (table === 'accidents') return makeBuilder({ data: ACC, error: null })
      if (table === 'accident_parts') return makeBuilder({ data: PARTS, error: null })
      return makeBuilder({ data: [], error: null }) // accident_remarks
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}))
const { navSpy } = vi.hoisted(() => ({ navSpy: vi.fn() }))
vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 'acc-1' }),
  useNavigate: () => navSpy,
}))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u1', role: 'Admin' } }) }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCurrency: 'SAR' }) }))
vi.mock('../contexts/TenantContext', () => ({ useTenant: () => ({ branding: { display_name: 'Acme Fleet' } }) }))
vi.mock('../hooks/useSites', () => ({ useSites: () => ({ options: ['GCC Plant', 'Riyadh Depot'], sites: [], loading: false }) }))
vi.mock('../components/ai/CopilotCard', () => ({ default: () => null }))
vi.mock('../components/workflow/EntityApprovalPanel', () => ({ default: () => <div data-testid="approval-panel" /> }))
vi.mock('../components/CustomFieldsPanel', () => ({ default: () => null }))
vi.mock('../lib/storageRefs', () => ({ resolveStorageUrls: () => Promise.resolve([]) }))
const exportSpy = vi.fn(() => Promise.resolve())
vi.mock('../lib/exportUtils', () => ({ exportAccidentCasePdf: (...a) => exportSpy(...a) }))

import AccidentDetailPage from '../components/AccidentDetailModal'

describe('AccidentDetailPage (/accidents/:id)', () => {
  beforeEach(() => { exportSpy.mockClear(); navSpy.mockClear() })

  it('renders the Overview tab with currency, no ReferenceError', async () => {
    render(<AccidentDetailPage />)
    await screen.findByRole('button', { name: /Download Case/i })
    expect(screen.getByRole('heading', { name: /MP-1042/i })).toBeInTheDocument()
    // Financial rail + Overview both format money via the active currency.
    expect(screen.getAllByText(/SAR/i).length).toBeGreaterThan(0)
  })

  it('switches to Claim & Parts tabs without crashing', async () => {
    render(<AccidentDetailPage />)
    await screen.findByRole('button', { name: /Download Case/i })

    fireEvent.click(screen.getByRole('button', { name: /Claim & Recovery/i }))
    await waitFor(() => expect(screen.getByText(/Cost Recovery/i)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Parts & Repairs/i }))
    await waitFor(() => expect(screen.getByText('Bumper')).toBeInTheDocument())
  })

  it('routes Edit Incident to the ONE unified form on the Accidents page (no per-tab edit forms)', async () => {
    render(<AccidentDetailPage />)
    await screen.findByRole('button', { name: /Download Case/i })

    // The record tabs are read-only now: no per-tab save buttons remain.
    fireEvent.click(screen.getByRole('button', { name: /Claim & Recovery/i }))
    await waitFor(() => expect(screen.getByText(/Cost Recovery/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Save Claim & Recovery/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Repair & Insurance/i }))
    await waitFor(() => expect(screen.getByText(/Workshop & Financials/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Save Repair & Insurance/i })).toBeNull()

    // Edit Incident (header action, elevated role) deep-links into the unified
    // inline form on /accidents via router state.
    const editBtns = screen.getAllByRole('button', { name: /Edit Incident/i })
    expect(editBtns.length).toBeGreaterThan(0)
    fireEvent.click(editBtns[0])
    expect(navSpy).toHaveBeenCalledWith('/accidents', { state: { editId: 'acc-1' } })
  })

  it('invokes the case PDF export from the Download Case action', async () => {
    render(<AccidentDetailPage />)
    await screen.findByRole('button', { name: /Download Case/i })
    fireEvent.click(screen.getByRole('button', { name: /Download Case/i }))
    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1))
    const [acc, opts] = exportSpy.mock.calls[0]
    expect(acc.id).toBe('acc-1')
    expect(opts).toMatchObject({ company: 'Acme Fleet' })
    expect(typeof opts.fmtCurrency).toBe('function')
  })
})
