/**
 * Asset Disposal deck builder tests.
 *
 * This deck is what goes in front of the disposal committee to write 37 machines
 * off the books, so the tests police the things that would embarrass the owner in
 * that room rather than just exercising the happy path:
 *
 *   - a valuation nobody has done prints "Not valued", never 0 and never a
 *     derived estimate,
 *   - the assets that are NOT in the fleet register appear and are labelled,
 *   - an empty register says so instead of drawing an empty chart,
 *   - nothing outside plain ASCII can reach a slide (the pptx and pdf leave the
 *     building; a curly quote or an em dash ships as a box glyph),
 *   - an old or junk saved layout still opens,
 *   - and the renderers are exercised against the REAL pptxgenjs / jsPDF, because
 *     a mocked export cannot see a peer range break (the jspdf-autotable outage
 *     that src/test/pdfEngine.test.js exists for).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  DECK_BLOCKS, DECK_BLOCK_KEYS, DECK_PRESETS, DECK_PRESET_KEYS,
  KPI_ITEMS, CHART_SOURCE_KEYS, TABLE_COLUMNS,
  ascii, fmtNum, fmtMoney, fmtValuation, fmtText, NOT_VALUED,
  toPairs, localAgeBands, localFindings, remarkLines, tyreRows, filterRows,
  chartData, chartDigest, makeBlock, normalizeDeckConfig, resolveBlock, buildDeck,
  presetConfig, saveNamedDeck, listSavedDecks, deleteNamedDeck,
  loadDeckLayout, saveDeckLayout,
} from '../lib/assetDisposalDeck'
import {
  renderDisposalDeckPptx, renderDisposalDeckPdf,
  slideChartConfig, chartFallbackTable, hex6, valuationCaveat, registerCaveat,
} from '../lib/assetDisposalDeckRender'

// ── Fixtures modelled on the live list ───────────────────────────────────────
const tyre = (serial, position, km) => ({ serial, position, brand: 'ROADX', size: '315/80R22.5', fitted: '2019-04-01', km })

const ROWS = [
  {
    asset_no: 'TM101', sr_no: '1', register_status: 'SCRAP', region: 'C-REGION',
    asset_type: 'BT-PLANT', model_year: 2008, brand: 'SANY', condition: 'Dismantled',
    disposition: 'scrap', site: 'RIYADH',
    remarks: 'Engine seized\nCabin stripped for parts',
    meter_text: '412,300 km', meter_km: 412300, meter_hours: null,
    estimated_value: null, sale_proceeds: null, currency: 'SAR',
    status: 'proposed', in_register: true, fleet_status: 'Active', fleet_site: 'RIYADH',
    fleet_vehicle_type: 'BT-PLANT', fleet_make: 'SANY', fleet_model: 'X', fleet_current_km: 412300,
    chassis_no: 'CH-1', registration_no: '1234 ABC',
    job_cards: 120, first_job_card: '2012-01-01', last_job_card: '2025-06-01', spend: 480000,
    tyres_total: 6, tyres_active: 2, serials: [tyre('EP001', 'LHF1', 41000), tyre('EP002', 'RHF1', 39000)],
  },
  {
    asset_no: 'TM192', sr_no: '2', register_status: 'SCRAP', region: 'W-REGION',
    asset_type: 'TIPPER TRAILER', model_year: 2011, brand: 'MERCEDES', condition: 'Major Accident',
    disposition: 'scrap', site: 'JEDDAH',
    remarks: 'Rolled over in 2023, chassis bent beyond repair',
    meter_text: 'N/A', meter_km: null, meter_hours: null,
    estimated_value: null, sale_proceeds: null, currency: 'SAR',
    status: 'proposed', in_register: false, fleet_status: null, fleet_site: null,
    fleet_vehicle_type: null, fleet_make: null, fleet_model: null, fleet_current_km: null,
    chassis_no: null, registration_no: null,
    job_cards: 4, first_job_card: '2019-03-01', last_job_card: '2022-11-01', spend: 9000,
    tyres_total: 0, tyres_active: 0, serials: [],
  },
  {
    asset_no: 'BP022', sr_no: '3', register_status: 'Working', region: 'C-REGION',
    asset_type: 'GENERATOR', model_year: 2016, brand: 'CAT', condition: 'Running',
    disposition: 'sell', site: 'RIYADH',
    remarks: 'Runs well, surplus to the plant',
    meter_text: '8,200 hrs', meter_km: null, meter_hours: 8200,
    estimated_value: null, sale_proceeds: null, currency: 'SAR',
    status: 'approved', in_register: false, fleet_status: null, fleet_site: null,
    fleet_vehicle_type: null, fleet_make: null, fleet_model: null, fleet_current_km: null,
    chassis_no: 'CH-3', registration_no: null,
    job_cards: 30, first_job_card: '2017-02-01', last_job_card: '2026-01-01', spend: 61000,
    tyres_total: 0, tyres_active: 0, serials: [],
  },
  {
    asset_no: 'PU044', sr_no: '4', register_status: 'Working', region: 'W-REGION',
    asset_type: 'PICKUP', model_year: 2014, brand: 'TOYOTA', condition: 'complete',
    disposition: 'sell', site: 'JEDDAH',
    remarks: '',
    meter_text: '260,000 km', meter_km: 260000, meter_hours: null,
    estimated_value: null, sale_proceeds: null, currency: 'SAR',
    status: 'proposed', in_register: true, fleet_status: 'Inactive', fleet_site: 'JEDDAH',
    fleet_vehicle_type: 'PICKUP', fleet_make: 'TOYOTA', fleet_model: 'Hilux', fleet_current_km: 260000,
    chassis_no: 'CH-4', registration_no: '9876 XYZ',
    job_cards: 55, first_job_card: '2015-01-01', last_job_card: '2025-09-01', spend: 90000,
    tyres_total: 4, tyres_active: 1, serials: [tyre('EP009', 'LHR1', 12000)],
  },
]

const TOTALS = {
  assets: 4, to_scrap: 2, to_sell: 2, in_register: 2, still_active: 1, not_in_register: 2,
  approved: 1, disposed: 0, job_cards: 209, lifetime_spend: 640000, active_tyres: 3,
  estimated_value: null, sale_proceeds: null,
}

const CTX = { rows: ROWS, totals: TOTALS, currency: 'SAR', company: 'Green Concrete', country: 'KSA' }

beforeEach(() => {
  try { localStorage.clear() } catch { /* no storage in this environment */ }
})

// ── Formatting and the honesty rules ─────────────────────────────────────────
describe('formatting refuses to invent', () => {
  it('prints Not valued for a valuation nobody has done, never 0', () => {
    expect(fmtValuation(null)).toBe(NOT_VALUED)
    expect(fmtValuation(undefined)).toBe(NOT_VALUED)
    expect(fmtValuation('')).toBe(NOT_VALUED)
    expect(fmtValuation(0)).toBe('SAR 0')      // a real recorded zero still reads as a figure
    expect(fmtValuation(125000, 'SAR')).toBe('SAR 125,000')
  })

  it('keeps a missing number as N/A rather than zero', () => {
    expect(fmtNum(null)).toBe('N/A')
    expect(fmtNum(undefined)).toBe('N/A')
    expect(fmtMoney(null)).toBe('N/A')
    expect(fmtNum(2026)).toBe('2,026')
    expect(fmtText('')).toBe('N/A')
  })

  it('folds every non ASCII character before it can reach a slide', () => {
    const dirty = 'Scrap — 2019–2024 “written off” → committee’s call…'
    const out = ascii(dirty)
    expect(out).toBe("Scrap - 2019-2024 \"written off\"  to  committee's call...")
    expect(/[^\x20-\x7E\n]/.test(out)).toBe(false)
  })
})

describe('grouping helpers', () => {
  it('normalises every shape a grouping helper might return', () => {
    expect(toPairs({ SCRAP: 3, SELL: 1 })).toEqual([{ label: 'SCRAP', value: 3 }, { label: 'SELL', value: 1 }])
    expect(toPairs([{ key: 'A', count: 2 }])).toEqual([{ label: 'A', value: 2 }])
    expect(toPairs([{ label: 'B', value: 5 }])).toEqual([{ label: 'B', value: 5 }])
    expect(toPairs(new Map([['C', 7]]))).toEqual([{ label: 'C', value: 7 }])
    expect(toPairs(null)).toEqual([])
  })

  it('never guesses an age band for an asset with no model year', () => {
    const bands = localAgeBands([{ model_year: null }, { model_year: 2024 }], new Date('2026-06-01'))
    const labels = bands.map((b) => b.label)
    expect(labels).toContain('Year not recorded')
    expect(bands.find((b) => b.label === 'Year not recorded').value).toBe(1)
  })

  it('splits committee remarks into bullets and keeps the wording', () => {
    expect(remarkLines(ROWS[0])).toEqual(['Engine seized', 'Cabin stripped for parts'])
    expect(remarkLines(ROWS[3])).toEqual([])
  })

  it('flattens only tyres that carry a real serial', () => {
    const rows = tyreRows([...ROWS, { asset_no: 'X', serials: [{ serial: '   ' }, { serial: null }] }])
    expect(rows).toHaveLength(3)
    expect(rows.map((t) => t.serial)).toEqual(['EP001', 'EP002', 'EP009'])
  })
})

// ── Config normalisation ─────────────────────────────────────────────────────
describe('normalizeDeckConfig opens an old or junk config', () => {
  it('survives complete rubbish', () => {
    for (const junk of [null, undefined, 42, 'nope', [], { blocks: 'no' }]) {
      const cfg = normalizeDeckConfig(junk)
      expect(Array.isArray(cfg.blocks)).toBe(true)
      expect(cfg.blocks.length).toBeGreaterThan(0)
      expect(cfg.orientation).toBe('landscape')
      expect(cfg.currency).toBe('SAR')
    }
  })

  it('drops a block type that no longer exists instead of crashing', () => {
    const cfg = normalizeDeckConfig({ blocks: [{ type: 'gone_forever' }, { type: 'findings' }] })
    expect(cfg.blocks.map((b) => b.type)).toEqual(['findings'])
  })

  it('clamps every out of range field an old layout might carry', () => {
    const cfg = normalizeDeckConfig({
      orientation: 'sideways', currency: 12,
      blocks: [{ type: 'table', rowsPerSlide: 9999, limit: -5, density: 'huge', sort: 'nope', filter: 'nope', columns: ['not_a_column'] }],
    })
    const t = cfg.blocks[0]
    expect(cfg.orientation).toBe('landscape')
    expect(t.rowsPerSlide).toBe(24)
    expect(t.limit).toBe(0)
    expect(t.density).toBe('normal')
    expect(t.sort).toBe('asset_no')
    expect(t.filter).toBe('all')
    expect(t.columns.length).toBeGreaterThan(0)
    expect(t.columns.every((c) => TABLE_COLUMNS[c])).toBe(true)
  })

  it('keeps a valid saved config intact through a round trip', () => {
    const cfg = normalizeDeckConfig(presetConfig('scrap_only'))
    const again = normalizeDeckConfig(JSON.parse(JSON.stringify(cfg)))
    expect(again.blocks.map((b) => b.type)).toEqual(cfg.blocks.map((b) => b.type))
  })
})

// ── Presets ──────────────────────────────────────────────────────────────────
describe('presets', () => {
  it('ships the packs the committee work needs', () => {
    expect(DECK_PRESET_KEYS).toEqual(expect.arrayContaining([
      'committee', 'board', 'scrap_only', 'sale_candidates', 'dossier', 'register_gaps',
    ]))
  })

  it('every preset builds a normalisable, non empty deck', () => {
    for (const key of DECK_PRESET_KEYS) {
      const deck = buildDeck(presetConfig(key), CTX)
      expect(deck.slides.length).toBeGreaterThan(0)
      expect(DECK_PRESETS[key].label).toBeTruthy()
    }
  })

  it('the per asset dossier really produces one slide per machine', () => {
    const deck = buildDeck(presetConfig('dossier'), CTX)
    const assetSlides = deck.slides.filter((s) => s.kind === 'asset')
    expect(assetSlides).toHaveLength(ROWS.length)
    expect(assetSlides.map((s) => s.assetNo)).toEqual(['BP022', 'PU044', 'TM101', 'TM192'])
  })

  it('scrap only carries just the scrap machines', () => {
    const deck = buildDeck(presetConfig('scrap_only'), CTX)
    const table = deck.slides.find((s) => s.kind === 'table')
    const codes = table.rows.map((r) => r[0])
    expect(codes).toEqual(expect.arrayContaining(['TM101', 'TM192']))
    expect(codes).not.toContain('PU044')
  })
})

// ── resolveBlock, every block type ───────────────────────────────────────────
describe('resolveBlock covers every block in the catalog', () => {
  it('resolves each catalog block without throwing and returns a usable kind', () => {
    for (const type of DECK_BLOCK_KEYS) {
      const res = resolveBlock(makeBlock(type), CTX)
      expect(res).toBeTruthy()
      if (res.kind === 'multi') {
        expect(Array.isArray(res.slides)).toBe(true)
        expect(res.slides.length).toBeGreaterThan(0)
      } else {
        expect(typeof res.kind).toBe('string')
      }
    }
  })

  it('title slide states the asset count it covers', () => {
    const s = resolveBlock(makeBlock('title'), CTX)
    expect(s.kind).toBe('title')
    expect(s.assetCount).toBe(4)
    expect(s.company).toBe('Green Concrete')
  })

  it('kpi tiles print Not valued for the two valuation columns', () => {
    const s = resolveBlock(makeBlock('summary_kpis', { items: ['assets', 'estimated_value', 'sale_proceeds', 'lifetime_spend'] }), CTX)
    const by = Object.fromEntries(s.items.map((i) => [i.key, i]))
    expect(by.assets.value).toBe('4')
    expect(by.estimated_value.value).toBe(NOT_VALUED)
    expect(by.sale_proceeds.value).toBe(NOT_VALUED)
    expect(by.estimated_value.valuation).toBe(true)
    expect(by.lifetime_spend.value).toBe('SAR 640,000')
  })

  it('reads the camelCase totals the page actually passes', () => {
    // The page hands over the shared engine's disposalSummary, which is
    // camelCase. Reading only the snake_case contract names would make every
    // headline silently recount the rows and drift from the page above it.
    const camel = {
      assets: 4, toScrap: 2, toSell: 2, inRegister: 2, stillActive: 1, notInRegister: 2,
      jobCards: 209, lifetimeSpend: 640000, activeTyres: 3,
      estimatedValue: null, saleProceeds: null,
    }
    const s = resolveBlock(
      makeBlock('summary_kpis', { items: ['assets', 'to_scrap', 'still_active', 'not_in_register', 'job_cards', 'lifetime_spend', 'active_tyres', 'estimated_value'] }),
      { ...CTX, totals: camel },
    )
    const by = Object.fromEntries(s.items.map((i) => [i.key, i.value]))
    expect(by.to_scrap).toBe('2')
    expect(by.still_active).toBe('1')
    expect(by.not_in_register).toBe('2')
    expect(by.job_cards).toBe('209')
    expect(by.lifetime_spend).toBe('SAR 640,000')
    expect(by.active_tyres).toBe('3')
    expect(by.estimated_value).toBe(NOT_VALUED)
  })

  it('a mixed currency total reads N/A rather than adding riyals to dirhams', () => {
    // disposalSummary returns a null total when the rows carry two currencies.
    const s = resolveBlock(makeBlock('summary_kpis', { items: ['lifetime_spend'] }), {
      ...CTX, totals: { assets: 4, lifetimeSpend: null, mixedCurrency: true },
    })
    expect(s.items[0].value).toBe('N/A')
  })

  it('findings name the assets with no register record', () => {
    const s = resolveBlock(makeBlock('findings'), CTX)
    const text = s.bullets.join(' ')
    expect(s.empty).toBe(false)
    expect(text).toContain('TM192')
    expect(text).toContain('BP022')
    // Wording belongs to the shared engine; the deck asserts the SUBSTANCE, so a
    // rephrase there does not fail this and a dropped finding does.
    expect(text).toMatch(/not in the fleet register|no fleet register record/i)
    expect(text).toMatch(/still marked active/i)
    expect(text).toMatch(/value|valuation/i)
  })

  it('forwards totals to the engine only under the naming it reads', () => {
    // The page hands over snake_case totals while the engine reads camelCase.
    // Passing them straight through used to make it read undefined and DROP the
    // register findings entirely, which is the whole point of this deck.
    const snake = resolveBlock(makeBlock('findings'), CTX).bullets.join(' ')
    const none = resolveBlock(makeBlock('findings'), { ...CTX, totals: null }).bullets.join(' ')
    expect(snake).toContain('TM192')
    expect(snake).toBe(none)
  })

  it('chart resolves a real cut with a numeric digest', () => {
    const s = resolveBlock(makeBlock('chart', { source: 'by_disposition' }), CTX)
    expect(s.kind).toBe('chart')
    expect(s.empty).toBe(false)
    // Labels come from the shared engine's own group labelling, so the deck and
    // the page can never name the same bucket differently.
    expect(s.labels.map((l) => l.toLowerCase())).toEqual(expect.arrayContaining(['scrap', 'sell']))
    expect(s.values.reduce((a, b) => a + b, 0)).toBe(4)
    expect(s.digest).toContain('Total:')
  })

  it('a spend chart sums the money, not the machines', () => {
    const s = resolveBlock(makeBlock('chart', { source: 'by_region', metric: 'spend' }), CTX)
    expect(s.money).toBe(true)
    expect(s.values.reduce((a, b) => a + b, 0)).toBe(640000)
    expect(s.digest).toContain('SAR')
  })

  it('a measure that cannot be split says so instead of silently counting', () => {
    const s = resolveBlock(makeBlock('chart', { source: 'by_age_band', metric: 'spend' }), CTX)
    expect(s.metric).toBe('count')
    expect(s.note).toMatch(/cannot be split/i)
  })

  it('table paginates across slides and captions what it shows', () => {
    // rowsPerSlide has a floor of 4 (a 1 row slide is a wasted page), so 4 rows
    // over 4 per slide is deliberately ONE slide.
    const one = resolveBlock(makeBlock('table', { rowsPerSlide: 3 }), CTX)
    expect(one.slides).toHaveLength(1)
    expect(one.slides[0].caption).toContain('Showing 4 of 4 assets')

    const res = resolveBlock(makeBlock('table', { rowsPerSlide: 4 }), { ...CTX, rows: [...ROWS, ...ROWS] })
    expect(res.kind).toBe('multi')
    expect(res.slides).toHaveLength(2)
    expect(res.slides[0].title).toContain('1 of 2')
    expect(res.slides[1].rows).toHaveLength(4)
  })

  it('the tyre recovery list carries every fitted serial', () => {
    const res = resolveBlock(makeBlock('tyre_recovery'), CTX)
    const rows = res.slides.flatMap((s) => s.rows)
    expect(rows).toHaveLength(3)
    expect(res.slides[0].caption).toContain('3 tyres still fitted')
  })

  it('an asset dossier keeps the remarks verbatim and flags the register gap', () => {
    const res = resolveBlock(makeBlock('asset_detail', { filter: 'not_in_register' }), CTX)
    expect(res.slides).toHaveLength(2)
    const s = res.slides.find((x) => x.assetNo === 'TM192')
    expect(s.flags).toContain('NOT IN THE FLEET REGISTER')
    expect(s.flags).toContain(NOT_VALUED)
    expect(s.remarks).toEqual(['Rolled over in 2023, chassis bent beyond repair'])
    const facts = Object.fromEntries(s.facts.map((f) => [f.label, f.value]))
    expect(facts['Fleet register']).toBe('No record')
    expect(facts['Estimated value']).toBe(NOT_VALUED)
    // The meter is printed exactly as it was recorded, never re-derived.
    expect(facts['Meter (as recorded)']).toBe('N/A')
  })

  it('prints the meter reading verbatim, mixed units and all', () => {
    const res = resolveBlock(makeBlock('asset_detail', { filter: 'sell' }), CTX)
    const gen = res.slides.find((s) => s.assetNo === 'BP022')
    const facts = Object.fromEntries(gen.facts.map((f) => [f.label, f.value]))
    expect(facts['Meter (as recorded)']).toBe('8,200 hrs')
  })

  it('an unknown block degrades to an honest text slide', () => {
    const res = resolveBlock({ type: 'invented_by_a_bad_save' }, CTX)
    expect(res.kind).toBe('text')
  })
})

// ── The three assets not in the register ─────────────────────────────────────
describe('the assets with no fleet register record are never dropped', () => {
  it('they are counted in the headline numbers', () => {
    const s = resolveBlock(makeBlock('summary_kpis', { items: ['assets', 'not_in_register', 'in_register'] }), CTX)
    const by = Object.fromEntries(s.items.map((i) => [i.key, i.value]))
    expect(by.assets).toBe('4')
    expect(by.not_in_register).toBe('2')
    expect(by.in_register).toBe('2')
  })

  it('they are labelled in the register table, not shown as ordinary rows', () => {
    const res = resolveBlock(makeBlock('table', { columns: ['asset_no', 'in_register'], rowsPerSlide: 20 }), CTX)
    const flat = res.slides[0].rows
    const tm192 = flat.find((r) => r[0] === 'TM192')
    expect(tm192[1]).toBe('NOT IN REGISTER')
    expect(flat.find((r) => r[0] === 'TM101')[1]).toBe('Yes')
  })

  it('the deck carries their asset numbers for the standing caveat', () => {
    const deck = buildDeck(presetConfig('committee'), CTX)
    expect(deck.notInRegister).toEqual(['TM192', 'BP022'])
    expect(registerCaveat(deck)).toContain('TM192')
  })
})

// ── Empty register ───────────────────────────────────────────────────────────
describe('an empty register says so and never draws an empty chart', () => {
  const emptyCtx = { rows: [], totals: null, currency: 'SAR', company: 'Green Concrete', country: 'KSA' }

  it('marks every data slide empty with a reason', () => {
    const chart = resolveBlock(makeBlock('chart'), emptyCtx)
    expect(chart.empty).toBe(true)
    expect(chart.labels).toEqual([])
    expect(chart.emptyNote).toBeTruthy()

    const kpis = resolveBlock(makeBlock('summary_kpis'), emptyCtx)
    expect(kpis.empty).toBe(true)

    const findings = resolveBlock(makeBlock('findings'), emptyCtx)
    expect(findings.empty).toBe(true)
    expect(findings.bullets).toEqual([])

    const table = resolveBlock(makeBlock('table'), emptyCtx)
    expect(table.slides[0].empty).toBe(true)

    const assets = resolveBlock(makeBlock('asset_detail'), emptyCtx)
    expect(assets.slides[0].kind).toBe('text')
    expect(assets.slides[0].empty).toBe(true)
  })

  it('still builds a deck rather than nothing at all', () => {
    const deck = buildDeck(presetConfig('committee'), emptyCtx)
    expect(deck.slides.length).toBeGreaterThan(0)
    expect(deck.assetCount).toBe(0)
    expect(valuationCaveat(deck)).toBe('')
  })

  it('local findings return nothing rather than a made up sentence', () => {
    expect(localFindings([], null)).toEqual([])
  })
})

// ── buildDeck ────────────────────────────────────────────────────────────────
describe('buildDeck', () => {
  it('flattens multi slide blocks into one ordered list', () => {
    const cfg = normalizeDeckConfig({ blocks: [makeBlock('title'), makeBlock('table', { rowsPerSlide: 4 }), makeBlock('divider')] })
    const deck = buildDeck(cfg, { ...CTX, rows: [...ROWS, ...ROWS] })
    expect(deck.slides.map((s) => s.kind)).toEqual(['title', 'table', 'table', 'divider'])
  })

  it('reports the unvalued count so a renderer can state the caveat', () => {
    const deck = buildDeck(presetConfig('board'), CTX)
    expect(deck.unvaluedCount).toBe(4)
    expect(deck.assetCount).toBe(4)
    expect(valuationCaveat(deck)).toMatch(/No asset on this list has been valued/i)
  })

  it('every string on every slide is plain ASCII', () => {
    const deck = buildDeck(presetConfig('committee'), CTX)
    const walk = (v) => {
      if (typeof v === 'string') expect(/[^\x20-\x7E\n]/.test(v)).toBe(false)
      else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(deck)
  })
})

// ── Filters and chart maths ──────────────────────────────────────────────────
describe('filters and chart maths', () => {
  it('filters pick out exactly the assets they name', () => {
    expect(filterRows(ROWS, 'scrap').map((r) => r.asset_no)).toEqual(['TM101', 'TM192'])
    expect(filterRows(ROWS, 'sell').map((r) => r.asset_no)).toEqual(['BP022', 'PU044'])
    expect(filterRows(ROWS, 'not_in_register').map((r) => r.asset_no)).toEqual(['TM192', 'BP022'])
    expect(filterRows(ROWS, 'still_active').map((r) => r.asset_no)).toEqual(['TM101'])
    expect(filterRows(ROWS, 'with_tyres').map((r) => r.asset_no)).toEqual(['TM101', 'PU044'])
    expect(filterRows(ROWS, 'all')).toHaveLength(4)
  })

  it('a chart of zero rows returns no labels rather than a zero bar', () => {
    const d = chartData([], { source: 'by_type' })
    expect(d.labels).toEqual([])
    expect(chartDigest(d)).toBe('')
  })

  it('a tyre metric counts the serials actually fitted', () => {
    const d = chartData(ROWS, { source: 'by_region', metric: 'tyres' })
    const total = d.values.reduce((a, b) => a + b, 0)
    expect(total).toBe(3)
  })
})

// ── Saved layouts ────────────────────────────────────────────────────────────
describe('saved layouts', () => {
  it('saves, lists, reopens and deletes a named layout', () => {
    saveNamedDeck('Committee March', presetConfig('committee'))
    let all = listSavedDecks()
    expect(all.map((d) => d.name)).toContain('Committee March')
    expect(all[0].config.blocks.length).toBeGreaterThan(0)
    all = deleteNamedDeck('Committee March')
    expect(all.map((d) => d.name)).not.toContain('Committee March')
  })

  it('round trips the working layout through storage', () => {
    saveDeckLayout(presetConfig('board'))
    const back = loadDeckLayout()
    expect(back.blocks.map((b) => b.type)).toEqual(presetConfig('board').blocks.map((b) => b.type))
  })

  it('ignores a blank name rather than saving an unnamed layout', () => {
    const before = listSavedDecks().length
    saveNamedDeck('   ', presetConfig('board'))
    expect(listSavedDecks()).toHaveLength(before)
  })
})

// ── Renderer helpers ─────────────────────────────────────────────────────────
describe('renderer helpers', () => {
  it('normalises any colour form pptxgen has to accept', () => {
    expect(hex6('#4F46E5')).toBe('4F46E5')
    expect(hex6('4f46e5')).toBe('4F46E5')
    expect(hex6('#abc')).toBe('AABBCC')
    expect(hex6('rgb(15, 23, 42)')).toBe('0F172A')
    expect(hex6(null)).toBe('4F46E5')
  })

  it('builds a chart.js config the preview and the capture share', () => {
    const slide = resolveBlock(makeBlock('chart', { source: 'by_type' }), CTX)
    const cfg = slideChartConfig(slide, { paper: true, fontScale: 2 })
    expect(cfg.type).toBe('bar')
    expect(cfg.data.labels).toEqual(slide.labels)
    expect(cfg.data.datasets[0].data).toEqual(slide.values)
    const horiz = slideChartConfig({ ...slide, viz: 'bar_h' })
    expect(horiz.options.indexAxis).toBe('y')
    const dough = slideChartConfig({ ...slide, viz: 'doughnut' })
    expect(dough.type).toBe('doughnut')
    expect(dough.options.plugins.legend.display).toBe(true)
  })

  it('falls back to the figures when a chart cannot be drawn', () => {
    const slide = resolveBlock(makeBlock('chart', { source: 'by_disposition' }), CTX)
    const { head, body } = chartFallbackTable(slide)
    expect(head[0]).toBe('Group')
    expect(body).toHaveLength(slide.labels.length)
    expect(body[0][1]).toMatch(/^[\d,]+$/)
  })
})

// ── Real library renders (no mocks) ──────────────────────────────────────────
describe('the renderers produce real files against the REAL libraries', () => {
  it('renders a full committee deck to real PowerPoint bytes', async () => {
    const deck = buildDeck(presetConfig('committee'), CTX)
    const res = await renderDisposalDeckPptx({ deck, company: 'Green Concrete', country: 'KSA', save: false })
    expect(res.slides.length).toBe(deck.slides.length)
    expect(res.filename).toMatch(/\.pptx$/)
    // The filename helper strips every character outside [A-Za-z0-9 ()].
    expect(res.filename.replace(/\.pptx$/, '')).toMatch(/^[A-Za-z0-9 ()]+$/)
    // Ask pptxgenjs for the actual OOXML package: a stub that "builds" but
    // writes nothing would fail here.
    const buf = await res.pptx.write({ outputType: 'nodebuffer' })
    expect(buf.length).toBeGreaterThan(5000)
  }, 60000)

  it('renders a per asset dossier to real PDF bytes with a page per machine', async () => {
    const deck = buildDeck(presetConfig('dossier'), CTX)
    const res = await renderDisposalDeckPdf({ deck, company: 'Green Concrete', country: 'KSA', save: false })
    expect(res.filename).toMatch(/\.pdf$/)
    // title + kpis + one page per asset
    expect(res.pages).toBe(2 + ROWS.length)
    const bytes = res.doc.output('arraybuffer')
    expect(bytes.byteLength).toBeGreaterThan(3000)
  }, 60000)

  it('renders the register table through the REAL autoTable engine', async () => {
    // The jspdf-autotable peer break was invisible to every mocked test: this is
    // the assertion that catches it for the disposal deck.
    const deck = buildDeck(normalizeDeckConfig({ blocks: [makeBlock('table', { rowsPerSlide: 20 })] }), CTX)
    const res = await renderDisposalDeckPdf({ deck, save: false })
    expect(res.doc.lastAutoTable).toBeTruthy()
    expect(res.doc.lastAutoTable.finalY).toBeGreaterThan(0)
    expect(res.doc.output('arraybuffer').byteLength).toBeGreaterThan(1000)
  }, 60000)

  it('still writes a usable file when the register is empty', async () => {
    const empty = { rows: [], totals: null, currency: 'SAR', company: 'Green Concrete', country: 'KSA' }
    const deck = buildDeck(presetConfig('committee'), empty)
    const pptx = await renderDisposalDeckPptx({ deck, save: false })
    expect(pptx.slides.length).toBeGreaterThan(0)
    const pdf = await renderDisposalDeckPdf({ deck, save: false })
    expect(pdf.pages).toBeGreaterThan(0)
  }, 60000)

  it('accepts a raw config plus context instead of a prebuilt deck', async () => {
    const res = await renderDisposalDeckPdf({ config: presetConfig('board'), ctx: CTX, save: false })
    expect(res.pages).toBeGreaterThan(0)
  }, 60000)
})

// ── Catalog integrity ────────────────────────────────────────────────────────
describe('catalog integrity', () => {
  it('every KPI, chart source and table column is described and resolvable', () => {
    for (const k of Object.keys(KPI_ITEMS)) {
      expect(typeof KPI_ITEMS[k].label).toBe('string')
      expect(typeof KPI_ITEMS[k].get(TOTALS, ROWS, 'SAR')).toBe('string')
    }
    for (const k of CHART_SOURCE_KEYS) {
      const d = chartData(ROWS, { source: k })
      expect(Array.isArray(d.labels)).toBe(true)
      expect(d.labels.length).toBe(d.values.length)
    }
    for (const k of Object.keys(TABLE_COLUMNS)) {
      expect(typeof TABLE_COLUMNS[k].header).toBe('string')
      expect(typeof TABLE_COLUMNS[k].get(ROWS[0], 'SAR')).toBe('string')
    }
  })

  it('every block in the catalog carries a plain English description', () => {
    for (const k of DECK_BLOCK_KEYS) {
      expect(DECK_BLOCKS[k].label).toBeTruthy()
      expect(DECK_BLOCKS[k].description.length).toBeGreaterThan(20)
      expect(/[^\x20-\x7E]/.test(DECK_BLOCKS[k].description)).toBe(false)
    }
  })
})
