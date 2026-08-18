/**
 * A chunked SecureStore write must never destroy the previous value.
 *
 * WHY THIS EXISTS. This adapter holds the Supabase auth session AND both offline
 * queues (an inspector's unsynced field work). setItem used to call removeItem
 * FIRST and only then write the new chunks, so between those two steps the old
 * value was gone and the new one did not exist. Every way of landing in that gap
 * is real on this app's hardware: SecureStore.setItemAsync goes to the Android
 * Keystore over binder IPC and can reject (a key invalidated by a lock-screen
 * change, a restore from backup, or the slow/stalled calls this build has
 * already been ANR-reported for), and the process can be killed the moment the
 * user backgrounds it.
 *
 * The damage compounded: getItem returns null when any chunk is missing, and
 * both queue readers turn that into an empty list - so a half-written queue read
 * as "nothing pending", the pending badge showed 0, and the next save overwrote
 * whatever was left. The user was told everything had synced.
 *
 * These tests drive the real adapter against an in-memory SecureStore that can
 * be made to fail on demand. None of this is visible to tsc: the old code
 * compiles and works perfectly whenever nothing fails.
 */

type Store = Record<string, string>
const store: Store = {}
let failWritesMatching: RegExp | null = null
let failReadsMatching: RegExp | null = null

const setItemAsync = jest.fn(async (k: string, v: string) => {
  if (failWritesMatching?.test(k)) throw new Error('Could not encrypt the item in SecureStore')
  store[k] = v
})
const getItemAsync = jest.fn(async (k: string) => {
  if (failReadsMatching?.test(k)) throw new Error('Could not decrypt the item in SecureStore')
  return k in store ? store[k] : null
})
const deleteItemAsync = jest.fn(async (k: string) => { delete store[k] })

jest.mock('expo-secure-store', () => ({
  setItemAsync: (...a: any[]) => (setItemAsync as any)(...a),
  getItemAsync: (...a: any[]) => (getItemAsync as any)(...a),
  deleteItemAsync: (...a: any[]) => (deleteItemAsync as any)(...a),
}))

import { secureStorage } from '../lib/secureStorage'

const KEY = 'tp_inspection_queue_v1'
/** Comfortably past the 1800-char chunk size, so this is a multi-chunk value. */
const big = (marker: string) => marker.repeat(2000)

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  failWritesMatching = null
  failReadsMatching = null
  setItemAsync.mockClear()
  getItemAsync.mockClear()
  deleteItemAsync.mockClear()
})

describe('secureStorage round trips', () => {
  it('stores and returns a small value', async () => {
    await secureStorage.setItem(KEY, 'small')
    expect(await secureStorage.getItem(KEY)).toBe('small')
  })

  it('stores and returns a value larger than one slot', async () => {
    const v = big('A')
    await secureStorage.setItem(KEY, v)
    expect(await secureStorage.getItem(KEY)).toBe(v)
  })

  it('replaces a large value with another large value', async () => {
    await secureStorage.setItem(KEY, big('A'))
    await secureStorage.setItem(KEY, big('B'))
    expect(await secureStorage.getItem(KEY)).toBe(big('B'))
  })

  it('replaces a large value with a small one, and back', async () => {
    await secureStorage.setItem(KEY, big('A'))
    await secureStorage.setItem(KEY, 'tiny')
    expect(await secureStorage.getItem(KEY)).toBe('tiny')
    await secureStorage.setItem(KEY, big('C'))
    expect(await secureStorage.getItem(KEY)).toBe(big('C'))
  })

  it('removeItem clears the value', async () => {
    await secureStorage.setItem(KEY, big('A'))
    await secureStorage.removeItem(KEY)
    expect(await secureStorage.getItem(KEY)).toBeNull()
  })
})

describe('a failed write must leave the previous value intact', () => {
  it('keeps the whole previous queue when a chunk write rejects', async () => {
    const previous = big('A')
    await secureStorage.setItem(KEY, previous)

    // The keystore starts refusing chunk writes partway through the next save.
    failWritesMatching = /_chunk_/
    await expect(secureStorage.setItem(KEY, big('B'))).rejects.toThrow()

    // THE INVARIANT: the inspector's queued work is still readable, in full.
    expect(await secureStorage.getItem(KEY)).toBe(previous)
  })

  it('keeps the previous value when the commit itself rejects', async () => {
    const previous = big('A')
    await secureStorage.setItem(KEY, previous)

    // Chunks land, the metadata write - the commit point - does not.
    failWritesMatching = /_meta$/
    await expect(secureStorage.setItem(KEY, big('B'))).rejects.toThrow()

    expect(await secureStorage.getItem(KEY)).toBe(previous)
  })

  it('never reads back a half-written value as a shorter one', async () => {
    await secureStorage.setItem(KEY, big('A'))
    failWritesMatching = /_chunk_/
    await secureStorage.setItem(KEY, big('B')).catch(() => {})

    const read = await secureStorage.getItem(KEY)
    // Either the old value or nothing - never a truncated splice of both, which
    // would be handed to JSON.parse as a corrupt queue.
    expect(read).toBe(big('A'))
  })
})

describe('reads degrade instead of rejecting', () => {
  it('returns null rather than throwing when the keystore refuses to decrypt', async () => {
    await secureStorage.setItem(KEY, big('A'))
    failReadsMatching = /_chunk_/
    // A rejection here would propagate into supabase-js's session bootstrap.
    await expect(secureStorage.getItem(KEY)).resolves.toBeNull()
  })

  it('falls back to the unchunked slot when the metadata is corrupt', async () => {
    store[KEY] = 'plain'
    store[`${KEY}_meta`] = '{not json'
    expect(await secureStorage.getItem(KEY)).toBe('plain')
  })
})

describe('values written by an older build are still readable', () => {
  it('reads legacy chunk keys, which carry no generation', async () => {
    // Exactly what the pre-staged-write adapter left on a device.
    store[`${KEY}_meta`] = JSON.stringify({ chunks: 2 })
    store[`${KEY}_chunk_0`] = 'legacy-'
    store[`${KEY}_chunk_1`] = 'value'
    expect(await secureStorage.getItem(KEY)).toBe('legacy-value')
  })

  it('replaces a legacy value and cleans its old chunks up', async () => {
    store[`${KEY}_meta`] = JSON.stringify({ chunks: 2 })
    store[`${KEY}_chunk_0`] = 'legacy-'
    store[`${KEY}_chunk_1`] = 'value'

    await secureStorage.setItem(KEY, big('N'))
    expect(await secureStorage.getItem(KEY)).toBe(big('N'))
    expect(store[`${KEY}_chunk_0`]).toBeUndefined()
    expect(store[`${KEY}_chunk_1`]).toBeUndefined()
  })
})
