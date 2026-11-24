import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const state = { mode: 'empty', admin: true }
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { role: state.admin ? 'Admin' : 'Manager' }, isSuperAdmin: false }),
}))
vi.mock('../lib/api/procurementDepth', () => ({
  NOT_SET_UP: 'This part of procurement is not switched on yet.',
  newIdempotencyKey: () => 'k',
  savePurchaseApprovalLimit: vi.fn(),
  listPurchaseApproverRoles: () => (state.mode === 'not_set_up'
    ? Promise.resolve({ status: 'ok', rows: [] })
    : Promise.resolve({ status: 'ok', rows: ['Admin', 'Manager', 'Director'] })),
  listPurchaseApprovalLimits: () => {
    if (state.mode === 'error') return Promise.reject(new Error('boom'))
    if (state.mode === 'rows') {
      return Promise.resolve({ status: 'ok', rows: [{ id: 'a', approver_role: 'Manager', country: 'KSA', currency: 'SAR', max_value: 5000, active: true }] })
    }
    return Promise.resolve({ status: 'ok', rows: [] })
  },
}))

import PurchaseApprovalLimitsPanel from '../components/procurement/PurchaseApprovalLimitsPanel'

describe('PurchaseApprovalLimitsPanel', () => {
  beforeEach(() => { state.mode = 'empty'; state.admin = true })

  it('explains that no limits means no threshold', async () => {
    render(<PurchaseApprovalLimitsPanel />)
    await waitFor(() => expect(screen.getByText(/No purchase approval limits are set/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Add limit/ })).toBeInTheDocument()
    expect(screen.getByText(/role without its own limit/)).toBeInTheDocument()
  })

  it('lists limits and names roles that can no longer approve', async () => {
    state.mode = 'rows'
    render(<PurchaseApprovalLimitsPanel />)
    await waitFor(() => expect(screen.getAllByText('SAR 5,000.00').length).toBeGreaterThan(0))
    expect(screen.getByText(/cannot approve purchase orders now: Admin, Director/)).toBeInTheDocument()
  })

  it('shows an error with a retry', async () => {
    state.mode = 'error'
    render(<PurchaseApprovalLimitsPanel />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText('Try again')).toBeInTheDocument()
  })

  it('says not switched on before the migration and hides edits from non-admins', async () => {
    state.mode = 'not_set_up'; state.admin = false
    render(<PurchaseApprovalLimitsPanel />)
    await waitFor(() => expect(screen.getByText(/not switched on yet/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Add limit/ })).toBeNull()
    expect(screen.getByText(/Only an administrator can change these limits/)).toBeInTheDocument()
  })
})
