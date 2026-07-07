import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Shared, hoisted Supabase mock: chainable, thenable query builder recording
// the table queried, plus auth.getSession and storage.from().list stubs.
// Mirrors src/test/notifications.test.js conventions.
const h = vi.hoisted(() => {
  const state = {
    result:        { data: [], error: null },
    sessionResult: { data: { session: null }, error: null },
    storageResult: { data: [], error: null },
    tables:        [],
    buckets:       [],
  }
  function from(table) {
    state.tables.push(table)
    const b = {
      _table: table,
      select() { return b },
      limit()  { return b },
      then(onF, onR) { return Promise.resolve(state.result).then(onF, onR) },
    }
    return b
  }
  const supabase = {
    from,
    auth: { getSession: () => Promise.resolve(state.sessionResult) },
    storage: {
      from(bucket) {
        state.buckets.push(bucket)
        return { list: () => Promise.resolve(state.storageResult) }
      },
    },
  }
  return { state, supabase }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const {
  STATUS,
  LATENCY_DEGRADED_MS,
  HEALTH_TABLES,
  HEALTH_BUCKETS,
  HEALTH_EDGE_FUNCTIONS,
  classifyLatency,
  shapeResult,
  rollupStatus,
  summarizeResults,
  checkDatabase,
  checkTable,
  checkStorage,
  checkAuth,
  runAllChecks,
} = await import('../lib/systemHealth')

beforeEach(() => {
  h.state.result        = { data: [], error: null }
  h.state.sessionResult = { data: { session: null }, error: null }
  h.state.storageResult = { data: [], error: null }
  h.state.tables        = []
  h.state.buckets       = []
})

// ─────────────────────────────────────────────────────────────────────────────
// classifyLatency
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyLatency', () => {
  it('is ok at or below the threshold', () => {
    expect(classifyLatency(0)).toBe(STATUS.OK)
    expect(classifyLatency(150)).toBe(STATUS.OK)
    expect(classifyLatency(LATENCY_DEGRADED_MS)).toBe(STATUS.OK)
  })

  it('is degraded above the threshold', () => {
    expect(classifyLatency(LATENCY_DEGRADED_MS + 1)).toBe(STATUS.DEGRADED)
    expect(classifyLatency(99999)).toBe(STATUS.DEGRADED)
  })

  it('respects a custom threshold', () => {
    expect(classifyLatency(500, 100)).toBe(STATUS.DEGRADED)
    expect(classifyLatency(50, 100)).toBe(STATUS.OK)
  })

  it('treats non-finite / invalid latencies as ok (cannot judge)', () => {
    expect(classifyLatency(null)).toBe(STATUS.OK)
    expect(classifyLatency(undefined)).toBe(STATUS.OK)
    expect(classifyLatency(NaN)).toBe(STATUS.OK)
    expect(classifyLatency(-5)).toBe(STATUS.OK)
    expect(classifyLatency('3000')).toBe(STATUS.OK)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// shapeResult
// ─────────────────────────────────────────────────────────────────────────────
describe('shapeResult', () => {
  it('normalizes a full raw outcome', () => {
    const r = shapeResult({ id: 'db', group: 'database', label: 'DB', status: 'ok', latencyMs: 42.6, detail: 'fine' })
    expect(r).toEqual({ id: 'db', group: 'database', label: 'DB', status: 'ok', latencyMs: 43, detail: 'fine' })
  })

  it('collapses invalid statuses to unknown', () => {
    expect(shapeResult({ id: 'x', label: 'x', status: 'exploded' }).status).toBe(STATUS.UNKNOWN)
    expect(shapeResult({ id: 'x', label: 'x' }).status).toBe(STATUS.UNKNOWN)
  })

  it('nulls out non-finite latencies and clamps negatives to zero', () => {
    expect(shapeResult({ id: 'x', label: 'x', status: 'ok', latencyMs: NaN }).latencyMs).toBeNull()
    expect(shapeResult({ id: 'x', label: 'x', status: 'ok', latencyMs: 'fast' }).latencyMs).toBeNull()
    expect(shapeResult({ id: 'x', label: 'x', status: 'ok', latencyMs: -3 }).latencyMs).toBe(0)
    expect(shapeResult({ id: 'x', label: 'x', status: 'ok' }).latencyMs).toBeNull()
  })

  it('fills safe defaults for missing fields', () => {
    const r = shapeResult()
    expect(r.id).toBe('unknown')
    expect(r.group).toBe('general')
    expect(r.status).toBe(STATUS.UNKNOWN)
    expect(r.detail).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// rollupStatus
// ─────────────────────────────────────────────────────────────────────────────
describe('rollupStatus', () => {
  const r = (status) => ({ status })

  it('is ok when every check is ok', () => {
    expect(rollupStatus([r('ok'), r('ok')])).toBe(STATUS.OK)
  })

  it('any down wins over everything', () => {
    expect(rollupStatus([r('ok'), r('degraded'), r('down')])).toBe(STATUS.DOWN)
    expect(rollupStatus([r('down')])).toBe(STATUS.DOWN)
  })

  it('degraded or unknown (without down) rolls up to degraded', () => {
    expect(rollupStatus([r('ok'), r('degraded')])).toBe(STATUS.DEGRADED)
    expect(rollupStatus([r('ok'), r('unknown')])).toBe(STATUS.DEGRADED)
    expect(rollupStatus([r('ok'), r('garbage')])).toBe(STATUS.DEGRADED)
  })

  it('is unknown for empty or invalid input', () => {
    expect(rollupStatus([])).toBe(STATUS.UNKNOWN)
    expect(rollupStatus(null)).toBe(STATUS.UNKNOWN)
    expect(rollupStatus(undefined)).toBe(STATUS.UNKNOWN)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// summarizeResults
// ─────────────────────────────────────────────────────────────────────────────
describe('summarizeResults', () => {
  it('counts each status and totals', () => {
    const s = summarizeResults([
      { status: 'ok' }, { status: 'ok' }, { status: 'degraded' },
      { status: 'down' }, { status: 'bogus' },
    ])
    expect(s).toEqual({ ok: 2, degraded: 1, down: 1, unknown: 1, total: 5, overall: STATUS.DOWN })
  })

  it('handles empty input', () => {
    expect(summarizeResults([])).toEqual({ ok: 0, degraded: 0, down: 0, unknown: 0, total: 0, overall: STATUS.UNKNOWN })
    expect(summarizeResults(null).total).toBe(0)
  })

  it('overall matches rollupStatus', () => {
    expect(summarizeResults([{ status: 'ok' }]).overall).toBe(STATUS.OK)
    expect(summarizeResults([{ status: 'degraded' }]).overall).toBe(STATUS.DEGRADED)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Wrapper checks against the mocked client
// ─────────────────────────────────────────────────────────────────────────────
describe('checkDatabase / checkTable', () => {
  it('checkDatabase queries vehicle_fleet and is ok on success', async () => {
    const r = await checkDatabase()
    expect(h.state.tables).toContain('vehicle_fleet')
    expect(r.status).toBe(STATUS.OK)
    expect(r.group).toBe('database')
    expect(typeof r.latencyMs).toBe('number')
  })

  it('maps a query error to down with the error message', async () => {
    h.state.result = { data: null, error: { message: 'relation missing' } }
    const r = await checkTable('tyre_records')
    expect(r.status).toBe(STATUS.DOWN)
    expect(r.detail).toBe('relation missing')
    expect(r.id).toBe('table:tyre_records')
    expect(r.group).toBe('tables')
  })
})

describe('checkAuth', () => {
  it('is ok when getSession resolves (even without a session)', async () => {
    const r = await checkAuth()
    expect(r.status).toBe(STATUS.OK)
    expect(r.detail).toMatch(/no session/i)
  })

  it('is degraded on an auth error response', async () => {
    h.state.sessionResult = { data: null, error: { message: 'refresh failed' } }
    const r = await checkAuth()
    expect(r.status).toBe(STATUS.DEGRADED)
    expect(r.detail).toBe('refresh failed')
  })
})

describe('checkStorage', () => {
  it('is ok when the bucket lists successfully', async () => {
    const r = await checkStorage('tyre-photos')
    expect(h.state.buckets).toContain('tyre-photos')
    expect(r.status).toBe(STATUS.OK)
    expect(r.id).toBe('storage:tyre-photos')
  })

  it('is down when the bucket is missing', async () => {
    h.state.storageResult = { data: null, error: { message: 'Bucket not found' } }
    const r = await checkStorage('nope')
    expect(r.status).toBe(STATUS.DOWN)
    expect(r.detail).toBe('Bucket not found')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runAllChecks — orchestration and isolation
// ─────────────────────────────────────────────────────────────────────────────
describe('runAllChecks', () => {
  beforeEach(() => {
    // Edge-fn pings go through global fetch; stub it so no network is touched.
    // Stub the env too so the suite passes even without a local .env file.
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test-project.supabase.co')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ status: 200 })))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('runs every configured check and returns a summary + timestamp', async () => {
    const { checks, summary, checkedAt } = await runAllChecks()
    const expected = 2 + HEALTH_TABLES.length + HEALTH_BUCKETS.length + HEALTH_EDGE_FUNCTIONS.length
    expect(checks).toHaveLength(expected)
    expect(summary.total).toBe(expected)
    expect(summary.overall).toBe(STATUS.OK)
    expect(new Date(checkedAt).getTime()).not.toBeNaN()
    for (const t of HEALTH_TABLES) expect(h.state.tables).toContain(t)
    for (const b of HEALTH_BUCKETS) expect(h.state.buckets).toContain(b)
  })

  it('one failing subsystem cannot blank the run — others stay ok', async () => {
    h.state.storageResult = { data: null, error: { message: 'storage offline' } }
    const { checks, summary } = await runAllChecks()
    const storage = checks.filter((c) => c.group === 'storage')
    expect(storage.every((c) => c.status === STATUS.DOWN)).toBe(true)
    expect(checks.filter((c) => c.group === 'tables').every((c) => c.status === STATUS.OK)).toBe(true)
    expect(summary.overall).toBe(STATUS.DOWN)
  })

  it('marks edge functions down when fetch rejects (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    const { checks } = await runAllChecks()
    const edge = checks.filter((c) => c.group === 'edge')
    expect(edge).toHaveLength(HEALTH_EDGE_FUNCTIONS.length)
    expect(edge.every((c) => c.status === STATUS.DOWN)).toBe(true)
  })

  it('marks an edge function down on 404 (not deployed)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ status: 404 })))
    const { checks } = await runAllChecks()
    const edge = checks.filter((c) => c.group === 'edge')
    expect(edge.every((c) => c.status === STATUS.DOWN && /404/.test(c.detail))).toBe(true)
  })

  it('treats a 401 CORS-passing response as reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ status: 401 })))
    const { checks } = await runAllChecks()
    const edge = checks.filter((c) => c.group === 'edge')
    expect(edge.every((c) => c.status === STATUS.OK)).toBe(true)
  })
})
