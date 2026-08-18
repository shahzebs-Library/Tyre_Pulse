import * as SecureStore from 'expo-secure-store'

const CHUNK_SIZE = 1800

/**
 * Chunked SecureStore adapter. A Supabase session is far larger than one
 * SecureStore slot, so values are split across several keys; this same adapter
 * also holds both offline queues (unsynced field work).
 *
 * WHY THE WRITE IS STAGED. setItem used to call removeItem FIRST and only then
 * write the new chunks. That leaves a window in which the previous value is
 * already gone and the new one does not exist yet, and everything in that window
 * is a real, reachable failure: SecureStore.setItemAsync goes to the Android
 * Keystore over binder IPC and can reject (a keystore key invalidated by a
 * lock-screen change, a restore from backup, or simply the slow/stalled calls
 * this app has already been ANR-reported for), and the process can be killed at
 * any moment because the user backgrounded it. Interrupted there, the value was
 * unrecoverable - for the auth session that is a forced re-login, and for the
 * queues it is an inspector's unsynced work destroyed with no error shown.
 *
 * It also produced the OTHER half of the same bug: getItem returns null when any
 * chunk is missing, and both queue readers turn that into an empty list, so a
 * half-written queue reads as "nothing pending" and the next save overwrites
 * what was left. The user is told everything synced.
 *
 * Now every write goes to a NEW generation of chunk keys and the metadata write
 * is the single commit point. Before it, readers still see the complete previous
 * value; after it, the complete new one. The old generation is deleted only
 * afterwards, and failing to delete it costs a few stale slots, never data.
 *
 * Stated cost: a write interrupted BEFORE the commit leaves its half-written
 * generation behind with nothing pointing at it (a handful of slots per
 * interrupted write). That is deliberate - orphaned bytes are recoverable by
 * reinstalling, a destroyed session or queue is not.
 */
type ChunkMeta = {
  chunks: number
  /** Generation token; absent on values written before staged writes existed. */
  gen?: string
}

/**
 * WHY A READ REPORTS *WHY* IT CAME BACK EMPTY.
 *
 * `getItem` can only answer `string | null`, and supabase-js reads `null` as
 * "there is no session on this device" - so it signs the user out. That is the
 * right reading for a device that has genuinely never been signed in, and the
 * WRONG one for a device whose Keystore just refused a call: the session bytes
 * are still sitting there, but a field worker who does not know their own
 * password has been dropped onto a login screen they cannot pass.
 *
 * The two are indistinguishable through `getItem`, so `readItem` reports the
 * reason alongside the value:
 *   ok         - the value was read in full.
 *   absent     - every read succeeded and there is genuinely nothing stored.
 *   unreadable - a read REJECTED. Transient (binder / Keystore). Say nothing
 *                about whether a session exists.
 *   torn       - reads succeeded but a committed chunk set is incomplete. Not
 *                recoverable, but still not "signed out".
 *
 * `getItem` keeps its exact old contract for every existing caller.
 */
export type ReadStatus = 'ok' | 'absent' | 'unreadable' | 'torn'

export type VerboseRead = {
  value: string | null
  status: ReadStatus
}

/** A rejected Keystore call is transient far more often than it is fatal, so a
 *  read is retried a few times before we conclude anything from it. Kept small:
 *  this sits on the cold-start path, inside the caller's own restore budget. */
const READ_ATTEMPTS = 3
const READ_RETRY_BASE_MS = 60

/** Count of reads that ended `unreadable` or `torn`. Monotonic for the life of
 *  the process. A caller that saw only `null` can snapshot this before and after
 *  its own read and learn whether the emptiness was a storage failure. */
let readFailures = 0

/** @see readFailures */
export function storageReadFailureCount(): number {
  return readFailures
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Read ONE SecureStore slot, retrying a REJECTION.
 *
 * A resolved `null` is authoritative and is never retried - the slot really is
 * empty. Only a thrown call is retried, because that is the binder/Keystore
 * failure this app has already been ANR-reported for.
 */
async function readSlot(key: string): Promise<{ value: string | null; unreadable: boolean }> {
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(READ_RETRY_BASE_MS * attempt)
    try {
      return { value: await SecureStore.getItemAsync(key), unreadable: false }
    } catch {
      // Keep trying. Deliberately swallowed: the caller gets `unreadable`, which
      // carries the same information without a rejection escaping into
      // supabase-js's auth bootstrap or a queue read.
    }
  }
  return { value: null, unreadable: true }
}

const metaKey = (key: string) => `${key}_meta`
/** Legacy (pre-generation) chunk key. Still read so existing installs keep their
 *  session and their queued work across this upgrade. */
const chunkKey = (key: string, index: number, gen?: string) =>
  gen ? `${key}_g${gen}_chunk_${index}` : `${key}_chunk_${index}`

function newGeneration(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Read the committed metadata.
 *
 * `unreadable` means the Keystore refused the call after every retry - we know
 * nothing about whether a chunk set exists. Corrupt or missing JSON is a
 * DIFFERENT answer: we read it fine and there is no usable chunk set, so the
 * caller correctly falls back to the unchunked slot.
 */
async function readMetaVerbose(key: string): Promise<{ meta: ChunkMeta | null; unreadable: boolean }> {
  const raw = await readSlot(metaKey(key))
  if (raw.unreadable) return { meta: null, unreadable: true }
  if (!raw.value) return { meta: null, unreadable: false }
  try {
    const parsed = JSON.parse(raw.value) as ChunkMeta
    if (!parsed || typeof parsed.chunks !== 'number' || parsed.chunks < 1) {
      return { meta: null, unreadable: false }
    }
    return { meta: parsed, unreadable: false }
  } catch {
    return { meta: null, unreadable: false }
  }
}

/** Metadata for the write paths, which only need "is there a previous
 *  generation to retire" and treat an unreadable answer as "none". */
async function readMeta(key: string): Promise<ChunkMeta | null> {
  return (await readMetaVerbose(key)).meta
}

/**
 * The full read, with the reason it came back empty. Prefer this anywhere the
 * difference between "nothing stored" and "could not read" changes what the
 * user is shown - above all, deciding whether somebody is signed out.
 */
export async function readItem(key: string): Promise<VerboseRead> {
  if (!key || typeof key !== 'string') {
    if (__DEV__) console.warn('[SecureStorage] Invalid key provided to readItem:', key)
    return { value: null, status: 'absent' }
  }

  const record = (read: VerboseRead): VerboseRead => {
    if (read.status === 'unreadable' || read.status === 'torn') readFailures++
    return read
  }

  const metaRead = await readMetaVerbose(key)
  if (metaRead.unreadable) return record({ value: null, status: 'unreadable' })

  // No committed chunk set (or corrupt metadata): fall back to the unchunked
  // slot instead of throwing, or a guarded caller reads a full offline queue
  // as empty and appears to have lost pending items.
  if (!metaRead.meta) {
    const plain = await readSlot(key)
    if (plain.unreadable) return record({ value: null, status: 'unreadable' })
    return plain.value == null
      ? { value: null, status: 'absent' }
      : { value: plain.value, status: 'ok' }
  }

  const meta = metaRead.meta
  const parts = await Promise.all(
    Array.from({ length: meta.chunks }, (_, index) => readSlot(chunkKey(key, index, meta.gen))),
  )

  if (parts.some(part => part.unreadable)) return record({ value: null, status: 'unreadable' })
  // Metadata was committed, so a value WAS stored, yet a chunk is definitively
  // gone. Never `absent`: something was written here and the caller must not
  // conclude this device was never signed in.
  if (parts.some(part => part.value == null)) return record({ value: null, status: 'torn' })

  return { value: parts.map(part => part.value).join(''), status: 'ok' }
}

/** Best-effort deletion of one generation's chunks. Never throws. */
async function dropChunks(key: string, meta: ChunkMeta | null): Promise<void> {
  if (!meta) return
  await Promise.all(
    Array.from({ length: meta.chunks }, (_, index) =>
      SecureStore.deleteItemAsync(chunkKey(key, index, meta.gen)).catch(() => {}),
    ),
  )
}

export const secureStorage = {
  /** Unchanged contract: the value, or null for anything that is not a complete
   *  read. Callers that need to know WHY it was null use `readItem`. */
  async getItem(key: string): Promise<string | null> {
    return (await readItem(key)).value
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!key || typeof key !== 'string') {
      if (__DEV__) console.warn('[SecureStorage] Invalid key provided to setItem:', key)
      return
    }

    // The generation currently committed, so it can be retired AFTER the new one
    // is live. Read before anything is written.
    const previous = await readMeta(key)

    if (value.length <= CHUNK_SIZE) {
      // Write the plain slot first; it becomes authoritative only once the
      // metadata is gone, so the previous chunked value stays readable until then.
      await SecureStore.setItemAsync(key, value)
      await SecureStore.deleteItemAsync(metaKey(key)).catch(() => {})
      await dropChunks(key, previous)
      return
    }

    const gen = newGeneration()
    const chunks = Math.ceil(value.length / CHUNK_SIZE)
    await Promise.all(
      Array.from({ length: chunks }, (_, index) =>
        SecureStore.setItemAsync(
          chunkKey(key, index, gen),
          value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
        ),
      ),
    )

    // COMMIT POINT. Everything above is invisible to a reader; the moment this
    // lands the new value is the one served. If any write above rejected we
    // never get here and the previous value is still intact.
    await SecureStore.setItemAsync(metaKey(key), JSON.stringify({ chunks, gen }))

    // Retire what the previous generation used. Best effort: a leftover slot is
    // wasted space, never a wrong or missing value.
    await dropChunks(key, previous)
    await SecureStore.deleteItemAsync(key).catch(() => {})
  },

  async removeItem(key: string): Promise<void> {
    if (!key || typeof key !== 'string') {
      if (__DEV__) console.warn('[SecureStorage] Invalid key provided to removeItem:', key)
      return
    }

    const meta = await readMeta(key)
    await dropChunks(key, meta)
    // Legacy chunk keys, for a value written before generations existed whose
    // metadata has already been cleared.
    if (meta?.gen) await dropChunks(key, { chunks: meta.chunks })

    await Promise.all([
      SecureStore.deleteItemAsync(key).catch(() => {}),
      SecureStore.deleteItemAsync(metaKey(key)).catch(() => {}),
    ])
  },
}
