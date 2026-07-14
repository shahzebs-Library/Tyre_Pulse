import { describe, it, expect } from 'vitest'
import {
  CHARTS, KPIS, TABLE_COLS, BLOCK_TYPES, BLOCK_DEFAULTS, CHART_OPTS, CHART_JS_TYPE,
  REPORT_LIBRARY, STARTER, makeBlock, buildReportContext, buildInsights,
  fmtCell, cellValue, caseAgeDays, isChartEmpty, isClosedRow, normalizeConfig,
  VALUE_LABELS_PLUGIN, summarizeChartData,
} from '../lib/accidentReport'

const money = (v) => `$${Number(v)}`

const SAMPLE = [
  { id: 1, incident_date: '2026-06-01', asset_no: 'TRK-1', site: 'Riyadh', severity: 'Major', status: 'Open', fault_status: 'Non-Fault', claim_amount: 10000, claim_approved_amount: 8000, recovered_amount: 4000, insurer: 'Tawuniya', repair_cost: 1200, parts_cost: 300 },
  { id: 2, incident_date: '2026-06-15', asset_no: 'TRK-2', site: 'Jeddah', severity: 'Minor', status: 'Closed', release_date: '2026-06-30', claim_amount: 2000, recovered_amount: 2000, insurer: 'Tawuniya' },
  { id: 3, incident_date: '2026-07-01', asset_no: 'TRK-1', site: 'Riyadh', severity: 'total loss', status: 'Reported', claim_amount: 50000, gcc_liability_ratio: 100 },
]

describe('accidentReport catalog integrity', () => {
  it('every block type has defaults and metadata', () => {
    for (const type of Object.keys(BLOCK_TYPES)) {
      expect(BLOCK_DEFAULTS[type], `defaults for ${type}`).toBeTypeOf('function')
      expect(BLOCK_TYPES[type].label).toBeTruthy()
      expect(BLOCK_TYPES[type].description).toBeTruthy()
    }
    // and no orphan defaults
    for (const type of Object.keys(BLOCK_DEFAULTS)) expect(BLOCK_TYPES[type]).toBeTruthy()
  })

  it('every chart has label/description/kind with options + chartjs type mappings', () => {
    for (const [key, def] of Object.entries(CHARTS)) {
      expect(def.label, key).toBeTruthy()
      expect(def.description, key).toBeTruthy()
      expect(CHART_OPTS[def.kind], `opts for ${key} (${def.kind})`).toBeTruthy()
      expect(CHART_JS_TYPE[def.kind], `chartjs type for ${key}`).toBeTruthy()
    }
  })

  it('all chart builders return chart.js data on live records and stay honest on empty', () => {
    const full = buildReportContext(SAMPLE, 'SAR')
    const empty = buildReportContext([], 'SAR')
    for (const [key, def] of Object.entries(CHARTS)) {
      const d = def.build(full)
      expect(Array.isArray(d.labels), key).toBe(true)
      expect(Array.isArray(d.datasets), key).toBe(true)
      // empty data never throws and is detectable as empty
      expect(() => def.build(empty), key).not.toThrow()
    }
    expect(isChartEmpty(CHARTS.severity.build(empty))).toBe(true)
    expect(isChartEmpty(CHARTS.severity.build(full))).toBe(false)
  })

  it('all KPIs compute against live records', () => {
    const ctx = buildReportContext(SAMPLE, 'SAR')
    expect(KPIS.total.get(ctx)).toBe(3)
    expect(KPIS.closed.get(ctx)).toBe(1)
    expect(KPIS.open.get(ctx)).toBe(2)
    expect(KPIS.repairCost.get(ctx)).toBe(1500)
    expect(KPIS.claimed.get(ctx)).toBe(62000)
    for (const [key, def] of Object.entries(KPIS)) {
      expect(def.get(ctx), key).not.toBeUndefined()
    }
  })

  it('isClosedRow honours release_date and closure keywords', () => {
    expect(isClosedRow({ release_date: '2026-01-01' })).toBe(true)
    expect(isClosedRow({ status: 'Settled' })).toBe(true)
    expect(isClosedRow({ status: 'Open' })).toBe(false)
  })

  it('fmtCell formats money, percents, dates and empties', () => {
    expect(fmtCell('claim_amount', 100, money)).toBe('$100')
    expect(fmtCell('gcc_liability_ratio', '50', money)).toBe('50%')
    expect(fmtCell('incident_date', '2026-06-01T10:00:00Z', money)).toBe('2026-06-01')
    expect(fmtCell('site', '', money)).toBe('N/A')
    expect(fmtCell('days_open', 12, money)).toBe('12d')
    expect(fmtCell('days_open', null, money)).toBe('N/A')
  })

  it('days_open is a virtual table column computed from the record (Days Open link-up)', () => {
    expect(TABLE_COLS.days_open).toBe('Days Open')
    const now = new Date('2026-07-14T12:00:00Z').getTime()
    // open case: incident → now
    expect(caseAgeDays({ incident_date: '2026-07-04', status: 'Open' }, now)).toBe(10)
    expect(cellValue('days_open', { incident_date: '2026-07-04', status: 'Open' }, now)).toBe(10)
    // closed case: incident → release_date
    expect(caseAgeDays({ incident_date: '2026-06-01', release_date: '2026-06-21' }, now)).toBe(20)
    // honest null without an incident date; plain columns pass through
    expect(caseAgeDays({ status: 'Open' }, now)).toBeNull()
    expect(cellValue('site', { site: 'Riyadh' }, now)).toBe('Riyadh')
  })

  it('avg days-open KPIs and the caseAge chart derive honestly from records', () => {
    const now = Date.now()
    const open = { incident_date: new Date(now - 20 * 86400000).toISOString().slice(0, 10), status: 'Open' }
    const closed = { incident_date: '2026-06-01', release_date: '2026-06-11', status: 'Closed' }
    const ctx = buildReportContext([open, closed], 'SAR')
    expect(KPIS.avgDaysOpen.get(ctx)).toBe('20d')
    expect(KPIS.avgCaseDuration.get(ctx)).toBe('10d')
    // empty → honest dashes
    const emptyCtx = buildReportContext([], 'SAR')
    expect(KPIS.avgDaysOpen.get(emptyCtx)).toBe('N/A')
    expect(KPIS.avgCaseDuration.get(emptyCtx)).toBe('N/A')
    // caseAge chart buckets only OPEN cases
    const data = CHARTS.caseAge.build(ctx)
    expect(data.labels).toEqual(['0 to 15d', '16 to 30d', '31 to 60d', '60+d'])
    expect(data.datasets[0].data).toEqual([0, 1, 0, 0])
    expect(isChartEmpty(CHARTS.caseAge.build(emptyCtx))).toBe(true)
  })
})

describe('value labels + chart digests (report numbers)', () => {
  it('exposes an inline chart.js value-labels plugin', () => {
    expect(VALUE_LABELS_PLUGIN.id).toBe('valueLabels')
    expect(VALUE_LABELS_PLUGIN.afterDatasetsDraw).toBeTypeOf('function')
  })
  it('summarizeChartData reports total and top label, empty stays empty', () => {
    const data = { labels: ['Riyadh', 'Jeddah'], datasets: [{ data: [18, 6] }, { data: [0, 2] }] }
    expect(summarizeChartData(data)).toBe('Total: 26 | Top: Riyadh (18)')
    expect(summarizeChartData({ labels: [], datasets: [] })).toBe('')
    expect(summarizeChartData(null)).toBe('')
  })
  it('pendingActions KPI counts open cases missing release date or insurer on a claim', () => {
    const rows = [
      { incident_date: '2026-07-01', status: 'Open' },                                        // no expected release -> pending
      { incident_date: '2026-07-02', status: 'Open', expected_release_date: '2026-08-01', claim_amount: 500 }, // claim, no insurer -> pending
      { incident_date: '2026-07-03', status: 'Open', expected_release_date: '2026-08-01' },   // complete open -> not pending
      { incident_date: '2026-06-01', status: 'Closed', release_date: '2026-06-10' },          // closed -> ignored
    ]
    expect(KPIS.pendingActions.get(buildReportContext(rows, 'SAR'))).toBe(2)
    expect(KPIS.pendingActions.get(buildReportContext([], 'SAR'))).toBe(0)
  })
  it('insights include needs-attention completeness lines only when applicable', () => {
    const rows = [
      { incident_date: '2026-07-01', status: 'Open', claim_status: 'filed' }, // no amount, no driver, no release
    ]
    const lines = buildInsights(buildReportContext(rows, 'SAR')).join(' | ')
    expect(lines).toMatch(/without an expected release date/)
    expect(lines).toMatch(/claim status but no claim amount/)
    expect(lines).toMatch(/missing the driver name/)
    const complete = [{ incident_date: '2026-07-01', status: 'Open', expected_release_date: '2026-08-01', driver_name: 'Ali' }]
    expect(buildInsights(buildReportContext(complete, 'SAR')).join(' | ')).not.toMatch(/Needs attention/)
  })
})

describe('auto insights (honest derivation)', () => {
  it('returns [] with no records — never fabricates', () => {
    expect(buildInsights(buildReportContext([], 'SAR'))).toEqual([])
  })
  it('derives findings from live records only', () => {
    const lines = buildInsights(buildReportContext(SAMPLE, 'SAR'))
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]).toMatch(/3 incidents/)
    expect(lines.join(' ')).toMatch(/serious/i)
    expect(lines.join(' ')).toMatch(/Riyadh/)
  })
})

describe('starter + library layouts', () => {
  it('starter layout only uses registered block types', () => {
    for (const b of STARTER()) expect(BLOCK_TYPES[b.type], b.type).toBeTruthy()
  })
  it('every library pack builds valid blocks with unique ids and valid charts/KPIs/columns', () => {
    for (const pack of REPORT_LIBRARY) {
      expect(pack.name).toBeTruthy()
      expect(pack.description).toBeTruthy()
      const blocks = pack.build()
      expect(blocks.length).toBeGreaterThan(0)
      const ids = new Set(blocks.map((b) => b.id))
      expect(ids.size, pack.key).toBe(blocks.length)
      for (const b of blocks) {
        expect(BLOCK_TYPES[b.type], `${pack.key}:${b.type}`).toBeTruthy()
        if (b.type === 'chart') expect(CHARTS[b.chart], `${pack.key} chart ${b.chart}`).toBeTruthy()
        if (b.type === 'kpis') b.items.forEach((k) => expect(KPIS[k], `${pack.key} kpi ${k}`).toBeTruthy())
        if (b.type === 'table') b.columns.forEach((c) => expect(TABLE_COLS[c], `${pack.key} col ${c}`).toBeTruthy())
      }
    }
  })
})

describe('normalizeConfig', () => {
  it('repairs malformed configs without crashing', () => {
    expect(normalizeConfig(null)).toEqual({ blocks: [], orientation: 'portrait' })
    expect(normalizeConfig({ blocks: 'nope' }).blocks).toEqual([])
    expect(normalizeConfig({ orientation: 'weird' }).orientation).toBe('portrait')
    expect(normalizeConfig({ orientation: 'landscape' }).orientation).toBe('landscape')
  })
  it('drops unknown block types, backfills defaults and ids', () => {
    const cfg = normalizeConfig({ blocks: [{ type: 'chart' }, { type: 'bogus' }, { type: 'table', limit: 5 }] })
    expect(cfg.blocks).toHaveLength(2)
    expect(cfg.blocks[0].chart).toBe('severity')
    expect(cfg.blocks[0].id).toBeTruthy()
    expect(cfg.blocks[1].limit).toBe(5)
    expect(cfg.blocks[1].columns.length).toBeGreaterThan(0)
  })
  it('makeBlock creates registered blocks with defaults applied', () => {
    const b = makeBlock('kpis')
    expect(b.id).toBeTruthy()
    expect(b.items.length).toBeGreaterThan(0)
  })
})
