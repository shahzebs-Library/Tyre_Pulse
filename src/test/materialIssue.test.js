import { describe, it, expect } from 'vitest'
import {
  DOC_TYPES, DOC_TYPE_KEYS, docTypeLabel, isReturn,
  parseIssueNumber, docTypeOf,
  bookedValue, signedValue, returnBookedPositive,
  groupLinesIntoSlips, countUnslipped, bucketTotals,
  summarizeIssues, filterSlips, slipFilterOptions,
  monthlyIssueTrend,
  SLIP_EXPORT_COLUMNS, slipExportRows, LINE_EXPORT_COLUMNS, lineExportRows,
  draftLineValue, validateDraftIssue, issueStatusLabel, ISSUE_STATUSES,
} from '../lib/materialIssue'

/**
 * These cases are the MEASURED shapes from the live data, not invented ones:
 * the six real document prefixes, the 1:1 slip-to-job-card rule, the
 * positive-booked MRT anomaly, and the three currencies that must never be
 * added together.
 */

// One expense line, shaped exactly like a parts_consumption row.
const line = (over = {}) => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  issue_number: 'GC/MIS/0547/1125',
  work_order_no: 'GCKR/JC/0100/1125',
  event_date: '2025-11-04',
  asset_code: 'TM514',
  asset_description: 'TRANSIT MIXER',
  site: 'NHC',
  store_code: 'NHC-ST',
  item_code: '310504-O',
  item_description: 'TIRE 315/80 R22.5',
  qty: 2,
  unit_cost: 900,
  line_cost: 1800,
  tyre_cost: 1800,
  spare_cost: 0,
  oil_cost: 0,
  currency: 'SAR',
  country: 'KSA',
  ...over,
})

describe('parseIssueNumber - the six real document prefixes', () => {
  // Every prefix measured live: KSA GC + AFRK, Egypt GCEG + AFEG, UAE GC,
  // and the MRT return variant of GC and AFRK.
  const cases = [
    ['GC/MIS/0547/1125', { entity: 'GC', docType: 'MIS', seq: 547, docMonth: '2025-11' }],
    ['AFRK/MIS/0012/0326', { entity: 'AFRK', docType: 'MIS', seq: 12, docMonth: '2026-03' }],
    ['GC/MRT/0004/1225', { entity: 'GC', docType: 'MRT', seq: 4, docMonth: '2025-12' }],
    ['AFRK/MRT/0099/0125', { entity: 'AFRK', docType: 'MRT', seq: 99, docMonth: '2025-01' }],
    ['GCEG/MIS/1234/0724', { entity: 'GCEG', docType: 'MIS', seq: 1234, docMonth: '2024-07' }],
    ['AFEG/MIS/0001/1219', { entity: 'AFEG', docType: 'MIS', seq: 1, docMonth: '2019-12' }],
  ]

  it.each(cases)('reads %s', (input, expected) => {
    expect(parseIssueNumber(input)).toMatchObject(expected)
  })

  it('keeps the sequence text so a leading zero is not lost', () => {
    expect(parseIssueNumber('GC/MIS/0004/1125').seqText).toBe('0004')
  })

  it('reads the trailing block as MMYY, not YYMM', () => {
    // 1125 is November 2025. Read the other way it would be month 25.
    expect(parseIssueNumber('GC/MIS/0547/1125').docMonth).toBe('2025-11')
  })

  it('tolerates lower case and stray spacing', () => {
    expect(parseIssueNumber(' gc/mis/0547/1125 ')).toMatchObject({ docType: 'MIS', entity: 'GC' })
  })
})

describe('parseIssueNumber - unparseable returns null, never a guess', () => {
  const bad = [
    ['', 'blank'],
    [null, 'null'],
    [undefined, 'undefined'],
    ['GC-MIS-0547-1125', 'wrong separators'],
    ['GC/MIS/0547', 'no period block'],
    ['GC/MIS/0547/112', 'short period block'],
    ['GC/GRN/0547/1125', 'a document type we do not know'],
    ['GC/MIS/ABCD/1125', 'non-numeric sequence'],
    ['GC/MIS/0547/2511', 'month 25 does not exist, so this is not MMYY'],
    ['GC/MIS/0547/0025', 'month 00 does not exist'],
    ['just some text', 'not a slip number at all'],
  ]

  it.each(bad)('%s (%s) returns null', (input) => {
    expect(parseIssueNumber(input)).toBeNull()
  })

  it('never coerces an unreadable number into a document type', () => {
    expect(docTypeOf('GC/GRN/0547/1125')).toBeNull()
    // ...and an unreadable number is NOT treated as a return.
    expect(isReturn(docTypeOf('GC/GRN/0547/1125'))).toBe(false)
  })
})

describe('document types', () => {
  it('exposes exactly MIS and MRT', () => {
    expect(DOC_TYPE_KEYS).toEqual(['MIS', 'MRT'])
    expect(DOC_TYPES.find((d) => d.key === 'MRT').credits).toBe(true)
    expect(DOC_TYPES.find((d) => d.key === 'MIS').credits).toBe(false)
  })

  it('labels an unknown type honestly rather than folding it into an issue', () => {
    expect(docTypeLabel('MIS')).toBe('Material issue')
    expect(docTypeLabel('MRT')).toBe('Material return')
    expect(docTypeLabel('GRN')).toBe('Unknown document')
    expect(docTypeLabel(null)).toBe('Unknown document')
  })

  it('only MRT is a return', () => {
    expect(isReturn('MRT')).toBe(true)
    expect(isReturn('mrt')).toBe(true)
    expect(isReturn('MIS')).toBe(false)
    expect(isReturn(null)).toBe(false)
  })
})

describe('the return sign - the one place it is decided', () => {
  it('a MIS keeps its booked amount', () => {
    expect(signedValue({ line_cost: 1800 }, 'MIS')).toBe(1800)
  })

  it('a MRT credits, whatever sign the row is stored with', () => {
    // Live data books every MRT line POSITIVE, so this is the case that matters.
    expect(signedValue({ line_cost: 526760.2 }, 'MRT')).toBe(-526760.2)
    // Already negative stays negative - applying the rule twice cannot flip it
    // back into a charge.
    expect(signedValue({ line_cost: -100 }, 'MRT')).toBe(-100)
    expect(signedValue(signedValue({ line_cost: 100 }, 'MRT'), 'MRT')).toBe(-100)
  })

  it('bookedValue reports what the ledger holds and never applies the credit', () => {
    // This is what keeps the register agreeing with Expenses and CPK.
    expect(bookedValue({ line_cost: 526760.2 })).toBe(526760.2)
  })

  it('a non-finite amount reads as 0, never NaN', () => {
    expect(bookedValue({ line_cost: 'abc' })).toBe(0)
    expect(signedValue({}, 'MRT')).toBe(-0)
  })

  it('flags a return booked as a charge - the live integrity finding', () => {
    expect(returnBookedPositive({ docType: 'MRT', bookedValue: 47175.94 })).toBe(true)
    expect(returnBookedPositive({ docType: 'MRT', bookedValue: -47175.94 })).toBe(false)
    expect(returnBookedPositive({ docType: 'MIS', bookedValue: 1800 })).toBe(false)
  })
})

describe('groupLinesIntoSlips', () => {
  it('folds lines into one slip per document', () => {
    const slips = groupLinesIntoSlips([
      line({ id: '1', line_cost: 1800 }),
      line({ id: '2', line_cost: 200, item_code: '450115-O', tyre_cost: 0, spare_cost: 200 }),
    ])
    expect(slips).toHaveLength(1)
    expect(slips[0].lineCount).toBe(2)
    expect(slips[0].bookedValue).toBe(2000)
    expect(slips[0].workOrderNo).toBe('GCKR/JC/0100/1125')
    expect(slips[0].workOrderCount).toBe(1)
    expect(slips[0].linkedToJobCard).toBe(true)
  })

  it('IDENTIFIES A SLIP BY COUNTRY PLUS NUMBER, never the number alone', () => {
    // GC/MIS is issued by BOTH KSA and UAE. Keying on the number would merge
    // two countries' documents into one - the cross-boundary merge this repo
    // has hardened the expense identity and the material master against.
    const slips = groupLinesIntoSlips([
      line({ id: '1', country: 'KSA', currency: 'SAR', line_cost: 100 }),
      line({ id: '2', country: 'UAE', currency: 'AED', line_cost: 100 }),
    ])
    expect(slips).toHaveLength(2)
    expect(slips.map((s) => s.country).sort()).toEqual(['KSA', 'UAE'])
    expect(slips.every((s) => s.bookedValue === 100)).toBe(true)
  })

  it('takes the EARLIEST line date as the document date', () => {
    const slips = groupLinesIntoSlips([
      line({ id: '1', event_date: '2025-11-09' }),
      line({ id: '2', event_date: '2025-11-04' }),
    ])
    expect(slips[0].date).toBe('2025-11-04')
    expect(slips[0].month).toBe('2025-11')
  })

  it('carries the document type and period read from the number', () => {
    const [s] = groupLinesIntoSlips([line({ issue_number: 'GC/MRT/0004/1225' })])
    expect(s.docType).toBe('MRT')
    expect(s.docTypeKnown).toBe(true)
    expect(s.docMonth).toBe('2025-12')
    expect(s.creditedValue).toBe(-1800)
    expect(s.bookedValue).toBe(1800)
    expect(s.returnSignAnomaly).toBe(true)
  })

  it('marks an unreadable number as unknown rather than assuming an issue', () => {
    const [s] = groupLinesIntoSlips([line({ issue_number: 'GC/GRN/0001/1125' })])
    expect(s.docTypeKnown).toBe(false)
    expect(s.docType).toBeNull()
    // An unknown document is not credited.
    expect(s.creditedValue).toBe(s.bookedValue)
  })

  it('skips lines with no slip number and counts them separately', () => {
    const rows = [line({ id: '1' }), line({ id: '2', issue_number: null })]
    expect(groupLinesIntoSlips(rows)).toHaveLength(1)
    expect(countUnslipped(rows)).toBe(1)
  })

  it('surfaces a slip that contradicts the measured 1:1 job-card rule', () => {
    const slips = groupLinesIntoSlips([
      line({ id: '1', work_order_no: 'JC-1' }),
      line({ id: '2', work_order_no: 'JC-2' }),
    ])
    expect(slips[0].workOrderCount).toBe(2)
  })

  it('flags a slip whose own lines disagree on currency', () => {
    const slips = groupLinesIntoSlips([
      line({ id: '1', currency: 'SAR' }),
      line({ id: '2', currency: 'AED' }),
    ])
    expect(slips[0].mixedCurrency).toBe(true)
    expect(slips[0].currency).toBe('MIXED')
  })

  it('handles junk input without throwing', () => {
    expect(groupLinesIntoSlips()).toEqual([])
    expect(groupLinesIntoSlips(null)).toEqual([])
    expect(countUnslipped(null)).toBe(0)
  })
})

describe('summarizeIssues - money is NEVER blended', () => {
  const mixedScope = groupLinesIntoSlips([
    line({ id: '1', country: 'KSA', currency: 'SAR', line_cost: 1000, issue_number: 'GC/MIS/0001/1125' }),
    line({ id: '2', country: 'UAE', currency: 'AED', line_cost: 500, issue_number: 'GC/MIS/0002/1125' }),
    line({ id: '3', country: 'Egypt', currency: 'EGP', line_cost: 900, issue_number: 'GCEG/MIS/0003/1125' }),
  ])

  it('exposes NO cross-country scalar total at all', () => {
    const s = summarizeIssues(mixedScope, { now: '2026-08-24' })
    // By construction: there is no `value`/`total` field a template could
    // render as one blended number.
    expect(s.value).toBeUndefined()
    expect(s.total).toBeUndefined()
    expect(s.bookedValue).toBeUndefined()
  })

  it('reports money per currency and flags the mix', () => {
    const s = summarizeIssues(mixedScope, { now: '2026-08-24' })
    expect(s.mixedCurrency).toBe(true)
    expect(Object.keys(s.byCurrency).sort()).toEqual(['AED', 'EGP', 'SAR'])
    expect(s.byCurrency.SAR.bookedValue).toBe(1000)
    expect(s.byCurrency.AED.bookedValue).toBe(500)
    expect(s.byCurrency.EGP.bookedValue).toBe(900)
    // 1000 + 500 + 900 = 2400 must appear NOWHERE.
    const flat = JSON.stringify(s)
    expect(flat).not.toContain('2400')
  })

  it('a single-country scope is not flagged as mixed', () => {
    const s = summarizeIssues(groupLinesIntoSlips([line({ line_cost: 1000 })]), { now: '2026-08-24' })
    expect(s.mixedCurrency).toBe(false)
    expect(s.byCurrency.SAR.bookedValue).toBe(1000)
  })

  it('excludes a mixed-currency slip from the money map rather than picking one', () => {
    const slips = groupLinesIntoSlips([
      line({ id: '1', currency: 'SAR', line_cost: 100 }),
      line({ id: '2', currency: 'AED', line_cost: 100 }),
    ])
    const s = summarizeIssues(slips, { now: '2026-08-24' })
    expect(s.mixedCurrencySlips).toBe(1)
    expect(Object.keys(s.byCurrency)).toEqual([])
  })

  it('carries the per-country currency onto each country block', () => {
    const s = summarizeIssues(mixedScope, { now: '2026-08-24' })
    const byName = Object.fromEntries(s.byCountry.map((c) => [c.country, c.currency]))
    expect(byName).toEqual({ KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' })
  })
})

describe('summarizeIssues - counts, linkage and the return anomaly', () => {
  const slips = groupLinesIntoSlips([
    line({ id: '1', issue_number: 'GC/MIS/0001/1125', line_cost: 100 }),
    line({ id: '2', issue_number: 'GC/MIS/0001/1125', line_cost: 100 }),
    line({ id: '3', issue_number: 'GC/MIS/0002/1125', line_cost: 50, work_order_no: null }),
    line({ id: '4', issue_number: 'GC/MRT/0003/1125', line_cost: 40 }),
  ])

  it('counts slips, lines and the document split', () => {
    const s = summarizeIssues(slips, { now: '2026-08-24' })
    expect(s.slips).toBe(3)
    expect(s.lines).toBe(4)
    expect(s.docTypeSplit).toEqual({ MIS: 2, MRT: 1, unknown: 0 })
  })

  it('reports the job-card linkage rate', () => {
    const s = summarizeIssues(slips, { now: '2026-08-24' })
    // Two of three slips name a job card.
    expect(s.linkedSlips).toBe(2)
    expect(s.linkageRate).toBeCloseTo(2 / 3, 10)
  })

  it('linkage rate is 1 when every slip names a job card - the measured live rule', () => {
    const linked = groupLinesIntoSlips([
      line({ id: '1', issue_number: 'GC/MIS/0001/1125' }),
      line({ id: '2', issue_number: 'GC/MIS/0002/1125' }),
    ])
    expect(summarizeIssues(linked, { now: '2026-08-24' }).linkageRate).toBe(1)
  })

  it('returns null - not zero - for an unmeasurable rate', () => {
    const s = summarizeIssues([], { now: '2026-08-24' })
    expect(s.linkageRate).toBeNull()
    expect(s.avgLinesPerSlip).toBeNull()
    expect(s.latestDate).toBeNull()
    expect(s.daysSinceLastSlip).toBeNull()
    expect(s.slips).toBe(0)
  })

  it('counts returns booked as a charge, per country and overall', () => {
    const s = summarizeIssues(slips, { now: '2026-08-24' })
    expect(s.returnSignAnomalies).toBe(1)
    expect(s.byCountry[0].returnSignAnomalies).toBe(1)
    // Booked and credited diverge by exactly twice the return, and both are
    // published so the gap is visible rather than silently applied.
    expect(s.byCountry[0].bookedValue).toBe(290)
    expect(s.byCountry[0].creditedValue).toBe(290 - 80)
  })

  it('uses the explicit `now`, never the clock', () => {
    const a = summarizeIssues(slips, { now: '2026-08-24' })
    const b = summarizeIssues(slips, { now: '2026-08-24' })
    expect(a.generatedAt).toBe('2026-08-24')
    expect(a.daysSinceLastSlip).toBe(b.daysSinceLastSlip)
    // 2025-11-04 to 2026-08-24
    expect(a.daysSinceLastSlip).toBe(293)
  })

  it('rolls up top stores and items', () => {
    const s = summarizeIssues(slips, { now: '2026-08-24' })
    expect(s.byCountry[0].topStores[0].key).toBe('NHC-ST')
    expect(s.byCountry[0].topItems[0].key).toBe('310504-O')
  })
})

describe('bucketTotals - reuses the existing split, never a second bucketing', () => {
  it('sums the split columns the classify trigger already stamped', () => {
    expect(bucketTotals([
      { tyre_cost: 1800, spare_cost: 0, oil_cost: 0 },
      { tyre_cost: 0, spare_cost: 200, oil_cost: 50 },
    ])).toEqual({ tyre: 1800, spare: 200, oil: 50 })
  })

  it('falls back to the material-master mapper for an in-app line with no split', () => {
    expect(bucketTotals([
      { category: 'lubricant', line_cost: 300 },
      { category: 'tyre', line_cost: 900 },
      { category: 'filter', line_cost: 100 },
    ])).toEqual({ tyre: 900, spare: 100, oil: 300 })
  })

  it('handles junk without throwing', () => {
    expect(bucketTotals()).toEqual({ tyre: 0, spare: 0, oil: 0 })
  })
})

describe('filterSlips', () => {
  const slips = groupLinesIntoSlips([
    line({ id: '1', issue_number: 'GC/MIS/0001/1125', event_date: '2025-11-04', site: 'NHC', store_code: 'NHC-ST' }),
    line({ id: '2', issue_number: 'GC/MRT/0002/1225', event_date: '2025-12-10', site: 'JED', store_code: 'JED-ST' }),
    line({ id: '3', issue_number: 'GC/GRN/0003/1225', event_date: '2025-12-11', site: 'JED', store_code: 'JED-ST' }),
  ])

  it('no filters means everything', () => {
    expect(filterSlips(slips, {})).toHaveLength(3)
    expect(filterSlips(slips, { site: 'All', docType: 'All' })).toHaveLength(3)
  })

  it('filters by document type, and unknown is its own choice', () => {
    expect(filterSlips(slips, { docType: 'MIS' })).toHaveLength(1)
    expect(filterSlips(slips, { docType: 'MRT' })).toHaveLength(1)
    expect(filterSlips(slips, { docType: 'UNKNOWN' })).toHaveLength(1)
  })

  it('filters by site, store and date window', () => {
    expect(filterSlips(slips, { site: 'JED' })).toHaveLength(2)
    expect(filterSlips(slips, { store: 'NHC-ST' })).toHaveLength(1)
    expect(filterSlips(slips, { from: '2025-12-01' })).toHaveLength(2)
    expect(filterSlips(slips, { to: '2025-11-30' })).toHaveLength(1)
  })

  it('searches the slip number, job card and asset', () => {
    expect(filterSlips(slips, { search: '0002' })).toHaveLength(1)
    expect(filterSlips(slips, { search: 'tm514' })).toHaveLength(3)
    expect(filterSlips(slips, { search: 'nothing here' })).toHaveLength(0)
  })

  it('can isolate the return-sign anomalies', () => {
    expect(filterSlips(slips, { anomaliesOnly: true })).toHaveLength(1)
  })

  it('offers only the filter values present on screen', () => {
    const opts = slipFilterOptions(slips)
    expect(opts.sites).toEqual(['JED', 'NHC'])
    expect(opts.stores).toEqual(['JED-ST', 'NHC-ST'])
    expect(opts.countries).toEqual(['KSA'])
  })
})

describe('monthlyIssueTrend', () => {
  it('buckets by month and counts the document split', () => {
    const slips = groupLinesIntoSlips([
      line({ id: '1', issue_number: 'GC/MIS/0001/1125', event_date: '2025-11-04', line_cost: 100 }),
      line({ id: '2', issue_number: 'GC/MRT/0002/1125', event_date: '2025-11-20', line_cost: 40 }),
      line({ id: '3', issue_number: 'GC/MIS/0003/1225', event_date: '2025-12-01', line_cost: 60 }),
    ])
    const trend = monthlyIssueTrend(slips)
    expect(trend.map((t) => t.month)).toEqual(['2025-11', '2025-12'])
    expect(trend[0]).toMatchObject({ slips: 2, mis: 1, mrt: 1, value: 140, currency: 'SAR' })
  })

  it('a month spanning two currencies reports null, never a blend', () => {
    const slips = groupLinesIntoSlips([
      line({ id: '1', issue_number: 'GC/MIS/0001/1125', country: 'KSA', currency: 'SAR', line_cost: 100 }),
      line({ id: '2', issue_number: 'GC/MIS/0002/1125', country: 'UAE', currency: 'AED', line_cost: 500 }),
    ])
    const [m] = monthlyIssueTrend(slips)
    expect(m.slips).toBe(2)        // a count is still a real quantity
    expect(m.value).toBeNull()     // the money is not
    expect(m.currency).toBe('MIXED')
  })
})

describe('export projections', () => {
  it('every declared column is produced by the row builder', () => {
    const slips = groupLinesIntoSlips([line()])
    const [row] = slipExportRows(slips)
    for (const c of SLIP_EXPORT_COLUMNS) expect(row).toHaveProperty(c.key)
    expect(Object.keys(row).sort()).toEqual(SLIP_EXPORT_COLUMNS.map((c) => c.key).sort())
  })

  it('blank renders as N/A, never an empty cell or a dash', () => {
    const slips = groupLinesIntoSlips([line({ site: null, store_code: null, asset_code: null })])
    const [row] = slipExportRows(slips)
    expect(row.site).toBe('N/A')
    expect(row.store_code).toBe('N/A')
    expect(row.asset_code).toBe('N/A')
    expect(JSON.stringify(row)).not.toMatch(/[\u2013\u2014]/)
  })

  it('labels a return booked as a charge in the export flag column', () => {
    const slips = groupLinesIntoSlips([line({ issue_number: 'GC/MRT/0004/1225' })])
    expect(slipExportRows(slips)[0].flag).toBe('Return booked as a charge')
  })

  it('carries both the booked and the credited amount', () => {
    const slips = groupLinesIntoSlips([line({ issue_number: 'GC/MRT/0004/1225', line_cost: 500 })])
    const [row] = slipExportRows(slips)
    expect(row.booked_value).toBe(500)
    expect(row.credited_value).toBe(-500)
  })

  it('line export declares and produces the same keys', () => {
    const [row] = lineExportRows([line({ unit_cost: null })])
    for (const c of LINE_EXPORT_COLUMNS) expect(row).toHaveProperty(c.key)
    expect(row.unit_cost).toBe('N/A')
  })
})

describe('raising a slip in app', () => {
  it('a line with no price has NO value, rather than a value of zero', () => {
    expect(draftLineValue({ qty: 2, unit_cost: 900 })).toBe(1800)
    expect(draftLineValue({ qty: 2 })).toBeNull()
    expect(draftLineValue({ unit_cost: 900 })).toBeNull()
    expect(draftLineValue({})).toBeNull()
  })

  it('accepts a complete draft', () => {
    const r = validateDraftIssue(
      { country: 'KSA', work_order_no: 'JC-1', doc_type: 'MIS' },
      [{ item_code: 'A', qty: 2, unit_cost: 100 }],
    )
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.total).toBe(200)
    expect(r.lineCount).toBe(1)
  })

  it('reports every problem at once, not just the first', () => {
    const r = validateDraftIssue({}, [])
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThan(2)
    expect(r.errors.some((e) => e.includes('country'))).toBe(true)
    expect(r.errors.some((e) => e.includes('job card'))).toBe(true)
    expect(r.errors.some((e) => e.includes('item'))).toBe(true)
  })

  it('withholds the total when any line is unpriced', () => {
    const r = validateDraftIssue(
      { country: 'KSA', work_order_no: 'JC-1' },
      [{ item_code: 'A', qty: 2, unit_cost: 100 }, { item_code: 'B', qty: 1 }],
    )
    expect(r.ok).toBe(true)
    expect(r.total).toBeNull()        // an incomplete total is not a total
    expect(r.pricedTotal).toBe(200)   // what IS priced, stated separately
    expect(r.unpricedLines).toBe(1)
  })

  it('rejects a negative unit cost, mirroring the database CHECK', () => {
    const r = validateDraftIssue(
      { country: 'KSA', work_order_no: 'JC-1' },
      [{ item_code: 'A', qty: 1, unit_cost: -10 }],
    )
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('cannot be negative'))).toBe(true)
  })

  it('a return still records a POSITIVE quantity - the sign is the document type', () => {
    const r = validateDraftIssue(
      { country: 'KSA', work_order_no: 'JC-1', doc_type: 'MRT' },
      [{ item_code: 'A', qty: 2, unit_cost: 100 }],
    )
    expect(r.ok).toBe(true)
    expect(r.total).toBe(200)
  })

  it('rejects a zero or missing quantity', () => {
    const r = validateDraftIssue(
      { country: 'KSA', work_order_no: 'JC-1' },
      [{ item_code: 'A', qty: 0, unit_cost: 10 }],
    )
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes('quantity'))).toBe(true)
  })

  it('labels statuses honestly', () => {
    expect(ISSUE_STATUSES).toEqual(['draft', 'issued', 'cancelled'])
    expect(issueStatusLabel('issued')).toBe('Issued')
    expect(issueStatusLabel('nonsense')).toBe('Unknown')
  })
})

/* ------------------------------------------------------------------ *
 * Page render smoke test                                              *
 *                                                                     *
 * A clean `vite build` does NOT prove this page compiles: it is lazy  *
 * routed, so an unimported page is tree-shaken out entirely. This     *
 * repo has shipped a ReferenceError past a clean build twice (a       *
 * renamed lucide icon, a missing component import), and both times    *
 * the whole page went down. Mounting the REAL page and clicking every *
 * tab is what catches that class.                                     *
 * ------------------------------------------------------------------ */
import { vi, beforeEach } from 'vitest'
import { createElement as h } from 'react'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Contexts and services are mocked; the REAL page, the REAL engine and the real
// export/format helpers run, so a render throw on ANY tab surfaces here.
vi.mock('../contexts/SettingsContext', () => ({
  useSettings: () => ({ activeCountry: 'KSA', activeCurrency: 'SAR' }),
  COUNTRIES: ['KSA', 'UAE', 'Egypt'],
}))
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k, d) => (typeof d === 'string' ? d : k), language: 'en', dir: 'ltr' }),
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { role: 'Admin' }, isSuperAdmin: false }),
}))
// echarts is a ~1 MB dynamic import and needs a real canvas; the page's job here
// is to build a valid option object and hand it over, which a stub still proves.
vi.mock('../components/charts/EChart', () => ({
  default: ({ ariaLabel }) => h('div', { 'data-chart': ariaLabel || 'chart' }),
}))

const SLIP_ROWS = [
  { ...line({ id: 'r1' }) },
  { ...line({ id: 'r2', issue_number: 'GC/MRT/0004/1225', event_date: '2025-12-01', line_cost: 500 }) },
]

vi.mock('../lib/api/materialIssue', async () => {
  const engine = await import('../lib/materialIssue')
  return {
    DEFAULT_LINE_MAX: 60000,
    listSlipsFromConsumption: vi.fn(async () => ({
      slips: engine.groupLinesIntoSlips(SLIP_ROWS),
      lines: SLIP_ROWS,
      truncated: false,
      unslipped: 0,
      missing: false,
    })),
    getSlipLines: vi.fn(async () => SLIP_ROWS),
    getIssueSummary: vi.fn(async () => ({ ok: false, data: null })),
    materialIssuesProvisioned: vi.fn(async () => true),
    listMaterialIssues: vi.fn(async () => ({ rows: [], missing: false })),
    listMaterialIssueLines: vi.fn(async () => []),
    createMaterialIssue: vi.fn(async () => ({ ok: true, id: 'x', issue_number: 'GC/MIS/0001/0826' })),
    setIssueStatus: vi.fn(async () => ({ ok: true })),
    countUnslippedLines: vi.fn(async () => 0),
    listIssuableJobCards: vi.fn(async () => []),
  }
})
vi.mock('../lib/api/materialMaster', () => ({ listMaterials: vi.fn(async () => []) }))

const { default: StoreMaterialIssue } = await import('../pages/StoreMaterialIssue')

const renderPage = () => render(h(MemoryRouter, null, h(StoreMaterialIssue)))

beforeEach(() => cleanup())

describe('StoreMaterialIssue page renders', () => {
  it('mounts without throwing and shows the register', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText(/Material Issue/i).length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.getAllByText('Issue register').length).toBeGreaterThan(0))
  })

  it('clicking through every tab never throws', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('Issue register').length).toBeGreaterThan(0))
    for (const label of ['Returns (MRT)', 'Raise an issue', 'Analytics', 'Issue register']) {
      const btn = screen.getAllByRole('button').find((b) => b.textContent?.trim() === label)
      expect(btn, `tab "${label}" should exist`).toBeTruthy()
      fireEvent.click(btn)
      // Let effects settle; a render throw rejects this.
      await waitFor(() => expect(document.body).toBeTruthy())
    }
  })

  it('states the on-hand-balance limitation instead of implying a balance', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('Issue register').length).toBeGreaterThan(0))
    expect(screen.getAllByText(/no live on-hand balance/i).length).toBeGreaterThan(0)
  })

  it('surfaces the return-booked-as-a-charge finding on the Returns tab', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('Issue register').length).toBeGreaterThan(0))
    const btn = screen.getAllByRole('button').find((b) => b.textContent?.trim() === 'Returns (MRT)')
    fireEvent.click(btn)
    await waitFor(() => expect(
      screen.getAllByText(/adds cost to a job card instead of crediting it/i).length,
    ).toBeGreaterThan(0))
    // ...and says plainly that nothing was rewritten.
    expect(screen.getAllByText(/Nothing has been changed/i).length).toBeGreaterThan(0)
  })

  it('renders no em or en dash anywhere in the page output', async () => {
    renderPage()
    await waitFor(() => expect(screen.getAllByText('Issue register').length).toBeGreaterThan(0))
    expect(document.body.textContent).not.toMatch(/[\u2013\u2014]/)
  })
})
