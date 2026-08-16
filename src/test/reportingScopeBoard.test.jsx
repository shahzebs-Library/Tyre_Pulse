/**
 * Reporting Scope, mounted for real on Board Overview (/board-overview).
 *
 * Board Overview was the harder of the two pages the scope had not reached: ~14
 * reads keyed on a single scalar country across 8 shared API modules, several of
 * them bounded reads whose row ceilings must not multiply, and a KPI grid full of
 * money that used to be labelled with the working context's currency.
 *
 * Five invariants, each a real defect if it breaks:
 *
 *  1. THE SCOPE DRIVES THE QUERY. Changing the scope changes which countries are
 *     requested. A control that renders and changes nothing is worse than no
 *     control, because it tells the reader their choice took effect.
 *  2. THE SCOPE NEVER WIDENS ACCESS. A country outside `allowedScopeCountries`
 *     is never requested, and an unresolvable scope requests NOTHING rather than
 *     falling back to a widening "All".
 *  3. NO BLENDED MONEY. KSA=SAR, UAE=AED, Egypt=EGP. A scope spanning currencies
 *     must produce no combined money total anywhere on the page - this repo has
 *     shipped that defect before ("SAR 138,443,319", a blend of three
 *     currencies). Counts are the control case: they carry no currency and MUST
 *     still aggregate, so rule 3 is a currency rule and not a page that quietly
 *     stopped showing numbers.
 *  4. THE ROW CEILINGS DO NOT MULTIPLY. N countries must stay ONE bounded read
 *     per table, not N reads each with the full ceiling.
 *  5. THE REGRESSION THAT PROTECTS EVERY OTHER PAGE. The widened service
 *     functions, called WITHOUT the new `countries` parameter, emit exactly the
 *     query they always did. Eight other pages call these functions and were not
 *     touched; this is what proves they are unaffected.
 *
 * The real ReportingScopeBar is mounted and really clicked. Driving the scope by
 * reassigning a mock would pass even if the bar were never rendered, which is
 * precisely the failure being guarded against.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const h = vi.hoisted(() => {
  // Deliberately round numbers so a blended sum is a distinctive string that can
  // be asserted ABSENT: tyre spend 6,000,000 + 900,000 = 6,900,000, claims
  // 4,000,000 + 500,000 = 4,500,000.
  const TYRES = {
    KSA: [
      { id: 't1', country: 'KSA', site: 'NHC', issue_date: '2026-05-04', cost_per_tyre: 3_000_000, qty: 1 },
      { id: 't2', country: 'KSA', site: 'NHC', issue_date: '2026-06-04', cost_per_tyre: 3_000_000, qty: 1 },
    ],
    UAE: [
      { id: 't3', country: 'UAE', site: 'JEB', issue_date: '2026-06-04', cost_per_tyre: 900_000, qty: 1 },
    ],
    Egypt: [
      { id: 't9', country: 'Egypt', site: 'CAI', issue_date: '2026-06-04', cost_per_tyre: 77_777_777, qty: 1 },
    ],
  }
  const ACCIDENTS = {
    KSA: [{ id: 'a1', country: 'KSA', site: 'NHC', incident_date: '2026-06-01', severity: 'minor', status: 'reported', claim_amount: 4_000_000, recovered_amount: 1_000_000, claim_status: 'open' }],
    UAE: [{ id: 'a2', country: 'UAE', site: 'JEB', incident_date: '2026-06-02', severity: 'minor', status: 'reported', claim_amount: 500_000, recovered_amount: 100_000, claim_status: 'open' }],
    Egypt: [{ id: 'a9', country: 'Egypt', site: 'CAI', incident_date: '2026-06-03', severity: 'minor', status: 'reported', claim_amount: 88_888_888, recovered_amount: 0, claim_status: 'open' }],
  }
  const FLEET = { KSA: 6, UAE: 3, Egypt: 99 }
  // Per-country governed cost splits, as loadGovernedCostSplit returns them.
  const COST = {
    KSA: { tyre: 6_000_000, maintenance: 2_000_000, byMonth: [{ month: '2026-06', tyre: 6_000_000, maintenance: 2_000_000 }], currency: 'SAR', blended: false, byCountry: [] },
    UAE: { tyre: 900_000, maintenance: 100_000, byMonth: [{ month: '2026-06', tyre: 900_000, maintenance: 100_000 }], currency: 'AED', blended: false, byCountry: [] },
    Egypt: { tyre: 55_555_555, maintenance: 1, byMonth: [{ month: '2026-06', tyre: 55_555_555, maintenance: 1 }], currency: 'EGP', blended: false, byCountry: [] },
  }
  return {
    TYRES, ACCIDENTS, FLEET, COST,
    calls: { tyres: [], inspections: [], actions: [], fleet: [], accidents: [], workOrders: [], stock: [], cost: [], cpk: [] },
    allowed: ['KSA', 'UAE'],
    initialScope: { countries: ['KSA'] },
    settings: {},
  }
})

/** Rows for the countries a read was asked for, mimicking a `country in (...)`. */
const rowsFor = (bank, countries) => (countries || []).flatMap((c) => bank[c] || [])

/* ── Mocks ─────────────────────────────────────────────────────────────────── */

vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => h.settings }))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, isRTL: false }),
}))
vi.mock('../components/ui/PageHeader', () => ({
  default: ({ title, actions }) => <div><h1>{title}</h1>{actions}</div>,
}))
vi.mock('../components/ui/DateField', () => ({ default: () => null }))
vi.mock('../components/expense/YearlyTrendPanel', () => ({ default: () => null }))
vi.mock('../components/EmailPdfButton', () => ({ default: () => null }))
vi.mock('../components/present/PresentationStudio', () => ({ default: () => null }))
vi.mock('../components/present/StudioBoundary', () => ({ default: ({ children }) => <>{children}</> }))
vi.mock('chart.js', () => ({
  Chart: { register: () => {} },
  CategoryScale: {}, LinearScale: {}, BarElement: {}, LineElement: {},
  PointElement: {}, ArcElement: {}, Filler: {}, Title: {}, Tooltip: {}, Legend: {},
}))
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Line: () => null, Doughnut: () => null }))

// The reads. Each records the countries it was asked for and answers with only
// those countries' rows, exactly as a `country in (...)` filter would.
vi.mock('../lib/api/engineeringKpi', () => ({
  listKpiTyreRecords: ({ countries, from, to }) => {
    h.calls.tyres.push({ countries, from, to })
    return Promise.resolve({ data: from === 0 ? rowsFor(h.TYRES, countries) : [], error: null })
  },
  listKpiInspections: ({ countries, from }) => {
    h.calls.inspections.push({ countries })
    return Promise.resolve({ data: from === 0 ? (countries || []).map((c, i) => ({ id: `i${c}${i}`, country: c, completed_date: '2026-06-01', status: 'Done' })) : [], error: null })
  },
  listKpiCorrectiveActions: ({ countries, from }) => {
    h.calls.actions.push({ countries })
    return Promise.resolve({ data: from === 0 ? [] : [], error: null })
  },
  listKpiFleet: ({ countries, from }) => {
    h.calls.fleet.push({ countries })
    const n = (countries || []).reduce((s, c) => s + (h.FLEET[c] || 0), 0)
    return Promise.resolve({ data: from === 0 ? Array.from({ length: n }, (_, i) => ({ id: `f${i}`, asset_no: `A${i}` })) : [], error: null })
  },
}))
vi.mock('../lib/api/accidents', () => ({
  listAllAccidentsForPage: ({ countries }) => {
    h.calls.accidents.push({ countries })
    return Promise.resolve({ data: rowsFor(h.ACCIDENTS, countries), error: null, truncated: false })
  },
}))
vi.mock('../lib/api/workOrders', () => ({
  listWorkOrdersForPage: ({ countries }) => {
    h.calls.workOrders.push({ countries })
    return Promise.resolve([])
  },
}))
vi.mock('../lib/api/stock', () => ({
  listStockRecords: ({ countries }) => {
    h.calls.stock.push({ countries })
    return Promise.resolve([])
  },
}))
vi.mock('../lib/api/governedCost', () => ({
  loadGovernedCostSplit: ({ country }) => {
    h.calls.cost.push({ country })
    return Promise.resolve(h.COST[country] || null)
  },
}))
vi.mock('../lib/api/fleetCpk', () => ({
  getFleetCpk: ({ country }) => {
    h.calls.cpk.push({ country })
    return Promise.resolve({ perVehicle: [], byType: [], fleet: [] })
  },
}))

import BoardOverview from '../pages/BoardOverview'
import {
  scopeCurrency, isMixedCurrencyScope, currencyScopeNote, splitRowsByCountry,
  perCountryMoney, perCountryMonthlySeries, mergeCostSplits, mergeFleetCpk,
  formatPerCountryMoney,
} from '../lib/boardScope'

/** Holds the scope in real React state so a click in the bar propagates. */
function Harness() {
  const [scope, setScope] = useState(h.initialScope)
  h.settings = {
    reportingScope: scope,
    setReportingScope: setScope,
    allowedScopeCountries: h.allowed,
    appSettings: { company_name: 'TyrePulse' },
  }
  return <BoardOverview />
}

/** The distinct countries a read actually asked the server for. */
const requested = (key) => [...new Set(h.calls[key].flatMap((c) => c.countries || (c.country ? [c.country] : [])))]
const everyRequestedCountry = () => [...new Set(Object.keys(h.calls).flatMap((k) => requested(k)))]

async function openScopeMenu() {
  fireEvent.click(await screen.findByRole('button', { name: /change reporting scope/i }))
  return screen.findByRole('menu', { name: /reporting scope/i })
}

/**
 * The VALUE rendered on a named KPI tile. Reading the tile rather than searching
 * the page for a number is what makes "the count is 9" a real assertion: a bare
 * text match would happily find a 9 in a chart label or another tile.
 */
function kpiValue(label) {
  const el = screen.getByText(label, { selector: 'p' })
  const tile = el.parentElement
  return tile?.querySelector('p')?.textContent?.trim() ?? ''
}

beforeEach(() => {
  for (const k of Object.keys(h.calls)) h.calls[k] = []
  h.allowed = ['KSA', 'UAE']
  h.initialScope = { countries: ['KSA'] }
  h.settings = {}
  localStorage.clear()
})
afterEach(cleanup)

/* ── 1. The scope drives the query ─────────────────────────────────────────── */

describe('Reporting Scope drives the Board Overview queries', () => {
  it('requests exactly the countries in scope, across every read on the page', async () => {
    render(<Harness />)
    await waitFor(() => expect(h.calls.tyres.length).toBeGreaterThan(0))
    await waitFor(() => expect(h.calls.cost.length).toBeGreaterThan(0))

    for (const key of ['tyres', 'inspections', 'actions', 'fleet', 'accidents', 'workOrders', 'stock', 'cost', 'cpk']) {
      expect(requested(key)).toEqual(['KSA'])
    }
    // "All" would be a widening request: the page must NAME the countries it wants.
    expect(everyRequestedCountry()).not.toContain('All')
  })

  it('re-requests every read when the reader changes the scope in the mounted bar', async () => {
    render(<Harness />)
    await waitFor(() => expect(requested('tyres')).toEqual(['KSA']))
    for (const k of Object.keys(h.calls)) h.calls[k] = []

    const menu = await openScopeMenu()
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'UAE' }))

    await waitFor(() => expect(requested('tyres')).toEqual(['KSA', 'UAE']))
    await waitFor(() => expect(requested('cost')).toEqual(['KSA', 'UAE']))
    expect(requested('accidents')).toEqual(['KSA', 'UAE'])
    expect(requested('workOrders')).toEqual(['KSA', 'UAE'])
    expect(everyRequestedCountry()).not.toContain('All')
  })

  it('reports on nothing, and asks for nothing, when the scope resolves to no country', async () => {
    // A saved scope naming only a country this profile may no longer see.
    h.initialScope = { countries: ['Egypt'] }
    render(<Harness />)

    await screen.findByText(/no countries are selected in the reporting scope/i)
    // ZERO requests - not one read, not a widened one.
    for (const key of Object.keys(h.calls)) expect(h.calls[key]).toHaveLength(0)
  })
})

/* ── 2. The scope can never widen access ───────────────────────────────────── */

describe('Reporting Scope never widens access on Board Overview', () => {
  it('drops a country outside allowedScopeCountries instead of requesting it', async () => {
    h.initialScope = { countries: ['KSA', 'Egypt'] }
    render(<Harness />)
    await waitFor(() => expect(h.calls.tyres.length).toBeGreaterThan(0))

    expect(everyRequestedCountry()).toEqual(['KSA'])
    expect(everyRequestedCountry()).not.toContain('Egypt')
    // Egypt's figures must not reach the page by any route.
    expect(screen.queryByText(/77,777,777/)).toBeNull()
    expect(screen.queryByText(/88,888,888/)).toBeNull()
  })

  it('does not offer a country the profile may not aggregate over', async () => {
    render(<Harness />)
    const menu = await openScopeMenu()
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'KSA' })).toBeTruthy()
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'UAE' })).toBeTruthy()
    expect(within(menu).queryByRole('menuitemcheckbox', { name: 'Egypt' })).toBeNull()
  })

  it('expands the All sentinel only to the permitted countries', async () => {
    h.initialScope = { countries: ['All'] }
    render(<Harness />)
    await waitFor(() => expect(requested('tyres')).toEqual(['KSA', 'UAE']))
    expect(everyRequestedCountry()).not.toContain('Egypt')
  })
})

/* ── 3. Currency: the hard rule ────────────────────────────────────────────── */

describe('Board Overview and currency', () => {
  it('produces NO blended money figure when the scope spans more than one currency', async () => {
    h.initialScope = { countries: ['All'] } // KSA (SAR) + UAE (AED)
    render(<Harness />)
    await waitFor(() => expect(requested('tyres')).toEqual(['KSA', 'UAE']))
    await screen.findByText(/countries in scope report in different currencies/i)

    // Every blend that would exist if the page added across currencies, in the
    // formattings this page can emit. None may appear anywhere.
    for (const blend of [/6,900,000/, /4,500,000/, /9,000,000/, /6900000/, /4500000/]) {
      expect(screen.queryByText(blend)).toBeNull()
    }
  })

  it('names the currencies it is refusing to add, rather than asking to be trusted', async () => {
    h.initialScope = { countries: ['All'] }
    render(<Harness />)
    const why = await screen.findByText(/countries in scope report in different currencies/i)
    expect(why.textContent).toContain('SAR')
    expect(why.textContent).toContain('AED')
    expect(why.textContent).toMatch(/never added across currencies/i)
  })

  it('still reports each country its own money, which is the sanctioned form', async () => {
    h.initialScope = { countries: ['All'] }
    render(<Harness />)
    await waitFor(() => expect(requested('cost')).toEqual(['KSA', 'UAE']))
    // The cost panel reports per country, each in its own currency.
    await waitFor(() => {
      expect(screen.getAllByText(/Tyres: SAR\s*6,000,000/).length).toBeGreaterThan(0)
      expect(screen.getAllByText(/Tyres: AED\s*900,000/).length).toBeGreaterThan(0)
    })
  })

  it('still AGGREGATES counts across a multi-currency scope, because they carry no currency', async () => {
    h.initialScope = { countries: ['All'] }
    render(<Harness />)
    await waitFor(() => expect(requested('fleet')).toEqual(['KSA', 'UAE']))

    // Summed across the scope, not withheld: this is the control that proves the
    // currency rule is about MONEY and not a page that stopped showing numbers.
    await waitFor(() => expect(kpiValue('Fleet vehicles')).toBe('9')) // 6 + 3
    expect(kpiValue('Tyres tracked')).toBe('3')                       // 2 + 1
    expect(kpiValue('Accidents')).toBe('2')                           // 1 + 1
  })

  it('reports each money KPI per country on the tile itself, never as one blend', async () => {
    h.initialScope = { countries: ['All'] }
    render(<Harness />)
    await waitFor(() => expect(requested('accidents')).toEqual(['KSA', 'UAE']))

    // KSA claimed 4,000,000 SAR and UAE 500,000 AED. Both appear, named, on the
    // one tile; their sum (4,500,000) appears nowhere.
    await waitFor(() => {
      const claims = kpiValue('Claims value')
      expect(claims).toMatch(/KSA/)
      expect(claims).toMatch(/UAE/)
      expect(claims).toMatch(/SAR/)
      expect(claims).toMatch(/AED/)
      expect(claims).not.toMatch(/4,500,000/)
    })
  })

  it('DOES produce a single money figure when the scope holds one currency', async () => {
    h.initialScope = { countries: ['KSA'] }
    render(<Harness />)
    await waitFor(() => expect(requested('cost')).toEqual(['KSA']))

    // The combined cost headline: 6,000,000 tyre + 2,000,000 maintenance, in the
    // scope's own currency - so the withholding above is a real currency rule.
    await waitFor(() => expect(screen.getAllByText(/SAR\s*8,000,000/).length).toBeGreaterThan(0))
    expect(screen.queryByText(/countries in scope report in different currencies/i)).toBeNull()
    expect(kpiValue('Claims value')).toMatch(/SAR/)
    expect(kpiValue('Claims value')).not.toMatch(/KSA/)
  })
})

/* ── 4. Row ceilings must not multiply ─────────────────────────────────────── */

describe('a multi-country scope stays ONE bounded read per table', () => {
  it('does not turn one bounded read into one read per country', async () => {
    h.initialScope = { countries: ['All'] }
    render(<Harness />)
    await waitFor(() => expect(requested('tyres')).toEqual(['KSA', 'UAE']))

    // fetchAllPages issues page 0 and stops (the mock returns a short page), so
    // exactly ONE request per table carrying BOTH countries - never one request
    // per country, which would apply the { max } ceiling twice.
    expect(h.calls.tyres).toHaveLength(1)
    expect(h.calls.tyres[0].countries).toEqual(['KSA', 'UAE'])
    expect(h.calls.tyres[0].from).toBe(0)
    for (const key of ['inspections', 'actions', 'fleet', 'accidents', 'workOrders', 'stock']) {
      expect(h.calls[key]).toHaveLength(1)
      expect(h.calls[key][0].countries).toEqual(['KSA', 'UAE'])
    }
  })
})

/* ── 5. THE REGRESSION: existing callers are untouched ─────────────────────── */

/**
 * A chainable, thenable Supabase mock that records the filter calls, so the
 * EMITTED QUERY can be asserted rather than the arguments that were passed in.
 * Mirrors the builder in engineeringKpi.api.test.js.
 */
const q = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], or: [], in: [], order: [], gte: [], lte: [], range: null }
    const b = {
      _table: table,
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      in(c, v) { calls.in.push([c, v]); return b },
      order(c, o) { calls.order.push([c, o]); return b },
      gte(c, v) { calls.gte.push([c, v]); return b },
      lte(c, v) { calls.lte.push([c, v]); return b },
      range(f, t) { calls.range = [f, t]; return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})
vi.mock('../lib/supabase', () => ({ supabase: q.supabase }))

const engKpi = await vi.importActual('../lib/api/engineeringKpi')
const workOrdersApi = await vi.importActual('../lib/api/workOrders')
const clientApi = await vi.importActual('../lib/api/_client')

describe('the widened service functions are byte-identical without `countries`', () => {
  beforeEach(() => { q.state.result = { data: [], error: null }; q.state.last = null })

  it('listKpiTyreRecords still emits the STRICT eq scope and no ordering', async () => {
    await engKpi.listKpiTyreRecords({ country: 'KSA', dateFrom: '2026-01-01', from: 0, to: 999 })
    expect(q.state.last._calls.eq).toEqual([['country', 'KSA']])
    expect(q.state.last._calls.in).toHaveLength(0)
    expect(q.state.last._calls.or).toHaveLength(0)
    // The multi-country path adds an `id` tiebreak; the single-country path must
    // NOT, or the query every other page issues would have changed.
    expect(q.state.last._calls.order).toHaveLength(0)
    expect(q.state.last._calls.range).toEqual([0, 999])
  })

  it('listKpiFleet still emits no country filter at all when country is absent', async () => {
    await engKpi.listKpiFleet({})
    expect(q.state.last._calls.eq).toHaveLength(0)
    expect(q.state.last._calls.in).toHaveLength(0)
    expect(q.state.last._calls.or).toHaveLength(0)
  })

  it('listWorkOrdersPage still emits eq + opened_at ordering, and its date bounds', async () => {
    await workOrdersApi.listWorkOrdersPage({ country: 'UAE', from: 0, to: 999, openedFrom: '2026-01-01' })
    expect(q.state.last._calls.eq).toEqual([['country', 'UAE']])
    expect(q.state.last._calls.in).toHaveLength(0)
    expect(q.state.last._calls.order).toEqual([['opened_at', { ascending: false }]])
    expect(q.state.last._calls.range).toEqual([0, 999])
    expect(q.state.last._calls.gte).toContainEqual(['opened_at', '2026-01-01'])
  })

  it('a ONE-country scope emits the same FILTER as the scalar country, plus a paging tiebreak', async () => {
    await engKpi.listKpiTyreRecords({ countries: ['KSA'], from: 0, to: 999 })
    expect(q.state.last._calls.eq).toEqual([['country', 'KSA']])
    expect(q.state.last._calls.in).toHaveLength(0)
    // The FILTER is byte-identical, so the rows selected are unchanged - that is
    // the guarantee that matters, and the scalar-`country` path above still
    // emits no ordering at all, so no existing page's query moved.
    //
    // The tiebreak IS added here, though, because a one-country SCOPE is not
    // safe merely for being one country: Board Overview drives this read through
    // `fetchAllPages`, which pages CONCURRENTLY, and this select carries no
    // ORDER BY. Measured on live data, page 2 of the KSA read (8,145 rows =
    // 9 pages) came back with 781 of 1,000 rows different under another sort
    // plan. Ordering cannot change which rows match, only that paging is stable.
    expect(q.state.last._calls.order).toEqual([['id', undefined]])
  })

  it('a MULTI-country scope emits one `in` filter plus a unique-key tiebreak', async () => {
    await engKpi.listKpiTyreRecords({ countries: ['KSA', 'UAE'], from: 0, to: 999 })
    expect(q.state.last._calls.in).toEqual([['country', ['KSA', 'UAE']]])
    expect(q.state.last._calls.eq).toHaveLength(0)
    // These reads have no ORDER BY, so paging over several times as many rows
    // needs a stable sort key or a page boundary can drop or repeat a row.
    expect(q.state.last._calls.order).toEqual([['id', undefined]])
  })

  it('`countries` wins over a stale scalar `country`, so the two can never disagree', async () => {
    await engKpi.listKpiTyreRecords({ country: 'Egypt', countries: ['KSA'], from: 0, to: 999 })
    expect(q.state.last._calls.eq).toEqual([['country', 'KSA']])
  })
})

describe('applyCountries - the list generalisation of applyCountry', () => {
  const build = () => {
    const calls = { eq: [], or: [], in: [] }
    const b = {
      _calls: calls,
      eq(c, v) { calls.eq.push([c, v]); return b },
      or(e) { calls.or.push(e); return b },
      in(c, v) { calls.in.push([c, v]); return b },
    }
    return b
  }

  it('emits EXACTLY applyCountry for a single country, in both null modes', () => {
    const nullSafe = clientApi.applyCountries(build(), ['KSA'])
    const scalar = clientApi.applyCountry(build(), 'KSA')
    expect(nullSafe._calls.or).toEqual(scalar._calls.or)
    expect(clientApi.applyCountries(build(), ['KSA'], { nullSafe: false })._calls.eq)
      .toEqual([['country', 'KSA']])
  })

  it('keeps the NULL-country row visible in the null-safe form, and excluded in the strict one', () => {
    expect(clientApi.applyCountries(build(), ['KSA', 'UAE'])._calls.or[0]).toMatch(/country\.is\.null/)
    const strict = clientApi.applyCountries(build(), ['KSA', 'UAE'], { nullSafe: false })
    expect(strict._calls.or).toHaveLength(0)
    expect(strict._calls.in).toEqual([['country', ['KSA', 'UAE']]])
  })

  it('applies NO filter for an empty list or the All sentinel, never an impossible one', () => {
    for (const input of [[], null, undefined, ['All'], ['', '  ']]) {
      const b = clientApi.applyCountries(build(), input, { nullSafe: false })
      expect(b._calls.eq).toHaveLength(0)
      expect(b._calls.in).toHaveLength(0)
      expect(b._calls.or).toHaveLength(0)
    }
  })

  it('de-duplicates and trims, so a repeated country cannot skew a filter', () => {
    expect(clientApi.countryList([' KSA ', 'KSA', 'UAE', 'All', ''])).toEqual(['KSA', 'UAE'])
  })
})

/* ── The pure scope engine ─────────────────────────────────────────────────── */

describe('boardScope - the pure decisions behind the mount', () => {
  it('resolves one currency, and refuses to name one when the scope spans several', () => {
    expect(scopeCurrency(['KSA'])).toBe('SAR')
    expect(scopeCurrency(['KSA', 'UAE'])).toBeNull()
    expect(isMixedCurrencyScope(['KSA'])).toBe(false)
    expect(isMixedCurrencyScope(['KSA', 'UAE'])).toBe(true)
    // An unknown country contributes no currency rather than a guess, so it can
    // never make a mixed scope look single-currency.
    expect(scopeCurrency(['KSA', 'Atlantis'])).toBe('SAR')
    expect(currencyScopeNote(['KSA'])).toBe('')
    expect(currencyScopeNote(['KSA', 'UAE'])).toMatch(/SAR, AED/)
  })

  it('withholds the scalar totals but keeps the per-country answer, on a mixed merge', () => {
    const m = mergeCostSplits([
      { country: 'KSA', split: { tyre: 10, maintenance: 5, byMonth: [{ month: '2026-06', tyre: 10, maintenance: 5 }] } },
      { country: 'UAE', split: { tyre: 3, maintenance: 1, byMonth: [{ month: '2026-06', tyre: 3, maintenance: 1 }] } },
    ])
    expect(m.blended).toBe(true)
    // NULL, never 0: "we refuse to add these" and "these come to nothing" are
    // opposite statements, and a 0 would render as free.
    expect(m.tyre).toBeNull()
    expect(m.maintenance).toBeNull()
    expect(m.byMonth).toEqual([])
    expect(m.perCountry.map((p) => [p.country, p.currency, p.combined]))
      .toEqual([['KSA', 'SAR', 15], ['UAE', 'AED', 4]])
  })

  it('passes a single-country split straight through, so nothing shifts for one country', () => {
    const split = { tyre: 10, maintenance: 5, byMonth: [], currency: 'SAR', blended: false }
    const m = mergeCostSplits([{ country: 'KSA', split }])
    expect(m).toMatchObject({ tyre: 10, maintenance: 5, currency: 'SAR', blended: false })
  })

  it('DOES add countries that genuinely share a currency', () => {
    const m = mergeCostSplits([
      { country: 'KSA', split: { tyre: 10, maintenance: 5, byMonth: [{ month: '2026-06', tyre: 10, maintenance: 5 }] } },
      { country: 'KSA', split: { tyre: 1, maintenance: 2, byMonth: [{ month: '2026-06', tyre: 1, maintenance: 2 }] } },
    ])
    expect(m.blended).toBe(false)
    expect(m.tyre).toBe(11)
    expect(m.byMonth).toEqual([{ month: '2026-06', tyre: 11, maintenance: 7 }])
  })

  it('partitions rows per country, case-insensitively, dropping anything out of scope', () => {
    const rows = [{ country: 'KSA' }, { country: 'uae' }, { country: 'Egypt' }, { country: null }]
    const parts = splitRowsByCountry(rows, ['KSA', 'UAE'])
    expect(parts.map((p) => [p.country, p.currency, p.rows.length]))
      .toEqual([['KSA', 'SAR', 1], ['UAE', 'AED', 1]])
  })

  it('keeps a country with no figure visible as N/A rather than dropping it', () => {
    const entries = perCountryMoney([{ country: 'KSA', v: 10 }, { country: 'UAE', v: null }], (e) => e.v)
    expect(entries).toEqual([
      { country: 'KSA', currency: 'SAR', value: 10 },
      { country: 'UAE', currency: 'AED', value: null },
    ])
    expect(formatPerCountryMoney(entries, (v, c) => `${c} ${v}`)).toBe('KSA: SAR 10')
    expect(formatPerCountryMoney([], () => '')).toBe('N/A')
  })

  it('builds one monthly series per country, each labelled with its own currency', () => {
    const s = perCountryMonthlySeries(
      [
        { country: 'KSA', byMonth: [{ month: '2026-05', tyre: 1 }, { month: '2026-06', tyre: 2 }] },
        { country: 'UAE', byMonth: [{ month: '2026-06', tyre: 9 }] },
      ],
      (m) => m.tyre,
    )
    expect(s.labels).toEqual(['2026-05', '2026-06'])
    expect(s.datasets).toEqual([
      { label: 'KSA (SAR)', data: [1, 2] },
      { label: 'UAE (AED)', data: [0, 9] },
    ])
  })

  it('merges fleet CPK by concatenation, because those rows are never added', () => {
    const m = mergeFleetCpk([
      { perVehicle: [1], byType: [], fleet: [{ country: 'KSA', currency: 'SAR' }] },
      { perVehicle: [2], byType: [{ x: 1 }], fleet: [{ country: 'UAE', currency: 'AED' }] },
      null,
    ])
    expect(m.perVehicle).toEqual([1, 2])
    expect(m.byType).toEqual([{ x: 1 }])
    expect(m.fleet.map((f) => f.currency)).toEqual(['SAR', 'AED'])
  })
})
