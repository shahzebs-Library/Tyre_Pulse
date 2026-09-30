/**
 * REGRESSION GUARD: a command queued WHILE the record-queue sync is awaiting the
 * network must survive, and so must its durable photos.
 *
 * doSyncRecordQueue used to write its stale snapshot back after each item and
 * then prune + sweep against that snapshot, so a record enqueued mid-sync was
 * overwritten AND its durable photo file was deleted as an orphan.
 */
const store: Record<string, string> = {}
const cleanupOrphanDurablePhotos = jest.fn((_active: Iterable<string>) => {})

let release: () => void = () => {}
const upsert = jest.fn(() => new Promise<{ error: null }>(resolve => {
  release = () => resolve({ error: null })
}))
const insert = upsert
jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn(() => ({ upsert, insert })) } }))
jest.mock('../lib/secureStorage', () => ({
  secureStorage: {
    getItem: async (k: string) => (k in store ? store[k] : null),
    setItem: async (k: string, v: string) => { store[k] = v },
    removeItem: async (k: string) => { delete store[k] },
  },
  readItem: async (k: string) => (
    k in store ? { value: store[k], status: 'ok' } : { value: null, status: 'absent' }
  ),
}))
jest.mock('../lib/photoUpload', () => ({ uploadModulePhoto: jest.fn(async () => 'tp-storage://x') }))
jest.mock('../lib/durablePhotos', () => ({
  persistPhotoForQueue: async (uri: string) => ({
    localPath: `file:///docs/queued-photos/q_${uri.split('/').pop()}`,
    size: 1, mimeType: 'image/jpeg', checksum: 'c', createdAt: 1,
  }),
  resolveDurablePath: (u: string) => u,
  deleteDurablePhoto: () => {},
  cleanupOrphanDurablePhotos: (a: Iterable<string>) => cleanupOrphanDurablePhotos(a),
  isDurablePhotoPath: (u: string | null | undefined) => !!u && u.includes('/queued-photos/'),
}))

import { enqueueCommand, getRecordQueue, syncRecordQueue } from '../lib/recordQueue'

const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  upsert.mockClear()
  cleanupOrphanDurablePhotos.mockClear()
})

describe('record queue concurrency', () => {
  it('keeps a command (and its durable photo) enqueued during a sync', async () => {
    await enqueueCommand('WASH_RECORD' as any, { asset_no: 'A1', wash_date: '2026-09-30' })
    const syncing = syncRecordQueue()
    for (let i = 0; i < 10 && upsert.mock.calls.length === 0; i++) await flush()
    expect(upsert).toHaveBeenCalledTimes(1)

    await enqueueCommand('WASH_RECORD' as any, {
      asset_no: 'A2', wash_date: '2026-09-30', photos: ['file:///cache/p1.jpg'],
    })
    release()
    await syncing

    const q = await getRecordQueue()
    expect(q).toHaveLength(1)
    expect(q[0].payload.asset_no).toBe('A2')
    expect(q[0].sync_status).toBe('pending')
    // The sweep must have seen the new record's durable photo as referenced.
    const active = [...(cleanupOrphanDurablePhotos.mock.calls.at(-1)?.[0] ?? [])]
    expect(active).toContain('file:///docs/queued-photos/q_p1.jpg')
  })
})
