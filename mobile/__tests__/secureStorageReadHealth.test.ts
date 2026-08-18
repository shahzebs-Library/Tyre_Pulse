/**
 * A FAILED READ MUST NOT LOOK LIKE A SIGNED-OUT USER.
 *
 * `getItem` can only answer `string | null`, and supabase-js reads `null` as
 * "there is no session on this device" - so it signs the user out. On this app's
 * hardware a Keystore call refusing is routine (binder IPC, ANR-reported on the
 * low-end handsets this fleet uses), and when it happened the session bytes were
 * still sitting on the device while the user was dropped onto a login screen.
 *
 * These people are tyre men and drivers whose accounts were created for them by
 * an admin: most do not know their own username and none know their password. A
 * spurious bounce to login is a person who cannot work, and whose queued offline
 * inspections are stranded behind a screen they cannot pass.
 *
 * So the adapter now (a) retries a REJECTED read before concluding anything and
 * (b) reports WHY a read came back empty. These tests pin both against an
 * in-memory SecureStore that can be made to fail on demand. None of it is
 * visible to tsc - the old code compiles and behaves perfectly whenever nothing
 * fails, which is exactly why it survived.
 */

type Store = Record<string, string>
const store: Store = {}

/** Reads matching this pattern reject. `failReadsTimes` limits how many times,
 *  so a TRANSIENT failure (the common case) can be told from a permanent one. */
let failReadsMatching: RegExp | null = null
let failReadsTimes = Infinity
const readAttempts: Record<string, number> = {}

const setItemAsync = jest.fn(async (k: string, v: string) => { store[k] = v })
const getItemAsync = jest.fn(async (k: string) => {
  readAttempts[k] = (readAttempts[k] ?? 0) + 1
  if (failReadsMatching?.test(k) && readAttempts[k] <= failReadsTimes) {
    throw new Error('Could not decrypt the item in SecureStore')
  }
  return k in store ? store[k] : null
})
const deleteItemAsync = jest.fn(async (k: string) => { delete store[k] })

jest.mock('expo-secure-store', () => ({
  setItemAsync: (...a: any[]) => (setItemAsync as any)(...a),
  getItemAsync: (...a: any[]) => (getItemAsync as any)(...a),
  deleteItemAsync: (...a: any[]) => (deleteItemAsync as any)(...a),
}))

import { secureStorage, readItem, storageReadFailureCount } from '../lib/secureStorage'

/** The real Supabase auth slot name shape. Multi-chunk, like a real session. */
const KEY = 'sb-project-auth-token'
const big = (marker: string) => marker.repeat(2000)

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  for (const k of Object.keys(readAttempts)) delete readAttempts[k]
  failReadsMatching = null
  failReadsTimes = Infinity
  setItemAsync.mockClear()
  getItemAsync.mockClear()
  deleteItemAsync.mockClear()
})

describe('readItem tells apart "nothing stored" from "could not read"', () => {
  it('reports absent for a device that has genuinely never signed in', async () => {
    const read = await readItem(KEY)
    expect(read).toEqual({ value: null, status: 'absent' })
  })

  it('does NOT count a genuinely empty slot as a read failure', async () => {
    // THE POINT: a real first launch must still reach the login screen. If
    // `absent` incremented the failure counter, every new phone would be sent to
    // the retry screen instead.
    const before = storageReadFailureCount()
    await readItem(KEY)
    expect(storageReadFailureCount()).toBe(before)
  })

  it('reports ok with the full value for a stored multi-chunk session', async () => {
    const session = big('S')
    await secureStorage.setItem(KEY, session)
    expect(await readItem(KEY)).toEqual({ value: session, status: 'ok' })
  })

  it('reports unreadable, NOT absent, when the keystore refuses a chunk', async () => {
    await secureStorage.setItem(KEY, big('S'))
    failReadsMatching = /_chunk_/

    const read = await readItem(KEY)
    // `absent` here is the bug: it is what told supabase-js the user was signed
    // out while their session sat on the device.
    expect(read.status).toBe('unreadable')
    expect(read.value).toBeNull()
  })

  it('reports unreadable when the keystore refuses the METADATA slot', async () => {
    await secureStorage.setItem(KEY, big('S'))
    failReadsMatching = /_meta$/

    // Falling back to the unchunked slot here would find nothing and report a
    // signed-out user, when in truth we never learned whether chunks exist.
    expect((await readItem(KEY)).status).toBe('unreadable')
  })

  it('reports torn when a committed chunk set is incomplete', async () => {
    await secureStorage.setItem(KEY, big('S'))
    const metaRaw = store[`${KEY}_meta`]
    const gen = JSON.parse(metaRaw).gen
    delete store[`${KEY}_g${gen}_chunk_1`]

    // Metadata was committed, so a value WAS written here. Unrecoverable, but
    // still not evidence that this device was never signed in.
    const read = await readItem(KEY)
    expect(read.status).toBe('torn')
    expect(read.value).toBeNull()
  })

  it('still falls back to the unchunked slot when the metadata is corrupt', async () => {
    store[KEY] = 'plain'
    store[`${KEY}_meta`] = '{not json'
    // A metadata slot we READ FINE and could not parse is a different answer
    // from one we could not read at all.
    expect(await readItem(KEY)).toEqual({ value: 'plain', status: 'ok' })
  })
})

describe('a transient keystore failure is retried, not believed', () => {
  it('recovers the whole session when the first read attempt rejects', async () => {
    const session = big('S')
    await secureStorage.setItem(KEY, session)

    // One refusal per slot, then the keystore behaves. This is the ordinary
    // binder hiccup, and before the retry it cost the user their session.
    failReadsMatching = /./
    failReadsTimes = 1

    expect(await readItem(KEY)).toEqual({ value: session, status: 'ok' })
    expect(await secureStorage.getItem(KEY)).toBe(session)
  })

  it('recovers an offline QUEUE that a transient failure would have zeroed', async () => {
    // The same adapter holds unsynced field work. A null read there is turned
    // into an empty list by both queue readers, and the next save writes that
    // empty list back - an inspector's queued work destroyed, silently.
    const QUEUE = 'tp_inspection_queue_v1'
    const queue = JSON.stringify([{ id: 'a', sync_status: 'pending' }, { id: 'b', sync_status: 'pending' }])
    await secureStorage.setItem(QUEUE, queue.padEnd(4000, ' '))

    failReadsMatching = /./
    failReadsTimes = 1

    expect(await secureStorage.getItem(QUEUE)).not.toBeNull()
  })

  it('gives up and reports unreadable when the failure is permanent', async () => {
    await secureStorage.setItem(KEY, big('S'))
    failReadsMatching = /./

    const before = storageReadFailureCount()
    expect((await readItem(KEY)).status).toBe('unreadable')
    // The counter is what lets the caller distinguish an empty session it can
    // believe from one it cannot.
    expect(storageReadFailureCount()).toBeGreaterThan(before)
  })
})

describe('getItem keeps its exact old contract', () => {
  it('returns the value, or null for anything that is not a complete read', async () => {
    await secureStorage.setItem(KEY, 'small')
    expect(await secureStorage.getItem(KEY)).toBe('small')

    failReadsMatching = /./
    // A rejection here would propagate into supabase-js's session bootstrap.
    await expect(secureStorage.getItem(KEY)).resolves.toBeNull()
  })
})
