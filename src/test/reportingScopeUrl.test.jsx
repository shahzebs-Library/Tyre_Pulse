/**
 * The reporting scope in the URL: a report you can SEND, and a refresh that
 * comes back to the same report.
 *
 * Expense Trends kept its scope in React state plus localStorage, so the address
 * bar described nothing: a reader could not link a colleague to the report on
 * their screen, and a refresh silently returned to whatever was last stored
 * rather than to what they were looking at.
 *
 * Four invariants, each a real defect if it breaks:
 *
 *  1. A LINK IS HONOURED. `?scope=KSA,UAE` makes the page request exactly those
 *     countries, on its FIRST fetch, not after a visible correction.
 *  2. A LINK IS UNTRUSTED. A country outside `allowedScopeCountries` is dropped
 *     on read: never requested, never rendered, and never a route to widening
 *     access. This is the one that matters - a URL is attacker-editable and
 *     travels through chat and ticket systems.
 *  3. NO PARAMETER MEANS NO CHANGE. An old bookmark still resolves to the
 *     stored scope, exactly as before this existed.
 *  4. HISTORY IS NOT POLLUTED. Filter changes REPLACE the URL. `pushState` is
 *     spied on and must never fire, so Back leaves the report rather than
 *     stepping the reader through their own clicks.
 *
 * Plus the round trip that is the whole point: mutate the controls, take the URL
 * the page produced, reopen with it, and get the same report back even when the
 * stored scope says something else.
 *
 * The real page, the real ReportingScopeBar and a real BrowserRouter are used -
 * driving the scope by reassigning a mock would pass even if none of the wiring
 * existed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'

/* ── Fixtures + mocks ──────────────────────────────────────────────────────── */

const h = vi.hoisted(() => {
  const DATA = {
    KSA: [
      { country: 'KSA', period: '2024', currency: 'SAR', lines: 100, tyre: 5_000_000, spare: 12_000_000, lubricant: 3_000_000, total: 20_000_000 },
      { country: 'KSA', period: '2025', currency: 'SAR', lines: 106, tyre: 5_050_000, spare: 12_500_000, lubricant: 3_000_000, total: 20_550_000 },
    ],
    UAE: [
      { country: 'UAE', period: '2024', currency: 'AED', lines: 50, tyre: 2_000_000, spare: 6_240_000, lubricant: 1_000_000, total: 9_240_000 },
      { country: 'UAE', period: '2025', currency: 'AED', lines: 70, tyre: 2_000_000, spare: 7_000_000, lubricant: 1_000_000, total: 10_000_000 },
    ],
    // Present in the source but NOT in the default profile's allowed list. Its
    // total is a distinctive string so it can be asserted absent from the page.
    Egypt: [
      { country: 'Egypt', period: '2025', currency: 'EGP', lines: 9, tyre: 1, spare: 1, lubricant: 1, total: 96_360_000 },
    ],
  }
  return { DATA, calls: [], allowed: ['KSA', 'UAE'], initialScope: { countries: ['KSA'] }, settings: {} }
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
  exportToExcel: () => Promise.resolve(),
  exportToPdf: () => Promise.resolve(),
}))
vi.mock('../lib/api/expenseTrends', () => ({
  getExpensePeriodTrend: (args) => {
    h.calls.push(args)
    return Promise.resolve(h.DATA[args?.country] || [])
  },
}))

import ExpenseTrends from '../pages/ExpenseTrends'
import {
  scopeFromParam, scopeToParam, parseScopeParam, oneOfParam,
  periodFromParam, periodToParam, readReportUrl, reportUrlParams,
  applyReportUrlParams, SCOPE_PARAM,
} from '../lib/reportingScopeQuery'

/**
 * Holds the reporting scope in real React state (as SettingsContext does) so a
 * scope written by the page or clicked in the bar propagates for real.
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

/** Open the page at a given URL, exactly as a shared link would. */
function open(url = '/expense-trends') {
  window.history.replaceState(null, '', url)
  return render(<BrowserRouter><Harness /></BrowserRouter>)
}

const requested = () => h.calls.map((c) => c.country)
const search = () => decodeURIComponent(window.location.search)
const scopeParam = () => new URLSearchParams(window.location.search).get(SCOPE_PARAM)

async function openScopeMenu() {
  fireEvent.click(await screen.findByRole('button', { name: /change reporting scope/i }))
  return screen.findByRole('menu', { name: /reporting scope/i })
}

let pushSpy

beforeEach(() => {
  h.calls = []
  h.allowed = ['KSA', 'UAE']
  h.initialScope = { countries: ['KSA'] }
  h.settings = {}
  window.history.replaceState(null, '', '/expense-trends')
  pushSpy = vi.spyOn(window.history, 'pushState')
})
afterEach(() => {
  cleanup()
  pushSpy.mockRestore()
  window.history.replaceState(null, '', '/expense-trends')
})

/* ── 1. A link is honoured ─────────────────────────────────────────────────── */

describe('the URL selects the reporting scope', () => {
  it('requests exactly the countries named in the link, whatever was stored', async () => {
    // Stored scope says KSA only; the link says both. The link wins.
    h.initialScope = { countries: ['KSA'] }
    open('/expense-trends?scope=KSA,UAE')

    await waitFor(() => expect(requested()).toContain('UAE'))
    expect([...requested()].sort()).toEqual(['KSA', 'UAE'])
    // No widening request, and nothing outside the link.
    expect(requested()).not.toContain('All')
    expect(requested()).not.toContain('Egypt')

    // Both panels are on screen, so the page really reports what the link asked for.
    expect(await screen.findByRole('heading', { name: 'KSA' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'UAE' })).toBeTruthy()
  })

  it('asks for the linked countries on the FIRST fetch, not after a correction', async () => {
    h.initialScope = { countries: ['KSA'] }
    open('/expense-trends?scope=UAE')

    await waitFor(() => expect(h.calls.length).toBeGreaterThan(0))
    // A stray first request for the stored scope would show up here as a
    // leading 'KSA' - the link has to be resolved before anything is fetched.
    expect(requested()).toEqual(['UAE'])
  })

  it('reads the All sentinel as every country this reader may see, and no more', async () => {
    open('/expense-trends?scope=All')

    await waitFor(() => expect(h.calls.length).toBeGreaterThan(0))
    expect([...requested()].sort()).toEqual(['KSA', 'UAE'])
    expect(requested()).not.toContain('Egypt')
  })

  it('restores the period controls from the link', async () => {
    open('/expense-trends?scope=KSA&grain=month&from=2024-03&to=2025-12')

    await waitFor(() => expect(h.calls.length).toBeGreaterThan(0))
    // The grain travels with the request, so the link reproduces the real query.
    expect(h.calls[0]).toMatchObject({ country: 'KSA', grain: 'month' })
    expect(screen.getByDisplayValue('Mar')).toBeTruthy()
    expect(screen.getByDisplayValue('2024')).toBeTruthy()
  })

  it('ignores a malformed period or grain instead of querying nonsense', async () => {
    open('/expense-trends?scope=KSA&grain=fortnight&from=not-a-date&to=2024-77')

    await waitFor(() => expect(h.calls.length).toBeGreaterThan(0))
    expect(h.calls[0]).toMatchObject({ country: 'KSA', grain: 'year' })
    // Junk is dropped from the URL rather than echoed back into it.
    await waitFor(() => expect(search()).not.toMatch(/fortnight|not-a-date/))
  })
})

/* ── 2. A link is untrusted ────────────────────────────────────────────────── */

describe('the URL can never widen access', () => {
  it('drops a country the reader may not aggregate over', async () => {
    open('/expense-trends?scope=KSA,Egypt')

    await waitFor(() => expect(h.calls.length).toBeGreaterThan(0))
    expect(requested()).toEqual(['KSA'])
    expect(requested()).not.toContain('Egypt')

    // Egypt must not reach the page by any route: not a panel, not a figure.
    expect(screen.queryByRole('heading', { name: 'Egypt' })).toBeNull()
    expect(screen.queryByText(/96,360,000/)).toBeNull()

    // and the forbidden country is not written back into the address bar either.
    await waitFor(() => expect(scopeParam()).toBe('KSA'))
  })

  it('keeps the stored scope, not an empty or widened one, when the link names only forbidden countries', async () => {
    h.initialScope = { countries: ['UAE'] }
    open('/expense-trends?scope=Egypt')

    await waitFor(() => expect(h.calls.length).toBeGreaterThan(0))
    // Falls back to what this reader already had: a valid report, never "All"
    // and never a blank page caused by somebody else's link.
    expect(requested()).toEqual(['UAE'])
    expect(requested()).not.toContain('Egypt')
    expect(screen.queryByText(/96,360,000/)).toBeNull()
    // The bad link self-corrects to one that describes what is actually shown.
    await waitFor(() => expect(scopeParam()).toBe('UAE'))
  })

  it('re-checks on every read: the same link resolves differently for a narrower profile', async () => {
    // Sender may see both and shares a two-country link.
    open('/expense-trends?scope=KSA,UAE')
    await waitFor(() => expect([...requested()].sort()).toEqual(['KSA', 'UAE']))

    cleanup()
    h.calls = []
    // Recipient may only see UAE. The same link must narrow, not widen.
    h.allowed = ['UAE']
    h.initialScope = { countries: ['UAE'] }
    open('/expense-trends?scope=KSA,UAE')

    await waitFor(() => expect(h.calls.length).toBeGreaterThan(0))
    expect(requested()).toEqual(['UAE'])
    expect(requested()).not.toContain('KSA')
  })

  it('carries country names only, never an internal id', async () => {
    open('/expense-trends?scope=KSA,UAE')
    await waitFor(() => expect(scopeParam()).toBeTruthy())

    expect(search()).toMatch(/scope=KSA,UAE/)
    // No uuid-shaped value anywhere in the link.
    expect(search()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(search()).not.toMatch(/org|organisation|user|profile|tenant/i)
  })
})

/* ── 3. No parameter means no change ───────────────────────────────────────── */

describe('a URL with no scope behaves exactly as before', () => {
  it('falls back to the stored scope', async () => {
    h.initialScope = { countries: ['UAE'] }
    open('/expense-trends')

    await waitFor(() => expect(h.calls.length).toBeGreaterThan(0))
    expect(requested()).toEqual(['UAE'])
  })

  it('then publishes that scope so the address bar is worth copying', async () => {
    h.initialScope = { countries: ['UAE'] }
    open('/expense-trends')

    await waitFor(() => expect(scopeParam()).toBe('UAE'))
    // Defaulted controls stay out of the URL, so a shared link stays short.
    expect(search()).not.toMatch(/grain=/)
    expect(search()).not.toMatch(/from=|to=/)
  })

  it('leaves parameters belonging to other features untouched', async () => {
    open('/expense-trends?tab=summary')

    await waitFor(() => expect(scopeParam()).toBe('KSA'))
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('summary')
  })
})

/* ── 4. History is not polluted ────────────────────────────────────────────── */

describe('changing a control replaces the URL and never pushes history', () => {
  it('writes the new scope without a history entry', async () => {
    open('/expense-trends?scope=KSA')
    await waitFor(() => expect(requested()).toEqual(['KSA']))
    const depth = window.history.length

    const menu = await openScopeMenu()
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'UAE' }))

    // Selecting every permitted country canonicalises to the All sentinel, which
    // is what the in-page control stores, so the link says the same thing.
    await waitFor(() => expect(scopeParam()).toBe('All'))
    expect(requested()).toContain('UAE')

    expect(pushSpy).not.toHaveBeenCalled()
    expect(window.history.length).toBe(depth)
  })

  it('spells out a partial selection rather than hiding it behind All', async () => {
    h.allowed = ['KSA', 'UAE', 'Egypt']
    open('/expense-trends?scope=KSA')
    await waitFor(() => expect(requested()).toEqual(['KSA']))

    const menu = await openScopeMenu()
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'UAE' }))

    await waitFor(() => expect(scopeParam()).toBe('KSA,UAE'))
    expect(requested()).not.toContain('Egypt')
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('writes the period controls without a history entry either', async () => {
    open('/expense-trends?scope=KSA')
    await waitFor(() => expect(requested()).toEqual(['KSA']))
    const depth = window.history.length

    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    await waitFor(() => expect(search()).toMatch(/grain=month/))

    // Repeated changes must not accumulate entries either.
    fireEvent.click(screen.getByRole('button', { name: 'Quarter' }))
    await waitFor(() => expect(search()).toMatch(/grain=quarter/))
    fireEvent.click(screen.getByRole('button', { name: 'Year' }))
    // Back at the default, so the parameter is dropped rather than pinned.
    await waitFor(() => expect(search()).not.toMatch(/grain=/))

    expect(pushSpy).not.toHaveBeenCalled()
    expect(window.history.length).toBe(depth)
  })

  it('does not rewrite the URL on re-renders that change nothing', async () => {
    open('/expense-trends?scope=KSA')
    await waitFor(() => expect(requested()).toEqual(['KSA']))
    expect(search()).toBe('?scope=KSA')

    // Watch only what happens AFTER the page has settled: a sync that wrote on
    // every render would touch history forever and is the loop this guards.
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    h.calls = []
    fireEvent.click(screen.getByTitle('Refresh'))
    await waitFor(() => expect(requested()).toEqual(['KSA']))

    expect(replaceSpy).not.toHaveBeenCalled()
    expect(search()).toBe('?scope=KSA')
    replaceSpy.mockRestore()
  })
})

/* ── The round trip: refresh reproduces what is on screen ──────────────────── */

describe('a refresh comes back to the same report', () => {
  it('reopens on the URL the page produced, even when storage says otherwise', async () => {
    open('/expense-trends?scope=KSA')
    await waitFor(() => expect(requested()).toEqual(['KSA']))

    // The reader widens the scope and narrows the period.
    const menu = await openScopeMenu()
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'UAE' }))
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    await waitFor(() => expect(search()).toMatch(/grain=month/))

    const shared = window.location.pathname + window.location.search
    expect(shared).toMatch(/scope=All/)

    // Refresh: a fresh mount whose STORED scope deliberately disagrees.
    cleanup()
    h.calls = []
    h.initialScope = { countries: ['KSA'] }
    open(shared)

    await waitFor(() => expect(h.calls.length).toBeGreaterThan(1))
    expect([...requested()].sort()).toEqual(['KSA', 'UAE'])
    expect(h.calls.every((c) => c.grain === 'month')).toBe(true)
    expect(await screen.findByRole('heading', { name: 'UAE' })).toBeTruthy()
  })

  it('still refuses to blend currencies on a linked multi-country report', async () => {
    open('/expense-trends?scope=KSA,UAE')
    await waitFor(() => expect([...requested()].sort()).toEqual(['KSA', 'UAE']))

    // KSA reports SAR and UAE reports AED, so there is no combined figure to
    // give - arriving by link must not become a way around that rule.
    const combined = await screen.findByRole('group', { name: 'Combined spend' })
    expect(within(combined).getByText('N/A')).toBeTruthy()
    expect(screen.queryByText(/59,790,000/)).toBeNull()
  })
})

/* ── The pure URL mapping ──────────────────────────────────────────────────── */

describe('reportingScopeQuery - the pure URL mapping', () => {
  const allowed = ['KSA', 'UAE']

  it('splits a scope value tolerantly', () => {
    expect(parseScopeParam('KSA,UAE')).toEqual(['KSA', 'UAE'])
    expect(parseScopeParam(' KSA , UAE ')).toEqual(['KSA', 'UAE'])
    expect(parseScopeParam('KSA,,UAE')).toEqual(['KSA', 'UAE'])
    expect(parseScopeParam('')).toEqual([])
    expect(parseScopeParam(null)).toEqual([])
  })

  it('resolves a link through the permission list, dropping the rest', () => {
    const r = scopeFromParam('KSA,Egypt', allowed)
    expect(r.countries).toEqual(['KSA'])
    expect(r.dropped).toEqual(['Egypt'])
    expect(r.scope).toEqual({ countries: ['KSA'] })
  })

  it('returns no scope at all when nothing in the link is permitted', () => {
    // null means "keep what you have" - never an implicit widening to All.
    expect(scopeFromParam('Egypt', allowed).scope).toBeNull()
    expect(scopeFromParam('', allowed).scope).toBeNull()
    expect(scopeFromParam('KSA', []).scope).toBeNull()
  })

  it('bounds the All sentinel by the reader, not by the sender', () => {
    expect(scopeFromParam('All', allowed).countries).toEqual(['KSA', 'UAE'])
    expect(scopeFromParam('All', ['UAE']).countries).toEqual(['UAE'])
    expect(scopeFromParam('All', []).scope).toBeNull()
  })

  it('is case-insensitive but writes the canonical spelling', () => {
    expect(scopeFromParam('ksa,uae', allowed).countries).toEqual(['KSA', 'UAE'])
    expect(scopeToParam({ countries: ['uae'] }, allowed)).toBe('UAE')
  })

  it('writes the sentinel as All and anything else by name', () => {
    expect(scopeToParam({ countries: ['All'] }, allowed)).toBe('All')
    expect(scopeToParam({ countries: ['KSA', 'UAE'] }, allowed)).toBe('KSA,UAE')
    expect(scopeToParam({ countries: ['KSA', 'Egypt'] }, allowed)).toBe('KSA')
    expect(scopeToParam({ countries: ['Egypt'] }, allowed)).toBe('')
  })

  it('round trips a scope through the URL unchanged', () => {
    for (const scope of [{ countries: ['All'] }, { countries: ['KSA'] }, { countries: ['KSA', 'UAE'] }]) {
      const written = scopeToParam(scope, allowed)
      expect(scopeFromParam(written, allowed).scope).toEqual(scope)
    }
  })

  it('validates a value against a known set', () => {
    expect(oneOfParam('month', ['year', 'month'], 'year')).toBe('month')
    expect(oneOfParam('MONTH', ['year', 'month'], 'year')).toBe('month')
    expect(oneOfParam('fortnight', ['year', 'month'], 'year')).toBe('year')
    expect(oneOfParam(null, ['year', 'month'], 'year')).toBe('year')
  })

  it('reads a period, refusing an impossible one', () => {
    expect(periodFromParam('2024-03')).toEqual({ year: '2024', month: '03' })
    expect(periodFromParam('2024-3')).toEqual({ year: '2024', month: '03' })
    expect(periodFromParam('2024')).toEqual({ year: '2024', month: '' })
    expect(periodFromParam('2024-13')).toEqual({ year: '2024', month: '' })
    expect(periodFromParam('2024-00')).toEqual({ year: '2024', month: '' })
    expect(periodFromParam('rubbish')).toEqual({ year: '', month: '' })
  })

  it('writes only a period that actually bounds the report', () => {
    expect(periodToParam('2024', '03')).toBe('2024-03')
    expect(periodToParam('2024', '')).toBe('2024')
    // A month with no year bounds nothing, so it is not written.
    expect(periodToParam('', '03')).toBe('')
    expect(periodToParam('24', '03')).toBe('')
  })

  it('reads a whole report URL without needing the profile', () => {
    const r = readReportUrl('?scope=KSA,UAE&grain=month&from=2024-03', {
      grains: ['year', 'quarter', 'month'], defaultGrain: 'year',
    })
    expect(r).toEqual({
      scopeRaw: 'KSA,UAE',
      grain: 'month',
      from: { year: '2024', month: '03' },
      to: { year: '', month: '' },
    })
  })

  it('omits a defaulted control so a shared link stays short', () => {
    const p = reportUrlParams({
      scope: { countries: ['KSA'] }, allowed, grain: 'year', defaultGrain: 'year',
      from: { year: '', month: '' }, to: { year: '', month: '' },
    })
    expect(p).toEqual({ scope: 'KSA', grain: '', from: '', to: '' })
  })

  it('applies updates without disturbing anyone else\'s parameters', () => {
    const next = applyReportUrlParams(
      new URLSearchParams('tab=summary&grain=month'),
      { scope: 'KSA', grain: '', from: '2024-03', to: '' },
    )
    expect(next.get('tab')).toBe('summary')
    expect(next.get('scope')).toBe('KSA')
    expect(next.get('from')).toBe('2024-03')
    expect(next.has('grain')).toBe(false)
    expect(next.has('to')).toBe(false)
  })

  it('is stable: applying the same updates twice changes nothing', () => {
    const updates = { scope: 'KSA,UAE', grain: 'month', from: '', to: '' }
    const once = applyReportUrlParams(new URLSearchParams(''), updates)
    const twice = applyReportUrlParams(once, updates)
    expect(twice.toString()).toBe(once.toString())
  })
})
