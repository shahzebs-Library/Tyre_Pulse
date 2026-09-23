import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ profile: { role: 'Admin' } }) }))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR' }) }))
vi.mock('../components/ui/PageHeader', () => ({ default: ({ title }) => <h1>{title}</h1> }))
vi.mock('../components/ui/EnterpriseTable', () => ({ default: () => null }))
vi.mock('../components/ui/DateField', () => ({ default: () => null }))
vi.mock('../lib/supabase', () => ({ supabase: { from(table) {
  const q = { table }
  for (const name of ['select', 'order', 'range', 'eq', 'gte', 'lte', 'not']) q[name] = () => q
  return q
} } }))
vi.mock('../lib/fetchAll', () => ({ fetchAllPages: async (build) => {
  const { table } = build(0, 999)
  return { data: [], truncated: false, error: table === 'work_orders' ? { message: 'Access unavailable' } : null }
} }))
import Anomalies from '../pages/Anomalies'
it('identifies a failed workshop source as incomplete even when the API resolves an error envelope', async () => {
  render(<Anomalies />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Workshop records could not be loaded')
  expect(screen.getByRole('alert')).toHaveTextContent('incomplete')
})
