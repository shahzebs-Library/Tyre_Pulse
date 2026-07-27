import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import CostValue, { costScopeLabel } from '../components/cost/CostValue'

const SINGLE = { tyre: 2856963, maintenance: 3109090, currency: 'SAR', blended: false, byCountry: [] }
const MIXED = {
  tyre: 34165043, maintenance: 104278276, currency: 'MIXED', blended: true,
  byCountry: [
    { country: 'KSA', currency: 'SAR', tyre: 11297676, maintenance: 29310674, total: 40608350 },
    { country: 'UAE', currency: 'AED', tyre: 6148661, maintenance: 12344880, total: 18493541 },
    { country: 'Egypt', currency: 'EGP', tyre: 16718706, maintenance: 62622722, total: 79341428 },
  ],
}

describe('CostValue', () => {
  it('renders one correctly-labelled figure for a single country', () => {
    render(<CostValue split={SINGLE} mode="tyres" />)
    expect(screen.getByText('SAR 2,856,963')).toBeTruthy()
  })

  it('renders one figure PER CURRENCY for a mixed scope, never a blend', () => {
    const { container } = render(<CostValue split={MIXED} mode="tyres" />)
    expect(screen.getByText('SAR 11,297,676')).toBeTruthy()
    expect(screen.getByText('AED 6,148,661')).toBeTruthy()
    expect(screen.getByText('EGP 16,718,706')).toBeTruthy()
    // The blended sum must appear nowhere on screen.
    expect(container.textContent).not.toContain('34,165,043')
  })

  it('never renders the blended combined total either', () => {
    const { container } = render(<CostValue split={MIXED} mode="combined" />)
    expect(container.textContent).not.toContain('138,443,319')
    expect(screen.getByText('SAR 40,608,350')).toBeTruthy()
  })

  it('renders N/A for a missing split rather than 0', () => {
    render(<CostValue split={null} />)
    expect(screen.getByText('N/A')).toBeTruthy()
  })

  it('costScopeLabel says the currency, or how many there are', () => {
    expect(costScopeLabel(SINGLE)).toBe('SAR')
    expect(costScopeLabel(MIXED)).toBe('3 currencies')
    expect(costScopeLabel(null)).toBe('N/A')
  })
})
