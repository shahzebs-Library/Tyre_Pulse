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
  // The real module also exports readItem, which is what every read-modify-write
  // on a queue now uses: it distinguishes "nothing is queued" from "the Keystore
  // refused to answer", so a torn read can never be saved back as an empty
  // queue. The mock must expose it or the code under test reads `undefined` and
  // the mock, not the code, is what fails.
  readItem: jest.fn(async (k: string) => (
    store.has(k) ? { value: store.get(k)!, status: 'ok' } : { value: null, status: 'absent' }
  )),
}))

jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn() } }))
jest.mock('../lib/photoUpload', () => ({ uploadAllPositionPhotos: jest.fn(async () => {}) }))
jest.mock('../lib/notifications', () => ({
  notifySyncSuccess: jest.fn(async () => {}),
  notifySyncFailure: jest.fn(async () => {}),
}))

import { getQueue, getPendingCount, retryFailed, clearSynced, enqueueInspection } from '../lib/offlineQueue'
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

/**
 * THE WORST THING THIS APP CAN DO IS LOSE A FIELD WORKER'S UNSYNCED WORK.
 *
 * The path was: the Android Keystore refuses one read, getQueue() cannot say
 * anything except [], and the caller then SAVES what it read. A queue of real
 * inspections is replaced by an empty list, silently, with no error anywhere -
 * and that queue was the only copy in existence. These tests pin the refusal.
 */
describe('a queue that cannot be read is never overwritten', () => {
  const { readItem } = require('../lib/secureStorage')

  function seedRaw(rows: any[]): void {
    store.set(QUEUE_KEY, JSON.stringify(rows))
  }
  function stored(): any[] {
    return JSON.parse(store.get(QUEUE_KEY) as string)
  }

  beforeEach(() => {
    store.clear()
    ;(readItem as jest.Mock).mockImplementation(async (k: string) => (
      store.has(k) ? { value: store.get(k)!, status: 'ok' } : { value: null, status: 'absent' }
    ))
  })

  for (const status of ['torn', 'unreadable']) {
    it(`clearSynced leaves the queue alone when the read is ${status}`, async () => {
      seedRaw([
        { id: 'a', sync_status: 'pending', payload: {} },
        { id: 'b', sync_status: 'synced', payload: {} },
      ])
      ;(readItem as jest.Mock).mockResolvedValueOnce({ value: null, status })

      await expect(clearSynced()).rejects.toThrow(/could not be read/i)

      // The pending inspection is still there. Before the fix this was [].
      expect(stored()).toHaveLength(2)
      expect(stored().map((r: any) => r.id)).toEqual(['a', 'b'])
    })

    it(`enqueue refuses rather than replacing the queue when the read is ${status}`, async () => {
      seedRaw([{ id: 'a', sync_status: 'pending', payload: {} }])
      ;(readItem as jest.Mock).mockResolvedValueOnce({ value: null, status })

      // Deliberate trade: we risk failing to save ONE new item rather than
      // silently destroying every item already queued.
      await expect(enqueueInspection({} as any)).rejects.toThrow(/could not be read/i)
      expect(stored()).toHaveLength(1)
      expect(stored()[0].id).toBe('a')
    })
  }

  it('an ABSENT store is still trusted, so a first enqueue works normally', () => {
    // 'absent' is a real answer, not a failure. Refusing it would mean nothing
    // could ever be queued on a fresh install.
    expect(store.has(QUEUE_KEY)).toBe(false)
    return enqueueInspection({} as any).then(() => {
      expect(stored()).toHaveLength(1)
    })
  })
})
