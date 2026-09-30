/**
 * REGRESSION GUARD: an inspection queued WHILE a sync is uploading must survive.
 *
 * doSyncQueue used to read the queue once, await the network per item, and then
 * write its whole (now stale) snapshot back after each item. An inspection
 * enqueued in that window was silently overwritten and lost. The sync now merges
 * each item's outcome by id into the CURRENT queue under a write lock.
 */
const store = new Map<string, string>()

jest.mock('../lib/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    setItem: jest.fn(async (k: string, v: string) => { store.set(k, v) }),
    removeItem: jest.fn(async (k: string) => { store.delete(k) }),
  },
  readItem: jest.fn(async (k: string) => (
    store.has(k) ? { value: store.get(k)!, status: 'ok' } : { value: null, status: 'absent' }
  )),
}))

// The upsert blocks until the test releases it, so an enqueue can land mid-sync.
let release: () => void = () => {}
const upsert = jest.fn(() => new Promise<{ error: null }>(resolve => {
  release = () => resolve({ error: null })
}))
jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn(() => ({ upsert })) } }))
jest.mock('../lib/photoUpload', () => ({ uploadAllPositionPhotos: jest.fn(async () => {}) }))
jest.mock('../lib/notifications', () => ({
  notifySyncSuccess: jest.fn(async () => {}),
  notifySyncFailure: jest.fn(async () => {}),
}))

import { getQueue, syncQueue, enqueueInspection } from '../lib/offlineQueue'

const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => { store.clear(); upsert.mockClear() })

describe('offline inspection queue concurrency', () => {
  it('keeps an inspection enqueued while a sync is in flight', async () => {
    await enqueueInspection({ asset_no: 'A1' } as any, 'first')
    const syncing = syncQueue()
    // Let the sync reach the (blocked) upsert for 'first'.
    for (let i = 0; i < 5 && upsert.mock.calls.length === 0; i++) await flush()
    expect(upsert).toHaveBeenCalledTimes(1)

    await enqueueInspection({ asset_no: 'A2' } as any, 'second')
    release()
    await syncing

    const q = await getQueue()
    const byId = Object.fromEntries(q.map(i => [i.id, i.sync_status]))
    expect(byId.first).toBe('synced')
    // The whole point: the mid-sync inspection is still there, still pending.
    expect(byId.second).toBe('pending')
  })

  it('does not queue the same client id twice', async () => {
    await enqueueInspection({ asset_no: 'A1' } as any, 'dup')
    await enqueueInspection({ asset_no: 'A1' } as any, 'dup')
    expect((await getQueue()).filter(i => i.id === 'dup')).toHaveLength(1)
  })
})
