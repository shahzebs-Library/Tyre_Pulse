import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chainable, thenable Supabase query-builder mock that records every modifier
// applied (mirrors the conventions of src/test/notifications.test.js).
const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = {
      table, select: null, eq: [], neq: [], ilike: [], gt: [], gte: [], lt: [],
      lte: [], in: [], is: [], not: [], order: [], limit: [],
    }
    const b = {
      _calls: calls,
      select(cols) { calls.select = cols; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      neq(c, v) { calls.neq.push([c, v]); return b },
      ilike(c, v) { calls.ilike.push([c, v]); return b },
      gt(c, v) { calls.gt.push([c, v]); return b },
      gte(c, v) { calls.gte.push([c, v]); return b },
      lt(c, v) { calls.lt.push([c, v]); return b },
      lte(c, v) { calls.lte.push([c, v]); return b },
      in(c, v) { calls.in.push([c, v]); return b },
      is(c, v) { calls.is.push([c, v]); return b },
      not(c, op, v) { calls.not.push([c, op, v]); return b },
      order(c, opts) { calls.order.push([c, opts]); return b },
      limit(n) { calls.limit.push(n); return b },
      maybeSingle() { return Promise.resolve(state.result) },
      upsert(row, opts) { calls.upsert = [row, opts]; return Promise.resolve(state.result) },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

const {
  DATASETS,
  DATASET_LIST,
  OPERATORS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  validateConfig,
  buildQuery,
  applyAggregations,
  escapeLike,
  fetchSavedReports,
  persistSavedReports,
  makeSavedReport,
  SAVED_REPORTS_KEY,
} = await import('../lib/reportBuilder')

beforeEach(() => {
  h.state.result = { data: [], error: null }
  h.state.last = null
})

// ─────────────────────────────────────────────────────────────────────────────
// DATASETS registry
// ─────────────────────────────────────────────────────────────────────────────
describe('DATASETS registry', () => {
  it('covers all required datasets with real tables', () => {
    expect(Object.keys(DATASETS).sort()).toEqual([
      'accidents', 'fleet', 'gate_passes', 'inspections',
      'suppliers', 'tyres', 'warranty', 'work_order_line_items', 'work_orders',
    ])
    expect(DATASETS.tyres.table).toBe('tyre_records')
    expect(DATASETS.fleet.table).toBe('vehicle_fleet')
    expect(DATASETS.warranty.table).toBe('warranty_claims')
    expect(DATASETS.gate_passes.table).toBe('gate_passes')
    expect(DATASETS.work_order_line_items.table).toBe('work_order_line_items')
    expect(DATASETS.tyres.columns.some(c => c.key === 'status')).toBe(true)
  })

  it('every dataset has typed columns and a valid default sort', () => {
    for (const ds of DATASET_LIST) {
      expect(ds.columns.length).toBeGreaterThan(3)
      for (const c of ds.columns) {
        expect(c.key).toBeTruthy()
        expect(c.label).toBeTruthy()
        expect(['text', 'number', 'date', 'enum']).toContain(c.type)
      }
      expect(ds.columns.some(c => c.key === ds.defaultSort.col)).toBe(true)
      expect(['asc', 'desc']).toContain(ds.defaultSort.dir)
    }
  })

  it('exposes real adapter-derived columns (spot checks)', () => {
    const tyreKeys = DATASETS.tyres.columns.map(c => c.key)
    expect(tyreKeys).toContain('serial_no')
    expect(tyreKeys).toContain('cost_per_tyre')
    const woKeys = DATASETS.work_orders.columns.map(c => c.key)
    expect(woKeys).toContain('work_order_no')
    expect(woKeys).toContain('total_cost')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateConfig
// ─────────────────────────────────────────────────────────────────────────────
describe('validateConfig', () => {
  const base = { dataset: 'tyres', columns: ['serial_no', 'brand'] }

  it('accepts a minimal valid config and applies defaults', () => {
    const r = validateConfig(base)
    expect(r.valid).toBe(true)
    expect(r.config.sort).toEqual(DATASETS.tyres.defaultSort)
    expect(r.config.limit).toBe(DEFAULT_LIMIT)
    expect(r.config.filters).toEqual([])
    expect(r.config.group).toBeNull()
  })

  it('rejects unknown dataset', () => {
    const r = validateConfig({ dataset: 'users; DROP TABLE', columns: ['x'] })
    expect(r.valid).toBe(false)
    expect(r.config).toBeNull()
    expect(r.errors[0]).toMatch(/Unknown dataset/)
  })

  it('rejects unknown columns and empty selection', () => {
    expect(validateConfig({ dataset: 'tyres', columns: ['nope'] }).valid).toBe(false)
    expect(validateConfig({ dataset: 'tyres', columns: [] }).valid).toBe(false)
  })

  it('dedupes columns preserving order', () => {
    const r = validateConfig({ dataset: 'tyres', columns: ['brand', 'serial_no', 'brand'] })
    expect(r.config.columns).toEqual(['brand', 'serial_no'])
  })

  it('rejects unknown filter column and operator', () => {
    const badCol = validateConfig({ ...base, filters: [{ col: 'evil', op: 'equals', value: 'x' }] })
    expect(badCol.valid).toBe(false)
    const badOp = validateConfig({ ...base, filters: [{ col: 'brand', op: 'regex', value: 'x' }] })
    expect(badOp.valid).toBe(false)
    expect(badOp.errors[0]).toMatch(/Operator/)
  })

  it('rejects type-mismatched operators (contains on number)', () => {
    const r = validateConfig({ ...base, filters: [{ col: 'cost_per_tyre', op: 'contains', value: '5' }] })
    expect(r.valid).toBe(false)
  })

  it('coerces number filter values and rejects non-numeric', () => {
    const ok = validateConfig({ ...base, filters: [{ col: 'cost_per_tyre', op: 'gte', value: '1,500' }] })
    expect(ok.valid).toBe(true)
    expect(ok.config.filters[0].value).toBe(1500)
    const bad = validateConfig({ ...base, filters: [{ col: 'cost_per_tyre', op: 'gte', value: 'abc' }] })
    expect(bad.valid).toBe(false)
  })

  it('validates date values as ISO and rejects garbage', () => {
    const ok = validateConfig({ ...base, filters: [{ col: 'issue_date', op: 'gte', value: '2026-01-01' }] })
    expect(ok.valid).toBe(true)
    const bad = validateConfig({ ...base, filters: [{ col: 'issue_date', op: 'gte', value: 'yesterday' }] })
    expect(bad.valid).toBe(false)
  })

  it('between requires two valid values', () => {
    const ok = validateConfig({ ...base, filters: [{ col: 'cost_per_tyre', op: 'between', value: ['10', '20'] }] })
    expect(ok.valid).toBe(true)
    expect(ok.config.filters[0].value).toEqual([10, 20])
    const bad = validateConfig({ ...base, filters: [{ col: 'cost_per_tyre', op: 'between', value: ['10'] }] })
    expect(bad.valid).toBe(false)
  })

  it('in accepts comma-separated string and arrays', () => {
    const r = validateConfig({ ...base, filters: [{ col: 'brand', op: 'in', value: 'Michelin, Bridgestone,, ' }] })
    expect(r.valid).toBe(true)
    expect(r.config.filters[0].value).toEqual(['Michelin', 'Bridgestone'])
    const empty = validateConfig({ ...base, filters: [{ col: 'brand', op: 'in', value: ' , ' }] })
    expect(empty.valid).toBe(false)
  })

  it('valueless operators need no value', () => {
    const r = validateConfig({ ...base, filters: [{ col: 'brand', op: 'is_empty' }] })
    expect(r.valid).toBe(true)
    expect(r.config.filters[0]).toEqual({ col: 'brand', op: 'is_empty' })
  })

  it('rejects unknown sort column; clamps limit', () => {
    expect(validateConfig({ ...base, sort: { col: 'evil', dir: 'asc' } }).valid).toBe(false)
    expect(validateConfig({ ...base, limit: 999999 }).config.limit).toBe(MAX_LIMIT)
    expect(validateConfig({ ...base, limit: -5 }).config.limit).toBe(1)
    expect(validateConfig({ ...base, limit: 'nope' }).config.limit).toBe(DEFAULT_LIMIT)
  })

  it('validates group-by column, metric columns and functions', () => {
    const ok = validateConfig({ ...base, group: { by: 'brand', metrics: [{ col: 'cost_per_tyre', fn: 'sum' }] } })
    expect(ok.valid).toBe(true)
    expect(validateConfig({ ...base, group: { by: 'evil' } }).valid).toBe(false)
    expect(validateConfig({ ...base, group: { by: 'brand', metrics: [{ col: 'brand', fn: 'sum' }] } }).valid).toBe(false)
    expect(validateConfig({ ...base, group: { by: 'brand', metrics: [{ col: 'cost_per_tyre', fn: 'median' }] } }).valid).toBe(false)
  })

  it('rejects null/garbage config', () => {
    expect(validateConfig(null).valid).toBe(false)
    expect(validateConfig('x').valid).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// buildQuery
// ─────────────────────────────────────────────────────────────────────────────
describe('buildQuery', () => {
  it('selects only registry columns, applies sort + limit', () => {
    buildQuery(h.supabase, { dataset: 'tyres', columns: ['serial_no', 'brand'] })
    const c = h.state.last._calls
    expect(c.table).toBe('tyre_records')
    expect(c.select).toBe('serial_no,brand')
    expect(c.order).toEqual([['issue_date', { ascending: false }]])
    expect(c.limit).toEqual([DEFAULT_LIMIT])
  })

  it('throws on invalid config instead of querying', () => {
    expect(() => buildQuery(h.supabase, { dataset: 'nope', columns: ['x'] })).toThrow(/Unknown dataset/)
    expect(h.state.last).toBeNull()
  })

  it('maps each operator to the right builder call', () => {
    buildQuery(h.supabase, {
      dataset: 'work_orders',
      columns: ['work_order_no', 'status', 'total_cost', 'opened_at'],
      filters: [
        { col: 'status', op: 'equals', value: 'Open' },
        { col: 'site', op: 'not_equals', value: 'Jeddah' },
        { col: 'description', op: 'contains', value: 'brake' },
        { col: 'total_cost', op: 'gt', value: 100 },
        { col: 'total_cost', op: 'lte', value: 900 },
        { col: 'opened_at', op: 'between', value: ['2026-01-01', '2026-06-30'] },
        { col: 'priority', op: 'in', value: ['High', 'Critical'] },
        { col: 'completed_at', op: 'is_empty' },
        { col: 'asset_no', op: 'not_empty' },
      ],
      sort: { col: 'total_cost', dir: 'asc' },
      limit: 50,
    })
    const c = h.state.last._calls
    expect(c.eq).toEqual([['status', 'Open']])
    expect(c.neq).toEqual([['site', 'Jeddah']])
    expect(c.ilike).toEqual([['description', '%brake%']])
    expect(c.gt).toEqual([['total_cost', 100]])
    expect(c.lte).toContainEqual(['total_cost', 900])
    expect(c.gte).toContainEqual(['opened_at', '2026-01-01'])
    expect(c.lte).toContainEqual(['opened_at', '2026-06-30'])
    expect(c.in).toEqual([['priority', ['High', 'Critical']]])
    expect(c.is).toEqual([['completed_at', null]])
    expect(c.not).toEqual([['asset_no', 'is', null]])
    expect(c.order).toEqual([['total_cost', { ascending: true }]])
    expect(c.limit).toEqual([50])
  })

  it('escapes LIKE wildcards in contains values', () => {
    buildQuery(h.supabase, {
      dataset: 'tyres',
      columns: ['serial_no'],
      filters: [{ col: 'serial_no', op: 'contains', value: '100%_x' }],
    })
    expect(h.state.last._calls.ilike).toEqual([['serial_no', '%100\\%\\_x%']])
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d')
  })

  it('adds group-by and metric columns to the select', () => {
    buildQuery(h.supabase, {
      dataset: 'tyres',
      columns: ['serial_no'],
      group: { by: 'brand', metrics: [{ col: 'cost_per_tyre', fn: 'sum' }] },
    })
    expect(h.state.last._calls.select).toBe('serial_no,brand,cost_per_tyre')
  })

  it('resolves query results through the thenable builder', async () => {
    h.state.result = { data: [{ serial_no: 'T1' }], error: null }
    const { data, error } = await buildQuery(h.supabase, { dataset: 'tyres', columns: ['serial_no'] })
    expect(error).toBeNull()
    expect(data).toEqual([{ serial_no: 'T1' }])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// applyAggregations
// ─────────────────────────────────────────────────────────────────────────────
describe('applyAggregations', () => {
  const rows = [
    { brand: 'Michelin', cost_per_tyre: 100, qty: 2 },
    { brand: 'Michelin', cost_per_tyre: 300, qty: 1 },
    { brand: 'Bridgestone', cost_per_tyre: 200, qty: 4 },
    { brand: null, cost_per_tyre: 'not-a-number', qty: null },
  ]

  it('returns null when no group is configured', () => {
    expect(applyAggregations(rows, { dataset: 'tyres', columns: ['brand'] })).toBeNull()
    expect(applyAggregations(rows, { dataset: 'tyres', group: { by: '' } })).toBeNull()
    expect(applyAggregations(rows, { dataset: 'nope', group: { by: 'brand' } })).toBeNull()
  })

  it('groups with count plus sum/avg/min/max metrics', () => {
    const out = applyAggregations(rows, {
      dataset: 'tyres',
      group: {
        by: 'brand',
        metrics: [
          { col: 'cost_per_tyre', fn: 'sum' },
          { col: 'cost_per_tyre', fn: 'avg' },
          { col: 'cost_per_tyre', fn: 'min' },
          { col: 'cost_per_tyre', fn: 'max' },
        ],
      },
    })
    const michelin = out.rows.find(r => r.brand === 'Michelin')
    expect(michelin).toMatchObject({
      count: 2,
      sum_cost_per_tyre: 400,
      avg_cost_per_tyre: 200,
      min_cost_per_tyre: 100,
      max_cost_per_tyre: 300,
    })
    const blank = out.rows.find(r => r.brand === '(blank)')
    expect(blank.count).toBe(1)
    expect(blank.sum_cost_per_tyre).toBeNull() // no numeric values in bucket
  })

  it('sorts groups by count descending and emits column metadata', () => {
    const out = applyAggregations(rows, {
      dataset: 'tyres',
      group: { by: 'brand', metrics: [{ col: 'qty', fn: 'sum' }] },
    })
    expect(out.rows[0].brand).toBe('Michelin')
    expect(out.columns.map(c => c.key)).toEqual(['brand', 'count', 'sum_qty'])
    expect(out.columns[2].label).toMatch(/^SUM /)
  })

  it('ignores invalid metric definitions defensively', () => {
    const out = applyAggregations(rows, {
      dataset: 'tyres',
      group: { by: 'brand', metrics: [{ col: 'brand', fn: 'sum' }, { col: 'qty', fn: 'median' }] },
    })
    expect(out.columns.map(c => c.key)).toEqual(['brand', 'count'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Saved report persistence
// ─────────────────────────────────────────────────────────────────────────────
describe('saved reports persistence', () => {
  it('fetchSavedReports reads app_settings and parses the array', async () => {
    const stored = [{ id: '1', name: 'A', config: { dataset: 'tyres' } }, { bad: true }, 'junk']
    h.state.result = { data: { value: JSON.stringify(stored) }, error: null }
    const out = await fetchSavedReports(h.supabase)
    expect(h.state.last._calls.table).toBe('app_settings')
    expect(h.state.last._calls.eq).toEqual([['key', SAVED_REPORTS_KEY]])
    expect(out).toEqual([{ id: '1', name: 'A', config: { dataset: 'tyres' } }])
  })

  it('fetchSavedReports tolerates missing/corrupt values', async () => {
    h.state.result = { data: null, error: null }
    expect(await fetchSavedReports(h.supabase)).toEqual([])
    h.state.result = { data: { value: '{not json' }, error: null }
    expect(await fetchSavedReports(h.supabase)).toEqual([])
  })

  it('persistSavedReports upserts on key with JSON value', async () => {
    const reports = [makeSavedReport({ name: 'B', config: { dataset: 'fleet' }, createdBy: 'u1' })]
    await persistSavedReports(h.supabase, reports)
    const [row, opts] = h.state.last._calls.upsert
    expect(row.key).toBe(SAVED_REPORTS_KEY)
    expect(opts).toEqual({ onConflict: 'key' })
    const parsed = JSON.parse(row.value)
    expect(parsed[0]).toMatchObject({ name: 'B', created_by: 'u1' })
    expect(parsed[0].id).toBeTruthy()
    expect(parsed[0].created_at).toBeTruthy()
  })

  it('persistSavedReports surfaces DB errors', async () => {
    h.state.result = { data: null, error: { message: 'rls denied' } }
    await expect(persistSavedReports(h.supabase, [])).rejects.toThrow('rls denied')
  })

  it('makeSavedReport trims and caps fields', () => {
    const r = makeSavedReport({ name: `  ${'x'.repeat(200)}  `, description: 'd', config: {} })
    expect(r.name.length).toBe(120)
    expect(r.description).toBe('d')
    expect(r.created_by).toBeNull()
  })

  it('OPERATORS registry only exposes known ops per type', () => {
    expect(OPERATORS.text).toContain('contains')
    expect(OPERATORS.number).not.toContain('contains')
    expect(OPERATORS.date).toContain('between')
  })
})
