import { describe, expect, it, vi } from 'vitest'
import releaseHistory from '../data/releases.json'
import { changesSince, visibleReleases, readWaitingRelease, validReleaseManifest } from '../lib/releases'
const releases = [{ id: 'new', date: '2026-09-10', changes: [{ modules: ['vehicle_washing'], text: { en: 'Wash change', ar: 'غسيل' } }, { modules: ['fleet_master'], text: { en: 'Fleet change', ar: 'أسطول' } }] }, { id: 'old', date: '2026-09-09', changes: [{ modules: [], text: { en: 'General change', ar: 'عام' } }] }]
const manifest = { schema: 1, buildId: 'build-b', releases }
const auth = { profile: { role: 'Fleet Supervisor' }, hasPermission: k => k === 'vehicle_washing', moduleStatus: () => 'live' }
describe('release notes', () => {
  it('ships real Arabic translations for each published change', () => {
    for (const release of releaseHistory) for (const change of release.changes) {
      expect(change.text.ar).toMatch(/[\u0600-\u06ff]/)
      expect(change.text.ar).not.toContain('???')
    }
  })
  it('limits notes to effective live module access and includes general changes', () => {
    expect(visibleReleases(releases, auth)[0].changes.map(c => c.text.en)).toEqual(['Wash change'])
    expect(visibleReleases(releases, { ...auth, hasPermission: () => false })).toHaveLength(1)
    expect(visibleReleases(releases, { ...auth, moduleStatus: () => 'disabled' })).toHaveLength(1)
    expect(visibleReleases(releases, { ...auth, loading: true })).toEqual([])
    expect(visibleReleases(releases, { ...auth, profile: null })).toEqual([])
  })
  it('gives Admin the complete history', () => {
    expect(visibleReleases(releases, { ...auth, profile: { role: 'Admin' } })[0].changes).toHaveLength(2)
  })
  it('includes missed releases but never repeats the installed release as a new change', () => {
    expect(changesSince(manifest, 'old')).toEqual([releases[0]])
    expect(changesSince(manifest, 'new')).toEqual([])
    expect(changesSince(manifest, 'unknown')).toEqual([releases[0]])
  })
  it('rejects malformed payloads', () => {
    expect(validReleaseManifest(manifest)).toBe(true)
    expect(validReleaseManifest({ ...manifest, releases: [{ id: 'broken' }] })).toBe(false)
  })
  it('reads only the requested worker through its message port', async () => {
    class Channel {
      constructor() { this.port1 = { close: vi.fn() }; this.port2 = { close: vi.fn(), postMessage: data => this.port1.onmessage({ data }) } }
    }
    vi.stubGlobal('MessageChannel', Channel)
    const worker = { postMessage: vi.fn((message, ports) => ports[0].postMessage(manifest)) }
    try {
      expect(await readWaitingRelease(worker)).toEqual(manifest)
      expect(worker.postMessage.mock.calls[0][0]).toEqual({ type: 'TP_RELEASE_NOTES' })
      const silent = { postMessage: vi.fn() }
      expect(await readWaitingRelease(silent, { timeout: 1 })).toBeNull()
      const controller = new AbortController()
      const pending = readWaitingRelease(silent, { signal: controller.signal })
      controller.abort()
      expect(await pending).toBeNull()
    } finally { vi.unstubAllGlobals() }
  })
})
