import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// MODC-04: a Manager or Director used to see the full budget editor and then
// meet a refused save. The editor now follows the server's own answer
// (app_user_can, the function the budgets policies call).
const h = vi.hoisted(() => ({ role: 'Manager', can: false, rpcFails: false, list: vi.fn(), tyres: vi.fn(), bulk: vi.fn(), rpc: vi.fn() }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u1', role: h.role, region: 'KSA' }, isSuperAdmin: false }) }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR' }) }))
vi.mock('../contexts/TenantContext', () => ({ useTenant: () => ({ branding: {} }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: k => k, language: 'en', dir: 'ltr' }) }))
vi.mock('../lib/fetchAll', () => ({ fetchAllPages: () => Promise.resolve({ data: [], truncated: false }) }))
vi.mock('../lib/supabase', () => ({ supabase: {
  rpc: (name, args) => { h.rpc(name, args); return h.rpcFails ? Promise.resolve({ data: null, error: { message: 'offline' } }) : Promise.resolve({ data: h.can, error: null }) },
} }))
vi.mock('../lib/api/budgets', () => ({ listBudgets: h.list, listBudgetTyreRecords: h.tyres, upsertBudgets: h.bulk, upsertBudget: vi.fn(), updateBudgetStatus: vi.fn() }))
vi.mock('chart.js', () => ({ Chart: { register: () => {} }, CategoryScale: {}, LinearScale: {}, BarElement: {}, LineElement: {}, PointElement: {}, ArcElement: {}, Title: {}, Tooltip: {}, Legend: {}, Filler: {} }))
vi.mock('react-chartjs-2', () => ({ Bar: () => <div />, Line: () => <div />, Doughnut: () => <div /> }))

import Budgets from '../pages/Budgets'

const year = new Date().getFullYear()
beforeEach(() => {
  h.role = 'Manager'; h.can = false; h.rpcFails = false
  h.rpc.mockReset()
  h.list.mockReset().mockResolvedValue({ data: [{ id: 'b1', site: 'Riyadh', monthly_budget: 1000, year, month: 1, status: 'Draft' }] })
  h.tyres.mockReset().mockResolvedValue({ data: [] })
})
afterEach(cleanup)

const open = async () => {
  render(<MemoryRouter initialEntries={['/budgets']}><Budgets /></MemoryRouter>)
  await screen.findByText('Site budget register')
  return screen.getByRole('button', { name: /budgets\.actions\.setBudget/ })
}

describe('Budgets editor follows what the database allows (MODC-04)', () => {
  it('a Manager the server refuses sees a read-only page with the reason', async () => {
    const setBudget = await open()
    await waitFor(() => expect(screen.getByRole('note')).toBeTruthy())
    expect(h.rpc).toHaveBeenCalledWith('app_user_can', { p_key: 'budgets', p_cap: 'create' })
    expect(h.rpc).toHaveBeenCalledWith('app_user_can', { p_key: 'budgets', p_cap: 'edit' })
    expect(setBudget.disabled).toBe(true)
    expect(screen.getByRole('note').textContent).toMatch(/read-only for your account/)
    expect(screen.getByRole('note').textContent).toMatch(/Access Control/)
  })

  it('a Director is treated the same way', async () => {
    h.role = 'Director'
    const setBudget = await open()
    await waitFor(() => expect(screen.getByRole('note')).toBeTruthy())
    expect(setBudget.disabled).toBe(true)
  })

  it('a Manager given the budget rights in Access Control gets the editor', async () => {
    h.can = true
    const setBudget = await open()
    await waitFor(() => expect(setBudget.disabled).toBe(false))
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('an Admin always gets the editor', async () => {
    h.role = 'Admin'
    const setBudget = await open()
    await waitFor(() => expect(setBudget.disabled).toBe(false))
  })

  it('stays read-only, and says why, when the right could not be confirmed', async () => {
    h.rpcFails = true
    const setBudget = await open()
    await waitFor(() => expect(screen.getByRole('note')).toBeTruthy())
    expect(setBudget.disabled).toBe(true)
    expect(screen.getByRole('note').textContent).toMatch(/could not be confirmed/)
  })
})
