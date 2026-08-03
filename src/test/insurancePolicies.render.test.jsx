import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Contexts + the service are mocked; the REAL page + the REAL knowledge engine
// render, so a render crash on any section (list, detail, scenario checker,
// total loss) surfaces here.
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'KSA' }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
}))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k, d) => d || k, language: 'en', dir: 'ltr' }),
}))

const POLICIES = [
  { id: 'p1', country: 'KSA', policy_no: '210-AIC-2026-11949342-000', policy_type: 'motor_comprehensive', insurer: 'AIC', insured_name: 'Green Concrete', period_from: '2026-01-01', period_to: '2026-12-31', premium: 120000, sum_insured: null, limit_of_liability: 10000000, currency: 'SAR', deductible_text: '5% min SAR 1000', total_loss_threshold_pct: 60, coverage_summary: 'Comprehensive motor cover', notes: '' },
  { id: 'p2', country: 'KSA', policy_no: '210-PE-2026-11950716-000', policy_type: 'plant_equipment', insurer: 'AIC', insured_name: 'Green Concrete', period_from: '2026-01-01', period_to: '2026-12-31', premium: 90000, sum_insured: 186920953.11, limit_of_liability: null, currency: 'SAR', deductible_text: '', total_loss_threshold_pct: 65, coverage_summary: '', notes: '' },
  { id: 'p3', country: 'KSA', policy_no: '210-TPL-2026-GREENCONCRETE', policy_type: 'motor_tpl', insurer: 'AIC', insured_name: 'Green Concrete', period_from: '2026-01-01', period_to: '2026-12-31', premium: 30000, sum_insured: null, limit_of_liability: null, currency: 'SAR', deductible_text: '', total_loss_threshold_pct: null, coverage_summary: '', notes: '' },
]
const CONDITIONS = [
  { id: 'c1', policy_id: 'p1', seq: 1, category: 'claim_process', clause_text: 'Repair must be approved first.', causes_rejection: true, causes_delay: false, keywords: [] },
  { id: 'c2', policy_id: 'p1', seq: 2, category: 'driver', clause_text: 'Driver must be 25 for a commercial vehicle.', causes_rejection: true, causes_delay: false, keywords: [] },
]

vi.mock('../lib/api/insurancePolicies', () => ({
  listPolicies: () => Promise.resolve({ data: POLICIES, error: null }),
  getPolicy: (id) => Promise.resolve({ data: { ...POLICIES.find((p) => p.id === id), conditions: CONDITIONS }, error: null }),
  listConditions: () => Promise.resolve({ data: CONDITIONS, error: null }),
  createPolicy: () => Promise.resolve({ data: null, error: null }),
  updatePolicy: () => Promise.resolve({ data: null, error: null }),
  deletePolicy: () => Promise.resolve({ data: true, error: null }),
  addCondition: () => Promise.resolve({ data: null, error: null }),
  updateCondition: () => Promise.resolve({ data: null, error: null }),
  deleteCondition: () => Promise.resolve({ data: true, error: null }),
}))

import InsurancePolicies from '../pages/InsurancePolicies'

beforeEach(() => cleanup())

describe('InsurancePolicies renders without crashing', () => {
  it('mounts and shows a policy number', async () => {
    render(<MemoryRouter><InsurancePolicies /></MemoryRouter>)
    await waitFor(() => expect(screen.getAllByText(/210-AIC-2026-11949342-000/).length).toBeGreaterThan(0))
  })
})
