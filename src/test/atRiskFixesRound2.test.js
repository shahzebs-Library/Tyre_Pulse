import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Round 2 at-risk module fixes. Each block fails on the code before the fix.
 * Synthetic data only.
 */
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null, selects: [] }
  function from(table) {
    const b = {
      _table: table, _insert: undefined,
      select(cols) { state.selects.push({ table, cols }); return b },
      order() { return b }, range() { return b }, eq() { return b }, or() { return b }, limit() { return b },
      insert(v) { b._insert = v; return b },
      single() { return Promise.resolve(state.result) },
      maybeSingle() { return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})
vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const heat = await import('../lib/api/heatIntelligence')
const carbon = await import('../lib/api/carbon')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => { h.state.result = { data: [], error: null }; h.state.selects = []; h.state.last = null })

describe('Heat Intelligence fleet risk read', () => {
  // Columns of public.tyre_records the risk read may name (checked against the
  // production catalog on 2026-11-15; `current_status` is NOT one of them).
  const REAL = new Set(['id', 'serial_no', 'serial_number', 'tyre_serial', 'brand', 'size', 'asset_no', 'asset_number',
    'site', 'country', 'position', 'tyre_position', 'status', 'tread_depth', 'pressure_reading', 'cost_per_tyre',
    'total_km', 'fitment_date', 'issue_date', 'removal_date'])

  it('asks only for columns tyre_records has', () => {
    const cols = heat.TYRE_RISK_COLS.split(',').map((c) => c.trim())
    expect(cols).not.toContain('current_status')
    expect(cols.filter((c) => !REAL.has(c))).toEqual([])
  })

  it('surfaces a bad column as an error instead of an empty fleet', async () => {
    h.state.result = { data: null, error: { code: '42703', message: 'column tyre_records.current_status does not exist' } }
    await expect(heat.listTyresForHeatRisk({ country: 'KSA' })).rejects.toBeInstanceOf(ServiceError)
  })

  it('still degrades to an empty list when the table itself is missing', async () => {
    h.state.result = { data: null, error: { code: '42P01', message: 'relation "tyre_records" does not exist' } }
    await expect(heat.listTyresForHeatRisk()).resolves.toEqual([])
  })

  it('returns the rows when the read succeeds', async () => {
    h.state.result = { data: [{ id: 't1', status: 'Active' }], error: null }
    await expect(heat.listTyresForHeatRisk()).resolves.toEqual([{ id: 't1', status: 'Active' }])
    expect(h.state.selects[0].table).toBe('tyre_records')
  })
})

describe('Carbon offsets: a blank field is not saved as an invented value', () => {
  it('sends no provider, project, cost or tree count the user did not enter', async () => {
    h.state.result = { data: { id: 'o1' }, error: null }
    await carbon.createOffset({ tonnes: '10' })
    const sent = h.state.last._insert
    expect(sent.tonnes).toBe(10)
    expect(sent.provider).toBeNull()
    expect(sent.project).toBeNull()
    expect('aed_cost' in sent).toBe(false)
    expect('trees_equivalent' in sent).toBe(false)
    expect(JSON.stringify(sent)).not.toMatch(/Verra|Mangrove|900|450/)
  })

  it('keeps what the user did enter', async () => {
    h.state.result = { data: { id: 'o2' }, error: null }
    await carbon.createOffset({ tonnes: 2, provider: ' Registry X ', project: 'Project Y', aed_cost: '150.4', trees_equivalent: 30 })
    expect(h.state.last._insert).toMatchObject({ provider: 'Registry X', project: 'Project Y', aed_cost: 150, trees_equivalent: 30 })
  })
})

describe('Alert thresholds: only metrics the hourly job can evaluate are offered', () => {
  it('does not offer cost per km (never evaluated) or tread depth (stops the whole run)', async () => {
    const { isMetricSelectable, selectableMetrics } = await import('../lib/alertThresholdMetrics')
    expect(isMetricSelectable('cpk')).toBe(false)
    expect(isMetricSelectable('tread_depth')).toBe(false)
    expect(isMetricSelectable('pressure')).toBe(true)
    expect(selectableMetrics([{ value: 'cpk' }, { value: 'pressure' }]).map((m) => m.value)).toEqual(['pressure'])
    expect(selectableMetrics([{ metric: 'tread_depth' }, { metric: 'tyre_age_days' }]).map((m) => m.metric)).toEqual(['tyre_age_days'])
  })

  it('the page builds its create form and presets from the selectable list', () => {
    const src = readFileSync(resolve(__dirname, '../pages/AlertThresholds.jsx'), 'utf8').replace(/\r\n/g, '\n')
    expect(src).toMatch(/NEW_RULE_PRESETS\.map/)
    expect(src).not.toMatch(/\{PRESETS\.map/)
    expect(src).not.toMatch(/metric: 'tread_depth',\n\s+operator: 'lt',\n\s+threshold: ''/)
  })
})

describe('Workshop delay cost says when it is priced at the default rate', () => {
  it('reports where the labour rate came from', async () => {
    const { labourRateBasis, DEFAULT_LABOUR_RATE } = await import('../lib/workshopLive')
    expect(labourRateBasis({})).toEqual({ rate: DEFAULT_LABOUR_RATE, source: 'default' })
    expect(labourRateBasis({ jobs: [{ labour_rate: null }] }).source).toBe('default')
    expect(labourRateBasis({ jobs: [{ labour_rate: 80 }, { labour_rate: 100 }] })).toEqual({ rate: 90, source: 'jobs' })
    expect(labourRateBasis({ labourRate: 65, jobs: [{ labour_rate: 80 }] })).toEqual({ rate: 65, source: 'configured' })
  })

  it('the analytics summary carries the source for the page to label', async () => {
    const { computeWorkshopAnalytics } = await import('../lib/workshopAnalytics')
    const a = computeWorkshopAnalytics({ events: [], jobs: [], shifts: [], technicians: [], now: Date.UTC(2026, 10, 15) })
    expect(a.summary.labourRateSource).toBe('default')
    const b = computeWorkshopAnalytics({ events: [], jobs: [], shifts: [], technicians: [], now: Date.UTC(2026, 10, 15), labourRate: 70 })
    expect(b.summary).toMatchObject({ labourRate: 70, labourRateSource: 'configured' })
  })
})

describe('Tyre Pool route', () => {
  it('is role guarded to the roles the write policy admits', () => {
    const app = readFileSync(resolve(__dirname, '../App.jsx'), 'utf8')
    const line = app.split('\n').find((l) => l.includes('path="/tyre-pool"'))
    expect(line).toMatch(/RoleRoute allowed=\{\['Admin', 'Manager', 'Director'\]\}/)
  })
})
