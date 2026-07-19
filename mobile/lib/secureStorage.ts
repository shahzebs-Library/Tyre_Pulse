import * as SecureStore from 'expo-secure-store'

const CHUNK_SIZE = 1800

type ChunkMeta = {
  chunks: number
}

const metaKey = (key: string) => `${key}_meta`
const chunkKey = (key: string, index: number) => `${key}_chunk_${index}`

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!key || typeof key !== 'string') {
      if (__DEV__) console.warn('[SecureStorage] Invalid key provided to getItem:', key)
      return null
    }
    
    const metaRaw = await SecureStore.getItemAsync(metaKey(key))
    if (!metaRaw) return SecureStore.getItemAsync(key)

    // A corrupt _meta entry must NOT make getItem reject (guarded callers would then
    // read a full offline queue as empty and appear to lose pending items). Fall back
    // to the unchunked value / null instead of throwing.
    let meta: ChunkMeta
    try {
      meta = JSON.parse(metaRaw) as ChunkMeta
    } catch {
      return SecureStore.getItemAsync(key)
    }
    const chunks = await Promise.all(
      Array.from({ length: meta.chunks }, (_, index) =>
        SecureStore.getItemAsync(chunkKey(key, index))
      )
    )

    if (chunks.some(chunk => chunk == null)) return null
    return chunks.join('')
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!key || typeof key !== 'string') {
      if (__DEV__) console.warn('[SecureStorage] Invalid key provided to setItem:', key)
      return
    }
    
    await this.removeItem(key)

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value)
      return
    }

    const chunks = Math.ceil(value.length / CHUNK_SIZE)
    await Promise.all(
      Array.from({ length: chunks }, (_, index) =>
        SecureStore.setItemAsync(
          chunkKey(key, index),
          value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)
        )
      )
    )
    await SecureStore.setItemAsync(metaKey(key), JSON.stringify({ chunks }))
  },

  async removeItem(key: string): Promise<void> {
    if (!key || typeof key !== 'string') {
      if (__DEV__) console.warn('[SecureStorage] Invalid key provided to removeItem:', key)
      return
    }
    
    const metaRaw = await SecureStore.getItemAsync(metaKey(key))
    if (metaRaw) {
      try {
        const meta = JSON.parse(metaRaw) as ChunkMeta
        await Promise.all(
          Array.from({ length: meta.chunks }, (_, index) =>
            SecureStore.deleteItemAsync(chunkKey(key, index))
          )
        )
      } catch {
        // Ignore malformed metadata and still clear the main keys.
      }
    }

    await Promise.all([
      SecureStore.deleteItemAsync(key),
      SecureStore.deleteItemAsync(metaKey(key)),
    ])
  },
}
