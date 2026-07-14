import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * Regression guard for "as an Admin, when I add a claim I cannot open it".
 *
 * Root cause: AccidentDetail.load() awaited a single Promise.all over the
 * accident + accident_remarks + accident_parts queries. If ANY auxiliary query
 * REJECTED (a missing relation surfaced as a thrown error, an RLS/permission
 * edge, or a transient network failure) the whole load rejected as an unhandled
 * rejection, so `setLoading(false)` never ran and the page hung forever on its
 * skeleton — the record could not be opened (and therefore not edited, since
 * "Edit Incident" lives on that page).
 *
 * These tests drive the real page with a REJECTING accident_remarks query and
 * assert the incident still opens (loader clears, heading renders). On the old
 * Promise.all code the heading never appears and the assertion times out.
 */

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

// A resolving builder (select/eq/order/single all fulfil with `result`).
function makeBuilder(result) {
  const b = {
    select: () => b,
    eq: () => b,
    order: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
  }
  return b
}

// A builder whose terminal `.order()` REJECTS — models the auxiliary table that
// used to wedge the whole loader.
function makeRejectingBuilder(err) {
  const b = {
    select: () => b,
    eq: () => b,
    order: () => Promise.reject(err),
    single: () => Promise.reject(err),
  }
  return b
}

const { remarksMode } = vi.hoisted(() => ({ remarksMode: { reject: true } }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table) => {
      if (table === 'accidents') return makeBuilder({ data: ACC, error: null })
      if (table === 'accident_parts') return makeBuilder({ data: [], error: null })
      if (table === 'accident_remarks') {
        return remarksMode.reject
          ? makeRejectingBuilder(new Error('permission denied for table accident_remarks'))
          : makeBuilder({ data: [], error: null })
      }
      return makeBuilder({ data: [], error: null })
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
vi.mock('../components/ai/CopilotCard', () => ({ default: () => null }))
vi.mock('../components/workflow/EntityApprovalPanel', () => ({ default: () => <div data-testid="approval-panel" /> }))
vi.mock('../components/CustomFieldsPanel', () => ({ default: () => null }))
vi.mock('../lib/storageRefs', () => ({ resolveStorageUrls: () => Promise.resolve([]) }))
vi.mock('../lib/api/accidentTimeline', () => ({ listStatusTransitions: () => Promise.resolve([]) }))
vi.mock('../lib/exportUtils', () => ({ exportAccidentCasePdf: () => Promise.resolve() }))

import AccidentDetailPage from '../components/AccidentDetailModal'

describe('AccidentDetail — resilient load (never hangs on an auxiliary query)', () => {
  beforeEach(() => { navSpy.mockClear(); remarksMode.reject = true })

  it('opens the incident even when the accident_remarks query rejects', async () => {
    render(<AccidentDetailPage />)
    // Heading renders => loader cleared => record opened. Old Promise.all code
    // rejects and this findBy times out.
    expect(await screen.findByRole('heading', { name: /MP-1042/i })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Download Case/i })).toBeInTheDocument()
  })

  it('surfaces a non-fatal partial-load hint (no infinite spinner, no crash)', async () => {
    render(<AccidentDetailPage />)
    await screen.findByRole('heading', { name: /MP-1042/i })
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument()
  })

  it('loads cleanly with no banner when every query succeeds', async () => {
    remarksMode.reject = false
    render(<AccidentDetailPage />)
    await screen.findByRole('heading', { name: /MP-1042/i })
    expect(screen.queryByText(/could not be loaded/i)).toBeNull()
  })
})
