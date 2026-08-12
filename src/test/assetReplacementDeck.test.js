/**
 * The replacement slide in the Asset Disposal deck.
 *
 * This is the slide that turns "this machine has cost us a lot" into "this
 * machine has cost us N% of a new one", so the tests police the two ways it
 * could mislead the committee rather than just the happy path:
 *
 *   - without a supplier quotation it must SAY so in words. An empty table here
 *     would read as machines that cost nothing to replace,
 *   - with one, the exposure figure covers the PRICED machines only, and the
 *     unpriced count has to be on the same slide or a partial total reads as the
 *     cost of replacing the list,
 *   - a lapsed quotation is labelled and kept, never hidden and never presented
 *     as today's price,
 *   - and nothing outside plain ASCII can reach a slide, because the pptx and
 *     the pdf leave the building.
 */
import { describe, it, expect } from 'vitest'
import { shapeBenchmarks } from '../lib/assetReplacement'
import {
  DECK_BLOCKS, makeBlock, resolveBlock, buildDeck, presetConfig, normalizeDeckConfig,
  replacementView,
} from '../lib/assetDisposalDeck'

const NOW = new Date('2026-08-12T00:00:00Z')

const ROWS = [
  {
    asset_no: 'BP022', asset_type: 'GENERATOR', disposition: 'sell', status: 'approved',
    currency: 'SAR', spend: 61000, job_cards: 30, in_register: true, fleet_status: 'Inactive',
    serials: [], spend_by_year: { 2024: 20000, 2025: 31000, 2026: 10000 },
  },
  {
    asset_no: 'PU044', asset_type: 'PICKUP', disposition: 'sell', status: 'proposed',
    currency: 'SAR', spend: 90000, job_cards: 55, in_register: true, fleet_status: 'Inactive',
    serials: [],
  },
  {
    asset_no: 'CP001', asset_type: 'PUMPS', disposition: 'scrap', status: 'proposed',
    currency: 'SAR', spend: 1_400_000, job_cards: 210, in_register: true, fleet_status: 'Active',
    serials: [], spend_by_year: { 2024: 240000, 2025: 300000, 2026: 90000 },
  },
]

// The real quotation the owner supplied, plus a lapsed one for a second class so
// both statuses are exercised.
const RAW_BENCHMARKS = [
  {
    id: 'b1', country: 'KSA', asset_type: 'PUMPS',
    label: '47m truck mounted concrete pump', supplier: 'SANY', model: 'SYM5463THB 470C-10',
    unit_price: 1120000, vat_pct: 15, vat_amount: 168000, total_price: 1288000, currency: 'SAR',
    quote_ref: 'Q-2026-0724', quote_date: '2026-07-24', valid_until: '2026-08-10',
    warranty_note: '24 months or 4000 hours', source_file: 'SANY quotation.pdf', active: true,
  },
  {
    id: 'b2', country: 'KSA', asset_type: 'GENERATOR',
    label: '500 kVA generator', supplier: 'A Supplier',
    unit_price: 900000, vat_pct: 15, vat_amount: 135000, total_price: 1035000, currency: 'SAR',
    quote_date: '2026-06-01', valid_until: '2026-12-31', active: true,
  },
]

const BENCHMARKS = shapeBenchmarks(RAW_BENCHMARKS, { now: NOW.getTime() })
const CTX = { rows: ROWS, totals: null, currency: 'SAR', company: 'Green Concrete', country: 'KSA', now: NOW, benchmarks: BENCHMARKS }
const CTX_NO_QUOTE = { ...CTX, benchmarks: null }

const block = () => makeBlock('replacement')

describe('the replacement block', () => {
  it('is in the catalog with a plain English description', () => {
    expect(DECK_BLOCKS.replacement).toBeTruthy()
    expect(DECK_BLOCKS.replacement.description.length).toBeGreaterThan(20)
    expect(/[^\x20-\x7E]/.test(DECK_BLOCKS.replacement.description)).toBe(false)
  })

  it('resolves against the supplier quotations on file', () => {
    const s = resolveBlock(block(), CTX)
    expect(s.kind).toBe('replacement')
    expect(s.empty).toBe(false)
    expect(s.rows.length).toBe(2)                       // PUMPS and GENERATOR
    expect(s.rows.map((r) => r[0])).toEqual(['CP001', 'BP022'])  // worst share first
    // 1,400,000 spent against a 1,120,000 machine is 125%.
    expect(s.rows[0][4]).toBe('125.0%')
    expect(s.columns.map((c) => c.key)).toContain('replacement')
  })

  it('states the exposure and the machines it does NOT cover on the same slide', () => {
    const s = resolveBlock(block(), CTX)
    const text = s.headlines.map((h) => h.text).join(' ')
    expect(text).toMatch(/SAR 2,020,000/)               // 1,120,000 + 900,000, ex-VAT
    expect(text).toMatch(/ex-VAT/)
    // The bound has to travel with the figure, or a partial total reads as the
    // whole bill.
    const limit = s.headlines.find((h) => h.tone === 'limit')
    expect(limit.text).toMatch(/1 of 3 machines have no supplier quotation/i)
    expect(limit.text).toMatch(/PICKUP/)
    expect(s.caption).toMatch(/1 machines carry no quotation and are not listed here/)
  })

  it('says so in words when no quotation is on file, and draws no table', () => {
    const s = resolveBlock(block(), CTX_NO_QUOTE)
    expect(s.kind).toBe('text')
    expect(s.empty).toBe(true)
    expect(s.body).toMatch(/No supplier quotation is on file/i)
    expect(s.body).toMatch(/Nothing is estimated in its place/i)
    expect(s.rows).toBeUndefined()
  })

  it('says so when the filter leaves no machine, rather than blaming the quotations', () => {
    const s = resolveBlock(makeBlock('replacement', { filter: 'with_tyres' }), CTX)
    expect(s.kind).toBe('text')
    expect(s.body).toMatch(/nothing to price/i)
  })

  it('labels a lapsed quotation instead of hiding it or aging it out', () => {
    const s = resolveBlock(block(), CTX)
    const pump = s.rows.find((r) => r[0] === 'CP001')
    expect(pump[6]).toBe('Quotation lapsed')            // valid until 2026-08-10, now 2026-08-12
    expect(s.notes.join(' ')).toMatch(/lapsed/i)
    expect(s.notes.join(' ')).toMatch(/requote/i)
  })

  it('never assumes a service life, a depreciation rate or a resale value', () => {
    const s = resolveBlock(block(), CTX)
    // The notes DENY these things, so they are excluded from the sweep; nothing
    // the slide asserts as a figure may mention them.
    const asserted = JSON.stringify([s.headlines, s.columns, s.rows, s.caption]).toLowerCase()
    expect(asserted).not.toMatch(/depreciat|resale|residual|scrap value|salvage|per year of life|useful life/)
    expect(s.notes.join(' ')).toMatch(/No service life is assumed/i)
  })

  it('leaves the years-of-spend cell blank when no complete year is on record', () => {
    // PU044 carries no spend_by_year at all; a 0 there would read as a machine
    // that costs nothing to run.
    const rows = [{ ...ROWS[1], asset_type: 'PUMPS' }]
    const s = resolveBlock(block(), { ...CTX, rows })
    expect(s.rows[0][5]).toBe('')
  })

  it('returns null from replacementView when nothing can be priced', () => {
    expect(replacementView(ROWS, null, { now: NOW })).toBeNull()
    expect(replacementView([], BENCHMARKS, { now: NOW })).toBeNull()
  })

  it('rides in the board and CEO decks, and every string stays ASCII', () => {
    for (const key of ['board', 'ceo_briefing']) {
      const types = presetConfig(key).blocks.map((b) => b.type)
      expect(types).toContain('replacement')
      const deck = buildDeck(presetConfig(key), CTX)
      expect(deck.slides.some((s) => s.kind === 'replacement')).toBe(true)
      const walk = (v) => {
        if (typeof v === 'string') expect(/[^\x20-\x7E\n]/.test(v)).toBe(false)
        else if (Array.isArray(v)) v.forEach(walk)
        else if (v && typeof v === 'object') Object.values(v).forEach(walk)
      }
      walk(deck)
    }
  })

  it('a deck built with no benchmarks still builds, carrying the honest slide', () => {
    const deck = buildDeck(presetConfig('board'), CTX_NO_QUOTE)
    expect(deck.slides.length).toBeGreaterThan(0)
    const s = deck.slides.find((x) => /new machine costs|Spend against the cost/i.test(x.title || ''))
    expect(s.kind).toBe('text')
    expect(s.empty).toBe(true)
  })

  it('clamps a hand edited block back into range', () => {
    const cfg = normalizeDeckConfig({ blocks: [{ type: 'replacement', limit: 9999, filter: 'nonsense' }] })
    expect(cfg.blocks[0].limit).toBe(200)
    expect(cfg.blocks[0].filter).toBe('all')
  })
})
