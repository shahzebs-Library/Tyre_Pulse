import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CURRENCY_BY_COUNTRY,
  BASE_CURRENCY,
  MIXED_CURRENCY,
  CurrencyMismatchError,
  currencyForCountry,
  isSingleCountry,
  money,
  isMoney,
  addMoney,
  sumMoney,
  COST_BUCKETS,
  BUCKET_COLUMN,
  AMOUNT_BASIS,
  COST_MODES,
  bucketsForMode,
  costModeLabel,
  EXCLUSIONS,
  exclusion,
  workOrderMaintenanceAmount,
  costOf,
  bucketsOf,
  byCountry,
  countryCostSetFrom,
  perUnitCost,
  isComparable,
  MIN_COVERAGE,
  formatMoney,
  formatPerUnit,
  formatCountrySet,
} from '../lib/governedCost'

/**
 * Fixtures mirror the live shape of parts_consumption. The amounts are the REAL
 * per-country totals verified against the database, scaled down, so a test
 * failure here maps onto a figure someone actually sees on screen.
 */
const KSA = { country: 'KSA', tyre_cost: 100, spare_cost: 200, oil_cost: 50 }
const UAE = { country: 'UAE', tyre_cost: 60, spare_cost: 100, oil_cost: 20 }
const EGY = { country: 'Egypt', tyre_cost: 160, spare_cost: 430, oil_cost: 190 }

describe('currency mapping', () => {
  it('maps the three live countries to their own currency', () => {
    expect(CURRENCY_BY_COUNTRY).toEqual({ KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' })
    expect(BASE_CURRENCY).toBe('SAR')
  })

  it('resolves case and whitespace insensitively', () => {
    expect(currencyForCountry('ksa')).toBe('SAR')
    expect(currencyForCountry('  Egypt ')).toBe('EGP')
    expect(currencyForCountry('uae')).toBe('AED')
  })

  it('returns null for All / blank / unknown so they can never be denominated', () => {
    expect(currencyForCountry('All')).toBeNull()
    expect(currencyForCountry('')).toBeNull()
    expect(currencyForCountry(null)).toBeNull()
    expect(currencyForCountry('Oman')).toBeNull()
    expect(isSingleCountry('All')).toBe(false)
    expect(isSingleCountry('KSA')).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * THE GUARD: adding two currencies must fail                          *
 * ------------------------------------------------------------------ */

describe('currency blending is impossible by construction', () => {
  it('addMoney THROWS when two currencies are combined', () => {
    expect(() => addMoney(money(100, 'SAR'), money(100, 'AED')))
      .toThrow(CurrencyMismatchError)
  })

  it('the mismatch error names both currencies and points at the fix', () => {
    let err
    try { addMoney(money(1, 'SAR'), money(1, 'EGP')) } catch (e) { err = e }
    expect(err).toBeInstanceOf(CurrencyMismatchError)
    expect(err.currencies).toEqual(['SAR', 'EGP'])
    expect(err.message).toMatch(/per country/i)
  })

  it('sumMoney THROWS on a mixed list rather than returning a plausible number', () => {
    expect(() => sumMoney([money(11297676, 'SAR'), money(6148660, 'AED'), money(16718706, 'EGP')]))
      .toThrow(CurrencyMismatchError)
  })

  it('costOf THROWS when rows span countries and no single country is given', () => {
    // This is the exact SAR+AED+EGP defect: 40.6M + 18.5M + 79.3M is not 138.4M
    // of anything. The old code returned that number; this refuses.
    expect(() => costOf([KSA, UAE, EGY])).toThrow(CurrencyMismatchError)
  })

  it('costOf succeeds once a single country pins the currency', () => {
    const total = costOf([KSA, UAE, EGY], { country: 'KSA' })
    expect(total).toEqual({ amount: 350, currency: 'SAR' })
  })

  it('CountryCostSet exposes NO scalar total to render', () => {
    const set = byCountry([KSA, UAE, EGY])
    expect(set.amount).toBeUndefined()
    expect(set.total).toBeUndefined()
    expect(typeof set.rows).toBe('function')
    expect(set.countries.sort()).toEqual(['Egypt', 'KSA', 'UAE'])
  })

  it('CountryCostSet.single() THROWS on a mixed set but works for one country', () => {
    expect(() => byCountry([KSA, UAE]).single()).toThrow(CurrencyMismatchError)
    expect(byCountry([KSA]).single()).toEqual({ amount: 350, currency: 'SAR' })
    expect(byCountry([KSA, UAE]).isSingleCurrency).toBe(false)
    expect(byCountry([KSA]).isSingleCurrency).toBe(true)
  })

  it('money() refuses an amount with no currency', () => {
    expect(() => money(100)).toThrow(/requires a currency/i)
  })
})

/* ------------------------------------------------------------------ *
 * One test per double-count exclusion                                 *
 * ------------------------------------------------------------------ */

describe('exclusion: wo_tyre_cost - a work order tyre cost must not inflate maintenance', () => {
  it('workOrderMaintenanceAmount omits tyre_cost', () => {
    const wo = {
      labour_cost: 100, parts_cost: 200, lubricant_cost: 30, outside_repair_cost: 70,
      tyre_cost: 5000, // already counted in the grid tyre bucket
    }
    expect(workOrderMaintenanceAmount(wo)).toBe(400)
  })

  it('a work order carrying tyre cost does NOT change the maintenance figure', () => {
    const base = { labour_cost: 100, parts_cost: 200, lubricant_cost: 30, outside_repair_cost: 70 }
    const withTyre = { ...base, tyre_cost: 9999 }
    expect(workOrderMaintenanceAmount(withTyre)).toBe(workOrderMaintenanceAmount(base))
  })

  it('the exclusion is documented with its reason', () => {
    expect(exclusion('wo_tyre_cost').because).toMatch(/twice/i)
  })
})

describe('exclusion: total_is_buckets - line_cost is the buckets, not a fourth addend', () => {
  it('the combined total equals tyre + spare + oil and ignores line_cost', () => {
    // Live data has sum(line_cost) === sum(tyre+spare+oil) to 0.00 variance, so
    // a row carrying both must not be counted twice.
    const row = { country: 'KSA', tyre_cost: 100, spare_cost: 200, oil_cost: 50, line_cost: 350 }
    expect(costOf([row], { country: 'KSA' })).toEqual({ amount: 350, currency: 'SAR' })
  })

  it('bucketsOf reports total as the sum of the three buckets', () => {
    const b = bucketsOf([KSA], { country: 'KSA' })
    expect(b.tyre.amount).toBe(100)
    expect(b.spare.amount).toBe(200)
    expect(b.oil.amount).toBe(50)
    expect(b.maintenance.amount).toBe(250) // spare + oil
    expect(b.total.amount).toBe(350) // tyre + maintenance, NOT + line_cost
    expect(b.total.amount).toBe(b.tyre.amount + b.spare.amount + b.oil.amount)
  })

  it('is documented with its reason', () => {
    expect(exclusion('total_is_buckets').because).toMatch(/0\.00 variance/i)
  })
})

describe('exclusion: tyre_total_from_grid - never sum tyre_records.cost_per_tyre', () => {
  it('the tyre bucket reads the grid column, not a per-tyre price', () => {
    expect(BUCKET_COLUMN.tyre).toBe('tyre_cost')
    expect(Object.values(BUCKET_COLUMN)).not.toContain('cost_per_tyre')
  })

  it('a row carrying cost_per_tyre contributes nothing to the governed tyre total', () => {
    const row = { country: 'KSA', tyre_cost: 100, spare_cost: 0, oil_cost: 0, cost_per_tyre: 8000, qty: 4 }
    expect(costOf([row], { mode: 'tyres', country: 'KSA' })).toEqual({ amount: 100, currency: 'SAR' })
  })

  it('is documented with the live 4.23M vs 11.30M gap', () => {
    expect(exclusion('tyre_total_from_grid').because).toMatch(/4\.23M/)
    expect(exclusion('tyre_total_from_grid').because).toMatch(/11\.30M/)
  })
})

describe('exclusion: grid_supersedes_legacy', () => {
  it('is documented as fallback-never-supplement', () => {
    expect(exclusion('grid_supersedes_legacy').rule).toMatch(/ALONE/)
    expect(exclusion('grid_supersedes_legacy').because).toMatch(/never a supplement/i)
  })
})

describe('exclusions registry', () => {
  it('carries all four rules, each with a rule and a reason', () => {
    expect(EXCLUSIONS).toHaveLength(4)
    for (const e of EXCLUSIONS) {
      expect(e.id).toBeTruthy()
      expect(e.rule).toBeTruthy()
      expect(e.because).toBeTruthy()
    }
  })

  it('is frozen so an exclusion cannot be quietly removed at runtime', () => {
    expect(Object.isFrozen(EXCLUSIONS)).toBe(true)
    expect(() => exclusion('nope')).toThrow(/Unknown exclusion/)
  })
})

/* ------------------------------------------------------------------ *
 * Taxonomy and modes                                                  *
 * ------------------------------------------------------------------ */

describe('cost taxonomy', () => {
  it('has three exhaustive, mutually exclusive buckets', () => {
    expect(COST_BUCKETS).toEqual(['tyre', 'spare', 'oil'])
  })

  it('documents the line amount basis in precedence order (Values first)', () => {
    expect(AMOUNT_BASIS[0]).toBe('value_amount')
  })

  it('maps modes onto buckets: maintenance is spare + oil, never tyre', () => {
    expect(bucketsForMode('tyres')).toEqual(['tyre'])
    expect(bucketsForMode('maintenance')).toEqual(['spare', 'oil'])
    expect(bucketsForMode('maintenance')).not.toContain('tyre')
    expect(bucketsForMode('combined')).toEqual(['tyre', 'spare', 'oil'])
    expect(bucketsForMode('nonsense')).toEqual(['tyre', 'spare', 'oil'])
  })

  it('keeps the legacy COST_MODES keys so the existing switch still works', () => {
    expect(COST_MODES.map((m) => m.key)).toEqual(['combined', 'tyres', 'maintenance'])
    expect(costModeLabel('tyres')).toBe('Tyres')
    expect(costModeLabel(undefined)).toBe('Combined')
  })

  it('costOf honours the mode', () => {
    expect(costOf([KSA], { mode: 'tyres', country: 'KSA' }).amount).toBe(100)
    expect(costOf([KSA], { mode: 'maintenance', country: 'KSA' }).amount).toBe(250)
    expect(costOf([KSA], { mode: 'combined', country: 'KSA' }).amount).toBe(350)
  })

  it('coerces non-finite amounts to 0 rather than NaN', () => {
    const junk = { country: 'KSA', tyre_cost: 'abc', spare_cost: null, oil_cost: undefined }
    expect(costOf([junk], { country: 'KSA' })).toEqual({ amount: 0, currency: 'SAR' })
  })

  it('an empty scope with a country returns a denominated zero, not a throw', () => {
    expect(costOf([], { country: 'UAE' })).toEqual({ amount: 0, currency: 'AED' })
  })

  it('an empty scope with NO country throws rather than guessing a currency', () => {
    expect(() => costOf([])).toThrow(/single country/i)
  })
})

/* ------------------------------------------------------------------ *
 * byCountry                                                           *
 * ------------------------------------------------------------------ */

describe('byCountry', () => {
  it('splits a mixed scope into one governed total per currency', () => {
    const set = byCountry([KSA, UAE, EGY])
    expect(set.get('KSA')).toEqual({ amount: 350, currency: 'SAR' })
    expect(set.get('UAE')).toEqual({ amount: 180, currency: 'AED' })
    expect(set.get('Egypt')).toEqual({ amount: 780, currency: 'EGP' })
  })

  it('get() is case insensitive and returns null for an out-of-scope country', () => {
    const set = byCountry([KSA])
    expect(set.get('ksa').amount).toBe(350)
    expect(set.get('UAE')).toBeNull()
  })

  it('rows() gives one renderable row per currency', () => {
    const rows = byCountry([KSA, UAE]).rows()
    expect(rows).toEqual([
      { country: 'KSA', currency: 'SAR', amount: 350 },
      { country: 'UAE', currency: 'AED', amount: 180 },
    ])
  })

  it('drops rows whose country cannot be denominated instead of guessing', () => {
    const set = byCountry([KSA, { country: 'Oman', tyre_cost: 999, spare_cost: 0, oil_cost: 0 }])
    expect(set.countries).toEqual(['KSA'])
  })

  it('honours the mode per country', () => {
    const set = byCountry([KSA, UAE], { mode: 'tyres' })
    expect(set.get('KSA').amount).toBe(100)
    expect(set.get('UAE').amount).toBe(60)
  })

  it('countryCostSetFrom builds a set from server per-country rows', () => {
    const set = countryCostSetFrom([
      { country: 'KSA', total: 40608350 },
      { country: 'UAE', total: 18493541 },
      { country: 'Egypt', total: 79341428 },
    ])
    expect(set.get('KSA')).toEqual({ amount: 40608350, currency: 'SAR' })
    expect(set.get('Egypt')).toEqual({ amount: 79341428, currency: 'EGP' })
    expect(() => set.single()).toThrow(CurrencyMismatchError)
  })
})

/* ------------------------------------------------------------------ *
 * Per-unit cost: null denominator, never zero                         *
 * ------------------------------------------------------------------ */

describe('perUnitCost', () => {
  it('divides when the denominator is real', () => {
    const pu = perUnitCost(money(1000, 'SAR'), 500, 'km')
    expect(pu.value).toBe(2)
    expect(pu.currency).toBe('SAR')
    expect(pu.unit).toBe('km')
    expect(pu.denominator).toBe(500)
  })

  it('returns NULL, not 0, when the denominator is missing', () => {
    // odometer_logs and engine_hours_logs are empty on live data, so this is the
    // normal case. Zero would read on screen as "this fleet is free to run".
    for (const d of [0, null, undefined, NaN, '', -5]) {
      const pu = perUnitCost(money(1000, 'SAR'), d)
      expect(pu.value).toBeNull()
      expect(pu.denominator).toBeNull()
    }
  })

  it('keeps the currency even when the value is unknown', () => {
    expect(perUnitCost(money(1000, 'EGP'), 0).currency).toBe('EGP')
  })

  it('requires a Money total so a bare number cannot lose its currency', () => {
    expect(() => perUnitCost(1000, 500)).toThrow(/Money/)
  })

  it('coverage below the floor is not comparable', () => {
    expect(MIN_COVERAGE).toBe(0.25)
    expect(isComparable(0.9)).toBe(true)
    expect(isComparable(0.25)).toBe(true)
    expect(isComparable(0.05)).toBe(false)
    expect(isComparable(null)).toBe(false)
    expect(isComparable(undefined)).toBe(false)
  })
})

/* ------------------------------------------------------------------ *
 * Formatting                                                          *
 * ------------------------------------------------------------------ */

describe('formatting', () => {
  it('always emits the currency, so AED can never render as SAR', () => {
    expect(formatMoney(money(18493541, 'AED'))).toBe('AED 18,493,541')
    expect(formatMoney(money(79341428, 'EGP'))).toBe('EGP 79,341,428')
    expect(formatMoney(money(40608350, 'SAR'))).toBe('SAR 40,608,350')
  })

  it('renders a missing value as N/A, never a dash and never 0', () => {
    expect(formatMoney(null)).toBe('N/A')
    expect(formatMoney(undefined)).toBe('N/A')
    expect(formatMoney(1000)).toBe('N/A') // a bare number is not governed Money
    expect(formatPerUnit(null)).toBe('N/A')
    expect(formatPerUnit({ value: null, currency: 'SAR', unit: 'km' })).toBe('N/A')
  })

  it('formats a known per-unit cost with its unit', () => {
    expect(formatPerUnit({ value: 2.5, currency: 'SAR', unit: 'km' })).toBe('SAR 2.5 / km')
  })

  it('formatCountrySet renders one labelled row per currency', () => {
    const out = formatCountrySet(byCountry([KSA, UAE, EGY]))
    expect(out.map((r) => r.display)).toEqual(['SAR 350', 'AED 180', 'EGP 780'])
  })

  it('formatCountrySet on a non-set returns [] rather than throwing', () => {
    expect(formatCountrySet(null)).toEqual([])
    expect(formatCountrySet({ kind: 'other' })).toEqual([])
  })

  it('MIXED is not a currency code, so a blend renders visibly wrong', () => {
    expect(MIXED_CURRENCY).toBe('MIXED')
    expect(Object.values(CURRENCY_BY_COUNTRY)).not.toContain(MIXED_CURRENCY)
  })
})

/* ------------------------------------------------------------------ *
 * Money value semantics                                               *
 * ------------------------------------------------------------------ */

describe('Money', () => {
  it('is frozen so a total cannot be mutated after it is governed', () => {
    const m = money(100, 'SAR')
    expect(Object.isFrozen(m)).toBe(true)
    expect(isMoney(m)).toBe(true)
  })

  it('rejects non-Money inputs to addMoney', () => {
    expect(() => addMoney(money(1, 'SAR'), 1)).toThrow(/two Money/)
    expect(isMoney({ amount: 1 })).toBe(false)
    expect(isMoney(null)).toBe(false)
  })

  it('sums a same-currency list', () => {
    expect(sumMoney([money(1, 'SAR'), money(2, 'SAR')])).toEqual({ amount: 3, currency: 'SAR' })
  })

  it('an empty sum needs an explicit currency', () => {
    expect(sumMoney([], 'AED')).toEqual({ amount: 0, currency: 'AED' })
    expect(() => sumMoney([])).toThrow(/explicit currency/i)
  })
})

/* ================================================================== *
 * The governed READER (src/lib/api/governedCost.js)                   *
 * ================================================================== */

const h = vi.hoisted(() => {
  const state = { rpc: {}, calls: [] }
  return {
    state,
    supabase: {
      rpc: (name, args) => {
        state.calls.push({ name, args })
        const res = state.rpc[name] || { data: null, error: null }
        // A set-returning RPC is capped at 1,000 rows per response like any
        // table read, so `get_tyre_cost_by_asset` is PAGED. The mock serves
        // `.range()` windows AND stays thenable, so both call shapes work.
        const p = Promise.resolve(res)
        p.range = (from, to) => Promise.resolve(
          res.error || !Array.isArray(res.data)
            ? res
            : { data: res.data.slice(from, to + 1), error: null },
        )
        return p
      },
      from: () => ({ select: () => ({ then: (r) => Promise.resolve({ data: [], error: null }).then(r) }) }),
    },
  }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const {
  loadCostByCountry,
  loadGovernedCost,
  loadGovernedCostSplit,
  loadGovernedTyreByAsset,
  calendarMonthWindow,
} = await import('../lib/api/governedCost')

/** Live per-country totals, so a regression maps onto a real screen figure. */
const LIVE_BY_COUNTRY = [
  { country: 'KSA', tyre: 11297676, spare: 23987502, oil: 5323172, total: 40608350, lines: 106646 },
  { country: 'UAE', tyre: 6148661, spare: 10424299, oil: 1920582, total: 18493541, lines: 67615 },
  { country: 'Egypt', tyre: 16718706, spare: 43099318, oil: 19523404, total: 79341428, lines: 42531 },
]

const overviewFor = (t) => ({
  ok: true,
  currency: null,
  windows: { current: { from: '2025-08-01', to: '2026-07-31' } },
  totals: { current: t, previous: t, last_year: t },
  cpk: { current: { km: 0, spend_matched: 0, coverage_pct: null, assets_measured: 0 } },
  monthly: [],
  by_site: [], by_cost_center: [], by_asset_type: [], by_asset: [], by_item: [], by_evidence: [],
})

beforeEach(() => { h.state.rpc = {}; h.state.calls = [] })

describe('loadCostByCountry - the only safe cross-country read', () => {
  it('returns one governed Money per currency, never a sum', async () => {
    h.state.rpc.get_expense_by_country = { data: LIVE_BY_COUNTRY, error: null }
    const { ok, set } = await loadCostByCountry({})
    expect(ok).toBe(true)
    expect(set.get('KSA')).toEqual({ amount: 40608350, currency: 'SAR' })
    expect(set.get('UAE')).toEqual({ amount: 18493541, currency: 'AED' })
    expect(set.get('Egypt')).toEqual({ amount: 79341428, currency: 'EGP' })
    // The blend a caller must never be able to produce: 138,443,319.
    expect(() => set.single()).toThrow(CurrencyMismatchError)
  })

  it('honours the mode per country', async () => {
    h.state.rpc.get_expense_by_country = { data: LIVE_BY_COUNTRY, error: null }
    const tyres = await loadCostByCountry({ mode: 'tyres' })
    expect(tyres.set.get('KSA').amount).toBe(11297676)
    const maint = await loadCostByCountry({ mode: 'maintenance' })
    expect(maint.set.get('KSA').amount).toBe(23987502 + 5323172)
  })

  it('degrades to an empty set rather than throwing when the RPC fails', async () => {
    h.state.rpc.get_expense_by_country = { data: null, error: { message: 'boom' } }
    const { ok, set } = await loadCostByCountry({})
    expect(ok).toBe(false)
    expect(set.countries).toEqual([])
  })
})

describe('calendarMonthWindow - migration must not move a figure', () => {
  it('pins the last 12 CALENDAR months, not a rolling 365 days', () => {
    // Rolling 365 from 2026-07-27 would be 2025-07-29..2026-07-27, which on
    // live data gives KSA tyre 2,893,898 instead of 2,856,963.
    expect(calendarMonthWindow(new Date('2026-07-27T00:00:00Z')))
      .toEqual({ from: '2025-08-01', to: '2026-07-31' })
  })

  it('handles a year boundary and a short month', () => {
    expect(calendarMonthWindow(new Date('2026-01-15T00:00:00Z')))
      .toEqual({ from: '2025-02-01', to: '2026-01-31' })
    expect(calendarMonthWindow(new Date('2028-02-10T00:00:00Z')))
      .toEqual({ from: '2027-03-01', to: '2028-02-29' }) // leap year
  })

  it('loadGovernedCostSplit sends that pinned window to the RPC', async () => {
    h.state.rpc.get_cost_cpk_overview = { data: overviewFor({ tyre: 1, spare: 1, oil: 1, total: 3 }), error: null }
    h.state.rpc.get_expense_by_country = { data: [], error: null }
    await loadGovernedCostSplit({ country: 'KSA', now: new Date('2026-07-27T00:00:00Z') })
    const call = h.state.calls.find((c) => c.name === 'get_cost_cpk_overview')
    expect(call.args.p_from).toBe('2025-08-01')
    expect(call.args.p_to).toBe('2026-07-31')
  })

  it('an explicit caller window is passed through untouched', async () => {
    h.state.rpc.get_cost_cpk_overview = { data: overviewFor({ tyre: 1, spare: 0, oil: 0, total: 1 }), error: null }
    h.state.rpc.get_expense_by_country = { data: [], error: null }
    await loadGovernedCostSplit({ country: 'KSA', from: '2024-01-01', to: '2024-03-31' })
    const call = h.state.calls.find((c) => c.name === 'get_cost_cpk_overview')
    expect(call.args.p_from).toBe('2024-01-01')
    expect(call.args.p_to).toBe('2024-03-31')
  })
})

describe('loadGovernedCostSplit - legacy-compatible shape plus currency', () => {
  it('keeps the { tyre, maintenance, byMonth } contract so call sites do not change', async () => {
    h.state.rpc.get_cost_cpk_overview = {
      data: {
        ...overviewFor({ tyre: 2856963, spare: 2800000, oil: 309090, total: 5966053 }),
        monthly: [
          { m: '2025-07', tyre: 999, spare: 0, oil: 0, total: 999 }, // outside the window
          { m: '2025-08', tyre: 100, spare: 20, oil: 5, total: 125 },
          { m: '2026-07', tyre: 200, spare: 30, oil: 10, total: 240 },
        ],
      },
      error: null,
    }
    h.state.rpc.get_expense_by_country = { data: [LIVE_BY_COUNTRY[0]], error: null }

    const s = await loadGovernedCostSplit({ country: 'KSA', now: new Date('2026-07-27T00:00:00Z') })
    expect(s.tyre).toBe(2856963)
    expect(s.maintenance).toBe(2800000 + 309090)
    expect(s.totals).toEqual({ tyre: s.tyre, maintenance: s.maintenance })
    expect(s.currency).toBe('SAR')
    expect(s.blended).toBe(false)
    expect(s.source).toBe('governed:parts_consumption')
  })

  it('trims the 36-month trend series down to the requested window', async () => {
    h.state.rpc.get_cost_cpk_overview = {
      data: {
        ...overviewFor({ tyre: 300, spare: 50, oil: 15, total: 365 }),
        monthly: [
          { m: '2024-01', tyre: 999, spare: 0, oil: 0, total: 999 },
          { m: '2025-08', tyre: 100, spare: 20, oil: 5, total: 125 },
          { m: '2026-07', tyre: 200, spare: 30, oil: 10, total: 240 },
        ],
      },
      error: null,
    }
    h.state.rpc.get_expense_by_country = { data: [], error: null }
    const s = await loadGovernedCostSplit({ country: 'KSA', now: new Date('2026-07-27T00:00:00Z') })
    expect(s.byMonth.map((m) => m.month)).toEqual(['2025-08', '2026-07'])
    expect(s.byMonth[0]).toEqual({ month: '2025-08', tyre: 100, maintenance: 25 })
  })

  it('flags a multi-country scope as blended and carries the per-country rows', async () => {
    h.state.rpc.get_cost_cpk_overview = {
      data: overviewFor({ tyre: 34165043, spare: 77511119, oil: 26767157, total: 138443319 }),
      error: null,
    }
    h.state.rpc.get_expense_by_country = { data: LIVE_BY_COUNTRY, error: null }
    const s = await loadGovernedCostSplit({ country: 'All' })
    expect(s.blended).toBe(true)
    expect(s.currency).toBe(MIXED_CURRENCY)
    // The per-country rows are what a screen must render instead of the blend.
    expect(s.byCountry.map((r) => `${r.currency} ${r.tyre}`))
      .toEqual(['SAR 11297676', 'AED 6148661', 'EGP 16718706'])
  })
})

describe('loadGovernedCost', () => {
  it('returns null - not 0 - for cost per km when the fleet is unmeasured', async () => {
    // odometer_logs and engine_hours_logs are empty on live data.
    h.state.rpc.get_cost_cpk_overview = {
      data: {
        ...overviewFor({ tyre: 100, spare: 0, oil: 0, total: 100 }),
        cpk: { current: { km: 0, spend_matched: 0, coverage_pct: null, assets_measured: 0 } },
      },
      error: null,
    }
    h.state.rpc.get_expense_by_country = { data: [], error: null }
    const g = await loadGovernedCost({ country: 'KSA' })
    expect(g.perUnit.value).toBeNull()
    expect(g.perUnit.km).toBeNull()
    expect(g.perUnit.comparable).toBe(false)
    expect(g.perUnit.currency).toBe('SAR')
  })

  it('marks a low-coverage cost per km as not comparable', async () => {
    h.state.rpc.get_cost_cpk_overview = {
      data: {
        ...overviewFor({ tyre: 100, spare: 0, oil: 0, total: 100 }),
        cpk: { current: { km: 1000, spend_matched: 50, coverage_pct: 0.05, assets_measured: 2 } },
      },
      error: null,
    }
    h.state.rpc.get_expense_by_country = { data: [], error: null }
    const g = await loadGovernedCost({ country: 'KSA' })
    expect(g.perUnit.value).toBe(0.05)
    expect(g.perUnit.comparable).toBe(false)
  })

  it('surfaces an unauthorized RPC honestly instead of reporting zero spend', async () => {
    h.state.rpc.get_cost_cpk_overview = { data: { ok: false, reason: 'unauthorized' }, error: null }
    h.state.rpc.get_expense_by_country = { data: [], error: null }
    const g = await loadGovernedCost({ country: 'KSA' })
    expect(g.ok).toBe(false)
    expect(g.reason).toBe('unauthorized')
    expect(g.totals).toBeNull()
  })
})

describe('loadGovernedTyreByAsset', () => {
  it('refuses a mixed scope: a per-asset figure would be a blend', async () => {
    const r = await loadGovernedTyreByAsset({ country: 'All' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('country_required')
    expect(r.map.size).toBe(0)
  })

  it('returns per-asset Money keyed on the canonical UPPER asset code', async () => {
    h.state.rpc.get_tyre_cost_by_asset = {
      data: [{ asset_code: ' tm514 ', tyre_cost: 1200 }, { asset_code: 'BH021', tyre_cost: 800 }],
      error: null,
    }
    const r = await loadGovernedTyreByAsset({ country: 'KSA' })
    expect(r.ok).toBe(true)
    expect(r.map.get('TM514')).toEqual({ amount: 1200, currency: 'SAR' })
    expect(r.total).toEqual({ amount: 2000, currency: 'SAR' })
  })
})

describe('bucketsOf scoping regression', () => {
  it('scopes spare and oil by country exactly as tyre is scoped', () => {
    // Regression: an earlier draft filtered tyre/maintenance by country but
    // summed spare/oil over every row, silently blending currencies inside the
    // module built to prevent that.
    const b = bucketsOf([KSA, UAE, EGY], { country: 'KSA' })
    expect(b.currency).toBe('SAR')
    expect(b.tyre.amount).toBe(100)
    expect(b.spare.amount).toBe(200)   // KSA only, not 200+100+430
    expect(b.oil.amount).toBe(50)      // KSA only, not 50+20+190
    expect(b.total.amount).toBe(350)
    expect(b.total.amount).toBe(b.tyre.amount + b.spare.amount + b.oil.amount)
  })
})
