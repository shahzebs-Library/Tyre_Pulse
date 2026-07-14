import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const state = { result: { data: [], error: null }, last: null }
  function from(table) {
    const calls = { eq: [], select: null, insert: null, update: null, delete: false, order: null }
    const b = {
      _table: table, _calls: calls,
      select(c) { calls.select = c; return b },
      order(c, o) { calls.order = [c, o]; return b },
      insert(v) { calls.insert = v; return b },
      update(v) { calls.update = v; return b },
      delete() { calls.delete = true; return b },
      eq(c, v) { calls.eq.push([c, v]); return b },
      single() { return Promise.resolve(state.result) },
      then(f, r) { return Promise.resolve(state.result).then(f, r) },
    }
    state.last = b
    return b
  }
  return { state, supabase: { from } }
})

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))

const api = await import('../lib/api/accidentReportTemplates')
const { ServiceError } = await import('../lib/api/_client')

beforeEach(() => { h.state.result = { data: [], error: null }; h.state.last = null })

describe('accidentReportTemplates service', () => {
  it('lists templates ordered by updated_at desc with the full column set', async () => {
    h.state.result = { data: [{ id: 't1', name: 'Weekly', config: {} }], error: null }
    const rows = await api.listTemplates()
    expect(h.state.last._table).toBe('accident_report_templates')
    expect(h.state.last._calls.order).toEqual(['updated_at', { ascending: false }])
    expect(h.state.last._calls.select).toContain('config')
    expect(rows).toEqual([{ id: 't1', name: 'Weekly', config: {} }])
  })

  it('degrades to [] when the table is not migrated yet', async () => {
    h.state.result = { data: null, error: { message: 'relation "accident_report_templates" does not exist', code: '42P01' } }
    await expect(api.listTemplates()).resolves.toEqual([])
  })

  it('createTemplate inserts name + config and returns the row', async () => {
    h.state.result = { data: { id: 't2', name: 'A', config: { blocks: [] } }, error: null }
    const row = await api.createTemplate({ name: 'A', config: { blocks: [] } })
    expect(h.state.last._calls.insert).toMatchObject({ name: 'A', config: { blocks: [] } })
    expect(row.id).toBe('t2')
  })

  it('updateTemplate patches by id', async () => {
    h.state.result = { data: { id: 't3' }, error: null }
    await api.updateTemplate('t3', { name: 'B' })
    expect(h.state.last._calls.update).toEqual({ name: 'B' })
    expect(h.state.last._calls.eq).toContainEqual(['id', 't3'])
  })

  it('deleteTemplate deletes by id and throws ServiceError on failure', async () => {
    await api.deleteTemplate('t4')
    expect(h.state.last._calls.delete).toBe(true)
    expect(h.state.last._calls.eq).toContainEqual(['id', 't4'])

    h.state.result = { data: null, error: { message: 'boom', code: '500' } }
    await expect(api.deleteTemplate('t5')).rejects.toBeInstanceOf(ServiceError)
  })
})
