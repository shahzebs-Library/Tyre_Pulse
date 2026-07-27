import { describe, it, expect } from 'vitest'
import {
  effectSplit, contributions, concentration, itemMovers, assortmentChurn,
  decomposeVariance, narrate, buildVarianceExport, fmtMoney, fmtPct,
} from '../lib/costVariance'

/**
 * Every fixture below is a real get_cost_variance payload, verified against the
 * live database on 2026-07-27. KSA first half of 2026 against the 181 days
 * before it. The figures are the ones the customer can check by hand:
 * DIRIYAH-ST 333,783 to 600,147, NHC-ST 1,359,571 to 1,014,040, MISK-ST 65,790
 * to nothing, DHABAN-ST 13,755 to 196,905.
 */
const KSA = {
  ok: true,
  blended: false,
  currency: 'SAR',
  country: 'KSA',
  site: null,
  windows: {
    current: { from: '2026-01-01', to: '2026-06-30' },
    previous: { from: '2025-07-04', to: '2025-12-31' },
    days: 181,
  },
  totals: {
    current: 2751033.46,
    previous: 3340850.30,
    delta: -589816.84,
    lines_current: 14449,
    lines_previous: 14908,
  },
  effects: {
    price: -129553.89,
    volume: -386556.18,
    new_items: 649833.99,
    stopped_items: -723540.76,
    not_decomposable: 0,
    items_both: 717,
    items_new: 602,
    items_stopped: 792,
    spend_priced_current: 2751033.46,
    spend_priced_previous: 3340850.30,
  },
  items: [
    {
      code: '310522-O', label: 'TIRE 315/80R22.5 TEGRYS/ERICLE', bucket: 'tyre', kind: 'both',
      qty_previous: 1383, qty_current: 992, price_previous: 900, price_current: 898.4274,
      spend_previous: 1244700, spend_current: 891240,
      price_effect: -1867.44, volume_effect: -351592.56, delta: -353460,
      lines_current: 948, lines_previous: 1273,
    },
    {
      code: '223758-O', label: 'TIRE 315/80 R22.5 TECHKING', bucket: 'tyre', kind: 'new',
      qty_previous: 0, qty_current: 387, price_previous: null, price_current: 766,
      spend_previous: 0, spend_current: 296442,
      price_effect: 0, volume_effect: 0, delta: 296442,
      lines_current: 387, lines_previous: 0,
    },
    {
      code: '222544-O', label: 'REFCOMP COMPRESSOR SW3L16000L4', bucket: 'spare', kind: 'stopped',
      qty_previous: 1, qty_current: 0, price_previous: 76140, price_current: null,
      spend_previous: 76140, spend_current: 0,
      price_effect: 0, volume_effect: 0, delta: -76140,
      lines_current: 0, lines_previous: 1,
    },
  ],
  items_tail: { count: 2033, delta: -305869.26, price_effect: -216294.91, volume_effect: 141270.42 },
  dims: {
    by_site: {
      rows: [
        { label: 'NHC-ST', current: 1014040.08, previous: 1359570.83, delta: -345530.75, lines: 6071 },
        { label: 'DIRIYAH-ST', current: 600147.25, previous: 333782.85, delta: 266364.40, lines: 2645 },
        { label: 'AMALA-ST', current: 94784.37, previous: 333965.72, delta: -239181.35, lines: 480 },
        { label: 'REDSEA-ST', current: 226166.40, previous: 451774.62, delta: -225608.22, lines: 1412 },
        { label: 'DHABAN-ST', current: 196905.13, previous: 13754.80, delta: 183150.33, lines: 849 },
        { label: 'QIDDIYA-ST', current: 259343.82, previous: 120102.65, delta: 139241.17, lines: 601 },
        { label: 'LAHEQ-ST', current: 7344.55, previous: 121473.09, delta: -114128.54, lines: 32 },
        { label: 'KSP_TP-ST', current: 83960.08, previous: 197773.51, delta: -113813.43, lines: 289 },
        { label: 'RIY-MET-ST', current: 267829.78, previous: 340671.76, delta: -72841.98, lines: 2068 },
        { label: 'MISK-ST', current: 0, previous: 65790.44, delta: -65790.44, lines: 0 },
      ],
      tail: { count: 4, current: 512.00, previous: 2190.03, delta: -1678.03 },
      unchanged: 0,
    },
    by_asset: {
      rows: [
        { label: 'IP071', current: 2611.47, previous: 160280.69, delta: -157669.22, lines: 4 },
        { label: 'BP057', current: 6852.68, previous: 76473.47, delta: -69620.79, lines: 20 },
        { label: 'MP049', current: 23634.61, previous: 63252.93, delta: -39618.32, lines: 87 },
        { label: 'BP065', current: 0, previous: 38669.49, delta: -38669.49, lines: 0 },
        { label: 'BP032', current: 9162.56, previous: 46943.41, delta: -37780.85, lines: 59 },
        { label: 'BP056', current: 13385.68, previous: 50768.99, delta: -37383.31, lines: 64 },
        { label: 'BP064', current: 380.00, previous: 31124.16, delta: -30744.16, lines: 1 },
        { label: 'IP067', current: 12712.70, previous: 35651.71, delta: -22939.01, lines: 16 },
        { label: 'IP027', current: 5258.94, previous: 27343.05, delta: -22084.11, lines: 25 },
        { label: 'BP069', current: 4057.40, previous: 24675.40, delta: -20618.00, lines: 21 },
      ],
      tail: { count: 608, current: 2672977.42, previous: 2785667.00, delta: -112689.58 },
      unchanged: 0,
    },
  },
}

/** The same engine pointed at one site: DIRIYAH-ST, the case that ROSE. */
const DIRIYAH = {
  ok: true,
  blended: false,
  currency: 'SAR',
  country: 'KSA',
  site: 'DIRIYAH-ST',
  windows: {
    current: { from: '2026-01-01', to: '2026-06-30' },
    previous: { from: '2025-07-04', to: '2025-12-31' },
    days: 181,
  },
  totals: {
    current: 600147.25, previous: 333782.85, delta: 266364.40,
    lines_current: 2645, lines_previous: 1503,
  },
  effects: {
    price: 613.11, volume: 72201.41, new_items: 199168.29, stopped_items: -5618.41,
    not_decomposable: 0, items_both: 141, items_new: 219, items_stopped: 91,
    spend_priced_current: 600147.25, spend_priced_previous: 333782.85,
  },
  items: [
    {
      code: '223758-O', label: 'TIRE 315/80 R22.5 TECHKING', bucket: 'tyre', kind: 'new',
      qty_previous: 0, qty_current: 162, price_previous: null, price_current: 766,
      spend_previous: 0, spend_current: 124092,
      price_effect: 0, volume_effect: 0, delta: 124092,
      lines_current: 162, lines_previous: 0,
    },
    {
      code: '221855-O', label: 'TIRE 385-65R22.5', bucket: 'tyre', kind: 'both',
      qty_previous: 13, qty_current: 32, price_previous: 950, price_current: 958.75,
      spend_previous: 12350, spend_current: 30680,
      price_effect: 196.88, volume_effect: 18133.13, delta: 18330,
      lines_current: 32, lines_previous: 13,
    },
  ],
  items_tail: { count: 432, delta: 92883.90, price_effect: 815.99, volume_effect: 34210.03 },
  dims: {
    by_site: {
      rows: [{ label: 'DIRIYAH-ST', current: 600147.25, previous: 333782.85, delta: 266364.40, lines: 2645 }],
      tail: { count: 0, current: 0, previous: 0, delta: 0 },
      unchanged: 0,
    },
    by_asset: {
      rows: [
        { label: 'BP087', current: 17524.67, previous: 4540.11, delta: 12984.56, lines: 103 },
        { label: 'SL020', current: 19952.22, previous: 10639.51, delta: 9312.71, lines: 38 },
        { label: 'TM551', current: 0, previous: 8204.95, delta: -8204.95, lines: 0 },
        { label: 'SL019', current: 8204.00, previous: 0, delta: 8204.00, lines: 21 },
        { label: 'WL051', current: 7208.00, previous: 0, delta: 7208.00, lines: 7 },
        { label: 'TM654', current: 7907.48, previous: 987.50, delta: 6919.98, lines: 14 },
        { label: 'BP096', current: 6165.57, previous: 0, delta: 6165.57, lines: 39 },
        { label: 'MP122', current: 6416.00, previous: 268.00, delta: 6148.00, lines: 7 },
        { label: 'IP059', current: 6068.82, previous: 0, delta: 6068.82, lines: 9 },
        { label: 'WL039', current: 8429.12, previous: 2609.60, delta: 5819.52, lines: 8 },
      ],
      tail: { count: 273, current: 511371.37, previous: 305633.18, delta: 205738.19 },
      unchanged: 1,
    },
  },
}

/** UAE, same window. Different currency, and a fall driven by lines stopping. */
const UAE = {
  ok: true, blended: false, currency: 'AED', country: 'UAE', site: null,
  windows: {
    current: { from: '2026-01-01', to: '2026-06-30' },
    previous: { from: '2025-07-04', to: '2025-12-31' }, days: 181,
  },
  totals: {
    current: 3198556.76, previous: 4427115.70, delta: -1228558.94,
    lines_current: 12119, lines_previous: 13251,
  },
  effects: {
    price: 6256.74, volume: -300066.20, new_items: 962123.06, stopped_items: -1896872.54,
    not_decomposable: 0, items_both: 753, items_new: 1871, items_stopped: 1929,
    spend_priced_current: 3198556.76, spend_priced_previous: 4427115.70,
  },
  items: [
    {
      code: '310683-O', label: 'ROADX CN 315/80 R22.5 20PR RH618 156/153K-TL',
      bucket: 'tyre', kind: 'stopped',
      qty_previous: 400, qty_current: 0, price_previous: 666.67, price_current: null,
      spend_previous: 266668, spend_current: 0,
      price_effect: 0, volume_effect: 0, delta: -266668,
      lines_current: 0, lines_previous: 265,
    },
  ],
  items_tail: { count: 4514, delta: -406962.07, price_effect: -3390.30, volume_effect: -146398.57 },
  dims: {
    by_site: {
      rows: [
        { label: 'GC_JEB_ST', current: 2744541.71, previous: 3808166.81, delta: -1063625.10, lines: 9973 },
        { label: 'GC_BAN2_ST', current: 452915.05, previous: 618948.89, delta: -166033.84, lines: 2145 },
        { label: 'GC_BAN1_ST', current: 1100, previous: 0, delta: 1100, lines: 1 },
      ],
      tail: { count: 0, current: 0, previous: 0, delta: 0 },
      unchanged: 0,
    },
    by_asset: {
      rows: [
        { label: 'MP041', current: 17672.15, previous: 166173.91, delta: -148501.76, lines: 55 },
        { label: 'BP003', current: 3888.97, previous: 117187.37, delta: -113298.40, lines: 22 },
        { label: 'BP004', current: 41111.80, previous: 149277.88, delta: -108166.08, lines: 179 },
        { label: 'DP020', current: 165216.76, previous: 94982.89, delta: 70233.87, lines: 85 },
        { label: 'DP001', current: 32013.30, previous: 102197.63, delta: -70184.33, lines: 3 },
        { label: 'BN006', current: 84820.27, previous: 23224.63, delta: 61595.64, lines: 126 },
        { label: 'TM438', current: 66056.30, previous: 11582.33, delta: 54473.97, lines: 83 },
        { label: 'MP069', current: 59100.74, previous: 19201.44, delta: 39899.30, lines: 132 },
        { label: 'DP002', current: 39882.47, previous: 3087.00, delta: 36795.47, lines: 27 },
        { label: 'BP009', current: 95301.40, previous: 60967.66, delta: 34333.74, lines: 218 },
      ],
      tail: { count: 319, current: 2593492.60, previous: 3679232.96, delta: -1085740.36 },
      unchanged: 0,
    },
  },
}

const sum = (xs) => Math.round(xs.reduce((s, v) => s + v, 0) * 100) / 100

/* ------------------------------------------------------------------------ */

describe('the parts add up to the whole', () => {
  it('the five effects sum exactly to the total change on real KSA data', () => {
    const e = effectSplit(KSA)
    const parts = e.terms.map((t) => t.amount)
    expect(sum(parts)).toBe(KSA.totals.delta)
    expect(e.total).toBe(-589816.84)
    expect(e.residual).toBe(0)
    expect(e.closes).toBe(true)
    // nothing had to be invented to make it balance
    expect(e.terms.some((t) => t.key === 'rounding' || t.key === 'unexplained')).toBe(false)
  })

  it('the grouped price / volume / mix view closes against the same total', () => {
    const e = effectSplit(KSA)
    expect(sum(e.groups.map((g) => g.amount))).toBe(KSA.totals.delta)
    expect(e.groups.find((g) => g.key === 'mix').amount)
      .toBe(Math.round((649833.99 - 723540.76) * 100) / 100)
  })

  it('site contributions plus the tail sum exactly to the total change', () => {
    const c = contributions(KSA.dims.by_site, { total: KSA.totals.delta, limit: 20 })
    const parts = [
      ...c.rows.map((r) => r.delta),
      c.tail?.delta || 0,
      c.remainder?.delta || 0,
    ]
    expect(sum(parts)).toBe(-589816.84)
  })

  it('adds an explicit remainder row when the shown rows do not reach the total', () => {
    // only the top three sites are shown, so the other eleven must be carried
    const c = contributions(KSA.dims.by_site, { total: KSA.totals.delta, limit: 3 })
    expect(c.rows).toHaveLength(3)
    expect(c.remainder).not.toBeNull()
    expect(c.remainder.label).toBe('Everything else')
    // shown rows + the server tail + the remainder still meet the total exactly
    expect(sum([...c.rows.map((r) => r.delta), c.tail.delta, c.remainder.delta]))
      .toBe(-589816.84)
  })

  it('closes when the asset tail carries most of the movement', () => {
    const c = contributions(KSA.dims.by_asset, { total: KSA.totals.delta, limit: 20 })
    expect(sum([...c.rows.map((r) => r.delta), c.tail.delta, c.remainder?.delta || 0]))
      .toBe(-589816.84)
  })

  it('names a real gap "Not attributed" rather than calling it rounding', () => {
    const broken = { ...KSA, effects: { ...KSA.effects, volume: -286556.18 } }
    const e = effectSplit(broken)
    const gap = e.terms.find((t) => t.key === 'unexplained')
    expect(gap).toBeDefined()
    expect(gap.amount).toBe(-100000)
    expect(e.closes).toBe(false)
    // and it still closes arithmetically, because the gap is a real term
    expect(sum(e.terms.map((t) => t.amount))).toBe(-589816.84)
  })

  it('treats sub-currency-unit dust as rounding, not as a missing explanation', () => {
    const dusty = { ...KSA, effects: { ...KSA.effects, price: -129553.49 } }
    const e = effectSplit(dusty)
    expect(e.terms.find((t) => t.key === 'rounding')).toBeDefined()
    expect(e.closes).toBe(true)
  })
})

describe('price is not confused with volume', () => {
  const only = (effects, items) => ({
    ok: true, blended: false, currency: 'SAR', country: 'KSA',
    windows: { current: { from: '2026-01-01', to: '2026-06-30' }, previous: { from: '2025-07-04', to: '2025-12-31' }, days: 181 },
    totals: { current: 1200, previous: 1000, delta: 200 },
    effects: { price: 0, volume: 0, new_items: 0, stopped_items: 0, not_decomposable: 0, items_both: 1, items_new: 0, items_stopped: 0, ...effects },
    items,
  })

  it('a pure price rise reports zero volume', () => {
    // 100 units both periods, 10 SAR each becoming 12
    const snap = only({ price: 200 }, [{
      code: 'P1', label: 'WIDGET', kind: 'both',
      qty_previous: 100, qty_current: 100, price_previous: 10, price_current: 12,
      spend_previous: 1000, spend_current: 1200,
      price_effect: 200, volume_effect: 0, delta: 200, lines_current: 4, lines_previous: 4,
    }])
    const e = effectSplit(snap)
    expect(e.terms.find((t) => t.key === 'price').amount).toBe(200)
    expect(e.terms.find((t) => t.key === 'volume').amount).toBe(0)
    expect(itemMovers(snap)[0].driver).toBe('price')
    expect(narrate(decomposeVariance(snap)).text).toContain('unit prices rising')
    expect(narrate(decomposeVariance(snap)).text).not.toContain('buying more')
  })

  it('a pure volume rise reports zero price', () => {
    const snap = only({ volume: 200 }, [{
      code: 'P1', label: 'WIDGET', kind: 'both',
      qty_previous: 100, qty_current: 120, price_previous: 10, price_current: 10,
      spend_previous: 1000, spend_current: 1200,
      price_effect: 0, volume_effect: 200, delta: 200, lines_current: 5, lines_previous: 4,
    }])
    const e = effectSplit(snap)
    expect(e.terms.find((t) => t.key === 'volume').amount).toBe(200)
    expect(e.terms.find((t) => t.key === 'price').amount).toBe(0)
    expect(itemMovers(snap)[0].driver).toBe('volume')
    expect(narrate(decomposeVariance(snap)).text).toContain('buying more')
  })

  it('calls an item mixed when price and volume both moved materially', () => {
    const snap = only({ price: 100, volume: 100 }, [{
      code: 'P1', label: 'WIDGET', kind: 'both',
      qty_previous: 100, qty_current: 110, price_previous: 10, price_current: 10.9,
      spend_previous: 1000, spend_current: 1200,
      price_effect: 100, volume_effect: 100, delta: 200, lines_current: 5, lines_previous: 4,
    }])
    expect(itemMovers(snap)[0].driver).toBe('mixed')
  })

  it('never attributes a price effect to an item that existed in only one period', () => {
    // there is no earlier price to compare against, so inventing one would be a lie
    const newLine = itemMovers(KSA).find((i) => i.code === '223758-O')
    expect(newLine.kind).toBe('new')
    expect(newLine.priceEffect).toBe(0)
    expect(newLine.volumeEffect).toBe(0)
    expect(newLine.pricePrevious).toBeNull()
  })
})

describe('lines that started and lines that stopped are both surfaced', () => {
  it('keeps a stopped site, which explains a fall as surely as a new one explains a rise', () => {
    const c = contributions(KSA.dims.by_site, { total: KSA.totals.delta, limit: 20 })
    const misk = c.rows.find((r) => r.label === 'MISK-ST')
    expect(misk).toBeDefined()
    expect(misk.direction).toBe('stopped')
    expect(misk.delta).toBe(-65790.44)
    const dhabban = c.rows.find((r) => r.label === 'DHABAN-ST')
    expect(dhabban.previous).toBe(13754.80)
    expect(dhabban.current).toBe(196905.13)
  })

  it('surfaces both a new item and a stopped item with their quantities', () => {
    const items = itemMovers(KSA)
    const started = items.find((i) => i.kind === 'new')
    const stopped = items.find((i) => i.kind === 'stopped')
    expect(started.code).toBe('223758-O')
    expect(started.qtyCurrent).toBe(387)
    expect(started.priceCurrent).toBe(766)
    expect(stopped.code).toBe('222544-O')
    expect(stopped.qtyPrevious).toBe(1)
    expect(stopped.qtyCurrent).toBe(0)
  })

  it('reports assortment churn gross as well as net', () => {
    const c = assortmentChurn(UAE)
    expect(c.started).toBe(962123.06)
    expect(c.stopped).toBe(-1896872.54)
    expect(c.net).toBe(-934749.48)
    expect(c.gross).toBe(2858995.60)
    expect(c.countStarted).toBe(1871)
    expect(c.countStopped).toBe(1929)
  })

  it('flags churn that largely cancels, because that is a coding question not a spend one', () => {
    const offsetting = assortmentChurn({
      effects: { new_items: 500000, stopped_items: -480000, items_new: 10, items_stopped: 11 },
      totals: { delta: 20000 },
    })
    expect(offsetting.offsetting).toBe(true)
    // UAE really is offsetting: 962,123 started against 1,896,873 stopped, so
    // half of what "stopped" reappeared under another code (ROADX RH618 out,
    // ROADX AP869 up). The narrative must raise that, not report a clean exit.
    expect(assortmentChurn(UAE).offsetting).toBe(true)
    // a one-sided change is not churn and must not be flagged as such
    expect(assortmentChurn({
      effects: { new_items: 500000, stopped_items: -10000, items_new: 10, items_stopped: 1 },
      totals: { delta: 490000 },
    }).offsetting).toBe(false)
  })
})

describe('concentration tells one asset apart from a broad drift', () => {
  it('refuses to call the KSA asset movement concentrated: 10 of 618 assets cover 80%', () => {
    const c = contributions(KSA.dims.by_asset, { total: KSA.totals.delta, limit: 20 })
    const con = concentration(c)
    expect(con.top1.label).toBe('IP071')
    // the largest asset is 27% of the gross movement, so naming it as the cause
    // would be wrong, but 608 others netting to -112,690 is not a clean drift
    // either. "mixed" is the honest answer, and it is not "concentrated".
    expect(con.breadth).toBe('mixed')
    expect(con.countTo80).toBe(10)
    expect(con.top1Share).toBeCloseTo(0.267, 3)
    // the tail nets 608 assets into one figure, so the true gross movement is
    // at least this and probably more; the reader is told so
    expect(c.grossIsLowerBound).toBe(true)
  })

  it('calls it broad when the tail carries most of the movement', () => {
    const c = contributions(DIRIYAH.dims.by_asset, { total: DIRIYAH.totals.delta, limit: 20 })
    const con = concentration(c)
    expect(con.breadth).toBe('broad')
    expect(con.diffuse).toBe(true)
    expect(con.top1Share).toBeLessThan(0.1)
  })

  it('calls a single dominant member concentrated', () => {
    const c = contributions({
      rows: [
        { label: 'BIG', current: 900, previous: 100, delta: 800, lines: 3 },
        { label: 'SMALL', current: 110, previous: 100, delta: 10, lines: 1 },
      ],
      tail: { count: 0, current: 0, previous: 0, delta: 0 },
    }, { total: 810, limit: 10 })
    const con = concentration(c)
    expect(con.breadth).toBe('concentrated')
    expect(con.top1.label).toBe('BIG')
    expect(con.top1Share).toBeCloseTo(0.988, 2)
  })

  it('measures against gross movement so two sites cancelling still counts as movement', () => {
    const c = contributions({
      rows: [
        { label: 'UP', current: 300, previous: 0, delta: 300, lines: 1 },
        { label: 'DOWN', current: 0, previous: 300, delta: -300, lines: 0 },
      ],
      tail: { count: 0, current: 0, previous: 0, delta: 0 },
    }, { total: 0, limit: 10 })
    expect(c.gross).toBe(600)
    expect(concentration(c).top1Share).toBeCloseTo(0.5, 3)
  })
})

describe('the narrative names the real driver and nothing else', () => {
  it('names the largest actual mover for KSA, with its own figures', () => {
    const n = narrate(decomposeVariance(KSA))
    expect(n.headline).toContain('fell')
    expect(n.headline).toContain('589,817 SAR')
    expect(n.headline).toContain('3,340,850')
    expect(n.headline).toContain('2,751,033')
    // 310522-O is the true largest item mover at -353,460, 60% of the change
    expect(n.text).toContain('310522-O')
    expect(n.text).toContain('353,460 SAR')
    expect(n.text).toContain('60%')
    // and its driver really is volume, 1,383 units down to 992
    expect(n.text).toContain('1,383')
    expect(n.text).toContain('992')
  })

  it('answers the increase case at DIRIYAH-ST and attributes it to the new line', () => {
    const n = narrate(decomposeVariance(DIRIYAH))
    expect(n.headline).toContain('DIRIYAH-ST in KSA')
    expect(n.headline).toContain('rose')
    expect(n.headline).toContain('266,364 SAR')
    expect(n.headline).toContain('80%')
    expect(n.text).toContain('223758-O')
    expect(n.text).toContain('TECHKING')
    expect(n.text).toContain('162 units at 766 SAR')
    // prices barely moved: 613 of a 266,364 rise
    expect(n.text).toContain('close to flat')
  })

  it('refuses to name an asset when no asset dominates', () => {
    const n = narrate(decomposeVariance(DIRIYAH))
    expect(n.text).toContain('No single asset explains it')
    expect(n.text).toContain('273 further assets')
  })

  it('names the two largest movers when nothing dominates but it is not an even drift', () => {
    // KSA sites: 7 of 14 cover 80%. Naming one cause would be wrong, saying
    // nothing would hide where the money went.
    const n = narrate(decomposeVariance(KSA))
    expect(n.text).toContain('It is spread across sites')
    expect(n.text).toContain('NHC-ST fell 345,531 SAR')
    expect(n.text).toContain('DIRIYAH-ST rose 266,364 SAR')
    expect(n.text).toContain('7 sites covering 80%')
  })

  it('states a negative as a direction and a positive amount, never a minus sign', () => {
    const n = narrate(decomposeVariance(UAE))
    expect(n.text).toContain('1,085,740 AED reduction')
    expect(n.text).not.toContain('-1,085,740')
    expect(n.text).not.toMatch(/for -/)
  })

  it('calls a genuinely dominant site concentrated', () => {
    // UAE has one site carrying 86 percent of the movement
    expect(narrate(decomposeVariance(UAE)).text).toContain('It is concentrated: GC_JEB_ST')
  })

  it('uses each payload own currency and never mixes them', () => {
    expect(narrate(decomposeVariance(KSA)).text).toContain('SAR')
    expect(narrate(decomposeVariance(KSA)).text).not.toContain('AED')
    expect(narrate(decomposeVariance(UAE)).text).toContain('AED')
    expect(narrate(decomposeVariance(UAE)).text).not.toContain('SAR')
  })

  it('states what changed and never why anyone chose it', () => {
    const all = [KSA, DIRIYAH, UAE].map((s) => narrate(decomposeVariance(s)).text).join(' ')
    for (const motive of ['because', 'decided', 'switched supplier', 'negotiated',
      'in order to', 'management', 'chose', 'strategy']) {
      expect(all.toLowerCase()).not.toContain(motive)
    }
  })

  it('says the amount it could not attribute out loud', () => {
    const broken = { ...KSA, effects: { ...KSA.effects, volume: -286556.18 } }
    const n = narrate(decomposeVariance(broken))
    expect(n.text).toContain('100,000 SAR')
    expect(n.text).toContain('not attributed')
    expect(decomposeVariance(broken).trustworthy).toBe(false)
  })
})

describe('nothing is claimed when there is nothing to claim', () => {
  it('makes no claim at all on an empty input', () => {
    const n = narrate(decomposeVariance(null))
    expect(n.headline).toBe('There is nothing to explain yet.')
    expect(n.lines).toEqual([])
    expect(decomposeVariance(null).ok).toBe(false)
  })

  it('makes no claim when both periods are empty', () => {
    const empty = {
      ok: true, blended: false, currency: 'SAR', country: 'KSA',
      windows: { current: { from: '2026-01-01', to: '2026-06-30' }, previous: { from: '2025-07-04', to: '2025-12-31' }, days: 181 },
      totals: { current: 0, previous: 0, delta: 0 },
      effects: { price: 0, volume: 0, new_items: 0, stopped_items: 0, not_decomposable: 0, items_both: 0, items_new: 0, items_stopped: 0 },
      items: [], dims: {},
    }
    const n = narrate(decomposeVariance(empty))
    expect(n.text).toContain('nothing to explain')
    expect(n.lines).toEqual([])
  })

  it('says spend was unchanged rather than inventing a driver', () => {
    const flat = {
      ok: true, blended: false, currency: 'SAR', country: 'KSA',
      windows: { current: { from: '2026-01-01', to: '2026-06-30' }, previous: { from: '2025-07-04', to: '2025-12-31' }, days: 181 },
      totals: { current: 5000, previous: 5000, delta: 0 },
      effects: { price: 0, volume: 0, new_items: 0, stopped_items: 0, not_decomposable: 0, items_both: 3, items_new: 0, items_stopped: 0 },
      items: [], dims: {},
    }
    const n = narrate(decomposeVariance(flat))
    expect(n.headline).toContain('unchanged at 5,000 SAR')
  })

  it('refuses to decompose a total that spans more than one currency', () => {
    const blended = { ok: true, blended: true, currency: null, reason: 'Spend spans more than one currency.' }
    const d = decomposeVariance(blended)
    expect(d.ok).toBe(false)
    expect(d.blended).toBe(true)
    const n = narrate(d)
    expect(n.headline).toContain('more than one currency')
    // no money at all reaches the page
    expect(n.text).not.toMatch(/\d{3},\d{3}/)
  })

  it('does not split a site-scoped view by site, which would say nothing', () => {
    expect(narrate(decomposeVariance(DIRIYAH)).text).not.toContain('No single site')
  })
})

describe('degrading onto the older payload', () => {
  it('accepts a get_cost_cpk_overview by_site array and still closes', () => {
    // V374 shape: ranked by spend, no tail, so the remainder row is the only
    // thing keeping the column honest
    const v374 = [
      { label: 'NHC-ST', spend: 1014040.08, prev_spend: 1359570.83, lines: 6071 },
      { label: 'DIRIYAH-ST', spend: 600147.25, prev_spend: 333782.85, lines: 2645 },
    ]
    const c = contributions(v374, { total: -589816.84, limit: 2 })
    expect(c.rows[0].label).toBe('NHC-ST')
    expect(sum([...c.rows.map((r) => r.delta), c.remainder.delta])).toBe(-589816.84)
  })

  it('marks a dimension that came from the fallback payload', () => {
    const d = decomposeVariance({ ...KSA, dims: {} }, {
      fallbackDims: { by_site: [{ label: 'NHC-ST', spend: 1014040.08, prev_spend: 1359570.83, lines: 6071 }] },
    })
    expect(d.byDim.by_site.fromFallback).toBe(true)
    expect(d.byDim.by_asset).toBeUndefined()
  })
})

describe('formatting', () => {
  it('renders a missing figure as N/A, never as zero', () => {
    expect(fmtMoney(null, 'SAR')).toBe('N/A')
    expect(fmtPct(null)).toBe('N/A')
    expect(fmtMoney(0, 'SAR')).toBe('0 SAR')
  })

  it('names the export money column after the currency', () => {
    const x = buildVarianceExport(decomposeVariance(KSA))
    expect(x.headers[2]).toBe('Change (SAR)')
    expect(x.rows.some((r) => r.section === 'Why it changed')).toBe(true)
    expect(x.rows.some((r) => r.name === 'Everything else' || r.name.includes('further'))).toBe(true)
  })

  it('exports nothing at all for a blended scope', () => {
    expect(buildVarianceExport(decomposeVariance({ ok: true, blended: true })).rows).toEqual([])
  })
})
