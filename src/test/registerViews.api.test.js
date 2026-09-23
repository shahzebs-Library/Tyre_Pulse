import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The service must behave perfectly while `user_view_prefs` does NOT exist,
 * because its migration ships unapplied. A register that shows an error banner
 * for a feature the owner has not switched on yet is worse than one that simply
 * forgets the layout.
 */
const state = { rows: [], error: null }

vi.mock('../lib/api/_client', () => {
  const thenable = (result) => {
    const b = {
      select: () => b,
      eq: () => b,
      order: () => b,
      upsert: () => Promise.resolve(result),
      delete: () => b,
      update: () => b,
      then: (res, rej) => Promise.resolve(result).then(res, rej),
    }
    return b
  }
  return {
    supabase: { from: () => thenable({ data: state.rows, error: state.error }) },
    // Mirrors the real detector: a missing relation ALWAYS carries a code.
    isMissingRelation: (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205'),
  }
})

import { listSavedViews, loadView, saveView, deleteView, setDefaultView } from '../lib/api/registerViews'

const CATALOG = [
  { key: 'asset', label: 'Asset' },
  { key: 'site', label: 'Site' },
  { key: 'cost', label: 'Cost' },
]

beforeEach(() => { state.rows = []; state.error = null })

describe('savedViews service - unprovisioned', () => {
  it('lists nothing instead of erroring when the table does not exist', async () => {
    state.error = { code: '42P01', message: 'relation "user_view_prefs" does not exist' }
    await expect(listSavedViews('work_orders')).resolves.toEqual([])
  })

  it('still hands the register a usable view when the table does not exist', async () => {
    state.error = { code: '42P01' }
    const { view, provisioned } = await loadView('work_orders', CATALOG)
    expect(provisioned).toBe(false)
    // The catalog still drives the columns, so the table renders correctly.
    expect(view.columns).toEqual(['asset', 'site', 'cost'])
  })

  it('reports a save as not-provisioned rather than throwing', async () => {
    state.error = { code: 'PGRST205' }
    await expect(saveView('work_orders', { columns: ['asset'] })).resolves.toEqual({ ok: false, reason: 'not-provisioned' })
  })
})

describe('savedViews service - provisioned', () => {
  it('prefers the default view over the unnamed arrangement', async () => {
    state.rows = [
      { id: 'd', name: 'Finance', is_default: true, view: { columns: ['cost', 'asset'] } },
      { id: 'c', name: '', is_default: false, view: { columns: ['asset'] } },
    ]
    const { view, id, provisioned } = await loadView('work_orders', CATALOG)
    expect(provisioned).toBe(true)
    expect(id).toBe('d')
    expect(view.columns[0]).toBe('cost')
  })

  it('reconciles a stored view against the CURRENT catalog on load', async () => {
    // Stored before `cost` shipped and while `legacy` still existed.
    state.rows = [{ id: 'c', name: '', is_default: false, view: { columns: ['asset', 'legacy'] } }]
    const { view } = await loadView('work_orders', CATALOG)
    expect(view.columns).toContain('cost')      // newly shipped -> appears
    expect(view.hidden).not.toContain('cost')
    expect(view.columns).not.toContain('legacy') // retired -> dropped
  })

  it('does not persist moduleKey/name inside the blob - they are columns', async () => {
    let sent = null
    const mod = await import('../lib/api/_client')
    vi.spyOn(mod.supabase, 'from').mockReturnValue({
      upsert: (p) => { sent = p; return Promise.resolve({ error: null }) },
    })
    await saveView('work_orders', { moduleKey: 'work_orders', name: 'X', columns: ['asset'] }, { name: 'X' })
    expect(sent.view.moduleKey).toBeUndefined()
    expect(sent.view.name).toBeUndefined()
    expect(sent.module_key).toBe('work_orders')
    expect(sent.name).toBe('X')
    vi.restoreAllMocks()
  })

  it('refuses a save with no module rather than writing a junk row', async () => {
    await expect(saveView('', {})).resolves.toEqual({ ok: false, reason: 'no-module' })
  })

  it('refuses a delete with no id', async () => {
    await expect(deleteView('')).resolves.toEqual({ ok: false, reason: 'no-id' })
  })

  it('setDefaultView refuses without an id', async () => {
    await expect(setDefaultView('work_orders', '')).resolves.toEqual({ ok: false, reason: 'no-id' })
  })

  it('never rejects, whatever the client throws', async () => {
    const mod = await import('../lib/api/_client')
    vi.spyOn(mod.supabase, 'from').mockImplementation(() => { throw new Error('network down') })
    await expect(listSavedViews('work_orders')).resolves.toEqual([])
    await expect(saveView('work_orders', {})).resolves.toEqual({ ok: false, reason: 'save-failed' })
    await expect(deleteView('x')).resolves.toEqual({ ok: false, reason: 'delete-failed' })
    vi.restoreAllMocks()
  })
})
