import { describe, it, expect } from 'vitest'
import {
  CHARTS, KPIS, TABLE_COLS, BLOCK_TYPES, BLOCK_DEFAULTS, CHART_OPTS, CHART_JS_TYPE,
  REPORT_LIBRARY, STARTER, makeBlock, buildReportContext, buildInsights,
  fmtCell, cellValue, caseAgeDays, isChartEmpty, isClosedRow, normalizeConfig,
  VALUE_LABELS_PLUGIN, makeValueLabelsPlugin, summarizeChartData,
  PALETTES, PALETTE, PALETTE_KEYS, styleChartData, chartWidthFraction, packChartRows,
  chartOptionsFor,
} from '../lib/accidentReport'
import { distributeFill } from '../lib/accidentReportPdf'

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
  it('makeValueLabelsPlugin builds the same plugin with a custom label colour', () => {
    const light = makeValueLabelsPlugin('#e2e8f0')
    expect(light.id).toBe('valueLabels')
    expect(light.afterDatasetsDraw).toBeTypeOf('function')
    // the colour is applied to the canvas fillStyle when drawing a bar chart
    const ctx = { save: () => {}, restore: () => {}, fillText: () => {}, fillStyle: '', font: '' }
    const chart = {
      config: { type: 'bar' },
      ctx,
      options: {},
      data: { labels: ['A'], datasets: [{ data: [3] }] },
      isDatasetVisible: () => true,
      getDatasetMeta: () => ({ data: [{ x: 10, y: 10 }] }),
    }
    light.afterDatasetsDraw(chart)
    expect(ctx.fillStyle).toBe('#e2e8f0')
    // and the default export still draws in the paper ink
    VALUE_LABELS_PLUGIN.afterDatasetsDraw(chart)
    expect(ctx.fillStyle).toBe('#0f172a')
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

describe('advanced chart kinds (pareto / combo / radar / polar / waterfall)', () => {
  const ADV = ['paretoAssets', 'costTrend', 'typeRadar', 'statusPolar', 'recoveryWaterfall']
  const ADV_KINDS = ['pareto', 'combo', 'radar', 'polar', 'waterfall']
  const AT = [
    { id: 1, incident_date: '2026-06-01', asset_no: 'TRK-1', status: 'Open', accident_type: 'collision', severity: 'Major', claim_amount: 10000, claim_approved_amount: 8000, recovered_amount: 4000, deductible: 500, repair_cost: 1200, parts_cost: 300, insurer: 'Tawuniya' },
    { id: 2, incident_date: '2026-06-15', asset_no: 'TRK-1', status: 'Closed', release_date: '2026-06-30', accident_type: 'tyre_failure', severity: 'Minor', claim_amount: 2000, recovered_amount: 2000, repair_cost: 400 },
    { id: 3, incident_date: '2026-07-01', asset_no: 'TRK-2', status: 'Reported', accident_type: 'collision', severity: 'total loss', claim_amount: 50000, deductible: 1000 },
  ]

  it('each advanced builder returns chart.js data on live records and stays honest on empty', () => {
    const full = buildReportContext(AT, 'SAR')
    const empty = buildReportContext([], 'SAR')
    for (const key of ADV) {
      const d = CHARTS[key].build(full)
      expect(Array.isArray(d.labels), key).toBe(true)
      expect(Array.isArray(d.datasets), key).toBe(true)
      expect(d.datasets.length, key).toBeGreaterThan(0)
      expect(() => CHARTS[key].build(empty), key).not.toThrow()
    }
  })

  it('advanced kinds are wired into CHART_OPTS and CHART_JS_TYPE', () => {
    for (const kind of ADV_KINDS) {
      expect(CHART_OPTS[kind], kind).toBeTruthy()
      expect(CHART_JS_TYPE[kind], kind).toBeTruthy()
    }
    expect(CHART_JS_TYPE.pareto).toBe('bar')
    expect(CHART_JS_TYPE.combo).toBe('bar')
    expect(CHART_JS_TYPE.radar).toBe('radar')
    expect(CHART_JS_TYPE.polar).toBe('polarArea')
    expect(CHART_JS_TYPE.waterfall).toBe('bar')
  })

  it('pareto is a mixed bar+line with a non-decreasing cumulative % ending at 100', () => {
    const p = CHARTS.paretoAssets.build(buildReportContext(AT, 'SAR'))
    expect(p.datasets.some((d) => d.type === 'bar')).toBe(true)
    const line = p.datasets.find((d) => d.type === 'line')
    expect(line).toBeTruthy()
    expect(line.yAxisID).toBe('y1')
    for (let i = 1; i < line.data.length; i++) expect(line.data[i]).toBeGreaterThanOrEqual(line.data[i - 1])
    expect(line.data[line.data.length - 1]).toBe(100)
  })

  it('combo puts the incident-count line on the second (y1) axis', () => {
    const c = CHARTS.costTrend.build(buildReportContext(AT, 'SAR'))
    expect(c.labels.length).toBe(12)
    const line = c.datasets.find((d) => d.type === 'line')
    expect(line.yAxisID).toBe('y1')
    expect(c.datasets.find((d) => d.type === 'bar')).toBeTruthy()
  })

  it('radar/polar collapse counts to a single dataset and stay empty when no records', () => {
    const r = CHARTS.typeRadar.build(buildReportContext(AT, 'SAR'))
    expect(r.datasets).toHaveLength(1)
    expect(r.labels).toContain('Collision')
    expect(isChartEmpty(CHARTS.typeRadar.build(buildReportContext([], 'SAR')))).toBe(true)
    const p = CHARTS.statusPolar.build(buildReportContext(AT, 'SAR'))
    expect(p.datasets).toHaveLength(1)
    expect(isChartEmpty(CHARTS.statusPolar.build(buildReportContext([], 'SAR')))).toBe(true)
  })

  it('recovery waterfall uses floating [start,end] bars chaining claimed to recovered', () => {
    const w = CHARTS.recoveryWaterfall.build(buildReportContext(AT, 'SAR'))
    expect(w.labels).toEqual(['Claimed', 'Deductible', 'Outstanding', 'Recovered'])
    const seg = w.datasets[0].data
    expect(seg.every((s) => Array.isArray(s) && s.length === 2)).toBe(true)
    expect(seg[0][0]).toBe(0)              // Claimed rises from 0
    expect(seg[3][0]).toBe(0)              // Recovered rises from 0
    const claimed = seg[0][1]
    const deductibleStep = seg[1][1] - seg[1][0]
    const outstandingStep = seg[2][1] - seg[2][0]
    const recovered = seg[3][1]
    // Claimed = Deductible + Outstanding + Recovered (non-negative decomposition)
    expect(deductibleStep).toBeGreaterThanOrEqual(0)
    expect(outstandingStep).toBeGreaterThanOrEqual(0)
    expect(deductibleStep + outstandingStep + recovered).toBe(claimed)
    // empty stays honest
    expect(isChartEmpty(CHARTS.recoveryWaterfall.build(buildReportContext([], 'SAR')))).toBe(true)
  })

  it('chart block defaults to full width; value labels cover radar points and floating bars', () => {
    expect(BLOCK_DEFAULTS.chart().width).toBe('full')
    // radar points labeled
    const calls = []
    const rctx = { save() {}, restore() {}, fillText: (t) => calls.push(t), fillStyle: '', font: '' }
    VALUE_LABELS_PLUGIN.afterDatasetsDraw({
      config: { type: 'radar' }, ctx: rctx, options: {},
      data: { labels: ['A', 'B'], datasets: [{ data: [2, 3] }] },
      isDatasetVisible: () => true, getDatasetMeta: () => ({ data: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }),
    })
    expect(calls).toContain('2')
    expect(calls).toContain('3')
    // floating bar labeled with its step magnitude (|end - start|)
    const calls2 = []
    const bctx = { save() {}, restore() {}, fillText: (t) => calls2.push(t), fillStyle: '', font: '' }
    VALUE_LABELS_PLUGIN.afterDatasetsDraw({
      config: { type: 'bar' }, ctx: bctx, options: {},
      data: { labels: ['X'], datasets: [{ data: [[100, 300]] }] },
      isDatasetVisible: () => true, getDatasetMeta: () => ({ data: [{ x: 5, y: 5 }] }),
    })
    expect(calls2).toContain('200')
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

describe('per-chart formatting: palettes, styleChartData and label toggle', () => {
  it('every palette has at least 6 valid dark-on-white hex colours; default reuses PALETTE', () => {
    const keys = ['default', 'cool', 'warm', 'mono', 'contrast', 'pastel']
    for (const k of keys) {
      expect(Array.isArray(PALETTES[k]), k).toBe(true)
      expect(PALETTES[k].length, k).toBeGreaterThanOrEqual(6)
      PALETTES[k].forEach((c) => expect(c, `${k}:${c}`).toMatch(/^#[0-9a-f]{6}$/i))
    }
    expect(PALETTES.default).toBe(PALETTE)
  })

  it('chart block defaults carry the new formatting fields', () => {
    const d = BLOCK_DEFAULTS.chart()
    expect(d.width).toBe('full')
    expect(d.showLabels).toBe(true)
    expect(d.showBorders).toBe(false)
    expect(d.palette).toBe('default')
  })

  it('styleChartData recolours per-dataset for bars and never mutates the input', () => {
    const data = { labels: ['A', 'B', 'C'], datasets: [{ label: 'Incidents', data: [3, 2, 1], backgroundColor: '#ea580c', borderWidth: 3 }] }
    const before = JSON.parse(JSON.stringify(data))
    const styled = styleChartData(data, { chart: 'topAssets', palette: 'cool', showBorders: false })
    // input untouched
    expect(data).toEqual(before)
    // output is a fresh object with the cool palette applied and no border
    expect(styled).not.toBe(data)
    expect(styled.datasets[0].backgroundColor).toBe(PALETTES.cool[0])
    expect(styled.datasets[0].borderWidth).toBe(0)
    // borders on -> 1.5
    const bordered = styleChartData(data, { chart: 'topAssets', palette: 'cool', showBorders: true })
    expect(bordered.datasets[0].borderWidth).toBe(1.5)
  })

  it('styleChartData recolours per-slice for doughnut/polar kinds', () => {
    const data = { labels: ['X', 'Y', 'Z'], datasets: [{ data: [5, 3, 2], backgroundColor: ['#111', '#222', '#333'], borderWidth: 0 }] }
    const styled = styleChartData(data, { chart: 'severity', palette: 'warm' })
    expect(Array.isArray(styled.datasets[0].backgroundColor)).toBe(true)
    expect(styled.datasets[0].backgroundColor).toEqual([PALETTES.warm[0], PALETTES.warm[1], PALETTES.warm[2]])
  })

  it('styleChartData keeps a line chart stroke and only outlines points on the border toggle', () => {
    const data = { labels: ['Jan', 'Feb'], datasets: [{ label: 'Incidents', data: [1, 4], borderColor: '#ea580c', fill: true }] }
    const styled = styleChartData(data, { chart: 'trend', palette: 'mono', showBorders: false })
    // the line still has a visible stroke (borderWidth stays > 0)
    expect(styled.datasets[0].borderWidth).toBeGreaterThan(0)
    expect(styled.datasets[0].borderColor).toBe(PALETTES.mono[0])
    // filled area uses an rgba tint of the palette colour
    expect(String(styled.datasets[0].backgroundColor)).toMatch(/^rgba\(/)
  })

  it('styleChartData returns malformed/empty data unchanged', () => {
    expect(styleChartData(null, {})).toBeNull()
    const empty = { labels: [], datasets: [] }
    expect(styleChartData(empty, { palette: 'warm' })).toBe(empty)
    const noDs = { labels: ['A'], datasets: [] }
    expect(styleChartData(noDs, {})).toBe(noDs)
  })

  it('value-labels plugin skips drawing when options.plugins.valueLabels.enabled === false', () => {
    const calls = []
    const ctx = { save() {}, restore() {}, fillText: (t) => calls.push(t), fillStyle: '', font: '' }
    const chartOff = {
      config: { type: 'bar', options: { plugins: { valueLabels: { enabled: false } } } },
      ctx, options: {}, data: { labels: ['A'], datasets: [{ data: [3] }] },
      isDatasetVisible: () => true, getDatasetMeta: () => ({ data: [{ x: 10, y: 10 }] }),
    }
    VALUE_LABELS_PLUGIN.afterDatasetsDraw(chartOff)
    expect(calls).toHaveLength(0)
    // enabled true (or absent) still draws
    const chartOn = { ...chartOff, config: { type: 'bar', options: { plugins: { valueLabels: { enabled: true } } } } }
    VALUE_LABELS_PLUGIN.afterDatasetsDraw(chartOn)
    expect(calls).toContain('3')
  })
})

describe('chart width fractions + row packing (full/half/third/quarter)', () => {
  it('chartWidthFraction maps every supported width', () => {
    expect(chartWidthFraction('full')).toBe(1)
    expect(chartWidthFraction('half')).toBe(0.5)
    expect(chartWidthFraction('third')).toBeCloseTo(1 / 3, 6)
    expect(chartWidthFraction('quarter')).toBe(0.25)
    expect(chartWidthFraction(undefined)).toBe(1) // default -> full
  })

  it('packChartRows fits 4 quarters per row and opens a new row past a full width', () => {
    const q = (n) => Array.from({ length: n }, () => ({ width: 'quarter' }))
    // four quarters == one full row
    expect(packChartRows(q(4))).toHaveLength(1)
    // five quarters -> 4 + 1
    const five = packChartRows(q(5))
    expect(five).toHaveLength(2)
    expect(five[0]).toHaveLength(4)
    expect(five[1]).toHaveLength(1)
    // mixed: half + quarter + quarter = 1.0 (single row), next quarter starts a new row
    const mixed = packChartRows([{ width: 'half' }, { width: 'quarter' }, { width: 'quarter' }, { width: 'quarter' }])
    expect(mixed).toHaveLength(2)
    expect(mixed[0]).toHaveLength(3)
    expect(mixed[1]).toHaveLength(1)
    // thirds still pack three-up
    expect(packChartRows([{ width: 'third' }, { width: 'third' }, { width: 'third' }])).toHaveLength(1)
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

describe('extended palettes (more colour combinations incl. green + gray)', () => {
  it('PALETTE_KEYS enumerates every palette in a stable order, keeping the original 6 first', () => {
    // ordering: the original set leads, new packs follow
    expect(PALETTE_KEYS.slice(0, 6)).toEqual(['default', 'cool', 'warm', 'mono', 'contrast', 'pastel'])
    expect(PALETTE_KEYS).toContain('forest')
    expect(PALETTE_KEYS).toContain('slate')
    // no orphans in either direction
    expect(new Set(PALETTE_KEYS).size).toBe(PALETTE_KEYS.length)
    expect(Object.keys(PALETTES).sort()).toEqual([...PALETTE_KEYS].sort())
  })
  it('adds green- and gray-forward packs plus ocean/sunset/earth/vibrant, each >= 8 readable hex', () => {
    const added = ['forest', 'slate', 'ocean', 'sunset', 'earth', 'vibrant']
    for (const k of added) {
      expect(Array.isArray(PALETTES[k]), k).toBe(true)
      expect(PALETTES[k].length, k).toBeGreaterThanOrEqual(8)
      PALETTES[k].forEach((c) => expect(c, `${k}:${c}`).toMatch(/^#[0-9a-f]{6}$/i))
    }
    // forest is green-forward, slate is neutral/gray-forward
    expect(PALETTES.forest[0]).toBe('#166534')
    expect(PALETTES.slate).toContain('#64748b')
  })
})

describe('per-chart border colour + width, data-label colour/size, legend + grid', () => {
  it('chart block defaults carry every new formatting field (backward-compatible)', () => {
    const d = BLOCK_DEFAULTS.chart()
    expect(d.borderColor).toBeNull()
    expect(d.borderWidth).toBe(1.5)
    expect(d.labelColor).toBe('#0f172a')
    expect(d.labelSize).toBe(11)
    expect(d.showLegend).toBe(true)
    expect(d.showGrid).toBe(true)
  })

  it('styleChartData applies an explicit borderColor at borderWidth on bar outlines', () => {
    const data = { labels: ['A', 'B'], datasets: [{ label: 'Incidents', data: [3, 2] }] }
    const styled = styleChartData(data, { chart: 'topAssets', palette: 'forest', showBorders: true, borderColor: '#111827', borderWidth: 3 })
    expect(styled.datasets[0].backgroundColor).toBe(PALETTES.forest[0])
    expect(styled.datasets[0].borderColor).toBe('#111827')
    expect(styled.datasets[0].borderWidth).toBe(3)
  })

  it('styleChartData border falls back to the palette colour when borderColor is null', () => {
    const data = { labels: ['A', 'B'], datasets: [{ data: [3, 2] }] }
    const styled = styleChartData(data, { chart: 'topAssets', palette: 'slate', showBorders: true, borderColor: null })
    expect(styled.datasets[0].borderColor).toBe(PALETTES.slate[0])
    expect(styled.datasets[0].borderWidth).toBe(1.5) // default width when borders on
  })

  it('styleChartData applies borderColor to doughnut/polar slice outlines only when borders on', () => {
    const data = { labels: ['X', 'Y'], datasets: [{ data: [5, 3], backgroundColor: ['#111', '#222'] }] }
    const on = styleChartData(data, { chart: 'severity', palette: 'ocean', showBorders: true, borderColor: '#0f172a', borderWidth: 2 })
    expect(on.datasets[0].borderColor).toBe('#0f172a')
    expect(on.datasets[0].borderWidth).toBe(2)
    // borders off keeps the white slice separator (unchanged behaviour)
    const off = styleChartData(data, { chart: 'severity', palette: 'ocean', showBorders: false, borderColor: '#0f172a' })
    expect(off.datasets[0].borderColor).toBe('#ffffff')
  })

  it('chartOptionsFor wires legend/grid/data-label options non-mutatingly', () => {
    const base = CHART_OPTS.bar
    const beforeLegend = base.plugins.legend.display
    const opts = chartOptionsFor({ chart: 'topAssets', showLegend: false, showGrid: false, showLabels: false, labelColor: '#334155', labelSize: 14 }, base)
    // legend + grid toggled off
    expect(opts.plugins.legend.display).toBe(false)
    expect(opts.scales.x.grid.display).toBe(false)
    expect(opts.scales.y.grid.display).toBe(false)
    // value-label wiring carries the enabled flag + colour + size
    expect(opts.plugins.valueLabels).toEqual({ enabled: false, color: '#334155', size: 14 })
    // input base object was not mutated
    expect(base.plugins.legend.display).toBe(beforeLegend)
    expect(base.scales.x.grid.display).toBeUndefined()
  })

  it('chartOptionsFor defaults show legend + grid + labels ON and tolerates scale-less charts', () => {
    const opts = chartOptionsFor({ chart: 'topAssets' }, CHART_OPTS.bar)
    expect(opts.plugins.legend.display).toBe(true)
    expect(opts.scales.y.grid.display).toBe(true)
    expect(opts.plugins.valueLabels.enabled).toBe(true)
    // doughnut has no scales — must not throw and must not invent a scales object
    const dough = chartOptionsFor({ chart: 'severity' }, CHART_OPTS.doughnut)
    expect(dough.scales).toBeUndefined()
    expect(dough.plugins.legend.display).toBe(true)
  })

  it('value-labels plugin honours colour + size from options.plugins.valueLabels', () => {
    const ctx = { save() {}, restore() {}, fillText() {}, fillStyle: '', font: '' }
    const chart = {
      config: { type: 'bar', options: { plugins: { valueLabels: { enabled: true, color: '#123456', size: 16 } } } },
      ctx, options: {}, data: { labels: ['A'], datasets: [{ data: [3] }] },
      isDatasetVisible: () => true, getDatasetMeta: () => ({ data: [{ x: 10, y: 10 }] }),
    }
    VALUE_LABELS_PLUGIN.afterDatasetsDraw(chart)
    expect(ctx.fillStyle).toBe('#123456')
    expect(ctx.font).toContain('16px')
    // absent colour/size falls back to the plugin's default ink + 10px
    const bare = { ...chart, config: { type: 'bar', options: {} } }
    VALUE_LABELS_PLUGIN.afterDatasetsDraw(bare)
    expect(ctx.fillStyle).toBe('#0f172a')
    expect(ctx.font).toContain('10px')
  })
})

describe('PDF blank-space fill (distributeFill)', () => {
  it('never fills a small gap (<= per-type threshold) and never goes negative', () => {
    expect(distributeFill(0, 'chart')).toBe(0)
    expect(distributeFill(30, 'chart')).toBe(0)   // exactly at threshold -> no fill
    expect(distributeFill(-50, 'chart')).toBe(0)
    expect(distributeFill(NaN, 'chart')).toBe(0)
    expect(distributeFill(undefined, 'row')).toBe(0)
  })
  it('grows by (blank - pad) once past the threshold, clamped to the per-type cap', () => {
    // chart: pad 8, cap 90
    expect(distributeFill(50, 'chart')).toBe(42)        // 50 - 8
    expect(distributeFill(1000, 'chart')).toBe(90)      // clamped to cap
    // kpis: pad 6, cap 44
    expect(distributeFill(40, 'kpis')).toBe(34)         // 40 - 6
    expect(distributeFill(1000, 'kpis')).toBe(44)
    // unknown block type falls back to the default tuning (pad 8, cap 60)
    expect(distributeFill(50, 'mystery')).toBe(42)
    expect(distributeFill(1000, 'mystery')).toBe(60)
  })
  it('is monotonic in the blank amount up to the cap', () => {
    expect(distributeFill(60, 'chart')).toBeGreaterThan(distributeFill(50, 'chart'))
    expect(distributeFill(200, 'chart')).toBe(distributeFill(300, 'chart')) // both capped
  })
})
