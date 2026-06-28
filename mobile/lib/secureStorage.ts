import * as SecureStore from 'expo-secure-store'

const CHUNK_SIZE = 1800

type ChunkMeta = {
  chunks: number
}

const metaKey = (key: string) => `${key}:meta`
const chunkKey = (key: string, index: number) => `${key}:chunk:${index}`

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const metaRaw = await SecureStore.getItemAsync(metaKey(key))
    if (!metaRaw) return SecureStore.getItemAsync(key)

    const meta = JSON.parse(metaRaw) as ChunkMeta
    const chunks = await Promise.all(
      Array.from({ length: meta.chunks }, (_, index) =>
        SecureStore.getItemAsync(chunkKey(key, index))
      )
    )

    if (chunks.some(chunk => chunk == null)) return null
    return chunks.join('')
  },

  async setItem(key: string, value: string): Promise<void> {
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
