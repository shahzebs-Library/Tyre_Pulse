import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isChunkLoadError, recoverFromChunkError } from '../lib/chunkRecovery'

describe('isChunkLoadError', () => {
  it('detects the deploy stale-chunk error across engines', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /assets/x.js'))).toBe(true)
    expect(isChunkLoadError('Importing a module script failed.')).toBe(true)
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'Loading chunk 42 failed' })).toBe(true)
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true)
  })

  it('does not mistake an ordinary error for a chunk error', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })
})

describe('recoverFromChunkError one-shot guard', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    // jsdom has no location.reload; stub it so recovery does not throw.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: vi.fn() },
    })
  })

  it('returns false for a non-chunk error and never reloads', () => {
    expect(recoverFromChunkError(new Error('normal bug'))).toBe(false)
    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('recovers once, then refuses to loop until the guard is cleared', () => {
    expect(recoverFromChunkError(new Error('Failed to fetch dynamically imported module'))).toBe(true)
    // Second call in the same tab must NOT reload again (guard set).
    expect(recoverFromChunkError(new Error('Failed to fetch dynamically imported module'))).toBe(false)
  })
})
