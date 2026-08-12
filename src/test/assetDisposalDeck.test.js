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
  NOT_MEASURED, formatMetric, RELIABILITY_COLUMNS, RELIABILITY_KPI_ITEMS,
  RANKABLE_METRICS, RECOMMENDATION_PRIORITIES, AVAILABILITY_FLOOR, LONG_IDLE_DAYS,
  localFleetReliability, fleetReliabilityFor, reliabilityBasisNotes, reliabilityBasisLines,
  spendYearsOf, spendIn, latestFullYear, worstBy, sortReliabilityRows,
  fleetComparison, localRecommendations, recommendationsFor, hasReliability, readField,
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

// ── Reliability fixtures ─────────────────────────────────────────────────────
// Modelled on the live shape: a heavy machine whose recorded hours are mostly
// PARKED time, a healthy one, one that was never planned serviced, and one that
// carries no maintenance history at all so every figure must read Not measured.
const REL = {
  TM101: {
    job_cards: 120, dated_cards: 62, date_coverage_pct: 51.7,
    breakdown_hours: 3572, breakdown_hours_recorded: 12000,
    parked_cards: 2, parked_hours: 8428, longest_card_hours: 6200,
    failures: 88, dated_failures: 45,
    emergency_cards: 70, repair_cards: 46, preventive_cards: 4, preventive_share_pct: 3.3,
    first_seen: '2012-01-01', last_seen: '2025-06-01', observed_days: 4900, idle_days: 420,
    mtbf_days: 55.6, failures_per_year: 6.6, availability_pct: 76.4,
    cost_per_breakdown_hour: 134.38, cost_per_failure: 5454.55,
    spend_by_year: { 2019: 9592, 2023: 120000, 2024: 180000, 2025: 90000 },
  },
  BP022: {
    job_cards: 30, dated_cards: 30, date_coverage_pct: 100,
    breakdown_hours: 220, breakdown_hours_recorded: 220,
    parked_cards: 0, parked_hours: 0, longest_card_hours: 40,
    failures: 12, dated_failures: 12,
    emergency_cards: 6, repair_cards: 20, preventive_cards: 4, preventive_share_pct: 13.3,
    first_seen: '2017-02-01', last_seen: '2026-01-01', observed_days: 3200, idle_days: 20,
    mtbf_days: 266.7, failures_per_year: 1.4, availability_pct: 96.2,
    cost_per_breakdown_hour: 277.27, cost_per_failure: 5083.33,
    spend_by_year: { 2024: 20000, 2025: 31000, 2026: 10000 },
  },
  PU044: {
    job_cards: 55, dated_cards: 40, date_coverage_pct: 72.7,
    breakdown_hours: 900, breakdown_hours_recorded: 900,
    parked_cards: 0, parked_hours: 0, longest_card_hours: 120,
    failures: 40, dated_failures: 30,
    emergency_cards: 25, repair_cards: 30, preventive_cards: 0, preventive_share_pct: 0,
    first_seen: '2015-01-01', last_seen: '2025-09-01', observed_days: 3900, idle_days: 400,
    mtbf_days: 97.5, failures_per_year: 3.7, availability_pct: 88.1,
    cost_per_breakdown_hour: 100, cost_per_failure: 2250,
    spend_by_year: { 2023: 30000, 2024: 40000, 2025: 20000 },
  },
}
// TM192 deliberately gets NOTHING: no history at all is a real case on this list.
const REL_ROWS = ROWS.map((r) => (REL[r.asset_no] ? { ...r, ...REL[r.asset_no] } : { ...r, job_cards: null }))
const NO_HISTORY = REL_ROWS.find((r) => r.asset_no === 'TM192')

/** The live shape of get_asset_disposal_fleet_baseline. */
const BASELINE = {
  ok: true, country: 'KSA', idle_confound: true,
  note: 'Machines on the list are frequently parked.',
  on_list: {
    assets: 34, cards: 2026, failures: 1777, breakdown_hours: 121458,
    breakdown_hours_per_asset: 3572, preventive_share_pct: 4.1,
    avg_failures_per_year: 3.4, avg_availability_pct: 85.9,
    spend: 2260917, spend_per_asset: 68513,
  },
  rest_of_fleet: {
    assets: 969, cards: 60123, failures: 54046, breakdown_hours: 1153110,
    breakdown_hours_per_asset: 1190, preventive_share_pct: 1.6,
    avg_failures_per_year: 27.0, avg_availability_pct: 79.8,
    spend: 36064242, spend_per_asset: 37218,
  },
}

const NOW = new Date('2026-08-12T00:00:00Z')
const RCTX = { ...CTX, rows: REL_ROWS, fleetBaseline: BASELINE, now: NOW }
const EMPTY_CTX = { rows: [], totals: null, currency: 'SAR', company: 'Green Concrete', country: 'KSA', now: NOW }
const flatSlides = (res) => (res.kind === 'multi' ? res.slides : [res])

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

  it('renders the CEO briefing to real PowerPoint bytes', async () => {
    const deck = buildDeck(presetConfig('ceo_briefing'), RCTX)
    const res = await renderDisposalDeckPptx({ deck, company: 'Green Concrete', country: 'KSA', save: false })
    expect(res.slides.length).toBe(deck.slides.length)
    const buf = await res.pptx.write({ outputType: 'nodebuffer' })
    expect(buf.length).toBeGreaterThan(5000)
  }, 60000)

  it('renders the reliability case to real PDF bytes, tables through the REAL autoTable', async () => {
    const deck = buildDeck(presetConfig('reliability_case'), RCTX)
    const res = await renderDisposalDeckPdf({ deck, company: 'Green Concrete', country: 'KSA', save: false })
    expect(res.pages).toBe(deck.slides.length)
    expect(res.doc.lastAutoTable).toBeTruthy()
    expect(res.doc.lastAutoTable.finalY).toBeGreaterThan(0)
    expect(res.doc.output('arraybuffer').byteLength).toBeGreaterThan(5000)
  }, 60000)

  it('renders the comparison and recommendation slides through both real engines', async () => {
    const deck = buildDeck(normalizeDeckConfig({
      blocks: [makeBlock('fleet_comparison'), makeBlock('recommendations'), makeBlock('reliability_kpis')],
    }), RCTX)
    const pptx = await renderDisposalDeckPptx({ deck, save: false })
    expect((await pptx.pptx.write({ outputType: 'nodebuffer' })).length).toBeGreaterThan(5000)
    const pdf = await renderDisposalDeckPdf({ deck, save: false })
    expect(pdf.doc.output('arraybuffer').byteLength).toBeGreaterThan(3000)
  }, 60000)

  it('still writes a usable file when nothing on the list has any history', async () => {
    const bare = { ...RCTX, rows: [NO_HISTORY], fleetBaseline: null }
    const deck = buildDeck(presetConfig('reliability_case'), bare)
    const pptx = await renderDisposalDeckPptx({ deck, save: false })
    expect(pptx.slides.length).toBeGreaterThan(0)
    const pdf = await renderDisposalDeckPdf({ deck, save: false })
    expect(pdf.pages).toBeGreaterThan(0)
  }, 60000)
})

// ═════════════════════════════════════════════════════════════════════════════
// RELIABILITY
// ═════════════════════════════════════════════════════════════════════════════
describe('a figure nobody could measure prints Not measured, never zero', () => {
  it('formats every measured shape and refuses to invent one', () => {
    expect(formatMetric(null)).toBe(NOT_MEASURED)
    expect(formatMetric(undefined, 'dec1')).toBe(NOT_MEASURED)
    expect(formatMetric('', 'pct1')).toBe(NOT_MEASURED)
    expect(formatMetric(null, 'money', 'SAR')).toBe(NOT_MEASURED)
    expect(formatMetric(null, 'date')).toBe(NOT_MEASURED)
    // A real recorded zero is still a reading and must survive as one.
    expect(formatMetric(0)).toBe('0')
    expect(formatMetric(0, 'pct1')).toBe('0.0%')
    expect(formatMetric(12.55, 'dec1')).toBe('12.6')
    expect(formatMetric(3572, 'int')).toBe('3,572')
    expect(formatMetric(2260917, 'money', 'SAR')).toBe('SAR 2,260,917')
    expect(formatMetric(134.375, 'money2', 'SAR')).toBe('SAR 134.38')
    expect(formatMetric(3.02, 'ratio')).toBe('3.0x')
    expect(formatMetric('2025-06-01', 'date')).toBe('2025-06-01')
    expect(formatMetric('not a date', 'date')).toBe(NOT_MEASURED)
  })

  it('Not measured, N/A and Not valued stay three different statements', () => {
    // "no history to measure", "nobody filled the field in" and "nobody valued
    // it" are different problems with different fixes.
    expect(NOT_MEASURED).not.toBe('N/A')
    expect(NOT_MEASURED).not.toBe(NOT_VALUED)
    expect(fmtText('')).toBe('N/A')
  })

  it('reads a figure whether the page flattens it or nests it under reliability', () => {
    expect(readField({ breakdown_hours: 12 }, 'breakdown_hours')).toBe(12)
    expect(readField({ reliability: { breakdown_hours: 34 } }, 'breakdown_hours')).toBe(34)
    expect(hasReliability(NO_HISTORY)).toBe(false)
    expect(hasReliability(REL_ROWS.find((r) => r.asset_no === 'TM101'))).toBe(true)
  })
})

describe('the fleet reliability reading', () => {
  it('sums the rows and never averages a percentage of percentages', () => {
    const f = localFleetReliability(REL_ROWS)
    expect(f.job_cards).toBe(205)
    expect(f.dated_cards).toBe(132)
    // 132/205, not the mean of 51.7, 100 and 72.7.
    expect(f.date_coverage_pct).toBeCloseTo((132 / 205) * 100, 3)
    expect(f.breakdown_hours).toBe(4692)
    expect(f.parked_hours).toBe(8428)
    expect(f.failures).toBe(140)
  })

  it('counts only the machines that carry the measurement', () => {
    const f = fleetReliabilityFor(REL_ROWS)
    expect(f.availability_measured).toBe(3)
    expect(f.assets_with_history).toBe(3)
    // PU044 alone has zero planned services; TM192 has no cards so it cannot be
    // said to have never been serviced.
    expect(f.never_preventive).toBe(1)
    expect(f.long_idle).toBe(2)
  })

  it('returns null rather than zero when nothing can be measured', () => {
    const f = fleetReliabilityFor([NO_HISTORY])
    expect(f.breakdown_hours).toBeNull()
    expect(f.median_mtbf_days).toBeNull()
    expect(f.low_availability).toBeNull()
    expect(f.never_preventive).toBeNull()
    expect(f.long_idle).toBeNull()
  })
})

describe('the two caveats travel with every reliability slide', () => {
  it('states the parked exclusion with its own hours, derived not hard coded', () => {
    const notes = reliabilityBasisNotes(REL_ROWS).join(' ')
    expect(notes).toMatch(/parked/i)
    expect(notes).toContain('8,428')     // the parked hours, stated as their own fact
    expect(notes).toContain('4,692')     // breakdown hours WITHOUT them
    expect(notes).toMatch(/not repair time|never added in/i)
  })

  it('states what the dated half of the job cards supports', () => {
    const notes = reliabilityBasisNotes(REL_ROWS).join(' ')
    expect(notes).toMatch(/MTBF/)
    expect(notes).toMatch(/failures per year/i)
    expect(notes).toMatch(/idle days/i)
    expect(notes).toMatch(/availability/i)
    expect(notes).toMatch(/\d+\.\d%/)
  })

  it('softens by itself when the data no longer supports the claim', () => {
    const clean = REL_ROWS.map((r) => ({ ...r, parked_hours: 0, parked_cards: 0, dated_cards: r.job_cards }))
    const notes = reliabilityBasisNotes(clean).join(' ')
    expect(notes).toMatch(/No parked job cards were separated/i)
    expect(notes).toContain('100.0%')
  })

  it('the basis slide also states that nothing has been valued', () => {
    const lines = reliabilityBasisLines(REL_ROWS, 'SAR').join(' ')
    expect(lines).toMatch(/no recovery, resale or saving figure/i)
    expect(lines).toMatch(/nothing is projected/i)
  })
})

describe('reliability headline strip', () => {
  const slide = () => resolveBlock(makeBlock('reliability_kpis'), RCTX)

  it('states breakdown hours with the parked hours as their own tile', () => {
    const by = Object.fromEntries(slide().items.map((i) => [i.key, i]))
    expect(by.breakdown_hours.value).toBe('4,692')
    expect(by.breakdown_hours.note).toMatch(/8,428 parked hours/)
    expect(by.parked_hours.value).toBe('8,428')
    expect(by.parked_hours.note).toMatch(/never counted as repair time/i)
  })

  it('carries both caveats on the slide itself', () => {
    const s = slide()
    expect(s.notes.join(' ')).toMatch(/parked/i)
    expect(s.notes.join(' ')).toMatch(/usable date/i)
  })

  it('prints Not measured, flagged as such, when there is no history', () => {
    const s = resolveBlock(makeBlock('reliability_kpis'), { ...RCTX, rows: [NO_HISTORY] })
    expect(s.empty).toBe(true)
    const by = Object.fromEntries(s.items.map((i) => [i.key, i]))
    expect(by.median_mtbf.value).toBe(NOT_MEASURED)
    expect(by.median_mtbf.unmeasured).toBe(true)
    expect(by.low_availability.value).toBe(NOT_MEASURED)
  })

  it('every catalog tile resolves to a string for a fleet with nothing in it', () => {
    for (const k of Object.keys(RELIABILITY_KPI_ITEMS)) {
      const s = resolveBlock(makeBlock('reliability_kpis', { items: [k] }), EMPTY_CTX)
      expect(typeof s.items[0].value).toBe('string')
      expect(typeof s.items[0].note).toBe('string')
    }
  })
})

describe('reliability by machine', () => {
  it('prints every measure and sinks the machine with no history to the bottom', () => {
    const res = resolveBlock(makeBlock('reliability_table', { rowsPerSlide: 20 }), RCTX)
    const s = flatSlides(res)[0]
    const codes = s.rows.map((r) => r[0])
    expect(codes[0]).toBe('TM101')            // worst breakdown hours first
    expect(codes[codes.length - 1]).toBe('TM192') // unmeasured last, never as a zero
    const tm192 = s.rows.find((r) => r[0] === 'TM192')
    expect(tm192).toContain(NOT_MEASURED)
    expect(tm192).not.toContain('0')
  })

  it('carries both caveats and a caption naming what is shown', () => {
    const s = flatSlides(resolveBlock(makeBlock('reliability_table', { rowsPerSlide: 20 }), RCTX))[0]
    expect(s.notes.join(' ')).toMatch(/parked/i)
    expect(s.notes.join(' ')).toMatch(/usable date/i)
    expect(s.caption).toContain('Showing 4 of 4 machines')
  })

  it('bands cells against their peers and leaves an unmeasured cell unbanded', () => {
    const s = flatSlides(resolveBlock(makeBlock('reliability_table', { rowsPerSlide: 20, columns: ['asset_no', 'availability_pct'] }), RCTX))[0]
    expect(s.cellBands).toHaveLength(s.rows.length)
    const idx = s.rows.findIndex((r) => r[0] === 'TM192')
    expect(s.cellBands[idx][1]).toBe('')
    // The three measured machines are banded against each other.
    const banded = s.cellBands.filter((r) => r[1] !== '')
    expect(banded.length).toBeGreaterThan(0)
    for (const r of banded) expect(['good', 'watch', 'bad']).toContain(r[1])
  })

  it('paginates like the register table does', () => {
    const res = resolveBlock(makeBlock('reliability_table', { rowsPerSlide: 4 }), { ...RCTX, rows: [...REL_ROWS, ...REL_ROWS] })
    expect(res.kind).toBe('multi')
    expect(res.slides).toHaveLength(2)
    expect(res.slides[0].title).toContain('1 of 2')
  })

  it('sorts a text column alphabetically and a metric worst first', () => {
    expect(sortReliabilityRows(REL_ROWS, 'asset_no').map((r) => r.asset_no)).toEqual(['BP022', 'PU044', 'TM101', 'TM192'])
    expect(sortReliabilityRows(REL_ROWS, 'availability_pct').map((r) => r.asset_no)[0]).toBe('TM101')
  })
})

describe('worst offenders', () => {
  it('ranks on the chosen measure and shows what the figure rests on', () => {
    const s = resolveBlock(makeBlock('worst_offenders', { metric: 'breakdown_hours', limit: 5 }), RCTX)
    expect(s.kind).toBe('table')
    expect(s.rows[0][1]).toBe('TM101')
    expect(s.rows[0][3]).toBe('3,572')
    expect(s.rows[0][4]).toMatch(/88 failures/)
    expect(s.rows[0][4]).toMatch(/parked hrs excluded/)
  })

  it('knows which end of the scale is the bad one', () => {
    const s = resolveBlock(makeBlock('worst_offenders', { metric: 'availability_pct', limit: 5 }), RCTX)
    expect(s.rows[0][1]).toBe('TM101')   // 76.4%, the lowest
    expect(s.caption).toMatch(/^Lowest/)
  })

  it('leaves an unmeasured machine out rather than ranking it as zero', () => {
    const s = resolveBlock(makeBlock('worst_offenders', { metric: 'failures_per_year', limit: 10 }), RCTX)
    expect(s.rows.map((r) => r[1])).not.toContain('TM192')
    expect(s.caption).toContain('Measured on 3 of 4 machines')
    expect(s.caption).toMatch(/left out rather than ranked as zero/i)
  })

  it('says so instead of ranking nothing when the measure is absent', () => {
    const s = resolveBlock(makeBlock('worst_offenders', { metric: 'mtbf_days' }), { ...RCTX, rows: [NO_HISTORY] })
    expect(s.empty).toBe(true)
    expect(s.emptyNote).toMatch(/not measured on any machine/i)
  })

  it('only offers measures where one end of the scale is a verdict', () => {
    expect(RANKABLE_METRICS).toContain('breakdown_hours')
    expect(RANKABLE_METRICS).toContain('availability_pct')
    expect(RANKABLE_METRICS).not.toContain('first_seen')
    expect(RANKABLE_METRICS).not.toContain('asset_no')
    for (const k of RANKABLE_METRICS) {
      expect(worstBy(REL_ROWS, k, { limit: 3 }).length).toBeLessThanOrEqual(3)
    }
  })
})

describe('spend by year', () => {
  it('reads every year present and never counts the year in progress as full', () => {
    expect(spendYearsOf(REL_ROWS)).toEqual([2019, 2023, 2024, 2025, 2026])
    expect(latestFullYear(REL_ROWS, NOW)).toBe(2025)
    expect(spendIn(REL_ROWS.find((r) => r.asset_no === 'TM101'), 2025)).toBe(90000)
    expect(spendIn(NO_HISTORY, 2025)).toBeNull()
  })

  it('the fleet chart names the machines still absorbing money in the latest full year', () => {
    const s = resolveBlock(makeBlock('spend_trend', { scope: 'fleet', years: 0 }), RCTX)
    expect(s.kind).toBe('chart')
    expect(s.labels).toEqual(['2019', '2023', '2024', '2025', '2026'])
    expect(s.values[s.labels.indexOf('2025')]).toBe(141000)
    expect(s.note).toMatch(/3 of these machines were still absorbing money in 2025/)
    expect(s.note).toContain('SAR 141,000')
    expect(s.digest).toContain('Latest full year')
  })

  it('the per machine table orders by the latest full year and leaves a missing year blank', () => {
    const s = resolveBlock(makeBlock('spend_trend', { scope: 'per_asset', years: 0 }), RCTX)
    expect(s.kind).toBe('table')
    expect(s.rows[0][0]).toBe('TM101')          // SAR 90,000 in 2025, the most
    const bp = s.rows.find((r) => r[0] === 'BP022')
    const yearCols = s.columns.map((c) => c.key)
    // BP022 has no 2019 entry: that prints blank, NOT "SAR 0", because nothing
    // was booked rather than nothing being spent.
    expect(bp[yearCols.indexOf('y2019')]).toBe('')
    expect(s.caption).toMatch(/A blank year means nothing was booked, not a zero cost year/)
  })

  it('says so when no year by year spend exists at all', () => {
    const s = resolveBlock(makeBlock('spend_trend', { scope: 'fleet' }), { ...RCTX, rows: [NO_HISTORY] })
    expect(s.empty).toBe(true)
    expect(s.note).toMatch(/No completed year of spend/i)
  })
})

describe('emergency versus planned', () => {
  it('reads as a management finding and carries the rest of the fleet beside it', () => {
    const s = resolveBlock(makeBlock('maintenance_mix', { scope: 'fleet' }), RCTX)
    expect(s.kind).toBe('chart')
    expect(s.labels).toEqual(['Emergency', 'Repair', 'Planned service'])
    expect(s.values).toEqual([101, 96, 8])
    expect(s.note).toMatch(/1\.6%/)                        // the fleet's own share
    expect(s.note).toMatch(/management decision, not a disposal one/i)
  })

  it('drops the fleet comparison from the note when no baseline was supplied', () => {
    const s = resolveBlock(makeBlock('maintenance_mix', { scope: 'fleet' }), { ...RCTX, fleetBaseline: null })
    expect(s.note).not.toMatch(/1\.6%/)
    expect(s.note).toMatch(/management decision/i)
  })

  it('flags the machine that was never planned serviced', () => {
    const s = resolveBlock(makeBlock('maintenance_mix', { scope: 'per_asset' }), RCTX)
    const pu = s.rows.find((r) => r[0] === 'PU044')
    expect(pu[pu.length - 1]).toBe('NEVER PLANNED SERVICED')
    const tm192 = s.rows.find((r) => r[0] === 'TM192')
    expect(tm192).toContain(NOT_MEASURED)
    expect(tm192[tm192.length - 1]).toBe('')  // no history is not "never serviced"
  })
})

describe('this list against the rest of the fleet', () => {
  const slide = () => resolveBlock(makeBlock('fleet_comparison'), RCTX)

  it('says the write off is justified AND that it barely dents the bill', () => {
    const s = slide()
    expect(s.kind).toBe('comparison')
    const texts = s.headlines.map((h) => h.text)
    expect(texts[0]).toMatch(/justified/i)
    expect(texts[0]).toContain('SAR 68,513')
    expect(texts[0]).toContain('SAR 37,218')
    expect(texts[0]).toMatch(/3,572 breakdown hours per machine/)
    const limit = texts.find((t) => /barely dents the bill/i.test(t))
    expect(limit).toBeTruthy()
    expect(limit).toContain('SAR 2,260,917')
    expect(limit).toMatch(/969 machines stay in service/)
    expect(limit).toMatch(/79\.8% availability/)
    expect(limit).toMatch(/1\.6% planned maintenance/)
    // About 6% of the bill: the share is computed, not asserted as a constant.
    const share = Number(/about ([\d.]+)%/.exec(limit)[1])
    expect(share).toBeGreaterThan(4)
    expect(share).toBeLessThan(8)
  })

  it('names the measure to trust and flags the one idleness flatters', () => {
    const by = Object.fromEntries(slide().metrics.map((m) => [m.key, m]))
    expect(by.breakdown_hours_per_asset.trust).toBe(true)
    expect(by.breakdown_hours_per_asset.ratio).toBe('3.0x')
    expect(by.avg_failures_per_year.confounded).toBe(true)
    expect(by.spend_per_asset.ratio).toBe('1.8x')
  })

  it('states the confound and does not correct either figure', () => {
    const s = slide()
    expect(s.confound).toMatch(/park/i)
    expect(s.confound).toMatch(/cannot fail/i)
    expect(s.confound).toMatch(/breakdown hours per asset|breakdown hours per machine/i)
    expect(s.confound).toMatch(/(not|neither)[^.]{0,40}adjust/i)
    // Both figures are published exactly as supplied.
    const by = Object.fromEntries(s.metrics.map((m) => [m.key, m]))
    expect(by.avg_failures_per_year.onList).toBe('3.4')
    expect(by.avg_failures_per_year.rest).toBe('27.0')
  })

  it('says it could not be produced rather than guessing when no baseline arrives', () => {
    const s = resolveBlock(makeBlock('fleet_comparison'), { ...RCTX, fleetBaseline: null })
    expect(s.kind).toBe('text')
    expect(s.empty).toBe(true)
    expect(s.body).toMatch(/could not be produced/i)
    expect(s.body).toMatch(/not derivable from the disposal list alone/i)
    expect(fleetComparison(null)).toBeNull()
    expect(fleetComparison({ ok: false, reason: 'unavailable' })).toBeNull()
  })
})

describe('recommendations', () => {
  it('groups by priority and carries the figures each one rests on', () => {
    const res = resolveBlock(makeBlock('recommendations'), RCTX)
    const s = flatSlides(res)[0]
    expect(s.kind).toBe('recommendations')
    expect(s.count).toBeGreaterThan(0)
    for (const g of s.groups) {
      expect(RECOMMENDATION_PRIORITIES).toContain(g.priority)
      expect(g.label.length).toBeGreaterThan(0)
      for (const it of g.items) {
        expect(it.title.length).toBeGreaterThan(10)
        expect(Array.isArray(it.assets)).toBe(true)
        expect(`${it.detail} ${it.evidence.join(' ')}`.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('paginates rather than pushing a recommendation off the bottom of a slide', () => {
    const res = resolveBlock(makeBlock('recommendations', { perSlide: 1 }), RCTX)
    const slides = flatSlides(res)
    expect(slides.length).toBeGreaterThan(1)
    expect(slides[0].title).toContain('1 of')
    const shown = slides.reduce((a, s) => a + s.groups.reduce((b, g) => b + g.items.length, 0), 0)
    expect(shown).toBe(slides[0].count)
  })

  it('never quantifies a saving, a scrap value or a resale price', () => {
    const res = resolveBlock(makeBlock('recommendations'), RCTX)
    const text = flatSlides(res)
      .flatMap((s) => s.groups.flatMap((g) => g.items.flatMap((i) => [i.title, i.detail, ...i.evidence])))
      .join(' ')
    expect(text).not.toMatch(/scrap value|resale (price|value)|salvage|would (save|recover)|savings? of/i)
    expect(text).not.toMatch(/if disposed/i)
  })

  it('the local reading names its own evidence and stays on the same ladder', () => {
    const local = localRecommendations(REL_ROWS, TOTALS, { currency: 'SAR', now: NOW })
    expect(local.length).toBeGreaterThan(3)
    for (const r of local) {
      expect(RECOMMENDATION_PRIORITIES).toContain(r.priority)
      expect(r.detail.length).toBeGreaterThan(20)
    }
    const all = local.map((r) => `${r.title} ${r.detail}`).join(' ')
    expect(all).toMatch(/still absorbed money in 2025/)
    expect(all).toMatch(/never serviced to a schedule/)
    expect(all).toMatch(/no fleet register record/)
  })

  it('returns nothing at all for an empty list rather than a made up point', () => {
    expect(localRecommendations([], null)).toEqual([])
    expect(recommendationsFor([], null)).toEqual([])
    const s = resolveBlock(makeBlock('recommendations'), EMPTY_CTX)
    expect(s.empty).toBe(true)
    expect(s.groups).toEqual([])
  })
})

describe('the basis slide', () => {
  it('explains both caveats and the valuation gap in plain English', () => {
    const s = resolveBlock(makeBlock('basis'), RCTX)
    expect(s.kind).toBe('findings')
    const text = s.bullets.join(' ')
    expect(text).toMatch(/parked/i)
    expect(text).toMatch(/usable date/i)
    expect(text).toMatch(/has been valued|no recovery/i)
    expect(text).toMatch(/3 of 4 machines/)   // TM192 carries no history at all
  })

  it('says there is nothing to explain when the list is empty', () => {
    const s = resolveBlock(makeBlock('basis'), EMPTY_CTX)
    expect(s.empty).toBe(true)
  })
})

describe('the per machine dossier carries its reliability record', () => {
  it('shows the measures and the caveats they rest on', () => {
    const res = resolveBlock(makeBlock('asset_detail', { filter: 'scrap' }), RCTX)
    const s = res.slides.find((x) => x.assetNo === 'TM101')
    const by = Object.fromEntries(s.reliability.map((f) => [f.label, f.value]))
    expect(by['Breakdown hrs']).toBe('3,572')
    expect(by['MTBF days']).toBe('55.6')
    expect(by.Available).toBe('76.4%')
    expect(s.reliabilityNotes.join(' ')).toMatch(/exclude 8,428 hours on 2 parked job cards/)
    expect(s.reliabilityNotes.join(' ')).toMatch(/51\.7% of this machine's job cards/)
  })

  it('says a machine with no history cannot be measured, and shows no strip', () => {
    const res = resolveBlock(makeBlock('asset_detail', { filter: 'scrap' }), RCTX)
    const s = res.slides.find((x) => x.assetNo === 'TM192')
    expect(s.reliability).toEqual([])
    expect(s.reliabilityNote).toMatch(/no maintenance history/i)
  })

  it('can be turned off without breaking the slide', () => {
    const res = resolveBlock(makeBlock('asset_detail', { filter: 'scrap', showReliability: false }), RCTX)
    const s = res.slides.find((x) => x.assetNo === 'TM101')
    expect(s.reliability).toEqual([])
    expect(s.facts.length).toBeGreaterThan(0)
  })
})

describe('the reliability presets', () => {
  it('ships the CEO briefing and the reliability case', () => {
    expect(DECK_PRESET_KEYS).toEqual(expect.arrayContaining(['ceo_briefing', 'reliability_case']))
  })

  it('the CEO briefing carries the ask, the case and the basis', () => {
    const types = presetConfig('ceo_briefing').blocks.map((b) => b.type)
    expect(types).toEqual(expect.arrayContaining([
      'reliability_kpis', 'recommendations', 'fleet_comparison',
      'worst_offenders', 'spend_trend', 'maintenance_mix', 'basis',
    ]))
    const deck = buildDeck(presetConfig('ceo_briefing'), RCTX)
    expect(deck.slides.some((s) => s.kind === 'comparison')).toBe(true)
    expect(deck.slides.some((s) => s.kind === 'recommendations')).toBe(true)
    // A committee shown only the case, never the limit, takes the write off as
    // a fix for a problem it does not reach.
    const cmp = deck.slides.find((s) => s.kind === 'comparison')
    expect(cmp.headlines.some((h) => /justified/i.test(h.text))).toBe(true)
    expect(cmp.headlines.some((h) => /barely dents/i.test(h.text))).toBe(true)
  })

  it('the reliability case builds the full argument machine by machine', () => {
    const deck = buildDeck(presetConfig('reliability_case'), RCTX)
    expect(deck.slides.length).toBeGreaterThan(8)
    expect(deck.slides.filter((s) => s.kind === 'table').length).toBeGreaterThan(2)
  })

  it('every preset, old and new, still builds against a list with no reliability at all', () => {
    for (const key of DECK_PRESET_KEYS) {
      const deck = buildDeck(presetConfig(key), CTX)  // no reliability, no baseline
      expect(deck.slides.length).toBeGreaterThan(0)
      for (const s of deck.slides) expect(typeof s.kind).toBe('string')
    }
  })

  it('every new preset is plain ASCII end to end', () => {
    for (const key of ['ceo_briefing', 'reliability_case']) {
      const deck = buildDeck(presetConfig(key), RCTX)
      const walk = (v) => {
        if (typeof v === 'string') expect(/[^\x20-\x7E\n]/.test(v)).toBe(false)
        else if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v === 'object') Object.values(v).forEach(walk)
      }
      walk(deck)
    }
  })

  it('no reliability slide anywhere quotes a value nobody produced', () => {
    const deck = buildDeck(presetConfig('reliability_case'), RCTX)
    const text = JSON.stringify(deck)
    expect(text).not.toMatch(/scrap value|salvage value|resale price|written down value/i)
    // Every valuation slot still refuses to print a number.
    const dossier = buildDeck(presetConfig('dossier'), RCTX)
    for (const s of dossier.slides.filter((x) => x.kind === 'asset')) {
      const by = Object.fromEntries(s.facts.map((f) => [f.label, f.value]))
      expect(by['Estimated value']).toBe(NOT_VALUED)
      expect(by['Sale proceeds']).toBe(NOT_VALUED)
    }
  })
})

describe('an empty fleet says so on every new slide', () => {
  it('marks each reliability block empty with a reason and never a zero', () => {
    for (const type of ['reliability_kpis', 'reliability_table', 'worst_offenders', 'spend_trend', 'maintenance_mix', 'recommendations', 'basis']) {
      for (const s of flatSlides(resolveBlock(makeBlock(type), EMPTY_CTX))) {
        expect(s.empty).toBe(true)
        expect(String(s.emptyNote || s.body || '').length).toBeGreaterThan(10)
      }
    }
  })

  it('the comparison slide is the one that still renders, because it is not about the list', () => {
    const s = resolveBlock(makeBlock('fleet_comparison'), { ...EMPTY_CTX, fleetBaseline: BASELINE })
    expect(s.kind).toBe('comparison')
    expect(s.metrics.length).toBeGreaterThan(0)
  })
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
