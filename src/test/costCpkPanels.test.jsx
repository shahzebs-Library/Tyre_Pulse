import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ComparisonStrip, CpkPanel, EvidencePanel } from '../components/expense/CostCpkPanels'

// Icons are noise here; stub every named export the panels reach for.
vi.mock('lucide-react', () => {
  const Icon = () => null
  return {
    TrendingUp: Icon, TrendingDown: Icon, Minus: Icon, Gauge: Icon, ArrowRight: Icon,
    ShieldCheck: Icon, AlertTriangle: Icon, Info: Icon,
  }
})

const money = (v) => (v == null ? 'N/A' : `SAR ${Number(v).toLocaleString('en-US')}`)

const SNAP = {
  currency: 'SAR',
  blended: false,
  min_coverage: 0.25,
  windows: { previous_is_last_year: true },
  totals: {
    current: { tyre: 100, spare: 200, oil: 50, total: 350 },
    previous: { tyre: 80, spare: 300, oil: 40, total: 420 },
    last_year: { tyre: 80, spare: 300, oil: 40, total: 420 },
  },
  cpk: {
    current: { km: 18214944, cpk: 0.225, spend_matched: 4091508, spend_total: 5966053, coverage_pct: 0.6858, assets_measured: 341, comparable: true },
    previous: { km: 29165, cpk: 1.893, spend_matched: 55216, spend_total: 7552449, coverage_pct: 0.0073, assets_measured: 5, comparable: false },
    last_year: { km: 29165, cpk: 1.893, coverage_pct: 0.0073, assets_measured: 5, comparable: false },
  },
  by_evidence: [
    { label: 'code-range', spend: 600, lines: 10 },
    { label: 'default', spend: 400, lines: 40 },
  ],
}

describe('CpkPanel refuses to show a comparison the data cannot support', () => {
  it('states why the comparison is withheld instead of drawing an 8x improvement', () => {
    // 1.893 -> 0.225 looks like a huge win and is entirely coverage: 5 measured
    // assets against 341. The panel must say so rather than print the delta.
    render(<CpkPanel snap={SNAP} money={money} />)
    expect(screen.getAllByText(/Not comparable/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/too few odometer readings/i)).toBeTruthy()
  })

  it('shows the coverage that makes the figure readable', () => {
    render(<CpkPanel snap={SNAP} money={money} />)
    expect(screen.getByText('68.6%')).toBeTruthy()
    expect(screen.getByText('0.225 SAR/km')).toBeTruthy()
  })

  it('renders an unmeasured period as N/A, never as zero cost per km', () => {
    render(<CpkPanel snap={{ currency: 'SAR', cpk: { current: { km: 0, cpk: null, comparable: false } } }} money={money} />)
    expect(screen.getAllByText('N/A').length).toBeGreaterThan(0)
    expect(screen.getByText(/Not enough odometer readings/i)).toBeTruthy()
  })
})

describe('ComparisonStrip', () => {
  it('collapses the duplicate column when previous and last year are the same window', () => {
    render(<ComparisonStrip snap={SNAP} money={money} />)
    expect(screen.queryByText('Same period last year')).toBeNull()
    expect(screen.getByText(/shown once/i)).toBeTruthy()
  })

  it('shows both columns when the windows differ', () => {
    const s = { ...SNAP, windows: { previous_is_last_year: false } }
    render(<ComparisonStrip snap={s} money={money} />)
    expect(screen.getByText('Same period last year')).toBeTruthy()
  })

  it('refuses to show money at all when the scope blends currencies', () => {
    render(<ComparisonStrip snap={{ ...SNAP, blended: true, currency: null }} money={money} />)
    expect(screen.getByText(/add SAR, AED and EGP together/i)).toBeTruthy()
    expect(screen.queryByText('Total spend')).toBeNull()
  })
})

describe('EvidencePanel', () => {
  it('publishes how much of the spend only the fallback explains', () => {
    render(<EvidencePanel snap={SNAP} money={money} />)
    expect(screen.getByText(/40% of this spend was filed by the fallback/i)).toBeTruthy()
  })

  it('renders nothing when there is no provenance to report', () => {
    const { container } = render(<EvidencePanel snap={{ by_evidence: [] }} money={money} />)
    expect(container.firstChild).toBeNull()
  })
})
