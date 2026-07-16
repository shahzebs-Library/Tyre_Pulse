import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted mock for the chat-ai edge function: supabase.functions.invoke returns
// a configurable { data, error } (or throws). Mirrors the real _client supabase.
const h = vi.hoisted(() => {
  const state = { result: { data: null, error: null }, throws: false, lastBody: null }
  function invoke(name, opts) {
    state.lastName = name
    state.lastBody = opts?.body
    if (state.throws) return Promise.reject(new Error('network down'))
    return Promise.resolve(state.result)
  }
  return { state, supabase: { functions: { invoke } } }
})

vi.mock('./_client', () => ({ supabase: h.supabase }))

const { askDataToFilter, extractJsonObject, SUPPORTED_OPS } = await import('./askData')

const TABLES = ['tyre_records', 'vehicle_fleet', 'accidents']

beforeEach(() => {
  h.state.result = { data: null, error: null }
  h.state.throws = false
  h.state.lastBody = null
  h.state.lastName = null
})

function aiReturns(content, error = null) {
  h.state.result = { data: error ? null : { content }, error }
}

describe('SUPPORTED_OPS', () => {
  it('is the read-only operator whitelist', () => {
    expect(SUPPORTED_OPS).toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'ilike'])
  })
})

describe('extractJsonObject', () => {
  it('extracts a JSON object embedded in prose', () => {
    const out = extractJsonObject('Sure, here you go: {"a": 1} thanks!')
    expect(out).toEqual({ a: 1 })
  })
  it('returns null when there is no JSON', () => {
    expect(extractJsonObject('no json here')).toBeNull()
    expect(extractJsonObject(null)).toBeNull()
  })
})

describe('askDataToFilter', () => {
  it('parses a clean JSON AI response into { ok:true, filter }', async () => {
    aiReturns('{"table":"tyre_records","column":"serial_no","op":"ilike","value":"AB123"}')
    const res = await askDataToFilter('find tyre serial AB123', { tables: TABLES })
    expect(res.ok).toBe(true)
    expect(res.filter).toEqual({
      table: 'tyre_records',
      column: 'serial_no',
      op: 'ilike',
      value: 'AB123',
    })
    expect(typeof res.explanation).toBe('string')
    // It calls the chat-ai edge function with a scoped body.
    expect(h.state.lastName).toBe('chat-ai')
    expect(h.state.lastBody.user).toBe('find tyre serial AB123')
  })

  it('extracts JSON even when the AI wraps it in prose / code fences', async () => {
    aiReturns('```json\nHere is the filter: {"table":"accidents","column":"site","op":"eq","value":"NHC"}\n```')
    const res = await askDataToFilter('accidents at NHC', { tables: TABLES })
    expect(res.ok).toBe(true)
    expect(res.filter.table).toBe('accidents')
    expect(res.filter.value).toBe('NHC')
  })

  it('accepts numeric values', async () => {
    aiReturns('{"table":"vehicle_fleet","column":"current_km","op":"gt","value":100000}')
    const res = await askDataToFilter('vehicles over 100000 km', { tables: TABLES })
    expect(res.ok).toBe(true)
    expect(res.filter.value).toBe(100000)
  })

  it('rejects a table not in the provided list', async () => {
    aiReturns('{"table":"secret_table","column":"x","op":"eq","value":"y"}')
    const res = await askDataToFilter('anything', { tables: TABLES })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/manual filters/i)
  })

  it('rejects a disallowed operator', async () => {
    aiReturns('{"table":"tyre_records","column":"serial_no","op":"like","value":"AB"}')
    const res = await askDataToFilter('anything', { tables: TABLES })
    expect(res.ok).toBe(false)
  })

  it('returns { ok:false } on unusable / non-JSON AI output', async () => {
    aiReturns('I am not sure what you mean.')
    const res = await askDataToFilter('anything', { tables: TABLES })
    expect(res.ok).toBe(false)
  })

  it('returns { ok:false } when the edge function reports an error (never throws)', async () => {
    aiReturns(null, { message: 'ANTHROPIC_API_KEY is not set' })
    const res = await askDataToFilter('anything', { tables: TABLES })
    expect(res.ok).toBe(false)
  })

  it('returns { ok:false } when invoke throws (never throws)', async () => {
    h.state.throws = true
    const res = await askDataToFilter('anything', { tables: TABLES })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/manual filters/i)
  })

  it('returns { ok:false } for an empty question or no tables', async () => {
    expect((await askDataToFilter('', { tables: TABLES })).ok).toBe(false)
    expect((await askDataToFilter('hi', { tables: [] })).ok).toBe(false)
  })
})
