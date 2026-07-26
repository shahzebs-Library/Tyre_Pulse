/**
 * Focused tests for lib/offlineQueue.ts queue-visibility semantics.
 *
 * offlineQueue imports native-backed modules (secure store, photo upload,
 * notifications, supabase). Every one is replaced with an in-memory mock below,
 * so this stays inside the pure Node + ts-jest project (no jest-expo, no native
 * module ever loads) per the note in jest.config.js.
 *
 * REGRESSION GUARD: getPendingCount() must count 'failed' as well as 'pending'.
 * Counting only 'pending' made a failed inspection invisible in every unsynced
 * indicator (tab badge, Home tile, Profile "Pending", SyncBanner), so the banner
 * that carries the in-context retry action disappeared and the user was told
 * "all synced" while an inspection sat unsent.
 */

// ---- in-memory secure storage -------------------------------------------------
const store = new Map<string, string>()

jest.mock('../lib/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    setItem: jest.fn(async (k: string, v: string) => { store.set(k, v) }),
    removeItem: jest.fn(async (k: string) => { store.delete(k) }),
  },
}))

jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn() } }))
jest.mock('../lib/photoUpload', () => ({ uploadAllPositionPhotos: jest.fn(async () => {}) }))
jest.mock('../lib/notifications', () => ({
  notifySyncSuccess: jest.fn(async () => {}),
  notifySyncFailure: jest.fn(async () => {}),
}))

import { getQueue, getPendingCount, retryFailed, clearSynced } from '../lib/offlineQueue'
import type { OfflineInspection } from '../lib/types'

const QUEUE_KEY = 'tp_inspection_queue_v1'

/** Seed the queue directly so we exercise counting/retry without a sync run. */
function seed(statuses: OfflineInspection['sync_status'][]): void {
  const rows = statuses.map((sync_status, n) => ({
    id: `local_${n}`,
    payload: { asset_no: `A${n}` },
    sync_status,
    created_at: '2026-07-26T00:00:00.000Z',
    synced_at: sync_status === 'synced' ? '2026-07-26T01:00:00.000Z' : null,
    error: sync_status === 'failed' ? 'network request failed' : null,
  }))
  store.set(QUEUE_KEY, JSON.stringify(rows))
}

beforeEach(() => { store.clear() })

describe('getPendingCount', () => {
  it('counts a failed inspection as unsynced work', async () => {
    seed(['failed'])
    // The whole point: one failure must NOT read as "nothing to sync".
    expect(await getPendingCount()).toBe(1)
  })

  it('counts pending and failed together, excluding synced', async () => {
    seed(['pending', 'failed', 'synced', 'failed'])
    expect(await getPendingCount()).toBe(3)
  })

  it('returns 0 only when everything really is synced', async () => {
    seed(['synced', 'synced'])
    expect(await getPendingCount()).toBe(0)
  })

  it('returns 0 for an empty or absent queue', async () => {
    expect(await getPendingCount()).toBe(0)
    seed([])
    expect(await getPendingCount()).toBe(0)
  })
})

describe('retryFailed', () => {
  it('re-arms failed items as pending and clears their error', async () => {
    seed(['failed', 'synced', 'pending'])
    await retryFailed()

    const q = await getQueue()
    expect(q.map(i => i.sync_status)).toEqual(['pending', 'synced', 'pending'])
    expect(q[0].error).toBeNull()
    // Still counted before and after: the item never goes invisible.
    expect(await getPendingCount()).toBe(2)
  })
})

describe('clearSynced', () => {
  it('never drops a failed item', async () => {
    seed(['failed', 'synced', 'pending'])
    await clearSynced()

    const q = await getQueue()
    expect(q.map(i => i.sync_status).sort()).toEqual(['failed', 'pending'])
    expect(await getPendingCount()).toBe(2)
  })
})
