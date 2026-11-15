import { describe, it, expect } from 'vitest'
import { initialTabFromUrl } from '../lib/urlTab'

describe('initialTabFromUrl', () => {
  const allowed = ['fleet', 'failures']
  it('opens the tab named in the address', () => {
    expect(initialTabFromUrl(allowed, 'fleet', '?tab=failures')).toBe('failures')
  })
  it('falls back when the tab is missing or unknown', () => {
    expect(initialTabFromUrl(allowed, 'fleet', '')).toBe('fleet')
    expect(initialTabFromUrl(allowed, 'fleet', '?tab=nope')).toBe('fleet')
    expect(initialTabFromUrl(allowed, 'fleet', '?other=1')).toBe('fleet')
  })
})
