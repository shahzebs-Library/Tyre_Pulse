import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { populatedSources, emptySources } from './fixtures/inventoryKpiSources'

const api = { sources: null, history: null }
vi.mock('../lib/api/inventoryKpi', () => ({
  loadKpiSources: () => Promise.resolve(api.sources),
  loadStockHistory: () => Promise.resolve(api.history),
}))
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ activeCountry: 'KSA', appSettings: {} }) }))
vi.mock('../components/trust/ExplainThisNumber', () => ({ default: () => null }))

import KpiCatalogueSection from '../components/inventory/KpiCatalogueSection'
import ClassificationSection from '../components/inventory/ClassificationSection'
import { LanguageProvider } from '../contexts/LanguageContext'

const scope = { country: 'KSA', site: 'all' }
const all = () => true
const noValue = (c) => c !== 'view_value'
const wrap = (ui) => render(<LanguageProvider>{ui}</LanguageProvider>)
const tile = (name) => screen.getByRole('article', { name })

beforeEach(() => {
  api.sources = populatedSources()
  api.history = populatedSources()
})

describe('Inventory KPI catalogue screen', () => {
  it('renders all four groups with real figures, periods and definitions', async () => {
    wrap(<KpiCatalogueSection scope={scope} can={all} />)
    expect(await screen.findByRole('heading', { name: 'Availability' })).toBeTruthy()
    for (const g of ['Count accuracy', 'Value and movement', 'Suppliers and procurement']) expect(screen.getByRole('heading', { name: g })).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(23)
    expect(within(tile('Critical item availability')).getByText('100%')).toBeTruthy()
    expect(within(tile('Gross shortage')).getByText('1')).toBeTruthy()
    expect(within(tile('Gross shortage')).getByText('SAR 100.00')).toBeTruthy()
    expect(within(tile('Count completion')).getByText('Count AUD-1')).toBeTruthy()
    expect(within(tile('Lead-time variance')).getByText('3 d')).toBeTruthy()
    expect(within(tile('Purchase avoidance')).getByText(/requests do not record whether they were met from stock/)).toBeTruthy()
    expect(within(tile('Inventory accuracy (exact line)')).getAllByText('Definition').length).toBe(1)
    expect(screen.getByRole('button', { name: /Export Excel/ })).toBeTruthy()
  })

  it('shows an honest empty state per KPI and never a fabricated 0', async () => {
    api.sources = emptySources()
    wrap(<KpiCatalogueSection scope={{ country: 'KSA', site: 'NHC' }} can={all} />)
    await screen.findByRole('heading', { name: 'Availability' })
    expect(within(tile('Gross shortage')).getByText('No physical count has reached reconciliation yet for NHC.')).toBeTruthy()
    expect(within(tile('Gross shortage')).queryByText('0')).toBeNull()
    expect(within(tile('Inventory turnover')).getByText('No stock movements recorded yet for NHC in the last 12 months.')).toBeTruthy()
    expect(within(tile('Supplier delivery performance (OTIF)')).getByText('No purchase orders recorded yet for NHC in this period.')).toBeTruthy()
    expect(screen.getAllByText('No figure').length).toBe(23)
  })

  it('hides money KPIs without the view value permission', async () => {
    wrap(<KpiCatalogueSection scope={scope} can={noValue} />)
    await screen.findByRole('heading', { name: 'Availability' })
    expect(within(tile('Dead stock')).getByText('Needs view value permission')).toBeTruthy()
    expect(within(tile('Gross shortage')).queryByText('SAR 100.00')).toBeNull()
  })

  it('reports a failed source with Retry', async () => {
    api.sources = { ...emptySources(), orders: { status: 'error', rows: [], error: 'Network error' } }
    wrap(<KpiCatalogueSection scope={scope} can={all} />)
    expect(await screen.findByRole('button', { name: /Retry/ })).toBeTruthy()
    expect(within(tile('Emergency purchase rate')).getByText('Could not load the data for this KPI.')).toBeTruthy()
  })
})

describe('Inventory classification screen', () => {
  it('summarises ABC, FSN and VED classes with a filterable table', async () => {
    wrap(<ClassificationSection scope={scope} can={all} />)
    expect(await screen.findByText('P-1')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'ABC (value)' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByText('100.0%').length).toBeGreaterThan(0) // share and cumulative share shown
    fireEvent.click(screen.getByRole('tab', { name: 'VED (criticality)' }))
    expect(screen.getAllByText('V (vital)').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByRole('searchbox', { name: /Search item code/ }), { target: { value: 'filter' } })
    expect(screen.queryByText('P-1')).toBeNull()
    expect(screen.getByText('P-2')).toBeTruthy()
    expect(screen.getByText('Criticality not recorded in the item master.')).toBeTruthy()
  })

  it('shows the empty state when nothing is stocked', async () => {
    api.history = emptySources()
    wrap(<ClassificationSection scope={scope} can={all} />)
    expect(await screen.findByText('No stocked items or stock issues recorded yet for KSA.')).toBeTruthy()
  })

  it('keeps ABC behind the view value permission', async () => {
    wrap(<ClassificationSection scope={scope} can={noValue} />)
    expect(await screen.findByText('You do not have access to this')).toBeTruthy()
    expect(screen.queryByText('P-1')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'FSN (movement)' }))
    expect(await screen.findByText('P-1')).toBeTruthy()
  })
})
