import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({ role: 'Admin', read: vi.fn(), upsert: vi.fn(), list: vi.fn(), tyres: vi.fn(), bulk: vi.fn() }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'owner', role: h.role, region: 'KSA' } }) }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR' }) }))
vi.mock('../contexts/TenantContext', () => ({ useTenant: () => ({ branding: {} }) }))
vi.mock('../contexts/LanguageContext', () => ({ useLanguage: () => ({ t: k => k, language: 'en', dir: 'ltr' }) }))
vi.mock('../lib/fetchAll', () => ({ fetchAllPages: () => Promise.resolve({ data: [], truncated: false }) }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => {
  const query = { select: () => query, eq: () => query, or: () => query, then: (resolve, reject) => h.read().then(resolve, reject), upsert: h.upsert }
  return query
} } }))
vi.mock('../lib/api/budgets', () => ({ listBudgets: h.list, listBudgetTyreRecords: h.tyres, upsertBudgets: h.bulk }))
vi.mock('chart.js', () => ({ Chart: { register: () => {} }, CategoryScale: {}, LinearScale: {}, BarElement: {}, LineElement: {}, PointElement: {}, ArcElement: {}, Title: {}, Tooltip: {}, Legend: {}, Filler: {} }))
vi.mock('react-chartjs-2', () => ({ Bar: () => <div />, Line: () => <div />, Doughnut: () => <div /> }))

import BudgetPlanner from '../pages/BudgetPlanner'
import Budgets from '../pages/Budgets'

const year = new Date().getFullYear()
beforeEach(() => {
  h.role = 'Admin'
  h.read.mockReset().mockResolvedValue({ data: [{ site: '__ANNUAL__', monthly_budget: 1000, year, month: 0 }] })
  h.upsert.mockReset().mockResolvedValue({ error: null })
  h.list.mockReset().mockResolvedValue({ data: [{ id: 'b1', site: 'Riyadh', monthly_budget: 1000, year, month: 1, status: 'Draft' }] })
  h.tyres.mockReset().mockResolvedValue({ data: [] })
  h.bulk.mockReset().mockResolvedValue({ error: null })
})
afterEach(cleanup)

describe('finance workspace controls', () => {
  it('keeps all finance routes reachable after a planner read failure', async () => {
    h.read.mockRejectedValue(new Error('Read failed'))
    render(<MemoryRouter initialEntries={['/budget-planner']}><BudgetPlanner /></MemoryRouter>)
    await screen.findByRole('alert')
    expect(screen.getByRole('link', { name: /Budget Planner/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: /Cost Center/ }).getAttribute('href')).toBe('/cost-center')
    expect(screen.getByRole('link', { name: /Budgets Site/ }).getAttribute('href')).toBe('/budgets')
  })

  it('retains the annual amount and country-scoped write behind the labelled edit action', async () => {
    render(<MemoryRouter><BudgetPlanner /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit budgetplanner.kpi.annualBudget' }))
    const input = screen.getByRole('spinbutton', { name: 'Annual budget amount' })
    fireEvent.change(input, { target: { value: '24000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save annual budget' }))
    await waitFor(() => expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ site: '__ANNUAL__', monthly_budget: 2000, month: 0, year, country: 'KSA', region: 'KSA', created_by: 'owner' }), { onConflict: 'site,region,year,month' }))
  })

  it('does not expose planner budget edits to a non-admin', async () => {
    h.role = 'Manager'
    render(<MemoryRouter><BudgetPlanner /></MemoryRouter>)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
  })

  it('keeps monthly and annual budget views connected to their existing reads and bulk save', async () => {
    render(<MemoryRouter initialEntries={['/budgets']}><Budgets /></MemoryRouter>)
    await screen.findByText('Site budget register')
    fireEvent.click(screen.getByRole('tab', { name: 'budgets.viewModes.annual' }))
    const input = await screen.findByRole('spinbutton', { name: 'Riyadh budgets.months.0 budget' })
    fireEvent.change(input, { target: { value: '2500' } })
    fireEvent.click(screen.getByRole('button', { name: 'budgets.annual.saveChanges' }))
    await waitFor(() => expect(h.bulk).toHaveBeenCalledWith([expect.objectContaining({ site: 'Riyadh', monthly_budget: 2500, year, month: 1 })]))
    expect(h.list).toHaveBeenCalledWith({ country: 'KSA', year })
  })
})
