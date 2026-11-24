import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  listConfiguration, getConfiguration, saveConfiguration, setConfigurationScope, invalidateConfiguration,
} from '../lib/configurationStore'

const rows = [{ key: 'currency', value: '"SAR"' }]
const client = (impl) => ({ rpc: vi.fn(impl) })

afterEach(() => setConfigurationScope(''))

describe('configuration read cache', () => {
  it('does not cache before a user is known', async () => {
    setConfigurationScope('')
    const c = client(async () => ({ data: rows, error: null }))
    await listConfiguration(c, 'settings'); await listConfiguration(c, 'settings')
    expect(c.rpc).toHaveBeenCalledTimes(2)
  })

  it('de-duplicates concurrent and repeated reads for the same identity', async () => {
    setConfigurationScope('u1|org1')
    const c = client(() => new Promise((r) => setTimeout(() => r({ data: rows, error: null }), 5)))
    const [a, b] = await Promise.all([listConfiguration(c, 'settings'), listConfiguration(c, 'settings')])
    const again = await listConfiguration(c, 'settings')
    expect(c.rpc).toHaveBeenCalledTimes(1)
    expect(a.data).toEqual(rows); expect(b.data).toEqual(rows); expect(again.data).toEqual(rows)
    // Each caller gets its own copy.
    a.data[0].value = 'changed'
    expect((await listConfiguration(c, 'settings')).data[0].value).toBe('"SAR"')
  })

  it('caches per key and keeps empty distinct from failed', async () => {
    setConfigurationScope('u1|org1')
    const c = client(async () => ({ data: [], error: null }))
    expect((await getConfiguration(c, 'app_settings', 'erp')).data).toBeNull()
    expect((await getConfiguration(c, 'app_settings', 'erp')).data).toBeNull()
    expect(c.rpc).toHaveBeenCalledTimes(1)
    const f = client(async () => ({ data: null, error: { code: '42501' } }))
    expect((await getConfiguration(f, 'app_settings', 'other')).error.code).toBe('42501')
    expect((await getConfiguration(f, 'app_settings', 'other')).error.code).toBe('42501')
    expect(f.rpc).toHaveBeenCalledTimes(2) // failures are never cached
  })

  it('a save drops the namespace so the next read is fresh', async () => {
    setConfigurationScope('u1|org1')
    const c = client(async (fn) => (fn === 'save_organisation_configuration'
      ? { data: { saved: 1 }, error: null } : { data: rows, error: null }))
    await listConfiguration(c, 'settings')
    await getConfiguration(c, 'settings', 'currency')
    await saveConfiguration(c, 'settings', { key: 'currency', value: 'AED' })
    await listConfiguration(c, 'settings')
    await getConfiguration(c, 'settings', 'currency')
    const reads = c.rpc.mock.calls.filter(([fn]) => fn === 'get_organisation_configuration')
    expect(reads).toHaveLength(4)
  })

  it('an identity change never serves another user the cached answer', async () => {
    setConfigurationScope('u1|org1')
    const c = client(async () => ({ data: rows, error: null }))
    await listConfiguration(c, 'settings')
    setConfigurationScope('u2|org1')
    await listConfiguration(c, 'settings')
    expect(c.rpc).toHaveBeenCalledTimes(2)
  })

  it('invalidateConfiguration(namespace, key) forces the next read of that key', async () => {
    setConfigurationScope('u1|org1')
    const c = client(async () => ({ data: rows, error: null }))
    await getConfiguration(c, 'app_settings', 'permission_overrides')
    invalidateConfiguration('app_settings', 'permission_overrides')
    await getConfiguration(c, 'app_settings', 'permission_overrides')
    expect(c.rpc).toHaveBeenCalledTimes(2)
  })
})
