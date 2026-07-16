import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted Supabase mock: a chainable, thenable query builder that resolves to a
// configurable { data, error } and records the table + last update payload.
const h = vi.hoisted(() => {
  const state = { result: { data: null, error: null }, table: null, update: null }
  function builder() {
    const b = {
      select: () => b,
      order: () => b,
      eq: () => b,
      in: () => b,
      single: () => b,
      upsert: () => b,
      update: (payload) => { state.update = payload; return b },
      then: (onF, onR) => Promise.resolve(state.result).then(onF, onR),
    }
    return b
  }
  const supabase = {
    from: (table) => { state.table = table; return builder() },
  }
  return { state, supabase }
})

vi.mock('../supabase', () => ({ supabase: h.supabase }))

const reg = await import('./modulesRegistry')

beforeEach(() => {
  h.state.result = { data: null, error: null }
  h.state.table = null
  h.state.update = null
})

describe('service layer - modules registry', () => {
  it('setModuleStatus updates { status } and returns the row', async () => {
    const row = { module_id: 'reports', name: 'Reports', status: 'maintenance' }
    h.state.result = { data: row, error: null }
    const out = await reg.setModuleStatus('reports', 'maintenance')
    expect(h.state.table).toBe('modules')
    expect(h.state.update).toMatchObject({ status: 'maintenance' })
    expect(h.state.update.last_updated).toBeTruthy()
    expect(out).toEqual(row)
  })

  it('listModules degrades to [] when the table is missing', async () => {
    h.state.result = { data: null, error: { message: 'relation "modules" does not exist', code: '42P01' } }
    expect(await reg.listModules()).toEqual([])
  })

  it('listModules returns the rows on success', async () => {
    const rows = [{ module_id: 'analytics', name: 'Analytics', category: 'Analytics & KPIs', status: 'live' }]
    h.state.result = { data: rows, error: null }
    expect(await reg.listModules()).toEqual(rows)
  })

  it('dependencyWarnings warns for a live dependent and is silent otherwise', async () => {
    const modules = [
      { module_id: 'analytics', name: 'Analytics', status: 'live', depends_on: [] },
      { module_id: 'reports', name: 'Reports', status: 'live', depends_on: ['analytics'] },
    ]
    // Taking Analytics down warns because live Reports depends on it.
    expect(reg.dependencyWarnings(modules, 'analytics', 'disabled'))
      .toEqual(['Reports depends on Analytics'])
    expect(reg.dependencyWarnings(modules, 'analytics', 'maintenance'))
      .toEqual(['Reports depends on Analytics'])

    // Bringing it Live (or Beta) never warns.
    expect(reg.dependencyWarnings(modules, 'analytics', 'live')).toEqual([])

    // Nothing depends on Reports -> no warning.
    expect(reg.dependencyWarnings(modules, 'reports', 'disabled')).toEqual([])

    // A dependent that is itself out of service is not warned about.
    const offDependent = [
      { module_id: 'analytics', name: 'Analytics', status: 'live', depends_on: [] },
      { module_id: 'reports', name: 'Reports', status: 'disabled', depends_on: ['analytics'] },
    ]
    expect(reg.dependencyWarnings(offDependent, 'analytics', 'disabled')).toEqual([])
  })
})
