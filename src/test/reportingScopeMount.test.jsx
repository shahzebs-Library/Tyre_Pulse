/**
 * Reporting Scope, mounted for real on Expense Trends (/expense-trends).
 *
 * The scope control was built and mounted nowhere, so this file pins the thing
 * that makes it worth having: the selection must change WHAT THE PAGE ASKS THE
 * SERVER FOR, not just what it draws. A control that renders and changes nothing
 * is worse than no control, because it tells the reader their choice took
 * effect.
 *
 * Four invariants, each one a real defect if it breaks:
 *
 *  1. the scope drives the QUERY - changing it re-requests different countries
 *  2. a country outside `allowedScopeCountries` is NEVER requested, and the page
 *     never falls back to a widening "All" request
 *  3. a multi-currency scope produces NO combined money total (KSA=SAR,
 *     UAE=AED, Egypt=EGP; a blended SAR+AED+EGP figure is a defect this repo
 *     has already had to fix at several reader sites)
 *  4. a single-currency scope DOES produce one, so rule 3 is a real currency
 *     rule and not a control that simply never shows a number
 *
 * The real ReportingScopeBar is rendered and really clicked - a test that drove
 * the scope only by reassigning a mock would pass even if the bar were never
 * mounted, which is precisely the failure being guarded against.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

/* ── Fixtures + mocks ──────────────────────────────────────────────────────── */

const h = vi.hoisted(() => {
  // Two countries, two currencies, deliberately round totals so a blended sum
  // (59,790,000) is a distinctive string that can be asserted absent.
  const DATA = {
    KSA: [
      { country: 'KSA', period: '2024', currency: 'SAR', lines: 100, tyre: 5_000_000, spare: 12_000_000, lubricant: 3_000_000, total: 20_000_000 },
      { country: 'KSA', period: '2025', currency: 'SAR', lines: 106, tyre: 5_050_000, spare: 12_500_000, lubricant: 3_000_000, total: 20_550_000 },
    ],
    UAE: [
      { country: 'UAE', period: '2024', currency: 'AED', lines: 50, tyre: 2_000_000, spare: 6_240_000, lubricant: 1_000_000, total: 9_240_000 },
      { country: 'UAE', period: '2025', currency: 'AED', lines: 70, tyre: 2_000_000, spare: 7_000_000, lubricant: 1_000_000, total: 10_000_000 },
    ],
    // Present in the source but NOT in this profile's allowed list. If it is ever
    // requested or rendered, the scope has widened access.
    Egypt: [
      { country: 'Egypt', period: '2025', currency: 'EGP', lines: 9, tyre: 1, spare: 1, lubricant: 1, total: 96_360_000 },
    ],
  }
  return {
    DATA,
    calls: [],
    // V544 deployed. Flipped off in the degrade case so the page falls back to
    // the per-country fan-out.
    multiAvailable: true,
    allowed: ['KSA', 'UAE'],
    initialScope: { countries: ['KSA'] },
    settings: {},
  }
})

vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => h.settings,
}))
vi.mock('../contexts/LanguageContext', () => ({
  // No locale entries: the bar's tx() helper then falls back to its English
  // strings, which is what a real deploy renders for an unkeyed label.
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
  exportToExcel: () => Promise.resolve(),
  exportToPdf: () => Promise.resolve(),
}))
// The page fetches the whole scope in ONE multi-country call and keeps the
// per-country fan-out only as the degrade path for a database without V544.
// Both are recorded the same way, so every assertion below reads "which
// countries did this render ask the server for" regardless of which path ran.
vi.mock('../lib/api/expenseTrends', () => ({
  getExpensePeriodTrend: (args) => {
    h.calls.push(args)
    return Promise.resolve(h.DATA[args?.country] || [])
  },
  getExpensePeriodTrendMulti: ({ countries, grain } = {}) => {
    if (!h.multiAvailable) return Promise.resolve({ ok: false, rows: [], refused: [] })
    const list = countries || []
    list.forEach((country) => h.calls.push({ country, grain }))
    return Promise.resolve({
      ok: true,
      refused: [],
      rows: list.flatMap((c) => h.DATA[c] || []),
    })
  },
}))

import ExpenseTrends from '../pages/ExpenseTrends'
import {
  scopeRequestCountries, scopeMoneyTotal, moneyTotalNote, scopeCount, rowsInScope,
} from '../lib/reportingScopeQuery'

/**
 * Holds the reporting scope in real React state and republishes it through the
 * mocked settings hook, so a click inside ReportingScopeBar propagates exactly
 * as the real SettingsContext would.
 */
function Harness() {
  const [scope, setScope] = useState(h.initialScope)
  h.settings = {
    reportingScope: scope,
    setReportingScope: setScope,
    allowedScopeCountries: h.allowed,
  }
  return <ExpenseTrends />
}

/** Countries this render actually asked the server for. */
const requested = () => h.calls.map((c) => c.country)

async function openScopeMenu() {
  fireEvent.click(await screen.findByRole('button', { name: /change reporting scope/i }))
  return screen.findByRole('menu', { name: /reporting scope/i })
}

beforeEach(() => {
  h.calls = []
  h.multiAvailable = true
  h.allowed = ['KSA', 'UAE']
  h.initialScope = { countries: ['KSA'] }
  h.settings = {}
})
afterEach(cleanup)

/* ── 1. The scope drives the query ─────────────────────────────────────────── */

describe('Reporting Scope drives the Expense Trends query', () => {
  it('requests exactly the countries in scope, and no others', async () => {
    render(<Harness />)
    await waitFor(() => expect(h.calls.length).toBeGreaterThan(0))

    expect(requested()).toEqual(['KSA'])
    expect(requested()).not.toContain('UAE')
    expect(requested()).not.toContain('Egypt')
    // "All" would be a widening request: the page must name the countries it wants.
    expect(requested()).not.toContain('All')
  })

  it('re-requests when the reader changes the scope in the mounted bar', async () => {
    render(<Harness />)
    await waitFor(() => expect(requested()).toEqual(['KSA']))
    h.calls = []

    const menu = await openScopeMenu()
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'UAE' }))

    // The selection changed, so the page fetched again - for BOTH countries.
    await waitFor(() => expect(requested()).toContain('UAE'))
    expect(requested()).toContain('KSA')
    expect(requested()).not.toContain('All')
    // and the second country's panel is now on screen
    expect(await screen.findByRole('heading', { name: 'UAE' })).toBeTruthy()
  })

  it('reports on nothing, rather than everything, when the scope resolves to no country', async () => {
    // A saved scope naming only a country this profile may no longer see.
    h.initialScope = { countries: ['Egypt'] }
    render(<Harness />)

    await screen.findByText(/no countries are selected in the reporting scope/i)
    expect(h.calls).toHaveLength(0)
  })
})

/* ── 2. The scope can never widen access ───────────────────────────────────── */

describe('Reporting Scope never widens access', () => {
  it('drops a country outside allowedScopeCountries instead of requesting it', async () => {
    h.initialScope = { countries: ['KSA', 'Egypt'] }
    render(<Harness />)
    await waitFor(() => expect(h.calls.length).toBeGreaterThan(0))

    expect(requested()).toEqual(['KSA'])
    expect(requested()).not.toContain('Egypt')
    // Egypt's total must not reach the page by any route either.
    expect(screen.queryByText(/96,360,000/)).toBeNull()
  })

  it('does not offer a country the profile may not aggregate over', async () => {
    render(<Harness />)
    const menu = await openScopeMenu()

    expect(within(menu).getByRole('menuitemcheckbox', { name: 'KSA' })).toBeTruthy()
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'UAE' })).toBeTruthy()
    expect(within(menu).queryByRole('menuitemcheckbox', { name: 'Egypt' })).toBeNull()
  })

  it('expands the All sentinel only to the permitted countries', () => {
    expect(scopeRequestCountries({ countries: ['All'] }, ['KSA', 'UAE'])).toEqual(['KSA', 'UAE'])
    expect(scopeRequestCountries({ countries: ['All'] }, [])).toEqual([])
    expect(scopeRequestCountries({ countries: ['Egypt'] }, ['KSA', 'UAE'])).toEqual([])
  })
})

/* ── 3 + 4. Currency ───────────────────────────────────────────────────────── */

describe('Reporting Scope and currency', () => {
  it('produces NO combined money total when the scope spans more than one currency', async () => {
    h.initialScope = { countries: ['All'] } // KSA (SAR) + UAE (AED)
    render(<Harness />)
    await waitFor(() => expect(requested()).toEqual(['KSA', 'UAE']))

    const combined = await screen.findByRole('group', { name: 'Combined spend' })
    expect(within(combined).getByText('N/A')).toBeTruthy()

    // The blended figure must appear NOWHERE, in any formatting.
    expect(screen.queryByText(/59,790,000/)).toBeNull()
    expect(screen.queryByText(/59790000/)).toBeNull()

    // and the reader is told why, naming both currencies.
    const why = screen.getByText(/currencies differ across the countries in scope/i)
    expect(why.textContent).toContain('SAR')
    expect(why.textContent).toContain('AED')

    // Each country still reports its own money, which is the sanctioned form.
    expect(screen.getByText(/KSA: SAR 40,550,000/)).toBeTruthy()
    expect(screen.getByText(/UAE: AED 19,240,000/)).toBeTruthy()
  })

  it('still aggregates COUNTS across a multi-currency scope, because they carry no currency', async () => {
    h.initialScope = { countries: ['All'] }
    render(<Harness />)
    await waitFor(() => expect(requested()).toEqual(['KSA', 'UAE']))

    const lines = await screen.findByRole('group', { name: 'Expense lines' })
    expect(within(lines).getByText('326')).toBeTruthy() // 206 KSA + 120 UAE
  })

  it('DOES produce a combined total when the scope holds a single currency', async () => {
    h.initialScope = { countries: ['KSA'] }
    render(<Harness />)
    await waitFor(() => expect(requested()).toEqual(['KSA']))

    const combined = await screen.findByRole('group', { name: 'Combined spend' })
    expect(within(combined).getByText('SAR 40,550,000')).toBeTruthy()
    expect(within(combined).queryByText('N/A')).toBeNull()
    expect(screen.queryByText(/currencies differ/i)).toBeNull()
  })
})

/* ── The pure decision helper ──────────────────────────────────────────────── */

describe('reportingScopeQuery - the pure decisions behind the mount', () => {
  it('withholds the total and reports the breakdown on mixed currencies', () => {
    const r = scopeMoneyTotal([
      { country: 'KSA', currency: 'SAR', total: 10 },
      { country: 'UAE', currency: 'AED', total: 5 },
    ])
    expect(r.total).toBeNull()
    expect(r.currency).toBeNull()
    expect(r.mixedCurrency).toBe(true)
    expect(r.byCurrency).toEqual({ SAR: 10, AED: 5 })
    expect(moneyTotalNote(r)).toMatch(/never added across currencies/i)
  })

  it('totals a single-currency scope and says nothing extra', () => {
    const r = scopeMoneyTotal([
      { country: 'KSA', currency: 'SAR', total: 10 },
      { country: 'KSA', currency: 'SAR', total: 5 },
    ])
    expect(r).toMatchObject({ total: 15, currency: 'SAR', mixedCurrency: false })
    expect(moneyTotalNote(r)).toBe('')
  })

  it('treats a figure with no currency as unusable rather than assuming one', () => {
    const r = scopeMoneyTotal([
      { country: 'KSA', currency: 'SAR', total: 10 },
      { country: 'Unknown', currency: '', total: 999 },
    ])
    expect(r.total).toBe(10)
    expect(r.missing).toBe(1)
    expect(moneyTotalNote(r)).toMatch(/covers 1 of 2 countries/i)
  })

  it('returns null, not a flattering zero, when nothing is countable', () => {
    expect(scopeCount([], 'lines')).toBeNull()
    expect(scopeCount([{ lines: null }], 'lines')).toBeNull()
    expect(scopeCount([{ lines: 3 }, { lines: 4 }], 'lines')).toBe(7)
  })

  it('keeps only in-scope rows, case-insensitively, and nothing at all on an empty scope', () => {
    const rows = [{ country: 'KSA' }, { country: 'uae' }, { country: 'Egypt' }]
    expect(rowsInScope(rows, ['KSA', 'UAE'])).toEqual([{ country: 'KSA' }, { country: 'uae' }])
    expect(rowsInScope(rows, [])).toEqual([])
  })
})
