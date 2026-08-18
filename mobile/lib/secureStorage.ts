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

const metaKey = (key: string) => `${key}_meta`
/** Legacy (pre-generation) chunk key. Still read so existing installs keep their
 *  session and their queued work across this upgrade. */
const chunkKey = (key: string, index: number, gen?: string) =>
  gen ? `${key}_g${gen}_chunk_${index}` : `${key}_chunk_${index}`

function newGeneration(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Read the committed metadata, or null when there is none / it is unreadable. */
async function readMeta(key: string): Promise<ChunkMeta | null> {
  let raw: string | null = null
  try {
    raw = await SecureStore.getItemAsync(metaKey(key))
  } catch {
    // A keystore read can reject outright. Treat it as "no chunk metadata" so
    // the caller falls back to the unchunked slot rather than propagating a
    // rejection into supabase-js's auth bootstrap or a queue read.
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ChunkMeta
    if (!parsed || typeof parsed.chunks !== 'number' || parsed.chunks < 1) return null
    return parsed
  } catch {
    return null
  }
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
  async getItem(key: string): Promise<string | null> {
    if (!key || typeof key !== 'string') {
      if (__DEV__) console.warn('[SecureStorage] Invalid key provided to getItem:', key)
      return null
    }

    const meta = await readMeta(key)
    // No committed chunk set (or corrupt metadata): fall back to the unchunked
    // slot instead of throwing, or a guarded caller reads a full offline queue
    // as empty and appears to have lost pending items.
    if (!meta) {
      try {
        return await SecureStore.getItemAsync(key)
      } catch {
        return null
      }
    }

    let chunks: (string | null)[]
    try {
      chunks = await Promise.all(
        Array.from({ length: meta.chunks }, (_, index) =>
          SecureStore.getItemAsync(chunkKey(key, index, meta.gen)),
        ),
      )
    } catch {
      return null
    }

    if (chunks.some(chunk => chunk == null)) return null
    return chunks.join('')
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
