/**
 * Expense Report - the two surfaces that were left single-country, reviewed.
 *
 * THE TYRE FORECAST is now shown once per country in scope. It was withheld
 * because it needs a client-side read per country; measured against the live row
 * counts (tyre_records KSA 8,145 / UAE 2,455 / Egypt 591) at ~354 bytes a row,
 * covering all three costs about +1.03 MB and +4 requests over KSA alone, which
 * does not justify hiding a whole section of the report. So it repeats, per
 * country, each in its own currency - the same shape the deep report already
 * uses. Nothing is added across the countries.
 *
 * THE CHART BUILDER stays single-country, but by CONSTRUCTION rather than by
 * hiding. The studio's whole purpose is that a reader recombines what it is
 * given: split bars default to stacked, the trend line fits the total across the
 * drawn series, a series source can offer "Total", "share %" divides by the sum
 * of the rows, and every value is formatted with ONE currency. Any of those on a
 * two-currency catalog is a blend one click away. So it is handed exactly one
 * country - and instead of vanishing on a multi-country scope, it now offers a
 * country picker.
 *
 * What these tests hold:
 *   1. the catalog handed to the studio describes ONE country, in that country's
 *      currency, and switching the picker switches the currency with it
 *   2. sources that cannot be attributed to a country (CPK by vehicle type - the
 *      rows carry no country) are ABSENT on a multi-country scope, and the
 *      reader is told, rather than being shown one country's rate under another
 *      country's label
 *   3. the forecast renders per country, headed with the country and currency
 *   4. the tyre read is issued once per country in scope, never un-scoped
 *   5. no figure anywhere is a sum across currencies
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => {
  const CUR = { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' }
  // Twelve months of fitments per country so the forecast has real history.
  // Quantities differ per country, so a merged forecast would be detectable.
  const tyres = (country, perMonth) => {
    const out = []
    for (let m = 1; m <= 12; m++) {
      for (let i = 0; i < perMonth; i++) {
        out.push({
          id: `${country}-${m}-${i}`,
          asset_no: `A-${i}`,
          brand: 'TRIANGLE',
          size: '315/80R22.5',
          qty: 1,
          cost_per_tyre: { KSA: 900, UAE: 700, Egypt: 14000 }[country],
          total_km: 42000,
          issue_date: `2026-${String(m).padStart(2, '0')}-15`,
          removal_date: null,
          site: 'NHC',
          country,
        })
      }
    }
    return out
  }
  return {
    CUR,
    TYRES: { KSA: tyres('KSA', 4), UAE: tyres('UAE', 2), Egypt: tyres('Egypt', 1) },
    // Distinct per country so a value on screen can only have come from one.
    snapshotFor: (country) => ({
      ok: true,
      kpis: {
        total_expense: { KSA: 1000, UAE: 2000, Egypt: 3000 }[country] ?? 0,
        tyre_expense: 10, spare_expense: 20, oil_expense: 30, lines: 4, tyres_issued: 2,
      },
      by_category: [{ label: 'Tyres', spend: 10 }],
      by_store: [{ label: `${country}-STORE`, spend: 5000 }],
      by_asset: [{ label: `${country}-ASSET`, spend: 4000 }],
      top_items: [{ label: 'TYRE 315/80 R22.5', spend: 4000, n: 12 }],
      monthly: [{ m: '2026-01', tyre: 100, spare: 200, oil: 50, total: 350 }],
    }),
    // CPK by vehicle type carries NO country of its own - that is exactly why it
    // cannot be split per country.
    fleetCpk: {
      perVehicle: [],
      byType: [{ vehicle_type: 'TR-MIXER', unit: 'km', cpk_total: 1.234 }],
      fleet: [{ country: 'KSA', currency: 'SAR', unit: 'km', cpk_total: 1.1, cpk_tyre: 0.5 }],
    },
    scope: {},
    calls: { tyre: [], snapshot: [], yearly: [], cpk: [] },
  }
})

vi.mock('react-router-dom', () => ({ Link: ({ children }) => <a href="#x">{children}</a> }))
vi.mock('../components/ui/PageHeader', () => ({ default: () => null }))
vi.mock('chart.js', () => ({
  Chart: { register: () => {} },
  CategoryScale: {}, LinearScale: {}, BarElement: {}, LineElement: {},
  PointElement: {}, ArcElement: {}, Filler: {}, Title: {}, Tooltip: {}, Legend: {},
}))
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Doughnut: () => null, Line: () => null }))
vi.mock('../contexts/SettingsContext', () => ({
  COUNTRY_CURRENCY: { KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' },
  useSettings: () => ({
    reportingScope: h.scope.reportingScope,
    allowedScopeCountries: h.scope.allowed,
    appSettings: { company_name: 'Green Concrete', currency: 'SAR' },
  }),
}))
// Raw keys back, so every assertion below reads the ENGLISH fallback the tx()
// wrapper supplies - which is what a deploy with a missing locale entry renders.
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, isRTL: false }),
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { role: 'Admin' }, isSuperAdmin: true }),
}))

const multiOf = (countries, make) => ({
  ok: true,
  refused: [],
  blocks: (countries || []).map((c) => ({ country: c, currency: h.CUR[c] || null, result: make(c) })),
})

vi.mock('../lib/api/partsConsumption', () => ({
  getPartsExpenseSnapshotMulti: (args) => {
    h.calls.snapshot.push(args)
    return Promise.resolve(multiOf(args?.countries, h.snapshotFor))
  },
  getExpenseByCountry: () => Promise.resolve([]),
  getCostCpkOverviewMulti: () => Promise.resolve({ ok: false, blocks: [], refused: [] }),
  listExpenseRows: () => Promise.resolve({ rows: [], truncated: false }),
}))
vi.mock('../lib/api/costVariance', () => ({
  getCostVarianceMulti: () => Promise.resolve({ ok: false, blocks: [], refused: [] }),
}))
vi.mock('../lib/api/siteOperatingCost', () => ({
  getSiteOperatingCostMulti: () => Promise.resolve({ ok: false, blocks: [], refused: [] }),
  storeVsOperating: () => [],
}))
vi.mock('../lib/api/storeSiteExpense', () => ({
  getExpenseBySite: () => Promise.resolve([]),
  listSites: () => Promise.resolve([]),
  setStoreSiteMap: () => Promise.resolve(true),
}))
vi.mock('../lib/api/latestActivity', () => ({ defaultPeriodFor: () => Promise.resolve(null) }))
vi.mock('../lib/api/fleetCpk', () => ({
  getFleetCpk: (args) => { h.calls.cpk.push(args); return Promise.resolve(h.fleetCpk) },
}))
vi.mock('../lib/api/expenseTrends', () => ({
  getExpensePeriodTrendMulti: ({ countries } = {}) => {
    h.calls.yearly.push(countries)
    return Promise.resolve({
      ok: true,
      refused: [],
      rows: (countries || []).map((c) => ({
        country: c, period: '2026', currency: h.CUR[c],
        tyre: 1, spare: 1, lubricant: 1, total: 3, lines: 1,
      })),
    })
  },
}))
// The tyre read is country-scoped; the page pages it through fetchAllPages, so
// the page function is invoked once and its rows handed straight back.
vi.mock('../lib/api/tyreRecords', () => ({
  listTcoActualRecords: ({ country } = {}) => {
    h.calls.tyre.push(country)
    return Promise.resolve({ data: h.TYRES[country] || [], error: null })
  },
}))
vi.mock('../lib/fetchAll', () => ({ fetchAllPages: (pageFn) => pageFn(0, 999) }))
vi.mock('../lib/exportUtils', () => ({
  exportToExcel: () => Promise.resolve(),
  reportFileName: (...p) => p.filter(Boolean).join(' '),
  reportDateLabel: () => '16 Aug 2026',
}))

import ExpenseReport, { buildStudioCatalog } from '../pages/ExpenseReport'

beforeEach(() => {
  h.calls = { tyre: [], snapshot: [], yearly: [], cpk: [] }
  h.scope = { reportingScope: { countries: ['All'] }, allowed: ['KSA', 'UAE', 'Egypt'] }
})
afterEach(cleanup)

/** The studio's own caption names the currency it is formatting in. */
const studioCurrencies = () =>
  [...document.body.textContent.matchAll(/Values in ([A-Z]{3})\./g)].map((m) => m[1])

/* ── 1 + 2. The Chart Builder ──────────────────────────────────────────────── */

describe('Chart Builder on a multi-country scope', () => {
  it('renders for ONE country, chosen by the reader, instead of disappearing', async () => {
    render(<ExpenseReport />)
    // It used to be dropped entirely on a multi-country scope.
    const picker = await screen.findByRole('combobox', { name: 'Chart data for' })
    expect(picker).toBeTruthy()
    // The picker offers exactly the countries in scope, each with its currency.
    expect([...picker.options].map((o) => o.value)).toEqual(['KSA', 'UAE', 'Egypt'])
    expect([...picker.options].map((o) => o.textContent)).toEqual(['KSA (SAR)', 'UAE (AED)', 'Egypt (EGP)'])
    // and exactly ONE studio is mounted, in ONE currency.
    expect(studioCurrencies()).toEqual(['SAR'])
  })

  it('switches the whole studio, currency included, when the country changes', async () => {
    render(<ExpenseReport />)
    const picker = await screen.findByRole('combobox', { name: 'Chart data for' })
    expect(studioCurrencies()).toEqual(['SAR'])
    // KSA's asset row is on screen; UAE's is not.
    await waitFor(() => expect(document.body.textContent).toContain('KSA-ASSET'))

    fireEvent.change(picker, { target: { value: 'Egypt' } })

    await waitFor(() => expect(studioCurrencies()).toEqual(['EGP']))
    // Two currencies at once would mean two catalogs are live, which is the
    // blend this design exists to make unreachable.
    expect(studioCurrencies()).toHaveLength(1)
    await waitFor(() => expect(document.body.textContent).toContain('Egypt-ASSET'))
    expect(document.body.textContent).not.toContain('KSA-ASSET')
  })

  it('says why it is one country at a time', async () => {
    render(<ExpenseReport />)
    await screen.findByRole('combobox', { name: 'Chart data for' })
    expect(document.body.textContent).toMatch(/Charts are built one country at a time/i)
    // and the CPK omission is stated rather than silent
    expect(document.body.textContent).toMatch(/those rows do not record which country they came from/i)
  })

  it('does not OFFER the unattributable CPK sources on a multi-country scope', async () => {
    // The substantive half of the note above. `by_type` rows carry no country,
    // so offering them here would let a reader chart one country's rate under
    // another country's currency label.
    render(<ExpenseReport />)
    await screen.findByRole('combobox', { name: 'Chart data for' })
    expect(document.body.textContent).not.toContain('CPK per km by type')

    // Narrowed to one country, the read named that country, so the same source
    // is attributable and IS offered - the omission is a real rule, not a
    // control that never appears.
    cleanup()
    h.scope = { reportingScope: { countries: ['KSA'] }, allowed: ['KSA', 'UAE', 'Egypt'] }
    render(<ExpenseReport />)
    await waitFor(() => expect(document.body.textContent).toContain('CPK per km by type'))
  })

  it('drops the picker and the notes on a single-country scope', async () => {
    h.scope = { reportingScope: { countries: ['KSA'] }, allowed: ['KSA', 'UAE', 'Egypt'] }
    render(<ExpenseReport />)
    await waitFor(() => expect(studioCurrencies()).toEqual(['SAR']))
    expect(screen.queryByRole('combobox', { name: 'Chart data for' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/Charts are built one country at a time/i)
    expect(document.body.textContent).not.toMatch(/those rows do not record which country/i)
  })
})

/* ── 3 + 4. The Tyre Forecast ──────────────────────────────────────────────── */

describe('Tyre Forecast across a reporting scope', () => {
  it('renders once per country, each headed with its country and currency', async () => {
    render(<ExpenseReport />)
    await waitFor(() =>
      expect(screen.getAllByText('Tyre demand forecast by size')).toHaveLength(3))
    // Without these headings the three cards are money with no country attached.
    expect(screen.getByRole('heading', { name: 'KSA (SAR)' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'UAE (AED)' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Egypt (EGP)' })).toBeTruthy()
  })

  it('prices each forecast in its OWN currency, never the page default', async () => {
    render(<ExpenseReport />)
    await waitFor(() =>
      expect(screen.getAllByText('Tyre demand forecast by size')).toHaveLength(3))
    // Average cost per tyre, per country: 900 / 700 / 14,000 in SAR / AED / EGP.
    // A single shared formatter would print all three as SAR.
    expect(document.body.textContent).toContain('SAR 900')
    expect(document.body.textContent).toContain('AED 700')
    expect(document.body.textContent).toContain('EGP 14,000')
  })

  it('reads tyres once per country in scope, never un-scoped', async () => {
    render(<ExpenseReport />)
    await waitFor(() => expect(h.calls.tyre).toHaveLength(3))
    expect(h.calls.tyre).toEqual(['KSA', 'UAE', 'Egypt'])
    // An undefined country would read every country RLS allows and then be
    // aggregated into one currency-blind pile.
    h.calls.tyre.forEach((c) => expect(c).toBeTruthy())
  })

  it('keeps the single-country scope reading exactly one country', async () => {
    h.scope = { reportingScope: { countries: ['UAE'] }, allowed: ['KSA', 'UAE', 'Egypt'] }
    render(<ExpenseReport />)
    await waitFor(() => expect(screen.getAllByText('Tyre demand forecast by size')).toHaveLength(1))
    expect(h.calls.tyre).toEqual(['UAE'])
    // One country needs no country heading - the page already says which one.
    expect(screen.queryByRole('heading', { name: 'UAE (AED)' })).toBeNull()
  })
})

/* ── 5. Nothing is summed across currencies ────────────────────────────────── */

describe('the scope never produces a cross-currency figure', () => {
  it('shows each country total under its own currency and never the blend', async () => {
    render(<ExpenseReport />)
    await waitFor(() => expect(h.calls.snapshot.length).toBe(1))
    // 1000 SAR + 2000 AED + 3000 EGP = 6000 of nothing.
    await waitFor(() => expect(document.body.textContent).toContain('SAR 1,000'))
    expect(document.body.textContent).not.toMatch(/(SAR|AED|EGP)\s*6,000(?![\d,])/)
  })
})

/* ── The pure catalog builder ──────────────────────────────────────────────── */

describe('buildStudioCatalog - one country, one currency', () => {
  const snap = h.snapshotFor('UAE')

  it('formats every rate source in the currency it is given', () => {
    const cat = buildStudioCatalog({
      snap,
      currency: 'AED',
      fleetCpk: h.fleetCpk,
      tyreAgg: { bySite: [], bySize: [], byBrand: [], avgCostByBrand: [], avgKmByBrand: [], cpkSite: [{ label: 'NHC', value: 0.5 }], monthLabels: [], monthQty: [], removalBySite: [], remMonthLabels: [], remMonthQty: [] },
    })
    const km = cat.find((s) => s.key === 'cpk_km')
    expect(km.unitLabel).toBe('AED/km')
    expect(km.format(1.234)).toBe('AED 1.234/km')
    expect(cat.find((s) => s.key === 'tyre_cpk_site').unitLabel).toBe('AED/km')
  })

  it('omits the CPK sources entirely when the caller cannot attribute them', () => {
    // The caller passes null rather than guessing which country the by_type rows
    // belong to. Absent is honest; present under the wrong currency is not.
    const cat = buildStudioCatalog({ snap, currency: 'AED', fleetCpk: null })
    expect(cat.map((s) => s.key)).not.toContain('cpk_km')
    expect(cat.map((s) => s.key)).not.toContain('cpk_hr')
    expect(cat.map((s) => s.key)).not.toContain('cpk_overall')
    // The country's own money sources are unaffected.
    expect(cat.map((s) => s.key)).toContain('by_asset')
  })

  it('charts only the yearly rows it is handed', () => {
    const cat = buildStudioCatalog({
      snap,
      currency: 'AED',
      yearly: [{ country: 'UAE', period: '2026', tyre: 5, spare: 6, lubricant: 7 }],
    })
    const yr = cat.find((s) => s.key === 'yearly')
    expect(yr.labels).toEqual(['2026'])
    expect(yr.series.map((s) => s.data)).toEqual([[5], [6], [7]])
  })

  it('returns nothing at all when the country reported no snapshot', () => {
    expect(buildStudioCatalog({ snap: null, currency: 'AED' })).toEqual([])
    expect(buildStudioCatalog({ snap: { ok: false }, currency: 'AED' })).toEqual([])
  })
})
