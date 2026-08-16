/**
 * Expense Trends fetches a reporting scope in ONE round trip (V544).
 *
 * The page used to fan out `get_expense_period_trend` once per country from the
 * browser. Two defects in that, and this file pins the fix for both:
 *
 *  1. COST. N countries cost N round trips. The multi aggregate names every
 *     country in one call.
 *  2. COHERENCE, which is the one a reader can actually see. N separate requests
 *     answer from N different moments, so a three-country trend could carry one
 *     country read before an import and two read after it, and present them side
 *     by side as one comparison. The multi function loops the permitted
 *     countries inside ONE statement, calling the same single-country function
 *     per country, so the whole scope describes one instant.
 *
 * THE EQUALITY PROOF is the point of the file. The multi payload is not merely
 * expected to resemble the fan-out: each block IS the single-country function's
 * own return value, so the rows the page derives must be byte-identical whichever
 * path ran. Both paths are driven against the SAME fixture and the page's own
 * derived output - the export rows, which come off `countries` -> `rows` - is
 * compared. Comparing rendered text would prove much less: two different row
 * sets can paint the same rounded figure.
 *
 * The fallback is not a nicety either. The multi RPC does not exist on a
 * database without V544, and this service layer degrades rather than throwing,
 * so the old fan-out has to still produce the report.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => {
  // Two currencies on purpose: an equality proof that only ever saw one
  // currency could not catch a path that dropped the currency column.
  const DATA = {
    KSA: [
      { country: 'KSA', period: '2024', currency: 'SAR', lines: 100, tyre: 5_000_000, spare: 12_000_000, lubricant: 3_000_000, total: 20_000_000 },
      { country: 'KSA', period: '2025', currency: 'SAR', lines: 106, tyre: 5_050_000, spare: 12_500_000, lubricant: 3_000_000, total: 20_550_000 },
      { country: 'KSA', period: '2026', currency: 'SAR', lines: 90, tyre: 4_000_000, spare: 11_000_000, lubricant: 2_500_000, total: 17_500_000 },
    ],
    UAE: [
      { country: 'UAE', period: '2024', currency: 'AED', lines: 50, tyre: 2_000_000, spare: 6_240_000, lubricant: 1_000_000, total: 9_240_000 },
      { country: 'UAE', period: '2025', currency: 'AED', lines: 70, tyre: 2_000_000, spare: 7_000_000, lubricant: 1_000_000, total: 10_000_000 },
      { country: 'UAE', period: '2026', currency: 'AED', lines: 61, tyre: 1_800_000, spare: 6_000_000, lubricant: 900_000, total: 8_700_000 },
    ],
  }
  return {
    DATA,
    multiAvailable: true,
    multiCalls: [],
    singleCalls: [],
    excel: [],
    allowed: ['KSA', 'UAE'],
    initialScope: { countries: ['KSA'] },
    settings: {},
  }
})

vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => h.settings }))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, isRTL: false }),
}))
vi.mock('../components/ui/PageHeader', () => ({
  default: ({ title, actions }) => <div><h1>{title}</h1>{actions}</div>,
}))
vi.mock('chart.js', () => ({
  Chart: { register: () => {} },
  CategoryScale: {}, LinearScale: {}, BarElement: {}, LineElement: {},
  PointElement: {}, ArcElement: {}, Filler: {}, Tooltip: {}, Legend: {},
}))
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Line: () => null, Doughnut: () => null }))
vi.mock('../lib/exportUtils', () => ({
  exportToExcel: (rows) => { h.excel.push(rows); return Promise.resolve() },
  exportToPdf: () => Promise.resolve(),
}))
vi.mock('../lib/api/expenseTrends', () => ({
  getExpensePeriodTrend: (args) => {
    h.singleCalls.push(args)
    return Promise.resolve(h.DATA[args?.country] || [])
  },
  getExpensePeriodTrendMulti: ({ countries, grain } = {}) => {
    h.multiCalls.push({ countries, grain })
    // A database without V544 answers `ok:false` through isMissingRelation -
    // the exact shape the service degrades to.
    if (!h.multiAvailable) return Promise.resolve({ ok: false, rows: [], refused: [] })
    // The server returns one BLOCK per country and the service flattens them.
    // Each block's payload is the single-country function's own result, which is
    // why the fixture is read from the same map either way.
    return Promise.resolve({
      ok: true,
      refused: [],
      rows: (countries || []).flatMap((c) => h.DATA[c] || []),
    })
  },
}))

import ExpenseTrends from '../pages/ExpenseTrends'

function Harness() {
  const [scope, setScope] = useState(h.initialScope)
  h.settings = { reportingScope: scope, setReportingScope: setScope, allowedScopeCountries: h.allowed }
  return <ExpenseTrends />
}

/**
 * Render the page, wait for the trend to paint, then press Excel and hand back
 * the rows the page DERIVED - country, currency, every period and the forecast
 * rows built on top of them. That is the page's own output, not a re-derivation
 * inside the test.
 */
async function derivedRows() {
  h.excel = []
  render(<Harness />)
  await screen.findByRole('button', { name: /excel/i })
  await waitFor(() => expect(screen.queryByText(/loading expense history/i)).toBeNull())
  await waitFor(() => expect(document.body.textContent).toMatch(/Spend by year/i))
  fireEvent.click(screen.getByRole('button', { name: /excel/i }))
  await waitFor(() => expect(h.excel.length).toBe(1))
  const rows = h.excel[0]
  cleanup()
  return rows
}

beforeEach(() => {
  h.multiAvailable = true
  h.multiCalls = []
  h.singleCalls = []
  h.excel = []
  h.allowed = ['KSA', 'UAE']
  h.initialScope = { countries: ['KSA'] }
  h.settings = {}
})
afterEach(cleanup)

describe('Expense Trends - one request for the whole scope', () => {
  it('asks for every country in scope in a SINGLE call, naming them', async () => {
    h.initialScope = { countries: ['All'] }
    render(<Harness />)
    await waitFor(() => expect(h.multiCalls.length).toBe(1))

    expect(h.multiCalls[0].countries).toEqual(['KSA', 'UAE'])
    expect(h.multiCalls[0].grain).toBe('year')
    // No fan-out at all while the aggregate answers, and no widening "All":
    // the request has to name the countries the reader selected.
    expect(h.singleCalls).toHaveLength(0)
    expect(h.multiCalls[0].countries).not.toContain('All')
  })

  it('re-requests, still once, when the grain changes', async () => {
    h.initialScope = { countries: ['All'] }
    render(<Harness />)
    await waitFor(() => expect(h.multiCalls.length).toBe(1))

    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    await waitFor(() => expect(h.multiCalls.length).toBe(2))
    expect(h.multiCalls[1]).toEqual({ countries: ['KSA', 'UAE'], grain: 'month' })
    expect(h.singleCalls).toHaveLength(0)
  })

  it('requests nothing at all when the scope resolves to no country', async () => {
    h.initialScope = { countries: ['Egypt'] } // not in `allowed`
    render(<Harness />)
    await screen.findByText(/no countries are selected in the reporting scope/i)
    expect(h.multiCalls).toHaveLength(0)
    expect(h.singleCalls).toHaveLength(0)
  })
})

describe('Expense Trends - the aggregate and the fan-out derive identical rows', () => {
  it('is identical for a ONE-country scope', async () => {
    h.initialScope = { countries: ['KSA'] }

    h.multiAvailable = true
    const viaMulti = await derivedRows()
    expect(h.multiCalls).toHaveLength(1)
    expect(h.singleCalls).toHaveLength(0)

    h.multiCalls = []; h.singleCalls = []
    h.multiAvailable = false
    const viaFanOut = await derivedRows()
    // The aggregate was tried and declined, so the old path ran.
    expect(h.multiCalls).toHaveLength(1)
    expect(h.singleCalls.map((c) => c.country)).toEqual(['KSA'])

    expect(viaMulti.length).toBeGreaterThan(0)
    expect(viaFanOut).toEqual(viaMulti)
  })

  it('is identical for a MULTI-country scope, in the same country order', async () => {
    h.initialScope = { countries: ['All'] } // KSA (SAR) + UAE (AED)

    h.multiAvailable = true
    const viaMulti = await derivedRows()
    expect(h.multiCalls).toHaveLength(1)
    expect(h.singleCalls).toHaveLength(0)

    h.multiCalls = []; h.singleCalls = []
    h.multiAvailable = false
    const viaFanOut = await derivedRows()
    // Two round trips where the aggregate needed one - the cost this closes.
    expect(h.singleCalls.map((c) => c.country)).toEqual(['KSA', 'UAE'])

    expect(viaMulti.length).toBeGreaterThan(0)
    expect(viaFanOut).toEqual(viaMulti)
    // Both currencies survive the round trip, unsummed and unrelabelled.
    expect(new Set(viaMulti.map((r) => r.currency))).toEqual(new Set(['SAR', 'AED']))
    expect(viaMulti.map((r) => r.country)).toEqual(
      viaMulti.map((r) => r.country).slice().sort((a, b) => (a === b ? 0 : a === 'KSA' ? -1 : 1)),
    )
  })

  it('still paints both country panels through the fallback path', async () => {
    h.initialScope = { countries: ['All'] }
    h.multiAvailable = false
    render(<Harness />)

    expect(await screen.findByRole('heading', { name: 'KSA' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'UAE' })).toBeTruthy()
    // and still no blended total across the two currencies
    expect(screen.queryByText(/59,790,000/)).toBeNull()
  })
})
