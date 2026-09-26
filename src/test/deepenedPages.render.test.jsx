import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/exportUtils', () => ({
  exportToExcel: () => {},
  exportToPdf: () => {},
  reportFileName: (...p) => p.filter(Boolean).join(' '),
}))
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR' }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
}))
vi.mock('../lib/api/sanyDelayPenalty', () => ({
  DEFAULT_RATE_PER_HOUR: 43,
  DEFAULT_MIN_DAYS: 5,
  listDelayPenalties: vi.fn(() => Promise.resolve([
    { id: 1, asset_no: 'TM1', site: 'NHC', work_order_no: 'WO1', period_date: '2026-08-01', downtime_hours: 200, rate_per_hour: 43, penalty_amount: 8600, status: 'draft', currency: 'SAR', created_at: '2026-08-01' },
    { id: 2, asset_no: 'TM1', site: 'JED', work_order_no: 'WO2', period_date: '2026-09-01', downtime_hours: 150, rate_per_hour: 43, penalty_amount: 6450, status: 'deducted', currency: 'SAR' },
  ])),
  getDelayCandidates: vi.fn(() => Promise.resolve({ ok: true, candidates: [] })),
  createDelayPenalties: vi.fn(), createDelayPenalty: vi.fn(), updateDelayPenalty: vi.fn(),
  deleteDelayPenalty: vi.fn(), penaltyFromCandidate: vi.fn(),
}))
vi.mock('../lib/api/workflows', () => ({
  listWorkflowDefinitions: vi.fn(() => Promise.resolve([
    { id: 'a', name: 'Accident approval', entity_type: 'accident', trigger_event: 'accident.created', active: true, steps: [{ name: 'Mgr', assignee_type: 'role', approver_role: 'manager', sla_hours: 24 }] },
    { id: 'b', name: 'Broken chain', entity_type: 'purchase_order', trigger_event: null, active: false, steps: [] },
  ])),
  listAllWorkflowInstances: vi.fn(() => Promise.resolve({ rows: [{ status: 'approved', definition_name: 'Accident approval', started_at: '2026-09-01T00:00:00Z', completed_at: '2026-09-01T05:00:00Z' }], count: 1, truncated: false })),
  deleteWorkflowDefinition: vi.fn(), updateWorkflowDefinition: vi.fn(),
}))

import SanyDelayPenalty from '../pages/SanyDelayPenalty'
import WorkflowSettings from '../pages/WorkflowSettings'
import CostScenarioPlanner from '../pages/CostScenarioPlanner'

beforeEach(() => cleanup())

describe('deepened pages render', () => {
  it('SanyDelayPenalty shows KPIs and ledger rows in SAR', async () => {
    render(<MemoryRouter><SanyDelayPenalty /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('SAR 15,050').length).toBeGreaterThan(0))
    expect(screen.getByText('Penalty to deduct')).toBeTruthy()
    expect(screen.getAllByText('WO1').length).toBeGreaterThan(0)
  })

  it('WorkflowSettings shows KPIs and flags the broken chain', async () => {
    render(<MemoryRouter><WorkflowSettings /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText('Accident approval').length).toBeGreaterThan(0))
    expect(screen.getByText('Needing attention')).toBeTruthy()
    expect(screen.getAllByText(/issue/).length).toBeGreaterThan(0)
  })

  it('CostScenarioPlanner ranks scenarios and shows sensitivity', () => {
    render(<MemoryRouter><CostScenarioPlanner /></MemoryRouter>)
    expect(screen.getByText('Comparison (cheapest first)')).toBeTruthy()
    expect(screen.getByText('Retread break-even')).toBeTruthy()
    expect(screen.getAllByText('Premium new').length).toBeGreaterThan(0)
  })
})
